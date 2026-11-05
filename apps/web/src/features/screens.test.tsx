import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { fixtureHost, fixtureSeries, fixtureSession, jsonResponse, renderUI } from '../test/fixtures';
import { updatePrefs } from '../lib/prefs';
import { OverviewPage } from './overview/OverviewPage';
import { HostPage } from './hosts/HostPage';
import { ContainersPage } from './containers/ContainersPage';
import { ChecksPage } from './checks/ChecksPage';
import { AlertsPage } from './alerts/AlertsPage';
import { UsersPage } from './admin/UsersPage';
import { AuditPage } from './admin/AuditPage';

beforeEach(() => {
  updatePrefs({ refreshSeconds: 0 });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.unstubAllGlobals());
function serve(routes: Record<string, unknown>, mutate?: (path: string, init: RequestInit) => Response | undefined) {
  const mock = vi.fn((url: string, init: RequestInit) => {
    const path = new URL(url, 'http://sample').pathname;
    return Promise.resolve(mutate?.(path, init) ?? jsonResponse(routes[path] ?? []));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
const container = {
  id: 'a'.repeat(64),
  name: 'sample-web',
  image: 'sample/image',
  state: 'running',
  status: 'Up',
  restartCount: 2,
  cpuPercent: 5,
  memoryBytes: 1024,
  logsHidden: false,
};
const rule = {
  id: fixtureHost.id,
  name: 'Memory warning',
  hostId: fixtureHost.id,
  metric: 'memory_percent',
  operator: 'gt',
  threshold: 40,
  durationSeconds: 15,
  enabled: true,
  state: 'firing',
  pendingSince: 0,
  silencedUntil: null,
  value: 50,
};
describe('host workflows', () => {
  it('filters real returned inventory, refreshes and exposes the configured cadence', async () => {
    const mock = serve({ '/api/v1/hosts': [fixtureHost], '/api/v1/alerts/rules': [] });
    renderUI(<OverviewPage />);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Sample NAS' })).toBeVisible();
    await user.type(screen.getByLabelText('Filter hosts or tags'), 'unknown');
    expect(screen.getByText('No matching hosts')).toBeVisible();
    await user.clear(screen.getByLabelText('Filter hosts or tags'));
    await user.selectOptions(screen.getByLabelText('Refresh interval'), '30');
    await user.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(mock.mock.calls.length).toBeGreaterThan(2);
  });
  it('inspects metadata, switches chart ranges, edits and confirms host deletion', async () => {
    const host = {
      ...fixtureHost,
      droppedSeries: 2,
      lastError: 'Exporter delayed',
      filesystems: [{ mount: '/data', device: '/dev/sdb', type: 'ext4', sizeBytes: 10000, availableBytes: 4000 }],
      interfaces: [{ name: 'eth0', receivedBytesPerSecond: 100, sentBytesPerSecond: 50 }],
      sensors: [{ name: 'CPU', celsius: 42 }],
    };
    const routes = { [`/api/v1/hosts/${host.id}`]: host, [`/api/v1/hosts/${host.id}/metrics`]: fixtureSeries };
    serve(routes, (_path, init) =>
      init.method === 'PATCH'
        ? jsonResponse(host)
        : init.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : undefined,
    );
    renderUI(
      <Routes>
        <Route path="/hosts/:id" element={<HostPage />} />
        <Route path="/" element={<p>Inventory returned</p>} />
      </Routes>,
      { path: `/hosts/${host.id}` },
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Sample NAS' })).toBeVisible();
    expect(screen.getByText(/2 series dropped/)).toBeVisible();
    expect(screen.getByRole('table', { name: 'Filesystem capacity' })).toHaveTextContent('/data');
    await user.selectOptions(screen.getByLabelText('Metric'), 'memory_percent');
    await user.selectOptions(screen.getByLabelText('Time range'), '7d');
    await user.click(screen.getByRole('button', { name: 'Edit host' }));
    await user.clear(screen.getByLabelText('Host name'));
    await user.type(screen.getByLabelText('Host name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save host' }));
    await user.click(screen.getByRole('button', { name: 'Delete host' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete host' }));
    expect(await screen.findByText('Inventory returned')).toBeVisible();
  });
  it('explains unavailable sensors and filesystem metadata to a viewer', async () => {
    serve({
      [`/api/v1/hosts/${fixtureHost.id}`]: fixtureHost,
      [`/api/v1/hosts/${fixtureHost.id}/metrics`]: fixtureSeries,
    });
    renderUI(
      <Routes>
        <Route path="/hosts/:id" element={<HostPage />} />
      </Routes>,
      { role: 'viewer', path: `/hosts/${fixtureHost.id}` },
    );
    expect(await screen.findByText('This exporter does not expose temperature sensors.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit host' })).not.toBeInTheDocument();
  });
});
describe('container and check workflows', () => {
  it('reads and paginates container logs, keeping restarts disabled', async () => {
    const cursor = '1772366400.000000000';
    serve({
      '/api/v1/containers': [container],
      [`/api/v1/containers/${container.id}/logs`]: { text: 'SAMPLE log output', nextBefore: cursor, truncated: true },
    });
    renderUI(<ContainersPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Logs' }));
    expect(await screen.findByLabelText('Container logs')).toHaveTextContent('SAMPLE log output');
    expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Older logs' }));
    await user.click(screen.getByRole('button', { name: 'Latest logs' }));
    await user.click(screen.getByRole('button', { name: 'Close logs' }));
    expect(screen.queryByLabelText('Container logs')).not.toBeInTheDocument();
  });
  it('hides log controls for viewers and handles an empty container list', async () => {
    const routes = { '/api/v1/containers': [{ ...container, state: 'exited', cpuPercent: null, restartCount: null }] };
    serve(routes);
    const { client } = renderUI(<ContainersPage />, { role: 'viewer' });
    expect(await screen.findByText(/exited/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Logs' })).not.toBeInTheDocument();
    routes['/api/v1/containers'] = [];
    await client.invalidateQueries();
    expect(await screen.findByText('No visible containers')).toBeVisible();
  });
  it('creates a TCP check, runs it, views history and deletes it', async () => {
    const routes: Record<string, unknown> = { '/api/v1/checks': [] };
    const check = {
      id: fixtureHost.id,
      name: 'Sample service',
      kind: 'tcp',
      target: 'sample.local',
      port: 80,
      history: [] as unknown[],
    };
    serve(routes, (path, init) => {
      if (init.method === 'POST' && path.endsWith('/run')) {
        check.history = [{ ts: '2026-03-01', ok: false, latencyMs: 5, detail: 'Unavailable' }];
        return jsonResponse(check);
      }
      if (init.method === 'POST') {
        routes['/api/v1/checks'] = [check];
        return jsonResponse(check, 201);
      }
      if (init.method === 'DELETE') {
        routes['/api/v1/checks'] = [];
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    renderUI(<ChecksPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('Keep an eye on a service')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add check' }));
    await user.type(screen.getByLabelText('Check name'), 'Sample service');
    await user.selectOptions(screen.getByLabelText('Protocol'), 'tcp');
    await user.type(screen.getByLabelText('Target hostname'), 'sample.local');
    await user.type(screen.getByLabelText('Port'), '80');
    await user.click(screen.getByRole('button', { name: 'Save check' }));
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('table', { name: 'Check history' })).toHaveTextContent('Unavailable');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(await screen.findByText('Keep an eye on a service')).toBeVisible();
  });
});
describe('alerts and administration', () => {
  it('acknowledges, silences, edits and deletes a host-scoped alert', async () => {
    const routes: Record<string, unknown> = {
      '/api/v1/hosts': [fixtureHost],
      '/api/v1/alerts/rules': [rule],
      '/api/v1/alerts/events': [
        { id: 1, ruleId: rule.id, ts: '2026-03-01', state: 'firing', message: 'Memory warning: firing' },
      ],
      '/api/v1/alerts/channels': [],
    };
    serve(routes, (_path, init) =>
      init.method === 'DELETE'
        ? ((routes['/api/v1/alerts/rules'] = []), new Response(null, { status: 204 }))
        : undefined,
    );
    renderUI(<AlertsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await user.click(screen.getByRole('button', { name: 'Silence 1h' }));
    await user.click(screen.getByRole('button', { name: 'Confirm silence 1h' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Rule name'));
    await user.type(screen.getByLabelText('Rule name'), 'Edited warning');
    await user.selectOptions(screen.getByLabelText('Metric'), 'cpu_percent');
    await user.selectOptions(screen.getByLabelText('Condition'), 'lt');
    await user.clear(screen.getByLabelText('Threshold (%)'));
    await user.type(screen.getByLabelText('Threshold (%)'), '20');
    await user.clear(screen.getByLabelText('Duration (seconds)'));
    await user.type(screen.getByLabelText('Duration (seconds)'), '0');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit rule' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Delete rule' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete rule' }));
    expect(await screen.findByText('A quieter watch')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    await user.type(screen.getByLabelText('Rule name'), 'New alert');
    await user.selectOptions(screen.getByLabelText('Host'), fixtureHost.id);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
  });
  it('creates a masked ntfy channel and removes it', async () => {
    const routes: Record<string, unknown> = {
      '/api/v1/alerts/rules': [],
      '/api/v1/alerts/events': [],
      '/api/v1/alerts/channels': [],
    };
    serve(routes, (path, init) => {
      if (init.method === 'POST' && path.endsWith('/channels')) {
        routes[path] = [
          {
            id: fixtureHost.id,
            name: 'Sample ntfy',
            kind: 'ntfy',
            url: '[encrypted]',
            token: '[masked]',
            lastDelivery: 'Delivered',
          },
        ];
        return jsonResponse({});
      }
      if (init.method === 'DELETE') {
        routes['/api/v1/alerts/channels'] = [];
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    renderUI(<AlertsPage />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Add notification channel'));
    await user.type(screen.getByLabelText('Channel name'), 'Sample ntfy');
    await user.selectOptions(screen.getByLabelText('Channel type'), 'ntfy');
    await user.type(screen.getByLabelText('Destination URL'), 'http://sample/notifications');
    await user.type(screen.getByLabelText('Bearer token (optional)'), 'test token');
    await user.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(await screen.findByText('Sample ntfy · ntfy')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Delete channel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete channel' }));
    expect(await screen.findByText('No notification channels configured.')).toBeVisible();
  });
  it('creates a viewer and changes the selected user role with confirmation', async () => {
    const admin = fixtureSession().user;
    if (!admin) throw new Error('Fixture user absent');
    const routes: Record<string, unknown> = { '/api/v1/users': [admin] };
    serve(routes, (_path, init) =>
      init.method === 'POST' || init.method === 'PATCH' ? jsonResponse(admin) : undefined,
    );
    renderUI(<UsersPage />);
    const user = userEvent.setup();
    await screen.findByRole('table', { name: 'User administration' });
    await user.selectOptions(screen.getByLabelText('Role for admin'), 'operator');
    await user.click(screen.getByRole('button', { name: 'Apply role' }));
    await user.click(screen.getByRole('button', { name: 'Confirm apply role' }));
    await user.click(screen.getByRole('button', { name: 'Disable user' }));
    await user.click(screen.getByRole('button', { name: 'Confirm disable user' }));
    await user.type(screen.getByLabelText('Username'), 'sample-viewer');
    await user.type(screen.getByLabelText('Initial password'), 'long sample password');
    await user.selectOptions(screen.getByLabelText('Role', { exact: true }), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(screen.getByLabelText('Username')).toHaveValue(''));
  });
  it('reads audit entries and paginates without exposing secret details', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: 101 - i,
      ts: '2026-03-01',
      actorName: i ? 'operator' : null,
      action: 'container.restart',
      outcome: i ? 'success' : 'denied',
      targetId: null,
    }));
    const mock = serve({ '/api/v1/audit': rows });
    renderUI(<AuditPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('Signed-out request')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Older entries' }));
    await user.click(screen.getByRole('button', { name: 'Newest entries' }));
    expect(mock.mock.calls.some(([path]) => path.includes('before='))).toBe(true);
    expect(within(screen.getByRole('table')).getAllByText('container.restart')).toHaveLength(100);
  });
});
