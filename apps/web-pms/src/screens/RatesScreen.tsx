import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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

function RateCell(props: {
  code: string;
  roomTypeId: string;
  stayDate: string;
  amountMinor: number | null;
  currency: string;
  ratePlanId: string;
  propertyId: string;
}) {
  const [raw, setRaw] = useState(props.amountMinor == null ? '' : formatMinor(props.amountMinor));
  return (
    <label>
      Rate for {props.code} on {props.stayDate}{' '}
      <input
        value={raw}
        autoComplete="off"
        inputMode="decimal"
        className="tabular-nums"
        onChange={(e) => setRaw(e.target.value)}
        onBlur={async () => {
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
    </label>
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

  const createPlan = useMutation({
    mutationFn: () =>
      api.createRatePlan(propertyId, {
        ratePlanId: crypto.randomUUID(),
        code: planCode,
        name: planName,
        cancelPenaltyType: cancelType,
        cancelGraceHours: Number(graceHours),
        cancelPenaltyNights: cancelType === 'nights' ? Number(penaltyNights) : null,
        cancelPenaltyBps: cancelType === 'percent' ? Number(penaltyBps) : null,
        cancelPolicyText: policyText || null,
      }),
    onSuccess: async () => {
      setPlanCode('');
      setPlanName('');
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
    <div className="main" data-testid="rates-screen">
      {unsavedGuard}
      <h1>Rates</h1>
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
        <div className="error" role="alert">
          Property unreachable — cannot load rates.
        </div>
      ) : null}

      {activeTab === 'plans' && !plansFailClosed ? (
        <>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Cancel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.ratePlanId}>
                  <td translate="no">{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.cancelPenaltyType}</td>
                  <td>
                    {p.ratePlanId === 'BAR' ? null : (
                      <button type="button" onClick={() => setArchivePlan(p)}>
                        Archive {p.code}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              createPlan.mutate();
            }}
          >
            <h2>Create Rate Plan</h2>
            <label>
              Code{' '}
              <input
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                translate="no"
              />
            </label>
            <label>
              Name <input value={planName} onChange={(e) => setPlanName(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Cancel penalty{' '}
              <select value={cancelType} onChange={(e) => setCancelType(e.target.value)}>
                <option value="none">none</option>
                <option value="first_night">first_night</option>
                <option value="nights">nights</option>
                <option value="percent">percent</option>
                <option value="full">full</option>
              </select>
            </label>
            <label>
              Grace hours{' '}
              <input
                type="number"
                min={0}
                value={graceHours}
                onChange={(e) => setGraceHours(e.target.value)}
                autoComplete="off"
              />
            </label>
            {cancelType === 'nights' ? (
              <label>
                Penalty nights{' '}
                <input
                  type="number"
                  min={1}
                  value={penaltyNights}
                  onChange={(e) => setPenaltyNights(e.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : null}
            {cancelType === 'percent' ? (
              <label>
                Penalty bps{' '}
                <input
                  type="number"
                  min={1}
                  value={penaltyBps}
                  onChange={(e) => setPenaltyBps(e.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : null}
            <label>
              Policy{' '}
              <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} autoComplete="off" />
            </label>
            <button type="submit" disabled={createPlan.isPending}>
              {createPlan.isPending ? 'Saving…' : 'Create Rate Plan'}
            </button>
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
            <label>
              From{' '}
              <input
                type="date"
                value={from}
                autoComplete="off"
                onChange={(e) => setWindow(e.target.value, to)}
              />
            </label>
            <label>
              To{' '}
              <input
                type="date"
                value={to}
                autoComplete="off"
                onChange={(e) => setWindow(from, e.target.value)}
              />
            </label>
            <label>
              Rate plan{' '}
              <select value={plan} onChange={(e) => setWindow(from, to, e.target.value)}>
                {plans.map((p) => (
                  <option key={p.ratePlanId} value={p.ratePlanId}>
                    {p.code}
                  </option>
                ))}
              </select>
            </label>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  {dates.map((d) => (
                    <th key={d} className="tabular-nums">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.roomTypeId}>
                    <td>
                      <span translate="no">{t.code}</span> {t.name}
                    </td>
                    {dates.map((d) => {
                      const row = dayMap.get(`${t.roomTypeId}:${d}`);
                      return (
                        <td key={d}>
                          <RateCell
                            code={t.code}
                            roomTypeId={t.roomTypeId}
                            stayDate={d}
                            amountMinor={row?.amountMinor ?? null}
                            currency={currency}
                            ratePlanId={plan}
                            propertyId={propertyId}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

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
                <label key={t.roomTypeId}>
                  <input
                    type="checkbox"
                    checked={typeIds.has(t.roomTypeId)}
                    onChange={(e) => {
                      const next = new Set(typeIds);
                      if (e.target.checked) next.add(t.roomTypeId);
                      else next.delete(t.roomTypeId);
                      setSelectedTypes(next);
                    }}
                  />{' '}
                  {t.code}
                </label>
              ))}
              {WEEKDAYS.map((w) => (
                <label key={w.n}>
                  <input
                    type="checkbox"
                    checked={weekdays.has(w.n)}
                    onChange={(e) => {
                      const next = new Set(weekdays);
                      if (e.target.checked) next.add(w.n);
                      else next.delete(w.n);
                      setWeekdays(next);
                    }}
                  />{' '}
                  {w.label}
                </label>
              ))}
              <label>
                Bulk amount{' '}
                <input
                  value={bulkAmount}
                  onChange={(e) => setBulkAmount(e.target.value)}
                  autoComplete="off"
                  inputMode="decimal"
                  className="tabular-nums"
                />
              </label>
              <button type="submit" disabled={savingBulk}>
                {savingBulk ? 'Saving…' : 'Fill Selected Days'}
              </button>
            </form>
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
            <label>
              From{' '}
              <input
                type="date"
                value={from}
                autoComplete="off"
                onChange={(e) => setWindow(e.target.value, to)}
              />
            </label>
            <label>
              To{' '}
              <input
                type="date"
                value={to}
                autoComplete="off"
                onChange={(e) => setWindow(from, e.target.value)}
              />
            </label>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  {dates.map((d) => (
                    <th key={d}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.roomTypeId}>
                    <td>
                      <span translate="no">{t.code}</span> {t.name}
                    </td>
                    {dates.map((d) => {
                      const row = restMap.get(`${t.roomTypeId}:${d}`);
                      return (
                        <td key={d}>
                          <label>
                            Min LOS for {t.code} on {d}{' '}
                            <input
                              type="number"
                              min={1}
                              autoComplete="off"
                              defaultValue={row?.minLos ?? ''}
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
                          </label>
                          <label>
                            Max LOS for {t.code} on {d}{' '}
                            <input
                              type="number"
                              min={1}
                              autoComplete="off"
                              defaultValue={row?.maxLos ?? ''}
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
                          </label>
                          <label>
                            CTA for {t.code} on {d}{' '}
                            <input
                              type="checkbox"
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
                          </label>
                          <label>
                            CTD for {t.code} on {d}{' '}
                            <input
                              type="checkbox"
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
                          </label>
                          <label>
                            Stop sell for {t.code} on {d}{' '}
                            <input
                              type="checkbox"
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
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      ) : null}

      {archivePlan ? (
        <div role="dialog" aria-modal="true" className="panel">
          <p>Archive {archivePlan.code}? It will stop being sellable.</p>
          <button type="button" onClick={() => setArchivePlan(null)}>
            Cancel
          </button>
          <button type="button" onClick={() => doArchivePlan.mutate(archivePlan.ratePlanId)}>
            Archive
          </button>
        </div>
      ) : null}
    </div>
  );
}
