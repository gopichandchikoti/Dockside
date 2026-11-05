import {
  HostSchema,
  HostInputSchema,
  METRICS,
  RANGE_SECONDS,
  type Host,
  type HostInput,
  type Metric,
  type Series,
  type TimeRange,
} from '@dockside/shared';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config';
import type { Db } from '../db/database';
import { deriveMetrics, type Baseline } from '../domain/metrics';
import { parseExposition } from '../domain/prometheus';
import { errors } from '../errors';
import { boundedRequest } from './http';

interface HostRow {
  id: string;
  name: string;
  metrics_url: string;
  tags: string;
  is_sample: number;
  last_success_at: string | null;
  last_error: string | null;
  failures: number;
  dropped_series: number;
  latest: string;
  metadata: string;
}
interface PointRow {
  ts: number;
  value: number | null;
}

export class HostService {
  private readonly baselines = new Map<string, Baseline>();
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly now: () => Date,
  ) {}

  list(): Host[] {
    return this.db.all<HostRow>('SELECT * FROM hosts ORDER BY name').map((r) => this.toHost(r));
  }
  get(id: string): Host {
    const row = this.db.get<HostRow>('SELECT * FROM hosts WHERE id = ?', [id]);
    if (!row) throw errors.notFound('Host');
    return this.toHost(row);
  }
  create(input: HostInput): Host {
    if (this.list().length >= 100) throw errors.conflict('The 100-host limit has been reached.');
    if (input.isSample && !this.config.sampleData) throw errors.badRequest('Sample hosts require SAMPLE_DATA=true.');
    const id = randomUUID();
    this.db.run('INSERT INTO hosts(id, name, metrics_url, tags, is_sample) VALUES (?, ?, ?, ?, ?)', [
      id,
      input.name,
      input.metricsUrl,
      JSON.stringify(input.tags),
      input.isSample ? 1 : 0,
    ]);
    return this.get(id);
  }
  update(id: string, input: HostInput): Host {
    this.get(id);
    if (input.isSample && !this.config.sampleData) throw errors.badRequest('Sample hosts require SAMPLE_DATA=true.');
    this.db.run(
      `UPDATE hosts SET name=?, metrics_url=?, tags=?, is_sample=?, latest='{}', metadata='{}',
      last_success_at=NULL, last_error=NULL, failures=0 WHERE id=?`,
      [input.name, input.metricsUrl, JSON.stringify(input.tags), input.isSample ? 1 : 0, id],
    );
    this.baselines.delete(id);
    return this.get(id);
  }
  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM hosts WHERE id = ?', [id]);
    this.baselines.delete(id);
  }
  bootstrap(): void {
    const host = this.config.bootstrapHost;
    if (host && !this.db.get('SELECT id FROM hosts WHERE metrics_url=?', [host.url]))
      this.create(HostInputSchema.parse({ name: host.name, metricsUrl: host.url, isSample: this.config.sampleData }));
  }

  async collect(id: string): Promise<void> {
    const host = this.get(id);
    try {
      const response = await boundedRequest(host.metricsUrl);
      if (response.status !== 200) throw new Error(`Exporter returned HTTP ${response.status}.`);
      this.ingest(id, response.body.toString('utf8'));
    } catch {
      this.db.run('UPDATE hosts SET failures=failures+1, last_error=? WHERE id=?', [
        'Exporter unavailable, timed out, redirected, or exceeded the response limit.',
        id,
      ]);
    }
  }
  ingest(id: string, text: string): void {
    const parsed = parseExposition(text);
    if (!parsed.samples.some((s) => s.name.startsWith('node_'))) throw new Error('No node_exporter series found.');
    const at = Math.floor(this.now().getTime() / 1000);
    const fresh = parsed.samples.filter(
      (s) => s.timestamp === null || Math.abs(s.timestamp / 1000 - at) <= this.config.scrapeIntervalSeconds * 3,
    );
    if (!fresh.some((s) => s.name.startsWith('node_') && Number.isFinite(s.value)))
      throw new Error('Exporter returned no fresh, finite node metrics.');
    const current = deriveMetrics({
      samples: fresh,
      at,
      interval: this.config.scrapeIntervalSeconds,
      previous: this.baselines.get(id),
    });
    this.db.transaction(() => {
      this.db.run(
        `UPDATE hosts SET last_success_at=?, last_error=NULL, failures=0, dropped_series=?,
        latest=?, metadata=? WHERE id=?`,
        [
          this.now().toISOString(),
          parsed.dropped,
          JSON.stringify(current.latest),
          JSON.stringify({
            filesystems: current.filesystems,
            interfaces: current.interfaces,
            sensors: current.sensors,
          }),
          id,
        ],
      );
      for (const [metric, value] of Object.entries(current.latest)) this.storePoint(id, metric, at, value);
    });
    this.baselines.set(id, current.baseline);
  }

  series(id: string, metric: Metric, range: TimeRange): Series {
    const host = this.get(id);
    const cadence = RANGE_SECONDS[range] > 86400 ? 300 : this.config.scrapeIntervalSeconds;
    const end = Math.floor(this.now().getTime() / 1000 / cadence) * cadence;
    const start = end - RANGE_SECONDS[range];
    const rows =
      cadence === 300
        ? this.db.all<PointRow>(
            'SELECT ts, total / count AS value FROM samples_5m WHERE host_id=? AND metric=? AND ts>=? AND ts<=? ORDER BY ts',
            [id, metric, start, end],
          )
        : this.db.all<PointRow>(
            'SELECT ts, value FROM samples WHERE host_id=? AND metric=? AND ts>=? AND ts<=? ORDER BY ts',
            [id, metric, start, end + cadence - 1],
          );
    const values = new Map(rows.map((p) => [Math.floor(p.ts / cadence) * cadence, p.value]));
    const points: Series['points'] = [];
    for (let ts = start; ts <= end; ts += cadence) points.push([ts * 1000, values.get(ts) ?? null]);
    return {
      metric,
      unit: METRICS[metric].unit,
      cadenceSeconds: cadence,
      source: `${host.isSample ? 'SAMPLE · ' : ''}${host.name} · node_exporter${cadence === 300 ? ' · 5-minute mean' : ''}`,
      points,
    };
  }

  retain(): void {
    const now = Math.floor(this.now().getTime() / 1000);
    this.db.transaction(() => {
      this.db.run('DELETE FROM samples WHERE ts < ?', [now - this.config.rawRetentionDays * 86400]);
      this.db.run('DELETE FROM samples_5m WHERE ts < ?', [now - this.config.rollupRetentionDays * 86400]);
    });
  }
  private storePoint(id: string, metric: string, ts: number, value: number | null): void {
    const exists = this.db.get('SELECT ts FROM samples WHERE host_id=? AND metric=? AND ts=?', [id, metric, ts]);
    if (exists) return;
    this.db.run('INSERT INTO samples(host_id, metric, ts, value) VALUES (?, ?, ?, ?)', [id, metric, ts, value]);
    if (value === null) return;
    this.db.run(
      `INSERT INTO samples_5m(host_id, metric, ts, total, count) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(host_id, metric, ts) DO UPDATE SET total=total+excluded.total, count=count+1`,
      [id, metric, Math.floor(ts / 300) * 300, value],
    );
  }
  private toHost(row: HostRow): Host {
    const stale =
      !row.last_success_at ||
      this.now().getTime() - Date.parse(row.last_success_at) > this.config.scrapeIntervalSeconds * 3000;
    const status = row.failures >= 3 ? 'offline' : stale || row.failures > 0 ? 'stale' : 'online';
    const spark = this.db.all<{ value: number | null }>(
      "SELECT value FROM samples WHERE host_id=? AND metric='cpu_percent' ORDER BY ts DESC LIMIT 24",
      [row.id],
    );
    return HostSchema.parse({
      id: row.id,
      name: row.name,
      metricsUrl: row.metrics_url,
      tags: HostSchema.shape.tags.parse(JSON.parse(row.tags)),
      isSample: row.is_sample === 1,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      failures: row.failures,
      droppedSeries: row.dropped_series,
      latest: HostSchema.shape.latest.parse(JSON.parse(row.latest)),
      filesystems: [],
      interfaces: [],
      sensors: [],
      ...(JSON.parse(row.metadata) as object),
      sparkline: spark.reverse().map((p) => p.value),
      status,
    });
  }
}
