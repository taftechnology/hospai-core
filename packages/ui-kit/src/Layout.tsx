import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { TestIdProps, TotalTone } from './types.js';

/* --- tabs --------------------------------------------------------------- */

export type TabsProps = TestIdProps & {
  /** Accessible name for the tab strip, e.g. "Rates views". */
  label: string;
  children?: ReactNode;
};

export function Tabs({ label, children, 'data-testid': dataTestId }: TabsProps) {
  return (
    <nav className="ui-tabs" aria-label={label} data-testid={dataTestId}>
      {children}
    </nav>
  );
}

/*
 * There is no <Tab> component on purpose. A tab is a router <Link>, and
 * ui-kit does not depend on the router. Callers render their own link with
 * className="ui-tab" and aria-current="page" on the active one — the same
 * contract the sidebar nav already uses.
 */

/* --- toolbar ------------------------------------------------------------ */

export type ToolbarProps = TestIdProps & {
  children?: ReactNode;
};

/** Filter/control bar. Sits flush at the top of a Card, above its content. */
export function Toolbar({ children, 'data-testid': dataTestId }: ToolbarProps) {
  return (
    <div className="ui-toolbar" data-testid={dataTestId}>
      {children}
    </div>
  );
}

/* --- metrics ------------------------------------------------------------ */

export type MetricsProps = {
  children?: ReactNode;
};

export function Metrics({ children }: MetricsProps) {
  return <div className="ui-metrics">{children}</div>;
}

export type MetricProps = TestIdProps & {
  label: ReactNode;
  value: ReactNode;
};

/** A read-only count. Deliberately not button-shaped. */
export function Metric({ label, value, 'data-testid': dataTestId }: MetricProps) {
  return (
    <span className="ui-metric" data-testid={dataTestId}>
      {label} <span className="ui-metric__value">{value}</span>
    </span>
  );
}

/* --- row actions -------------------------------------------------------- */

export type RowActionsProps = {
  children?: ReactNode;
};

/** Separated affordances in a table cell, never a run-on sentence. */
export function RowActions({ children }: RowActionsProps) {
  return <span className="ui-row-actions">{children}</span>;
}

/* --- empty state -------------------------------------------------------- */

export type EmptyStateProps = TestIdProps & {
  title: ReactNode;
  /** What the operator can do about it. */
  description?: ReactNode;
  /** A single recovery action. */
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
  'data-testid': dataTestId,
}: EmptyStateProps) {
  return (
    <div className="ui-empty" data-testid={dataTestId}>
      <span className="ui-empty__title">{title}</span>
      {description ? <span>{description}</span> : null}
      {action ?? null}
    </div>
  );
}

/* --- total -------------------------------------------------------------- */

const TOTAL_TONE: Record<TotalTone, string> = {
  neutral: '',
  credit: 'ui-total__value--credit',
  due: 'ui-total__value--due',
};

export type TotalProps = TestIdProps & {
  label: ReactNode;
  value: ReactNode;
  tone?: TotalTone;
};

/** The one number that matters on a money screen. */
export function Total({ label, value, tone = 'neutral', 'data-testid': dataTestId }: TotalProps) {
  return (
    <div className="ui-total" data-testid={dataTestId}>
      <span className="ui-total__label">{label}</span>
      <span className={clsx('ui-total__value', TOTAL_TONE[tone])}>{value}</span>
    </div>
  );
}

/* --- utility ------------------------------------------------------------ */

export type VisuallyHiddenProps = {
  children?: ReactNode;
};

/**
 * Accessible-but-unpainted text. The rates matrix renders a per-cell label
 * for screen readers; without this it paints as body text in every cell.
 */
export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="ui-visually-hidden">{children}</span>;
}
