import {
  addCalendarDays,
  availabilityRangeForStay,
  bookingReservationOpId,
  ClassifiedError,
  permissionForForbidden,
  selectableRoomTypeIds,
  stayNightsExceedAvailabilityCap,
  type NamedListEntry,
} from '@hospai/client-core';
import { applyPromoToAmountMinor, type PromoApplyInput } from '@hospai/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  SectionLabel,
  Skeleton,
  Textarea,
  Total,
} from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { minorToMajorInput, parseMajorToMinor } from '../money.js';
import { validAmount } from './board-dialogs.js';
import { usePostableProducts } from './product-picker.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

type GuestSearchHit = {
  guestId: string;
  profile: { displayName: string };
};

function activeNamedList(
  items: Array<{ key: string; value: NamedListEntry[] }> | undefined,
  key: string,
): NamedListEntry[] {
  return (items?.find((item) => item.key === key)?.value ?? []).filter(
    (entry) => entry.status === 'active',
  );
}

function asGuestSearchPage(result: unknown): GuestSearchHit[] {
  if (!result || typeof result !== 'object') return [];
  const rec = result as {
    body?: { items?: unknown };
    items?: unknown;
  };
  const raw = Array.isArray(rec.items) ? rec.items : rec.body?.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is GuestSearchHit => {
    if (!row || typeof row !== 'object') return false;
    const r = row as { guestId?: unknown; profile?: { displayName?: unknown } };
    return typeof r.guestId === 'string' && typeof r.profile?.displayName === 'string';
  });
}

function bodyField(body: unknown, key: string): string | undefined {
  if (body && typeof body === 'object' && key in body) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

const PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

function validAddonQuantity(raw: string): boolean {
  if (!/^\d+$/.test(raw.trim())) return false;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 1 && n <= 99;
}

type BookAddonLine = {
  lineKey: string;
  index: number;
  productId: string;
  quantity: number;
  unitMinor: number;
  productName: string;
  chargeCode: string;
};

type FailedBookAddon = BookAddonLine & { errorMessage: string };

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

function promoApplyInput(promo: RatePromoRow): PromoApplyInput {
  if (promo.kind === 'percent') {
    return { kind: 'percent', bps: promo.bps ?? 0 };
  }
  return { kind: 'fixed_per_night', amountMinor: promo.amountMinor ?? 0 };
}

export function BookingScreen() {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const { money } = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const urlGuestRef = searchParams.get('guestRef');
  const [urlStay] = useState(() => {
    const arrival = searchParams.get('arrival') ?? '';
    const departure = searchParams.get('departure') ?? '';
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(arrival) || !iso.test(departure) || departure <= arrival) return null;
    return { arrival, departure, roomTypeId: searchParams.get('roomTypeId') };
  });

  const [reservationId] = useState(() => crypto.randomUUID());
  const [guestId] = useState(() => crypto.randomUUID());

  const [arrivalDate, setArrivalDate] = useState(urlStay?.arrival ?? '');
  const [departureDate, setDepartureDate] = useState(urlStay?.departure ?? '');
  const [roomTypeId, setRoomTypeId] = useState<string | null>(urlStay?.roomTypeId ?? null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [ratePlanId, setRatePlanId] = useState('');
  const [sourceCode, setSourceCode] = useState('');
  const [marketSegmentCode, setMarketSegmentCode] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [guestCreated, setGuestCreated] = useState(false);
  const [contextGuestRef, setContextGuestRef] = useState<string | null>(urlGuestRef);
  const [contextDisplayName, setContextDisplayName] = useState<string | null>(null);
  const [findQ, setFindQ] = useState('');
  const [debouncedFind, setDebouncedFind] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [frontOfficeComment, setFrontOfficeComment] = useState('');
  const [addonLines, setAddonLines] = useState<BookAddonLine[]>([]);
  const [addonDraftProductId, setAddonDraftProductId] = useState('');
  const [addonDraftQty, setAddonDraftQty] = useState('1');
  const [addonDraftPrice, setAddonDraftPrice] = useState('');
  const [failedAddons, setFailedAddons] = useState<FailedBookAddon[]>([]);

  const postableProducts = usePostableProducts();

  useEffect(() => {
    if (!timeZone) return;
    if (arrivalDate) return;
    const today = propertyLocalToday(timeZone);
    setArrivalDate(today);
    setDepartureDate(addCalendarDays(today, 1));
  }, [timeZone, arrivalDate]);

  const contextMode = contextGuestRef != null && contextGuestRef.length > 0;
  const guestRef = contextMode ? contextGuestRef! : guestId;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedFind(findQ.trim()), 300);
    return () => window.clearTimeout(t);
  }, [findQ]);

  const dateCapBlocked =
    arrivalDate.length > 0 &&
    departureDate.length > 0 &&
    stayNightsExceedAvailabilityCap(arrivalDate, departureDate);

  const range = useMemo(() => {
    if (!arrivalDate || !departureDate || arrivalDate >= departureDate || dateCapBlocked) {
      return null;
    }
    try {
      return availabilityRangeForStay(arrivalDate, departureDate);
    } catch {
      return null;
    }
  }, [arrivalDate, departureDate, dateCapBlocked]);

  const availQ = useQuery({
    queryKey: ['availability', propertyId, range?.fromDate, range?.toDate],
    queryFn: () => api.getAvailability(propertyId, range!),
    enabled: range != null && timeZone != null,
    retry: (n, err) => n < 2 && asClassified(err).class === 'read_stale',
    retryDelay: (_n, err) => asClassified(err).retryAfterMs ?? 0,
  });

  const lastNight =
    arrivalDate && departureDate ? addCalendarDays(departureDate, -1) : null;
  const ratesQ = useQuery({
    queryKey: ['rate-days', propertyId, arrivalDate, lastNight, roomTypeId, ratePlanId],
    queryFn: () =>
      api.listRateDays(propertyId, {
        fromDate: arrivalDate,
        toDate: lastNight!,
        roomTypeId: roomTypeId!,
        ratePlanId,
      }),
    enabled:
      Boolean(roomTypeId && arrivalDate && lastNight && lastNight >= arrivalDate && ratePlanId),
    retry: false,
  });

  const promosQ = useQuery({
    queryKey: ['rate-promos', propertyId],
    queryFn: () => api.listRatePromos(propertyId),
    retry: false,
  });
  const promos = (promosQ.data?.promos ?? []) as RatePromoRow[];

  const normalizedPromoCode = promoCodeInput.trim().toUpperCase();
  const promoResolution = useMemo(() => {
    if (normalizedPromoCode === '') {
      return {
        matchedPromo: null as RatePromoRow | null,
        promoError: null as string | null,
        promoBlocked: false,
      };
    }
    if (!PROMO_CODE_CHARSET.test(normalizedPromoCode)) {
      return {
        matchedPromo: null,
        promoError: 'Promo code not found.',
        promoBlocked: true,
      };
    }
    const promo = promos.find((p) => p.code === normalizedPromoCode);
    if (!promo) {
      return {
        matchedPromo: null,
        promoError: 'Promo code not found.',
        promoBlocked: true,
      };
    }
    if (promo.ratePlanId != null && promo.ratePlanId !== ratePlanId) {
      return {
        matchedPromo: null,
        promoError: 'Promo does not apply to this stay.',
        promoBlocked: true,
      };
    }
    if (arrivalDate && lastNight && lastNight >= arrivalDate) {
      let cur = arrivalDate;
      while (cur <= lastNight) {
        if (promo.validFrom != null && cur < promo.validFrom) {
          return {
            matchedPromo: null,
            promoError: 'Promo does not apply to this stay.',
            promoBlocked: true,
          };
        }
        if (promo.validTo != null && cur > promo.validTo) {
          return {
            matchedPromo: null,
            promoError: 'Promo does not apply to this stay.',
            promoBlocked: true,
          };
        }
        cur = addCalendarDays(cur, 1);
      }
    }
    return { matchedPromo: promo, promoError: null, promoBlocked: false };
  }, [normalizedPromoCode, promos, ratePlanId, arrivalDate, lastNight]);
  const { matchedPromo, promoError, promoBlocked } = promoResolution;

  const stayQuoteMinor = useMemo(() => {
    if (!arrivalDate || !lastNight || lastNight < arrivalDate) return null;
    const nights: string[] = [];
    let cur = arrivalDate;
    while (cur <= lastNight) {
      nights.push(cur);
      cur = addCalendarDays(cur, 1);
    }
    const days = (ratesQ.data?.days ?? []) as Array<{ stayDate?: unknown; amountMinor?: unknown }>;
    const byDate = new Map<string, number>();
    for (const d of days) {
      if (typeof d.stayDate === 'string' && typeof d.amountMinor === 'number') {
        byDate.set(d.stayDate, d.amountMinor);
      }
    }
    if (nights.length === 0 || nights.some((n) => !byDate.has(n))) return null;
    const applyInput = matchedPromo ? promoApplyInput(matchedPromo) : null;
    return nights.reduce((sum, n) => {
      const base = byDate.get(n) ?? 0;
      return sum + (applyInput ? applyPromoToAmountMinor(base, applyInput) : base);
    }, 0);
  }, [arrivalDate, lastNight, ratesQ.data, matchedPromo]);

  const typesQ = useQuery({
    queryKey: ['room-types', propertyId, 'active'],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    retry: false,
  });

  const plansQ = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.listRatePlans(propertyId),
    retry: false,
  });

  const operationalQ = useQuery({
    queryKey: ['operational-config', propertyId],
    queryFn: () => api.listOperationalConfig(propertyId),
    retry: false,
  });
  const activeSources = activeNamedList(operationalQ.data?.items, 'pms.property.sources');
  const activeSegments = activeNamedList(operationalQ.data?.items, 'pms.property.market_segments');

  type PlanRow = { ratePlanId: string; code: string; name: string };
  const plans = (plansQ.data?.plans ?? []) as PlanRow[];
  const plansEmpty = plansQ.isSuccess && plans.length === 0;

  useEffect(() => {
    if (!plansQ.isSuccess || ratePlanId) return;
    const bar = plans.find((p) => p.ratePlanId === 'BAR');
    setRatePlanId(bar?.ratePlanId ?? plans[0]?.ratePlanId ?? '');
  }, [plansQ.isSuccess, plansQ.data, ratePlanId, plans]);

  const typeDir = useMemo(() => {
    const m = new Map<string, { code: string; name: string; kind?: 'physical' | 'virtual' }>();
    for (const t of (typesQ.data?.roomTypes ?? []) as Array<{
      roomTypeId: string;
      code: string;
      name: string;
      kind?: 'physical' | 'virtual';
    }>) {
      m.set(t.roomTypeId, { code: t.code, name: t.name, kind: t.kind });
    }
    return m;
  }, [typesQ.data]);

  const quoteAriVersion = availQ.isSuccess ? availQ.data.ariVersion : null;
  const selectable =
    availQ.isSuccess && range
      ? selectableRoomTypeIds(availQ.data.items, range.fromDate, range.toDate)
      : [];

  const contextBatchQ = useQuery({
    queryKey: ['guests-batch', propertyId, contextGuestRef],
    queryFn: () => api.postGuestsBatch(propertyId, [contextGuestRef!]),
    enabled: contextMode,
    retry: false,
  });

  const findQry = useQuery({
    queryKey: ['guests-search', propertyId, debouncedFind],
    queryFn: () => api.searchGuests(propertyId, { q: debouncedFind }),
    enabled: !contextMode && debouncedFind.length > 0,
    retry: false,
  });

  const findHits = asGuestSearchPage(findQry.data);

  useEffect(() => {
    if (!contextMode || !contextBatchQ.isSuccess || contextDisplayName != null) return;
    const data = contextBatchQ.data;
    if (!data.ok) {
      setContextGuestRef(null);
      setMessage('Could not load guest — create a new guest.');
      return;
    }
    const state = data.states[contextGuestRef!];
    if (state?.kind === 'resolved') {
      setContextDisplayName(state.displayName);
      return;
    }
    if (state?.kind === 'erased' || state?.kind === 'not_found') {
      setContextGuestRef(null);
      setMessage('Guest not found or erased — create a new guest.');
    }
  }, [contextMode, contextBatchQ.isSuccess, contextBatchQ.data, contextGuestRef, contextDisplayName]);

  const bookFailClosed =
    (typesQ.isError && asClassified(typesQ.error).class === 'fail_closed') ||
    (availQ.isError && asClassified(availQ.error).class === 'fail_closed') ||
    (plansQ.isError && asClassified(plansQ.error).class === 'fail_closed') ||
    (ratesQ.isError && asClassified(ratesQ.error).class === 'fail_closed');

  const guestResolved = contextMode
    ? contextDisplayName != null
    : displayName.trim().length > 0;

  const partyOk = adults >= 1 && children >= 0;
  const quoteComplete = stayQuoteMinor != null;
  const confirmEnabled =
    !bookFailClosed &&
    !plansEmpty &&
    quoteComplete &&
    !promoBlocked &&
    quoteAriVersion != null &&
    roomTypeId != null &&
    guestResolved &&
    !dateCapBlocked &&
    partyOk;
  const quoteEnabled =
    !bookFailClosed &&
    !plansEmpty &&
    quoteComplete &&
    !promoBlocked &&
    roomTypeId != null &&
    guestResolved &&
    !dateCapBlocked &&
    partyOk;

  const availErrorClassified = availQ.isError ? asClassified(availQ.error) : null;
  const availDateRangeExceeded =
    availErrorClassified != null &&
    bodyErrorCode(availErrorClassified.body) === 'date_range_exceeds_max';

  async function postBookAddons(lines: BookAddonLine[]): Promise<FailedBookAddon[]> {
    const failures: FailedBookAddon[] = [];
    for (const line of lines) {
      const opId = `book-addon:${reservationId}:${line.index}:${line.productId}:${line.quantity}:${line.unitMinor}`;
      try {
        await api.addFolioLine(
          propertyId,
          reservationId,
          { chargeCode: line.chargeCode, amountMinor: line.unitMinor * line.quantity },
          opId,
        );
      } catch (err) {
        failures.push({
          ...line,
          errorMessage: classifiedUserMessage(asClassified(err), {
            fallback: 'Could not post add-on',
          }),
        });
      }
    }
    if (lines.length > 0) {
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    }
    return failures;
  }

  const retryAddonsMutation = useMutation({
    mutationFn: () => postBookAddons(failedAddons),
    onSuccess: (failures) => {
      if (failures.length === 0) {
        setFailedAddons([]);
        void navigate(`/arrivals?date=${encodeURIComponent(arrivalDate)}`, {
          state: { createdReservationId: reservationId },
        });
        return;
      }
      setFailedAddons(failures);
    },
  });

  const trimmedFrontOfficeComment = frontOfficeComment.trim();

  const bookMutation = useMutation({
    mutationFn: async (status: 'inquiry' | 'pending' | 'confirmed') => {
      if (roomTypeId == null) {
        throw new Error('confirm_precondition');
      }
      if (status !== 'inquiry' && quoteAriVersion == null) {
        throw new Error('confirm_precondition');
      }
      if (!contextMode && !guestCreated) {
        await api.createGuest(
          propertyId,
          {
            guestId,
            displayName: displayName.trim(),
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          },
          `guest:${guestId}`,
        );
        setGuestCreated(true);
      }
      const opId = bookingReservationOpId({
        reservationId,
        roomTypeId,
        arrivalDate,
        departureDate,
        guestRef,
        status,
        adults,
        children,
        ratePlanId,
        ...(matchedPromo ? { promoCode: normalizedPromoCode } : {}),
        ...(sourceCode ? { sourceCode } : {}),
        ...(marketSegmentCode ? { marketSegmentCode } : {}),
        ...(trimmedFrontOfficeComment ? { frontOfficeComment: trimmedFrontOfficeComment } : {}),
      });
      await api.createReservation(
        propertyId,
        {
          reservationId,
          roomTypeId,
          guestRef,
          arrivalDate,
          departureDate,
          quoteAriVersion: quoteAriVersion ?? 0,
          adults,
          children,
          ratePlanId,
          ...(status === 'confirmed' ? {} : { status }),
          ...(matchedPromo ? { promoCode: normalizedPromoCode } : {}),
          ...(sourceCode ? { sourceCode } : {}),
          ...(marketSegmentCode ? { marketSegmentCode } : {}),
          ...(trimmedFrontOfficeComment
            ? { frontOfficeComment: trimmedFrontOfficeComment }
            : {}),
        },
        opId,
      );
      if ((status === 'pending' || status === 'confirmed') && addonLines.length > 0) {
        const failures = await postBookAddons(addonLines);
        return { status, addonFailures: failures };
      }
      return { status, addonFailures: [] as FailedBookAddon[] };
    },
    onSuccess: (result) => {
      if (result.addonFailures.length > 0) {
        setFailedAddons(result.addonFailures);
        setMessage('Booking created — some add-ons could not be posted.');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', propertyId] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-free', propertyId] });
      void navigate(`/arrivals?date=${encodeURIComponent(arrivalDate)}`, {
        state: { createdReservationId: reservationId },
      });
    },
    onError: (err) => {
      const c = asClassified(err);
      const body = err instanceof ClassifiedError ? err.classified.body : c.body;
      const code = bodyErrorCode(body);

      if (code === 'occupancy_exceeded') {
        setMessage('Party exceeds this room type’s occupancy.');
        return;
      }
      if (code === 'no_availability') {
        const date = bodyField(body, 'date');
        setMessage(
          date
            ? `No availability on ${date} — pick another room type.`
            : 'No availability — pick another room type.',
        );
        setRoomTypeId(null);
        void queryClient.invalidateQueries({
          queryKey: ['availability', propertyId],
        });
        return;
      }
      if (code === 'idempotency_key_reused') {
        setMessage('This booking was already submitted — refresh and check arrivals.');
        return;
      }
      if (code === 'restriction_violated') {
        const rule = bodyField(body, 'rule');
        const date = bodyField(body, 'date');
        const required = bodyField(body, 'required');
        setMessage(
          `Stay restriction${rule ? ` (${rule})` : ''}${date ? ` on ${date}` : ''}${
            required ? ` — required ${required}` : ''
          }. Adjust dates.`,
        );
        return;
      }
      if (code === 'unbookable') {
        const date = bodyField(body, 'date');
        setMessage(
          date
            ? `Unbookable on ${date} — adjust dates (missing inventory horizon).`
            : 'Unbookable — adjust dates.',
        );
        return;
      }
      if (code === 'rate_plan_not_found') {
        setMessage('Rate plan unavailable — pick another plan.');
        return;
      }
      if (code === 'rate_missing') {
        const date = bodyField(body, 'date');
        setMessage(
          date
            ? `No rate on ${date} for this plan — pick another plan or set rates.`
            : 'No rate on this stay for this plan — pick another plan or set rates.',
        );
        return;
      }
      if (code === 'not_found') {
        setMessage('Room type unavailable');
        setRoomTypeId(null);
        void queryClient.invalidateQueries({
          queryKey: ['availability', propertyId],
        });
        return;
      }
      if (c.class === 'fail_closed') {
        setMessage('Property unreachable — booking unavailable.');
        return;
      }
      if (code === 'guest_not_found' || code === 'guest_already_erased') {
        setContextGuestRef(null);
        setContextDisplayName(null);
        setMessage('Guest not found or erased — create a new guest.');
        return;
      }
      if (c.class === 'forbidden') {
        void queryClient.invalidateQueries({ queryKey: ['me', propertyId] });
        const perm = permissionForForbidden(c.body);
        setMessage(
          perm
            ? `Requires permission ${perm}. Ask a manager.`
            : 'Forbidden — insufficient permission.',
        );
        return;
      }
      setMessage(classifiedUserMessage(c, { fallback: 'Booking failed', knownCode: code }));
    },
  });

  return (
    <div className="board-page">
      <PageHeader
        title="Book"
        back={<Link to="/arrivals">Arrivals</Link>}
        subtitle="New reservation"
      />

      <Card data-testid="booking-screen">
        <CardHeader>
          <CardTitle>Stay details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {!timeZone ? <p className="muted">Waiting for property timezone…</p> : null}
            <div className="ui-row">
              <Field
                size="xs"
                label="Arrival"
                control={
                  <Input
                    type="date"
                    data-testid="arrival-date"
                    value={arrivalDate}
                    onChange={(e) => {
                      setArrivalDate(e.target.value);
                      setRoomTypeId(null);
                    }}
                  />
                }
              />
              <Field
                size="xs"
                label="Departure"
                control={
                  <Input
                    type="date"
                    data-testid="departure-date"
                    value={departureDate}
                    onChange={(e) => {
                      setDepartureDate(e.target.value);
                      setRoomTypeId(null);
                    }}
                  />
                }
              />
              <div className="ui-row ui-row--nowrap">
                {plansQ.isSuccess && plans.length > 0 ? (
                  <Field
                    size="sm"
                    label="Rate plan"
                    control={
                      <NativeSelect
                        data-testid="rate-plan"
                        value={ratePlanId}
                        onChange={(e) => setRatePlanId(e.target.value)}
                      >
                        {plans.map((p) => (
                          <option key={p.ratePlanId} value={p.ratePlanId}>
                            {p.name} ({p.code})
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                ) : null}
                <Field
                  size="sm"
                  label="Promo code"
                  control={
                    <Input
                      data-testid="promo-code"
                      placeholder="Optional"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value.trim().toUpperCase())}
                      onBlur={(e) => setPromoCodeInput(e.target.value.trim().toUpperCase())}
                    />
                  }
                />
              </div>
            </div>
            {activeSources.length > 0 || activeSegments.length > 0 ? (
              <div className="ui-row">
                {activeSources.length > 0 ? (
                  <Field
                    size="sm"
                    label="Source"
                    control={
                      <NativeSelect
                        data-testid="booking-source"
                        value={sourceCode}
                        onChange={(e) => setSourceCode(e.target.value)}
                      >
                        <option value="">None</option>
                        {activeSources.map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.name} ({entry.code})
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                ) : null}
                {activeSegments.length > 0 ? (
                  <Field
                    size="sm"
                    label="Market segment"
                    control={
                      <NativeSelect
                        data-testid="booking-segment"
                        value={marketSegmentCode}
                        onChange={(e) => setMarketSegmentCode(e.target.value)}
                      >
                        <option value="">None</option>
                        {activeSegments.map((entry) => (
                          <option key={entry.code} value={entry.code}>
                            {entry.name} ({entry.code})
                          </option>
                        ))}
                      </NativeSelect>
                    }
                  />
                ) : null}
              </div>
            ) : null}
            <Field
              label="Special requests"
              control={
                <Textarea
                  data-testid="special-requests"
                  rows={3}
                  value={frontOfficeComment}
                  onChange={(e) => setFrontOfficeComment(e.target.value)}
                  placeholder="Optional notes for front office"
                />
              }
            />
            {plansQ.isLoading ? <Skeleton label="Loading rate plans" lines={3} /> : null}
            {plansEmpty ? (
              <EmptyState kind="empty" title="No active rate plans." />
            ) : null}
            {dateCapBlocked ? (
              <Alert>Stay exceeds the 90-night availability query limit — shorten dates.</Alert>
            ) : null}
            {promoError ? (
              <p className="muted" role="status">
                {promoError}
              </p>
            ) : null}

            <SectionLabel>Party</SectionLabel>
            <div className="ui-row">
              <Field
                size="xs"
                label="Adults"
                control={
                  <Input
                    type="number"
                    min={1}
                    data-testid="adults"
                    value={String(adults)}
                    onChange={(e) => setAdults(Number(e.target.value))}
                  />
                }
              />
              <Field
                size="xs"
                label="Children"
                control={
                  <Input
                    type="number"
                    min={0}
                    data-testid="children"
                    value={String(children)}
                    onChange={(e) => setChildren(Number(e.target.value))}
                  />
                }
              />
            </div>

            <SectionLabel>Guest</SectionLabel>
            {contextMode && contextDisplayName ? (
              <p data-testid="context-guest">Booking for {contextDisplayName}</p>
            ) : (
              <>
                <Field
                  label="Find existing"
                  control={
                    <Input
                      data-testid="guest-find"
                      type="search"
                      aria-label="Find guest"
                      autoComplete="off"
                      placeholder="Search by name or email"
                      value={findQ}
                      onChange={(e) => setFindQ(e.target.value)}
                    />
                  }
                />
                {findQry.isFetching && debouncedFind.length > 0 ? (
                  <p className="muted" role="status">
                    Searching…
                  </p>
                ) : null}
                {debouncedFind.length > 0 && findQry.isSuccess && findHits.length === 0 ? (
                  <EmptyState kind="nomatch" title="No guests match that search." />
                ) : null}
                {findHits.length > 0 ? (
                  <ul>
                    {findHits.map((hit) => (
                      <li key={hit.guestId}>
                        <Button
                          type="button"
                          onClick={() => {
                            setContextGuestRef(hit.guestId);
                            setContextDisplayName(hit.profile.displayName);
                          }}
                        >
                          {hit.profile.displayName}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Field
                  label="Name"
                  control={
                    <Input
                      data-testid="guest-name"
                      placeholder="Full name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  }
                />
                <Field
                  label="Email"
                  control={
                    <Input
                      data-testid="guest-email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  }
                />
                <Field
                  label="Phone"
                  control={
                    <Input
                      data-testid="guest-phone"
                      placeholder="Phone number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  }
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Room type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {bookFailClosed ? (
              <Alert data-testid="book-fail-closed">
                Booking unavailable — property unreachable.
              </Alert>
            ) : null}
            {availDateRangeExceeded ? (
              <Alert>Stay exceeds the 90-night availability query limit — shorten dates.</Alert>
            ) : null}
            {availErrorClassified && !availDateRangeExceeded ? (
              <EmptyState
                kind="error"
                title={`Availability unavailable — ${classifiedUserMessage(availErrorClassified, {})}. Confirm blocked until a fresh quote.`}
              />
            ) : null}
            {availQ.isSuccess && selectable.length === 0 ? (
              <p className="muted" role="status">
                No room types available for these dates — adjust dates.
              </p>
            ) : null}
            <div data-testid="room-type-list" className="ui-choice-row">
              {selectable.map((id) => (
                <label key={id} className="ui-choice">
                  <Input
                    type="radio"
                    name="roomType"
                    value={id}
                    checked={roomTypeId === id}
                    onChange={() => setRoomTypeId(id)}
                  />
                  {(() => {
                    const t = typeDir.get(id);
                    if (!t) return 'Room type unavailable';
                    const suffix = t.kind === 'virtual' ? ' · Run of house' : '';
                    return (
                      <>
                        {t.name} (<span translate="no">{t.code}</span>){suffix}
                      </>
                    );
                  })()}
                </label>
              ))}
            </div>
            {quoteAriVersion != null ? (
              <p className="ui-visually-hidden" data-testid="quote-version">
                {quoteAriVersion}
              </p>
            ) : null}
            {roomTypeId != null &&
            ratePlanId &&
            !ratesQ.isLoading &&
            stayQuoteMinor == null &&
            arrivalDate &&
            lastNight &&
            lastNight >= arrivalDate ? (
              <p className="muted" role="status">
                No published rate for every night of this stay on this plan.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {postableProducts.hasProducts ? (
        <Card>
          <CardHeader>
            <CardTitle>Add-ons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-stack" data-testid="booking-addons">
              <fieldset className="booking-addons__fieldset" disabled={bookMutation.isPending}>
                {addonLines.map((line) => (
                  <div key={line.lineKey} className="ui-row">
                    <p>
                      {line.productName} × {line.quantity} @ {money(line.unitMinor)} (
                      {money(line.unitMinor * line.quantity)})
                    </p>
                    <Button
                      type="button"
                      onClick={() =>
                        setAddonLines((rows) =>
                          rows
                            .filter((r) => r.lineKey !== line.lineKey)
                            .map((r, index) => ({ ...r, index })),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="ui-row">
                  <Field
                    size="sm"
                    label="Product"
                    control={
                      <NativeSelect
                        data-testid="addon-draft-product"
                        value={addonDraftProductId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setAddonDraftProductId(id);
                          const item = postableProducts.byId.get(id);
                          if (item) setAddonDraftPrice(minorToMajorInput(item.defaultAmountMinor));
                        }}
                      >
                        <option value="">Choose a product</option>
                        {postableProducts.groups.map((g) => (
                          <optgroup key={g.category.categoryId} label={g.category.name}>
                            {g.items.map((i) => (
                              <option key={i.productId} value={i.productId}>
                                {i.name} · {money(i.defaultAmountMinor)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </NativeSelect>
                    }
                  />
                  <Field
                    size="xs"
                    label="Qty"
                    control={
                      <Input
                        data-testid="addon-draft-qty"
                        value={addonDraftQty}
                        onChange={(e) => setAddonDraftQty(e.target.value)}
                      />
                    }
                  />
                  <Field
                    size="xs"
                    label="Unit price"
                    control={
                      <Input
                        data-testid="addon-draft-price"
                        value={addonDraftPrice}
                        onChange={(e) => setAddonDraftPrice(e.target.value)}
                      />
                    }
                  />
                  <Button
                    type="button"
                    data-testid="addon-commit-line"
                    disabled={
                      !postableProducts.byId.has(addonDraftProductId) ||
                      !validAddonQuantity(addonDraftQty) ||
                      !validAmount(addonDraftPrice)
                    }
                    onClick={() => {
                      const product = postableProducts.byId.get(addonDraftProductId);
                      if (
                        !product ||
                        !validAddonQuantity(addonDraftQty) ||
                        !validAmount(addonDraftPrice)
                      ) {
                        return;
                      }
                      const index = addonLines.length;
                      setAddonLines((rows) => [
                        ...rows,
                        {
                          lineKey: crypto.randomUUID(),
                          index,
                          productId: product.productId,
                          quantity: Number(addonDraftQty.trim()),
                          unitMinor: parseMajorToMinor(addonDraftPrice.trim()),
                          productName: product.name,
                          chargeCode: product.chargeCode,
                        },
                      ]);
                      setAddonDraftProductId('');
                      setAddonDraftQty('1');
                      setAddonDraftPrice('');
                    }}
                  >
                    Add line
                  </Button>
                </div>
              </fieldset>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <Total
            label="Quote total"
            value={
              stayQuoteMinor != null ? (
                <span data-testid="stay-quote">{money(stayQuoteMinor)}</span>
              ) : (
                '…'
              )
            }
          />
        </CardContent>
        <CardFooter>
          <div className="ui-row book-actions">
            <Button
              type="button"
              data-testid="hold-book"
              disabled={!confirmEnabled || bookMutation.isPending}
              onClick={() => bookMutation.mutate('pending')}
            >
              Hold
            </Button>
            <Button
              type="button"
              data-testid="quote-book"
              disabled={
                !quoteEnabled || bookMutation.isPending || addonLines.length > 0
              }
              onClick={() => bookMutation.mutate('inquiry')}
            >
              Quote
            </Button>
            <Button
              type="button"
              intent="primary"
              data-testid="confirm-book"
              disabled={!confirmEnabled || bookMutation.isPending}
              onClick={() => bookMutation.mutate('confirmed')}
            >
              Confirm booking
            </Button>
            {addonLines.length > 0 ? (
              <p className="muted">
                Quote saves no add-ons — remove them to save a quote.
              </p>
            ) : null}
          </div>
        </CardFooter>
      </Card>

      {failedAddons.length > 0 ? (
        <Alert data-testid="addon-failure-alert">
          <p>Booking created — these add-ons could not be posted:</p>
          <ul>
            {failedAddons.map((line) => (
              <li key={line.lineKey}>
                {line.productName}: {line.errorMessage}
              </li>
            ))}
          </ul>
          <div className="ui-row">
            <Button
              type="button"
              data-testid="retry-addons"
              disabled={retryAddonsMutation.isPending}
              onClick={() => retryAddonsMutation.mutate()}
            >
              Retry add-ons
            </Button>
            <Link to={`/folio/${reservationId}`}>Open folio</Link>
          </div>
        </Alert>
      ) : null}
      {message ? <Alert data-testid="book-message">{message}</Alert> : null}
    </div>
  );
}
