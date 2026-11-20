import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOST_ITEM_CATEGORIES,
  LOST_ITEM_DESCRIPTION_MAX,
  LOST_ITEM_PROOF_MAX,
  LOST_ITEM_REASON_MAX,
  LOST_ITEM_SEARCH_MAX,
  LOST_ITEM_STATUSES,
  LOST_ITEM_STORAGE_MAX,
  LOST_ITEM_WHERE_MAX,
  type LostItemCategory,
  type LostItemListRow,
  type LostItemStatus,
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
  Toolbar,
} from '@hospai/ui-kit';
import { useState } from 'react';
import {
  GuestLink,
  GuestPicker,
  StayPicker,
  activeStaff,
  staffName,
  useGuestLabels,
  useStaffRoster,
} from './depth-shared.js';
import { TextDialog } from './HousekeepingRequests.js';
import {
  LOST_CATEGORY_LABEL,
  LOST_EVENT_LABEL,
  LOST_STATUS_LABEL,
  eventBy,
  wordFor,
} from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingGuests } from './housekeeping-types.js';

type LostFilters = { status: string; from: string; to: string; search: string };

export function lostItemsKey(propertyId: string, f: LostFilters) {
  return ['lost-items', propertyId, f.status, f.from, f.to, f.search] as const;
}

export function lostItemKey(propertyId: string, itemId: string) {
  return ['lost-items', propertyId, 'item', itemId] as const;
}

function statusRung(status: LostItemStatus): 'neutral' | 'informational' | 'settled' | 'attention' {
  if (status === 'found') return 'attention';
  if (status === 'handed_over') return 'informational';
  if (status === 'claimed') return 'settled';
  return 'neutral';
}

type DialogState =
  | { kind: 'record' }
  | { kind: 'edit'; item: LostItemListRow }
  | { kind: 'details'; item: LostItemListRow }
  | { kind: 'hand_over'; item: LostItemListRow }
  | { kind: 'claim'; item: LostItemListRow }
  | { kind: 'dispose'; item: LostItemListRow }
  | { kind: 'close'; item: LostItemListRow }
  | null;

export function HousekeepingLostFound({
  propertyId,
  defaultBusinessDate,
  api,
  canWrite,
  canReadRoster,
  guests,
  actorLabel,
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
  actorLabel?: (actor: string) => string | null | undefined;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: {
    dateHeading: (iso: string) => string;
    date?: (iso: string) => string;
    dateTime: (ms: number) => string;
  };
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<LostFilters>({ status: '', from: '', to: '', search: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const set = (patch: Partial<LostFilters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const search = filters.search.trim();
  const effective = { ...filters, search };

  const query = useQuery({
    queryKey: lostItemsKey(propertyId, effective),
    queryFn: () =>
      api.getLostItems(propertyId, {
        ...(effective.status ? { status: effective.status } : {}),
        ...(effective.from ? { from: effective.from } : {}),
        ...(effective.to ? { to: effective.to } : {}),
        ...(search ? { search } : {}),
      }),
  });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const items = query.data?.items ?? [];
  const counters = query.data?.counters;
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    items.flatMap((i) => [i.claimantGuestRef, i.stayGuestRef]),
  );
  const anyFilter = Boolean(filters.status || filters.from || filters.to || search);
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lost-items', propertyId] });

  const record = useMutation({
    mutationFn: (v: RecordValues) =>
      api.recordLostItem(
        propertyId,
        {
          businessDate: v.businessDate,
          description: v.description.trim(),
          category: v.category,
          foundWhere: v.foundWhere.trim(),
          ...(v.roomId ? { roomId: v.roomId } : {}),
          ...(v.reservationId ? { reservationId: v.reservationId } : {}),
          ...(v.foundByRef ? { foundByRef: v.foundByRef } : {}),
          ...(v.storageLocation.trim() ? { storageLocation: v.storageLocation.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      setDone('Item recorded as found.');
      await invalidate();
    },
    onError: (err) => setDialogError(failure(err, 'Could not record the item.')),
  });

  const update = useMutation({
    mutationFn: (input: {
      item: LostItemListRow;
      body: Parameters<HousekeepingApi['updateLostItem']>[2];
      words: string;
    }) => api.updateLostItem(propertyId, input.item.itemId, input.body, crypto.randomUUID()),
    onSuccess: async (_r, input) => {
      setDialog(null);
      setDialogError(null);
      setNotice(null);
      setDone(`${input.item.description}: ${input.words}.`);
      await invalidate();
    },
    onError: (err) => {
      setDialogError(failure(err, 'Could not update the item.'));
    },
  });

  const busy = record.isPending || update.isPending;
  const noWriteReason = 'You can view lost and found but not change it.';

  function open(next: NonNullable<DialogState>) {
    setDialogError(null);
    setNotice(null);
    setDialog(next);
  }

  return (
    <div className="ui-page-stack">
      <PageHeader
        title="Lost and found"
        subtitle={subtitle ?? <>{format.dateHeading(defaultBusinessDate)} · custody register</>}
      />
      <HousekeepingNav view="lost" />
      {done ? (
        <Alert intent="settled" data-testid="hk-lost-settled">
          {done}
        </Alert>
      ) : null}
      {notice ? <Alert intent="exception">{notice}</Alert> : null}
      {!canWrite ? <Alert intent="informational">{noWriteReason}</Alert> : null}
      {canWrite && !canReadRoster ? (
        <Alert intent="informational">Handing over an item needs access to the staff list.</Alert>
      ) : null}
      {canWrite && !guests ? (
        <Alert intent="informational">Claiming an item needs access to the guest directory.</Alert>
      ) : null}
      <Card>
        <Toolbar>
          <Field
            size="sm"
            label="Status"
            control={
              <NativeSelect
                aria-label="Lost item status"
                value={filters.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                <option value="">All</option>
                {LOST_ITEM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LOST_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="xs"
            label="Found from"
            control={
              <Input
                type="date"
                aria-label="Found from"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            }
          />
          <Field
            size="xs"
            label="Found to"
            control={
              <Input
                type="date"
                aria-label="Found to"
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
                aria-label="Search lost items"
                placeholder="Item, place or room"
                value={filters.search}
                maxLength={LOST_ITEM_SEARCH_MAX}
                onChange={(e) => set({ search: e.target.value })}
              />
            }
          />
          <Button type="button" intent="primary" disabled={!canWrite} onClick={() => open({ kind: 'record' })}>
            Record found item
          </Button>
        </Toolbar>

        <CardContent>
          <div data-testid="hk-lost-counters">
            <Metrics>
              <Metric label="In custody" value={counters?.inCustody ?? '—'} />
              <Metric label="Claimed this month" value={counters?.claimedThisMonth ?? '—'} />
            </Metrics>
          </div>
        </CardContent>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading lost and found" /> : null}
          {query.isError ? (
            <Alert intent="exception">{failure(query.error, 'Could not load lost and found.')}</Alert>
          ) : null}
          {query.isSuccess && items.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="Nothing in lost and found."
              description={canWrite ? 'Use Record found item when something turns up.' : undefined}
            />
          ) : null}
          {query.isSuccess && items.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No items match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the first 500 items are shown. Narrow the filters.</Alert>
          ) : null}
          {items.length > 0 ? (
            <DataTable data-testid="hk-lost-items">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Found</DataTableHeaderCell>
                  <DataTableHeaderCell>Item</DataTableHeaderCell>
                  <DataTableHeaderCell>Where</DataTableHeaderCell>
                  <DataTableHeaderCell>Stored</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Custody</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {items.map((item) => (
                  <DataTableRow key={item.itemId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{(format.date ?? format.dateHeading)(item.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>
                      {item.description}
                      <div className="muted">{wordFor(LOST_CATEGORY_LABEL, item.category)}</div>
                    </DataTableCell>
                    <DataTableCell>
                      {item.foundWhere}
                      {item.roomCode ? ` · Room ${item.roomCode}` : ''}
                      {item.stayGuestRef ? (
                        <div>
                          <GuestLink
                            guestRef={item.stayGuestRef}
                            label={labelFor(item.stayGuestRef)}
                          />
                        </div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell>{item.storageLocation ?? '—'}</DataTableCell>
                    <DataTableCell>
                      <Badge rung={statusRung(item.status)}>{wordFor(LOST_STATUS_LABEL, item.status)}</Badge>
                    </DataTableCell>
                    <DataTableCell>
                      {item.status === 'handed_over' || item.handedToRef
                        ? `Handed to ${staffName(roster.names, item.handedToRef)}`
                        : null}
                      {item.claimantGuestRef ? (
                        <div>
                          Claimed by{' '}
                          <GuestLink
                            guestRef={item.claimantGuestRef}
                            label={labelFor(item.claimantGuestRef)}
                          />
                        </div>
                      ) : null}
                      {item.disposeReason ? <div>Disposed: {item.disposeReason}</div> : null}
                      {!item.handedToRef && !item.claimantGuestRef && !item.disposeReason ? '—' : null}
                    </DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        <Button
                          type="button"
                          intent="ghost"
                          aria-label={`History of ${item.description}`}
                          onClick={() => open({ kind: 'details', item })}
                        >
                          History
                        </Button>
                        {item.status === 'found' ? (
                          <>
                            <Button
                              type="button"
                              aria-label={`Hand over ${item.description}`}
                              disabled={!canWrite || busy || !canReadRoster}
                                              onClick={() => open({ kind: 'hand_over', item })}
                            >
                              Hand over
                            </Button>
                            <Button
                              type="button"
                              intent="ghost"
                              aria-label={`Edit ${item.description}`}
                              disabled={!canWrite || busy}
                              onClick={() => open({ kind: 'edit', item })}
                            >
                              Edit
                            </Button>
                          </>
                        ) : null}
                        {item.status === 'found' || item.status === 'handed_over' ? (
                          <>
                            <Button
                              type="button"
                              aria-label={`Claim ${item.description}`}
                              disabled={!canWrite || busy || !guests}
                                              onClick={() => open({ kind: 'claim', item })}
                            >
                              Claim
                            </Button>
                            <Button
                              type="button"
                              intent="destructive"
                              aria-label={`Dispose of ${item.description}`}
                              disabled={!canWrite || busy}
                              onClick={() => open({ kind: 'dispose', item })}
                            >
                              Dispose
                            </Button>
                          </>
                        ) : null}
                        {item.status === 'claimed' || item.status === 'disposed' ? (
                          <Button
                            type="button"
                            aria-label={`Close ${item.description}`}
                            disabled={!canWrite || busy}
                            onClick={() => open({ kind: 'close', item })}
                          >
                            Close
                          </Button>
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

      {dialog?.kind === 'record' || dialog?.kind === 'edit' ? (
        <RecordDialog
          key={dialog.kind === 'edit' ? dialog.item.itemId : 'new'}
          propertyId={propertyId}
          api={api}
          guests={guests}
          mode={dialog.kind}
          item={dialog.kind === 'edit' ? dialog.item : undefined}
          rooms={roomsQuery.data?.rooms ?? []}
          staff={roster.staff}
          canReadRoster={canReadRoster}
          defaultDate={defaultBusinessDate}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(v) =>
            dialog.kind === 'edit'
              ? update.mutate({
                  item: dialog.item,
                  body: {
                    description: v.description.trim(),
                    category: v.category,
                    foundWhere: v.foundWhere.trim(),
                    storageLocation: v.storageLocation.trim() || null,
                  },
                  words: 'details saved',
                })
              : record.mutate(v)
          }
        />
      ) : null}
      {dialog?.kind === 'details' ? (
        <ItemHistoryDialog
          propertyId={propertyId}
          api={api}
          item={dialog.item}
          staffNames={roster.names}
          labelFor={labelFor}
          actorLabel={actorLabel}
          format={format}
          formatError={formatError}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'hand_over' ? (
        <HandOverDialog
          item={dialog.item}
          staff={roster.staff}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(handedToRef) =>
            update.mutate({
              item: dialog.item,
              body: { action: 'hand_over', handedToRef },
              words: 'handed over',
            })
          }
        />
      ) : null}
      {dialog?.kind === 'claim' && guests ? (
        <ClaimDialog
          propertyId={propertyId}
          guests={guests}
          item={dialog.item}
          stayGuestLabel={dialog.item.stayGuestRef ? labelFor(dialog.item.stayGuestRef) : null}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(guestRef, proofNote) =>
            update.mutate({
              item: dialog.item,
              body: { action: 'claim', guestRef, ...(proofNote ? { proofNote } : {}) },
              words: 'claimed',
            })
          }
        />
      ) : null}
      {dialog?.kind === 'dispose' ? (
        <TextDialog
          title={`Dispose of ${dialog.item.description}?`}
          label="Reason"
          hint="Disposal is final. The record stays in the register."
          max={LOST_ITEM_REASON_MAX}
          action="Dispose"
          keepLabel="Keep item"
          intent="destructive"
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            update.mutate({ item: dialog.item, body: { action: 'dispose', reason }, words: 'disposed' })
          }
        />
      ) : null}
      {dialog?.kind === 'close' ? (
        <Dialog
          open
          title={`Close ${dialog.item.description}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button type="button" onClick={() => setDialog(null)}>
                Keep open
              </Button>
              <Button
                intent="primary"
                disabled={busy}
                onClick={() => update.mutate({ item: dialog.item, body: { action: 'close' }, words: 'closed' })}
              >
                Close record
              </Button>
            </>
          }
        >
          <div className="ui-stack">
            {dialogError ? <Alert intent="exception">{dialogError}</Alert> : null}
            <p>Custody ends and the record cannot be reopened. It stays in the register.</p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

type RecordValues = {
  businessDate: string;
  description: string;
  category: LostItemCategory;
  foundWhere: string;
  roomId: string;
  reservationId: string;
  foundByRef: string;
  storageLocation: string;
};

function RecordDialog({
  propertyId,
  api,
  guests,
  mode,
  item,
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
  mode: 'record' | 'edit';
  item?: LostItemListRow;
  rooms: ReadonlyArray<{ roomId: string; code: string }>;
  staff: Parameters<typeof activeStaff>[0];
  canReadRoster: boolean;
  defaultDate: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: RecordValues) => void;
}) {
  const [v, setV] = useState<RecordValues>({
    businessDate: item?.businessDate ?? defaultDate,
    description: item?.description ?? '',
    category: item?.category ?? 'other',
    foundWhere: item?.foundWhere ?? '',
    roomId: item?.roomId ?? '',
    reservationId: item?.reservationId ?? '',
    foundByRef: item?.foundByRef ?? '',
    storageLocation: item?.storageLocation ?? '',
  });
  const set = (patch: Partial<RecordValues>) => setV((prev) => ({ ...prev, ...patch }));
  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard) && mode === 'record',
    retry: false,
  });
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    (board.data?.rooms ?? []).flatMap((r) => (r.inHouse ? [r.inHouse.guestRef] : [])),
  );
  const missing = !v.description.trim() || !v.foundWhere.trim() || !v.businessDate;
  const finders = activeStaff(staff);

  function submit() {
    if (!missing && !busy) onSubmit(v);
  }

  return (
    <Dialog
      open
      wide
      title={mode === 'record' ? 'Record found item' : 'Edit found item'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || missing} onClick={submit}>
            {mode === 'record' ? 'Record item' : 'Save item'}
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-lost-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <FieldGroup inline>
          <Field
            size="full"
            label="Item"
            control={
              <Input
                aria-label="Item description"
                value={v.description}
                maxLength={LOST_ITEM_DESCRIPTION_MAX}
                onChange={(e) => set({ description: e.target.value })}
              />
            }
          />
          <Field
            label="Category"
            control={
              <NativeSelect
                aria-label="Item category"
                value={v.category}
                onChange={(e) => set({ category: e.target.value as LostItemCategory })}
              >
                {LOST_ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {LOST_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Where it was found"
            control={
              <Input
                aria-label="Where found"
                value={v.foundWhere}
                maxLength={LOST_ITEM_WHERE_MAX}
                onChange={(e) => set({ foundWhere: e.target.value })}
              />
            }
          />
          {mode === 'record' ? (
            <>
              <Field
                label="Room (optional)"
                control={
                  <NativeSelect
                    aria-label="Found in room"
                    value={v.roomId}
                    onChange={(e) => set({ roomId: e.target.value, reservationId: '' })}
                  >
                    <option value="">Not in a room</option>
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
                label="Date found"
                control={
                  <Input
                    type="date"
                    aria-label="Date found"
                    value={v.businessDate}
                    onChange={(e) => set({ businessDate: e.target.value })}
                  />
                }
              />
              {canReadRoster ? (
                <Field
                  label="Found by (optional)"
                  control={
                    <NativeSelect
                      aria-label="Found by"
                      value={v.foundByRef}
                      onChange={(e) => set({ foundByRef: e.target.value })}
                    >
                      <option value="">Not recorded</option>
                      {finders.map((p) => (
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
            label="Stored at (optional)"
            control={
              <Input
                aria-label="Storage location"
                value={v.storageLocation}
                maxLength={LOST_ITEM_STORAGE_MAX}
                onChange={(e) => set({ storageLocation: e.target.value })}
              />
            }
          />
        </FieldGroup>
      </form>
    </Dialog>
  );
}

function HandOverDialog({
  item,
  staff,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: LostItemListRow;
  staff: Parameters<typeof activeStaff>[0];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (staffRef: string) => void;
}) {
  const options = activeStaff(staff);
  const [ref, setRef] = useState('');

  function submit() {
    if (ref && !busy) onSubmit(ref);
  }

  return (
    <Dialog
      open
      title={`Hand over ${item.description}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || !ref} onClick={submit}>
            Record handover
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
          label="Handed to"
          control={
            <NativeSelect aria-label="Handed to" value={ref} onChange={(e) => setRef(e.target.value)}>
              <option value="">Choose a staff member</option>
              {options.map((p) => (
                <option key={p.staffId} value={p.staffId}>
                  {p.displayName ?? 'Unnamed staff member'}
                </option>
              ))}
            </NativeSelect>
          }
        />
      </form>
    </Dialog>
  );
}

/**
 * The claimant is a guest record: the stay's guest, or a guest picked through the property-scoped
 * search. There is no free-text name field.
 */
function ClaimDialog({
  propertyId,
  guests,
  item,
  stayGuestLabel,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  propertyId: string;
  guests: HousekeepingGuests;
  item: LostItemListRow;
  stayGuestLabel: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (guestRef: string, proofNote: string | null) => void;
}) {
  const [mode, setMode] = useState<'stay' | 'search'>(item.stayGuestRef ? 'stay' : 'search');
  const [picked, setPicked] = useState<{ guestRef: string; label: string } | null>(null);
  const [proof, setProof] = useState('');
  const guestRef = mode === 'stay' ? item.stayGuestRef : (picked?.guestRef ?? null);

  function submit() {
    if (guestRef && !busy) onSubmit(guestRef, proof.trim() || null);
  }

  return (
    <Dialog
      open
      title={`Claim ${item.description}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || !guestRef} onClick={submit}>
            Record claim
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-claim-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {item.stayGuestRef ? (
          <Field
            label="Claimed by"
            control={
              <NativeSelect
                aria-label="Claimed by"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'stay' | 'search')}
              >
                <option value="stay">{`The guest of this stay (${stayGuestLabel ?? 'Name pending'})`}</option>
                <option value="search">Another guest from the directory</option>
              </NativeSelect>
            }
          />
        ) : null}
        {mode === 'search' ? (
          <GuestPicker propertyId={propertyId} guests={guests} selected={picked} onSelect={setPicked} />
        ) : null}
        <Field
          label="Proof checked (optional)"
          hint="A short note. Do not enter ID numbers."
          control={
            <Input
              aria-label="Proof checked"
              value={proof}
              maxLength={LOST_ITEM_PROOF_MAX}
              onChange={(e) => setProof(e.target.value)}
            />
          }
        />
      </form>
    </Dialog>
  );
}

function ItemHistoryDialog({
  propertyId,
  api,
  item,
  staffNames,
  labelFor,
  actorLabel,
  format,
  formatError,
  onClose,
}: {
  propertyId: string;
  api: HousekeepingApi;
  item: LostItemListRow;
  staffNames: ReadonlyMap<string, string>;
  labelFor: (ref: string) => string;
  actorLabel?: (actor: string) => string | null | undefined;
  format: { dateTime: (ms: number) => string };
  formatError?: (err: unknown) => string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: lostItemKey(propertyId, item.itemId),
    queryFn: () => api.getLostItem(propertyId, item.itemId),
  });
  const events = query.data?.events ?? [];
  return (
    <Dialog
      open
      wide
      title={`History · ${item.description}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="ui-stack" data-testid="hk-lost-history">
        {query.isLoading ? <Skeleton label="Loading history" /> : null}
        {query.isError ? (
          <Alert intent="exception">{formatError?.(query.error) ?? 'Could not load the history.'}</Alert>
        ) : null}
        {query.isSuccess && events.length === 0 ? (
          <EmptyState kind="empty" title="No history yet." />
        ) : null}
        {events.length > 0 ? (
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>When</DataTableHeaderCell>
                <DataTableHeaderCell>Step</DataTableHeaderCell>
                <DataTableHeaderCell>Details</DataTableHeaderCell>
                <DataTableHeaderCell>By</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {events.map((e) => (
                <DataTableRow key={e.eventId}>
                  <DataTableCell>{format.dateTime(e.at)}</DataTableCell>
                  <DataTableCell>{wordFor(LOST_EVENT_LABEL, e.kind)}</DataTableCell>
                  <DataTableCell>
                    {e.staffRef ? (e.kind === 'found' ? 'Found by ' : 'To ') + staffName(staffNames, e.staffRef) : null}
                    {e.guestRef ? <GuestLink guestRef={e.guestRef} label={labelFor(e.guestRef)} /> : null}
                    {e.note ? ` ${e.note}` : ''}
                    {!e.staffRef && !e.guestRef && !e.note ? '—' : null}
                  </DataTableCell>
                  <DataTableCell>{eventBy(e.actor, actorLabel)}</DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        ) : null}
      </div>
    </Dialog>
  );
}
