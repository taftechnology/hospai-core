import { Button, Dialog } from '@hospai/ui-kit';
import { useRef } from 'react';

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

  return (
    <Dialog
      open
      title={title}
      onClose={onCancel}
      initialFocus={cancelRef}
      footer={
        <>
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
        </>
      }
    >
      <p className="muted">{description}</p>
    </Dialog>
  );
}
