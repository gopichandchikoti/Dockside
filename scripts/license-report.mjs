import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = [];
const missingText = [];
await mkdir('docs/licenses', { recursive: true });
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.includes('node_modules/') || entry.dev || entry.devOptional || entry.link) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const name = `${pkg.name}@${pkg.version}`;
  const files = (await readdir(path)).filter((file) => /^(licen[cs]e|copying|ofl)([.-]|$)/i.test(file));
  const copied = [];
  for (const file of files) {
    const target = `${pkg.name.replaceAll('/', '__').replace('@', '')}-${pkg.version}-${file}`;
    await copyFile(join(path, file), join('docs/licenses', target));
    copied.push(`licenses/${target}`);
  }
  if (!files.length) missingText.push(name);
  notices.push({
    name,
    license: typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? null),
    files: copied,
  });
}
notices.sort((a, b) => a.name.localeCompare(b.name));
const rows = notices.map(
  (n) => `| ${n.name} | ${n.license} | ${n.files.map((p) => `[text](${p})`).join(', ') || 'Metadata only'} |`,
);
const text = [
  '# Third-party notices',
  '',
  'Declared licenses for installed production dependencies and self-hosted fonts.',
  'Original license texts are copied beside this file. This inventory is generated from the locked installed packages.',
  '',
  '| Package | Declared license | License text |',
  '| --- | --- | --- |',
  ...rows,
  '',
  `Packages without a top-level license file: ${missingText.join(', ') || 'none'}.`,
  '',
].join('\n');
await writeFile('docs/THIRD_PARTY_NOTICES.md', text);
process.stdout.write(`${JSON.stringify({ packages: notices.length, missingLicenseText: missingText }, null, 2)}\n`);
