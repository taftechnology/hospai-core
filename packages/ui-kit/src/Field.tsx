import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import clsx from 'clsx';

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  /** The single control slot — Input, NativeSelect, Textarea, or Checkbox. */
  control: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
};

export function Field({ label, hint, error, htmlFor, control }: FieldProps) {
  const autoId = useId();
  const controlId = htmlFor ?? control.props.id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId, control.props['aria-describedby']]
    .filter(Boolean)
    .join(' ') || undefined;

  const wiredControl = cloneElement(control, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : control.props['aria-invalid'],
  });

  return (
    <div className={clsx('ui-field', error && 'ui-field--error')}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {wiredControl}
      {hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
