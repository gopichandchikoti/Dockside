import type { AppContext } from '../context';

async function pooled<T>(items: T[], work: (item: T) => Promise<unknown>): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) await work(item);
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
}

export function startScheduler(ctx: AppContext, onError: () => void): () => Promise<void> {
  let active: Promise<void> | null = null;
  let lastCompleted: number | null = null;
  let failed = false;
  ctx.hosts.bootstrap();
  ctx.components.push({
    id: 'collector',
    label: 'Metric collector',
    check: () => {
      if (!ctx.hosts.list().length) return { state: 'unconfigured', detail: 'Register a node_exporter host.' };
      const old =
        lastCompleted === null || ctx.now().getTime() - lastCompleted > ctx.config.scrapeIntervalSeconds * 4000;
      return failed || old ? { state: 'degraded', detail: 'Collection delayed or failed.' } : { state: 'ok' };
    },
  });
  const run = () => {
    if (active) return;
    active = (async () => {
      await pooled(ctx.hosts.list(), (host) => ctx.hosts.collect(host.id));
      await pooled(ctx.checks.list(), (check) => ctx.checks.run(check.id));
      ctx.alerts.evaluate();
      ctx.hosts.retain();
      ctx.sessions.purgeExpired();
      lastCompleted = ctx.now().getTime();
      failed = false;
    })()
      .catch(() => {
        failed = true;
        onError();
      })
      .finally(() => {
        active = null;
      });
  };
  run();
  const timer = setInterval(run, ctx.config.scrapeIntervalSeconds * 1000);
  return async () => {
    clearInterval(timer);
    await active;
    await ctx.alerts.idle();
  };
}
