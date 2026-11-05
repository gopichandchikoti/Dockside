import type { Db } from './database';
import { core } from './migrations/001_core';
import { metrics } from './migrations/002_metrics';
import { checks } from './migrations/003_checks';
import { alerts } from './migrations/004_alerts';
import type { Migration } from './migrations/types';

export const MIGRATIONS: readonly Migration[] = [core, metrics, checks, alerts];

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

interface AppliedRow {
  id: number;
}

/**
 * Applies pending migrations in order, each in its own transaction. Refuses to run against a database that has
 * migrations this build does not know about (i.e. written by a newer version) rather than risk corrupting it.
 */
export function migrate(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => Date = () => new Date(),
): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const known = new Set(migrations.map((m) => m.id));
  const applied = new Set(db.all<AppliedRow>('SELECT id FROM schema_migrations').map((r) => r.id));
  for (const id of applied) {
    if (!known.has(id)) {
      throw new MigrationError(`Database has migration ${id} which this version does not know. Refusing to downgrade.`);
    }
  }
  const ran: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
        migration.id,
        migration.name,
        now().toISOString(),
      ]);
    });
    ran.push(migration.id);
  }
  return ran;
}
