import { AuditSchema } from '@dockside/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/DataTable';
import { QueryState } from '../../components/QueryState';
import { PageHead } from '../../components/States';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

export function AuditPage() {
  const [before, setBefore] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['audit', before],
    queryFn: () => api.get(`/api/v1/audit${before ? `?before=${before}` : ''}`, AuditSchema),
  });
  return (
    <>
      <Link to="/settings">← Settings</Link>
      <PageHead title="Audit trail" sub="Sensitive actions, denied requests and account changes." />
      <QueryState query={query}>
        {query.data?.length ? (
          <DataTable
            caption="Audit entries"
            rows={query.data}
            columns={[
              { key: 'time', label: 'Time', render: (r) => formatDateTime(r.ts) },
              { key: 'actor', label: 'Actor', render: (r) => r.actorName ?? 'Signed-out request' },
              { key: 'action', label: 'Action', render: (r) => r.action },
              {
                key: 'outcome',
                label: 'Outcome',
                render: (r) => `${r.outcome === 'success' ? '✓' : '△'} ${r.outcome}`,
              },
            ]}
          />
        ) : (
          <p className="muted">No entries on this page.</p>
        )}
      </QueryState>
      <div className="row">
        <button
          className="btn"
          disabled={(query.data?.length ?? 0) < 100}
          onClick={() => setBefore(query.data?.at(-1)?.id ?? null)}
        >
          Older entries
        </button>
        <button className="btn" disabled={!before} onClick={() => setBefore(null)}>
          Newest entries
        </button>
      </div>
    </>
  );
}
