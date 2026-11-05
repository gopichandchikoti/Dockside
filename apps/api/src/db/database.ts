import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type SqlParam = SQLInputValue;

export interface RunResult {
  changes: number;
}

/**
 * Thin typed wrapper around node:sqlite. Row typing happens here and only here: callers state the row shape they
 * selected, and every repository maps rows to domain types before returning them.
 */
export class Db {
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(private readonly raw: DatabaseSync) {}

  private stmt(sql: string): StatementSync {
    let statement = this.cache.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }

  get<T>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, params: SqlParam[] = []): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  run(sql: string, params: SqlParam[] = []): RunResult {
    const result = this.stmt(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs fn atomically. Nested calls use savepoints so an inner failure rolls back only the inner work. */
  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const savepoint = `sp_${this.depth}`;
    this.raw.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      this.raw.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      this.raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  ping(): boolean {
    return this.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec('PRAGMA synchronous = NORMAL;');
  return new Db(raw);
}
