import { EventsSchema, METRICS, RulesSchema, type AlertRule } from '@dockside/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable, type Column } from '../../components/DataTable';
import { FormError, QueryState } from '../../components/QueryState';
import { RefreshControl } from '../../components/RefreshControl';
import { EmptyState, PageHead } from '../../components/States';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { useAuth } from '../session/SessionProvider';
import { ChannelsSection } from './ChannelsSection';
import { RuleForm } from './RuleForm';

export function AlertsPage() {
  const { can } = useAuth();
  const [form, setForm] = useState<AlertRule | 'new' | null>(null);
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['rules'],
    queryFn: () => api.get('/api/v1/alerts/rules', RulesSchema),
    refetchInterval: refreshSeconds ? refreshSeconds * 1000 : false,
  });
  const action = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/alerts/rules/${id}/acknowledge`),
    onSuccess: async () => {
      await query.refetch();
    },
  });
  const rows = query.data ?? [];
  const columns = tableColumns({ action, setForm, refresh: query.refetch });
  return (
    <>
      <PageHead title="Alerts" sub="Thresholds, incidents and the quiet periods between them.">
        <RefreshControl refresh={query.refetch} />
        {can('alerts:manage') ? (
          <button className="btn btn--primary" onClick={() => setForm(form ? null : 'new')}>
            {form ? 'Close form' : 'Add rule'}
          </button>
        ) : null}
      </PageHead>
      {form ? (
        <RuleForm
          key={form === 'new' ? 'new' : form.id}
          {...(form === 'new' ? {} : { rule: form })}
          onSaved={() => setForm(null)}
        />
      ) : null}
      <FormError error={action.error} />
      <QueryState query={query}>
        {rows.length ? (
          <DataTable rows={rows} columns={columns} caption="Alert rules" />
        ) : (
          <EmptyState title="A quieter watch">
            Add a host-scoped threshold to record firing and recovery events.
          </EmptyState>
        )}
      </QueryState>
      <EventHistory />
      {can('alerts:manage') ? <ChannelsSection /> : null}
    </>
  );
}
function EventHistory() {
  const [before, setBefore] = useState<number | null>(null);
  const { refreshSeconds } = usePrefs();
  const query = useQuery({
    queryKey: ['events', before],
    queryFn: () => api.get(`/api/v1/alerts/events${before ? `?before=${before}` : ''}`, EventsSchema),
    refetchInterval: !before && refreshSeconds ? refreshSeconds * 1000 : false,
  });
  return (
    <section className="section">
      <h2>Event history</h2>
      <QueryState query={query}>
        {query.data?.length ? (
          <DataTable
            caption="Alert events"
            rows={query.data}
            columns={[
              { key: 'time', label: 'Time', render: (e) => formatDateTime(e.ts) },
              { key: 'event', label: 'Event', render: (e) => e.message },
            ]}
          />
        ) : (
          <p className="muted">No events on this page.</p>
        )}
      </QueryState>
      <div className="row">
        <button
          className="btn"
          disabled={(query.data?.length ?? 0) < 100}
          onClick={() => setBefore(query.data?.at(-1)?.id ?? null)}
        >
          Older events
        </button>
        <button className="btn" disabled={!before} onClick={() => setBefore(null)}>
          Newest events
        </button>
      </div>
    </section>
  );
}

function tableColumns({
  action,
  setForm,
  refresh,
}: {
  action: { isPending: boolean; mutate: (id: string) => void };
  setForm: (rule: AlertRule) => void;
  refresh: () => Promise<unknown>;
}): Column<AlertRule>[] {
  return [
    {
      key: 'name',
      label: 'Rule / condition',
      render: (r) => (
        <>
          <strong>{r.name}</strong>
          <div className="muted small">
            {METRICS[r.metric].label} {r.operator === 'gt' ? '>' : '<'} {r.threshold} {METRICS[r.metric].unit} for{' '}
            {r.durationSeconds} s
          </div>
        </>
      ),
    },
    {
      key: 'state',
      label: 'State',
      render: (r) => (
        <span className="chip" data-tone={r.state === 'firing' ? 'crit' : r.state === 'ok' ? 'ok' : 'warn'}>
          {r.state === 'ok' ? '✓' : '△'} {r.state}
          {r.value === null ? ' · no fresh sample' : ''}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => <AlertActions r={r} action={action} setForm={setForm} refresh={refresh} />,
    },
  ];
}

function AlertActions({
  r,
  action,
  setForm,
  refresh,
}: {
  r: AlertRule;
  action: { isPending: boolean; mutate: (id: string) => void };
  setForm: (rule: AlertRule) => void;
  refresh: () => Promise<unknown>;
}) {
  const { can } = useAuth();
  return (
    <div className="row">
      {can('alerts:acknowledge') && r.state === 'firing' ? (
        <button className="btn" disabled={action.isPending} onClick={() => action.mutate(r.id)}>
          Acknowledge
        </button>
      ) : null}
      {can('alerts:silence') ? (
        <ConfirmButton
          label="Silence 1h"
          message={`Silence ${r.name} for one hour?`}
          onConfirm={async () => {
            await api.post(`/api/v1/alerts/rules/${r.id}/silence`, { seconds: 3600 });
            await refresh();
          }}
        />
      ) : null}
      {can('alerts:manage') ? (
        <>
          <button className="btn" onClick={() => setForm(r)}>
            Edit
          </button>
          <ConfirmButton
            label="Delete rule"
            message={`Delete ${r.name} and its event history?`}
            onConfirm={async () => {
              await api.delete(`/api/v1/alerts/rules/${r.id}`);
              await refresh();
            }}
          />
        </>
      ) : null}
    </div>
  );
}
