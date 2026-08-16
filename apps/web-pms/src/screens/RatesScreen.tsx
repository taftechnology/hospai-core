import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
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
  Textarea,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { formatMinor, parseMajorToMinor } from '../money.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

type RoomTypeRow = {
  roomTypeId: string;
  code: string;
  name: string;
  status: string;
};

type RatePlanRow = {
  ratePlanId: string;
  code: string;
  name: string;
  status: string;
  cancelPenaltyType: string;
  cancelGraceHours: number;
  cancelPenaltyNights: number | null;
  cancelPenaltyBps: number | null;
  cancelPolicyText: string | null;
  parentRatePlanId: string | null;
  deriveBps: number | null;
};

type RatePromoRow = {
  promoId: string;
  code: string;
  name: string;
  kind: 'percent' | 'fixed_per_night';
  bps: number | null;
  amountMinor: number | null;
  validFrom: string | null;
  validTo: string | null;
  ratePlanId: string | null;
};

type RateDayRow = {
  roomTypeId: string;
  ratePlanId: string;
  stayDate: string;
  amountMinor: number;
  currency: string;
};

type RestrictionRow = {
  roomTypeId: string;
  stayDate: string;
  minLos: number | null;
  maxLos: number | null;
  cta: boolean;
  ctd: boolean;
  stopSell: boolean;
};

const WEEKDAYS = [
  { n: 0, label: 'Sun' },
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
] as const;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDateInclusive(from: string, to: string): string[] {
  if (!from || !to || to < from) return [];
  const capped = to > addDays(from, 89) ? addDays(from, 89) : to;
  const out: string[] = [];
  let cur = from;
  while (cur <= capped) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function weekdayUtc(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function ledgerCurrency(keys: Array<{ key: string; value: unknown }> | undefined): string {
  const row = keys?.find((k) => k.key === 'pms.money.currency_code');
  return typeof row?.value === 'string' && row.value ? row.value : 'USD';
}

function formatDerivePercent(deriveBps: number): string {
  const pct = deriveBps / 100;
  const rounded = Math.round(pct * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return rounded > 0 ? `+${text}%` : `${text}%`;
}

function derivedPlanBadge(plan: RatePlanRow, plans: RatePlanRow[]): string | null {
  if (plan.parentRatePlanId == null || plan.deriveBps == null) return null;
  const parent = plans.find((p) => p.ratePlanId === plan.parentRatePlanId);
  const parentCode = parent?.code ?? plan.parentRatePlanId;
  return `${formatDerivePercent(plan.deriveBps)} of ${parentCode}`;
}

function RateCell(props: {
  code: string;
  roomTypeId: string;
  stayDate: string;
  amountMinor: number | null;
  currency: string;
  ratePlanId: string;
  propertyId: string;
  readOnly?: boolean;
}) {
  const [raw, setRaw] = useState(props.amountMinor == null ? '' : formatMinor(props.amountMinor));
  return (
    <Field
      label={`Rate for ${props.code} on ${props.stayDate}`}
      control={
        <Input
          value={raw}
          autoComplete="off"
          readOnly={props.readOnly}
          disabled={props.readOnly}
          onChange={(e) => {
            if (props.readOnly) return;
            setRaw(e.target.value);
          }}
          onBlur={async () => {
            if (props.readOnly) return;
            if (raw.trim() === '') return;
            const amountMinor = parseMajorToMinor(raw);
            if (!Number.isFinite(amountMinor)) return;
            await api.putRateDay(props.propertyId, {
              roomTypeId: props.roomTypeId,
              ratePlanId: props.ratePlanId,
              stayDate: props.stayDate,
              amountMinor,
              currency: props.currency,
            });
          }}
        />
      }
    />
  );
}

export function RatesScreen({ tab }: { tab?: 'plans' | 'matrix' | 'restrictions' }) {
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const activeTab = tab ?? 'matrix';
  const tz = usePropertyTimeZone();
  const today = tz ? propertyLocalToday(tz) : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') ?? (today ?? '');
  const to = searchParams.get('to') ?? (today ? addDays(today, 13) : '');
  const plan = searchParams.get('plan') ?? 'BAR';

  const [planCode, setPlanCode] = useState('');
  const [planName, setPlanName] = useState('');
  const [derivedFrom, setDerivedFrom] = useState('');
  const [derivePercent, setDerivePercent] = useState('');
  const [cancelType, setCancelType] = useState('none');
  const [graceHours, setGraceHours] = useState('0');
  const [penaltyNights, setPenaltyNights] = useState('');
  const [penaltyBps, setPenaltyBps] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [bulkAmount, setBulkAmount] = useState('');
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5, 6]));
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [archivePlan, setArchivePlan] = useState<RatePlanRow | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoName, setPromoName] = useState('');
  const [promoKind, setPromoKind] = useState<'percent' | 'fixed_per_night'>('percent');
  const [promoBps, setPromoBps] = useState('');
  const [promoAmount, setPromoAmount] = useState('');
  const [promoValidFrom, setPromoValidFrom] = useState('');
  const [promoValidTo, setPromoValidTo] = useState('');
  const [promoPlanId, setPromoPlanId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const unsavedGuard = useUnsavedChanges(Boolean(planCode || planName));

  const typesQ = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    retry: false,
  });
  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    retry: false,
  });
  const promosQ = useQuery({
    queryKey: ['rate-promos', propertyId],
    queryFn: () => api.listRatePromos(propertyId),
    enabled: activeTab === 'plans',
    retry: false,
  });
  const configQ = useQuery({
    queryKey: ['domain-config', propertyId],
    queryFn: () => api.listDomainConfig(propertyId),
    retry: false,
  });
  const dates = useMemo(() => eachDateInclusive(from, to), [from, to]);
  const daysQ = useQuery({
    queryKey: ['rate-days', propertyId, from, to, plan],
    queryFn: () => api.listRateDays(propertyId, { fromDate: from, toDate: to, ratePlanId: plan }),
    enabled: Boolean(from && to) && activeTab === 'matrix',
    retry: false,
  });
  const restQ = useQuery({
    queryKey: ['restriction-days', propertyId, from, to],
    queryFn: () => api.listRestrictionDays(propertyId, { fromDate: from, toDate: to }),
    enabled: Boolean(from && to) && activeTab === 'restrictions',
    retry: false,
  });

  const types = (typesQ.data?.roomTypes ?? []) as RoomTypeRow[];
  const plans = (plansQ.data?.plans ?? []) as RatePlanRow[];
  const promos = (promosQ.data?.promos ?? []) as RatePromoRow[];
  const currency = ledgerCurrency(configQ.data?.keys as Array<{ key: string; value: unknown }>);
  const dayMap = useMemo(() => {
    const m = new Map<string, RateDayRow>();
    for (const d of (daysQ.data?.days ?? []) as RateDayRow[]) {
      m.set(`${d.roomTypeId}:${d.stayDate}`, d);
    }
    return m;
  }, [daysQ.data]);
  const restMap = useMemo(() => {
    const m = new Map<string, RestrictionRow>();
    for (const d of (restQ.data?.days ?? []) as RestrictionRow[]) {
      m.set(`${d.roomTypeId}:${d.stayDate}`, d);
    }
    return m;
  }, [restQ.data]);

  const typeIds = selectedTypes ?? new Set(types.map((t) => t.roomTypeId));
  const independentPlans = plans.filter((p) => p.status === 'active' && p.parentRatePlanId == null);
  const selectedPlan = plans.find((p) => p.ratePlanId === plan);
  const isDerivedMatrix = selectedPlan?.parentRatePlanId != null;

  const createPlan = useMutation({
    mutationFn: () => {
      const isDerived = derivedFrom !== '';
      const deriveBps =
        isDerived && derivePercent.trim() !== ''
          ? Math.round(parseFloat(derivePercent) * 100)
          : null;
      return api.createRatePlan(propertyId, {
        ratePlanId: crypto.randomUUID(),
        code: planCode,
        name: planName,
        cancelPenaltyType: cancelType,
        cancelGraceHours: Number(graceHours),
        cancelPenaltyNights: cancelType === 'nights' ? Number(penaltyNights) : null,
        cancelPenaltyBps: cancelType === 'percent' ? Number(penaltyBps) : null,
        cancelPolicyText: policyText || null,
        ...(isDerived && deriveBps != null && Number.isFinite(deriveBps)
          ? { parentRatePlanId: derivedFrom, deriveBps }
          : {}),
      });
    },
    onSuccess: async () => {
      setPlanCode('');
      setPlanName('');
      setDerivedFrom('');
      setDerivePercent('');
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-plans', propertyId] });
    },
  });

  const doArchivePlan = useMutation({
    mutationFn: (id: string) => api.archiveRatePlan(propertyId, id),
    onSuccess: async () => {
      setArchivePlan(null);
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-plans', propertyId] });
    },
  });

  const createPromo = useMutation({
    mutationFn: () => {
      const input: Parameters<typeof api.createRatePromo>[1] = {
        promoId: crypto.randomUUID(),
        code: promoCode,
        name: promoName,
        kind: promoKind,
        ...(promoKind === 'percent'
          ? { bps: Number(promoBps) }
          : { amountMinor: Number(promoAmount) }),
        ...(promoValidFrom && promoValidTo
          ? { validFrom: promoValidFrom, validTo: promoValidTo }
          : {}),
        ...(promoPlanId ? { ratePlanId: promoPlanId } : {}),
      };
      return api.createRatePromo(propertyId, input);
    },
    onSuccess: async () => {
      setPromoCode('');
      setPromoName('');
      setPromoBps('');
      setPromoAmount('');
      setPromoValidFrom('');
      setPromoValidTo('');
      setPromoPlanId('');
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-promos', propertyId] });
    },
  });

  const doArchivePromo = useMutation({
    mutationFn: (promoId: string) => api.archiveRatePromo(propertyId, promoId),
    onSuccess: async () => {
      setMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-promos', propertyId] });
    },
  });

  const plansFailClosed = plansQ.isError && asClassified(plansQ.error).class === 'fail_closed';
  const typesFailClosed = typesQ.isError && asClassified(typesQ.error).class === 'fail_closed';

  function setWindow(nextFrom: string, nextTo: string, nextPlan = plan) {
    const next = new URLSearchParams(searchParams);
    if (nextFrom) next.set('from', nextFrom);
    if (nextTo) next.set('to', nextTo);
    if (nextPlan) next.set('plan', nextPlan);
    setSearchParams(next);
  }

  return (
    <>
      <PageHeader title="Rates" />
      <Card data-testid="rates-screen">
      {unsavedGuard}
      <nav className="nav">
        <Link to="/rates/plans">Plans</Link>
        <Link to="/rates/matrix">Matrix</Link>
        <Link to="/rates/restrictions">Restrictions</Link>
      </nav>
      {message ? (
        <p className="muted" aria-live="polite">
          {message}
        </p>
      ) : null}

      {plansFailClosed || typesFailClosed ? (
        <Alert>Property unreachable — cannot load rates.</Alert>
      ) : null}

      {activeTab === 'plans' && !plansFailClosed ? (
        <>
          <DataTable>
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell>Code</DataTableHeaderCell>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Cancel</DataTableHeaderCell>
                <DataTableHeaderCell />
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {plans.map((p) => (
                <DataTableRow key={p.ratePlanId}>
                  <DataTableCell>
                    <span translate="no">{p.code}</span>
                  </DataTableCell>
                  <DataTableCell>
                    {p.name}
                    {derivedPlanBadge(p, plans) ? (
                      <span className="muted"> {derivedPlanBadge(p, plans)}</span>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>{p.cancelPenaltyType}</DataTableCell>
                  <DataTableCell>
                    {p.ratePlanId === 'BAR' ? null : (
                      <Button type="button" intent="destructive" onClick={() => setArchivePlan(p)}>
                        Archive {p.code}
                      </Button>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createPlan.mutate();
            }}
          >
            <h2>Create Rate Plan</h2>
            <Field
              label="Code"
              control={
                <Input
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={
                <Input value={planName} onChange={(e) => setPlanName(e.target.value)} autoComplete="off" />
              }
            />
            <Field
              label="Derived from"
              control={
                <NativeSelect
                  value={derivedFrom}
                  onChange={(e) => {
                    setDerivedFrom(e.target.value);
                    if (!e.target.value) setDerivePercent('');
                  }}
                >
                  <option value="">Independent</option>
                  {independentPlans.map((p) => (
                    <option key={p.ratePlanId} value={p.ratePlanId}>
                      {p.code}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            {derivedFrom ? (
              <Field
                label="Derive percent"
                control={
                  <Input
                    type="number"
                    value={derivePercent}
                    onChange={(e) => setDerivePercent(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
            ) : null}
            <Field
              label="Cancel penalty"
              control={
                <NativeSelect value={cancelType} onChange={(e) => setCancelType(e.target.value)}>
                  <option value="none">none</option>
                  <option value="first_night">first_night</option>
                  <option value="nights">nights</option>
                  <option value="percent">percent</option>
                  <option value="full">full</option>
                </NativeSelect>
              }
            />
            <Field
              label="Grace hours"
              control={
                <Input
                  type="number"
                  min={0}
                  value={graceHours}
                  onChange={(e) => setGraceHours(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            {cancelType === 'nights' ? (
              <Field
                label="Penalty nights"
                control={
                  <Input
                    type="number"
                    min={1}
                    value={penaltyNights}
                    onChange={(e) => setPenaltyNights(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
            ) : null}
            {cancelType === 'percent' ? (
              <Field
                label="Penalty bps"
                control={
                  <Input
                    type="number"
                    min={1}
                    value={penaltyBps}
                    onChange={(e) => setPenaltyBps(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
            ) : null}
            <Field
              label="Policy"
              control={
                <Textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} autoComplete="off" />
              }
            />
            <Button type="submit" intent="primary" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Saving…' : 'Create Rate Plan'}
            </Button>
          </form>

          <h2>Promo codes</h2>
          <ul data-testid="promo-list">
            {promos.map((p) => (
              <li key={p.promoId}>
                <span translate="no">
                  {p.code} — {p.name}
                </span>{' '}
                <Button
                  type="button"
                  intent="destructive"
                  data-testid={`promo-archive-${p.code}`}
                  onClick={() => doArchivePromo.mutate(p.promoId)}
                >
                  Archive
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createPromo.mutate();
            }}
          >
            <Field
              label="Code"
              control={
                <Input
                  data-testid="promo-code-input"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={
                <Input
                  data-testid="promo-name-input"
                  value={promoName}
                  onChange={(e) => setPromoName(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Kind"
              control={
                <NativeSelect
                  data-testid="promo-kind-select"
                  value={promoKind}
                  onChange={(e) =>
                    setPromoKind(e.target.value as 'percent' | 'fixed_per_night')
                  }
                >
                  <option value="percent">percent</option>
                  <option value="fixed_per_night">fixed_per_night</option>
                </NativeSelect>
              }
            />
            {promoKind === 'percent' ? (
              <Field
                label="Bps"
                control={
                  <Input
                    data-testid="promo-bps-input"
                    type="number"
                    min={1}
                    value={promoBps}
                    onChange={(e) => setPromoBps(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
            ) : (
              <Field
                label="Amount (minor)"
                control={
                  <Input
                    data-testid="promo-amount-input"
                    type="number"
                    min={1}
                    value={promoAmount}
                    onChange={(e) => setPromoAmount(e.target.value)}
                    autoComplete="off"
                  />
                }
              />
            )}
            <Field
              label="Valid from"
              control={
                <Input
                  data-testid="promo-valid-from"
                  type="date"
                  value={promoValidFrom}
                  onChange={(e) => setPromoValidFrom(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Valid to"
              control={
                <Input
                  data-testid="promo-valid-to"
                  type="date"
                  value={promoValidTo}
                  onChange={(e) => setPromoValidTo(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Rate plan"
              control={
                <NativeSelect
                  value={promoPlanId}
                  onChange={(e) => setPromoPlanId(e.target.value)}
                >
                  <option value="">All plans</option>
                  {plans
                    .filter((p) => p.status === 'active')
                    .map((p) => (
                      <option key={p.ratePlanId} value={p.ratePlanId}>
                        {p.code}
                      </option>
                    ))}
                </NativeSelect>
              }
            />
            <Button
              type="submit"
              intent="primary"
              data-testid="promo-create"
              disabled={createPromo.isPending}
            >
              {createPromo.isPending ? 'Saving…' : 'Create Promo'}
            </Button>
          </form>
        </>
      ) : null}

      {activeTab === 'matrix' && !plansFailClosed && !typesFailClosed ? (
        typesQ.isPending || plansQ.isPending ? (
          <p className="muted">Loading…</p>
        ) : types.length === 0 ? (
          <p className="muted">Create a room type first.</p>
        ) : (
          <>
            <p className="muted" translate="no">
              Ledger currency {currency}
            </p>
            <Field
              label="From"
              control={
                <Input
                  type="date"
                  value={from}
                  autoComplete="off"
                  onChange={(e) => setWindow(e.target.value, to)}
                />
              }
            />
            <Field
              label="To"
              control={
                <Input
                  type="date"
                  value={to}
                  autoComplete="off"
                  onChange={(e) => setWindow(from, e.target.value)}
                />
              }
            />
            <Field
              label="Rate plan"
              control={
                <NativeSelect value={plan} onChange={(e) => setWindow(from, to, e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.ratePlanId} value={p.ratePlanId}>
                      {p.code}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            {isDerivedMatrix ? (
              <p className="muted">Edit the parent plan’s rates.</p>
            ) : null}
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  {dates.map((d) => (
                    <DataTableHeaderCell key={d} align="right">
                      {d}
                    </DataTableHeaderCell>
                  ))}
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {types.map((t) => (
                  <DataTableRow key={t.roomTypeId}>
                    <DataTableCell>
                      <span translate="no">{t.code}</span> {t.name}
                    </DataTableCell>
                    {dates.map((d) => {
                      const row = dayMap.get(`${t.roomTypeId}:${d}`);
                      return (
                        <DataTableCell key={d}>
                          <RateCell
                            code={t.code}
                            roomTypeId={t.roomTypeId}
                            stayDate={d}
                            amountMinor={row?.amountMinor ?? null}
                            currency={currency}
                            ratePlanId={plan}
                            propertyId={propertyId}
                            readOnly={isDerivedMatrix}
                          />
                        </DataTableCell>
                      );
                    })}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>

            {!isDerivedMatrix ? (
              <form
                className="stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const amountMinor = parseMajorToMinor(bulkAmount);
                  if (!Number.isFinite(amountMinor) || bulkAmount.trim() === '') return;
                  const updates = types
                    .filter((t) => typeIds.has(t.roomTypeId))
                    .flatMap((t) =>
                      dates
                        .filter((d) => weekdays.has(weekdayUtc(d)))
                        .map((stayDate) => ({
                          roomTypeId: t.roomTypeId,
                          ratePlanId: plan,
                          stayDate,
                          amountMinor,
                          currency,
                        })),
                    );
                  setSavingBulk(true);
                  try {
                    await api.bulkUpdateRates(propertyId, updates);
                    setMessage('Saved.');
                    await queryClient.invalidateQueries({ queryKey: ['rate-days', propertyId] });
                  } finally {
                    setSavingBulk(false);
                  }
                }}
              >
                <h2>Bulk fill</h2>
                {types.map((t) => (
                  <Field
                    key={t.roomTypeId}
                    label={t.code}
                    control={
                      <Checkbox
                        checked={typeIds.has(t.roomTypeId)}
                        onChange={(e) => {
                          const next = new Set(typeIds);
                          if (e.target.checked) next.add(t.roomTypeId);
                          else next.delete(t.roomTypeId);
                          setSelectedTypes(next);
                        }}
                      />
                    }
                  />
                ))}
                {WEEKDAYS.map((w) => (
                  <Field
                    key={w.n}
                    label={w.label}
                    control={
                      <Checkbox
                        checked={weekdays.has(w.n)}
                        onChange={(e) => {
                          const next = new Set(weekdays);
                          if (e.target.checked) next.add(w.n);
                          else next.delete(w.n);
                          setWeekdays(next);
                        }}
                      />
                    }
                  />
                ))}
                <Field
                  label="Bulk amount"
                  control={
                    <Input
                      value={bulkAmount}
                      onChange={(e) => setBulkAmount(e.target.value)}
                      autoComplete="off"
                    />
                  }
                />
                <Button type="submit" intent="primary" disabled={savingBulk}>
                  {savingBulk ? 'Saving…' : 'Fill Selected Days'}
                </Button>
              </form>
            ) : null}
          </>
        )
      ) : null}

      {activeTab === 'restrictions' && !typesFailClosed ? (
        typesQ.isPending ? (
          <p className="muted">Loading…</p>
        ) : types.length === 0 ? (
          <p className="muted">Create a room type first.</p>
        ) : (
          <>
            <p className="muted">Stop sell hides the type from sale without changing inventory.</p>
            <p className="muted">
              Closed to arrival / departure apply to the stay’s boundary nights.
            </p>
            <Field
              label="From"
              control={
                <Input
                  type="date"
                  value={from}
                  autoComplete="off"
                  onChange={(e) => setWindow(e.target.value, to)}
                />
              }
            />
            <Field
              label="To"
              control={
                <Input
                  type="date"
                  value={to}
                  autoComplete="off"
                  onChange={(e) => setWindow(from, e.target.value)}
                />
              }
            />
            <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  {dates.map((d) => (
                    <DataTableHeaderCell key={d}>{d}</DataTableHeaderCell>
                  ))}
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {types.map((t) => (
                  <DataTableRow key={t.roomTypeId}>
                    <DataTableCell>
                      <span translate="no">{t.code}</span> {t.name}
                    </DataTableCell>
                    {dates.map((d) => {
                      const row = restMap.get(`${t.roomTypeId}:${d}`);
                      return (
                        <DataTableCell key={d}>
                          <Field
                            label={`Min LOS for ${t.code} on ${d}`}
                            control={
                              <Input
                                type="number"
                                min={1}
                                autoComplete="off"
                                defaultValue={row?.minLos != null ? String(row.minLos) : ''}
                                onBlur={async (e) => {
                                  const v = e.target.value.trim();
                                  await api.putRestrictionDay(propertyId, {
                                    roomTypeId: t.roomTypeId,
                                    stayDate: d,
                                    minLos: v ? Number(v) : null,
                                    maxLos: row?.maxLos ?? null,
                                    cta: row?.cta ?? false,
                                    ctd: row?.ctd ?? false,
                                    stopSell: row?.stopSell ?? false,
                                  });
                                }}
                              />
                            }
                          />
                          <Field
                            label={`Max LOS for ${t.code} on ${d}`}
                            control={
                              <Input
                                type="number"
                                min={1}
                                autoComplete="off"
                                defaultValue={row?.maxLos != null ? String(row.maxLos) : ''}
                                onBlur={async (e) => {
                                  const v = e.target.value.trim();
                                  await api.putRestrictionDay(propertyId, {
                                    roomTypeId: t.roomTypeId,
                                    stayDate: d,
                                    minLos: row?.minLos ?? null,
                                    maxLos: v ? Number(v) : null,
                                    cta: row?.cta ?? false,
                                    ctd: row?.ctd ?? false,
                                    stopSell: row?.stopSell ?? false,
                                  });
                                }}
                              />
                            }
                          />
                          <Field
                            label={`CTA for ${t.code} on ${d}`}
                            control={
                              <Checkbox
                                defaultChecked={row?.cta ?? false}
                                onChange={async (e) => {
                                  await api.putRestrictionDay(propertyId, {
                                    roomTypeId: t.roomTypeId,
                                    stayDate: d,
                                    minLos: row?.minLos ?? null,
                                    maxLos: row?.maxLos ?? null,
                                    cta: e.target.checked,
                                    ctd: row?.ctd ?? false,
                                    stopSell: row?.stopSell ?? false,
                                  });
                                }}
                              />
                            }
                          />
                          <Field
                            label={`CTD for ${t.code} on ${d}`}
                            control={
                              <Checkbox
                                defaultChecked={row?.ctd ?? false}
                                onChange={async (e) => {
                                  await api.putRestrictionDay(propertyId, {
                                    roomTypeId: t.roomTypeId,
                                    stayDate: d,
                                    minLos: row?.minLos ?? null,
                                    maxLos: row?.maxLos ?? null,
                                    cta: row?.cta ?? false,
                                    ctd: e.target.checked,
                                    stopSell: row?.stopSell ?? false,
                                  });
                                }}
                              />
                            }
                          />
                          <Field
                            label={`Stop sell for ${t.code} on ${d}`}
                            control={
                              <Checkbox
                                defaultChecked={row?.stopSell ?? false}
                                onChange={async (e) => {
                                  await api.putRestrictionDay(propertyId, {
                                    roomTypeId: t.roomTypeId,
                                    stayDate: d,
                                    minLos: row?.minLos ?? null,
                                    maxLos: row?.maxLos ?? null,
                                    cta: row?.cta ?? false,
                                    ctd: row?.ctd ?? false,
                                    stopSell: e.target.checked,
                                  });
                                }}
                              />
                            }
                          />
                        </DataTableCell>
                      );
                    })}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </>
        )
      ) : null}

      {archivePlan ? (
        <Card role="dialog" aria-modal="true">
          <p>Archive {archivePlan.code}? It will stop being sellable.</p>
          <Button type="button" onClick={() => setArchivePlan(null)}>
            Cancel
          </Button>
          <Button type="button" intent="destructive" onClick={() => doArchivePlan.mutate(archivePlan.ratePlanId)}>
            Archive
          </Button>
        </Card>
      ) : null}
    </Card>
    </>
  );
}
