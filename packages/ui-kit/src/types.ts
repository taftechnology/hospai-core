import type { AriaAttributes, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

export type ButtonIntent = 'default' | 'primary' | 'destructive' | 'ghost';
export type ControlSize = 'sm' | 'md';

/** Field width caps. Fields still shrink below these in narrow containers. */
export type FieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'full';

/** Alert colouring. Mirrors the status rungs that carry a surface. */
export type AlertIntent = 'exception' | 'attention' | 'settled' | 'informational';

/** Emphasis for a Total's value. */
export type TotalTone = 'neutral' | 'credit' | 'due';

export type StatusRung =
  | 'settled'
  | 'neutral'
  | 'informational'
  | 'attention'
  | 'exception';

export type TestIdProps = {
  'data-testid'?: string;
};

export type AriaLabelProps = Pick<
  AriaAttributes,
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-invalid'
  | 'aria-required'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-haspopup'
  | 'aria-live'
  | 'aria-busy'
  | 'aria-disabled'
>;

export type ButtonHandlerProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onKeyUp' | 'type'
>;

export type InputHandlerProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'onInput' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onKeyUp'
>;
