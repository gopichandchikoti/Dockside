import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const template = await readFile(`${root}.env.example`, 'utf8');
const contents = template
  .replace(/^SECRETS_KEY=$/m, `SECRETS_KEY=${randomBytes(36).toString('base64url')}`)
  .replace(/^SETUP_TOKEN=$/m, `SETUP_TOKEN=${randomBytes(24).toString('base64url')}`);
try {
  await writeFile(`${root}.env`, contents, { flag: 'wx', mode: 0o600 });
  process.stdout.write('Created .env with new secrets. Read SETUP_TOKEN there to finish first-run setup.\n');
} catch (error) {
  if (error.code === 'EEXIST') process.stdout.write('.env already exists; no secrets were changed.\n');
  else throw error;
}
