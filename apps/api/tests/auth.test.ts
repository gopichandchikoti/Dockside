import { describe, expect, it } from 'vitest';
import { LOCKOUT_MS } from '../src/services/users';
import { SESSION_IDLE_MS } from '../src/services/sessions';
import { MIGRATIONS } from '../src/db/migrate';
import { ADMIN_PASSWORD, SETUP_TOKEN, createTestApp, login, seedUser, setupAdmin } from './helpers';

describe('first-run setup', () => {
  it('reports setupRequired on a fresh database and no user', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/session' });
    expect(res.json()).toMatchObject({ setupRequired: true, user: null, csrfToken: null, features: null });
  });

  it('rejects a wrong setup token and audits it', async () => {
    const { app, ctx } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: 'nope-nope-nope-nope', username: 'admin', password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.users.count()).toBe(0);
    expect(ctx.audit.list({ limit: 5 })[0]).toMatchObject({ action: 'setup.rejected', outcome: 'denied' });
  });

  it('refuses setup when no SETUP_TOKEN is configured', async () => {
    const { app } = await createTestApp({ setupToken: null });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: SETUP_TOKEN, username: 'admin', password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('setup_unavailable');
  });

  it('validates username and password rules', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: SETUP_TOKEN, username: 'A', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json<{ error: { details: { path: string }[] } }>().error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['username', 'password']));
  });

  it('creates the first admin, signs them in, and closes setup permanently', async () => {
    const { app } = await createTestApp();
    const session = await setupAdmin(app);
    const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: session.cookie } });
    expect(me.json()).toMatchObject({ setupRequired: false, user: { username: 'admin', role: 'admin' } });
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: SETUP_TOKEN, username: 'other', password: ADMIN_PASSWORD },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('setup_closed');
  });
});

describe('login, sessions and CSRF', () => {
  it('sets an HttpOnly SameSite=Strict cookie and never returns the password hash', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: SETUP_TOKEN, username: 'admin', password: ADMIN_PASSWORD },
    });
    const cookie = res.cookies[0];
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(res.body).not.toMatch(/scrypt|passwordHash|password_hash/);
  });

  it('uses a __Host- prefixed Secure cookie behind a TLS proxy', async () => {
    const { app } = await createTestApp({ behindTlsProxy: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { setupToken: SETUP_TOKEN, username: 'admin', password: ADMIN_PASSWORD },
    });
    expect(res.cookies[0]).toMatchObject({ name: '__Host-dockside', secure: true });
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('gives the same generic failure for unknown user, bad password and disabled user', async () => {
    const t = await createTestApp();
    await setupAdmin(t.app);
    await seedUser(t, 'viewer1', 'viewer');
    t.ctx.users.update(t.ctx.users.findByUsername('viewer1')?.id ?? '', { disabled: true });
    const attempt = (username: string, password: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/login', payload: { username, password } });
    const bodies = await Promise.all([
      attempt('ghost-user', ADMIN_PASSWORD),
      attempt('admin', 'wrong password here'),
      attempt('viewer1', ADMIN_PASSWORD),
    ]);
    for (const res of bodies) expect(res.statusCode).toBe(401);
    expect(new Set(bodies.map((r) => r.json<{ error: { message: string } }>().error.message)).size).toBe(1);
  });

  it('locks an account after repeated failures and unlocks after the window', async () => {
    const t = await createTestApp();
    await setupAdmin(t.app);
    for (let i = 0; i < 5; i += 1) {
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/login',
        payload: { username: 'admin', password: 'x'.repeat(14) },
      });
    }
    const locked = await t.app.inject({
      method: 'POST',
      url: '/api/v1/login',
      payload: { username: 'admin', password: ADMIN_PASSWORD },
    });
    expect(locked.statusCode).toBe(401);
    t.clock.advance(LOCKOUT_MS + 1000);
    await expect(login(t.app, 'admin', ADMIN_PASSWORD)).resolves.toBeDefined();
  });

  it('rate limits login attempts per client', async () => {
    const { app } = await createTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/login',
        payload: { username: 'nobody', password: 'x' },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[11]).toBe(429);
  });

  it('requires a valid CSRF token on state-changing authenticated requests', async () => {
    const { app, ctx } = await createTestApp();
    const session = await setupAdmin(app);
    const missing = await app.inject({ method: 'POST', url: '/api/v1/logout', headers: { cookie: session.cookie } });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('csrf_failed');
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/logout',
      headers: { cookie: session.cookie, 'x-csrf-token': 'wrong' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(ctx.audit.list({ limit: 3 }).some((e) => e.action === 'request.csrf_rejected')).toBe(true);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/logout', headers: session.headers });
    expect(ok.statusCode).toBe(204);
  });

  it('invalidates the session on logout', async () => {
    const { app } = await createTestApp();
    const session = await setupAdmin(app);
    await app.inject({ method: 'POST', url: '/api/v1/logout', headers: session.headers });
    const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: session.cookie } });
    expect(me.json().user).toBeNull();
  });

  it('expires idle sessions', async () => {
    const t = await createTestApp();
    const session = await setupAdmin(t.app);
    t.clock.advance(SESSION_IDLE_MS + 1000);
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: session.cookie } });
    expect(me.json().user).toBeNull();
  });

  it('ends sessions when the user is disabled', async () => {
    const t = await createTestApp();
    const admin = await setupAdmin(t.app);
    const viewer = await seedUser(t, 'viewer1', 'viewer');
    t.ctx.users.update(t.ctx.users.findByUsername('viewer1')?.id ?? '', { disabled: true });
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: viewer.cookie } });
    expect(me.json().user).toBeNull();
    expect(admin.cookie).not.toBe(viewer.cookie);
  });
});

describe('password change', () => {
  it('requires the current password and revokes other sessions', async () => {
    const t = await createTestApp();
    const first = await setupAdmin(t.app);
    const second = await login(t.app, 'admin', ADMIN_PASSWORD);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: first.headers,
      payload: { currentPassword: 'not it at all!!', newPassword: 'a brand new passphrase' },
    });
    expect(bad.statusCode).toBe(400);
    const good = await t.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      headers: first.headers,
      payload: { currentPassword: ADMIN_PASSWORD, newPassword: 'a brand new passphrase' },
    });
    expect(good.statusCode).toBe(200);
    const other = await t.app.inject({ method: 'GET', url: '/api/v1/session', headers: { cookie: second.cookie } });
    expect(other.json().user).toBeNull();
    await expect(login(t.app, 'admin', 'a brand new passphrase')).resolves.toBeDefined();
  });
});

describe('platform behaviour', () => {
  it('serves liveness and readiness without auth', async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ url: '/healthz' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ url: '/readyz' })).json()).toMatchObject({ status: 'ready' });
  });

  it('reports 503 when a readiness probe fails', async () => {
    const probes = [{ id: 'collector', label: 'Collector', check: () => ({ state: 'fail' as const, detail: 'x' }) }];
    const { app } = await createTestApp({}, { probes });
    const res = await app.inject({ url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.collector).toBe('fail');
    expect(res.body).not.toContain('"detail"');
  });

  it('reports component detail on the authenticated status endpoint and tolerates throwing probes', async () => {
    const probes = [
      {
        id: 'boom',
        label: 'Boom',
        check: () => {
          throw new Error('exploded');
        },
      },
    ];
    const t = await createTestApp({}, { probes });
    expect((await t.app.inject({ url: '/api/v1/status' })).statusCode).toBe(401);
    const session = await setupAdmin(t.app);
    const res = await t.app.inject({ url: '/api/v1/status', headers: { cookie: session.cookie } });
    const body = res.json();
    expect(body).toMatchObject({ version: '1.0.0', schemaVersion: Math.max(...MIGRATIONS.map((m) => m.id)) });
    expect(body.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'database', state: 'ok' }),
        expect.objectContaining({ id: 'boom', state: 'fail', detail: 'exploded' }),
      ]),
    );
  });

  it('sends security headers and a strict CSP', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns structured JSON errors for unknown API routes and bad bodies', async () => {
    const { app } = await createTestApp();
    const missing = await app.inject({ url: '/api/v1/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'not_found' });
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/login',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('bad_request');
    const text = await app.inject({
      method: 'POST',
      url: '/api/v1/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(text.statusCode).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/login',
      payload: { username: 'a', password: 'x'.repeat(70_000) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/too large/);
  });
});
