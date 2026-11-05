import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const latest = JSON.parse(await readFile(join(root, 'release/latest.json'), 'utf8'));
const archive = resolve(root, latest.archive);
const hash = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
if (hash !== latest.sha256) throw new Error('Release archive hash mismatch.');
const folder = await mkdtemp(join(tmpdir(), 'dockside-release-'));
if (spawnSync('tar', ['-xzf', archive, '-C', folder]).status !== 0) throw new Error('Could not extract release.');
const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
let sourceFilesMatched = 0;
for (const item of manifest.files) {
  const bytes = await readFile(join(folder, item.path));
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256)
    throw new Error(`File hash mismatch: ${item.path}`);
  if (item.path !== 'package.json') {
    const source = await readFile(join(root, item.path));
    if (!bytes.equals(source))
      throw new Error(`Release does not match the current build or documentation: ${item.path}`);
    sourceFilesMatched += 1;
  }
}
function bootstrap() {
  const result = spawnSync(process.execPath, ['scripts/bootstrap.mjs'], { cwd: folder, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Packaged bootstrap failed.');
}
bootstrap();
const environment = await readFile(join(folder, '.env'), 'utf8');
bootstrap();
if ((await readFile(join(folder, '.env'), 'utf8')) !== environment)
  throw new Error('Packaged bootstrap overwrote existing secrets.');
const { SETUP_TOKEN: setupToken, SECRETS_KEY: secretsKey } = parseEnv(environment);
if (!setupToken || !secretsKey) throw new Error('Packaged bootstrap did not generate secrets.');
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise((done) => server.close(done));
  return address.port;
}
const port = await freePort();
const serverOptions = {
  cwd: folder,
  stdio: 'ignore',
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: join(folder, 'smoke.sqlite'),
    WEB_DIST: join(folder, 'apps/web/dist'),
    SECRETS_KEY: secretsKey,
    SETUP_TOKEN: setupToken,
    BOOTSTRAP_HOST_NAME: '',
    BOOTSTRAP_HOST_URL: '',
    DOCKER_ENDPOINT: '',
    SAMPLE_DATA: 'false',
    CONTAINER_ACTIONS_ENABLED: 'false',
    BEHIND_TLS_PROXY: 'false',
    TRUSTED_PROXY_HOPS: '0',
  },
};
let child;
function startServer() {
  child = spawn(process.execPath, ['--env-file=.env', 'apps/api/dist/server.mjs'], serverOptions);
}
async function stopServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
const base = `http://127.0.0.1:${port}`;
const request = (path, options) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const healthy = await request('/readyz')
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Packaged API exited before readiness.');
    await pause(100);
  }
  throw new Error('Packaged API did not become ready.');
}
const username = 'archive-admin';
const password = randomBytes(24).toString('base64url');
async function authenticate(path, body) {
  const response = await request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Packaged authentication failed: ${path} (${response.status}).`);
  const session = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie || !session.csrfToken || session.user?.username !== username || session.setupRequired)
    throw new Error('Packaged authentication returned an incomplete session.');
  return { cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
}
startServer();
try {
  await ready();
  const index = await request('/');
  const html = await index.text();
  if (!index.ok || !html.includes('<title>Dockside</title>')) throw new Error('Packaged UI root failed.');
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (assets.length < 2) throw new Error('Packaged UI is missing script or stylesheet references.');
  for (const asset of assets) if (!(await request(asset)).ok) throw new Error(`Asset failed: ${asset}`);
  if ((await request('/api/v1/hosts')).status !== 401) throw new Error('Packaged data endpoint is not protected.');
  const session = await (await request('/api/v1/session')).json();
  if (!session.setupRequired) throw new Error('Packaged first-run setup was not available.');
  const headers = await authenticate('/api/v1/setup', { setupToken, username, password });
  const draft = { name: 'Archive health check', kind: 'http', target: `${base}/healthz` };
  const denied = await request('/api/v1/checks', {
    method: 'POST',
    headers: { cookie: headers.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (denied.status !== 403) throw new Error('Packaged mutation accepted a missing CSRF token.');
  const created = await request('/api/v1/checks', { method: 'POST', headers, body: JSON.stringify(draft) });
  if (created.status !== 201) throw new Error('Packaged authenticated check creation failed.');
  const check = await created.json();
  const executed = await request(`/api/v1/checks/${check.id}/run`, { method: 'POST', headers, body: '{}' });
  if (!executed.ok || !(await executed.json()).history.some((item) => item.ok))
    throw new Error('Packaged HTTP check did not record a successful result.');
  const logout = await request('/api/v1/logout', { method: 'POST', headers, body: '{}' });
  if (logout.status !== 204) throw new Error('Packaged logout failed.');
  if ((await request('/api/v1/checks', { headers })).status !== 401)
    throw new Error('Packaged logout did not revoke the session.');
  await stopServer();
  startServer();
  await ready();
  const restoredHeaders = await authenticate('/api/v1/login', { username, password });
  const restored = await request('/api/v1/checks', { headers: restoredHeaders });
  if (!restored.ok) throw new Error('Packaged saved checks were unavailable after restart.');
  const checks = await restored.json();
  if (!checks.some((item) => item.id === check.id && item.name === draft.name && item.history.some((h) => h.ok)))
    throw new Error('Packaged check configuration or history did not survive restart.');
  const result = {
    version: latest.version,
    archive: latest.archive,
    sha256: hash,
    verifiedFiles: manifest.files.length,
    sourceFilesMatched,
    health: 'ready',
    ui: 'served',
    assets: assets.length,
    unauthenticatedHosts: 401,
    bootstrap: 'created secrets and preserved them on repeat',
    setup: 'administrator created',
    csrf: 'missing token rejected with 403',
    check: 'created and ran successfully',
    logout: 'session revoked',
    restart: 'account, check and history persisted; login succeeded',
    node: process.version,
    platform: process.platform,
    checkedAt: new Date().toISOString(),
  };
  await mkdir(join(root, 'qa'), { recursive: true });
  await writeFile(join(root, 'qa/release-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await stopServer();
}
