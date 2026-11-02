import type { ReactNode } from 'react';
import type { TestIdProps } from './types.js';

export type CountStripProps = TestIdProps & {
  label: string;
  children?: ReactNode;
};

export function CountStrip({ label, children, 'data-testid': dataTestId }: CountStripProps) {
  return (
    <div className="ui-counts" role="group" aria-label={label} data-testid={dataTestId}>
      {children}
    </div>
  );
}
