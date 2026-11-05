import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ConfirmButton } from './ConfirmButton';
import { TimeSeriesChart, chartPath } from './TimeSeriesChart';
import { ApiError } from '../lib/api';
import { reportApiError, resetConnectionState } from '../lib/connection';
import { updatePrefs } from '../lib/prefs';
import { fixtureSeries, jsonResponse, renderUI } from '../test/fixtures';
import { SettingsPage } from '../features/settings/SettingsPage';
import { OverviewPage } from '../features/overview/OverviewPage';

beforeEach(() => {
  updatePrefs({ refreshSeconds: 0, theme: 'system', motion: 'system' });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetConnectionState();
});
describe('connected component workflows', () => {
  it('changes theme and motion, and changes a password through the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          version: '1.0.0',
          startedAt: '2026-03-01',
          uptimeSeconds: 0,
          schemaVersion: 4,
          components: [],
        }),
      ),
    );
    renderUI(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('radio', { name: 'Reduce' }));
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduce');
    await user.type(screen.getByLabelText('Current password'), 'old test password');
    await user.type(screen.getByLabelText('New password'), 'new test password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Password changed/)).toBeVisible();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
  it('shows a persistent sample banner, a disconnected notice after repeated failures, then recovers', () => {
    renderUI(
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Outlet />} />
        </Route>
      </Routes>,
    );
    expect(screen.getByText('Sample data mode')).toBeVisible();
    act(() => {
      reportApiError(new ApiError('network', 'Offline', 0));
      reportApiError(new ApiError('network', 'Offline', 0));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Disconnected');
    act(resetConnectionState);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('requires confirmation, displays a rejected action and supports retry', async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error('Proxy denied')).mockResolvedValueOnce(undefined);
    renderUI(<ConfirmButton label="Restart" message="Restart this service?" onConfirm={work} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    expect(work).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm restart' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Proxy denied');
    await user.click(screen.getByRole('button', { name: 'Confirm restart' }));
    expect(work).toHaveBeenCalledTimes(2);
  });
  it('preserves chart gaps and exposes keyboard and table alternatives', async () => {
    const path = chartPath(fixtureSeries.points, { min: 0, max: 20 });
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain('L');
    renderUI(<TimeSeriesChart series={fixtureSeries} title="CPU" />);
    const user = userEvent.setup();
    const plot = screen.getByRole('group');
    plot.focus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('status')).toHaveTextContent('10.00 %');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('No sample');
    await user.keyboard('{End}');
    expect(screen.getByRole('status')).toHaveTextContent('20.00 %');
    await user.click(screen.getByRole('button', { name: 'View as table' }));
    expect(screen.getByRole('table')).toHaveTextContent('No sample');
  });
  it('shows an empty inventory and a useful failed-save message without losing user input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? jsonResponse({ error: { code: 'bad_request', message: 'Exporter URL rejected' } }, 400)
            : jsonResponse([]),
        ),
      ),
    );
    renderUI(<OverviewPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('Your first host, a few seconds away')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add host' }));
    await user.type(screen.getByLabelText('Host name'), 'Sample server');
    await user.type(screen.getByLabelText('Exporter URL'), 'http://sample:9100/metrics');
    await user.click(screen.getByRole('button', { name: 'Connect host' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Exporter URL rejected');
    expect(screen.getByLabelText('Host name')).toHaveValue('Sample server');
  });
});
