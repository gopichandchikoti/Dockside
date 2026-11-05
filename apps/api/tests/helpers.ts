import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppOptions } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import { createContext, type AppContext, type ComponentProbe } from '../src/context';
import { openDatabase } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { setPasswordCostForTests } from '../src/domain/password';

setPasswordCostForTests(2 ** 10);

export const SETUP_TOKEN = 'test-setup-token-0123456789';
export const ADMIN_PASSWORD = 'correct horse battery staple';

export interface FakeClock {
  now: () => Date;
  advance: (ms: number) => void;
}

export function fakeClock(start = '2026-03-01T12:00:00.000Z'): FakeClock {
  let current = Date.parse(start);
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SECRETS_KEY: 'test-secrets-key-that-is-long-enough-0123456789',
    SETUP_TOKEN,
    DATABASE_PATH: ':memory:',
  });
  return { ...base, ...overrides };
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  clock: FakeClock;
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: AppOptions & { probes?: ComponentProbe[] } = {},
  clock: FakeClock = fakeClock(),
): Promise<TestApp> {
  const config = testConfig(overrides);
  const db = openDatabase(':memory:');
  migrate(db);
  const ctx = createContext(config, db, clock.now);
  ctx.components.push(...(options.probes ?? []));
  const app = await buildApp(ctx, options);
  await app.ready();
  return { app, ctx, clock };
}

export interface Session {
  cookie: string;
  csrf: string;
  headers: Record<string, string>;
}

export function sessionFrom(res: LightMyRequestResponse): Session {
  const set = res.cookies.find((c) => c.name.endsWith('dockside_sid') || c.name === '__Host-dockside');
  if (!set) throw new Error(`No session cookie in response: ${res.body}`);
  const body = res.json<{ csrfToken: string }>();
  const cookie = `${set.name}=${set.value}`;
  return { cookie, csrf: body.csrfToken, headers: { cookie, 'x-csrf-token': body.csrfToken } };
}

export async function setupAdmin(app: FastifyInstance, username = 'admin'): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    payload: { setupToken: SETUP_TOKEN, username, password: ADMIN_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  return sessionFrom(res);
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return sessionFrom(res);
}

/** Creates a user directly in the database (bypassing HTTP) and returns a logged-in session. */
export async function seedUser(
  { app, ctx }: TestApp,
  username: string,
  role: 'viewer' | 'operator' | 'admin',
): Promise<Session> {
  const { hashPassword } = await import('../src/domain/password');
  ctx.users.create({ username, passwordHash: await hashPassword(ADMIN_PASSWORD), role });
  return login(app, username, ADMIN_PASSWORD);
}
