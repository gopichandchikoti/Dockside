import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { fixtureHost, fixtureSession, jsonResponse, renderUI } from '../test/fixtures';
import { AuthProvider } from './session/SessionProvider';
import { AlertsPage } from './alerts/AlertsPage';
import { ChecksPage } from './checks/ChecksPage';
import { ContainersPage } from './containers/ContainersPage';
import { SettingsPage } from './settings/SettingsPage';
import { UsersPage } from './admin/UsersPage';
import { AppShell } from '../components/AppShell';
import { updatePrefs } from '../lib/prefs';
import { SESSION_KEY } from './session/SessionProvider';

beforeEach(() => {
  updatePrefs({ refreshSeconds: 0, theme: 'system' });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.unstubAllGlobals());
describe('role-specific states and rejected workflows', () => {
  it.each(['viewer', 'operator'] as const)(
    'shows only allowed alert controls for %s and pages event history',
    async (role) => {
      const rules = ['ok', 'pending', 'silenced'].map((state, i) => ({
        id: `${fixtureHost.id}-${i}`,
        hostId: fixtureHost.id,
        name: `Rule ${state}`,
        metric: 'cpu_percent',
        operator: 'lt',
        threshold: 50,
        durationSeconds: 60,
        enabled: true,
        state,
        pendingSince: null,
        silencedUntil: null,
        value: null,
      }));
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: 100 - i,
        ruleId: fixtureHost.id,
        ts: '2026-03-01',
        state: 'ok',
        message: 'Recovered sample',
      }));
      vi.stubGlobal(
        'fetch',
        vi.fn((path: string) => Promise.resolve(jsonResponse(path.includes('/events') ? events : rules))),
      );
      renderUI(<AlertsPage />, { role });
      const user = userEvent.setup();
      expect(await screen.findByText('Rule ok')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Notification channels' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Older events' }));
      await user.click(screen.getByRole('button', { name: 'Newest events' }));
    },
  );
  it('shows healthy check history to viewers without run/delete actions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: fixtureHost.id,
            name: 'Sample HTTP',
            kind: 'http',
            target: 'http://sample',
            port: null,
            history: [{ ts: '2026-03-01', ok: true, latencyMs: 1, detail: 'HTTP 200' }],
          },
        ]),
      ),
    );
    renderUI(<ChecksPage />, { role: 'viewer' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'History' }));
    expect(screen.getByRole('table', { name: 'Check history' })).toHaveTextContent('HTTP 200');
    expect(screen.queryByRole('button', { name: 'Run now' })).not.toBeInTheDocument();
  });
  it('keeps a rejected HTTP check draft for correction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init: RequestInit) =>
        Promise.resolve(
          init.method === 'POST'
            ? jsonResponse({ error: { code: 'bad_request', message: 'Target not allowed' } }, 400)
            : jsonResponse([]),
        ),
      ),
    );
    renderUI(<ChecksPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add check' }));
    await user.type(screen.getByLabelText('Check name'), 'Sample HTTP');
    await user.type(screen.getByLabelText('Target URL'), 'http://sample');
    await user.click(screen.getByRole('button', { name: 'Save check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Target not allowed');
    expect(screen.getByLabelText('Check name')).toHaveValue('Sample HTTP');
  });
  it('retries an unreachable Docker request and explains empty logs after recovery', async () => {
    const session = fixtureSession();
    if (session.features) session.features.containerActionsEnabled = true;
    let failed = true;
    const id = 'a'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init: RequestInit) => {
        if (failed) return Promise.reject(new TypeError('Offline'));
        if (init.method === 'POST') return Promise.resolve(jsonResponse({ ok: true }));
        return Promise.resolve(
          jsonResponse(
            path.includes('/logs')
              ? { text: '', nextBefore: null, truncated: false }
              : [
                  {
                    id,
                    name: 'Sample',
                    image: 'sample',
                    state: 'running',
                    status: 'Up',
                    restartCount: 0,
                    cpuPercent: 0,
                    memoryBytes: 0,
                    logsHidden: false,
                  },
                ],
          ),
        );
      }),
    );
    renderUI(
      <AuthProvider session={session}>
        <ContainersPage />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole('alert');
    failed = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(await screen.findByRole('button', { name: 'Restart' }));
    await user.click(screen.getByRole('button', { name: 'Confirm restart' }));
    await user.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('No log output.')).toBeVisible();
  });
  it('preserves a rejected password change and supports preference/theme and sign-out controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        Promise.resolve(
          path.endsWith('/password')
            ? jsonResponse({ error: { code: 'bad_request', message: 'Current password is incorrect.' } }, 400)
            : jsonResponse({
                version: '1.0.0',
                startedAt: '2026-03-01',
                uptimeSeconds: 1,
                schemaVersion: 4,
                components: [],
              }),
        ),
      ),
    );
    renderUI(<SettingsPage />, { role: 'viewer' });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Default refresh interval/), '60');
    await user.type(screen.getByLabelText('Current password'), 'wrong password');
    await user.type(screen.getByLabelText('New password'), 'long sample password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    expect(screen.getByLabelText('New password')).toHaveValue('long sample password');
  });
  it('cycles the shell theme and signs out without leaving cached user data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const { client } = renderUI(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>Sample content</p>} />
        </Route>
      </Routes>,
    );
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /Theme:/ })[0] as HTMLElement);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement);
    await waitFor(() => expect(client.getQueryData(SESSION_KEY)).toMatchObject({ user: null }));
  });
  it('re-enables a disabled user with confirmation', async () => {
    const original = fixtureSession().user;
    if (!original) throw new Error('Missing fixture');
    const user = { ...original, disabled: true };
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init: RequestInit) =>
        Promise.resolve(jsonResponse(init.method === 'PATCH' ? user : [user])),
      ),
    );
    renderUI(<UsersPage />);
    const browser = userEvent.setup();
    await browser.click(await screen.findByRole('button', { name: 'Enable user' }));
    await browser.click(screen.getByRole('button', { name: 'Confirm enable user' }));
  });
});
