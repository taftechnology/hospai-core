import { forwardRef, type ReactNode, type Ref, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import type { AriaLabelProps, InputHandlerProps, TestIdProps } from './types.js';

type TextInputType = 'text' | 'search' | 'email' | 'number' | 'date' | 'password' | 'tel' | 'url';

export type InputProps = TestIdProps &
  AriaLabelProps &
  InputHandlerProps & {
    type?: TextInputType;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    min?: string | number;
    max?: string | number;
    step?: string | number;
    autoComplete?: string;
    id?: string;
    name?: string;
  };

export const Input = forwardRef(function Input(
  {
    type = 'text',
    value,
    defaultValue,
    placeholder,
    disabled,
    readOnly,
    required,
    min,
    max,
    step,
    autoComplete,
    id,
    name,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    onChange,
    onInput,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
  }: InputProps,
  ref: Ref<HTMLInputElement>,
) {
  return (
    <input
      ref={ref}
      className="ui-input"
      type={type}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      min={min}
      max={max}
      step={step}
      autoComplete={autoComplete}
      id={id}
      name={name}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      onChange={onChange}
      onInput={onInput}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
});

export type CheckboxProps = TestIdProps &
  AriaLabelProps &
  InputHandlerProps & {
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    required?: boolean;
    id?: string;
    name?: string;
    value?: string;
  };

export const Checkbox = forwardRef(function Checkbox(
  {
    checked,
    defaultChecked,
    disabled,
    required,
    id,
    name,
    value,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    onChange,
    onFocus,
    onBlur,
  }: CheckboxProps,
  ref: Ref<HTMLInputElement>,
) {
  return (
    <input
      ref={ref}
      className="ui-checkbox"
      type="checkbox"
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      required={required}
      id={id}
      name={name}
      value={value}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
});

export type TextareaProps = TestIdProps &
  AriaLabelProps &
  Pick<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'onChange' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onKeyUp'
  > & {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    rows?: number;
    id?: string;
    name?: string;
  };

export const Textarea = forwardRef(function Textarea(
  {
    value,
    defaultValue,
    placeholder,
    disabled,
    readOnly,
    required,
    rows,
    id,
    name,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    onChange,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
  }: TextareaProps,
  ref: Ref<HTMLTextAreaElement>,
) {
  return (
    <textarea
      ref={ref}
      className="ui-textarea"
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      rows={rows}
      id={id}
      name={name}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  );
});

export type NativeSelectProps = TestIdProps &
  AriaLabelProps &
  Pick<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'onFocus' | 'onBlur'> & {
    value?: string;
    defaultValue?: string;
    disabled?: boolean;
    required?: boolean;
    id?: string;
    name?: string;
    children?: ReactNode;
  };

export const NativeSelect = forwardRef(function NativeSelect(
  {
    value,
    defaultValue,
    disabled,
    required,
    id,
    name,
    children,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    'aria-required': ariaRequired,
    onChange,
    onFocus,
    onBlur,
  }: NativeSelectProps,
  ref: Ref<HTMLSelectElement>,
) {
  return (
    <select
      ref={ref}
      className="ui-select"
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      required={required}
      id={id}
      name={name}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      aria-required={ariaRequired}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </select>
  );
});
