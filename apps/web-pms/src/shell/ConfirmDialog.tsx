import { Button } from '@hospai/ui-kit';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: 'destructive' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="app-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="app-modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="app-modal__panel app-modal__panel--compact">
        <header className="app-modal__head">
          <h2 id="confirm-dialog-title">{title}</h2>
        </header>
        <p className="muted">{description}</p>
        <footer className="app-modal__foot app-modal__foot--end">
          <div className="app-modal__actions">
            <Button ref={cancelRef} type="button" intent="default" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              intent={intent === 'destructive' ? 'destructive' : 'primary'}
              data-testid="confirm-dialog-confirm"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
