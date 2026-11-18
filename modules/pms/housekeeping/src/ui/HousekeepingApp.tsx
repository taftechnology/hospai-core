import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Card,
  CardContent,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  RoomStatus,
  Toolbar,
  roomStatusWord,
} from '@hospai/ui-kit';
import { Link, useLocation } from 'react-router';
import { useMemo, useState } from 'react';
import { HousekeepingInventory } from './HousekeepingInventory.js';
import { HousekeepingPriority } from './HousekeepingPriority.js';
import { HousekeepingNav } from './housekeeping-nav.js';
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

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function HousekeepingBoard({
  propertyId,
  defaultBusinessDate,
  api,
  canAssign,
  canReadRoster,
  canSetOoo = false,
  subtitle,
  format,
  formatError,
  isQueuedResult = provisionalResult,
  queuedCopy = QUEUED_COPY,
}: HousekeepingAppProps) {
  const readRoster = canReadRoster ?? canAssign;
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate);
  const [statusFilter, setStatusFilter] = useState('');
  const [floorFilter, setFloorFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [oooRoomId, setOooRoomId] = useState('');
  const [oooStart, setOooStart] = useState('');
  const [oooReturn, setOooReturn] = useState('');
  const [oooReason, setOooReason] = useState('');
  const [oooTicketAlert, setOooTicketAlert] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    intent: 'attention' | 'exception';
    text: string;
  } | null>(null);
  const [pendingOooRelease, setPendingOooRelease] = useState<{
    roomId: string;
    range: HousekeepingOooRange;
  } | null>(null);
  const queryClient = useQueryClient();

  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['housekeeping-assignments', propertyId, businessDate],
    queryFn: () => api.listHousekeepingAssignments(propertyId, businessDate),
  });

  const prioritiesQuery = useQuery({
    queryKey: ['housekeeping-priorities', propertyId, businessDate],
    queryFn: () => api.getHousekeepingPriorities(propertyId, businessDate),
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
    mutationFn: (input: { roomId: string; status: string }) =>
      api.updateRoomStatus(
        propertyId,
        input.roomId,
        input.status,
        `room-status:${input.roomId}:${input.status}`,
      ),
    onSuccess: async (result) => {
      if (isQueuedResult(result)) {
        setActionNotice({ intent: 'attention', text: queuedCopy });
      } else {
        setActionNotice(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
    },
    onError: (err) => {
      setActionNotice({
        intent: 'exception',
        text: formatError?.(err) ?? 'Could not update room status.',
      });
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
    mutationFn: (input: {
      roomId: string;
      startDate: string;
      endDate: string;
      oooId?: string;
      reason?: string;
    }) => {
      if (!api.setOooRange) throw new Error('setOooRange unavailable');
      return api.setOooRange(propertyId, input.roomId, {
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.oooId ? { oooId: input.oooId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: async (result, variables) => {
      if (isQueuedResult(result)) {
        setOooTicketAlert(false);
        setActionNotice({ intent: 'attention', text: queuedCopy });
      } else {
        setActionNotice(null);
        if (!variables.oooId) setOooTicketAlert(true);
      }
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
      await queryClient.invalidateQueries({ queryKey: ['maintenance-tickets', propertyId] });
    },
    onError: (err) => {
      setActionNotice({
        intent: 'exception',
        text: formatError?.(err) ?? 'Could not update the out-of-order range.',
      });
    },
  });

  const emptyRoster = canAssign && readRoster && rosterQuery.isSuccess && assignable.length === 0;
  const showPicker = canAssign && readRoster && assignable.length > 0;
  const formRoomId = oooRoomId || rooms[0]?.roomId || '';

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

        <CardContent flush>
          <DataTable data-testid="hk-board">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Room</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell>Assignee</DataTableHeaderCell>
                <DataTableHeaderCell />
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
                          // Server value, except while this room's own change is in flight.
                          value={
                            statusMutation.isPending &&
                            statusMutation.variables?.roomId === room.roomId
                              ? statusMutation.variables.status
                              : room.status
                          }
                          onChange={(e) => {
                            const status = e.target.value;
                            if (status !== room.status) {
                              statusMutation.mutate({ roomId: room.roomId, status });
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
                      {(room.oooRanges ?? []).map((range) => (
                        <div key={range.oooId}>
                          {range.startDate}–{range.endDate}
                          {range.reason ? ` ${range.reason}` : ''}
                          {canSetOoo ? (
                            <Button
                              type="button"
                              intent="ghost"
                              onClick={() =>
                                setPendingOooRelease({ roomId: room.roomId, range })
                              }
                            >
                              Release early
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </DataTableCell>
                    <DataTableCell>{assigneeLabel}</DataTableCell>
                    <DataTableCell>
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
            <form
              data-testid="hk-ooo-form"
              className="ui-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!formRoomId || !oooStart || !oooReturn) return;
                oooMutation.mutate({
                  roomId: formRoomId,
                  startDate: oooStart,
                  endDate: oooReturn,
                  reason: oooReason.trim() || undefined,
                });
              }}
            >
              <Field
                label="Room"
                control={
                  <NativeSelect
                    aria-label="OOO room"
                    value={formRoomId}
                    onChange={(e) => setOooRoomId(e.target.value)}
                  >
                    {rooms.map((room) => (
                      <option key={room.roomId} value={room.roomId}>
                        {room.code}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Field
                label="Start"
                control={
                  <Input
                    type="date"
                    aria-label="Start"
                    value={oooStart}
                    onChange={(e) => setOooStart(e.target.value)}
                  />
                }
              />
              <Field
                label="Return"
                control={
                  <Input
                    type="date"
                    aria-label="Return"
                    value={oooReturn}
                    onChange={(e) => setOooReturn(e.target.value)}
                  />
                }
              />
              <Field
                label="Reason"
                control={
                  <Input
                    aria-label="OOO reason"
                    value={oooReason}
                    onChange={(e) => setOooReason(e.target.value)}
                  />
                }
              />
              <Button type="submit" intent="primary">
                Set OOO
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {pendingOooRelease ? (
        <Dialog
          open
          title="Release this OOO range early?"
          onClose={() => setPendingOooRelease(null)}
          footer={
            <>
              <Button type="button" intent="default" onClick={() => setPendingOooRelease(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                onClick={() => {
                  const { roomId, range } = pendingOooRelease;
                  const defaultReturn =
                    businessDate > range.startDate
                      ? businessDate
                      : addOneDay(range.startDate);
                  oooMutation.mutate({
                    roomId,
                    oooId: range.oooId,
                    startDate: range.startDate,
                    endDate: defaultReturn,
                  });
                  setPendingOooRelease(null);
                }}
              >
                Release early
              </Button>
            </>
          }
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
