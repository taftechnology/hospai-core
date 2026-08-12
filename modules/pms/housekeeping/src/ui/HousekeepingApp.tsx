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
};

export type HousekeepingAppProps = {
  propertyId: string;
  /** YYYY-MM-DD default for the board date control. */
  defaultBusinessDate: string;
  api: HousekeepingApi;
  classifyError?: (err: unknown) => { class?: string } | undefined;
};

export function HousekeepingApp({
  propertyId,
  defaultBusinessDate,
  api,
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

  const byRoom = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignmentsQuery.data?.assignments ?? []) {
      map.set(a.roomId, a.assigneeRef);
    }
    return map;
  }, [assignmentsQuery.data]);

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

  const roomsClass = roomsQuery.isError ? classifyError?.(roomsQuery.error)?.class : undefined;
  const assignClass = assignmentsQuery.isError
    ? classifyError?.(assignmentsQuery.error)?.class
    : undefined;

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
          {(roomsQuery.data?.rooms ?? []).map((room) => (
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
              <td>{byRoom.get(room.roomId) ?? '—'}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
