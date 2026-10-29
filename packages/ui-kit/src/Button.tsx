import { forwardRef, type AriaAttributes, type ReactNode, type Ref } from 'react';
import { buttonClasses } from './variant-map.js';
import type { AriaLabelProps, ButtonHandlerProps, ButtonIntent, ControlSize, TestIdProps } from './types.js';

export type ButtonProps = TestIdProps &
  AriaLabelProps &
  ButtonHandlerProps & {
    intent?: ButtonIntent;
    size?: ControlSize;
    disabled?: boolean;
    id?: string;
    name?: string;
    children?: ReactNode;
    'aria-pressed'?: AriaAttributes['aria-pressed'];
  };

export const Button = forwardRef(function Button(
  {
    intent = 'default',
    size = 'md',
    disabled,
    id,
    name,
    type = 'button',
    children,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls,
    'aria-haspopup': ariaHasPopup,
    'aria-busy': ariaBusy,
    'aria-disabled': ariaDisabled,
    'aria-pressed': ariaPressed,
    onClick,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type={type}
      id={id}
      name={name}
      disabled={disabled}
      className={buttonClasses(intent, size)}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-haspopup={ariaHasPopup}
      aria-busy={ariaBusy}
      aria-disabled={ariaDisabled}
      aria-pressed={ariaPressed}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {children}
    </button>
  );
});
