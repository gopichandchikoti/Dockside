import type { ReactNode } from 'react';
import { describeError } from '../lib/api';
import { Icon, type IconName } from './Icon';

export function LoadingBlock({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="stack" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" />
      ))}
    </div>
  );
}

interface ErrorBlockProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

export function ErrorBlock({ title = 'Could not load this', error, onRetry }: ErrorBlockProps) {
  return (
    <div className="notice" data-tone="crit" role="alert">
      <Icon name="alert" />
      <div className="notice__body">
        <span className="notice__title">{title}</span>
        <span>{describeError(error)}</span>
        {onRetry ? (
          <div>
            <button type="button" className="btn btn--small" onClick={onRetry}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface EmptyProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = 'server', title, children, action }: EmptyProps) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h2>{title}</h2>
      {children ? <div className="small">{children}</div> : null}
      {action}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page__head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="page__sub">{sub}</p> : null}
      </div>
      {children ? <div className="toolbar">{children}</div> : null}
    </header>
  );
}
