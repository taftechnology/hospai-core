import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_REQUEST_CANCEL_REASON_MAX,
  HK_REQUEST_NOTE_MAX,
  HK_REQUEST_RESOLUTION_MAX,
  HK_REQUEST_SEARCH_MAX,
  HOUSEKEEPING_REQUEST_DEPARTMENTS,
  HOUSEKEEPING_REQUEST_STATUSES,
  type HousekeepingRequestDepartment,
  type HousekeepingRequestListRow,
  type HousekeepingRequestRow,
  type HousekeepingRequestStatus,
  type HousekeepingRequestType,
} from '@hospai/contracts';
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
  Dialog,
  EmptyState,
  Field,
  FieldGroup,
  Input,
  Metric,
  Metrics,
  NativeSelect,
  PageHeader,
  RowActions,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useState } from 'react';
import {
  GuestLink,
  StayPicker,
  activeStaff,
  staffName,
  useGuestLabels,
  useStaffRoster,
} from './depth-shared.js';
import {
  REQUEST_DEPARTMENT_LABEL,
  REQUEST_STATUS_LABEL,
  requestTypeLabel,
  wordFor,
} from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingGuests } from './housekeeping-types.js';

export type RequestFilters = {
  from: string;
  to: string;
  status: string;
  department: string;
  roomId: string;
  search: string;
};

export function housekeepingRequestsKey(propertyId: string, f: RequestFilters) {
  return [
    'housekeeping-requests',
    propertyId,
    f.from,
    f.to,
    f.status,
    f.department,
    f.roomId,
    f.search,
  ] as const;
}

export const NO_REQUEST_FILTERS: RequestFilters = {
  from: '',
  to: '',
  status: '',
  department: '',
  roomId: '',
  search: '',
};

export function requestsQueryInput(f: RequestFilters) {
  return {
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.department ? { department: f.department } : {}),
    ...(f.roomId ? { roomId: f.roomId } : {}),
    ...(f.search ? { search: f.search } : {}),
  };
}

function statusRung(status: HousekeepingRequestStatus): 'neutral' | 'informational' | 'settled' | 'attention' {
  if (status === 'in_progress') return 'informational';
  if (status === 'resolved') return 'settled';
  if (status === 'cancelled') return 'neutral';
  return 'attention';
}

function takesAssignee(department: HousekeepingRequestDepartment): 'housekeeper' | 'maintenance' | null {
  if (department === 'housekeeping') return 'housekeeper';
  if (department === 'maintenance') return 'maintenance';
  return null;
}

type RoomOption = { roomId: string; code: string };

type NewValues = {
  roomId: string;
  reservationId: string;
  requestType: string;
  department: HousekeepingRequestDepartment;
  assigneeRef: string;
  businessDate: string;
  note: string;
};

/**
 * The create form. Used by the Requests tab (any room) and, through `GuestRequestDialog`, by the
 * desk (room and stay prefilled and fixed). Nothing here stores a name.
 */
export function NewRequestDialog({
  propertyId,
  api,
  guests,
  rooms,
  requestTypes,
  lockedRoom,
  defaultBusinessDate,
  canReadRoster,
  confirmInDialog = false,
  formatError,
  onCreated,
  onClose,
}: {
  propertyId: string;
  api: HousekeepingApi;
  guests?: HousekeepingGuests;
  rooms: readonly RoomOption[];
  requestTypes: readonly HousekeepingRequestType[];
  lockedRoom?: { roomId: string; code: string; reservationId?: string | null };
  defaultBusinessDate: string;
  canReadRoster: boolean;
  /** Desk mode: keep the dialog open and show a settled notice instead of closing. */
  confirmInDialog?: boolean;
  formatError?: (err: unknown) => string;
  onCreated?: (request: HousekeepingRequestRow) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const firstType = requestTypes[0];
  const [values, setValues] = useState<NewValues>({
    roomId: lockedRoom?.roomId ?? rooms[0]?.roomId ?? '',
    reservationId: lockedRoom?.reservationId ?? '',
    requestType: firstType?.code ?? '',
    department: firstType?.department ?? 'housekeeping',
    assigneeRef: '',
    businessDate: defaultBusinessDate,
    note: '',
  });
  const [deptTouched, setDeptTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<HousekeepingRequestRow | null>(null);
  const set = (patch: Partial<NewValues>) => setValues((prev) => ({ ...prev, ...patch }));

  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard) && !lockedRoom,
    retry: false,
  });
  const stayRefs = (board.data?.rooms ?? []).flatMap((r) => (r.inHouse ? [r.inHouse.guestRef] : []));
  const labelFor = useGuestLabels(propertyId, guests, stayRefs);

  const kind = takesAssignee(values.department);
  const attendants = kind ? activeStaff(roster.staff, kind) : [];
  const missing = !values.roomId || !values.requestType || !values.businessDate;

  const mutation = useMutation({
    mutationFn: (v: NewValues) =>
      api.createHousekeepingRequest(
        propertyId,
        {
          businessDate: v.businessDate,
          roomId: v.roomId,
          requestType: v.requestType,
          department: v.department,
          ...(v.reservationId ? { reservationId: v.reservationId } : {}),
          ...(v.note.trim() ? { note: v.note.trim() } : {}),
          ...(v.assigneeRef && takesAssignee(v.department) ? { assigneeRef: v.assigneeRef } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (result) => {
      setError(null);
      const request = (result as { body?: { request?: HousekeepingRequestRow } }).body?.request;
      await queryClient.invalidateQueries({ queryKey: ['housekeeping-requests', propertyId] });
      if (request) onCreated?.(request);
      if (confirmInDialog && request) setCreated(request);
      else onClose();
    },
    onError: (err) => setError(formatError?.(err) ?? 'Could not log the request.'),
  });

  function submit() {
    if (missing || mutation.isPending) return;
    mutation.mutate(values);
  }

  const roomCode = lockedRoom?.code ?? rooms.find((r) => r.roomId === values.roomId)?.code ?? '';

  if (created) {
    return (
      <Dialog
        open
        title={`Guest request · Room ${roomCode}`}
        onClose={onClose}
        footer={
          <Button type="button" intent="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <Alert intent="settled" data-testid="hk-request-done">
          Request logged: {requestTypeLabel(created.requestType, requestTypes)} for room {roomCode}. It
          is on the Housekeeping Requests tab.
        </Alert>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      wide
      title={lockedRoom ? `Guest request · Room ${lockedRoom.code}` : 'New guest request'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={mutation.isPending || missing} onClick={submit}>
            Log request
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-request-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {requestTypes.length === 0 ? (
          <Alert intent="attention">
            No request types are set up. Add some under Settings, Housekeeping.
          </Alert>
        ) : null}
        <FieldGroup inline>
          {!lockedRoom ? (
            <Field
              label="Room"
              control={
                <NativeSelect
                  aria-label="Request room"
                  value={values.roomId}
                  onChange={(e) => set({ roomId: e.target.value, reservationId: '' })}
                >
                  {rooms.map((r) => (
                    <option key={r.roomId} value={r.roomId}>
                      {r.code}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            label="Request"
            control={
              <NativeSelect
                aria-label="Request type"
                value={values.requestType}
                onChange={(e) => {
                  const type = requestTypes.find((t) => t.code === e.target.value);
                  set({
                    requestType: e.target.value,
                    // The department follows the type until the user picks one themselves.
                    ...(type && !deptTouched ? { department: type.department, assigneeRef: '' } : {}),
                  });
                }}
              >
                {requestTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Department"
            control={
              <NativeSelect
                aria-label="Request department"
                value={values.department}
                onChange={(e) => {
                  setDeptTouched(true);
                  set({ department: e.target.value as HousekeepingRequestDepartment, assigneeRef: '' });
                }}
              >
                {HOUSEKEEPING_REQUEST_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {REQUEST_DEPARTMENT_LABEL[d]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {canReadRoster && kind ? (
            <Field
              label="Assign to"
              control={
                <NativeSelect
                  aria-label="Request assignee"
                  value={values.assigneeRef}
                  onChange={(e) => set({ assigneeRef: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {attendants.map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed staff member'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            label="Date"
            control={
              <Input
                type="date"
                aria-label="Request date"
                value={values.businessDate}
                onChange={(e) => set({ businessDate: e.target.value })}
              />
            }
          />
          {!lockedRoom ? (
            <StayPicker
              propertyId={propertyId}
              api={api}
              roomId={values.roomId}
              value={values.reservationId}
              onChange={(reservationId) => set({ reservationId })}
              labelFor={labelFor}
              guests={guests}
            />
          ) : null}
          <Field
            size="full"
            label="Note (optional)"
            control={
              <Textarea
                aria-label="Request note"
                value={values.note}
                maxLength={HK_REQUEST_NOTE_MAX}
                onChange={(e) => set({ note: e.target.value })}
              />
            }
          />
        </FieldGroup>
      </form>
    </Dialog>
  );
}

/**
 * Desk entry point (folio and stay card): the create dialog for one room and stay, prefilled and
 * fixed. It loads the property's request types through the same cache key the list uses.
 */
export function GuestRequestDialog({
  propertyId,
  api,
  roomId,
  roomCode,
  reservationId,
  defaultBusinessDate,
  canReadRoster,
  formatError,
  onClose,
}: {
  propertyId: string;
  api: HousekeepingApi;
  roomId: string;
  roomCode: string;
  reservationId: string;
  defaultBusinessDate: string;
  canReadRoster: boolean;
  formatError?: (err: unknown) => string;
  onClose: () => void;
}) {
  const filters: RequestFilters = { ...NO_REQUEST_FILTERS, roomId };
  const typesQuery = useQuery({
    queryKey: housekeepingRequestsKey(propertyId, filters),
    queryFn: () => api.getHousekeepingRequests(propertyId, requestsQueryInput(filters)),
  });
  if (typesQuery.isLoading) {
    return (
      <Dialog open title={`Guest request · Room ${roomCode}`} onClose={onClose}>
        <Skeleton label="Loading request types" />
      </Dialog>
    );
  }
  if (typesQuery.isError) {
    return (
      <Dialog
        open
        title={`Guest request · Room ${roomCode}`}
        onClose={onClose}
        footer={<Button onClick={onClose}>Close</Button>}
      >
        <Alert intent="exception">
          {formatError?.(typesQuery.error) ?? 'Could not load the request types.'}
        </Alert>
      </Dialog>
    );
  }
  return (
    <NewRequestDialog
      propertyId={propertyId}
      api={api}
      rooms={[]}
      requestTypes={typesQuery.data?.requestTypes ?? []}
      lockedRoom={{ roomId, code: roomCode, reservationId }}
      defaultBusinessDate={defaultBusinessDate}
      canReadRoster={canReadRoster}
      confirmInDialog
      formatError={formatError}
      onClose={onClose}
    />
  );
}

export function HousekeepingRequests({
  propertyId,
  defaultBusinessDate,
  api,
  canWrite,
  canReadRoster,
  guests,
  subtitle,
  formatError,
  format,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canWrite: boolean;
  canReadRoster: boolean;
  guests?: HousekeepingGuests;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: {
    dateHeading: (iso: string) => string;
    date?: (iso: string) => string;
    dateTime: (ms: number) => string;
  };
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RequestFilters>(NO_REQUEST_FILTERS);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'new' }
    | { kind: 'edit'; request: HousekeepingRequestListRow }
    | { kind: 'resolve'; request: HousekeepingRequestListRow }
    | { kind: 'cancel'; request: HousekeepingRequestListRow }
    | null
  >(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const set = (patch: Partial<RequestFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const search = filters.search.trim();
  const effective = { ...filters, search };

  const query = useQuery({
    queryKey: housekeepingRequestsKey(propertyId, effective),
    queryFn: () => api.getHousekeepingRequests(propertyId, requestsQueryInput(effective)),
  });
  const roomsQuery = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
  });
  const roster = useStaffRoster(api, propertyId, canReadRoster);

  const requests = query.data?.requests ?? [];
  const requestTypes = query.data?.requestTypes ?? [];
  const rooms = roomsQuery.data?.rooms ?? [];
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    requests.map((r) => r.guestRef),
  );
  const anyFilter = Boolean(
    filters.from || filters.to || filters.status || filters.department || filters.roomId || search,
  );
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['housekeeping-requests', propertyId] });

  const update = useMutation({
    mutationFn: (input: {
      request: HousekeepingRequestListRow;
      body: Parameters<HousekeepingApi['updateHousekeepingRequest']>[2];
      words?: string;
    }) => api.updateHousekeepingRequest(propertyId, input.request.requestId, input.body, crypto.randomUUID()),
    onSuccess: async (_r, input) => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      setDone(input.words ? `Request for room ${input.request.roomCode} ${input.words}.` : 'Request updated.');
      await invalidate();
    },
    onError: (err, input) => {
      const text = failure(err, 'Could not update the request.');
      if (input.body.action === 'start') setNotice(text);
      else setDialogError(text);
    },
  });

  const busy = update.isPending;
  const noWriteReason = 'You can view requests but not change them.';
  const counters = query.data?.counters;

  function openDialog(next: NonNullable<typeof dialog>) {
    setDialogError(null);
    setDialog(next);
  }

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Guest requests"
        subtitle={subtitle ?? <>{format.dateHeading(defaultBusinessDate)} · requests</>}
      />
      <HousekeepingNav view="requests" />
      {done ? (
        <Alert intent="settled" data-testid="hk-request-settled">
          {done}
        </Alert>
      ) : null}
      {notice ? (
        <Alert intent="exception" data-testid="hk-request-notice">
          {notice}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">{noWriteReason}</Alert> : null}
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={
              <Input
                type="date"
                aria-label="Requests from"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            }
          />
          <Field
            size="xs"
            label="To"
            control={
              <Input
                type="date"
                aria-label="Requests to"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
              />
            }
          />
          <Field
            size="sm"
            label="Status"
            control={
              <NativeSelect
                aria-label="Request status"
                value={filters.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                <option value="">All</option>
                {HOUSEKEEPING_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REQUEST_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Department"
            control={
              <NativeSelect
                aria-label="Request department filter"
                value={filters.department}
                onChange={(e) => set({ department: e.target.value })}
              >
                <option value="">All</option>
                {HOUSEKEEPING_REQUEST_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {REQUEST_DEPARTMENT_LABEL[d]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Room"
            control={
              <NativeSelect
                aria-label="Request room filter"
                value={filters.roomId}
                onChange={(e) => set({ roomId: e.target.value })}
              >
                <option value="">All</option>
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Search"
            control={
              <Input
                aria-label="Search requests"
                placeholder="Type, room or note"
                value={filters.search}
                maxLength={HK_REQUEST_SEARCH_MAX}
                onChange={(e) => set({ search: e.target.value })}
              />
            }
          />
          <Button
            type="button"
            intent="primary"
            disabled={!canWrite}
            onClick={() => openDialog({ kind: 'new' })}
          >
            New request
          </Button>
        </Toolbar>

        <CardContent>
          <div data-testid="hk-request-counters">
            <Metrics>
              <Metric label="Open" value={counters?.open ?? '—'} />
              <Metric label="In progress" value={counters?.inProgress ?? '—'} />
              <Metric label="Resolved today" value={counters?.resolvedToday ?? '—'} />
            </Metrics>
          </div>
        </CardContent>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading requests" /> : null}
          {query.isError ? (
            <Alert intent="exception">{failure(query.error, 'Could not load guest requests.')}</Alert>
          ) : null}
          {query.isSuccess && requests.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="No guest requests yet."
              description={canWrite ? 'Use New request to log one.' : undefined}
            />
          ) : null}
          {query.isSuccess && requests.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No requests match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the first 500 requests are shown. Narrow the filters.</Alert>
          ) : null}
          {requests.length > 0 ? (
            <DataTable data-testid="hk-requests">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Guest</DataTableHeaderCell>
                  <DataTableHeaderCell>Request</DataTableHeaderCell>
                  <DataTableHeaderCell>Department</DataTableHeaderCell>
                  <DataTableHeaderCell>Assigned to</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Note</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {requests.map((r) => {
                  const open = r.status === 'open' || r.status === 'in_progress';
                  const text = [r.note, r.resolution ? `Resolution: ${r.resolution}` : null, r.cancelReason ? `Cancelled: ${r.cancelReason}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <DataTableRow key={r.requestId}>
                      <DataTableCell>
                      <span className="ui-nowrap">{(format.date ?? format.dateHeading)(r.businessDate)}</span>
                    </DataTableCell>
                      <DataTableCell>{r.roomCode}</DataTableCell>
                      <DataTableCell>
                        {r.guestRef ? <GuestLink guestRef={r.guestRef} label={labelFor(r.guestRef)} /> : '—'}
                      </DataTableCell>
                      <DataTableCell>{requestTypeLabel(r.requestType, requestTypes)}</DataTableCell>
                      <DataTableCell>{wordFor(REQUEST_DEPARTMENT_LABEL, r.department)}</DataTableCell>
                      <DataTableCell>{staffName(roster.names, r.assigneeRef)}</DataTableCell>
                      <DataTableCell>
                        <Badge rung={statusRung(r.status)}>{wordFor(REQUEST_STATUS_LABEL, r.status)}</Badge>
                      </DataTableCell>
                      <DataTableCell>{text || '—'}</DataTableCell>
                      <DataTableCell>
                        <RowActions>
                          {r.status === 'open' ? (
                            <Button
                              type="button"
                              aria-label={`Start request for ${r.roomCode}`}
                              disabled={!canWrite || busy}
                              onClick={() =>
                                update.mutate({ request: r, body: { action: 'start' }, words: 'started' })
                              }
                            >
                              Start
                            </Button>
                          ) : null}
                          {r.status === 'in_progress' ? (
                            <Button
                              type="button"
                              aria-label={`Resolve request for ${r.roomCode}`}
                              disabled={!canWrite || busy}
                              onClick={() => openDialog({ kind: 'resolve', request: r })}
                            >
                              Resolve
                            </Button>
                          ) : null}
                          {open ? (
                            <>
                              <Button
                                type="button"
                                intent="ghost"
                                aria-label={`Edit request for ${r.roomCode}`}
                                disabled={!canWrite || busy}
                                onClick={() => openDialog({ kind: 'edit', request: r })}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                intent="destructive"
                                aria-label={`Cancel request for ${r.roomCode}`}
                                disabled={!canWrite || busy}
                                onClick={() => openDialog({ kind: 'cancel', request: r })}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : null}
                        </RowActions>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {dialog?.kind === 'new' ? (
        <NewRequestDialog
          propertyId={propertyId}
          api={api}
          guests={guests}
          rooms={rooms}
          requestTypes={requestTypes}
          defaultBusinessDate={defaultBusinessDate}
          canReadRoster={canReadRoster}
          formatError={formatError}
          onCreated={(request) => {
            const code = rooms.find((x) => x.roomId === request.roomId)?.code ?? '';
            setNotice(null);
            setDone(`Request for room ${code} logged.`);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditRequestDialog
          request={dialog.request}
          staff={roster.staff}
          canReadRoster={canReadRoster}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(body) => update.mutate({ request: dialog.request, body })}
        />
      ) : null}
      {dialog?.kind === 'resolve' ? (
        <TextDialog
          title={`Resolve request · Room ${dialog.request.roomCode}`}
          label="Resolution"
          hint="What was done."
          max={HK_REQUEST_RESOLUTION_MAX}
          action="Mark resolved"
          intent="primary"
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(text) =>
            update.mutate({
              request: dialog.request,
              body: { action: 'resolve', resolution: text },
              words: 'resolved',
            })
          }
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <TextDialog
          title={`Cancel this request for room ${dialog.request.roomCode}?`}
          label="Reason"
          hint="The request stays in the list as cancelled. It cannot be reopened."
          max={HK_REQUEST_CANCEL_REASON_MAX}
          action="Cancel request"
          keepLabel="Keep request"
          intent="destructive"
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(text) =>
            update.mutate({
              request: dialog.request,
              body: { action: 'cancel', reason: text },
              words: 'cancelled',
            })
          }
        />
      ) : null}
    </div>
  );
}

function EditRequestDialog({
  request,
  staff,
  canReadRoster,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  request: HousekeepingRequestListRow;
  staff: Parameters<typeof activeStaff>[0];
  canReadRoster: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: {
    note: string | null;
    department: HousekeepingRequestDepartment;
    assigneeRef: string | null;
  }) => void;
}) {
  const [department, setDepartment] = useState<HousekeepingRequestDepartment>(request.department);
  const [assignee, setAssignee] = useState(request.assigneeRef ?? '');
  const [note, setNote] = useState(request.note ?? '');
  const kind = takesAssignee(department);
  const options = kind ? activeStaff(staff, kind) : [];
  const knownAssignee = assignee && !options.some((p) => p.staffId === assignee);

  function submit() {
    if (busy) return;
    onSubmit({
      note: note.trim() || null,
      department,
      assigneeRef: kind && assignee ? assignee : null,
    });
  }

  return (
    <Dialog
      open
      title={`Edit request · Room ${request.roomCode}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy} onClick={submit}>
            Save request
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
        <Field
          label="Department"
          control={
            <NativeSelect
              aria-label="Request department"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value as HousekeepingRequestDepartment);
                setAssignee('');
              }}
            >
              {HOUSEKEEPING_REQUEST_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {REQUEST_DEPARTMENT_LABEL[d]}
                </option>
              ))}
            </NativeSelect>
          }
        />
        {canReadRoster && kind ? (
          <Field
            label="Assign to"
            control={
              <NativeSelect
                aria-label="Request assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {knownAssignee ? <option value={assignee}>Current assignee</option> : null}
                {options.map((p) => (
                  <option key={p.staffId} value={p.staffId}>
                    {p.displayName ?? 'Unnamed staff member'}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        ) : null}
        <Field
          label="Note (optional)"
          control={
            <Textarea
              aria-label="Request note"
              value={note}
              maxLength={HK_REQUEST_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}

/** One required text field and a confirm button: resolve (primary) or cancel (destructive). */
export function TextDialog({
  title,
  label,
  hint,
  max,
  action,
  keepLabel = 'Cancel',
  intent,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  hint?: string;
  max: number;
  action: string;
  keepLabel?: string;
  intent: 'primary' | 'destructive';
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const missing = !text.trim();

  function submit() {
    if (!missing && !busy) onSubmit(text.trim());
  }

  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {keepLabel}
          </Button>
          <Button intent={intent} disabled={busy || missing} onClick={submit}>
            {action}
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
        {hint ? <p>{hint}</p> : null}
        <Field
          label={label}
          control={
            <Input aria-label={label} value={text} maxLength={max} onChange={(e) => setText(e.target.value)} />
          }
        />
      </form>
    </Dialog>
  );
}
