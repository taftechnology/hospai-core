import { RATES_BULK_UPDATE_MAX } from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
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
  Toolbar,
  VisuallyHidden,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { formatMinor, parseMajorToMinor } from '../money.js';
import {
  RATE_AMOUNT_RE,
  buildBulkRateCells,
  bulkRangeProblem,
  chunk,
  eachStayDate,
  utcWeekday,
  type BulkRateCell,
} from './rates-bulk.js';
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

function ledgerCurrency(keys: Array<{ key: string; value: unknown }> | undefined): string {
  const row = keys?.find((k) => k.key === 'pms.money.currency_code');
  return typeof row?.value === 'string' && row.value ? row.value : 'USD';
}

function formatMatrixDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
  }).formatToParts(new Date(`${iso}T12:00:00Z`));
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${weekday} ${day}`;
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

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function ratesLaterNote(lead: ReactNode) {
  return (
    <>
      {lead}
      <span className="sep">·</span>
      <Link to="/settings/products">Add-ons: Products</Link>
      <span className="sep">·</span>
      {'Channel / Yield \u2014 later'}
    </>
  );
}

function RateAmount({ amountMinor }: { amountMinor: number | null }) {
  if (amountMinor == null) return <span className="muted">{'\u2014'}</span>;
  return formatMinor(amountMinor);
}

type RestrictionDraft = {
  minLos: string;
  maxLos: string;
  cta: boolean;
  ctd: boolean;
  stopSell: boolean;
};

function losText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

function parseLos(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

function draftFromRow(row: RestrictionRow | undefined): RestrictionDraft {
  return {
    minLos: losText(row?.minLos),
    maxLos: losText(row?.maxLos),
    cta: row?.cta ?? false,
    ctd: row?.ctd ?? false,
    stopSell: row?.stopSell ?? false,
  };
}

function RestrictionCell(props: {
  code: string;
  roomTypeId: string;
  stayDate: string;
  row: RestrictionRow | undefined;
  onSave: (input: {
    roomTypeId: string;
    stayDate: string;
    minLos: number | null;
    maxLos: number | null;
    cta: boolean;
    ctd: boolean;
    stopSell: boolean;
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RestrictionDraft>(() => draftFromRow(props.row));
  const prevRow = useRef(props.row);

  useEffect(() => {
    const prev = prevRow.current;
    const next = props.row;
    if (prev === next) return;
    prevRow.current = next;
    setDraft((current) => {
      const updated = { ...current };
      if ((prev?.minLos ?? null) !== (next?.minLos ?? null)) updated.minLos = losText(next?.minLos);
      if ((prev?.maxLos ?? null) !== (next?.maxLos ?? null)) updated.maxLos = losText(next?.maxLos);
      if ((prev?.cta ?? false) !== (next?.cta ?? false)) updated.cta = next?.cta ?? false;
      if ((prev?.ctd ?? false) !== (next?.ctd ?? false)) updated.ctd = next?.ctd ?? false;
      if ((prev?.stopSell ?? false) !== (next?.stopSell ?? false)) {
        updated.stopSell = next?.stopSell ?? false;
      }
      return updated;
    });
  }, [props.row]);

  async function commit(field: keyof RestrictionDraft, override: Partial<RestrictionDraft>) {
    const next = { ...draft, ...override };
    setDraft((current) => ({ ...current, ...override }));
    try {
      await props.onSave({
        roomTypeId: props.roomTypeId,
        stayDate: props.stayDate,
        minLos: parseLos(next.minLos),
        maxLos: parseLos(next.maxLos),
        cta: next.cta,
        ctd: next.ctd,
        stopSell: next.stopSell,
      });
    } catch {
      const stored = draftFromRow(prevRow.current);
      setDraft((current) => ({ ...current, [field]: stored[field] }));
    }
  }

  return (
    <>
      <div className="rates-restrictions__los">
        <Field
          label={`Min LOS for ${props.code}`}
          control={
            <Input
              type="number"
              min={1}
              autoComplete="off"
              value={draft.minLos}
              onChange={(e) => setDraft((current) => ({ ...current, minLos: e.target.value }))}
              onBlur={(e) => {
                void commit('minLos', { minLos: e.target.value });
              }}
            />
          }
        />
        <Field
          label={`Max LOS for ${props.code}`}
          control={
            <Input
              type="number"
              min={1}
              autoComplete="off"
              value={draft.maxLos}
              onChange={(e) => setDraft((current) => ({ ...current, maxLos: e.target.value }))}
              onBlur={(e) => {
                void commit('maxLos', { maxLos: e.target.value });
              }}
            />
          }
        />
      </div>
      <div className="rates-restrictions__toggles">
        <Field
          label={`CTA for ${props.code}`}
          control={
            <Checkbox
              checked={draft.cta}
              onChange={(e) => {
                void commit('cta', { cta: e.target.checked });
              }}
            />
          }
        />
        <Field
          label={`CTD for ${props.code}`}
          control={
            <Checkbox
              checked={draft.ctd}
              onChange={(e) => {
                void commit('ctd', { ctd: e.target.checked });
              }}
            />
          }
        />
        <Field
          label={`Stop sell for ${props.code}`}
          control={
            <Checkbox
              checked={draft.stopSell}
              onChange={(e) => {
                void commit('stopSell', { stopSell: e.target.checked });
              }}
            />
          }
        />
      </div>
    </>
  );
}

function RestrictionBadges({ row }: { row: RestrictionRow | undefined }) {
  if (!row) return null;
  const badges: Array<{ key: string; label: string; rung: 'neutral' | 'attention' | 'exception' }> =
    [];
  if (row.minLos != null) badges.push({ key: 'min', label: `Min ${row.minLos}`, rung: 'neutral' });
  if (row.maxLos != null) badges.push({ key: 'max', label: `Max ${row.maxLos}`, rung: 'neutral' });
  if (row.cta) badges.push({ key: 'cta', label: 'CTA', rung: 'attention' });
  if (row.ctd) badges.push({ key: 'ctd', label: 'CTD', rung: 'attention' });
  if (row.stopSell) badges.push({ key: 'stop', label: 'Stop sell', rung: 'exception' });
  if (badges.length === 0) return null;
  return (
    <div className="rates-matrix__badges">
      {badges.map((badge) => (
        <Badge key={badge.key} rung={badge.rung}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}

function RateCellEditor(props: {
  code: string;
  roomTypeId: string;
  stayDate: string;
  amountMinor: number | null;
  currency: string;
  ratePlanId: string;
  propertyId: string;
  onClose: () => void;
  onError: (err: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const [raw, setRaw] = useState(props.amountMinor == null ? '' : formatMinor(props.amountMinor));
  const closed = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = wrapRef.current?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    input.select();
  }, []);

  async function commit() {
    if (closed.current) return;
    closed.current = true;
    const value = raw.trim();
    if (!RATE_AMOUNT_RE.test(value)) {
      props.onClose();
      return;
    }
    try {
      await api.putRateDay(props.propertyId, {
        roomTypeId: props.roomTypeId,
        ratePlanId: props.ratePlanId,
        stayDate: props.stayDate,
        amountMinor: parseMajorToMinor(value),
        currency: props.currency,
      });
    } catch (err) {
      props.onError(err);
      props.onClose();
      return;
    }
    await props.onSaved();
    props.onClose();
  }

  function cancel() {
    if (closed.current) return;
    closed.current = true;
    props.onClose();
  }

  return (
    <div ref={wrapRef}>
      <Field
        label={<VisuallyHidden>{`Rate for ${props.code} on ${props.stayDate}`}</VisuallyHidden>}
        control={
          <Input
            value={raw}
            autoComplete="off"
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => {
              void commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
          />
        }
      />
    </div>
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
  const [bulkFrom, setBulkFrom] = useState(from);
  const [bulkTo, setBulkTo] = useState(to);
  const bulkSeeded = useRef(from !== '' && to !== '');
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4, 5, 6]));
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [bulkFailure, setBulkFailure] = useState<{ chunks: BulkRateCell[][]; text: string } | null>(
    null,
  );
  const [archivePlan, setArchivePlan] = useState<RatePlanRow | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoName, setPromoName] = useState('');
  const [promoKind, setPromoKind] = useState<'percent' | 'fixed_per_night'>('percent');
  const [promoBps, setPromoBps] = useState('');
  const [promoAmount, setPromoAmount] = useState('');
  const [promoValidFrom, setPromoValidFrom] = useState('');
  const [promoValidTo, setPromoValidTo] = useState('');
  const [promoPlanId, setPromoPlanId] = useState('');
  const [notice, setNotice] = useState<{ text: string; intent: 'settled' | 'exception' } | null>(
    null,
  );
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMessage = (text: string) => {
    setNotice({ text, intent: 'settled' });
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setNotice(null), 5000);
  };
  const showProblem = (text: string) => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setNotice({ text, intent: 'exception' });
  };
  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);
  useEffect(() => {
    if (bulkSeeded.current) return;
    if (!from || !to) return;
    bulkSeeded.current = true;
    setBulkFrom(from);
    setBulkTo(to);
  }, [from, to]);

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
    enabled: Boolean(from && to) && (activeTab === 'restrictions' || activeTab === 'matrix'),
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
      flashMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-plans', propertyId] });
    },
  });

  const doArchivePlan = useMutation({
    mutationFn: (id: string) => api.archiveRatePlan(propertyId, id),
    onSuccess: async () => {
      setArchivePlan(null);
      flashMessage('Saved.');
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
      flashMessage('Saved.');
      await queryClient.invalidateQueries({ queryKey: ['rate-promos', propertyId] });
    },
  });

  const doArchivePromo = useMutation({
    mutationFn: (promoId: string) => api.archiveRatePromo(propertyId, promoId),
    onSuccess: async () => {
      flashMessage('Saved.');
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

  const selectedIds = types.filter((t) => typeIds.has(t.roomTypeId)).map((t) => t.roomTypeId);
  const rangeProblem = bulkRangeProblem(bulkFrom, bulkTo);
  const rangeReady = Boolean(bulkFrom && bulkTo && rangeProblem == null);
  const matchingDays = rangeReady
    ? eachStayDate(bulkFrom, bulkTo).filter((stayDate) => weekdays.has(utcWeekday(stayDate))).length
    : 0;
  const previewCount = rangeReady ? selectedIds.length * matchingDays : 0;
  const previewText =
    `Sets ${previewCount} ${plural(previewCount, 'rate', 'rates')}` +
    ` \u2014 ${selectedIds.length} ${plural(selectedIds.length, 'type', 'types')}` +
    ` \u00d7 ${matchingDays} ${plural(matchingDays, 'day', 'days')}`;
  const amountOk = RATE_AMOUNT_RE.test(bulkAmount.trim());
  const bulkToError =
    rangeProblem === 'order'
      ? 'Fill to is before Fill from.'
      : rangeProblem === 'length'
        ? 'Range is longer than 366 days.'
        : undefined;

  async function postBulk(parts: BulkRateCell[][]) {
    setSavingBulk(true);
    setBulkFailure(null);
    const failed: BulkRateCell[][] = [];
    let saved = 0;
    let failure: unknown = null;
    try {
      for (const part of parts) {
        try {
          await api.bulkUpdateRates(propertyId, part);
          saved += part.length;
          void queryClient.invalidateQueries({ queryKey: ['rate-days', propertyId] });
        } catch (err) {
          failed.push(part);
          failure = err;
        }
      }
    } finally {
      setSavingBulk(false);
    }
    if (failed.length === 0) {
      flashMessage(`Saved ${saved} ${plural(saved, 'rate', 'rates')}.`);
      return;
    }
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setNotice(null);
    const ranges = failed
      .map((part) => {
        const first = part[0]?.stayDate ?? '';
        const last = part[part.length - 1]?.stayDate ?? '';
        if (!first) return '';
        return first === last ? first : `${first}\u2013${last}`;
      })
      .filter(Boolean)
      .join(', ');
    const copy = classifiedUserMessage(asClassified(failure), {
      fallback: 'Could not save the rates',
    });
    setBulkFailure({
      chunks: failed,
      text: `Saved ${saved} ${plural(saved, 'rate', 'rates')}. Failed ${ranges}. ${copy}`,
    });
  }

  async function saveRestriction(input: {
    roomTypeId: string;
    stayDate: string;
    minLos: number | null;
    maxLos: number | null;
    cta: boolean;
    ctd: boolean;
    stopSell: boolean;
  }) {
    try {
      await api.putRestrictionDay(propertyId, input);
      await queryClient.invalidateQueries({ queryKey: ['restriction-days', propertyId] });
    } catch (err) {
      showProblem(
        classifiedUserMessage(asClassified(err), { fallback: 'Could not save the restriction' }),
      );
      throw err;
    }
  }

  return (
    <div className="ui-page-stack rates-screen">
      <PageHeader
        title="Rates"
        subtitle={
          activeTab === 'plans' && !plansFailClosed
            ? ratesLaterNote(
                <>
                  <span translate="no">Ledger currency {currency}</span>
                  <span className="sep">·</span>
                  Rate plans
                </>,
              )
            : activeTab === 'matrix' && !plansFailClosed && !typesFailClosed
              ? ratesLaterNote(
                  <>
                    <span translate="no">Ledger currency {currency}</span>
                    <span className="sep">·</span>
                    {selectedPlan?.name ?? plan}
                  </>,
                )
              : activeTab === 'restrictions' && !typesFailClosed
                ? ratesLaterNote(
                    <>
                      <span translate="no">Ledger currency {currency}</span>
                      <span className="sep">·</span>
                      Restrictions
                    </>,
                  )
                : undefined
        }
      />
      <nav className="ui-tabs" aria-label="Rates">
        <Link
          className="ui-tab"
          to="/rates/plans"
          aria-current={activeTab === 'plans' ? 'page' : undefined}
        >
          Plans
        </Link>
        <Link
          className="ui-tab"
          to="/rates/matrix"
          aria-current={activeTab === 'matrix' ? 'page' : undefined}
        >
          Matrix
        </Link>
        <Link
          className="ui-tab"
          to="/rates/restrictions"
          aria-current={activeTab === 'restrictions' ? 'page' : undefined}
        >
          Restrictions
        </Link>
      </nav>
      <Card data-testid="rates-screen">
        {unsavedGuard}
        {notice || bulkFailure || plansFailClosed || typesFailClosed ? (
          <div className="rates-screen__notices">
            {notice ? <Alert intent={notice.intent}>{notice.text}</Alert> : null}
            {bulkFailure ? (
              <Alert>
                {bulkFailure.text}{' '}
                <Button
                  type="button"
                  disabled={savingBulk}
                  onClick={() => {
                    void postBulk(bulkFailure.chunks);
                  }}
                >
                  Retry
                </Button>
              </Alert>
            ) : null}
            {plansFailClosed || typesFailClosed ? (
              <Alert>Property unreachable — cannot load rates.</Alert>
            ) : null}
          </div>
        ) : null}

      {activeTab === 'plans' && !plansFailClosed ? (
        <>
          <CardContent flush>
            <div className="rates-plans__table">
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
            </div>
          </CardContent>
          <CardContent>
            <form
              className="stack rates-plans__form"
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
                  placeholder="BAR"
                  value={planCode}
                  onChange={(e) => setPlanCode(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Field
              label="Name"
              control={
                <Input
                  placeholder="Best Available Rate"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  autoComplete="off"
                />
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
                    placeholder="e.g. -15"
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
                  placeholder="0"
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
                    placeholder="1"
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
                    placeholder="1500"
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
                <Textarea
                  placeholder="Optional cancellation policy"
                  value={policyText}
                  onChange={(e) => setPolicyText(e.target.value)}
                  autoComplete="off"
                />
              }
            />
            <Button type="submit" intent="primary" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Saving…' : 'Create Rate Plan'}
            </Button>
            </form>
          </CardContent>

          <CardContent>
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
              className="stack rates-plans__form rates-plans__promo-form"
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
                  placeholder="SUMMER15"
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
                  placeholder="Summer 15%"
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
                    placeholder="1500"
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
                    placeholder="2500"
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
          </CardContent>
        </>
      ) : null}

      {activeTab === 'matrix' && !plansFailClosed && !typesFailClosed ? (
        typesQ.isPending || plansQ.isPending ? (
          <p className="muted">Loading…</p>
        ) : types.length === 0 ? (
          <p className="muted">Create a room type first.</p>
        ) : (
          <>
            <Toolbar>
              <Field
                size="xs"
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
                size="xs"
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
                size="sm"
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
            </Toolbar>
            <CardContent flush>
              <div className="rates-matrix__table">
                <DataTable>
                  <DataTableHead>
                    <DataTableRow>
                      <DataTableHeaderCell>Type</DataTableHeaderCell>
                      {dates.map((d) => (
                        <DataTableHeaderCell key={d} align="right">
                          {formatMatrixDate(d)}
                        </DataTableHeaderCell>
                      ))}
                    </DataTableRow>
                  </DataTableHead>
                  <DataTableBody>
                    {types.map((t) => (
                      <DataTableRow key={t.roomTypeId}>
                        <DataTableCell>
                          <strong>{t.name}</strong>
                          <br />
                          <span translate="no" className="muted ui-code">
                            {t.code}
                          </span>
                        </DataTableCell>
                        {dates.map((d) => {
                          const row = dayMap.get(`${t.roomTypeId}:${d}`);
                          const cellKey = `${t.roomTypeId}:${d}`;
                          const amountMinor = row?.amountMinor ?? null;
                          return (
                            <DataTableCell key={d} align="right">
                              <div className="rates-matrix__cell">
                                {isDerivedMatrix ? (
                                  <RateAmount amountMinor={amountMinor} />
                                ) : editingKey === cellKey ? (
                                  <RateCellEditor
                                    code={t.code}
                                    roomTypeId={t.roomTypeId}
                                    stayDate={d}
                                    amountMinor={amountMinor}
                                    currency={currency}
                                    ratePlanId={plan}
                                    propertyId={propertyId}
                                    onClose={() => {
                                      setEditingKey((current) =>
                                        current === cellKey ? null : current,
                                      );
                                    }}
                                    onError={(err) => {
                                      showProblem(
                                        classifiedUserMessage(asClassified(err), {
                                          fallback: 'Could not save the rate',
                                        }),
                                      );
                                    }}
                                    onSaved={() =>
                                      queryClient.invalidateQueries({
                                        queryKey: ['rate-days', propertyId],
                                      })
                                    }
                                  />
                                ) : (
                                  <Button
                                    type="button"
                                    intent="ghost"
                                    size="sm"
                                    aria-label={`Edit rate for ${t.code} on ${d}`}
                                    onClick={() => setEditingKey(cellKey)}
                                  >
                                    <RateAmount amountMinor={amountMinor} />
                                  </Button>
                                )}
                                <RestrictionBadges row={restMap.get(cellKey)} />
                              </div>
                            </DataTableCell>
                          );
                        })}
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
            {isDerivedMatrix ? (
              <CardFooter>
                <span className="muted">Edit the parent plan’s rates.</span>
              </CardFooter>
            ) : null}

            {!isDerivedMatrix ? (
              <CardContent>
                <form
                  className="stack rates-matrix__bulk"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (savingBulk || !amountOk || !rangeReady || previewCount === 0) return;
                    const cells = buildBulkRateCells({
                      roomTypeIds: selectedIds,
                      from: bulkFrom,
                      to: bulkTo,
                      weekdays,
                      ratePlanId: plan,
                      amountMinor: parseMajorToMinor(bulkAmount.trim()),
                      currency,
                    });
                    void postBulk(chunk(cells, RATES_BULK_UPDATE_MAX));
                  }}
                >
                  <div className="rates-matrix__bulk-options">
                    <h2>Bulk fill</h2>
                    <div className="rates-matrix__bulk-range">
                      <Field
                        size="xs"
                        label="Fill from"
                        control={
                          <Input
                            type="date"
                            value={bulkFrom}
                            autoComplete="off"
                            onChange={(e) => {
                              bulkSeeded.current = true;
                              setBulkFrom(e.target.value);
                            }}
                          />
                        }
                      />
                      <Field
                        size="xs"
                        label="Fill to"
                        error={bulkToError}
                        control={
                          <Input
                            type="date"
                            value={bulkTo}
                            autoComplete="off"
                            onChange={(e) => {
                              bulkSeeded.current = true;
                              setBulkTo(e.target.value);
                            }}
                          />
                        }
                      />
                    </div>
                    <p className="muted">
                      {previewText}
                    </p>
                    <div className="rates-matrix__bulk-checkboxes">
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
                    </div>
                  </div>
                  <div className="rates-matrix__bulk-actions">
                    <Field
                      label="Bulk amount"
                      control={
                        <Input
                          placeholder="e.g. 289.00"
                          value={bulkAmount}
                          onChange={(e) => setBulkAmount(e.target.value)}
                          autoComplete="off"
                        />
                      }
                    />
                    <Button
                      type="submit"
                      intent="primary"
                      disabled={savingBulk || !amountOk || !rangeReady || previewCount === 0}
                    >
                      {savingBulk ? 'Saving…' : 'Fill Selected Days'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            ) : null}
          </>
        )
      ) : null}

      {activeTab === 'restrictions' && !typesFailClosed ? (
        typesQ.isPending || (Boolean(from && to) && restQ.isPending) ? (
          <p className="muted">Loading…</p>
        ) : types.length === 0 ? (
          <p className="muted">Create a room type first.</p>
        ) : restQ.isError ? (
          <Alert>
            {classifiedUserMessage(asClassified(restQ.error), {
              fallback: 'Could not load restrictions',
            })}
          </Alert>
        ) : (
          <>
            <CardContent>
              <p className="muted">Stop sell hides the type from sale without changing inventory.</p>
              <p className="muted">
                Closed to arrival / departure apply to the stay’s boundary nights.
              </p>
            </CardContent>
            <Toolbar>
              <Field
                size="xs"
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
                size="xs"
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
            </Toolbar>
            <CardContent flush>
              <div className="rates-matrix__table rates-restrictions__table">
                <DataTable>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Type</DataTableHeaderCell>
                  {dates.map((d) => (
                    <DataTableHeaderCell key={d} align="right">
                      {formatMatrixDate(d)}
                    </DataTableHeaderCell>
                  ))}
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {types.map((t) => (
                  <DataTableRow key={t.roomTypeId}>
                    <DataTableCell>
                      <strong>{t.name}</strong>
                      <br />
                      <span translate="no" className="muted ui-code">
                        {t.code}
                      </span>
                    </DataTableCell>
                    {dates.map((d) => {
                      const row = restMap.get(`${t.roomTypeId}:${d}`);
                      return (
                        <DataTableCell key={`${t.roomTypeId}:${d}`}>
                          <RestrictionCell
                            code={t.code}
                            roomTypeId={t.roomTypeId}
                            stayDate={d}
                            row={row}
                            onSave={saveRestriction}
                          />
                        </DataTableCell>
                      );
                    })}
                  </DataTableRow>
                ))}
              </DataTableBody>
                </DataTable>
              </div>
            </CardContent>
          </>
        )
      ) : null}

      {archivePlan ? (
        <ConfirmDialog
          title="Archive rate plan?"
          description={`Archive ${archivePlan.code}? It will stop being sellable.`}
          confirmLabel="Archive"
          intent="destructive"
          onCancel={() => setArchivePlan(null)}
          onConfirm={() => {
            doArchivePlan.mutate(archivePlan.ratePlanId);
            setArchivePlan(null);
          }}
        />
      ) : null}
      </Card>
    </div>
  );
}
