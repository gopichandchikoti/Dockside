import { HostsSchema, RulesSchema, type Host, type AlertRule } from '@dockside/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '../../components/DataTable';
import { QueryState } from '../../components/QueryState';
import { RefreshControl } from '../../components/RefreshControl';
import { EmptyState, ErrorBlock, PageHead } from '../../components/States';
import { api } from '../../lib/api';
import { formatAgo, formatPercent, formatRate } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { HostForm } from '../hosts/HostForm';
import { useAuth } from '../session/SessionProvider';

function Sparkline({ values }: { values: (number | null)[] }) {
  const paths: string[] = [];
  let path = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (path) paths.push(path);
      path = '';
    } else path += `${i * 4},${30 - v * 0.25} `;
  });
  if (path) paths.push(path);
  return (
    <svg width="100" height="36" viewBox="0 0 100 36" aria-label="Recent CPU trend" role="img">
      {paths.map((p, i) => (
        <polyline key={i} points={p} className="sparkline" />
      ))}
    </svg>
  );
}
const columns: Column<Host>[] = [
  {
    key: 'name',
    label: 'Host / tags',
    render: (h) => (
      <>
        <Link className="row-link" to={`/hosts/${h.id}`}>
          {h.name}
        </Link>
        <div className="row muted small">
          {h.isSample ? <span className="chip sample-badge">Sample</span> : null}
          {h.tags.join(' · ')}
        </div>
      </>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (h) => (
      <span className="chip" data-tone={h.status === 'online' ? 'ok' : 'warn'}>
        {h.status === 'online' ? '●' : '△'} {h.status}
      </span>
    ),
  },
  { key: 'cpu', label: 'CPU', render: (h) => <span className="num">{formatPercent(h.latest.cpu_percent)}</span> },
  { key: 'trend', label: 'CPU trend', render: (h) => <Sparkline values={h.sparkline} /> },
  { key: 'memory', label: 'Memory', render: (h) => formatPercent(h.latest.memory_percent) },
  { key: 'network', label: 'Receiving', render: (h) => formatRate(h.latest.network_rx_bytes_per_second) },
  { key: 'seen', label: 'Last received', render: (h) => formatAgo(h.lastSuccessAt) },
];
export function OverviewPage() {
  const { can } = useAuth();
  const { refreshSeconds } = usePrefs();
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const hosts = useQuery({
    queryKey: ['hosts'],
    queryFn: () => api.get('/api/v1/hosts', HostsSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const alerts = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get('/api/v1/alerts/rules', RulesSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const rows = hosts.data ?? [];
  const visible = rows.filter((h) =>
    `${h.name} ${h.tags.join(' ')} ${h.status}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHead title="Overview" sub="A clear view of your corner of the cloud.">
        <RefreshControl refresh={hosts.refetch} />
        {can('hosts:manage') ? (
          <button className="btn btn--primary" onClick={() => setAdding(!adding)}>
            {adding ? 'Close form' : 'Add host'}
          </button>
        ) : null}
      </PageHead>
      <FleetBand hosts={hosts.data} alerts={alerts.data} />
      <AlertCountError error={alerts.error} />
      {adding ? (
        <section className="section">
          <h2>Connect a host</h2>
          <HostForm onSaved={() => setAdding(false)} />
        </section>
      ) : null}
      <section className="section">
        <div className="section__head">
          <h2>Host inventory</h2>
          <label>
            <span className="sr-only">Filter hosts or tags</span>
            <input
              className="input"
              type="search"
              placeholder="Filter hosts or tags…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </div>
        <QueryState query={hosts}>
          {visible.length ? (
            <DataTable rows={visible} columns={columns} caption="Host inventory" />
          ) : (
            <EmptyState title={rows.length ? 'No matching hosts' : 'Your first host, a few seconds away'}>
              {rows.length
                ? 'Try a different name, status or tag.'
                : 'Add a node_exporter URL to start collecting measurements.'}
            </EmptyState>
          )}
        </QueryState>
        <p className="small muted">Rates need two successful scrapes. A dash means unavailable, never zero.</p>
      </section>
    </>
  );
}
function AlertCountError({ error }: { error: unknown }) {
  return error ? <ErrorBlock title="Alert counts unavailable" error={error} /> : null;
}
function FleetBand({ hosts, alerts }: { hosts: Host[] | undefined; alerts: AlertRule[] | undefined }) {
  const firing = alerts ? alerts.filter((a) => a.state === 'firing').length : '—';
  const entries = [
    ['Registered hosts', hosts?.length ?? '—', 'Across your private fleet'],
    ['Online', hosts?.filter((h) => h.status === 'online').length ?? '—', '● Receiving measurements'],
    ['Need attention', hosts?.filter((h) => h.status !== 'online').length ?? '—', '△ Stale or offline'],
    ['Firing alerts', firing, 'Thresholds requiring attention'],
  ];
  return (
    <div className="band">
      {entries.map(([label, value, note]) => (
        <div className="band__item" key={label}>
          <div className="band__label">{label}</div>
          <div className="band__value">{value}</div>
          <div className="band__note">{note}</div>
        </div>
      ))}
    </div>
  );
}
