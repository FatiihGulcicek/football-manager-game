import type { ReactNode } from 'react';

type PanelProps = {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function Panel({ children, className = '', ariaLabel }: PanelProps) {
  return (
    <section className={`game-panel ${className}`.trim()} aria-label={ariaLabel}>
      {children}
    </section>
  );
}

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
};

export function SectionHeader({ eyebrow, title, action }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div>
        {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

type StatusBadgeProps = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
};

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}

type ProgressIndicatorProps = {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
};

export function ProgressIndicator({ label, value, tone = 'neutral' }: ProgressIndicatorProps) {
  const safeValue = Math.min(Math.max(value, 0), 100);

  return (
    <div className="progress-block">
      <div className="progress-meta">
        <span>{label}</span>
        <strong>{safeValue}%</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span className={`progress-fill progress-fill--${tone}`} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'success' | 'warning' | 'danger' | 'neutral';
};

export function StatCard({ label, value, detail, tone = 'neutral' }: StatCardProps) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

type ErrorStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function ErrorState({ title, description, action }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard-grid dashboard-grid--loading" aria-label="Dashboard loading">
      <div className="skeleton skeleton--hero" />
      <div className="skeleton skeleton--panel" />
      <div className="skeleton skeleton--panel" />
      <div className="skeleton skeleton--wide" />
      <div className="skeleton skeleton--panel" />
      <div className="skeleton skeleton--panel" />
    </div>
  );
}
