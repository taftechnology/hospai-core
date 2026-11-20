import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Checkbox,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  RoomStatus,
  Toolbar,
  VisuallyHidden,
  roomStatusWord,
} from '@hospai/ui-kit';
import { Link, useLocation } from 'react-router';
import { useMemo, useState } from 'react';
import { useBusinessDate } from './use-business-date.js';
import { ROOMS_BULK_STATUS_MAX } from '@hospai/contracts';
import { HousekeepingInventory } from './HousekeepingInventory.js';
import { HousekeepingPriority } from './HousekeepingPriority.js';
import { HousekeepingTasks } from './HousekeepingTasks.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import { blockTimes, blockTypeLabel } from './housekeeping-labels.js';
import { OooBlockForm, OooReleaseDialog } from './OooBlockForms.js';
import { RoomOooHistoryDialog, RoomStatusHistoryDialog } from './RoomHistoryDialogs.js';
import { RoomStatusDialog, type RoomStatusTarget } from './RoomStatusDialog.js';
import {
  invalidateOooViews,
  invalidateStatusViews,
  oooReleaseDates,
  type OooBlockInput,
} from './ooo-block.js';
import { PRIORITY_LEVEL_LABEL } from './priority-labels.js';
import {
  assignPickerLabel,
  assignedCounts,
  sortAssignableHousekeepers,
} from './roster-assign-label.js';
import type { HousekeepingApi, HousekeepingOooRange, HousekeepingRosterPerson } from './housekeeping-types.js';

export type {
  HousekeepingApi,
  HousekeepingAssignment,
  HousekeepingOooRange,
  HousekeepingRoom,
  HousekeepingRosterPerson,
} from './housekeeping-types.js';

const STATUSES = ['clean', 'dirty', 'inspected'] as const;

const QUEUED_COPY = 'Request queued — will apply when the property is reachable.';

function provisionalResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result != null &&
    (result as { classified?: { class?: string } }).classified?.class === 'provisional'
  );
}

export type HousekeepingAppProps = {
  propertyId: string;
  /** YYYY-MM-DD default for the board date control. */
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canAssign: boolean;
  canReadRoster?: boolean;
  canSetOoo?: boolean;
  /** Name for a staff user id (history dialogs). Unknown ids show as "Staff member". */
  actorLabel?: (actor: string) => string | null | undefined;
  classifyError?: (err: unknown) => { class?: string } | undefined;
  /** Live property name, already composed by the host. */
  subtitle?: string;
  formatError?: (err: unknown) => string;
  /** Shared SPA helper. Defaults to the provisional-class check. */
  isQueuedResult?: (result: unknown) => boolean;
  queuedCopy?: string;
  format: {
    dateHeading: (iso: string) => string;
    dateTime: (ms: number) => string;
  };
};

function isAssignableHousekeeper(person: HousekeepingRosterPerson): boolean {
  return (
    person.status === 'active' &&
    person.exitedAt == null &&
    person.kinds.includes('housekeeper')
  );
}

function HousekeepingBoard({
  propertyId,
  defaultBusinessDate,
  api,
  canAssign,
  canReadRoster,
  canSetOoo = false,
  actorLabel,
  subtitle,
  format,
  formatError,
  isQueuedResult = provisionalResult,
  queuedCopy = QUEUED_COPY,
}: HousekeepingAppProps) {
  const readRoster = canReadRoster ?? canAssign;
  const [businessDate, setBusinessDate] = useBusinessDate(defaultBusinessDate);
  const [statusFilter, setStatusFilter] = useState('');
  const [floorFilter, setFloorFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [oooTicketAlert, setOooTicketAlert] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    intent: 'attention' | 'exception' | 'settled';
    text: string;
  } | null>(null);
  const [pendingOooRelease, setPendingOooRelease] = useState<{
    roomId: string;
    roomCode: string;
    range: HousekeepingOooRange;
  } | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  // One status change (or one batch) waiting for its reason and comment. `attemptId` keeps a
  // retry of this dialog on the same idempotency key and gives the next dialog a new one.
  const [pendingStatus, setPendingStatus] = useState<{
    rooms: RoomStatusTarget[];
    status: string;
    attemptId: string;
  } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('dirty');
  const [history, setHistory] = useState<{
    kind: 'status' | 'ooo';
    roomId: string;
    code: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['housekeeping-assignments', propertyId, businessDate],
    queryFn: () => api.listHousekeepingAssignments(propertyId, businessDate),
    enabled: Boolean(businessDate),
  });

  const prioritiesQuery = useQuery({
    queryKey: ['housekeeping-priorities', propertyId, businessDate],
    queryFn: () => api.getHousekeepingPriorities(propertyId, businessDate),
    enabled: Boolean(businessDate),
  });

  const rosterQuery = useQuery({
    queryKey: ['roster', propertyId, 'housekeeper'],
    queryFn: () => api.listRoster(propertyId, { kind: 'housekeeper' }),
  });

  const levelByRoom = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of prioritiesQuery.data?.queue ?? []) {
      if (row.level) map.set(row.roomId, PRIORITY_LEVEL_LABEL[row.level]);
    }
    return map;
  }, [prioritiesQuery.data]);

  const byRoom = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignmentsQuery.data?.assignments ?? []) {
      map.set(a.roomId, a.assigneeRef);
    }
    return map;
  }, [assignmentsQuery.data]);

  const displayNameByStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of rosterQuery.data?.staff ?? []) {
      if (person.displayName) map.set(person.staffId, person.displayName);
    }
    return map;
  }, [rosterQuery.data]);

  const counts = useMemo(
    () => assignedCounts(assignmentsQuery.data?.assignments ?? []),
    [assignmentsQuery.data],
  );

  const assignable = useMemo(
    () =>
      sortAssignableHousekeepers(
        (rosterQuery.data?.staff ?? []).filter(isAssignableHousekeeper),
        counts,
      ),
    [rosterQuery.data, counts],
  );

  const rooms = roomsQuery.data?.rooms ?? [];
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (statusFilter && room.status !== statusFilter) return false;
      if (floorFilter && (room.floor ?? '') !== floorFilter) return false;
      const assigned = byRoom.has(room.roomId);
      if (assignedFilter === 'assigned' && !assigned) return false;
      if (assignedFilter === 'unassigned' && assigned) return false;
      return true;
    });
  }, [rooms, statusFilter, floorFilter, assignedFilter, byRoom]);

  const workload = useMemo(() => {
    const assignedRoomIds = new Set(
      (assignmentsQuery.data?.assignments ?? []).map((a) => a.roomId),
    );
    const byId = new Map((rosterQuery.data?.staff ?? []).map((person) => [person.staffId, person]));
    return {
      rows: [...counts.entries()].map(([staffId, count]) => {
        const person = byId.get(staffId);
        return {
          staffId,
          label: person?.displayName ?? displayNameByStaffId.get(staffId) ?? staffId,
          count,
          maxRooms: person?.ops?.maxRooms ?? null,
        };
      }),
      unassigned: rooms.length - assignedRoomIds.size,
    };
  }, [assignmentsQuery.data, counts, displayNameByStaffId, rosterQuery.data, rooms.length]);

  const statusMutation = useMutation({
    mutationFn: (input: {
      rooms: RoomStatusTarget[];
      status: string;
      attemptId: string;
      reason?: string;
      comment?: string;
    }) => {
      const notes = {
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.comment ? { comment: input.comment } : {}),
      };
      if (input.rooms.length === 1) {
        return api.updateRoomStatus(
          propertyId,
          input.rooms[0]!.roomId,
          input.status,
          `room-status:${input.attemptId}`,
          notes,
        );
      }
      return api.bulkUpdateRoomStatus(
        propertyId,
        {
          updates: input.rooms.map((r) => ({ roomId: r.roomId, status: input.status })),
          ...notes,
        },
        `room-status-bulk:${input.attemptId}`,
      );
    },
    onSuccess: async (result, variables) => {
      if (isQueuedResult(result)) {
        setActionNotice({ intent: 'attention', text: queuedCopy });
      } else {
        const word = roomStatusWord(variables.status).toLowerCase();
        setActionNotice({
          intent: 'settled',
          text:
            variables.rooms.length === 1
              ? `Room ${variables.rooms[0]!.code} marked ${word}.`
              : `${variables.rooms.length} rooms marked ${word}.`,
        });
      }
      setPendingStatus(null);
      setStatusError(null);
      setSelected(new Set());
      await invalidateStatusViews(queryClient, propertyId);
    },
    onError: (err) => {
      setStatusError(formatError?.(err) ?? 'Could not update room status.');
    },
  });

  const assignMutation = useMutation({
    mutationFn: (input: { roomId: string; assigneeRef: string }) =>
      api.assignHousekeeping(propertyId, {
        roomId: input.roomId,
        businessDate,
        assigneeRef: input.assigneeRef,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async (result) => {
      if (isQueuedResult(result)) {
        setActionNotice({ intent: 'attention', text: queuedCopy });
      } else {
        setActionNotice(null);
      }
      await queryClient.invalidateQueries({
        queryKey: ['housekeeping-priorities', propertyId, businessDate],
      });
      await queryClient.invalidateQueries({
        queryKey: ['housekeeping-assignments', propertyId, businessDate],
      });
    },
    onError: (err) => {
      setActionNotice({
        intent: 'exception',
        text: formatError?.(err) ?? 'Could not assign the room.',
      });
    },
  });

  const oooMutation = useMutation({
    mutationFn: (input: OooBlockInput) => {
      if (!api.setOooRange) throw new Error('setOooRange unavailable');
      return api.setOooRange(propertyId, input.roomId, {
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.oooId ? { oooId: input.oooId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.blockType ? { blockType: input.blockType } : {}),
        ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
        ...(input.inspectionNotes !== undefined ? { inspectionNotes: input.inspectionNotes } : {}),
        ...(input.releaseReason ? { releaseReason: input.releaseReason } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async (result, variables) => {
      if (isQueuedResult(result)) {
        setOooTicketAlert(false);
        setActionNotice({ intent: 'attention', text: queuedCopy });
      } else {
        const code = rooms.find((r) => r.roomId === variables.roomId)?.code ?? '';
        setActionNotice({
          intent: 'settled',
          text: variables.releaseReason
            ? `Room ${code} is back in service.`
            : variables.oooId
              ? `Block for room ${code} saved.`
              : `Room ${code} is now out of order.`,
        });
        if (!variables.oooId) setOooTicketAlert(true);
      }
      setPendingOooRelease(null);
      setReleaseError(null);
      await invalidateOooViews(queryClient, propertyId);
    },
    onError: (err, variables) => {
      const text = formatError?.(err) ?? 'Could not update the out-of-order range.';
      if (variables.releaseReason) setReleaseError(text);
      else setActionNotice({ intent: 'exception', text });
    },
  });

  const emptyRoster = canAssign && readRoster && rosterQuery.isSuccess && assignable.length === 0;
  const showPicker = canAssign && readRoster && assignable.length > 0;
  const selectableRooms = filteredRooms.filter((r) => r.status !== 'out_of_order');
  const selectedRooms: RoomStatusTarget[] = rooms
    .filter((r) => selected.has(r.roomId) && r.status !== 'out_of_order')
    .map((r) => ({ roomId: r.roomId, code: r.code }));
  const bulkTooMany = selectedRooms.length > ROOMS_BULK_STATUS_MAX;

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Housekeeping"
        subtitle={
          subtitle ?? (
            <>
              {businessDate ? format.dateHeading(businessDate) : ''}{' '}
              <span className="sep">·</span> room status and assignments
            </>
          )
        }
      />
      <HousekeepingNav view="board" />
      {oooTicketAlert ? (
        <Alert intent="informational">
          Room is out of order. A maintenance ticket was opened.{' '}
          <Link to="/maintenance">View maintenance</Link>
        </Alert>
      ) : null}
      {actionNotice ? (
        <Alert intent={actionNotice.intent} data-testid="hk-action-notice">
          {actionNotice.text}
        </Alert>
      ) : null}
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="Business date"
            control={
              <Input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                data-testid="hk-business-date"
              />
            }
          />
          <Field
            size="sm"
            label="Filter status"
            control={
              <NativeSelect
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="clean">Clean</option>
                <option value="dirty">Dirty</option>
                <option value="inspected">Inspected</option>
                <option value="out_of_order">Out of order</option>
              </NativeSelect>
            }
          />
          <Field
            size="xs"
            label="Floor"
            control={
              <NativeSelect
                aria-label="Filter floor"
                value={floorFilter}
                onChange={(e) => setFloorFilter(e.target.value)}
              >
                <option value="">All</option>
                {[...new Set(rooms.map((r) => r.floor).filter((f): f is string => Boolean(f)))].map(
                  (floor) => (
                    <option key={floor} value={floor}>
                      {floor}
                    </option>
                  ),
                )}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Assignment"
            hint="Assignment only — use Status for clean/dirty."
            control={
              <NativeSelect
                aria-label="Filter assignment"
                value={assignedFilter}
                onChange={(e) => setAssignedFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="assigned">assigned</option>
                <option value="unassigned">unassigned</option>
              </NativeSelect>
            }
          />
        </Toolbar>

        <CardContent>
          <div className="ui-stack">
            {(roomsQuery.isError || assignmentsQuery.isError) && (
              <Alert>
                {roomsQuery.isError
                  ? (formatError?.(roomsQuery.error) ?? 'Unable to load housekeeping board.')
                  : (formatError?.(assignmentsQuery.error) ??
                    'Unable to load housekeeping board.')}
              </Alert>
            )}

            {rosterQuery.isError && <Alert>Unable to load housekeepers</Alert>}

            <div data-testid="hk-workload" className="ui-metrics">
              {workload.rows.map((row) => (
                <span key={row.staffId} className="ui-metric">
                  {row.label}: {row.maxRooms != null ? `${row.count} / ${row.maxRooms}` : row.count}
                  {row.maxRooms != null && row.count >= row.maxRooms ? (
                    <Badge rung="attention">Full</Badge>
                  ) : null}
                </span>
              ))}
              <span className="ui-metric">Unassigned: {workload.unassigned}</span>
              {emptyRoster ? <span>No housekeepers on the roster</span> : null}
            </div>
          </div>
        </CardContent>

        {selectedRooms.length > 0 ? (
          <CardContent>
            <div className="ui-row" data-testid="hk-bulk-bar">
              <span>
                {selectedRooms.length} {selectedRooms.length === 1 ? 'room' : 'rooms'} selected
              </span>
              <NativeSelect
                aria-label="Set selected rooms to"
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
              >
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {roomStatusWord(st)}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                intent="primary"
                disabled={bulkTooMany}
                onClick={() => {
                  setStatusError(null);
                  setPendingStatus({
                    rooms: selectedRooms,
                    status: bulkStatus,
                    attemptId: crypto.randomUUID(),
                  });
                }}
              >
                Change status
              </Button>
              <Button type="button" intent="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
              {bulkTooMany ? (
                <span>Select at most {ROOMS_BULK_STATUS_MAX} rooms at a time.</span>
              ) : null}
            </div>
          </CardContent>
        ) : null}

        <CardContent flush>
          <DataTable data-testid="hk-board">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>
                  <Checkbox
                    aria-label="Select all shown rooms"
                    checked={
                      selectableRooms.length > 0 &&
                      selectableRooms.every((r) => selected.has(r.roomId))
                    }
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const r of selectableRooms) {
                          if (on) next.add(r.roomId);
                          else next.delete(r.roomId);
                        }
                        return next;
                      });
                    }}
                  />
                </DataTableHeaderCell>
                <DataTableHeaderCell>Room</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>Assignee</DataTableHeaderCell>
                <DataTableHeaderCell>
                  <VisuallyHidden>Actions</VisuallyHidden>
                </DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {filteredRooms.map((room) => {
                const assigneeRef = byRoom.get(room.roomId);
                const assigneeLabel = assigneeRef
                  ? (displayNameByStaffId.get(assigneeRef) ?? assigneeRef)
                  : '—';
                return (
                  <DataTableRow key={room.roomId}>
                    <DataTableCell>
                      {room.status === 'out_of_order' ? null : (
                        <Checkbox
                          aria-label={`Select ${room.code}`}
                          checked={selected.has(room.roomId)}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(room.roomId);
                              else next.delete(room.roomId);
                              return next;
                            });
                          }}
                        />
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      <span className="ui-row">
                        {room.code}
                        {levelByRoom.get(room.roomId) ? (
                          <Badge rung="attention">{levelByRoom.get(room.roomId)}</Badge>
                        ) : null}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      {room.status === 'out_of_order' ? (
                        <RoomStatus status={room.status} />
                      ) : (
                        <NativeSelect
                          aria-label={`Status for ${room.code}`}
                          // Always the server value: a change waits in its dialog for the reason.
                          value={room.status}
                          onChange={(e) => {
                            const status = e.target.value;
                            if (status !== room.status) {
                              setStatusError(null);
                              setPendingStatus({
                                rooms: [{ roomId: room.roomId, code: room.code }],
                                status,
                                attemptId: crypto.randomUUID(),
                              });
                            }
                          }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {roomStatusWord(s)}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                      {(room.oooRanges ?? []).map((range) => {
                        const times = blockTimes(range.startTime, range.endTime);
                        return (
                          <div key={range.oooId}>
                            {format.dateHeading(range.startDate)} to {format.dateHeading(range.endDate)}
                            {range.reason ? ` ${range.reason}` : ''}
                            {' · '}
                            {blockTypeLabel(range.blockType)}
                            {times ? ` · ${times}` : ''}
                            {range.inspectionNotes ? ` · ${range.inspectionNotes}` : ''}
                            {canSetOoo ? (
                              <Button
                                type="button"
                                intent="ghost"
                                aria-label={`Release ${room.code} from out of order`}
                                onClick={() => {
                                  setReleaseError(null);
                                  setPendingOooRelease({
                                    roomId: room.roomId,
                                    roomCode: room.code,
                                    range,
                                  });
                                }}
                              >
                                Release early
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              intent="ghost"
                              aria-label={`Block history for ${room.code}`}
                              onClick={() =>
                                setHistory({ kind: 'ooo', roomId: room.roomId, code: room.code })
                              }
                            >
                              Block history
                            </Button>
                          </div>
                        );
                      })}
                    </DataTableCell>
                    <DataTableCell>{assigneeLabel}</DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        intent="ghost"
                        aria-label={`Status history for ${room.code}`}
                        onClick={() =>
                          setHistory({ kind: 'status', roomId: room.roomId, code: room.code })
                        }
                      >
                        History
                      </Button>
                      {showPicker ? (
                        <NativeSelect
                          aria-label={`Assign ${room.code}`}
                          value={
                            assigneeRef &&
                            assignable.some((person) => person.staffId === assigneeRef)
                              ? assigneeRef
                              : ''
                          }
                          onChange={(e) => {
                            const assignee = e.target.value;
                            if (assignee) {
                              assignMutation.mutate({
                                roomId: room.roomId,
                                assigneeRef: assignee,
                              });
                            }
                          }}
                        >
                          <option value="" disabled>
                            Assign
                          </option>
                          {assignable.map((person) => (
                            <option key={person.staffId} value={person.staffId}>
                              {assignPickerLabel(person, counts.get(person.staffId) ?? 0)}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                );
              })}
            </DataTableBody>
          </DataTable>
        </CardContent>
      </Card>

      {canSetOoo ? (
        <Card>
          <CardContent>
            <OooBlockForm
              rooms={rooms}
              busy={oooMutation.isPending}
              onSubmit={(input) => oooMutation.mutate(input)}
            />
          </CardContent>
        </Card>
      ) : null}
      {pendingOooRelease ? (
        <OooReleaseDialog
          roomCode={pendingOooRelease.roomCode}
          busy={oooMutation.isPending}
          error={releaseError}
          onClose={() => setPendingOooRelease(null)}
          onSubmit={(releaseReason) => {
            const { roomId, range } = pendingOooRelease;
            oooMutation.mutate({
              roomId,
              oooId: range.oooId,
              ...oooReleaseDates(range, businessDate),
              releaseReason,
            });
          }}
        />
      ) : null}
      {pendingStatus ? (
        <RoomStatusDialog
          // A new dialog starts with empty fields.
          key={pendingStatus.attemptId}
          status={pendingStatus.status}
          rooms={pendingStatus.rooms}
          busy={statusMutation.isPending}
          error={statusError}
          onClose={() => setPendingStatus(null)}
          onSubmit={(notes) => statusMutation.mutate({ ...pendingStatus, ...notes })}
        />
      ) : null}
      {history?.kind === 'status' ? (
        <RoomStatusHistoryDialog
          propertyId={propertyId}
          roomId={history.roomId}
          roomCode={history.code}
          api={api}
          format={format}
          formatError={formatError}
          actorLabel={actorLabel}
          onClose={() => setHistory(null)}
        />
      ) : null}
      {history?.kind === 'ooo' ? (
        <RoomOooHistoryDialog
          propertyId={propertyId}
          roomId={history.roomId}
          roomCode={history.code}
          api={api}
          format={format}
          formatError={formatError}
          actorLabel={actorLabel}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}

export function HousekeepingApp(props: HousekeepingAppProps) {
  const location = useLocation();
  const readRoster = props.canReadRoster ?? props.canAssign;
  if (location.pathname.endsWith('/priority')) {
    return (
      <HousekeepingPriority
        propertyId={props.propertyId}
        defaultBusinessDate={props.defaultBusinessDate}
        api={props.api}
        canAssign={props.canAssign}
        canReadRoster={readRoster}
        subtitle={props.subtitle}
        formatError={props.formatError}
        isQueuedResult={props.isQueuedResult}
        queuedCopy={props.queuedCopy}
      />
    );
  }
  if (location.pathname.endsWith('/tasks')) {
    return (
      <HousekeepingTasks
        propertyId={props.propertyId}
        defaultBusinessDate={props.defaultBusinessDate}
        api={props.api}
        canWrite={props.canAssign}
        canReadRoster={readRoster}
        subtitle={props.subtitle}
        formatError={props.formatError}
        format={props.format}
      />
    );
  }
  if (location.pathname.endsWith('/inventory')) {
    return (
      <HousekeepingInventory
        propertyId={props.propertyId}
        api={props.api}
        canAssign={props.canAssign}
        subtitle={props.subtitle}
        formatError={props.formatError}
        format={props.format}
      />
    );
  }
  return <HousekeepingBoard {...props} />;
}
