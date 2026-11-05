import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = `dockside-${version}-${stamp}`;
const stage = join(root, 'release', name);
await mkdir(stage, { recursive: true });
const included = [
  'apps/web/dist',
  'apps/api/dist/server.mjs',
  'README.md',
  'ARCHITECTURE.md',
  'qa/overview-light-1440.png',
  'docs',
  '.env.example',
  'scripts/bootstrap.mjs',
  'scripts/sample-stack.mjs',
  'scripts/sample-fixtures.mjs',
];
for (const path of included) {
  await mkdir(dirname(join(stage, path)), { recursive: true });
  await cp(join(root, path), join(stage, path), { recursive: true });
}
await writeFile(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'dockside-release',
      version,
      private: true,
      type: 'module',
      engines: { node: '>=22.13.0' },
      scripts: {
        start: 'node --env-file-if-exists=.env apps/api/dist/server.mjs',
        bootstrap: 'node scripts/bootstrap.mjs',
        sample: 'node scripts/sample-stack.mjs',
      },
    },
    null,
    2,
  ),
);
async function filesIn(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    else result.push(path);
  }
  return result.sort();
}
const files = [];
for (const path of await filesIn(stage)) {
  const data = await readFile(path);
  files.push({
    path: relative(stage, path).replaceAll('\\', '/'),
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
await writeFile(
  join(stage, 'manifest.json'),
  JSON.stringify({ version, builtAt: new Date().toISOString(), files }, null, 2),
);
const archive = join(root, 'release', `${name}.tar.gz`);
const packed = spawnSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit' });
if (packed.status !== 0) throw new Error('tar could not create the release archive.');
const sha256 = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
const manifest = {
  version,
  archive: relative(root, archive).replaceAll('\\', '/'),
  stage: relative(root, stage).replaceAll('\\', '/'),
  bytes: (await stat(archive)).size,
  sha256,
  fileCount: files.length,
};
await writeFile(join(root, 'release', 'latest.json'), JSON.stringify(manifest, null, 2));
await writeFile(`${archive}.sha256`, `${sha256}  ${name}.tar.gz\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
