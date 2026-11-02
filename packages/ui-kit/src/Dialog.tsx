import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { TestIdProps } from './types.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogProps = TestIdProps & {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  /** Focused on open. Defaults to the first focusable control in the panel. */
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
};

export function Dialog({
  open,
  title,
  onClose,
  footer,
  wide,
  initialFocus,
  children,
  'data-testid': dataTestId,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget =
      initialFocus?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    focusTarget?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  function trapTab(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="ui-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      data-testid={dataTestId}
    >
      <div className="ui-dialog__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className={clsx('ui-dialog__panel', wide && 'ui-dialog__panel--wide')}
        ref={panelRef}
      >
        <header className="ui-dialog__head">
          <h2 id={titleId}>{title}</h2>
        </header>
        {children != null ? <div className="ui-dialog__body">{children}</div> : null}
        {footer != null ? <footer className="ui-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
