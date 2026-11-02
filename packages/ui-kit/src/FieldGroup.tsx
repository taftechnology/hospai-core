import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { TestIdProps } from './types.js';

export type FieldGroupProps = TestIdProps & {
  legend?: ReactNode;
  inline?: boolean;
  children?: ReactNode;
};

export function FieldGroup({
  legend,
  inline,
  children,
  'data-testid': dataTestId,
}: FieldGroupProps) {
  const className = clsx('ui-field-group', inline && 'ui-field-group--inline');

  if (legend != null) {
    return (
      <fieldset className={className} data-testid={dataTestId}>
        <legend className="ui-field-group__legend">{legend}</legend>
        {children}
      </fieldset>
    );
  }

  return (
    <div className={className} data-testid={dataTestId}>
      {children}
    </div>
  );
}
