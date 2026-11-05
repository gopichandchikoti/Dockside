import { HostSchema, METRICS, SeriesSchema, type Host, type Metric, type TimeRange } from '@dockside/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable } from '../../components/DataTable';
import { QueryState } from '../../components/QueryState';
import { RefreshControl } from '../../components/RefreshControl';
import { PageHead } from '../../components/States';
import { TimeSeriesChart } from '../../components/TimeSeriesChart';
import { api } from '../../lib/api';
import {
  formatAgo,
  formatBytes,
  formatCelsius,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
} from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { useAuth } from '../session/SessionProvider';
import { HostForm } from './HostForm';

export function HostPage() {
  const { id = '' } = useParams();
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['hosts', id],
    queryFn: () => api.get(`/api/v1/hosts/${id}`, HostSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  return (
    <>
      <Link to="/">← Host inventory</Link>
      <QueryState query={query}>
        {query.data ? <HostContent host={query.data} refresh={query.refetch} /> : null}
      </QueryState>
    </>
  );
}
function HostContent({ host, refresh }: { host: Host; refresh: () => Promise<unknown> }) {
  const { can } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const remove = async () => {
    await api.delete(`/api/v1/hosts/${host.id}`);
    await client.invalidateQueries({ queryKey: ['hosts'] });
    await navigate('/');
  };
  return (
    <>
      <PageHead
        title={host.name}
        sub={`${host.isSample ? 'SAMPLE · ' : ''}${host.status} · Last received ${formatAgo(host.lastSuccessAt)}`}
      >
        <RefreshControl refresh={refresh} />
        {can('hosts:manage') ? (
          <>
            <button className="btn" onClick={() => setEdit(!edit)}>
              Edit host
            </button>
            <ConfirmButton
              label="Delete host"
              message="Delete this host, its measurements and alert rules? This cannot be undone."
              onConfirm={remove}
            />
          </>
        ) : null}
      </PageHead>
      {host.lastError ? (
        <p className="notice" role="status">
          △ {host.lastError} Last received values remain visible.
        </p>
      ) : null}
      {host.droppedSeries ? (
        <p className="notice" data-tone="warn">
          △ {host.droppedSeries} series dropped by parser or cardinality limits.
        </p>
      ) : null}
      {edit ? <HostForm host={host} onSaved={() => setEdit(false)} /> : null}
      <HostReadings host={host} />
      <HostHistory host={host} />
      <HostMetadata host={host} />
    </>
  );
}
function HostReadings({ host }: { host: Host }) {
  const m = host.latest;
  const readings = [
    ['CPU', formatPercent(m.cpu_percent)],
    ['Memory', formatBytes(m.memory_used_bytes)],
    ['Uptime', formatDuration(m.uptime_seconds)],
    ['Load · 1 min', formatNumber(m.load1)],
    ['Receive / send', `${formatRate(m.network_rx_bytes_per_second)} / ${formatRate(m.network_tx_bytes_per_second)}`],
  ];
  return (
    <dl className="kv">
      {readings.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function HostHistory({ host }: { host: Host }) {
  const [metric, setMetric] = useState<Metric>('cpu_percent');
  const [range, setRange] = useState<TimeRange>('1h');
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['metrics', host.id, metric, range],
    queryFn: () => api.get(`/api/v1/hosts/${host.id}/metrics?metric=${metric}&range=${range}`, SeriesSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  return (
    <section className="section">
      <div className="section__head">
        <h2>Measurement history</h2>
        <div className="row">
          <label>
            <span className="sr-only">Metric</span>
            <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {Object.entries(METRICS).map(([key, m]) => (
                <option value={key} key={key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Time range</span>
            <select className="select" value={range} onChange={(e) => setRange(e.target.value as TimeRange)}>
              {['1h', '6h', '24h', '7d', '30d'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <QueryState query={query}>
        {query.data ? <TimeSeriesChart series={query.data} title={METRICS[metric].label} /> : null}
      </QueryState>
    </section>
  );
}
function HostMetadata({ host }: { host: Host }) {
  return (
    <>
      <section className="section">
        <h2>Filesystems</h2>
        {host.filesystems.length ? (
          <DataTable
            caption="Filesystem capacity"
            rows={host.filesystems.map((f) => ({ ...f, id: f.mount + f.device }))}
            columns={[
              { key: 'mount', label: 'Mount', render: (f) => f.mount },
              { key: 'type', label: 'Type', render: (f) => f.type },
              { key: 'size', label: 'Capacity', render: (f) => formatBytes(f.sizeBytes) },
              { key: 'free', label: 'Available', render: (f) => formatBytes(f.availableBytes) },
            ]}
          />
        ) : (
          <p className="muted">No eligible filesystem metadata exposed.</p>
        )}
        <p className="small muted">Capacity only. System, secret and container storage paths are excluded.</p>
      </section>
      <section className="section">
        <h2>Network interfaces</h2>
        {host.interfaces.length ? (
          <DataTable
            caption="Network interfaces"
            rows={host.interfaces.map((n) => ({ ...n, id: n.name }))}
            columns={[
              { key: 'name', label: 'Interface', render: (n) => n.name },
              { key: 'rx', label: 'Received', render: (n) => formatRate(n.receivedBytesPerSecond) },
              { key: 'tx', label: 'Sent', render: (n) => formatRate(n.sentBytesPerSecond) },
            ]}
          />
        ) : (
          <p className="muted">No network interfaces exposed.</p>
        )}
      </section>
      <section className="section">
        <h2>Sensors</h2>
        {host.sensors.length ? (
          <dl className="kv">
            {host.sensors.map((s) => (
              <div key={s.name}>
                <dt>{s.name}</dt>
                <dd>{formatCelsius(s.celsius)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">This exporter does not expose temperature sensors.</p>
        )}
      </section>
    </>
  );
}
