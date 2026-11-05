import { ChannelInputSchema, ChannelsSchema, type Channel } from '@dockside/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { DataTable, type Column } from '../../components/DataTable';
import { Field } from '../../components/Field';
import { FormError, QueryState } from '../../components/QueryState';
import { api } from '../../lib/api';

export function ChannelsSection() {
  const query = useQuery({ queryKey: ['channels'], queryFn: () => api.get('/api/v1/alerts/channels', ChannelsSchema) });
  const columns: Column<Channel>[] = [
    { key: 'name', label: 'Channel', render: (c) => `${c.name} · ${c.kind}` },
    { key: 'secret', label: 'Destination', render: () => 'Encrypted · credentials masked' },
    { key: 'last', label: 'Delivery', render: (c) => c.lastDelivery ?? 'No delivery yet' },
    {
      key: 'action',
      label: 'Actions',
      render: (c) => (
        <ConfirmButton
          label="Delete channel"
          message={`Remove ${c.name}?`}
          onConfirm={async () => {
            await api.delete(`/api/v1/alerts/channels/${c.id}`);
            await query.refetch();
          }}
        />
      ),
    },
  ];
  return (
    <section className="section">
      <h2>Notification channels</h2>
      <p className="muted small">
        Every channel receives firing and recovery events. URLs and tokens are encrypted at rest.
      </p>
      <QueryState query={query}>
        {query.data?.length ? (
          <DataTable caption="Notification channels" rows={query.data} columns={columns} />
        ) : (
          <p className="muted">No notification channels configured.</p>
        )}
      </QueryState>
      <ChannelForm onSaved={query.refetch} />
    </section>
  );
}

function ChannelForm({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'webhook' | 'ntfy'>('webhook');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/api/v1/alerts/channels', ChannelInputSchema.parse({ name, kind, url, token })),
    onSuccess: async () => {
      setUrl('');
      setToken('');
      setName('');
      await onSaved();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <details>
      <summary>Add notification channel</summary>
      <form className="stack form-band" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Channel name" value={name} onChange={(e) => setName(e.target.value)} required />
          <label className="field">
            <span className="field__label">Channel type</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as 'webhook' | 'ntfy')}>
              <option value="webhook">Webhook</option>
              <option value="ntfy">ntfy</option>
            </select>
          </label>
          <Field label="Destination URL" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <Field
            label="Bearer token (optional)"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <FormError error={save.error} />
        <div>
          <button className="btn" disabled={save.isPending}>
            Add channel
          </button>
        </div>
      </form>
    </details>
  );
}
