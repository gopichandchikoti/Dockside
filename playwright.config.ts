import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

process.env.E2E_DIRECTORY ??= resolve(`data/e2e-${randomUUID()}`);
const channel = process.env.E2E_CHANNEL ?? 'msedge';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8181',
    headless: true,
    ...(channel === 'chromium' ? {} : { channel }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/sample-stack.mjs',
    url: 'http://127.0.0.1:8181/healthz',
    reuseExistingServer: false,
    timeout: 30000,
    env: { SAMPLE_DIRECTORY: process.env.E2E_DIRECTORY },
  },
});
