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

/** Same members as `@hospai/contracts` `ReservationStatus`. ui-kit does not depend on contracts. */
export const RESERVATION_STATUSES = [
  'inquiry',
  'pending',
  'confirmed',
  'cancelled',
  'checked_in',
  'checked_out',
  'no_show',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export type RoomHkStatus = 'clean' | 'dirty' | 'inspected' | 'out_of_order';

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
