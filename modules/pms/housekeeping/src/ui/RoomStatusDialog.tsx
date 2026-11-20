import {
  ROOM_STATUS_COMMENT_MAX,
  ROOM_STATUS_REASON_MAX,
} from '@hospai/contracts';
import { Alert, Button, Dialog, Field, Input, Textarea, roomStatusWord } from '@hospai/ui-kit';
import { useState } from 'react';

export type RoomStatusTarget = { roomId: string; code: string };

/**
 * One status change, or one batch, with its words. Marking dirty needs a reason;
 * clean and inspected take an optional comment. Batches ask once.
 */
export function RoomStatusDialog({
  status,
  rooms,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  status: string;
  rooms: readonly RoomStatusTarget[];
  busy: boolean;
  error?: string | null;
  onSubmit: (notes: { reason?: string; comment?: string }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const needsReason = status === 'dirty';
  const word = roomStatusWord(status).toLowerCase();
  const title =
    rooms.length === 1
      ? `Mark room ${rooms[0]!.code} ${word}`
      : `Mark ${rooms.length} rooms ${word}`;
  const missingReason = needsReason && !reason.trim();

  function submit() {
    if (missingReason || busy) return;
    const r = reason.trim();
    const c = comment.trim();
    onSubmit({ ...(r ? { reason: r } : {}), ...(c ? { comment: c } : {}) });
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || missingReason} onClick={submit}>
            {`Mark ${word}`}
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-status-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {rooms.length > 1 ? (
          <p>
            {rooms
              .slice(0, 12)
              .map((r) => r.code)
              .join(', ')}
            {rooms.length > 12 ? ` and ${rooms.length - 12} more` : ''}
          </p>
        ) : null}
        {needsReason ? (
          <Field
            label="Reason"
            hint="Why the room needs cleaning, for the history."
            control={
              <Input
                value={reason}
                maxLength={ROOM_STATUS_REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
              />
            }
          />
        ) : null}
        <Field
          label="Comment (optional)"
          control={
            <Textarea
              value={comment}
              maxLength={ROOM_STATUS_COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}
