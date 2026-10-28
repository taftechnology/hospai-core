import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type FormDialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions, right-aligned. */
  actions: ReactNode;
};

/**
 * Form dialog in the same `.app-modal` language as ConfirmDialog: portal,
 * Escape and backdrop close, initial focus, Tab kept inside the panel.
 */
export function FormDialog({ title, onClose, children, actions }: FormDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, []);

  function trapTab(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
      className="app-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
    >
      <div className="app-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="app-modal__panel app-modal__panel--compact" ref={panelRef}>
        <header className="app-modal__head">
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="stack">{children}</div>
        <footer className="app-modal__foot app-modal__foot--end">
          <div className="app-modal__actions">{actions}</div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
