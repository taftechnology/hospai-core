import { forwardRef, type ReactNode, type Ref } from 'react';
import type { AriaLabelProps, ButtonHandlerProps, TestIdProps } from './types.js';

export type StayButtonState = 'inhouse' | 'due' | 'overstay' | 'confirmed' | 'pending';

export type StayButtonProps = TestIdProps &
  Pick<AriaLabelProps, 'aria-label' | 'aria-describedby' | 'aria-expanded' | 'aria-haspopup'> &
  Pick<ButtonHandlerProps, 'onClick' | 'onFocus' | 'onKeyDown'> & {
    state: StayButtonState;
    /** First and end grid tracks of the half-day tape grid. */
    colStart: number;
    colEnd: number;
    /** The stay runs past the window on that side: square end, no margin. */
    cutStart?: boolean;
    cutEnd?: boolean;
    /** Roving tab stop: 0 on the grid's active item, -1 elsewhere. */
    tabIndex?: 0 | -1;
    children?: ReactNode;
  };

/** A stay on the tape. The visible text is short; the accessible name carries guest, word and dates. */
export const StayButton = forwardRef(function StayButton(
  {
    state,
    colStart,
    colEnd,
    cutStart,
    cutEnd,
    tabIndex = -1,
    children,
    onClick,
    onFocus,
    onKeyDown,
    'data-testid': dataTestId,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    'aria-expanded': ariaExpanded,
    'aria-haspopup': ariaHasPopup,
  }: StayButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`ui-stay ui-stay--${state}`}
      style={{
        ['--tape-col-start' as string]: String(colStart),
        ['--tape-col-end' as string]: String(colEnd),
      }}
      data-cut-start={cutStart ? true : undefined}
      data-cut-end={cutEnd ? true : undefined}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      tabIndex={tabIndex}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
});
