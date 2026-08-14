import { forwardRef, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';
import { linkButtonClasses } from './variant-map.js';
import type { AriaLabelProps, ButtonIntent, ControlSize, TestIdProps } from './types.js';

type LinkHandlerProps = Pick<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'onClick' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'onKeyUp' | 'target' | 'rel'
>;

export type LinkButtonProps = TestIdProps &
  AriaLabelProps &
  LinkHandlerProps & {
    intent?: ButtonIntent;
    size?: ControlSize;
    href: string;
    id?: string;
    children?: ReactNode;
    /** When true, link is non-interactive but keeps anchor semantics for tests. */
    disabled?: boolean;
  };

export const LinkButton = forwardRef(function LinkButton(
  {
    intent = 'default',
    size = 'md',
    href,
    id,
    disabled,
    children,
    target,
    rel,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    'aria-disabled': ariaDisabled,
    onClick,
    onFocus,
    onBlur,
    onKeyDown,
    onKeyUp,
  }: LinkButtonProps,
  ref: Ref<HTMLAnchorElement>,
) {
  return (
    <a
      ref={ref}
      href={href}
      id={id}
      target={target}
      rel={rel}
      className={linkButtonClasses(intent, size)}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled ? true : ariaDisabled}
      tabIndex={disabled ? -1 : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {children}
    </a>
  );
});
