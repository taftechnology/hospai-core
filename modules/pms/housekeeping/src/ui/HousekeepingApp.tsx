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
  Field,
  Input,
  NativeSelect,
  PageHeader,
  RoomStatus,
  Toolbar,
  roomStatusWord,
} from '@hospai/ui-kit';
import { useLocation } from 'react-router';
import { useMemo, useState, type ReactNode } from 'react';
import { HousekeepingInventory } from './HousekeepingInventory.js';
import { HousekeepingPriority } from './HousekeepingPriority.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import { PRIORITY_LEVEL_LABEL } from './priority-labels.js';
import type {
  HousekeepingApi,
  HousekeepingFormDialogProps,
  HousekeepingRosterPerson,
} from './housekeeping-types.js';

export type {
  HousekeepingApi,
  HousekeepingAssignment,
  HousekeepingOooRange,
  HousekeepingRoom,
  HousekeepingRosterPerson,
} from './housekeeping-types.js';

const STATUSES = ['clean', 'dirty', 'inspected'] as const;

export type { HousekeepingFormDialogProps } from './housekeeping-types.js';

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
  /** Host form dialog (`.app-modal`). Inventory does not ship its own overlay. */
  Dialog?: (props: HousekeepingFormDialogProps) => ReactNode;
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
  classifyError,
  subtitle,
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

  const assignable = useMemo(
    () => (rosterQuery.data?.staff ?? []).filter(isAssignableHousekeeper),
    [rosterQuery.data],
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
    const counts = new Map<string, number>();
    for (const a of assignmentsQuery.data?.assignments ?? []) {
      counts.set(a.assigneeRef, (counts.get(a.assigneeRef) ?? 0) + 1);
    }
    const assignedRoomIds = new Set(
      (assignmentsQuery.data?.assignments ?? []).map((a) => a.roomId),
    );
    return {
      rows: [...counts.entries()].map(([staffId, count]) => ({
        staffId,
        label: displayNameByStaffId.get(staffId) ?? staffId,
        count,
      })),
      unassigned: rooms.length - assignedRoomIds.size,
    };
  }, [assignmentsQuery.data, displayNameByStaffId, rooms.length]);

  const statusMutation = useMutation({
    mutationFn: (input: { roomId: string; status: string }) =>
      api.updateRoomStatus(
        propertyId,
        input.roomId,
        input.status,
        `room-status:${input.roomId}:${input.status}`,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['housekeeping-priorities', propertyId, businessDate],
      });
      await queryClient.invalidateQueries({
        queryKey: ['housekeeping-assignments', propertyId, businessDate],
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rooms', propertyId] });
    },
  });

  const roomsClass = roomsQuery.isError ? classifyError?.(roomsQuery.error)?.class : undefined;
  const assignClass = assignmentsQuery.isError
    ? classifyError?.(assignmentsQuery.error)?.class
    : undefined;

  const emptyRoster = canAssign && readRoster && rosterQuery.isSuccess && assignable.length === 0;
  const showPicker = canAssign && readRoster && assignable.length > 0;
  const formRoomId = oooRoomId || rooms[0]?.roomId || '';

  const businessDateLabel = useMemo(() => {
    if (!businessDate) return '';
    const d = new Date(`${businessDate}T00:00:00Z`);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  }, [businessDate]);

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Housekeeping"
        subtitle={
          subtitle ?? (
            <>
              {businessDateLabel} <span className="sep">·</span> room status and assignments
            </>
          )
        }
      />
      <HousekeepingNav view="board" />
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
                Unable to load housekeeping board
                {roomsClass === 'fail_closed' || assignClass === 'fail_closed'
                  ? ' (property unreachable)'
                  : ''}
                .
              </Alert>
            )}

            {rosterQuery.isError && <Alert>Unable to load housekeepers</Alert>}

            <div data-testid="hk-workload" className="ui-metrics">
              {workload.rows.map((row) => (
                <span key={row.staffId} className="ui-metric">
                  {row.label}: {row.count}
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
                          defaultValue={room.status}
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
                              onClick={() => {
                                if (!window.confirm('Release this OOO range early?')) return;
                                const defaultReturn =
                                  businessDate > range.startDate
                                    ? businessDate
                                    : addOneDay(range.startDate);
                                oooMutation.mutate({
                                  roomId: room.roomId,
                                  oooId: range.oooId,
                                  startDate: range.startDate,
                                  endDate: defaultReturn,
                                });
                              }}
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
                          defaultValue=""
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
                              {person.displayName ?? person.staffId}
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
        Dialog={props.Dialog}
      />
    );
  }
  return <HousekeepingBoard {...props} />;
}
