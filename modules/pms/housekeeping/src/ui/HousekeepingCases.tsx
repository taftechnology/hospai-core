import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_CASE_CLOSURE_MAX,
  HK_CASE_DETAIL_MAX,
  HK_CASE_ITEM_MAX,
  HK_REQUEST_SEARCH_MAX,
  HOUSEKEEPING_CASE_KINDS,
  HOUSEKEEPING_CASE_RETURNED_STATUSES,
  HOUSEKEEPING_CASE_STATUSES,
  type HousekeepingCaseKind,
  type HousekeepingCaseListRow,
  type HousekeepingCaseReturned,
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
import { Link } from 'react-router';
import {
  GuestLink,
  StayPicker,
  activeStaff,
  staffName,
  useGuestLabels,
  useStaffRoster,
} from './depth-shared.js';
import {
  CASE_KIND_LABEL,
  CASE_STATUS_LABEL,
  RETURNED_STATUS_LABEL,
  wordFor,
} from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingGuests } from './housekeeping-types.js';

type CaseFilters = { kind: string; status: string; from: string; to: string; search: string };

export function housekeepingCasesKey(propertyId: string, f: CaseFilters) {
  return ['housekeeping-cases', propertyId, f.kind, f.status, f.from, f.to, f.search] as const;
}

type CaseValues = {
  kind: HousekeepingCaseKind;
  roomId: string;
  reservationId: string;
  item: string;
  businessDate: string;
  reporterRef: string;
  inspectionDetail: string;
  returnedStatus: HousekeepingCaseReturned;
};

type DialogState =
  | { kind: 'new' }
  | { kind: 'edit'; row: HousekeepingCaseListRow }
  | { kind: 'close'; row: HousekeepingCaseListRow }
  | null;

export function HousekeepingCases({
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
  const [filters, setFilters] = useState<CaseFilters>({ kind: '', status: '', from: '', to: '', search: '' });
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const set = (patch: Partial<CaseFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const search = filters.search.trim();
  const effective = { ...filters, search };

  const query = useQuery({
    queryKey: housekeepingCasesKey(propertyId, effective),
    queryFn: () =>
      api.getHousekeepingCases(propertyId, {
        ...(effective.kind ? { kind: effective.kind } : {}),
        ...(effective.status ? { status: effective.status } : {}),
        ...(effective.from ? { from: effective.from } : {}),
        ...(effective.to ? { to: effective.to } : {}),
        ...(search ? { search } : {}),
      }),
  });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const rows = query.data?.cases ?? [];
  const rooms = roomsQuery.data?.rooms ?? [];
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    rows.map((r) => r.guestRef),
  );
  const anyFilter = Boolean(filters.kind || filters.status || filters.from || filters.to || search);
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['housekeeping-cases', propertyId] });

  const open = useMutation({
    mutationFn: (v: CaseValues) =>
      api.openHousekeepingCase(
        propertyId,
        {
          businessDate: v.businessDate,
          kind: v.kind,
          roomId: v.roomId,
          item: v.item.trim(),
          returnedStatus: v.returnedStatus,
          ...(v.reservationId ? { reservationId: v.reservationId } : {}),
          ...(v.reporterRef ? { reporterRef: v.reporterRef } : {}),
          ...(v.inspectionDetail.trim() ? { inspectionDetail: v.inspectionDetail.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setDialog(null);
      setDialogError(null);
      setDone('Case opened.');
      await invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not open the case.')),
  });

  const update = useMutation({
    mutationFn: (input: {
      row: HousekeepingCaseListRow;
      body: Parameters<HousekeepingApi['updateHousekeepingCase']>[2];
      words: string;
    }) => api.updateHousekeepingCase(propertyId, input.row.caseId, input.body, crypto.randomUUID()),
    onSuccess: async (_r, input) => {
      setDialog(null);
      setDialogError(null);
      setDone(`Case for ${input.row.item}: ${input.words}.`);
      await invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not update the case.')),
  });

  const busy = open.isPending || update.isPending;

  function openDialog(next: NonNullable<DialogState>) {
    setDialogError(null);
    setDialog(next);
  }

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Missing and damaged"
        subtitle={subtitle ?? <>{format.dateHeading(defaultBusinessDate)} · cases</>}
      />
      <HousekeepingNav view="cases" />
      {done ? (
        <Alert intent="settled" data-testid="hk-case-settled">
          {done}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view cases but not change them.</Alert> : null}
      <Card>
        <Toolbar>
          <Field
            size="sm"
            label="Kind"
            control={
              <NativeSelect
                aria-label="Case kind"
                value={filters.kind}
                onChange={(e) => set({ kind: e.target.value })}
              >
                <option value="">All</option>
                {HOUSEKEEPING_CASE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CASE_KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Status"
            control={
              <NativeSelect
                aria-label="Case status"
                value={filters.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                <option value="">All</option>
                {HOUSEKEEPING_CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CASE_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="xs"
            label="From"
            control={
              <Input
                type="date"
                aria-label="Cases from"
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
                aria-label="Cases to"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
              />
            }
          />
          <Field
            size="sm"
            label="Search"
            control={
              <Input
                aria-label="Search cases"
                placeholder="Item, room or detail"
                value={filters.search}
                maxLength={HK_REQUEST_SEARCH_MAX}
                onChange={(e) => set({ search: e.target.value })}
              />
            }
          />
          <Button type="button" intent="primary" disabled={!canWrite} onClick={() => openDialog({ kind: 'new' })}>
            Open case
          </Button>
        </Toolbar>

        <CardContent>
          <div data-testid="hk-case-counters">
            <Metrics>
              <Metric label="Open" value={query.data?.counters.open ?? '—'} />
            </Metrics>
          </div>
        </CardContent>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading cases" /> : null}
          {query.isError ? (
            <Alert intent="exception">{failure(query.error, 'Could not load cases.')}</Alert>
          ) : null}
          {query.isSuccess && rows.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="No missing or damaged cases."
              description={canWrite ? 'Use Open case to record one.' : undefined}
            />
          ) : null}
          {query.isSuccess && rows.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No cases match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the first 500 cases are shown. Narrow the filters.</Alert>
          ) : null}
          {rows.length > 0 ? (
            <DataTable data-testid="hk-cases">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Kind</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Guest</DataTableHeaderCell>
                  <DataTableHeaderCell>Item</DataTableHeaderCell>
                  <DataTableHeaderCell>Reported by</DataTableHeaderCell>
                  <DataTableHeaderCell>Returned</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <DataTableRow key={row.caseId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{(format.date ?? format.dateHeading)(row.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>{wordFor(CASE_KIND_LABEL, row.kind)}</DataTableCell>
                    <DataTableCell>{row.roomCode}</DataTableCell>
                    <DataTableCell>
                      {row.guestRef ? <GuestLink guestRef={row.guestRef} label={labelFor(row.guestRef)} /> : '—'}
                    </DataTableCell>
                    <DataTableCell>
                      {row.item}
                      {row.inspectionDetail ? <div className="muted">{row.inspectionDetail}</div> : null}
                      {row.closureNote ? <div>Closed: {row.closureNote}</div> : null}
                    </DataTableCell>
                    <DataTableCell>{staffName(roster.names, row.reporterRef)}</DataTableCell>
                    <DataTableCell>{wordFor(RETURNED_STATUS_LABEL, row.returnedStatus)}</DataTableCell>
                    <DataTableCell>
                      <Badge rung={row.status === 'open' ? 'attention' : 'neutral'}>
                        {wordFor(CASE_STATUS_LABEL, row.status)}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        {row.status === 'open' ? (
                          <>
                            <Button
                              type="button"
                              intent="ghost"
                              aria-label={`Edit case ${row.item}`}
                              disabled={!canWrite || busy}
                              onClick={() => openDialog({ kind: 'edit', row })}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              aria-label={`Close case ${row.item}`}
                              disabled={!canWrite || busy}
                              onClick={() => openDialog({ kind: 'close', row })}
                            >
                              Close
                            </Button>
                          </>
                        ) : null}
                        {row.status === 'open' && row.kind === 'damaged' && row.reservationId ? (
                          <Link
                            className="ui-link-btn"
                            to={`/folio/${encodeURIComponent(row.reservationId)}`}
                            aria-label={`Post damage charge for ${row.item}`}
                          >
                            Post damage charge
                          </Link>
                        ) : null}
                      </RowActions>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {dialog?.kind === 'new' || dialog?.kind === 'edit' ? (
        <CaseFormDialog
          key={dialog.kind === 'edit' ? dialog.row.caseId : 'new'}
          propertyId={propertyId}
          api={api}
          guests={guests}
          mode={dialog.kind}
          row={dialog.kind === 'edit' ? dialog.row : undefined}
          rooms={rooms}
          staff={roster.staff}
          canReadRoster={canReadRoster}
          defaultDate={defaultBusinessDate}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(v) =>
            dialog.kind === 'edit'
              ? update.mutate({
                  row: dialog.row,
                  body: {
                    item: v.item.trim(),
                    inspectionDetail: v.inspectionDetail.trim() || null,
                    returnedStatus: v.returnedStatus,
                  },
                  words: 'details saved',
                })
              : open.mutate(v)
          }
        />
      ) : null}
      {dialog?.kind === 'close' ? (
        <CloseCaseDialog
          row={dialog.row}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(note, returnedStatus) =>
            update.mutate({
              row: dialog.row,
              body: { action: 'close', closureNote: note, returnedStatus },
              words: 'closed',
            })
          }
        />
      ) : null}
    </div>
  );
}

function CaseFormDialog({
  propertyId,
  api,
  guests,
  mode,
  row,
  rooms,
  staff,
  canReadRoster,
  defaultDate,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  propertyId: string;
  api: HousekeepingApi;
  guests?: HousekeepingGuests;
  mode: 'new' | 'edit';
  row?: HousekeepingCaseListRow;
  rooms: ReadonlyArray<{ roomId: string; code: string }>;
  staff: Parameters<typeof activeStaff>[0];
  canReadRoster: boolean;
  defaultDate: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: CaseValues) => void;
}) {
  const [v, setV] = useState<CaseValues>({
    kind: row?.kind ?? 'damaged',
    roomId: row?.roomId ?? rooms[0]?.roomId ?? '',
    reservationId: row?.reservationId ?? '',
    item: row?.item ?? '',
    businessDate: row?.businessDate ?? defaultDate,
    reporterRef: row?.reporterRef ?? '',
    inspectionDetail: row?.inspectionDetail ?? '',
    returnedStatus: row?.returnedStatus ?? 'not_returned',
  });
  const set = (patch: Partial<CaseValues>) => setV((prev) => ({ ...prev, ...patch }));
  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard) && mode === 'new',
    retry: false,
  });
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    (board.data?.rooms ?? []).flatMap((r) => (r.inHouse ? [r.inHouse.guestRef] : [])),
  );
  const missing = !v.item.trim() || !v.roomId || !v.businessDate;
  const reporters = activeStaff(staff);

  function submit() {
    if (!missing && !busy) onSubmit(v);
  }

  return (
    <Dialog
      open
      wide
      title={mode === 'new' ? 'Open case' : `Edit case · ${row?.item ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || missing} onClick={submit}>
            {mode === 'new' ? 'Open case' : 'Save case'}
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-case-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <FieldGroup inline>
          {mode === 'new' ? (
            <>
              <Field
                label="Kind"
                control={
                  <NativeSelect
                    aria-label="Case type"
                    value={v.kind}
                    onChange={(e) => set({ kind: e.target.value as HousekeepingCaseKind })}
                  >
                    {HOUSEKEEPING_CASE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {CASE_KIND_LABEL[k]}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Field
                label="Room"
                control={
                  <NativeSelect
                    aria-label="Case room"
                    value={v.roomId}
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
              <StayPicker
                propertyId={propertyId}
                api={api}
                roomId={v.roomId}
                value={v.reservationId}
                onChange={(reservationId) => set({ reservationId })}
                labelFor={labelFor}
                guests={guests}
              />
              <Field
                label="Date"
                control={
                  <Input
                    type="date"
                    aria-label="Case date"
                    value={v.businessDate}
                    onChange={(e) => set({ businessDate: e.target.value })}
                  />
                }
              />
              {canReadRoster ? (
                <Field
                  label="Reported by (optional)"
                  control={
                    <NativeSelect
                      aria-label="Reported by"
                      value={v.reporterRef}
                      onChange={(e) => set({ reporterRef: e.target.value })}
                    >
                      <option value="">Not recorded</option>
                      {reporters.map((p) => (
                        <option key={p.staffId} value={p.staffId}>
                          {p.displayName ?? 'Unnamed staff member'}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
              ) : null}
            </>
          ) : null}
          <Field
            size="full"
            label="Item"
            control={
              <Input
                aria-label="Case item"
                value={v.item}
                maxLength={HK_CASE_ITEM_MAX}
                onChange={(e) => set({ item: e.target.value })}
              />
            }
          />
          <Field
            label="Returned"
            control={
              <NativeSelect
                aria-label="Returned status"
                value={v.returnedStatus}
                onChange={(e) => set({ returnedStatus: e.target.value as HousekeepingCaseReturned })}
              >
                {HOUSEKEEPING_CASE_RETURNED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RETURNED_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="full"
            label="Inspection detail (optional)"
            control={
              <Textarea
                aria-label="Inspection detail"
                value={v.inspectionDetail}
                maxLength={HK_CASE_DETAIL_MAX}
                onChange={(e) => set({ inspectionDetail: e.target.value })}
              />
            }
          />
        </FieldGroup>
      </form>
    </Dialog>
  );
}

function CloseCaseDialog({
  row,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: HousekeepingCaseListRow;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (note: string, returnedStatus: HousekeepingCaseReturned) => void;
}) {
  const [note, setNote] = useState('');
  const [returned, setReturned] = useState<HousekeepingCaseReturned>(row.returnedStatus);
  const missing = !note.trim();

  function submit() {
    if (!missing && !busy) onSubmit(note.trim(), returned);
  }

  return (
    <Dialog
      open
      title={`Close case · ${row.item}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Keep open
          </Button>
          <Button intent="primary" disabled={busy || missing} onClick={submit}>
            Close case
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-case-close"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <p>A closed case cannot be reopened. It stays in the list.</p>
        <Field
          label="Returned"
          control={
            <NativeSelect
              aria-label="Returned status"
              value={returned}
              onChange={(e) => setReturned(e.target.value as HousekeepingCaseReturned)}
            >
              {HOUSEKEEPING_CASE_RETURNED_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RETURNED_STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          }
        />
        <Field
          label="Closure note"
          control={
            <Input
              aria-label="Closure note"
              value={note}
              maxLength={HK_CASE_CLOSURE_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}
