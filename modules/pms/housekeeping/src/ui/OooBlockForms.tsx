import {
  OOO_INSPECTION_NOTES_MAX,
  OOO_RELEASE_REASON_MAX,
  type OooBlockType,
} from '@hospai/contracts';
import { Alert, Button, Dialog, Field, FieldGroup, Input, NativeSelect, Textarea } from '@hospai/ui-kit';
import { useState } from 'react';
import { BLOCK_TYPE_LABEL } from './housekeeping-labels.js';
import type { HousekeepingOooRange } from './housekeeping-types.js';
import { OOO_BLOCK_TYPE_OPTIONS, editEndsBlockToday, type OooBlockInput } from './ooo-block.js';

type RoomOption = { roomId: string; code: string };

type FormValues = {
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string;
  blockType: OooBlockType;
  startTime: string;
  endTime: string;
  inspectionNotes: string;
};

function toInput(v: FormValues, oooId?: string): OooBlockInput {
  return {
    roomId: v.roomId,
    startDate: v.startDate,
    endDate: v.endDate,
    ...(oooId ? { oooId } : {}),
    ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
    blockType: v.blockType,
    // On an edit an empty field clears the value; on a create null is the same as omitted.
    startTime: v.startTime || null,
    endTime: v.endTime || null,
    inspectionNotes: v.inspectionNotes.trim() || null,
  };
}

function BlockFields({
  values,
  set,
  showRoom,
  rooms,
}: {
  values: FormValues;
  set: (patch: Partial<FormValues>) => void;
  showRoom: boolean;
  rooms: readonly RoomOption[];
}) {
  return (
    <FieldGroup inline>
      {showRoom ? (
        <Field
          label="Room"
          control={
            <NativeSelect
              aria-label="OOO room"
              value={values.roomId}
              onChange={(e) => set({ roomId: e.target.value })}
            >
              {rooms.map((room) => (
                <option key={room.roomId} value={room.roomId}>
                  {room.code}
                </option>
              ))}
            </NativeSelect>
          }
        />
      ) : null}
      <Field
        label="Start"
        control={
          <Input
            type="date"
            aria-label="Start"
            value={values.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        }
      />
      <Field
        label="Return"
        control={
          <Input
            type="date"
            aria-label="Return"
            value={values.endDate}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        }
      />
      <Field
        label="Block type"
        control={
          <NativeSelect
            aria-label="Block type"
            value={values.blockType}
            onChange={(e) => set({ blockType: e.target.value as OooBlockType })}
          >
            {OOO_BLOCK_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <Field
        size="sm"
        label="From time (optional)"
        control={
          <Input
            type="time"
            aria-label="From time"
            value={values.startTime}
            onChange={(e) => set({ startTime: e.target.value })}
          />
        }
      />
      <Field
        size="sm"
        label="Until time (optional)"
        control={
          <Input
            type="time"
            aria-label="Until time"
            value={values.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
          />
        }
      />
      <Field
        label="Reason"
        control={
          <Input
            aria-label="OOO reason"
            value={values.reason}
            maxLength={256}
            onChange={(e) => set({ reason: e.target.value })}
          />
        }
      />
      <Field
        size="full"
        label="Inspection notes (optional)"
        control={
          <Textarea
            aria-label="Inspection notes"
            value={values.inspectionNotes}
            maxLength={OOO_INSPECTION_NOTES_MAX}
            onChange={(e) => set({ inspectionNotes: e.target.value })}
          />
        }
      />
    </FieldGroup>
  );
}

const EMPTY: Omit<FormValues, 'roomId'> = {
  startDate: '',
  endDate: '',
  reason: '',
  blockType: 'maintenance',
  startTime: '',
  endTime: '',
  inspectionNotes: '',
};

/** Create a block. Times are for display and audit; the ledger still blocks whole nights. */
export function OooBlockForm({
  rooms,
  busy,
  onSubmit,
}: {
  rooms: readonly RoomOption[];
  busy?: boolean;
  onSubmit: (input: OooBlockInput) => void;
}) {
  const [values, setValues] = useState<FormValues>({ ...EMPTY, roomId: '' });
  const roomId = values.roomId || rooms[0]?.roomId || '';
  return (
    <form
      data-testid="hk-ooo-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!roomId || !values.startDate || !values.endDate) return;
        onSubmit(toInput({ ...values, roomId }));
      }}
    >
      <div className="ui-stack">
        <BlockFields
          values={{ ...values, roomId }}
          set={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          showRoom
          rooms={rooms}
        />
        <div>
          <Button type="submit" intent="primary" disabled={busy}>
            Set OOO
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Edit a running or future block. Ending it on or before today is a release, and needs a reason. */
export function OooBlockEditDialog({
  roomId,
  roomCode,
  range,
  today,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  roomId: string;
  roomCode: string;
  range: HousekeepingOooRange;
  today: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (input: OooBlockInput) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<FormValues>({
    roomId,
    startDate: range.startDate,
    endDate: range.endDate,
    reason: range.reason ?? '',
    blockType: range.blockType ?? 'maintenance',
    startTime: range.startTime ?? '',
    endTime: range.endTime ?? '',
    inspectionNotes: range.inspectionNotes ?? '',
  });
  const endsToday = editEndsBlockToday(range, values.endDate, today);
  const invalid =
    !values.startDate || !values.endDate || values.endDate <= values.startDate || endsToday;

  function submit() {
    if (invalid || busy) return;
    onSubmit(toInput(values, range.oooId));
  }
  return (
    <Dialog
      open
      wide
      title={`Edit out-of-order block · Room ${roomCode}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || invalid} onClick={submit}>
            Save block
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {endsToday ? (
          <Alert intent="attention">To end this block today or earlier, release it instead.</Alert>
        ) : null}
        <BlockFields
          values={values}
          set={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          showRoom={false}
          rooms={[]}
        />
      </form>
    </Dialog>
  );
}

/** Releasing a block always needs a reason, kept in the block's history. */
export function OooReleaseDialog({
  roomCode,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  roomCode: string;
  busy: boolean;
  error?: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const missing = !reason.trim();

  function submit() {
    if (missing || busy) return;
    onSubmit(reason.trim());
  }

  return (
    <Dialog
      open
      title={`Release room ${roomCode} from out of order?`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || missing} onClick={submit}>
            Release room
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-ooo-release"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <Field
          label="Release reason"
          hint="Kept in the block history."
          control={
            <Input
              value={reason}
              maxLength={OOO_RELEASE_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}
