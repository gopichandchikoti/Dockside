import type { ReactNode } from 'react';
import { ErrorBlock, LoadingBlock } from './States';
export function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => Promise<unknown> };
  children: ReactNode;
}) {
  if (query.isPending) return <LoadingBlock />;
  return (
    <>
      {query.error ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
      {children}
    </>
  );
}
export function FormError({ error }: { error: unknown }) {
  return error ? <ErrorBlock title="Could not save" error={error} /> : null;
}
