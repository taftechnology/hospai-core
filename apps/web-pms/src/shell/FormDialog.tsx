import { Dialog } from '@hospai/ui-kit';
import type { ReactNode } from 'react';

export type FormDialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions, right-aligned. */
  actions: ReactNode;
};

export function FormDialog({ title, onClose, children, actions }: FormDialogProps) {
  return (
    <Dialog open title={title} onClose={onClose} footer={actions}>
      {children}
    </Dialog>
  );
}
