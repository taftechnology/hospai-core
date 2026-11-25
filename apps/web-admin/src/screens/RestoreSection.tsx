import type { PropertyRestoreRow } from '@hospai/contracts';
import { RESTORE_WINDOW_DAYS } from '@hospai/contracts';
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  SectionLabel,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { usePropertyRestores, useOpsWrite } from '../api/hooks.js';
import { opsKeys } from '../api/keys.js';
import { LoadFailure, LoadingBlock } from '../components/common.js';
import { WriteDialog } from '../components/write.js';
import { formatInZone, zonedLocalToEpoch } from '../format.js';

/** What a restore does not fix (spec §5). Shown in plain words before the operator can submit. */
export const RESTORE_NOT_REWOUND = [
  'Payments taken at the payment provider, and invoices already issued, stay as they are.',
  'Guest records in the customer’s guest vault, uploaded documents, Form C submissions and accounting exports are not rewound.',
  'Anything the hotel did after the restore time is lost: reservations, check-ins, folio postings, rate changes. Tell the hotel which business dates to re-check.',
  'If the restore crosses a night audit, the hotel’s open business date moves back and the next audit runs from there.',
] as const;

const NOT_SUSPENDED_REASON = 'Suspend the customer first. A hotel can only be restored while its customer is suspended.';

const statusRung = (s: PropertyRestoreRow['status']) => (s === 'fenced' ? 'settled' : s === 'failed' ? 'exception' : 'attention');
const statusWord: Record<PropertyRestoreRow['status'], string> = {
  pending: 'Starting',
  restored: 'Applied, finishing',
  fenced: 'Done',
  failed: 'Failed',
};

type Props = { propertyId: string; isAdmin: boolean };

/** "Restores" for one hotel: the ledger, the restore action and Undo. The action is for ops_admin only. */
export function RestoreSection({ propertyId, isAdmin }: Props) {
  const q = usePropertyRestores(propertyId);
  const [dialog, setDialog] = useState<{ kind: 'restore' } | { kind: 'undo'; row: PropertyRestoreRow } | null>(null);

  if (q.isPending) return <LoadingBlock label="Loading restores" />;
  if (q.isError) return <LoadFailure error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data;
  const suspended = data.orgStatus === 'suspended';
  const tz = data.timeZone;

  return (
    <section className="ops-section" aria-label="Restores">
      <SectionLabel>Restores</SectionLabel>
      {isAdmin ? (
        <div className="ops-restore-actions">
          <Button intent="destructive" disabled={!suspended} onClick={() => setDialog({ kind: 'restore' })}>
            Restore to a point in time
          </Button>
          {suspended ? null : <p className="ops-restore-reason">{NOT_SUSPENDED_REASON}</p>}
        </div>
      ) : null}
      {data.restores.length === 0 ? (
        <EmptyState title="No restore has been run for this hotel" />
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>When</DataTableHeaderCell>
              <DataTableHeaderCell>Kind</DataTableHeaderCell>
              <DataTableHeaderCell>Restored to</DataTableHeaderCell>
              <DataTableHeaderCell>Status</DataTableHeaderCell>
              <DataTableHeaderCell>Operator</DataTableHeaderCell>
              <DataTableHeaderCell>Reason</DataTableHeaderCell>
              {isAdmin ? <DataTableHeaderCell>Undo</DataTableHeaderCell> : null}
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {data.restores.map((r) => (
              <DataTableRow key={r.restoreId}>
                <DataTableCell>{formatInZone(r.createdAt, tz)}</DataTableCell>
                <DataTableCell>{r.kind === 'undo' ? 'Undo' : 'Restore'}</DataTableCell>
                <DataTableCell>
                  {r.targetTime === null ? 'Before the restore it undoes' : formatInZone(r.targetTime, tz)}
                </DataTableCell>
                <DataTableCell>
                  <Badge rung={statusRung(r.status)}>{statusWord[r.status]}</Badge>
                </DataTableCell>
                <DataTableCell>{r.operatorName}</DataTableCell>
                <DataTableCell>{r.reason}</DataTableCell>
                {isAdmin ? (
                  <DataTableCell>
                    {r.canUndo ? (
                      <Button disabled={!suspended} onClick={() => setDialog({ kind: 'undo', row: r })}>
                        Undo
                      </Button>
                    ) : null}
                  </DataTableCell>
                ) : null}
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
      {isAdmin && !suspended && data.restores.some((r) => r.canUndo) ? (
        <p className="ops-restore-reason">Undo needs the customer to be suspended too.</p>
      ) : null}
      {dialog?.kind === 'restore' ? <RestoreDialog propertyId={propertyId} timeZone={tz} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'undo' ? (
        <UndoDialog propertyId={propertyId} timeZone={tz} row={dialog.row} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

function useRestoreWrite(propertyId: string) {
  return useOpsWrite(`/properties/${encodeURIComponent(propertyId)}/restore`, () => [
    opsKeys.restores(propertyId),
    opsKeys.health(propertyId),
    opsKeys.actionsAll(),
  ]);
}

function NotRewoundWarning() {
  return (
    <Alert intent="attention">
      <AlertTitle>What a restore does not fix</AlertTitle>
      <ul className="ops-checklist">
        {RESTORE_NOT_REWOUND.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Alert>
  );
}

function ConfirmIdField({ propertyId, value, onChange }: { propertyId: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label={`Type the hotel id to confirm: ${propertyId}`}
      size="lg"
      control={<Input value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />}
    />
  );
}

function RestoreDialog({ propertyId, timeZone, onClose }: { propertyId: string; timeZone: string; onClose: () => void }) {
  const write = useRestoreWrite(propertyId);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [confirm, setConfirm] = useState('');
  return (
    <WriteDialog
      title="Restore to a point in time"
      submitLabel="Restore this hotel"
      doneText="The hotel was restored. Check it, then reinstate the customer."
      write={write}
      destructive
      onClose={onClose}
      build={() => {
        if (!date || !time) return { error: 'Choose the date and the time to restore to.' };
        const targetTime = zonedLocalToEpoch(`${date}T${time}`, timeZone);
        if (targetTime === null) return { error: 'That date and time is not valid.' };
        if (targetTime >= Date.now()) return { error: 'Choose a date and time in the past.' };
        if (confirm !== propertyId) return { error: 'Type the hotel id exactly as shown to confirm.' };
        return { payload: { targetTime, confirmPropertyId: confirm } };
      }}
      intro={
        <p>
          Rewinds this one hotel to how it was at the time you choose, within the last {RESTORE_WINDOW_DAYS} days. It cannot go back past a
          recorded erasure or purge. The customer stays suspended until you reinstate it.
        </p>
      }
    >
      <Field
        label={`Restore to: date (hotel time, ${timeZone})`}
        hint="Date and time are on the hotel’s own clock."
        size="md"
        control={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      />
      <Field
        label="Restore to: time"
        size="md"
        control={<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
      />
      <NotRewoundWarning />
      <ConfirmIdField propertyId={propertyId} value={confirm} onChange={setConfirm} />
    </WriteDialog>
  );
}

function UndoDialog({
  propertyId,
  timeZone,
  row,
  onClose,
}: {
  propertyId: string;
  timeZone: string;
  row: PropertyRestoreRow;
  onClose: () => void;
}) {
  const write = useRestoreWrite(propertyId);
  const [confirm, setConfirm] = useState('');
  return (
    <WriteDialog
      title="Undo this restore"
      submitLabel="Undo the restore"
      doneText="The restore was undone. Check the hotel, then reinstate the customer."
      write={write}
      destructive
      onClose={onClose}
      build={() => {
        if (confirm !== propertyId) return { error: 'Type the hotel id exactly as shown to confirm.' };
        return { payload: { undoOf: row.restoreId, confirmPropertyId: confirm } };
      }}
      intro={
        <p>
          Puts the hotel back as it was just before the restore
          {row.targetTime !== null ? ` to ${formatInZone(row.targetTime, timeZone)}` : ''}. Anything the hotel did since is lost.
        </p>
      }
    >
      <NotRewoundWarning />
      <ConfirmIdField propertyId={propertyId} value={confirm} onChange={setConfirm} />
    </WriteDialog>
  );
}
