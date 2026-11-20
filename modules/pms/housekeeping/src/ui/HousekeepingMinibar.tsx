import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HK_MINIBAR_QTY_MAX,
  HK_MINIBAR_REASON_MAX,
  MINIBAR_PICKUP_STATUSES,
  type MinibarReconciliationRow,
} from '@hospai/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  Toolbar,
} from '@hospai/ui-kit';
import { useState } from 'react';
import { activeStaff, staffName, useGuestLabels, useStaffRoster } from './depth-shared.js';
import { MINIBAR_FOLIO_STATE_LABEL, PICKUP_STATUS_LABEL, wordFor } from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingGuests } from './housekeeping-types.js';
import {
  compactDate,
  invalidateFolioOfStay,
  invalidateStock,
  minibarKey,
  moneyWords,
  plural,
  type StockFormat,
} from './stock-shared.js';
import { useBusinessDate } from './use-business-date.js';

type View = 'pickups' | 'reconciliation';

export function HousekeepingMinibar({
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
  format: StockFormat;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('pickups');
  const [fromChoice, setFrom] = useBusinessDate(defaultBusinessDate);
  const [toChoice, setTo] = useBusinessDate(defaultBusinessDate);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const filters = { from: fromChoice, to: toChoice, roomId: '', status };
  const anyFilter = Boolean(status) || fromChoice !== defaultBusinessDate || toChoice !== defaultBusinessDate;

  const query = useQuery({
    queryKey: minibarKey(propertyId, filters),
    queryFn: () =>
      api.getMinibarReconciliation(propertyId, {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(status ? { status } : {}),
      }),
    enabled: Boolean(fromChoice && toChoice),
  });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const rows = query.data?.rows ?? [];
  const setup = query.data?.setup;
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    rows.map((r) => r.guestRef),
  );
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;

  const record = useMutation({
    mutationFn: (v: {
      roomId: string;
      reservationId: string;
      lines: Array<{ productId: string; quantity: number }>;
      attendantRef: string;
      complimentary: boolean;
      reason: string;
      summary: string;
    }) =>
      api.recordMinibarPickup(
        propertyId,
        {
          businessDate: defaultBusinessDate,
          roomId: v.roomId,
          reservationId: v.reservationId,
          lines: v.lines,
          ...(v.attendantRef ? { attendantRef: v.attendantRef } : {}),
          ...(v.complimentary ? { complimentary: true, complimentaryReason: v.reason.trim() } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, v) => {
      setOpen(false);
      setDialogError(null);
      setDone(v.complimentary ? `Complimentary pickup recorded: ${v.summary}.` : `Pickup recorded and charged to the guest folio: ${v.summary}.`);
      await queryClient.invalidateQueries({ queryKey: ['housekeeping-minibar', propertyId] });
      invalidateStock(queryClient, propertyId);
      invalidateFolioOfStay(queryClient, propertyId, v.reservationId);
    },
    onError: (err) => setDialogError(failure(err, 'Could not record the pickup.')),
  });

  const notSetUp = query.isSuccess && setup && (!setup.enabled || setup.products.length === 0);

  return (
    <div className="ui-page-stack">
      <PageHeader title="Minibar" subtitle={subtitle ?? 'Minibar pickups and reconciliation'} />
      <HousekeepingNav view="minibar" />
      {done ? (
        <Alert intent="settled" data-testid="hk-minibar-settled">
          {done}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view the minibar but not record pickups.</Alert> : null}
      {notSetUp ? (
        <Alert intent="informational" data-testid="hk-minibar-not-set-up">
          The minibar is not set up. A manager can turn it on and choose its products in Settings, under Housekeeping.
        </Alert>
      ) : null}

      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={<Input type="date" aria-label="Pickups from" value={fromChoice} onChange={(e) => setFrom(e.target.value)} />}
          />
          <Field
            size="xs"
            label="To"
            control={<Input type="date" aria-label="Pickups to" value={toChoice} onChange={(e) => setTo(e.target.value)} />}
          />
          <Field
            size="sm"
            label="Charge"
            control={
              <NativeSelect aria-label="Pickup status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All pickups</option>
                {MINIBAR_PICKUP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PICKUP_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Button
            type="button"
            aria-pressed={view === 'pickups'}
            intent={view === 'pickups' ? 'primary' : undefined}
            onClick={() => setView('pickups')}
          >
            Pickups
          </Button>
          <Button
            type="button"
            aria-pressed={view === 'reconciliation'}
            intent={view === 'reconciliation' ? 'primary' : undefined}
            onClick={() => setView('reconciliation')}
          >
            Reconciliation
          </Button>
          <Button
            type="button"
            intent="primary"
            disabled={!canWrite || !setup?.enabled || (setup?.products.length ?? 0) === 0}
            onClick={() => {
              setDialogError(null);
              setOpen(true);
            }}
          >
            Record pickup
          </Button>
        </Toolbar>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading minibar pickups" /> : null}
          {query.isError ? (
            <Alert intent="exception">{failure(query.error, 'Could not load minibar pickups.')}</Alert>
          ) : null}
          {query.isSuccess && rows.length === 0 && !anyFilter ? (
            <EmptyState kind="empty" title="No minibar pickups for this date." />
          ) : null}
          {query.isSuccess && rows.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No pickups match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the newest 500 pickup lines are shown. Narrow the dates.</Alert>
          ) : null}

          {rows.length > 0 && view === 'pickups' ? (
            <DataTable data-testid="hk-minibar-pickups">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Guest</DataTableHeaderCell>
                  <DataTableHeaderCell>Item</DataTableHeaderCell>
                  <DataTableHeaderCell>Quantity</DataTableHeaderCell>
                  <DataTableHeaderCell>Price</DataTableHeaderCell>
                  <DataTableHeaderCell>Attendant</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {rows.map((r) => (
                  <DataTableRow key={r.lineId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{compactDate(format, r.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>{r.roomCode}</DataTableCell>
                    <DataTableCell>{r.guestRef ? labelFor(r.guestRef) : '—'}</DataTableCell>
                    <DataTableCell>{r.productName}</DataTableCell>
                    <DataTableCell>{r.quantity}</DataTableCell>
                    <DataTableCell>{moneyWords(format, r.amountMinor)}</DataTableCell>
                    <DataTableCell>{r.attendantRef ? staffName(roster.names, r.attendantRef) : '—'}</DataTableCell>
                    <DataTableCell>
                      <Badge rung={r.status === 'posted' ? 'neutral' : 'attention'}>
                        {wordFor(PICKUP_STATUS_LABEL, r.status)}
                      </Badge>
                      {r.complimentaryReason ? <div className="muted">{r.complimentaryReason}</div> : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          ) : null}

          {rows.length > 0 && view === 'reconciliation' ? (
            <>
              <DataTable data-testid="hk-minibar-reconciliation">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Room</DataTableHeaderCell>
                    <DataTableHeaderCell>Item</DataTableHeaderCell>
                    <DataTableHeaderCell>Quantity</DataTableHeaderCell>
                    <DataTableHeaderCell>Price</DataTableHeaderCell>
                    <DataTableHeaderCell>Stock</DataTableHeaderCell>
                    <DataTableHeaderCell>Folio</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {rows.map((r) => (
                    <DataTableRow key={r.lineId}>
                      <DataTableCell>{r.roomCode}</DataTableCell>
                      <DataTableCell>{r.productName}</DataTableCell>
                      <DataTableCell>{r.quantity}</DataTableCell>
                      <DataTableCell>{moneyWords(format, r.amountMinor)}</DataTableCell>
                      <DataTableCell>{stockWords(r)}</DataTableCell>
                      <DataTableCell>
                        <Badge rung={r.folioState === 'missing' ? 'exception' : r.folioState === 'moved' ? 'attention' : 'neutral'}>
                          {wordFor(MINIBAR_FOLIO_STATE_LABEL, r.folioState)}
                        </Badge>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
              <DataTable data-testid="hk-minibar-totals">
                <DataTableHead>
                  <DataTableRow>
                    <DataTableHeaderCell>Item</DataTableHeaderCell>
                    <DataTableHeaderCell>Picked up</DataTableHeaderCell>
                    <DataTableHeaderCell>Complimentary</DataTableHeaderCell>
                    <DataTableHeaderCell>Charged</DataTableHeaderCell>
                  </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                  {(query.data?.totals ?? []).map((t) => (
                    <DataTableRow key={t.productId}>
                      <DataTableCell>{t.productName}</DataTableCell>
                      <DataTableCell>{t.quantity}</DataTableCell>
                      <DataTableCell>{t.complimentaryQuantity}</DataTableCell>
                      <DataTableCell>{moneyWords(format, t.postedAmountMinor)}</DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </>
          ) : null}
        </CardContent>
      </Card>

      {open && setup ? (
        <MinibarPickupDialog
          propertyId={propertyId}
          api={api}
          guests={guests}
          products={setup.products}
          staff={canReadRoster ? activeStaff(roster.staff) : []}
          format={format}
          busy={record.isPending}
          error={dialogError}
          onClose={() => setOpen(false)}
          onSubmit={(v) => record.mutate(v)}
        />
      ) : null}
    </div>
  );
}

function stockWords(r: MinibarReconciliationRow): string {
  if (!r.stockTracked) return 'Not tracked';
  return r.stockMovement ? 'Stock reduced' : 'Stock movement missing';
}

function MinibarPickupDialog({
  propertyId,
  api,
  guests,
  products,
  staff,
  format,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  propertyId: string;
  api: HousekeepingApi;
  guests?: HousekeepingGuests;
  products: Array<{ productId: string; name: string; unitAmountMinor: number }>;
  staff: ReadonlyArray<{ staffId: string; displayName?: string | null }>;
  format: StockFormat;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: {
    roomId: string;
    reservationId: string;
    lines: Array<{ productId: string; quantity: number }>;
    attendantRef: string;
    complimentary: boolean;
    reason: string;
    summary: string;
  }) => void;
}) {
  const [roomId, setRoomId] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [attendantRef, setAttendantRef] = useState('');
  const [complimentary, setComplimentary] = useState(false);
  const [reason, setReason] = useState('');

  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard),
    retry: false,
  });
  const inHouse = (board.data?.rooms ?? []).flatMap((r) => (r.inHouse ? [{ ...r, stay: r.inHouse }] : []));
  const labelFor = useGuestLabels(
    propertyId,
    guests,
    inHouse.map((r) => r.stay.guestRef),
  );
  const chosen = inHouse.find((r) => r.roomId === roomId) ?? null;

  const lines = products.flatMap((p) => {
    const text = (qty[p.productId] ?? '').trim();
    if (!text) return [];
    return [{ product: p, raw: text, n: /^\d{1,2}$/.test(text) ? Number(text) : NaN }];
  });
  const invalid = lines.some((l) => !(l.n >= 1 && l.n <= HK_MINIBAR_QTY_MAX));
  const total = lines.reduce((sum, l) => sum + (Number.isFinite(l.n) ? l.n * l.product.unitAmountMinor : 0), 0);
  let problem: string | null = null;
  if (!chosen) problem = 'Pick a room with a guest in house.';
  else if (lines.length === 0) problem = 'Enter a quantity for at least one item.';
  else if (invalid) problem = `Quantities are whole numbers from 1 to ${HK_MINIBAR_QTY_MAX}.`;
  else if (complimentary && !reason.trim()) problem = 'Give a reason for the complimentary pickup.';

  function submit() {
    if (problem || busy || !chosen) return;
    onSubmit({
      roomId: chosen.roomId,
      reservationId: chosen.stay.reservationId,
      lines: lines.map((l) => ({ productId: l.product.productId, quantity: l.n })),
      attendantRef,
      complimentary,
      reason,
      summary: lines.map((l) => `${l.n} × ${l.product.name}`).join(', '),
    });
  }

  return (
    <Dialog
      open
      wide
      title="Record minibar pickup"
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || Boolean(problem)} onClick={submit}>
            Record pickup
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-minibar-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        {board.isSuccess && inHouse.length === 0 ? (
          <Alert intent="informational">No room has a guest in house, so there is nothing to charge a pickup to.</Alert>
        ) : null}
        {board.isError || !api.getRoomBoard ? (
          <Alert intent="exception">The in-house rooms could not be loaded, so a pickup cannot be recorded.</Alert>
        ) : null}
        <FieldGroup inline>
          <Field
            label="Room"
            hint="Only rooms with a guest in house are listed."
            control={
              <NativeSelect aria-label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Pick a room</option>
                {inHouse.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code ?? 'Room'} · {guests ? labelFor(r.stay.guestRef) : 'In-house guest'}
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
        </FieldGroup>
        <DataTable data-testid="hk-minibar-lines">
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Item</DataTableHeaderCell>
              <DataTableHeaderCell>Price each</DataTableHeaderCell>
              <DataTableHeaderCell>Quantity</DataTableHeaderCell>
              <DataTableHeaderCell>Line price</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {products.map((p) => {
              const text = (qty[p.productId] ?? '').trim();
              const n = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
              return (
                <DataTableRow key={p.productId}>
                  <DataTableCell>{p.name}</DataTableCell>
                  <DataTableCell>{moneyWords(format, p.unitAmountMinor)}</DataTableCell>
                  <DataTableCell>
                    <Input
                      aria-label={`Quantity of ${p.name}`}
                      value={qty[p.productId] ?? ''}
                      onChange={(e) => setQty((prev) => ({ ...prev, [p.productId]: e.target.value }))}
                    />
                  </DataTableCell>
                  <DataTableCell data-testid={`hk-minibar-line-${p.productId}`}>
                    {Number.isFinite(n) && n >= 1 ? moneyWords(format, n * p.unitAmountMinor) : '—'}
                  </DataTableCell>
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>
        <p data-testid="hk-minibar-total">
          {complimentary
            ? 'Complimentary: nothing is charged to the guest.'
            : `Charged to the guest folio: ${moneyWords(format, total)} before tax. The folio adds any tax.`}
        </p>
        <FieldGroup inline>
          <Field
            label="Complimentary"
            control={
              <Checkbox
                aria-label="Complimentary"
                checked={complimentary}
                onChange={(e) => setComplimentary(e.target.checked)}
              />
            }
          />
          {complimentary ? (
            <Field
              size="full"
              label="Reason (required)"
              control={
                <Input
                  aria-label="Complimentary reason"
                  value={reason}
                  maxLength={HK_MINIBAR_REASON_MAX}
                  onChange={(e) => setReason(e.target.value)}
                />
              }
            />
          ) : null}
        </FieldGroup>
        {problem ? (
          <p className="muted" data-testid="hk-minibar-problem">
            {problem}
          </p>
        ) : null}
        {lines.length > 0 && !invalid ? (
          <p className="muted">{plural(lines.length, 'item', 'items')} on this pickup.</p>
        ) : null}
      </form>
    </Dialog>
  );
}
