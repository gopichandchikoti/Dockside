import { afterEach, describe, expect, it } from 'vitest';
import { parseExposition } from '../src/domain/prometheus';
import { allowedFilesystem, deriveMetrics } from '../src/domain/metrics';
import { createTestApp, type TestApp } from './helpers';

import { exposition } from './fixtures';
describe('Prometheus and rate domain', () => {
  it('parses escapes, timestamps, comments, exponents and special floats', () => {
    const result = parseExposition(
      '# TYPE foo gauge\nfoo{label="a\\n\\"b\\\\c"} 1.2e3 123\na NaN\nb +Inf\nc -Inf\ninvalid',
    );
    expect(result.samples[0]).toEqual({ name: 'foo', labels: { label: 'a\n"b\\c' }, value: 1200, timestamp: 123 });
    expect(result.samples[1]?.value).toBeNaN();
    expect(result.samples[2]?.value).toBe(Infinity);
    expect(result.samples[3]?.value).toBe(-Infinity);
    expect(result.dropped).toBe(1);
  });
  it('caps families, series, duplicates and malformed labels', () => {
    expect(parseExposition('a 1\nb 2\nc 3', { families: 2, series: 8 }).dropped).toBe(1);
    expect(parseExposition('a{x="1"} 1\na{x="2"} 2', { families: 2, series: 1 }).dropped).toBe(1);
    expect(parseExposition('a 1\na 2\na{x="broken} 3\na{x="1",x="2"} 4').dropped).toBe(3);
  });
  it('derives rates without inventing data across reset, gap or initial scrape', () => {
    const first = deriveMetrics({ samples: parseExposition(exposition()).samples, at: 100, interval: 15 });
    expect(first.latest.cpu_percent).toBeNull();
    const next = deriveMetrics({
      samples: parseExposition(exposition(1)).samples,
      at: 110,
      interval: 15,
      previous: first.baseline,
    });
    expect(next.latest.cpu_percent).toBeCloseTo(20);
    expect(next.latest.network_rx_bytes_per_second).toBe(10);
    expect(next.latest.memory_percent).toBe(60);
    expect(next.filesystems).toHaveLength(1);
    expect(next.latest.temperature_celsius).toBeNull();
    expect(
      deriveMetrics({ samples: parseExposition(exposition()).samples, at: 120, interval: 15, previous: next.baseline })
        .latest.cpu_percent,
    ).toBeNull();
    expect(
      deriveMetrics({
        samples: parseExposition(exposition(2)).samples,
        at: 1000,
        interval: 15,
        previous: next.baseline,
      }).latest.network_rx_bytes_per_second,
    ).toBeNull();
  });
  it('excludes sensitive mounts and pseudo filesystems', () => {
    expect(allowedFilesystem('/var/lib/docker/overlay2', 'ext4')).toBe(false);
    expect(allowedFilesystem('/run/secrets', 'ext4')).toBe(false);
    expect(allowedFilesystem('/data', 'tmpfs')).toBe(false);
    expect(allowedFilesystem('/data', 'ext4')).toBe(true);
  });
});
describe('persistent metric history', () => {
  let test: TestApp;
  afterEach(async () => {
    if (test) {
      await test.app.close();
      test.ctx.db.close();
    }
  });
  it('persists samples and rollups, reports stale hosts, and cascades deletion', async () => {
    test = await createTestApp();
    const h = test.ctx.hosts.create({
      name: 'server',
      metricsUrl: 'http://localhost:9100/metrics',
      tags: [],
      isSample: false,
    });
    test.ctx.hosts.ingest(h.id, exposition());
    test.clock.advance(15000);
    test.ctx.hosts.ingest(h.id, exposition(1));
    expect(test.ctx.hosts.get(h.id).status).toBe('online');
    expect(test.ctx.hosts.series(h.id, 'cpu_percent', '1h').points.some(([, v]) => v !== null)).toBe(true);
    expect(test.ctx.hosts.series(h.id, 'memory_percent', '7d').cadenceSeconds).toBe(300);
    test.clock.advance(100000);
    expect(test.ctx.hosts.get(h.id).status).toBe('stale');
    test.clock.advance(100 * 86400000);
    test.ctx.hosts.retain();
    expect(test.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM samples')?.n).toBe(0);
    expect(test.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM samples_5m')?.n).toBe(0);
    test.ctx.hosts.delete(h.id);
    expect(test.ctx.hosts.list()).toHaveLength(0);
  });
});
