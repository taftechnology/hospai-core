import { useQuery } from '@tanstack/react-query';
import type { RoomOooEventRow, RoomStatusHistoryRow } from '@hospai/contracts';
import {
  Alert,
  Button,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Dialog,
  EmptyState,
  SectionLabel,
  Skeleton,
  roomStatusWord,
} from '@hospai/ui-kit';
import {
  OOO_EVENT_LABEL,
  blockTimes,
  blockTypeLabel,
  eventBy,
  statusChangeBy,
} from './housekeeping-labels.js';
import type { HousekeepingApi } from './housekeeping-types.js';

export type HistoryDialogProps = {
  propertyId: string;
  roomId: string;
  roomCode: string;
  api: HousekeepingApi;
  format: { dateHeading: (iso: string) => string; dateTime: (ms: number) => string };
  formatError?: (err: unknown) => string;
  /** Name for a staff user id; unknown ids show as "Staff member". */
  actorLabel?: (actor: string) => string | null | undefined;
  onClose: () => void;
};

export function roomStatusHistoryKey(propertyId: string, roomId: string) {
  return ['room-status-history', propertyId, roomId] as const;
}

export function roomOooHistoryKey(propertyId: string, roomId: string) {
  return ['room-ooo-history', propertyId, roomId] as const;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button type="button" onClick={onClose}>
      Close
    </Button>
  );
}

export function RoomStatusHistoryDialog({
  propertyId,
  roomId,
  roomCode,
  api,
  format,
  formatError,
  actorLabel,
  onClose,
}: HistoryDialogProps) {
  const query = useQuery({
    queryKey: roomStatusHistoryKey(propertyId, roomId),
    queryFn: () => api.getRoomStatusHistory(propertyId, roomId),
  });
  const rows: RoomStatusHistoryRow[] = query.data?.history ?? [];
  return (
    <Dialog
      open
      wide
      title={`Status history · Room ${roomCode}`}
      onClose={onClose}
      footer={<CloseButton onClose={onClose} />}
    >
      <div data-testid="hk-status-history">
        {query.isLoading ? <Skeleton label="Loading status history" /> : null}
        {query.isError ? (
          <Alert intent="exception">
            {formatError?.(query.error) ?? 'Could not load the status history.'}
          </Alert>
        ) : null}
        {query.isSuccess && rows.length === 0 ? (
          <EmptyState title="No status changes recorded for this room yet." />
        ) : null}
        {rows.length > 0 ? (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>When</DataTableHeaderCell>
                <DataTableHeaderCell>Change</DataTableHeaderCell>
                <DataTableHeaderCell>Reason or comment</DataTableHeaderCell>
                <DataTableHeaderCell>By</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {rows.map((row) => (
                <DataTableRow key={row.historyId}>
                  <DataTableCell>{format.dateTime(row.createdAt)}</DataTableCell>
                  <DataTableCell>
                    {roomStatusWord(row.fromStatus)} → {roomStatusWord(row.toStatus)}
                  </DataTableCell>
                  <DataTableCell>
                    {[row.reason, row.comment].filter(Boolean).join(' · ') || '—'}
                  </DataTableCell>
                  <DataTableCell>{statusChangeBy(row.source, row.actor, actorLabel)}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        ) : null}
      </div>
      <div className="ui-stack">
        <SectionLabel>Out-of-order blocks</SectionLabel>
        <OooEventsSection
          propertyId={propertyId}
          roomId={roomId}
          api={api}
          format={format}
          formatError={formatError}
          actorLabel={actorLabel}
        />
      </div>
    </Dialog>
  );
}

function snapshotText(
  snap: Record<string, unknown> | null,
  format: HistoryDialogProps['format'],
): string {
  if (!snap) return '—';
  const start = typeof snap.startDate === 'string' ? snap.startDate : '';
  const end = typeof snap.endDate === 'string' ? snap.endDate : '';
  const parts = [
    start && end ? `${format.dateHeading(start)} to ${format.dateHeading(end)}` : '',
    blockTypeLabel(snap.blockType as string | undefined),
    blockTimes(snap.startTime as string | null, snap.endTime as string | null),
  ].filter(Boolean);
  return parts.join(' · ');
}

function notesText(event: RoomOooEventRow): string {
  const snap = event.after ?? event.before;
  const parts: string[] = [];
  if (event.reason) parts.push(event.reason);
  const notes = snap && typeof snap.inspectionNotes === 'string' ? snap.inspectionNotes : '';
  if (notes) parts.push(`Inspection: ${notes}`);
  return parts.join(' · ') || '—';
}

function OooEventsSection({
  propertyId,
  roomId,
  api,
  format,
  formatError,
  actorLabel,
}: Omit<HistoryDialogProps, 'roomCode' | 'onClose'>) {
  const query = useQuery({
    queryKey: roomOooHistoryKey(propertyId, roomId),
    queryFn: () => api.getRoomOooHistory(propertyId, roomId),
  });
  const events = query.data?.events ?? [];
  return (
    <div data-testid="hk-ooo-history">
      {query.isLoading ? <Skeleton label="Loading out-of-order history" /> : null}
      {query.isError ? (
        <Alert intent="exception">
          {formatError?.(query.error) ?? 'Could not load the out-of-order history.'}
        </Alert>
      ) : null}
      {query.isSuccess && events.length === 0 ? (
        <EmptyState title="No out-of-order blocks recorded for this room yet." />
      ) : null}
      {events.length > 0 ? (
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>When</DataTableHeaderCell>
              <DataTableHeaderCell>What happened</DataTableHeaderCell>
              <DataTableHeaderCell>Block</DataTableHeaderCell>
              <DataTableHeaderCell>Reason and notes</DataTableHeaderCell>
              <DataTableHeaderCell>By</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {events.map((event) => (
              <DataTableRow key={event.eventId}>
                <DataTableCell>{format.dateTime(event.at)}</DataTableCell>
                <DataTableCell>{OOO_EVENT_LABEL[event.kind]}</DataTableCell>
                <DataTableCell>
                  {event.kind === 'updated' && event.before
                    ? `${snapshotText(event.before, format)} → ${snapshotText(event.after, format)}`
                    : snapshotText(event.after ?? event.before, format)}
                </DataTableCell>
                <DataTableCell>{notesText(event)}</DataTableCell>
                <DataTableCell>{eventBy(event.actor, actorLabel)}</DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : null}
    </div>
  );
}

export function RoomOooHistoryDialog(props: HistoryDialogProps) {
  return (
    <Dialog
      open
      wide
      title={`Out-of-order history · Room ${props.roomCode}`}
      onClose={props.onClose}
      footer={<CloseButton onClose={props.onClose} />}
    >
      <OooEventsSection {...props} />
    </Dialog>
  );
}
