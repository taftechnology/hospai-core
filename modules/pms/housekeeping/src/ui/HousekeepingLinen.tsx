import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_INVENTORY_QTY_MAX,
  HK_STOCK_NOTE_MAX,
  LINEN_MOVEMENT_KINDS,
  LINEN_SUBTRACTING_KINDS,
  type LinenItemTotal,
  type LinenMovementKind,
} from '@hospai/contracts';
import {
  Alert,
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
  NativeSelect,
  PageHeader,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { activeStaff, staffName, useStaffRoster } from './depth-shared.js';
import { LINEN_KIND_LABEL, wordFor } from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi } from './housekeeping-types.js';
import { compactDate, invalidateStock, linenKey, plural, type StockFormat } from './stock-shared.js';
import { useBusinessDate } from './use-business-date.js';

type Filters = { itemId: string; kind: string; roomId: string; attendantRef: string };

/** Kinds that need a note, by the spec: a discard or an adjustment says why. */
const NOTE_REQUIRED: readonly LinenMovementKind[] = ['discard', 'adjust'];

const KIND_HELP: Record<LinenMovementKind, string> = {
  issue: 'Takes linen off the shelf, for example to a floor or a room.',
  return: 'Puts linen back on the shelf.',
  laundry_out: 'Sends linen to the laundry. It stays counted as in laundry until it comes back.',
  laundry_in: 'Linen back from the laundry, onto the shelf.',
  discard: 'Removes worn or damaged linen for good. A note is required.',
  adjust: 'Corrects the count. Use a negative number to remove. A note is required.',
};

export function HousekeepingLinen({
  propertyId,
  defaultBusinessDate,
  api,
  canWrite,
  canReadRoster,
  subtitle,
  formatError,
  format,
}: {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canWrite: boolean;
  canReadRoster: boolean;
  subtitle?: string;
  formatError?: (err: unknown) => string;
  format: StockFormat;
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ itemId: '', kind: '', roomId: '', attendantRef: '' });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ item: LinenItemTotal | null } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [businessDate] = useBusinessDate(defaultBusinessDate);
  const set = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));
  const effective = { ...filters, from, to };
  const anyFilter = Boolean(filters.itemId || filters.kind || filters.roomId || filters.attendantRef || from || to);

  const query = useQuery({
    queryKey: linenKey(propertyId, effective),
    queryFn: () =>
      api.getLinenMovements(propertyId, {
        ...(effective.itemId ? { itemId: effective.itemId } : {}),
        ...(effective.kind ? { kind: effective.kind } : {}),
        ...(effective.roomId ? { roomId: effective.roomId } : {}),
        ...(effective.attendantRef ? { attendantRef: effective.attendantRef } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const rooms = roomsQuery.data?.rooms ?? [];
  const items = query.data?.items ?? [];
  const movements = query.data?.movements ?? [];
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;

  const record = useMutation({
    mutationFn: (v: {
      item: LinenItemTotal;
      kind: LinenMovementKind;
      quantity: number;
      roomId: string;
      attendantRef: string;
      note: string;
    }) =>
      api.recordLinenMovement(
        propertyId,
        {
          businessDate,
          itemId: v.item.itemId,
          kind: v.kind,
          quantity: v.quantity,
          ...(v.roomId ? { roomId: v.roomId } : {}),
          ...(v.attendantRef ? { attendantRef: v.attendantRef } : {}),
          ...(v.note.trim() ? { note: v.note.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, v) => {
      setDialog(null);
      setDialogError(null);
      setDone(`${wordFor(LINEN_KIND_LABEL, v.kind)}: ${plural(Math.abs(v.quantity), 'unit', 'units')} of ${v.item.name}.`);
      await queryClient.invalidateQueries({ queryKey: ['housekeeping-linen', propertyId] });
      invalidateStock(queryClient, propertyId);
    },
    onError: (err) => setDialogError(failure(err, 'Could not record the movement.')),
  });

  return (
    <div className="ui-page-stack">
      <PageHeader title="Linen" subtitle={subtitle ?? 'Linen and towel movements'} />
      <HousekeepingNav view="linen" />
      {done ? (
        <Alert intent="settled" data-testid="hk-linen-settled">
          {done}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view linen but not record movements.</Alert> : null}

      <Card>
        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading linen" /> : null}
          {query.isError ? <Alert intent="exception">{failure(query.error, 'Could not load linen.')}</Alert> : null}
          {query.isSuccess && items.length === 0 ? (
            <EmptyState
              kind="empty"
              title="No linen or towel items yet."
              description="Add items on the Inventory tab with the category Linens or Towels."
            />
          ) : null}
          {items.length > 0 ? (
            <DataTable data-testid="hk-linen-items">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Item</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>On hand</DataTableHeaderCell>
                  <DataTableHeaderCell>In laundry</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {items.map((item) => (
                  <DataTableRow key={item.itemId}>
                    <DataTableCell>
                      {item.name}
                      {item.archived ? <span className="muted"> · archived</span> : null}
                    </DataTableCell>
                    <DataTableCell>{item.category === 'towels' ? 'Towels' : 'Linens'}</DataTableCell>
                    <DataTableCell>{item.onHand}</DataTableCell>
                    <DataTableCell>{item.inLaundry}</DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        aria-label={`Record movement for ${item.name}`}
                        disabled={!canWrite || item.archived || record.isPending}
                        onClick={() => {
                          setDialogError(null);
                          setDialog({ item });
                        }}
                      >
                        Record movement
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <Toolbar>
          <Field
            size="sm"
            label="Item"
            control={
              <NativeSelect aria-label="Linen item" value={filters.itemId} onChange={(e) => set({ itemId: e.target.value })}>
                <option value="">All items</option>
                {items.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Movement"
            control={
              <NativeSelect aria-label="Movement kind" value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
                <option value="">All movements</option>
                {LINEN_MOVEMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LINEN_KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Room"
            control={
              <NativeSelect aria-label="Movement room" value={filters.roomId} onChange={(e) => set({ roomId: e.target.value })}>
                <option value="">All rooms</option>
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {canReadRoster ? (
            <Field
              size="sm"
              label="Attendant"
              control={
                <NativeSelect
                  aria-label="Movement attendant"
                  value={filters.attendantRef}
                  onChange={(e) => set({ attendantRef: e.target.value })}
                >
                  <option value="">Everyone</option>
                  {activeStaff(roster.staff).map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed staff member'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            size="xs"
            label="From"
            control={<Input type="date" aria-label="Movements from" value={from} onChange={(e) => setFrom(e.target.value)} />}
          />
          <Field
            size="xs"
            label="To"
            control={<Input type="date" aria-label="Movements to" value={to} onChange={(e) => setTo(e.target.value)} />}
          />
        </Toolbar>
        <CardContent flush>
          {query.isSuccess && movements.length === 0 && !anyFilter ? (
            <EmptyState kind="empty" title="No linen movements yet." />
          ) : null}
          {query.isSuccess && movements.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No movements match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the newest 500 movements are shown. Narrow the filters.</Alert>
          ) : null}
          {movements.length > 0 ? (
            <DataTable data-testid="hk-linen-movements">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Item</DataTableHeaderCell>
                  <DataTableHeaderCell>Movement</DataTableHeaderCell>
                  <DataTableHeaderCell>Quantity</DataTableHeaderCell>
                  <DataTableHeaderCell>On hand after</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Attendant</DataTableHeaderCell>
                  <DataTableHeaderCell>Note</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {movements.map((m) => (
                  <DataTableRow key={m.movementId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{compactDate(format, m.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>{m.itemName}</DataTableCell>
                    <DataTableCell>{wordFor(LINEN_KIND_LABEL, m.kind)}</DataTableCell>
                    <DataTableCell>{m.kind === 'adjust' && m.quantity > 0 ? `+${m.quantity}` : m.quantity}</DataTableCell>
                    <DataTableCell>{m.onHandAfter}</DataTableCell>
                    <DataTableCell>{m.roomCode ?? '—'}</DataTableCell>
                    <DataTableCell>{m.attendantRef ? staffName(roster.names, m.attendantRef) : '—'}</DataTableCell>
                    <DataTableCell>{m.note ?? '—'}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}
        </CardContent>
      </Card>

      {dialog ? (
        <LinenMovementDialog
          key={dialog.item?.itemId ?? 'any'}
          items={items.filter((i) => !i.archived)}
          initialItem={dialog.item}
          rooms={rooms}
          staff={canReadRoster ? activeStaff(roster.staff) : []}
          busy={record.isPending}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(v) => record.mutate(v)}
        />
      ) : null}
    </div>
  );
}

function LinenMovementDialog({
  items,
  initialItem,
  rooms,
  staff,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  items: LinenItemTotal[];
  initialItem: LinenItemTotal | null;
  rooms: ReadonlyArray<{ roomId: string; code: string }>;
  staff: ReadonlyArray<{ staffId: string; displayName?: string | null }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: {
    item: LinenItemTotal;
    kind: LinenMovementKind;
    quantity: number;
    roomId: string;
    attendantRef: string;
    note: string;
  }) => void;
}) {
  const [itemId, setItemId] = useState(initialItem?.itemId ?? items[0]?.itemId ?? '');
  const [kind, setKind] = useState<LinenMovementKind>('issue');
  const [quantity, setQuantity] = useState('');
  const [roomId, setRoomId] = useState('');
  const [attendantRef, setAttendantRef] = useState('');
  const [note, setNote] = useState('');
  const item = items.find((i) => i.itemId === itemId) ?? null;

  const amount = /^-?\d{1,7}$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const subtracts = (LINEN_SUBTRACTING_KINDS as readonly string[]).includes(kind);
  let problem: string | null = null;
  if (!item) problem = 'Pick an item.';
  else if (amount === null) problem = 'Enter a whole number.';
  else if (kind === 'adjust' ? amount === 0 : amount < 1) {
    problem = kind === 'adjust' ? 'Enter a number other than zero.' : 'Enter a number of one or more.';
  } else if (Math.abs(amount) > HK_INVENTORY_QTY_MAX) problem = 'That quantity is too large.';
  else if (subtracts && item && amount > item.onHand) problem = `Only ${item.onHand} on hand.`;
  else if (kind === 'adjust' && item && amount < 0 && -amount > item.onHand) problem = `Only ${item.onHand} on hand.`;
  else if (kind === 'laundry_in' && item && amount > item.inLaundry) problem = `Only ${item.inLaundry} in laundry.`;
  else if ((NOTE_REQUIRED as readonly string[]).includes(kind) && !note.trim()) problem = 'Add a note saying why.';

  function submit() {
    if (!problem && !busy && item && amount !== null) {
      onSubmit({ item, kind, quantity: amount, roomId, attendantRef, note });
    }
  }

  return (
    <Dialog
      open
      title="Record linen movement"
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || Boolean(problem)} onClick={submit}>
            Record movement
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-linen-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <FieldGroup inline>
          <Field
            label="Item"
            control={
              <NativeSelect aria-label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                {items.map((i) => (
                  <option key={i.itemId} value={i.itemId}>
                    {i.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Movement"
            hint={KIND_HELP[kind]}
            control={
              <NativeSelect aria-label="Movement" value={kind} onChange={(e) => setKind(e.target.value as LinenMovementKind)}>
                {LINEN_MOVEMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LINEN_KIND_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label={kind === 'adjust' ? 'Quantity (negative removes)' : 'Quantity'}
            hint={item ? `On hand ${item.onHand}, in laundry ${item.inLaundry}.` : undefined}
            control={
              <Input
                aria-label="Quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            }
          />
          <Field
            label="Room (optional)"
            control={
              <NativeSelect aria-label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Not tied to a room</option>
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {staff.length > 0 ? (
            <Field
              label="Attendant (optional)"
              control={
                <NativeSelect aria-label="Attendant" value={attendantRef} onChange={(e) => setAttendantRef(e.target.value)}>
                  <option value="">Not recorded</option>
                  {staff.map((p) => (
                    <option key={p.staffId} value={p.staffId}>
                      {p.displayName ?? 'Unnamed staff member'}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            size="full"
            label={(NOTE_REQUIRED as readonly string[]).includes(kind) ? 'Note (required)' : 'Note (optional)'}
            control={
              <Textarea aria-label="Note" value={note} maxLength={HK_STOCK_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
            }
          />
        </FieldGroup>
        {problem && quantity.trim() ? (
          <p className="muted" data-testid="hk-linen-problem">
            {problem}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
