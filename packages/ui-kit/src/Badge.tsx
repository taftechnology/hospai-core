import type { ReactNode } from 'react';
import clsx from 'clsx';
import { statusRungClass } from './variant-map.js';
import type { StatusRung, TestIdProps } from './types.js';

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

export type AlertProps = TestIdProps & {
  children?: ReactNode;
};

export function Alert({ children, 'data-testid': dataTestId }: AlertProps) {
  return (
    <div className="ui-alert" role="alert" data-testid={dataTestId}>
      {children}
    </div>
  );
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
