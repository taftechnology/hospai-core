import { OPS_REASON_MAX, OPS_TICKET_REF_MAX } from '@hospai/contracts';
import { Alert, AlertTitle, Button, Dialog, Field, Input, Textarea } from '@hospai/ui-kit';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { opsErrorMessage } from '../api/client.js';
import type { useOpsWrite } from '../api/hooks.js';

type WriteMutation = ReturnType<typeof useOpsWrite>;

/** What a form builds from its fields: the payload to send, or a message for the operator. */
export type BuiltPayload = { payload: Record<string, unknown> } | { error: string };

/** Reason (required, 1 to 500) and ticket reference (optional): every write form has them. */
export function useWriteController(write: WriteMutation, build: () => BuiltPayload, onSuccess?: () => void) {
  const [reason, setReason] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  function submit() {
    setFormError(null);
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > OPS_REASON_MAX) {
      setReasonError(`Enter a reason (1 to ${OPS_REASON_MAX} characters).`);
      return;
    }
    if (ticketRef.trim().length > OPS_TICKET_REF_MAX) {
      setFormError(`The ticket reference is at most ${OPS_TICKET_REF_MAX} characters.`);
      return;
    }
    setReasonError(null);
    const built = build();
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    write.mutate({ payload: built.payload, meta: { reason, ticketRef } }, { onSuccess });
  }

  return {
    reason,
    setReason,
    ticketRef,
    setTicketRef,
    reasonError,
    formError,
    submit,
    pending: write.isPending,
    succeeded: write.isSuccess,
    replayed: write.data?.replayed === true,
    failure: write.isError ? opsErrorMessage(write.error) : null,
  };
}

export type WriteController = ReturnType<typeof useWriteController>;

export function ReasonFields({ c }: { c: WriteController }) {
  return (
    <>
      <Field
        label="Reason"
        hint="Recorded with the change. The customer can see it."
        error={c.reasonError ?? undefined}
        size="full"
        control={
          <Textarea
            value={c.reason}
            rows={3}
            maxLength={OPS_REASON_MAX}
            onChange={(e) => c.setReason(e.target.value)}
          />
        }
      />
      <Field
        label="Ticket reference (optional)"
        size="md"
        control={
          <Input
            value={c.ticketRef}
            maxLength={OPS_TICKET_REF_MAX}
            onChange={(e) => c.setTicketRef(e.target.value)}
          />
        }
      />
    </>
  );
}

export function WriteResult({ c, doneText }: { c: WriteController; doneText: string }) {
  // The result sits below the form, often under a dialog's scroll fold: bring it into view so the
  // operator always sees whether the change was made.
  const ref = useRef<HTMLDivElement>(null);
  const shown = c.formError ?? c.failure ?? (c.succeeded ? 'done' : null);
  useEffect(() => {
    if (shown) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shown]);
  return (
    <div ref={ref} className="ops-write-result" aria-live="polite">
      {c.formError ? <Alert intent="exception">{c.formError}</Alert> : null}
      {c.failure ? (
        <Alert intent="exception">
          <AlertTitle>Not changed</AlertTitle> {c.failure}
        </Alert>
      ) : null}
      {c.succeeded ? (
        <Alert intent="settled">
          <AlertTitle>Done</AlertTitle> {c.replayed ? 'That change was already recorded.' : doneText}
        </Alert>
      ) : null}
    </div>
  );
}

export type WriteDialogProps = {
  title: string;
  submitLabel: string;
  doneText: string;
  write: WriteMutation;
  build: () => BuiltPayload;
  onClose: () => void;
  /** Suspend and disable are destructive: red button, and the dialog is the confirmation. */
  destructive?: boolean;
  intro?: ReactNode;
  /** Holds the submit button off while the form cannot be sent (for example the plan list has not loaded). */
  submitDisabled?: boolean;
  children?: ReactNode;
};

export function WriteDialog({
  title,
  submitLabel,
  doneText,
  write,
  build,
  onClose,
  destructive,
  intro,
  submitDisabled,
  children,
}: WriteDialogProps) {
  const c = useWriteController(write, build);
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{c.succeeded ? 'Close' : 'Cancel'}</Button>
          {c.succeeded ? null : (
            <Button intent={destructive ? 'destructive' : 'primary'} disabled={c.pending || submitDisabled === true} onClick={c.submit}>
              {c.pending ? 'Working' : submitLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="ops-form">
        {intro}
        {children}
        <ReasonFields c={c} />
        <WriteResult c={c} doneText={doneText} />
      </div>
    </Dialog>
  );
}
