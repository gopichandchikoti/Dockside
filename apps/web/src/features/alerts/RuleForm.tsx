import { HostsSchema, METRICS, RuleInputSchema, type AlertRule, type Metric, type Host } from '@dockside/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SelectField } from '../../components/SelectField';
import { Field } from '../../components/Field';
import { FormError, QueryState } from '../../components/QueryState';
import { api } from '../../lib/api';

export function RuleForm({ onSaved, rule }: { onSaved: () => void; rule?: AlertRule }) {
  const hosts = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/v1/hosts', HostsSchema) });
  const initial = rule
    ? {
        name: rule.name,
        hostId: rule.hostId,
        metric: rule.metric,
        operator: rule.operator,
        threshold: String(rule.threshold),
        duration: String(rule.durationSeconds),
      }
    : {
        name: '',
        hostId: '',
        metric: 'cpu_percent' as Metric,
        operator: 'gt' as const,
        threshold: '80',
        duration: '60',
      };
  const [draft, setDraft] = useState(initial);
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft({ ...draft, [key]: value });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const body = RuleInputSchema.parse({
        name: draft.name,
        hostId: draft.hostId,
        metric: draft.metric,
        operator: draft.operator,
        threshold: Number(draft.threshold),
        durationSeconds: Number(draft.duration),
        enabled: true,
      });
      return rule ? api.patch(`/api/v1/alerts/rules/${rule.id}`, body) : api.post('/api/v1/alerts/rules', body);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['rules'] });
      onSaved();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form className="stack form-band" onSubmit={submit}>
      <h2>{rule ? 'Edit rule' : 'New alert rule'}</h2>
      <QueryState query={hosts}>
        <RuleFields draft={draft} update={update} hosts={hosts.data ?? []} />
      </QueryState>
      <FormError error={save.error} />
      <div>
        <button className="btn btn--primary" disabled={save.isPending}>
          Save rule
        </button>
      </div>
    </form>
  );
}

type RuleDraft = {
  name: string;
  hostId: string;
  metric: Metric;
  operator: 'gt' | 'lt';
  threshold: string;
  duration: string;
};
function RuleFields({
  draft,
  update,
  hosts,
}: {
  draft: RuleDraft;
  update: <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => void;
  hosts: Host[];
}) {
  return (
    <div className="form-grid">
      <Field label="Rule name" value={draft.name} onChange={(e) => update('name', e.target.value)} required />
      <SelectField
        label="Host"
        value={draft.hostId}
        onChange={(v) => update('hostId', v)}
        required
        options={[{ value: '', label: 'Choose host' }, ...hosts.map((h) => ({ value: h.id, label: h.name }))]}
      />
      <SelectField
        label="Metric"
        value={draft.metric}
        onChange={(v) => update('metric', v as Metric)}
        options={Object.entries(METRICS).map(([key, m]) => ({ value: key, label: `${m.label} (${m.unit})` }))}
      />
      <SelectField
        label="Condition"
        value={draft.operator}
        onChange={(v) => update('operator', v)}
        options={[
          { value: 'gt', label: 'Above' },
          { value: 'lt', label: 'Below' },
        ]}
      />
      <Field
        label={`Threshold (${METRICS[draft.metric].unit})`}
        type="number"
        step="any"
        value={draft.threshold}
        onChange={(e) => update('threshold', e.target.value)}
        required
      />
      <Field
        label="Duration (seconds)"
        type="number"
        min={0}
        max={86400}
        value={draft.duration}
        onChange={(e) => update('duration', e.target.value)}
        required
      />
    </div>
  );
}
