import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">
        ∅
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingBlock({ label = '正在加载…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBanner({
  title,
  hint,
  details,
  onRetry,
}: {
  title: string;
  hint?: string;
  details?: string[];
  onRetry?: () => void;
}) {
  return (
    <div className="alert alert--error" role="alert">
      <div className="alert-body">
        <strong>{title}</strong>
        {hint === undefined ? null : <p>{hint}</p>}
        {details !== undefined && details.length > 0 ? (
          <ul className="alert-list">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry === undefined ? null : (
        <button type="button" className="button button--ghost" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}
