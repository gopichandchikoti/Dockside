import { PlatformStatusSchema, type ComponentState } from '@dockside/shared';
import { useQuery } from '@tanstack/react-query';
import { Icon, type IconName } from '../../components/Icon';
import { ErrorBlock, LoadingBlock } from '../../components/States';
import { api } from '../../lib/api';
import { formatDuration } from '../../lib/format';

const TONE: Record<ComponentState, 'ok' | 'warn' | 'crit' | 'idle'> = {
  ok: 'ok',
  degraded: 'warn',
  fail: 'crit',
  unconfigured: 'idle',
};
const GLYPH: Record<ComponentState, IconName> = { ok: 'check', degraded: 'alert', fail: 'x', unconfigured: 'plug' };
const WORD: Record<ComponentState, string> = {
  ok: 'Running',
  degraded: 'Degraded',
  fail: 'Failing',
  unconfigured: 'Not configured',
};

export function PlatformStatusList() {
  const status = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => api.get('/api/v1/status', PlatformStatusSchema),
    refetchInterval: 15_000,
  });

  return (
    <section className="section" aria-labelledby="platform">
      <div className="section__head">
        <h2 id="platform">Platform status</h2>
        {status.data ? (
          <span className="muted small num">
            v{status.data.version} · up {formatDuration(status.data.uptimeSeconds)} · schema {status.data.schemaVersion}
          </span>
        ) : null}
      </div>
      {status.isPending ? <LoadingBlock label="Loading platform status" rows={2} /> : null}
      {status.isError ? <ErrorBlock error={status.error} onRetry={() => void status.refetch()} /> : null}
      {status.data ? (
        <div className="table-wrap" role="region" aria-label="Platform component status" tabIndex={0}>
          <table className="table">
            <caption className="sr-only">Dockside components and their current state</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col">State</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {status.data.components.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  <td>
                    <span className="chip" data-tone={TONE[c.state]}>
                      <Icon name={GLYPH[c.state]} size={14} />
                      {WORD[c.state]}
                    </span>
                  </td>
                  <td className="muted">{c.detail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
