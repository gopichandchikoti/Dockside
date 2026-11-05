import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const COST = 2 ** 15;
const BLOCK = 8;
const PARALLEL = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 96 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

let defaultCost = COST;

/** Test-only hook: lets the suite use a cheap scrypt cost. Hashes embed their cost, so verification still works. */
export function setPasswordCostForTests(cost: number): void {
  defaultCost = cost;
}

export async function hashPassword(password: string, cost: number = defaultCost): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N: cost, r: BLOCK, p: PARALLEL, maxmem: MAX_MEMORY });
  return ['scrypt', cost, BLOCK, PARALLEL, salt.toString('base64'), key.toString('base64')].join('$');
}

function parseHash(stored: string) {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return null;
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY };
  if (![options.N, options.r, options.p].every((v) => Number.isInteger(v) && v > 0)) return null;
  return { options, salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.options);
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/** Burns equivalent CPU for unknown usernames so response time does not reveal which accounts exist. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dockside-dummy-password');
  await verifyPassword(password, await dummyHash);
}
