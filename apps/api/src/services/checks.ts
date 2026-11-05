import { CheckSchema, type CheckInput, type ServiceCheck } from '@dockside/shared';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Db } from '../db/database';
import { errors } from '../errors';
import { boundedRequest } from './http';

interface CheckRow {
  id: string;
  name: string;
  kind: 'http' | 'tcp';
  target: string;
  port: number | null;
}
interface ResultRow {
  ts: string;
  ok: number;
  latency_ms: number;
  detail: string;
}

async function tcpProbe(host: string, port: number): Promise<void> {
  if (['169.254.169.254', 'metadata.google.internal', '100.100.100.200'].includes(host))
    throw errors.badRequest('Cloud metadata targets are prohibited.');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(5000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      reject(new Error('TCP connection failed.'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('TCP connection timed out.'));
    });
  });
}

export class CheckService {
  private readonly running = new Set<string>();
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}
  list(): ServiceCheck[] {
    return this.db.all<CheckRow>('SELECT * FROM checks ORDER BY name').map((r) => this.map(r));
  }
  get(id: string): ServiceCheck {
    const row = this.db.get<CheckRow>('SELECT * FROM checks WHERE id=?', [id]);
    if (!row) throw errors.notFound('Check');
    return this.map(row);
  }
  create(input: CheckInput): ServiceCheck {
    if (this.list().length >= 100) throw errors.conflict('The 100-check limit has been reached.');
    const id = randomUUID();
    this.db.run('INSERT INTO checks(id, name, kind, target, port) VALUES (?, ?, ?, ?, ?)', [
      id,
      input.name,
      input.kind,
      input.target,
      input.port,
    ]);
    return this.get(id);
  }
  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM checks WHERE id=?', [id]);
  }
  async run(id: string): Promise<ServiceCheck> {
    const check = this.get(id);
    if (this.running.has(id)) throw errors.conflict('This check is already running.');
    this.running.add(id);
    const started = performance.now();
    let ok = true;
    let detail = 'Connected';
    try {
      if (check.kind === 'tcp') await tcpProbe(check.target, check.port ?? 80);
      else {
        const response = await boundedRequest(check.target, { maxBytes: 64 * 1024 });
        ok = response.status >= 200 && response.status < 400;
        detail = `HTTP ${response.status}`;
      }
    } catch {
      ok = false;
      detail = 'Unavailable, timed out, redirected or response limit exceeded.';
    }
    try {
      this.db.run('INSERT INTO check_results(check_id, ts, ok, latency_ms, detail) VALUES (?, ?, ?, ?, ?)', [
        id,
        this.now().toISOString(),
        ok ? 1 : 0,
        Math.round(performance.now() - started),
        detail,
      ]);
      this.db.run(
        `DELETE FROM check_results WHERE check_id=? AND id NOT IN
        (SELECT id FROM check_results WHERE check_id=? ORDER BY id DESC LIMIT 1000)`,
        [id, id],
      );
      return this.get(id);
    } finally {
      this.running.delete(id);
    }
  }
  private map(row: CheckRow): ServiceCheck {
    const history = this.db.all<ResultRow>('SELECT * FROM check_results WHERE check_id=? ORDER BY id DESC LIMIT 100', [
      row.id,
    ]);
    return CheckSchema.parse({
      ...row,
      history: history.map((r) => ({ ts: r.ts, ok: r.ok === 1, latencyMs: r.latency_ms, detail: r.detail })),
    });
  }
}
