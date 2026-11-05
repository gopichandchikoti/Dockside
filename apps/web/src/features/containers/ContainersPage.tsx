import { ContainersSchema, LogsSchema, type Container } from '@dockside/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable, type Column } from '../../components/DataTable';
import { QueryState } from '../../components/QueryState';
import { RefreshControl } from '../../components/RefreshControl';
import { EmptyState, PageHead } from '../../components/States';
import { api } from '../../lib/api';
import { formatBytes, formatPercent } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { useAuth, type AuthedSession } from '../session/SessionProvider';

export function ContainersPage() {
  const { can, features } = useAuth();
  const { refreshSeconds } = usePrefs();
  const [selected, setSelected] = useState<Container | null>(null);
  const query = useQuery({
    queryKey: ['containers'],
    queryFn: () => api.get('/api/v1/containers', ContainersSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const columns = tableColumns({ can, features, setSelected, refresh: query.refetch });
  return (
    <>
      <PageHead title="Containers" sub="Runtime state through your private Docker proxy.">
        <RefreshControl refresh={query.refetch} />
      </PageHead>
      <p className="small muted">
        CPU may exceed 100% across multiple cores. A dash means stats are unavailable.
        {!features.containerActionsEnabled ? ' Restarts are disabled by the server.' : ''}
      </p>
      <QueryState query={query}>
        {query.data?.length ? (
          <DataTable rows={query.data} columns={columns} caption="Docker containers" />
        ) : query.data ? (
          <EmptyState title="No visible containers">Containers with dockside.hide=true are excluded.</EmptyState>
        ) : null}
      </QueryState>
      {selected ? (
        <section className="section">
          <div className="section__head">
            <h2>Logs · {selected.name}</h2>
            <button className="btn" onClick={() => setSelected(null)}>
              Close logs
            </button>
          </div>
          <LogViewer key={selected.id} id={selected.id} />
        </section>
      ) : null}
    </>
  );
}
function LogViewer({ id }: { id: string }) {
  const [before, setBefore] = useState<string | null>(null);
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['logs', id, before],
    queryFn: () =>
      api.get(`/api/v1/containers/${id}/logs${before ? `?before=${encodeURIComponent(before)}` : ''}`, LogsSchema),
    refetchInterval: !before && refreshSeconds ? refreshSeconds * 1000 : false,
  });
  return (
    <>
      <p className="muted small">Bounded log pages. Logs may contain application secrets; access is audited.</p>
      <QueryState query={query}>
        {query.data ? (
          <pre className="log-view" tabIndex={0} aria-label="Container logs">
            {query.data.text || 'No log output.'}
          </pre>
        ) : null}
      </QueryState>
      <div className="row">
        <button
          className="btn"
          disabled={!query.data?.nextBefore}
          onClick={() => setBefore(query.data?.nextBefore ?? null)}
        >
          Older logs
        </button>
        <button className="btn" disabled={!before} onClick={() => setBefore(null)}>
          Latest logs
        </button>
      </div>
    </>
  );
}

function tableColumns({
  can,
  features,
  setSelected,
  refresh,
}: {
  can: AuthedSession['can'];
  features: AuthedSession['features'];
  setSelected: (c: Container) => void;
  refresh: () => Promise<unknown>;
}): Column<Container>[] {
  return [
    {
      key: 'name',
      label: 'Container',
      render: (c) => (
        <>
          <strong>{c.name}</strong>
          <div className="muted small">{c.image}</div>
        </>
      ),
    },
    {
      key: 'state',
      label: 'State',
      render: (c) => (
        <span className="chip" data-tone={c.state === 'running' ? 'ok' : 'warn'}>
          {c.state === 'running' ? '●' : '△'} {c.state}
        </span>
      ),
    },
    { key: 'cpu', label: 'CPU', render: (c) => formatPercent(c.cpuPercent) },
    { key: 'memory', label: 'Memory', render: (c) => formatBytes(c.memoryBytes) },
    { key: 'restarts', label: 'Restarts', render: (c) => c.restartCount ?? '—' },
    {
      key: 'actions',
      label: 'Actions',
      render: (c) => (
        <div className="row">
          {can('containers:logs') ? (
            <button className="btn" onClick={() => setSelected(c)}>
              Logs
            </button>
          ) : null}
          {can('containers:restart') ? (
            <ConfirmButton
              label="Restart"
              disabled={!features.containerActionsEnabled}
              message={`Restart ${c.name}? Connections to this container may be interrupted.`}
              onConfirm={async () => {
                await api.post(`/api/v1/containers/${c.id}/restart`, { confirm: true });
                await refresh();
              }}
            />
          ) : null}
        </div>
      ),
    },
  ];
}
