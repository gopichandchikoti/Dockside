import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Permission } from '@dockside/shared';
import { can } from '@dockside/shared';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createTestApp, seedUser, setupAdmin, type Session, type TestApp } from './helpers';
import { exposition } from './fixtures';
import { demultiplexLogs, previousLogCursor, containerCpu } from '../src/domain/docker';
import { evaluateRule } from '../src/domain/alerts';
import { boundedRequest } from '../src/services/http';

let server: Server;
let origin: string;
let t: TestApp;
let admin: Session;
let requests: string[];
const containerId = 'a'.repeat(64);
beforeEach(async () => {
  requests = [];
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    if (path === '/metrics') {
      res.end(exposition(10));
      return;
    }
    if (path === '/redirect') {
      res.writeHead(302, { location: `${origin}/metrics` });
      res.end();
      return;
    }
    if (path === '/large') {
      res.end('x'.repeat(1024));
      return;
    }
    if (path === '/containers/json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify([
          { Id: containerId, Names: ['/test'], Image: 'test', State: 'running', Status: 'Up', Labels: {} },
          {
            Id: 'b'.repeat(64),
            Names: ['/hidden'],
            Image: 'test',
            State: 'running',
            Status: 'Up',
            Labels: { 'dockside.hide': 'true' },
          },
        ]),
      );
      return;
    }
    if (path.endsWith('/json')) {
      res.end(JSON.stringify({ RestartCount: 2, Config: { Labels: {} } }));
      return;
    }
    if (path.endsWith('/stats')) {
      res.end(JSON.stringify({ memory_stats: { usage: 1024 } }));
      return;
    }
    if (path.endsWith('/logs')) {
      res.end('2026-03-01T12:00:00.000000001Z test log\n');
      return;
    }
    if (path === '/fail') {
      res.writeHead(503);
      res.end();
      return;
    }
    res.end('healthy');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  origin = `http://127.0.0.1:${address.port}`;
  t = await createTestApp({ dockerEndpoint: origin });
  admin = await setupAdmin(t.app);
});
afterEach(async () => {
  await t.ctx.alerts.idle();
  await t.app.close();
  t.ctx.db.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const routeCases: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; permission: Permission }[] = [
  { method: 'GET', url: '/hosts', permission: 'hosts:read' },
  { method: 'POST', url: '/hosts', permission: 'hosts:manage' },
  { method: 'PATCH', url: `/hosts/${randomUUID()}`, permission: 'hosts:manage' },
  { method: 'DELETE', url: `/hosts/${randomUUID()}`, permission: 'hosts:manage' },
  { method: 'GET', url: `/hosts/${randomUUID()}/metrics?metric=cpu_percent`, permission: 'metrics:read' },
  { method: 'GET', url: '/containers', permission: 'containers:read' },
  { method: 'GET', url: `/containers/${containerId}/logs`, permission: 'containers:logs' },
  { method: 'POST', url: `/containers/${containerId}/restart`, permission: 'containers:restart' },
  { method: 'GET', url: '/checks', permission: 'checks:read' },
  { method: 'POST', url: '/checks', permission: 'checks:manage' },
  { method: 'POST', url: `/checks/${randomUUID()}/run`, permission: 'checks:run' },
  { method: 'DELETE', url: `/checks/${randomUUID()}`, permission: 'checks:manage' },
  { method: 'GET', url: '/alerts/rules', permission: 'alerts:read' },
  { method: 'GET', url: '/alerts/events', permission: 'alerts:read' },
  { method: 'POST', url: '/alerts/rules', permission: 'alerts:manage' },
  { method: 'PATCH', url: `/alerts/rules/${randomUUID()}`, permission: 'alerts:manage' },
  { method: 'DELETE', url: `/alerts/rules/${randomUUID()}`, permission: 'alerts:manage' },
  { method: 'POST', url: `/alerts/rules/${randomUUID()}/acknowledge`, permission: 'alerts:acknowledge' },
  { method: 'POST', url: `/alerts/rules/${randomUUID()}/silence`, permission: 'alerts:silence' },
  { method: 'GET', url: '/alerts/channels', permission: 'alerts:manage' },
  { method: 'POST', url: '/alerts/channels', permission: 'alerts:manage' },
  { method: 'DELETE', url: `/alerts/channels/${randomUUID()}`, permission: 'alerts:manage' },
  { method: 'GET', url: '/users', permission: 'users:manage' },
  { method: 'POST', url: '/users', permission: 'users:manage' },
  { method: 'PATCH', url: `/users/${randomUUID()}`, permission: 'users:manage' },
  { method: 'GET', url: '/audit', permission: 'audit:read' },
];
describe('route permission matrix and object boundaries', () => {
  it.each(['viewer', 'operator', 'admin'] as const)('enforces every data route for %s', async (role) => {
    const session = role === 'admin' ? admin : await seedUser(t, `test-${role}`, role);
    for (const route of routeCases) {
      const anonymous = await t.app.inject({ method: route.method, url: `/api/v1${route.url}` });
      expect(anonymous.statusCode, route.url).toBe(401);
      const response = await t.app.inject({
        method: route.method,
        url: `/api/v1${route.url}`,
        headers: session.headers,
      });
      if (can(role, route.permission)) {
        expect(response.statusCode, route.url).toBeLessThan(500);
        expect(response.json<{ error?: { code: string } }>().error?.code, route.url).not.toBe('forbidden');
      } else expect(response.statusCode, route.url).toBe(403);
    }
    if (role !== 'admin')
      expect(t.ctx.audit.list({ limit: 100 }).some((e) => e.action === 'request.forbidden')).toBe(true);
  });
  it('adds/edits/deletes hosts and validates metrics, sample flags and unknown objects', async () => {
    const body = { name: 'NAS', metricsUrl: `${origin}/metrics`, tags: ['home'] };
    const created = await t.app.inject({ method: 'POST', url: '/api/v1/hosts', headers: admin.headers, payload: body });
    expect(created.statusCode).toBe(201);
    const host = created.json<{ id: string; status: string }>();
    expect(host.status).toBe('online');
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: `/api/v1/hosts/${host.id}`,
          headers: admin.headers,
          payload: { ...body, name: 'Renamed' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ url: `/api/v1/hosts/${host.id}/metrics?metric=bad`, headers: admin.headers })).statusCode,
    ).toBe(400);
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/v1/hosts',
          headers: admin.headers,
          payload: { ...body, isSample: true },
        })
      ).statusCode,
    ).toBe(400);
    expect((await t.app.inject({ url: `/api/v1/hosts/${randomUUID()}`, headers: admin.headers })).statusCode).toBe(404);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/api/v1/hosts/${host.id}`, headers: admin.headers })).statusCode,
    ).toBe(204);
    expect(t.ctx.audit.list({ limit: 10 }).some((e) => e.action === 'host.delete')).toBe(true);
  });
  it('hides opted-out containers, bounds logs, denies restart by default and audits failure', async () => {
    const list = await t.app.inject({ url: '/api/v1/containers', headers: admin.headers });
    expect(list.json()).toMatchObject([{ id: containerId, restartCount: 2, memoryBytes: 1024 }]);
    const hidden = await t.app.inject({ url: `/api/v1/containers/${'b'.repeat(64)}/logs`, headers: admin.headers });
    expect(hidden.statusCode).toBe(404);
    const logs = await t.app.inject({ url: `/api/v1/containers/${containerId}/logs`, headers: admin.headers });
    expect(logs.json()).toMatchObject({ text: expect.stringContaining('test log') });
    const denied = await t.app.inject({
      method: 'POST',
      url: `/api/v1/containers/${containerId}/restart`,
      headers: admin.headers,
      payload: { confirm: true },
    });
    expect(denied.statusCode).toBe(403);
    expect(requests.some((r) => r.startsWith('POST /containers/'))).toBe(false);
    expect(t.ctx.audit.list({ limit: 5 })[0]).toMatchObject({ action: 'container.restart', outcome: 'denied' });
  });
});
describe('checks, alerts and network boundaries', () => {
  it('records HTTP and TCP success/failure history with actual local sockets', async () => {
    const check = t.ctx.checks.create({ name: 'HTTP', kind: 'http', target: origin, port: null });
    expect((await t.ctx.checks.run(check.id)).history[0]?.ok).toBe(true);
    const failed = t.ctx.checks.create({ name: 'Failed', kind: 'http', target: `${origin}/fail`, port: null });
    expect((await t.ctx.checks.run(failed.id)).history[0]?.ok).toBe(false);
    const tcp = t.ctx.checks.create({
      name: 'TCP',
      kind: 'tcp',
      target: '127.0.0.1',
      port: Number(new URL(origin).port),
    });
    expect((await t.ctx.checks.run(tcp.id)).history[0]?.ok).toBe(true);
    t.ctx.checks.delete(check.id);
    expect(() => t.ctx.checks.get(check.id)).toThrow(/not found/);
  });
  it('rejects redirects, excessive bodies and invalid protocols', async () => {
    await expect(boundedRequest(`${origin}/redirect`)).rejects.toThrow();
    await expect(boundedRequest(`${origin}/large`, { maxBytes: 100 })).rejects.toThrow(/byte limit/);
    await expect(boundedRequest('file:///etc/passwd')).rejects.toThrow(/destination/);
  });
  it('transitions pending/firing/acknowledged/recovered with a fake clock and encrypted delivery', async () => {
    const host = t.ctx.hosts.create({ name: 'host', metricsUrl: `${origin}/metrics`, tags: [], isSample: false });
    t.ctx.hosts.ingest(host.id, exposition());
    const rule = t.ctx.alerts.create({
      name: 'Memory',
      hostId: host.id,
      metric: 'memory_percent',
      operator: 'gt',
      threshold: 50,
      durationSeconds: 15,
      enabled: true,
    });
    const channel = t.ctx.alerts.saveChannel({
      name: 'local',
      kind: 'webhook',
      url: `${origin}/notify`,
      token: 'private-token',
    });
    expect(JSON.stringify(t.ctx.alerts.channels())).not.toContain('private-token');
    expect(t.ctx.db.get<{ secret: string }>('SELECT secret FROM channels')?.secret).not.toContain(origin);
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('pending');
    t.clock.advance(15000);
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('firing');
    await t.ctx.alerts.idle();
    expect(requests).toContain('POST /notify');
    expect(t.ctx.alerts.act(rule.id, 'acknowledge').state).toBe('acknowledged');
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('acknowledged');
    t.ctx.hosts.ingest(host.id, exposition().replace('MemAvailable_bytes 400', 'MemAvailable_bytes 900'));
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('ok');
    expect(t.ctx.alerts.events().some((e) => e.message.includes('recovered'))).toBe(true);
    expect(t.ctx.alerts.act(rule.id, 'silence', 60).state).toBe('silenced');
    t.clock.advance(61000);
    t.ctx.alerts.evaluate();
    await t.ctx.alerts.idle();
    if (channel) t.ctx.alerts.deleteChannel(channel.id);
    t.ctx.alerts.delete(rule.id);
    expect(() => t.ctx.alerts.get(rule.id)).toThrow();
  });
  it('marks collector failures offline and recovers after a successful scrape', async () => {
    const host = t.ctx.hosts.create({ name: 'host', metricsUrl: `${origin}/fail`, tags: [], isSample: false });
    for (let i = 0; i < 3; i++) await t.ctx.hosts.collect(host.id);
    expect(t.ctx.hosts.get(host.id).status).toBe('offline');
    t.ctx.hosts.ingest(host.id, exposition());
    expect(t.ctx.hosts.get(host.id).status).toBe('online');
  });
});
describe('Docker and alert pure branches', () => {
  it('demultiplexes frames and keeps a nanosecond cursor', () => {
    const data = Buffer.from('hello\n');
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(data.length, 4);
    expect(demultiplexLogs(Buffer.concat([header, data]))).toBe('hello\n');
    expect(() => demultiplexLogs(Buffer.concat([header, data.subarray(0, 2)]))).toThrow(/Truncated/);
    expect(previousLogCursor('2026-03-01T12:00:00.000000001Z hello')).toBe('1772366400.000000000');
    expect(previousLogCursor('no timestamps')).toBeNull();
    expect(containerCpu({})).toBeNull();
    expect(
      containerCpu({
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 2 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      }),
    ).toBe(20);
  });
  it('does not recover a firing rule from a missing sample', () => {
    const base = {
      id: randomUUID(),
      hostId: randomUUID(),
      name: 'CPU',
      metric: 'cpu_percent' as const,
      operator: 'gt' as const,
      threshold: 80,
      durationSeconds: 0,
      enabled: true,
      state: 'firing' as const,
      pendingSince: 0,
      silencedUntil: null,
      value: 90,
    };
    expect(evaluateRule(base, null, 100).state).toBe('firing');
    expect(evaluateRule({ ...base, enabled: false }, 90, 100).state).toBe('ok');
    expect(evaluateRule({ ...base, operator: 'lt' }, 90, 100).state).toBe('ok');
    expect(evaluateRule({ ...base, silencedUntil: 200 }, 90, 100).state).toBe('silenced');
  });
});
