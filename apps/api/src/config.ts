import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(8080, 1, 65535),
  BEHIND_TLS_PROXY: bool,
  TRUSTED_PROXY_HOPS: int(0, 0, 5),
  DATABASE_PATH: z.string().default('./data/dockside.sqlite'),
  SECRETS_KEY: z.string().min(32, 'SECRETS_KEY must be at least 32 characters. Run `npm run bootstrap`.'),
  SETUP_TOKEN: z.string().min(16, 'SETUP_TOKEN must be at least 16 characters.').optional(),
  SCRAPE_INTERVAL_SECONDS: int(15, 5, 600),
  RAW_RETENTION_DAYS: int(3, 1, 30),
  ROLLUP_RETENTION_DAYS: int(90, 1, 730),
  BOOTSTRAP_HOST_NAME: z.string().max(64).optional(),
  BOOTSTRAP_HOST_URL: z.url({ protocol: /^https?$/ }).optional(),
  DOCKER_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  CONTAINER_ACTIONS_ENABLED: bool,
  LOG_TAIL_MAX: int(500, 10, 2000),
  SAMPLE_DATA: bool,
  WEB_DIST: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
  host: string;
  port: number;
  behindTlsProxy: boolean;
  trustedProxyHops: number;
  databasePath: string;
  secretsKey: string;
  setupToken: string | null;
  scrapeIntervalSeconds: number;
  rawRetentionDays: number;
  rollupRetentionDays: number;
  bootstrapHost: { name: string; url: string } | null;
  dockerEndpoint: string | null;
  containerActionsEnabled: boolean;
  logTailMax: number;
  sampleData: boolean;
  webDist: string | null;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value.trim();
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(withoutBlanks(env));
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const e = parsed.data;
  if (Boolean(e.BOOTSTRAP_HOST_NAME) !== Boolean(e.BOOTSTRAP_HOST_URL)) {
    throw new ConfigError(['BOOTSTRAP_HOST_NAME and BOOTSTRAP_HOST_URL must be set together.']);
  }
  if (e.CONTAINER_ACTIONS_ENABLED && !e.DOCKER_ENDPOINT) {
    throw new ConfigError(['CONTAINER_ACTIONS_ENABLED requires DOCKER_ENDPOINT.']);
  }
  return {
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    host: e.HOST,
    port: e.PORT,
    behindTlsProxy: e.BEHIND_TLS_PROXY,
    trustedProxyHops: e.TRUSTED_PROXY_HOPS,
    databasePath: e.DATABASE_PATH,
    secretsKey: e.SECRETS_KEY,
    setupToken: e.SETUP_TOKEN ?? null,
    scrapeIntervalSeconds: e.SCRAPE_INTERVAL_SECONDS,
    rawRetentionDays: e.RAW_RETENTION_DAYS,
    rollupRetentionDays: e.ROLLUP_RETENTION_DAYS,
    bootstrapHost:
      e.BOOTSTRAP_HOST_NAME && e.BOOTSTRAP_HOST_URL ? { name: e.BOOTSTRAP_HOST_NAME, url: e.BOOTSTRAP_HOST_URL } : null,
    dockerEndpoint: e.DOCKER_ENDPOINT ?? null,
    containerActionsEnabled: e.CONTAINER_ACTIONS_ENABLED,
    logTailMax: e.LOG_TAIL_MAX,
    sampleData: e.SAMPLE_DATA,
    webDist: e.WEB_DIST ?? null,
  };
}
