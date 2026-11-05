import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const config = load(await readFile('compose.yaml', 'utf8'));
const { services, networks } = config;
const checks = {
  proxyHasNoPublishedPorts: !services['docker-proxy'].ports,
  proxyNetworkIsInternal: networks.engine.internal === true,
  proxyIsOnlySocketMount: Object.entries(services).every(
    ([name, service]) =>
      name === 'docker-proxy' || !(service.volumes ?? []).some((v) => String(v).includes('docker.sock')),
  ),
  socketMountIsReadOnly: services['docker-proxy'].volumes.some((v) => v.endsWith('docker.sock:ro')),
  apiBindsLoopback: services.api.ports.every((p) => p.startsWith('127.0.0.1:')),
  exporterUsesHostNamespaces:
    services['node-exporter'].pid === 'host' && services['node-exporter'].network_mode === 'host',
  exporterRootIsReadOnly: services['node-exporter'].volumes.includes('/:/host:ro,rslave'),
};
if (Object.values(checks).some((value) => !value)) throw new Error('Deployment static check failed.');
await mkdir('qa', { recursive: true });
await writeFile(
  'qa/deploy-static.json',
  JSON.stringify({ checks, scope: 'YAML structure only; Docker not run' }, null, 2) + '\n',
);
process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
