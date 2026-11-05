import { can, type Role, type SessionInfo } from '@dockside/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../features/session/SessionProvider';

export const fixtureHost = {
  id: 'b90f91d0-8d9d-4831-9c4e-73c2af5d71ea',
  name: 'Sample NAS',
  metricsUrl: 'http://sample:9100/metrics',
  tags: ['home'],
  isSample: true,
  status: 'online' as const,
  lastSuccessAt: '2026-03-01T12:00:00Z',
  lastError: null,
  failures: 0,
  droppedSeries: 0,
  latest: { cpu_percent: 25, memory_percent: 50, uptime_seconds: 1234, load1: 1.2 },
  filesystems: [],
  interfaces: [],
  sensors: [],
  sparkline: [null, 10, 25],
};
export const fixtureSeries = {
  metric: 'cpu_percent' as const,
  unit: '%',
  cadenceSeconds: 15,
  source: 'SAMPLE node_exporter',
  points: [
    [0, 10],
    [15000, null],
    [30000, 20],
  ] as [number, number | null][],
};
export function fixtureSession(role: Role = 'admin'): SessionInfo {
  return {
    setupRequired: false,
    csrfToken: 'test-csrf',
    user: { id: 'test-admin', username: 'admin', role, disabled: false, createdAt: '2026-03-01', lastLoginAt: null },
    features: {
      containerActionsEnabled: false,
      dockerConfigured: true,
      sampleData: true,
      rawRetentionDays: 3,
      rollupRetentionDays: 90,
      scrapeIntervalSeconds: 15,
      logTailMax: 500,
    },
  };
}
export function renderUI(element: ReactNode, options: { role?: Role; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const session = fixtureSession(options.role);
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.path ?? '/']}>
        <AuthProvider session={session}>{element}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...result,
    client,
    allowed: (permission: Parameters<typeof can>[1]) => can(options.role ?? 'admin', permission),
  };
}
export const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
