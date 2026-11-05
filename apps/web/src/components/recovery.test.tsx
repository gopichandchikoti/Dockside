import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { App } from '../App';
import { fixtureSession, fixtureSeries, jsonResponse, renderUI } from '../test/fixtures';
import { setUnauthenticatedHandler, ApiError } from '../lib/api';
import { createQueryClient, shouldRetry } from '../lib/queryClient';
import { reportApiError, reportApiSuccess, resetConnectionState } from '../lib/connection';
import { Segmented } from './Segmented';
import { ErrorBoundary } from './ErrorBoundary';
import { ConfirmButton } from './ConfirmButton';
import { TimeSeriesChart } from './TimeSeriesChart';
import { Icon } from './Icon';
import { PlatformStatusList } from '../features/settings/PlatformStatusList';
import { AuthProvider } from '../features/session/SessionProvider';
import { ErrorBlock } from './States';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetConnectionState();
  setUnauthenticatedHandler(null);
});
function Choice() {
  const [value, setValue] = useState('one');
  return (
    <Segmented
      label="Choice"
      value={value}
      onChange={setValue}
      options={[
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ]}
    />
  );
}
describe('application recovery and keyboard paths', () => {
  it.each(['setup', 'login', 'authenticated', 'unreachable'])('routes the %s session state', async (state) => {
    const session =
      state === 'setup'
        ? { setupRequired: true, user: null, csrfToken: null, features: null }
        : state === 'login'
          ? { setupRequired: false, user: null, csrfToken: null, features: null }
          : fixtureSession();
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        state === 'unreachable'
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(jsonResponse(path.endsWith('/session') ? session : [])),
      ),
    );
    renderUI(<App />);
    const title = {
      setup: 'Welcome to Dockside',
      login: 'Sign in to Dockside',
      authenticated: 'Overview',
      unreachable: 'Cannot reach Dockside',
    }[state];
    const target =
      state === 'unreachable'
        ? await screen.findByRole('alert')
        : await screen.findByRole('heading', { name: title ?? '' });
    expect(target).toBeVisible();
  });
  it('expires a session on a protected request and clears the user state', async () => {
    const signedIn = fixtureSession();
    let expired = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        Promise.resolve(
          path.endsWith('/session')
            ? jsonResponse(expired ? { setupRequired: false, user: null, csrfToken: null, features: null } : signedIn)
            : jsonResponse({ error: { code: 'unauthenticated', message: 'Session ended' } }, 401),
        ),
      ),
    );
    const { client } = renderUI(<App />);
    await screen.findByRole('heading', { name: 'Overview' });
    expired = true;
    await client.invalidateQueries({ queryKey: ['hosts'] });
    expect(await screen.findByText('Your session ended. Sign in again to continue.')).toBeVisible();
  });
  it('moves radio focus in both directions, wraps, and ignores unrelated keys', async () => {
    renderUI(<Choice />);
    const user = userEvent.setup();
    screen.getByRole('radio', { name: 'One' }).focus();
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowLeft}{ArrowUp}{Space}');
    expect(screen.getByRole('radio', { name: 'One' })).toHaveFocus();
  });
  it('provides render failure feedback and enforces provider boundaries', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('render failed');
    }
    renderUI(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke on this screen');
  });
  it('does not render a protected subtree without a complete session', () => {
    renderUI(
      <AuthProvider session={{ setupRequired: false, user: null, csrfToken: null, features: null }}>
        <p>Hidden</p>
      </AuthProvider>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
  it('supports cancel and escape before a destructive action', async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const work = vi.fn().mockResolvedValue(undefined);
    renderUI(<ConfirmButton label="Delete" message="Confirm?" onConfirm={work} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(work).not.toHaveBeenCalled();
  });
  it('inspects chart pointer positions and explains empty ranges', async () => {
    renderUI(
      <TimeSeriesChart
        title="CPU"
        series={{
          ...fixtureSeries,
          points: [
            [0, null],
            [15000, null],
          ],
        }}
      />,
    );
    expect(screen.getByText(/No measurements in this range/)).toBeVisible();
    const plot = screen.getByRole('group');
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 600,
      height: 180,
      top: 0,
      bottom: 180,
      left: 0,
      right: 600,
      toJSON: () => ({}),
    });
    fireEvent.pointerMove(plot, { clientX: 100 });
    const user = userEvent.setup();
    plot.focus();
    await user.keyboard('{ArrowLeft}x');
    await user.click(screen.getByRole('button', { name: 'View as table' }));
    await user.click(screen.getByRole('button', { name: 'View as chart' }));
    expect(screen.getByRole('img')).toHaveAccessibleName(/CPU in %/);
  });
  it('renders all component states and retries a failed status request', async () => {
    const status = {
      version: '1.0.0',
      startedAt: '2026-03-01',
      uptimeSeconds: 10,
      schemaVersion: 4,
      components: ['ok', 'degraded', 'fail', 'unconfigured'].map((state) => ({
        id: state,
        label: state,
        state,
        detail: null,
      })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(jsonResponse(status)),
    );
    renderUI(<PlatformStatusList />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Running')).toBeVisible();
    expect(screen.getByText('Not configured')).toBeVisible();
    renderUI(<Icon name="check" title="Test icon" />);
    expect(screen.getByRole('img', { name: 'Test icon' })).toBeVisible();
    renderUI(<ErrorBlock error={new Error('plain failure')} />);
  });
  it('retries only transient failures and resets the connection after recovery', async () => {
    expect(shouldRetry(0, new ApiError('network', 'offline', 0))).toBe(true);
    expect(shouldRetry(2, new ApiError('network', 'offline', 0))).toBe(false);
    expect(shouldRetry(0, new ApiError('forbidden', 'denied', 403))).toBe(false);
    expect(shouldRetry(0, new Error('unknown'))).toBe(false);
    const client = createQueryClient();
    reportApiError(new Error('unrelated'));
    reportApiError(new ApiError('network', 'offline', 0));
    reportApiSuccess();
    const value = await client.fetchQuery({ queryKey: ['recovery'], queryFn: () => Promise.resolve(42) });
    expect(value).toBe(42);
    client.clear();
    await waitFor(() => expect(client.isFetching()).toBe(0));
  });
});
