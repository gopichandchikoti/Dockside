import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { sampleMetrics, dockerFixture, sampleLogFrame } from './sample-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.SAMPLE_PORT ?? 8181);
const exporterPort = Number(process.env.SAMPLE_EXPORTER_PORT ?? 9187);
const dockerPort = Number(process.env.SAMPLE_DOCKER_PORT ?? 9387);
const folder = process.env.SAMPLE_DIRECTORY ?? `${root}data/sample`;
await mkdir(folder, { recursive: true });
async function secretFile(name) {
  try {
    return await readFile(`${folder}/${name}`, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(36).toString('base64url');
    await writeFile(`${folder}/${name}`, secret, { flag: 'wx', mode: 0o600 });
    return secret;
  }
}
async function requireFree(portNumber) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ port: portNumber, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Port ${portNumber} is already in use.`));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}
for (const p of [port, exporterPort, dockerPort]) await requireFree(p);
const began = Date.now();
const exporter = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.end(sampleMetrics((Date.now() - began) / 1000));
});
const docker = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') {
    res.writeHead(403);
    res.end('Sample fixture is read-only');
    return;
  }
  if (path.endsWith('/logs')) {
    res.end(sampleLogFrame());
    return;
  }
  const data = dockerFixture(path);
  if (!data) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
});
await Promise.all([
  new Promise((r) => exporter.listen(exporterPort, '127.0.0.1', r)),
  new Promise((r) => docker.listen(dockerPort, '127.0.0.1', r)),
]);
const child = spawn(process.execPath, ['apps/api/dist/server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    DATABASE_PATH: `${folder}/dockside.sqlite`,
    WEB_DIST: `${root}apps/web/dist`,
    SECRETS_KEY: await secretFile('encryption-key'),
    SETUP_TOKEN: await secretFile('setup-token'),
    SAMPLE_DATA: 'true',
    SCRAPE_INTERVAL_SECONDS: '5',
    BOOTSTRAP_HOST_NAME: 'Harbour · sample host',
    BOOTSTRAP_HOST_URL: `http://127.0.0.1:${exporterPort}/metrics`,
    DOCKER_ENDPOINT: `http://127.0.0.1:${dockerPort}`,
    CONTAINER_ACTIONS_ENABLED: 'false',
    BEHIND_TLS_PROXY: 'false',
    TRUSTED_PROXY_HOPS: '0',
    LOG_LEVEL: 'warn',
  },
});
process.stdout.write(
  `Sample console: http://127.0.0.1:${port}\nSetup token file: ${folder}/setup-token\nAll measurements are simulated.\n`,
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  exporter.close();
  docker.close();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.once('exit', (code) => {
  stop();
  process.exitCode = code ?? 0;
});
