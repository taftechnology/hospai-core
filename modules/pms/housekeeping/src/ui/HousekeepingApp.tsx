import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

const STATUSES = ['clean', 'dirty', 'inspected', 'out_of_order'] as const;

export type HousekeepingRoom = {
  roomId: string;
  code: string;
  status: string;
};

export type HousekeepingAssignment = {
  roomId: string;
  assigneeRef: string;
};

export type HousekeepingRosterPerson = {
  staffId: string;
  displayName?: string;
  status: string;
  exitedAt: number | null;
  kinds: string[];
};

export type HousekeepingApi = {
  listRooms: (propertyId: string) => Promise<{ ok: true; rooms: HousekeepingRoom[] }>;
  listHousekeepingAssignments: (
    propertyId: string,
    businessDate: string,
  ) => Promise<{ ok: true; assignments: HousekeepingAssignment[] }>;
  updateRoomStatus: (
    propertyId: string,
    roomId: string,
    status: string,
    opId: string,
  ) => Promise<unknown>;
  listRoster: (
    propertyId: string,
    query?: { kind?: string },
  ) => Promise<{ ok: true; staff: HousekeepingRosterPerson[] }>;
  assignHousekeeping: (
    propertyId: string,
    input: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
  ) => Promise<unknown>;
};

export type HousekeepingAppProps = {
  propertyId: string;
  /** YYYY-MM-DD default for the board date control. */
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canAssign: boolean;
  classifyError?: (err: unknown) => { class?: string } | undefined;
};

function isAssignableHousekeeper(person: HousekeepingRosterPerson): boolean {
  return (
    person.status === 'active' &&
    person.exitedAt == null &&
    person.kinds.includes('housekeeper')
  );
}

export function HousekeepingApp({
  propertyId,
  defaultBusinessDate,
  api,
  canAssign,
  classifyError,
}: HousekeepingAppProps) {
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate);
  const queryClient = useQueryClient();

  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['housekeeping-assignments', propertyId, businessDate],
    queryFn: () => api.listHousekeepingAssignments(propertyId, businessDate),
  });

  const rosterQuery = useQuery({
    queryKey: ['roster', propertyId, 'housekeeper'],
    queryFn: () => api.listRoster(propertyId, { kind: 'housekeeper' }),
  });

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
        queryKey: ['housekeeping-assignments', propertyId, businessDate],
      });
    },
  });

  const roomsClass = roomsQuery.isError ? classifyError?.(roomsQuery.error)?.class : undefined;
  const assignClass = assignmentsQuery.isError
    ? classifyError?.(assignmentsQuery.error)?.class
    : undefined;

  const emptyRoster =
    canAssign && rosterQuery.isSuccess && assignable.length === 0;

  return (
    <div>
      <h1>Housekeeping</h1>
      <label>
        Business date{' '}
        <input
          type="date"
          value={businessDate}
          onChange={(e) => setBusinessDate(e.target.value)}
          data-testid="hk-business-date"
        />
      </label>

      {(roomsQuery.isError || assignmentsQuery.isError) && (
        <div className="error" role="alert">
          Unable to load housekeeping board
          {roomsClass === 'fail_closed' || assignClass === 'fail_closed'
            ? ' (property unreachable)'
            : ''}
          .
        </div>
      )}

      {emptyRoster && <p>No housekeepers on the roster</p>}

      <table data-testid="hk-board">
        <thead>
          <tr>
            <th>Room</th>
            <th>Status</th>
            <th>Assignee</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(roomsQuery.data?.rooms ?? []).map((room) => {
            const assigneeRef = byRoom.get(room.roomId);
            const assigneeLabel = assigneeRef
              ? (displayNameByStaffId.get(assigneeRef) ?? assigneeRef)
              : '—';
            return (
              <tr key={room.roomId}>
                <td>{room.code}</td>
                <td>
                  <select
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
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{assigneeLabel}</td>
                <td>
                  {canAssign && assignable.length > 0 ? (
                    <select
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
                    </select>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
