import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';
import { openDatabase } from '../src/db/database';
import { MIGRATIONS, MigrationError, migrate } from '../src/db/migrate';
import { hashPassword, verifyPassword } from '../src/domain/password';
import { decryptSecret, encryptSecret } from '../src/domain/secrets';
import { AuditService, redact } from '../src/services/audit';
import { UserService } from '../src/services/users';
import { fakeClock } from './helpers';

const BASE_ENV = { SECRETS_KEY: 'k'.repeat(40) };

describe('config', () => {
  it('applies defaults and ignores blank values', () => {
    const config = loadConfig({ ...BASE_ENV, PORT: '', BOOTSTRAP_HOST_NAME: '  ' });
    expect(config.port).toBe(8080);
    expect(config.containerActionsEnabled).toBe(false);
    expect(config.bootstrapHost).toBeNull();
    expect(config.dockerEndpoint).toBeNull();
  });

  it('requires a long SECRETS_KEY and reports every problem', () => {
    expect(() => loadConfig({ SECRETS_KEY: 'short', PORT: '99999' })).toThrowError(ConfigError);
    try {
      loadConfig({ SECRETS_KEY: 'short', PORT: '99999' });
    } catch (error) {
      expect((error as ConfigError).problems).toHaveLength(2);
    }
  });

  it('requires bootstrap host name and url together', () => {
    expect(() => loadConfig({ ...BASE_ENV, BOOTSTRAP_HOST_NAME: 'nas' })).toThrow(/set together/);
    const ok = loadConfig({ ...BASE_ENV, BOOTSTRAP_HOST_NAME: 'nas', BOOTSTRAP_HOST_URL: 'http://nas:9100/metrics' });
    expect(ok.bootstrapHost).toEqual({ name: 'nas', url: 'http://nas:9100/metrics' });
  });

  it('refuses container actions without a docker endpoint', () => {
    expect(() => loadConfig({ ...BASE_ENV, CONTAINER_ACTIONS_ENABLED: 'true' })).toThrow(/DOCKER_ENDPOINT/);
  });

  it('rejects non-http URLs', () => {
    expect(() => loadConfig({ ...BASE_ENV, DOCKER_ENDPOINT: 'file:///var/run/docker.sock' })).toThrowError(ConfigError);
  });
});

describe('migrations', () => {
  it('applies once and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(migrate(db)).toEqual([]);
  });

  it('rolls back a failing migration and leaves earlier ones applied', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const broken = { id: 99, name: 'broken', sql: 'CREATE TABLE ok_table (a INTEGER); INSERT INTO nope VALUES (1);' };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow();
    expect(db.get('SELECT name FROM sqlite_master WHERE name = ?', ['ok_table'])).toBeUndefined();
    expect(db.all('SELECT id FROM schema_migrations')).toHaveLength(MIGRATIONS.length);
  });

  it('refuses to run against a database from a newer version', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [500, 'future', 'now']);
    expect(() => migrate(db)).toThrowError(MigrationError);
  });
});

describe('database transactions', () => {
  it('uses savepoints so an inner failure does not undo the outer work', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    db.transaction(() => {
      db.run('INSERT INTO t VALUES (1)');
      expect(() =>
        db.transaction(() => {
          db.run('INSERT INTO t VALUES (2)');
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(db.all<{ v: number }>('SELECT v FROM t').map((r) => r.v)).toEqual([1]);
  });

  it('rolls back everything when the outer transaction fails', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all('SELECT v FROM t')).toHaveLength(0);
  });
});

describe('password hashing', () => {
  it('verifies correct passwords and rejects wrong or malformed ones', async () => {
    const hash = await hashPassword('hunter2 hunter2 hunter2', 2 ** 10);
    expect(hash.startsWith('scrypt$1024$')).toBe(true);
    await expect(verifyPassword('hunter2 hunter2 hunter2', hash)).resolves.toBe(true);
    await expect(verifyPassword('hunter2 hunter2 hunter3', hash)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'scrypt$x$8$1$aa$bb')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password-123', 2 ** 10),
      hashPassword('same-password-123', 2 ** 10),
    ]);
    expect(a).not.toBe(b);
  });
});

describe('secret encryption', () => {
  it('round-trips and detects tampering or the wrong key', () => {
    const sealed = encryptSecret('https://hooks.example/secret-path', 'key-one-key-one-key-one-key-one-1234');
    expect(sealed).not.toContain('secret-path');
    expect(decryptSecret(sealed, 'key-one-key-one-key-one-key-one-1234')).toBe('https://hooks.example/secret-path');
    expect(() => decryptSecret(sealed, 'a-different-key-a-different-key-123')).toThrow();
    const parts = sealed.split('.');
    parts[3] = `${parts[3]?.slice(0, -2)}AA`;
    expect(() => decryptSecret(parts.join('.'), 'key-one-key-one-key-one-key-one-1234')).toThrow();
    expect(() => decryptSecret('garbage', 'key-one-key-one-key-one-key-one-1234')).toThrow(/Unsupported/);
  });
});

describe('audit', () => {
  it('redacts credentials from details', () => {
    expect(redact({ password: 'x', nested: { apiToken: 'y', keep: 1 }, list: [{ secret: 'z' }], name: 'ok' })).toEqual({
      password: '[redacted]',
      nested: { apiToken: '[redacted]', keep: 1 },
      list: [{ secret: '[redacted]' }],
      name: 'ok',
    });
    expect(redact({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: '[truncated]' } } } });
  });

  it('records, filters, pages and prunes entries', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const clock = fakeClock();
    const audit = new AuditService(db, clock.now);
    for (let i = 0; i < 5; i += 1)
      audit.record({ action: i % 2 ? 'a' : 'b', outcome: 'success', detail: { token: 't', i } });
    const all = audit.list({ limit: 10 });
    expect(all).toHaveLength(5);
    expect(all[0]?.detail).toMatchObject({ token: '[redacted]' });
    expect(audit.list({ limit: 10, action: 'a' })).toHaveLength(2);
    expect(audit.list({ limit: 2, beforeId: all[1]?.id }).map((e) => e.id)).toEqual([all[2]?.id, all[3]?.id]);
    clock.advance(40 * 86_400_000);
    expect(audit.prune(30)).toBe(5);
  });
});

describe('user invariants', () => {
  it('never lets the last enabled admin be demoted or disabled, and rejects duplicates', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const users = new UserService(db, fakeClock().now);
    const admin = users.create({ username: 'root', passwordHash: 'h', role: 'admin' });
    expect(() => users.create({ username: 'root', passwordHash: 'h', role: 'viewer' })).toThrow(/taken/);
    expect(() => users.update(admin.id, { role: 'viewer' })).toThrow(/At least one/);
    expect(() => users.update(admin.id, { disabled: true })).toThrow(/At least one/);
    const second = users.create({ username: 'second', passwordHash: 'h', role: 'admin' });
    expect(users.update(admin.id, { role: 'viewer' }).role).toBe('viewer');
    expect(() => users.update(second.id, { disabled: true })).toThrow(/At least one/);
    expect(() => users.update('missing-id', { role: 'viewer' })).toThrow(/not found/);
  });
});
