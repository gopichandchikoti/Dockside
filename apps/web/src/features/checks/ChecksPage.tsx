import { CheckInputSchema, ChecksSchema, type ServiceCheck } from '@dockside/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable, type Column } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { FormError, QueryState } from '../../components/QueryState';
import { RefreshControl } from '../../components/RefreshControl';
import { EmptyState, PageHead } from '../../components/States';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { useAuth, type AuthedSession } from '../session/SessionProvider';

export function ChecksPage() {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['checks'],
    queryFn: () => api.get('/api/v1/checks', ChecksSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const run = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/checks/${id}/run`),
    onSuccess: async () => {
      await query.refetch();
    },
  });
  const columns = tableColumns({ can, run, setSelected, refresh: query.refetch });
  const check = query.data?.find((c) => c.id === selected);
  return (
    <>
      <PageHead title="Service checks" sub="Availability, measured from the Dockside server.">
        <RefreshControl refresh={query.refetch} />
        {can('checks:manage') ? (
          <button className="btn btn--primary" onClick={() => setAdding(!adding)}>
            {adding ? 'Close form' : 'Add check'}
          </button>
        ) : null}
      </PageHead>
      {adding ? <CheckForm onSaved={() => setAdding(false)} /> : null}
      <FormError error={run.error} />
      <QueryState query={query}>
        {query.data?.length ? (
          <DataTable rows={query.data} columns={columns} caption="Service checks" />
        ) : query.data ? (
          <EmptyState title="Keep an eye on a service">
            Add an HTTP or TCP target. Checks run each collection cycle.
          </EmptyState>
        ) : null}
      </QueryState>
      {check ? (
        <section className="section">
          <h2>History · {check.name}</h2>
          <DataTable
            caption="Check history"
            rows={check.history.map((r, i) => ({ ...r, id: `${r.ts}-${i}` }))}
            columns={[
              { key: 'time', label: 'Time', render: (r) => formatDateTime(r.ts) },
              { key: 'result', label: 'Result', render: (r) => `${r.ok ? '✓' : '△'} ${r.detail}` },
              { key: 'latency', label: 'Latency', render: (r) => `${r.latencyMs} ms` },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
function CheckForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'http' | 'tcp'>('http');
  const [target, setTarget] = useState('');
  const [port, setPort] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api.post(
        '/api/v1/checks',
        CheckInputSchema.parse({ name, kind, target, port: kind === 'tcp' ? Number(port) : null }),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['checks'] });
      onSaved();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form className="stack form-band" onSubmit={submit}>
      <h2>New service check</h2>
      <div className="form-grid">
        <Field label="Check name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="field">
          <span className="field__label">Protocol</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'http' | 'tcp')}>
            <option value="http">HTTP</option>
            <option value="tcp">TCP</option>
          </select>
        </label>
        <Field
          label={kind === 'http' ? 'Target URL' : 'Target hostname'}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        />
        {kind === 'tcp' ? (
          <Field
            label="Port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            required
          />
        ) : null}
      </div>
      <FormError error={save.error} />
      <div>
        <button className="btn btn--primary" disabled={save.isPending}>
          Save check
        </button>
      </div>
    </form>
  );
}

function tableColumns({
  can,
  run,
  setSelected,
  refresh,
}: {
  can: AuthedSession['can'];
  run: { isPending: boolean; mutate: (id: string) => void };
  setSelected: (id: string) => void;
  refresh: () => Promise<unknown>;
}): Column<ServiceCheck>[] {
  return [
    {
      key: 'name',
      label: 'Service / target',
      render: (c) => (
        <>
          <strong>{c.name}</strong>
          <div className="muted small">
            {c.kind.toUpperCase()} · {c.target}
            {c.port ? `:${c.port}` : ''}
          </div>
        </>
      ),
    },
    {
      key: 'state',
      label: 'Latest result',
      render: (c) =>
        c.history[0] ? (
          <span className="chip" data-tone={c.history[0].ok ? 'ok' : 'crit'}>
            {c.history[0].ok ? '✓ Healthy' : '△ Failing'} · {c.history[0].latencyMs} ms
          </span>
        ) : (
          'Not run yet'
        ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (c) => (
        <div className="row">
          <button className="btn" onClick={() => setSelected(c.id)}>
            History
          </button>
          {can('checks:run') ? (
            <button className="btn" disabled={run.isPending} onClick={() => run.mutate(c.id)}>
              Run now
            </button>
          ) : null}
          {can('checks:manage') ? (
            <ConfirmButton
              label="Delete"
              message={`Delete ${c.name} and its history?`}
              onConfirm={async () => {
                await api.delete(`/api/v1/checks/${c.id}`);
                await refresh();
              }}
            />
          ) : null}
        </div>
      ),
    },
  ];
}
