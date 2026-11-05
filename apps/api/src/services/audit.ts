import type { Db } from '../db/database';

export type AuditOutcome = 'success' | 'denied' | 'failure';

export interface AuditInput {
  actor?: { id: string; name: string } | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: AuditOutcome;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  ts: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

interface AuditRow {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  detail: string | null;
}

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|apikey|api_key|webhook/i;

/** Removes anything that looks like a credential. Audit details are for humans, never for secrets. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]),
    );
  }
  return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

const toEntry = (r: AuditRow): AuditEntry => ({
  id: r.id,
  ts: r.ts,
  actorId: r.actor_id,
  actorName: r.actor_name,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  outcome: r.outcome,
  ip: r.ip,
  detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
});

export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
  ) {}

  record(input: AuditInput): void {
    this.db.run(
      `INSERT INTO audit_log (ts, actor_id, actor_name, action, target_type, target_id, outcome, ip, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.now().toISOString(),
        input.actor?.id ?? null,
        input.actor?.name ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.outcome,
        input.ip ?? null,
        input.detail ? JSON.stringify(redact(input.detail)) : null,
      ],
    );
  }

  list(options: { limit: number; beforeId?: number | undefined; action?: string | undefined }): AuditEntry[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.beforeId !== undefined) {
      clauses.push('id < ?');
      params.push(options.beforeId);
    }
    if (options.action) {
      clauses.push('action = ?');
      params.push(options.action);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.all<AuditRow>(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`, [
      ...params,
      options.limit,
    ]);
    return rows.map(toEntry);
  }

  prune(olderThanDays: number): number {
    const cutoff = new Date(this.now().getTime() - olderThanDays * 86_400_000).toISOString();
    return this.db.run('DELETE FROM audit_log WHERE ts < ?', [cutoff]).changes;
  }
}
