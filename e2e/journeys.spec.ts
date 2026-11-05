import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const password = 'sample browser passphrase';
const errors: string[] = [];
test.describe.configure({ mode: 'serial' });
test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});
async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/login-desktop.png', fullPage: true });
  await page.getByLabel('Username', { exact: true }).fill('browser-admin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}
test('first run, login, add host, chart, checks, firing alert, logs and default restart denial', async ({ page }) => {
  await mkdir('qa', { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Dockside' })).toBeVisible();
  await page.screenshot({ path: 'qa/setup-desktop.png', fullPage: true });
  await page
    .getByLabel('Setup token', { exact: true })
    .fill(await readFile(`${process.env.E2E_DIRECTORY}/setup-token`, 'utf8'));
  await page.getByLabel('Admin username').fill('browser-admin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByText('Sample data mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add host', exact: true }).click();
  await page.getByLabel('Host name').fill('Workshop · sample');
  await page.getByLabel('Exporter URL').fill('http://127.0.0.1:9187/metrics');
  await page.getByLabel('Tags', { exact: true }).fill('home, workshop');
  await page.getByRole('button', { name: 'Connect host', exact: true }).click();
  await page.getByRole('link', { name: 'Workshop · sample', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Measurement history' })).toBeVisible();
  await page.getByRole('group', { name: /use arrow keys/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'View as table' }).click();
  await expect(page.getByRole('region', { name: 'Chart data table' })).toBeVisible();
  await page.getByRole('button', { name: 'View as chart' }).click();
  await page.screenshot({ path: 'qa/host-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Checks', exact: true }).click();
  await page.getByRole('button', { name: 'Add check' }).click();
  await page.getByLabel('Check name').fill('Sample exporter');
  await page.getByLabel('Target URL').fill('http://127.0.0.1:9187/metrics');
  await page.getByRole('button', { name: 'Save check' }).click();
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByText(/Healthy/)).toBeVisible();
  await page.getByRole('link', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Sample memory threshold');
  await page.getByLabel('Host', { exact: true }).selectOption({ label: 'Workshop · sample' });
  await page.getByLabel('Metric', { exact: true }).selectOption('memory_percent');
  await page.getByLabel('Threshold (%)').fill('0');
  await page.getByLabel('Duration (seconds)').fill('0');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('△ firing', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.getByText('△ acknowledged', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/alerts-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Containers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  await expect(page.getByLabel('Container logs')).toContainText('SAMPLE');
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await signIn(page);
});
test('desktop/mobile light/dark, accessibility, reduced motion and text scaling', async ({ page, browserName }) => {
  await signIn(page);
  const evidence: unknown[] = [];
  const hostPath = await page.getByRole('link', { name: /^Workshop/ }).getAttribute('href');
  const screens = [
    ['overview', '/'],
    ['host', hostPath ?? '/'],
    ['containers', '/containers'],
    ['checks', '/checks'],
    ['alerts', '/alerts'],
    ['settings', '/settings'],
  ];
  for (const theme of ['light', 'dark']) {
    await page.goto('/settings');
    await page.getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click();
    await page.getByRole('radio', { name: 'Reduce', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
    expect(
      await page
        .locator('.btn')
        .first()
        .evaluate((element) =>
          getComputedStyle(element)
            .transitionDuration.split(',')
            .every((duration) => parseFloat(duration) < 0.001),
        ),
    ).toBe(true);
    for (const [name, path] of screens) {
      await page.goto(path ?? '/');
      await expect(page.getByText('Sample data mode', { exact: true })).toBeVisible();
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 800 : 1000 });
        await page.screenshot({ path: `qa/${name}-${theme}-${width}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () => {
          const checker = (window as unknown as { axe: typeof axe }).axe;
          return checker.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
          });
        });
        evidence.push({ screen: name, theme, width, browserName, violations: result.violations });
        expect(result.violations).toEqual([]);
      }
    }
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await page.screenshot({ path: 'qa/text-scaling-320.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const performance = await page.evaluate(() => {
    const nav = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      domContentLoadedMs: nav.domContentLoadedEventEnd - nav.startTime,
      loadMs: nav.loadEventEnd - nav.startTime,
      transferBytes: nav.transferSize,
      userAgent: navigator.userAgent,
    };
  });
  const fontPolicyBlocks = errors.filter(
    (message) => message.startsWith("Loading the font 'data:font/woff2;") && message.includes("font-src 'self'"),
  );
  const applicationErrors = errors.filter((message) => !fontPolicyBlocks.includes(message));
  await writeFile(
    'qa/browser-evidence.json',
    JSON.stringify(
      {
        accessibility: evidence,
        performance,
        consoleErrors: applicationErrors,
        fontPolicyBlocks: fontPolicyBlocks.map((m) =>
          m.replace(/data:font\/woff2;base64,[^']+/, 'data:font/woff2;base64,[omitted]'),
        ),
      },
      null,
      2,
    ) + '\n',
  );
  expect(applicationErrors).toEqual([]);
});
