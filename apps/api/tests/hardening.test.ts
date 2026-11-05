import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createTestApp, setupAdmin, type TestApp } from './helpers';
import { exposition } from './fixtures';
import { startScheduler } from '../src/services/scheduler';
import { deriveMetrics } from '../src/domain/metrics';
import { parseExposition } from '../src/domain/prometheus';
import { containerCpu, demultiplexLogs } from '../src/domain/docker';
import { boundedRequest } from '../src/services/http';
import { evaluateRule } from '../src/domain/alerts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.ctx.alerts.idle();
  await t.app.close();
  t.ctx.db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const newHost = () =>
  t.ctx.hosts.create({ name: 'test', metricsUrl: 'http://sample/metrics', tags: [], isSample: false });
const newRule = () =>
  t.ctx.alerts.create({
    name: 'CPU',
    hostId: newHost().id,
    metric: 'cpu_percent',
    operator: 'gt',
    threshold: 80,
    durationSeconds: 30,
    enabled: true,
  });
describe('packaged HTTP boundaries', () => {
  it('serves root/assets and SPA pages while rejecting private files and unknown API paths', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'dockside-static-'));
    writeFileSync(join(folder, 'index.html'), '<!doctype html><title>Dockside test</title>');
    writeFileSync(join(folder, 'asset.js'), 'export const sample = true;');
    writeFileSync(join(folder, '.env'), 'SECRET=do-not-serve');
    await t.app.close();
    t.ctx.db.close();
    t = await createTestApp({ webDist: folder });
    expect((await t.app.inject('/')).body).toContain('Dockside test');
    expect((await t.app.inject('/asset.js')).body).toContain('sample');
    expect((await t.app.inject({ url: '/hosts/example', headers: { accept: 'text/html' } })).body).toContain(
      'Dockside test',
    );
    expect((await t.app.inject('/missing.js')).statusCode).toBe(404);
    expect((await t.app.inject('/.env')).body).not.toContain('do-not-serve');
    expect((await t.app.inject({ url: '/api/missing', headers: { accept: 'text/html' } })).statusCode).toBe(404);
  });
  it('requires confirmation when restart is enabled, audits the result and enforces current user roles', async () => {
    const id = 'a'.repeat(64);
    t.ctx.config.containerActionsEnabled = true;
    t.ctx.config.dockerEndpoint = 'http://proxy';
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`);
        if (url.endsWith('/containers/json?all=true'))
          return Promise.resolve(
            new Response(
              JSON.stringify([
                { Id: id, Names: ['/test'], Image: 'test', State: 'running', Status: 'Up', Labels: null },
              ]),
            ),
          );
        return Promise.resolve(new Response(JSON.stringify({ RestartCount: 0, Config: { Labels: null } })));
      }),
    );
    const admin = await setupAdmin(t.app);
    const request = (confirm: boolean) =>
      t.app.inject({
        method: 'POST',
        url: `/api/v1/containers/${id}/restart`,
        headers: admin.headers,
        payload: { confirm },
      });
    expect((await request(false)).statusCode).toBe(400);
    expect((await request(true)).statusCode).toBe(200);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true);
    expect(t.ctx.audit.list({ limit: 5 })[0]).toMatchObject({
      targetId: id,
      action: 'container.restart',
      outcome: 'success',
    });
    const create = await t.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: admin.headers,
      payload: { username: 'new-viewer', password: 'test password passphrase', role: 'viewer' },
    });
    expect(create.statusCode).toBe(201);
    const user = create.json<{ id: string }>();
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: `/api/v1/users/${user.id}`,
          headers: admin.headers,
          payload: { disabled: true },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('handles Docker being absent, unreachable or malformed without exposing internal errors', async () => {
    await expect(t.ctx.docker.list()).rejects.toMatchObject({ code: 'feature_disabled' });
    t.ctx.config.dockerEndpoint = 'http://proxy';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private stack trace')));
    await expect(t.ctx.docker.list()).rejects.toMatchObject({ code: 'upstream_unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));
    await expect(t.ctx.docker.list()).rejects.toMatchObject({ code: 'upstream_unavailable' });
    await expect(t.ctx.docker.logs('../bad')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('keeps container inventory available when inspect or stats return malformed data', async () => {
    t.ctx.config.dockerEndpoint = 'http://proxy';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            url.endsWith('/containers/json?all=true')
              ? JSON.stringify([
                  { Id: 'a'.repeat(64), Names: [], Image: 'test', State: 'exited', Status: 'Stopped', Labels: null },
                ])
              : 'invalid json',
          ),
        ),
      ),
    );
    expect(await t.ctx.docker.list()).toMatchObject([
      { name: 'a'.repeat(12), cpuPercent: null, memoryBytes: null, restartCount: null },
    ]);
  });
});
describe('scheduler, retention and limits', () => {
  it('registers the bootstrap host, ingests asynchronously and stops its timer', async () => {
    vi.useFakeTimers();
    t.ctx.config.bootstrapHost = { name: 'bootstrap', url: 'http://sample/metrics' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(exposition()))),
    );
    const onError = vi.fn();
    const stop = startScheduler(t.ctx, onError);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.ctx.hosts.list()[0]?.status).toBe('online');
    expect(t.ctx.components.find((c) => c.id === 'collector')?.check().state).toBe('ok');
    t.clock.advance(15000);
    await vi.advanceTimersByTimeAsync(15000);
    await stop();
    expect(onError).not.toHaveBeenCalled();
    t.ctx.hosts.bootstrap();
    expect(t.ctx.hosts.list()).toHaveLength(1);
  });
  it('reports unconfigured and failed background cycles instead of pretending collection succeeded', async () => {
    vi.useFakeTimers();
    let stop = startScheduler(t.ctx, vi.fn());
    await vi.advanceTimersByTimeAsync(1);
    expect(t.ctx.components.find((c) => c.id === 'collector')?.check().state).toBe('unconfigured');
    await stop();
    newHost();
    const error = vi.fn();
    vi.spyOn(t.ctx.alerts, 'evaluate').mockImplementation(() => {
      throw new Error('Disk full');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(exposition()))),
    );
    stop = startScheduler(t.ctx, error);
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toHaveBeenCalled();
    await stop();
  });
  it('enforces inventory limits and exposes dropped high-cardinality series', () => {
    const host = newHost();
    const large = exposition() + Array.from({ length: 4200 }, (_, i) => `node_custom{instance="${i}"} 1`).join('\n');
    t.ctx.hosts.ingest(host.id, large);
    expect(t.ctx.hosts.get(host.id).droppedSeries).toBeGreaterThan(0);
    for (let i = 1; i < 100; i++) newHost();
    expect(newHost).toThrow(/100-host/);
    for (let i = 0; i < 100; i++)
      t.ctx.checks.create({ name: 'check', kind: 'http', target: 'http://sample', port: null });
    expect(() => t.ctx.checks.create({ name: 'check', kind: 'http', target: 'http://sample', port: null })).toThrow(
      /100-check/,
    );
  });
  it('keeps one sample per second and treats invalid or stale exporter values as absent', () => {
    const host = newHost();
    t.ctx.hosts.ingest(host.id, exposition());
    t.ctx.hosts.ingest(host.id, exposition());
    expect(t.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM samples WHERE host_id=?', [host.id])?.n).toBe(11);
    expect(() => t.ctx.hosts.ingest(host.id, 'not metrics')).toThrow();
    expect(() => t.ctx.hosts.ingest(host.id, 'node_load1 1 1000')).toThrow(/fresh/);
    const empty = deriveMetrics({ samples: [], at: 100, interval: 15 });
    expect(empty.latest.memory_percent).toBeNull();
    expect(empty.latest.filesystem_percent).toBeNull();
    const measured = deriveMetrics({
      samples: parseExposition(exposition() + '\nnode_hwmon_temp_celsius{sensor="cpu"} 42\n').samples,
      at: 1700001000,
      interval: 15,
    });
    expect(measured.latest.temperature_celsius).toBe(42);
    expect(measured.latest.filesystem_percent).toBe(50);
  });
});
describe('alert and network failure handling', () => {
  it('never reports a recovery when a pending or expired-silence rule loses its samples', () => {
    const host = newHost();
    t.ctx.hosts.ingest(host.id, exposition());
    const rule = t.ctx.alerts.create({
      name: 'Memory',
      hostId: host.id,
      metric: 'memory_percent',
      operator: 'gt',
      threshold: 10,
      durationSeconds: 30,
      enabled: true,
    });
    t.ctx.alerts.evaluate();
    t.clock.advance(60000);
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.events()[0]?.message).toContain('waiting for fresh data');
    t.ctx.alerts.act(rule.id, 'silence', 60);
    t.clock.advance(61000);
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('silenced');
    expect(t.ctx.alerts.events().some((e) => e.message.includes('recovered'))).toBe(false);
  });
  it('prevents unbounded notification concurrency and exposes queue overflow', async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
    );
    const host = newHost();
    t.ctx.hosts.ingest(host.id, exposition());
    for (let i = 0; i < 21; i++)
      t.ctx.alerts.create({
        name: `rule-${i}`,
        hostId: host.id,
        metric: 'memory_percent',
        operator: 'gt',
        threshold: 0,
        durationSeconds: 0,
        enabled: true,
      });
    t.ctx.alerts.saveChannel({ name: 'sample', kind: 'webhook', url: 'http://sample/notify', token: '' });
    t.ctx.alerts.evaluate();
    expect(pending).toHaveLength(20);
    expect(t.ctx.alerts.channels()[0]?.lastDelivery).toContain('Queue full');
    pending.forEach((resolve) => resolve(new Response(null, { status: 204 })));
    await t.ctx.alerts.idle();
  });
  it('does not overlap a running check and rejects cloud metadata TCP targets', async () => {
    let complete: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    const check = t.ctx.checks.create({ name: 'slow', kind: 'http', target: 'http://sample', port: null });
    const running = t.ctx.checks.run(check.id);
    await expect(t.ctx.checks.run(check.id)).rejects.toMatchObject({ code: 'conflict' });
    complete(new Response('healthy'));
    await running;
    const prohibited = t.ctx.checks.create({ name: 'metadata', kind: 'tcp', target: '169.254.169.254', port: 80 });
    expect((await t.ctx.checks.run(prohibited.id)).history[0]?.ok).toBe(false);
    const closed = t.ctx.checks.create({ name: 'refused', kind: 'tcp', target: '127.0.0.1', port: 1 });
    expect((await t.ctx.checks.run(closed.id)).history[0]?.ok).toBe(false);
  });
  it('retries notification failures, records delivery failure and keeps the evaluator nonblocking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('failed', { status: 503 }))),
    );
    const host = newHost();
    t.ctx.hosts.ingest(host.id, exposition());
    t.ctx.alerts.create({
      name: 'Memory',
      hostId: host.id,
      metric: 'memory_percent',
      operator: 'gt',
      threshold: 10,
      durationSeconds: 0,
      enabled: true,
    });
    t.ctx.alerts.saveChannel({ name: 'ntfy', kind: 'ntfy', url: 'http://sample/notify', token: '' });
    t.ctx.alerts.evaluate();
    await t.ctx.alerts.idle();
    expect(t.ctx.alerts.channels()[0]?.lastDelivery).toContain('failed after 3 attempts');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
  it('updates rules, handles pending gaps, checks silence expiry and refuses unknown channel deletion', () => {
    let rule = newRule();
    rule = t.ctx.alerts.update(rule.id, { ...rule, name: 'Updated', enabled: false });
    t.ctx.alerts.evaluate();
    expect(t.ctx.alerts.get(rule.id).state).toBe('ok');
    expect(() => t.ctx.alerts.act(rule.id, 'acknowledge')).toThrow(/Only a firing/);
    expect(evaluateRule({ ...rule, enabled: true, state: 'pending' }, null, 50).pendingSince).toBeNull();
    expect(evaluateRule({ ...rule, enabled: true, operator: 'lt', state: 'ok', threshold: 100 }, 20, 50).state).toBe(
      'pending',
    );
    expect(() => t.ctx.alerts.deleteChannel(randomUUID())).toThrow(/not found/);
    for (let i = 0; i < 20; i++)
      t.ctx.alerts.saveChannel({ name: 'channel', kind: 'ntfy', url: 'http://sample', token: '' });
    expect(() => t.ctx.alerts.saveChannel({ name: 'too many', kind: 'ntfy', url: 'http://sample', token: '' })).toThrow(
      /20-channel/,
    );
  });
  it('bounds empty and encoded responses, and handles counter resets and broken Docker frames', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect((await boundedRequest('http://sample')).body).toHaveLength(0);
    expect(
      containerCpu({
        cpu_stats: { cpu_usage: { total_usage: 1 }, system_cpu_usage: 1 },
        precpu_stats: { cpu_usage: { total_usage: 2 }, system_cpu_usage: 2 },
      }),
    ).toBeNull();
    const frame = Buffer.alloc(9);
    frame[0] = 1;
    frame.writeUInt32BE(0, 4);
    expect(() => demultiplexLogs(frame)).toThrow(/header/);
    expect(parseExposition('a{x="1" junk} 1\nb invalid\nc Inf').dropped).toBe(2);
  });
  it('touches and expires sessions, including absolute expiry despite activity', async () => {
    const session = await setupAdmin(t.app);
    const sid = session.cookie.split('=')[1] ?? '';
    t.clock.advance(61000);
    expect(t.ctx.sessions.resolve(sid)).not.toBeNull();
    t.clock.advance(13 * 3600000);
    expect(t.ctx.sessions.resolve(sid)).toBeNull();
    expect(t.ctx.sessions.purgeExpired()).toBe(0);
    expect(() => t.ctx.users.update(randomUUID(), { disabled: true })).toThrow(/not found/);
  });
});
