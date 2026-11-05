import { HostInputSchema, HostSchema, type Host } from '@dockside/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { FormError } from '../../components/QueryState';
import { api } from '../../lib/api';
import { useAuth } from '../session/SessionProvider';
export function HostForm({ host, onSaved }: { host?: Host; onSaved?: () => void }) {
  const { features } = useAuth();
  const [name, setName] = useState(host?.name ?? '');
  const [url, setUrl] = useState(host?.metricsUrl ?? '');
  const [tags, setTags] = useState(host?.tags.join(', ') ?? '');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const input = HostInputSchema.parse({
        name,
        metricsUrl: url,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        isSample: host?.isSample ?? features.sampleData,
      });
      return host
        ? api.patch(`/api/v1/hosts/${host.id}`, input, HostSchema)
        : api.post('/api/v1/hosts', input, HostSchema);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['hosts'] });
      onSaved?.();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form className="stack form-band" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Host name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} />
        <Field
          label="Exporter URL"
          type="url"
          placeholder="http://192.168.1.20:9100/metrics"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <Field label="Tags" hint="Separate tags with commas." value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <p className="muted small">
        Connect a node_exporter endpoint on your private network. Only capacity metadata is collected.
      </p>
      <FormError error={save.error} />
      <div>
        <button className="btn btn--primary" disabled={save.isPending}>
          {save.isPending ? 'Connecting…' : host ? 'Save host' : 'Connect host'}
        </button>
      </div>
    </form>
  );
}
