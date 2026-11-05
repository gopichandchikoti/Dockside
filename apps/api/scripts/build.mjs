// Bundles the API (plus @dockside/shared and npm dependencies) into one ESM file so the runtime image needs only Node.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(`${root}dist`, { recursive: true });

await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${root}dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  minify: false,
  legalComments: 'none',
  external: ['node:*'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

writeFileSync(`${root}dist/package.json`, JSON.stringify({ type: 'module' }));
