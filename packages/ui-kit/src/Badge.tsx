import type { ReactNode } from 'react';
import clsx from 'clsx';
import { statusRungClass } from './variant-map.js';
import type { AlertIntent, StatusRung, TestIdProps } from './types.js';

export type BadgeProps = TestIdProps & {
  rung: StatusRung;
  children?: ReactNode;
};

export function Badge({ rung, children, 'data-testid': dataTestId }: BadgeProps) {
  return (
    <span className={clsx('ui-badge', statusRungClass(rung))} data-testid={dataTestId}>
      {children}
    </span>
  );
}

const ALERT_INTENT: Record<AlertIntent, string> = {
  exception: 'ui-alert--exception',
  attention: 'ui-alert--attention',
  settled: 'ui-alert--settled',
  informational: 'ui-alert--informational',
};

export type AlertProps = TestIdProps & {
  /** Defaults to `exception`, which is what every call site rendered before. */
  intent?: AlertIntent;
  children?: ReactNode;
};

export function Alert({ intent = 'exception', children, 'data-testid': dataTestId }: AlertProps) {
  return (
    <div className={clsx('ui-alert', ALERT_INTENT[intent])} role="alert" data-testid={dataTestId}>
      {children}
    </div>
  );
}

export type AlertTitleProps = {
  children?: ReactNode;
};

export function AlertTitle({ children }: AlertTitleProps) {
  return <span className="ui-alert__title">{children}</span>;
}

export function Separator() {
  return <hr className="ui-separator" />;
}

export type SkeletonProps = TestIdProps & {
  width?: string;
  height?: string;
};

export function Skeleton({ width, height, 'data-testid': dataTestId }: SkeletonProps) {
  return (
    <span
      className="ui-skeleton"
      data-testid={dataTestId}
      style={{
        ...(width ? { inlineSize: width } : {}),
        ...(height ? { blockSize: height } : {}),
      }}
    />
  );
}
