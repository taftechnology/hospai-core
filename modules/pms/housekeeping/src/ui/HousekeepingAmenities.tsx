import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AMENITY_DISPATCH_STATUSES,
  HK_AMENITY_EXCEPTION_MAX,
  HK_AMENITY_QTY_MAX,
  type AmenityDispatchRow,
  type AmenityRuleRow,
  type AmenityWhen,
  type PlanAmenityDispatchesResult,
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
  RowActions,
  Skeleton,
  Textarea,
  Toolbar,
} from '@hospai/ui-kit';
import { useMemo, useState } from 'react';
import { activeStaff, staffName, useStaffRoster } from './depth-shared.js';
import {
  AMENITY_STOCK_STATUS_LABEL,
  AMENITY_WHEN_LABEL,
  DISPATCH_STATUS_LABEL,
  wordFor,
} from './housekeeping-labels.js';
import { HousekeepingNav } from './housekeeping-nav.js';
import type { HousekeepingApi, HousekeepingRoomBoard } from './housekeeping-types.js';
import {
  amenitiesKey,
  amenityDispatchesKey,
  compactDate,
  invalidateStock,
  plural,
  type StockFormat,
} from './stock-shared.js';
import { useBusinessDate } from './use-business-date.js';

type DialogState = { kind: 'plan' } | { kind: 'confirm'; row: AmenityDispatchRow } | null;

/** Rooms to pre-pick for a rule, from the room board: arrivals, stayovers or departures of today. */
export function roomsForWhen(board: HousekeepingRoomBoard | undefined, when: AmenityWhen): string[] {
  if (!board) return [];
  return board.rooms
    .filter((r) => {
      if (when === 'arrival') return Boolean(r.arrival);
      if (!r.inHouse) return false;
      return when === 'departure' ? r.inHouse.dueOutToday === true : r.inHouse.dueOutToday !== true;
    })
    .map((r) => r.roomId);
}

function linesWords(row: AmenityDispatchRow): string {
  return row.lines
    .map((l) => {
      const sent = l.actualQuantity;
      return sent === null || sent === l.expectedQuantity
        ? `${l.amenityName} ${l.expectedQuantity}`
        : `${l.amenityName} ${l.expectedQuantity} (sent ${sent})`;
    })
    .join(', ');
}

export function HousekeepingAmenities({
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
  const [from, setFrom] = useBusinessDate(defaultBusinessDate);
  const [to, setTo] = useBusinessDate(defaultBusinessDate);
  const [status, setStatus] = useState('');
  const [roomId, setRoomId] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const filters = { from, to, status, roomId };
  const anyFilter = Boolean(status || roomId) || from !== defaultBusinessDate || to !== defaultBusinessDate;
  const failure = (err: unknown, fallback: string) => formatError?.(err) ?? fallback;

  const query = useQuery({
    queryKey: amenityDispatchesKey(propertyId, filters),
    queryFn: () =>
      api.getAmenityDispatches(propertyId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(status ? { status } : {}),
        ...(roomId ? { roomId } : {}),
      }),
    enabled: Boolean(from && to),
  });
  const amenitiesQuery = useQuery({ queryKey: amenitiesKey(propertyId), queryFn: () => api.getAmenities(propertyId) });
  const roomsQuery = useQuery({ queryKey: ['rooms', propertyId], queryFn: () => api.listRooms(propertyId) });
  const roster = useStaffRoster(api, propertyId, canReadRoster);
  const rooms = roomsQuery.data?.rooms ?? [];
  const rows = query.data?.dispatches ?? [];
  const activeRules = (amenitiesQuery.data?.rules ?? []).filter((r) => r.active);

  const plan = useMutation({
    mutationFn: (v: { businessDate: string; ruleId: string; roomIds: string[] }) =>
      api.planAmenityDispatches(propertyId, v, crypto.randomUUID()),
    onSuccess: async (result, v) => {
      const body = (result as { body?: PlanAmenityDispatchesResult } | undefined)?.body;
      const created = body?.created.length ?? v.roomIds.length;
      const skipped = body?.skippedRoomIds.length ?? 0;
      setDialog(null);
      setDialogError(null);
      setDone(
        `Planned ${plural(created, 'dispatch', 'dispatches')}.` +
          (skipped > 0 ? ` ${plural(skipped, 'room already had', 'rooms already had')} one for that rule and date.` : ''),
      );
      await queryClient.invalidateQueries({ queryKey: ['housekeeping-amenity-dispatches', propertyId] });
    },
    onError: (err) => setDialogError(failure(err, 'Could not plan the dispatches.')),
  });

  const confirm = useMutation({
    mutationFn: (v: {
      row: AmenityDispatchRow;
      lines: Array<{ lineId: string; actualQuantity: number }>;
      exceptionReason: string;
      supervisorRef: string;
    }) =>
      api.confirmAmenityDispatch(
        propertyId,
        {
          dispatchId: v.row.dispatchId,
          lines: v.lines,
          ...(v.exceptionReason.trim() ? { exceptionReason: v.exceptionReason.trim() } : {}),
          ...(v.supervisorRef ? { supervisorRef: v.supervisorRef } : {}),
        },
        crypto.randomUUID(),
      ),
    onSuccess: async (_r, v) => {
      setDialog(null);
      setDialogError(null);
      setDone(`Dispatch to room ${v.row.roomCode} confirmed.`);
      await queryClient.invalidateQueries({ queryKey: ['housekeeping-amenity-dispatches', propertyId] });
      invalidateStock(queryClient, propertyId);
    },
    onError: (err) => setDialogError(failure(err, 'Could not confirm the dispatch.')),
  });

  const busy = plan.isPending || confirm.isPending;

  return (
    <div className="ui-page-stack">
      <PageHeader title="Amenities" subtitle={subtitle ?? 'Amenity dispatches and ledger'} />
      <HousekeepingNav view="amenities" />
      {done ? (
        <Alert intent="settled" data-testid="hk-amenity-settled">
          {done}
        </Alert>
      ) : null}
      {!canWrite ? <Alert intent="informational">You can view amenity dispatches but not change them.</Alert> : null}
      {amenitiesQuery.isSuccess && activeRules.length === 0 ? (
        <Alert intent="informational" data-testid="hk-amenity-no-rules">
          There are no amenity rules yet. A manager can add amenities and rules in Settings, under Housekeeping.
        </Alert>
      ) : null}

      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={<Input type="date" aria-label="Dispatches from" value={from} onChange={(e) => setFrom(e.target.value)} />}
          />
          <Field
            size="xs"
            label="To"
            control={<Input type="date" aria-label="Dispatches to" value={to} onChange={(e) => setTo(e.target.value)} />}
          />
          <Field
            size="sm"
            label="Status"
            control={
              <NativeSelect aria-label="Dispatch status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {AMENITY_DISPATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DISPATCH_STATUS_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            size="sm"
            label="Room"
            control={
              <NativeSelect aria-label="Dispatch room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">All rooms</option>
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.code}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Button
            type="button"
            intent="primary"
            disabled={!canWrite || activeRules.length === 0}
            onClick={() => {
              setDialogError(null);
              setDialog({ kind: 'plan' });
            }}
          >
            Plan from rule
          </Button>
        </Toolbar>

        <CardContent flush>
          {query.isLoading ? <Skeleton label="Loading amenity dispatches" /> : null}
          {query.isError ? (
            <Alert intent="exception">{failure(query.error, 'Could not load amenity dispatches.')}</Alert>
          ) : null}
          {query.isSuccess && rows.length === 0 && !anyFilter ? (
            <EmptyState
              kind="empty"
              title="No amenity dispatches for this date."
              description={canWrite ? 'Use Plan from rule to plan some.' : undefined}
            />
          ) : null}
          {query.isSuccess && rows.length === 0 && anyFilter ? (
            <EmptyState kind="nomatch" title="No dispatches match these filters." />
          ) : null}
          {query.data?.truncated ? (
            <Alert intent="attention">Only the newest 500 dispatches are shown. Narrow the dates.</Alert>
          ) : null}
          {rows.length > 0 ? (
            <DataTable data-testid="hk-amenity-dispatches">
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Rule</DataTableHeaderCell>
                  <DataTableHeaderCell>Items</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Exception</DataTableHeaderCell>
                  <DataTableHeaderCell>Stock</DataTableHeaderCell>
                  <DataTableHeaderCell>Actions</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {rows.map((row) => (
                  <DataTableRow key={row.dispatchId}>
                    <DataTableCell>
                      <span className="ui-nowrap">{compactDate(format, row.businessDate)}</span>
                    </DataTableCell>
                    <DataTableCell>{row.roomCode}</DataTableCell>
                    <DataTableCell>
                      {row.ruleName}
                      <div className="muted">{wordFor(AMENITY_WHEN_LABEL, row.when)}</div>
                    </DataTableCell>
                    <DataTableCell>{linesWords(row)}</DataTableCell>
                    <DataTableCell>
                      <Badge rung={row.status === 'planned' ? 'attention' : 'neutral'}>
                        {wordFor(DISPATCH_STATUS_LABEL, row.status)}
                      </Badge>
                    </DataTableCell>
                    <DataTableCell>
                      {row.exceptionReason ?? '—'}
                      {row.supervisorRef ? (
                        <div className="muted">Confirmed with {staffName(roster.names, row.supervisorRef)}</div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell>{wordFor(AMENITY_STOCK_STATUS_LABEL, row.stockStatus)}</DataTableCell>
                    <DataTableCell>
                      <RowActions>
                        {row.status === 'planned' ? (
                          <Button
                            type="button"
                            aria-label={`Confirm dispatch to room ${row.roomCode}`}
                            disabled={!canWrite || busy}
                            onClick={() => {
                              setDialogError(null);
                              setDialog({ kind: 'confirm', row });
                            }}
                          >
                            Confirm
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

      {dialog?.kind === 'plan' ? (
        <PlanDialog
          propertyId={propertyId}
          api={api}
          defaultDate={defaultBusinessDate}
          rules={activeRules}
          rooms={rooms}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(v) => plan.mutate(v)}
        />
      ) : null}
      {dialog?.kind === 'confirm' ? (
        <ConfirmDialog
          row={dialog.row}
          staff={canReadRoster ? activeStaff(roster.staff) : []}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(v) => confirm.mutate({ row: dialog.row, ...v })}
        />
      ) : null}
    </div>
  );
}

function PlanDialog({
  propertyId,
  api,
  defaultDate,
  rules,
  rooms,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  propertyId: string;
  api: HousekeepingApi;
  defaultDate: string;
  rules: AmenityRuleRow[];
  rooms: ReadonlyArray<{ roomId: string; code: string }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: { businessDate: string; ruleId: string; roomIds: string[] }) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [ruleId, setRuleId] = useState(rules[0]?.ruleId ?? '');
  // Once the user touches the room boxes, their choice stands; until then the rule's pick applies.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const rule = rules.find((r) => r.ruleId === ruleId) ?? null;
  const board = useQuery({
    queryKey: ['room-board', propertyId],
    queryFn: () => api.getRoomBoard!(propertyId),
    enabled: Boolean(api.getRoomBoard),
    retry: false,
  });
  const typeOf = useMemo(() => new Map((board.data?.rooms ?? []).map((r) => [r.roomId, r.roomTypeId])), [board.data]);
  const eligible = rooms.filter((r) => !rule?.roomTypeId || !typeOf.size || typeOf.get(r.roomId) === rule.roomTypeId);
  const preselected = new Set(
    rule && date === defaultDate
      ? roomsForWhen(board.data, rule.when).filter((id) => eligible.some((r) => r.roomId === id))
      : [],
  );
  const chosen = picked ?? preselected;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const problem = !rule ? 'Pick a rule.' : chosen.size === 0 ? 'Pick at least one room.' : null;

  function submit() {
    if (!problem && !busy) onSubmit({ businessDate: date, ruleId, roomIds: [...chosen].sort() });
  }

  return (
    <Dialog
      open
      wide
      title="Plan amenity dispatches"
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button intent="primary" disabled={busy || Boolean(problem)} onClick={submit}>
            Plan dispatches
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-amenity-plan-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <FieldGroup inline>
          <Field
            label="Date"
            control={<Input type="date" aria-label="Plan date" value={date} onChange={(e) => { setDate(e.target.value); setPicked(null); }} />}
          />
          <Field
            label="Rule"
            hint={rule ? `${wordFor(AMENITY_WHEN_LABEL, rule.when)}: rooms are pre-picked from today's room board.` : undefined}
            control={
              <NativeSelect
                aria-label="Rule"
                value={ruleId}
                onChange={(e) => {
                  setRuleId(e.target.value);
                  setPicked(null);
                }}
              >
                {rules.map((r) => (
                  <option key={r.ruleId} value={r.ruleId}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        </FieldGroup>
        <div className="ui-row">
          <Button type="button" intent="ghost" onClick={() => setPicked(new Set(eligible.map((r) => r.roomId)))}>
            Pick all rooms
          </Button>
          <Button type="button" intent="ghost" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
          <span className="muted" data-testid="hk-amenity-plan-count">
            {plural(chosen.size, 'room', 'rooms')} picked
          </span>
        </div>
        {eligible.length === 0 ? (
          <p className="muted">No rooms are available for this rule.</p>
        ) : (
          <ul className="ui-stack" aria-label="Rooms">
            {eligible.map((r) => (
              <li key={r.roomId}>
                <Field
                  label={`Room ${r.code}`}
                  control={
                    <Checkbox
                      aria-label={`Room ${r.code}`}
                      checked={chosen.has(r.roomId)}
                      onChange={() => toggle(r.roomId)}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </form>
    </Dialog>
  );
}

function ConfirmDialog({
  row,
  staff,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: AmenityDispatchRow;
  staff: ReadonlyArray<{ staffId: string; displayName?: string | null }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (v: {
    lines: Array<{ lineId: string; actualQuantity: number }>;
    exceptionReason: string;
    supervisorRef: string;
  }) => void;
}) {
  const [actual, setActual] = useState<Record<string, string>>(() =>
    Object.fromEntries(row.lines.map((l) => [l.lineId, String(l.expectedQuantity)])),
  );
  const [reason, setReason] = useState('');
  const [supervisorRef, setSupervisorRef] = useState('');

  const parsed = row.lines.map((l) => {
    const text = (actual[l.lineId] ?? '').trim();
    const n = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
    return { line: l, n: n <= HK_AMENITY_QTY_MAX ? n : NaN };
  });
  const invalid = parsed.some((p) => !Number.isFinite(p.n));
  const differs = parsed.some((p) => p.n !== p.line.expectedQuantity);
  let problem: string | null = null;
  if (invalid) problem = 'Enter a whole number for every item, zero or more.';
  else if (differs && !reason.trim()) problem = 'Something differs from what was planned: give a reason.';

  function submit() {
    if (problem || busy) return;
    onSubmit({
      lines: parsed.map((p) => ({ lineId: p.line.lineId, actualQuantity: p.n })),
      exceptionReason: differs ? reason : '',
      supervisorRef,
    });
  }

  return (
    <Dialog
      open
      wide
      title={`Confirm dispatch · room ${row.roomCode}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            Keep planned
          </Button>
          <Button intent="primary" disabled={busy || Boolean(problem)} onClick={submit}>
            Confirm dispatch
          </Button>
        </>
      }
    >
      <form
        className="ui-stack"
        data-testid="hk-amenity-confirm-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error ? <Alert intent="exception">{error}</Alert> : null}
        <p>Enter what was actually sent. Linked stock goes down by these amounts.</p>
        <DataTable>
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell>Item</DataTableHeaderCell>
              <DataTableHeaderCell>Planned</DataTableHeaderCell>
              <DataTableHeaderCell>Sent</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {row.lines.map((l) => (
              <DataTableRow key={l.lineId}>
                <DataTableCell>{l.amenityName}</DataTableCell>
                <DataTableCell>
                  {l.expectedQuantity} {l.unit}
                </DataTableCell>
                <DataTableCell>
                  <Input
                    aria-label={`Sent ${l.amenityName}`}
                    value={actual[l.lineId] ?? ''}
                    onChange={(e) => setActual((prev) => ({ ...prev, [l.lineId]: e.target.value }))}
                  />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
        <FieldGroup inline>
          <Field
            size="full"
            label={differs ? 'Exception reason (required)' : 'Exception reason'}
            control={
              <Textarea
                aria-label="Exception reason"
                value={reason}
                maxLength={HK_AMENITY_EXCEPTION_MAX}
                disabled={!differs}
                onChange={(e) => setReason(e.target.value)}
              />
            }
          />
          {staff.length > 0 ? (
            <Field
              label="Supervisor (optional)"
              control={
                <NativeSelect aria-label="Supervisor" value={supervisorRef} onChange={(e) => setSupervisorRef(e.target.value)}>
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
        {problem ? (
          <p className="muted" data-testid="hk-amenity-problem">
            {problem}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
