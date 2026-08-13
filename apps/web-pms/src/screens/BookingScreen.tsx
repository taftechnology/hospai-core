import {
  addCalendarDays,
  availabilityRangeForStay,
  bookingReservationOpId,
  ClassifiedError,
  permissionForForbidden,
  selectableRoomTypeIds,
  stayNightsExceedAvailabilityCap,
} from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';
import { propertyLocalToday } from '../status/property-local-today.js';

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

function bodyField(body: unknown, key: string): string | undefined {
  if (body && typeof body === 'object' && key in body) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

export function BookingScreen() {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const urlGuestRef = searchParams.get('guestRef');

  const [reservationId] = useState(() => crypto.randomUUID());
  const [guestId] = useState(() => crypto.randomUUID());

  const [arrivalDate, setArrivalDate] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [roomTypeId, setRoomTypeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [guestCreated, setGuestCreated] = useState(false);
  const [contextGuestRef, setContextGuestRef] = useState<string | null>(urlGuestRef);
  const [contextDisplayName, setContextDisplayName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!timeZone) return;
    if (arrivalDate) return;
    const today = propertyLocalToday(timeZone);
    setArrivalDate(today);
    setDepartureDate(addCalendarDays(today, 1));
  }, [timeZone, arrivalDate]);

  const contextMode = contextGuestRef != null && contextGuestRef.length > 0;
  const guestRef = contextMode ? contextGuestRef! : guestId;

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

  const typesQ = useQuery({
    queryKey: ['room-types', propertyId, 'active'],
    queryFn: () => api.listRoomTypes(propertyId, { status: 'active' }),
    retry: false,
  });

  const typeDir = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    for (const t of (typesQ.data?.roomTypes ?? []) as Array<{
      roomTypeId: string;
      code: string;
      name: string;
    }>) {
      m.set(t.roomTypeId, { code: t.code, name: t.name });
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

  const guestResolved = contextMode
    ? contextDisplayName != null
    : displayName.trim().length > 0;

  const partyOk = adults >= 1 && children >= 0;
  const confirmEnabled =
    quoteAriVersion != null &&
    roomTypeId != null &&
    guestResolved &&
    !dateCapBlocked &&
    partyOk;
  const quoteEnabled = roomTypeId != null && guestResolved && !dateCapBlocked && partyOk;

  const availErrorClassified = availQ.isError ? asClassified(availQ.error) : null;
  const availDateRangeExceeded =
    availErrorClassified != null &&
    bodyErrorCode(availErrorClassified.body) === 'date_range_exceeds_max';

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
      });
      return api.createReservation(
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
          ...(status === 'confirmed' ? {} : { status }),
        },
        opId,
      );
    },
    onSuccess: () => {
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
        setMessage('Booking conflict (idempotency). Do not retry blindly — refresh and try again.');
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
      if (code === 'not_found') {
        setMessage('Room type no longer available — choose another.');
        setRoomTypeId(null);
        void queryClient.invalidateQueries({
          queryKey: ['availability', propertyId],
        });
        return;
      }
      if (c.class === 'fail_closed') {
        setMessage('Property unreachable — booking refused (no walk-in notepad).');
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
      setMessage(`Booking failed (${code ?? c.class})`);
    },
  });

  return (
    <div className="panel" data-testid="booking-screen">
      <p>
        <Link to="/arrivals">← Arrivals</Link>
      </p>
      <h1>Book</h1>
      <p className="muted">Type-only stay — no rate quote in this screen.</p>

      <section className="stack">
        <h2>Dates</h2>
        {!timeZone ? <p className="muted">Waiting for property timezone…</p> : null}
        <label>
          Arrival{' '}
          <input
            type="date"
            data-testid="arrival-date"
            value={arrivalDate}
            onChange={(e) => {
              setArrivalDate(e.target.value);
              setRoomTypeId(null);
            }}
          />
        </label>
        <label>
          Departure{' '}
          <input
            type="date"
            data-testid="departure-date"
            value={departureDate}
            onChange={(e) => {
              setDepartureDate(e.target.value);
              setRoomTypeId(null);
            }}
          />
        </label>
        {dateCapBlocked ? (
          <p className="error" role="alert">
            Stay exceeds the 90-night availability query limit — shorten dates.
          </p>
        ) : null}
      </section>

      <section className="stack">
        <h2>Room type</h2>
        {availErrorClassified ? (
          <p className="error" role="alert">
            {availDateRangeExceeded
              ? 'Stay exceeds the 90-night availability query limit — shorten dates.'
              : `Availability unavailable (${availErrorClassified.class}). Confirm blocked until a fresh quote.`}
          </p>
        ) : null}
        {availQ.isSuccess && selectable.length === 0 ? (
          <p className="muted" role="status">
            No room types available for these dates — adjust dates.
          </p>
        ) : null}
        <ul data-testid="room-type-list">
          {selectable.map((id) => (
            <li key={id}>
              <label>
                <input
                  type="radio"
                  name="roomType"
                  value={id}
                  checked={roomTypeId === id}
                  onChange={() => setRoomTypeId(id)}
                />{' '}
                {(() => {
                  const t = typeDir.get(id);
                  if (!t) return id;
                  return (
                    <>
                      {t.name} (<span translate="no">{t.code}</span>)
                    </>
                  );
                })()}
              </label>
            </li>
          ))}
        </ul>
        {quoteAriVersion != null ? (
          <p className="muted" data-testid="quote-version">
            Quote ariVersion {quoteAriVersion}
          </p>
        ) : null}
      </section>

      <section className="stack">
        <h2>Party</h2>
        <label>
          Adults{' '}
          <input
            type="number"
            min={1}
            data-testid="adults"
            value={adults}
            onChange={(e) => setAdults(Number(e.target.value))}
          />
        </label>
        <label>
          Children{' '}
          <input
            type="number"
            min={0}
            data-testid="children"
            value={children}
            onChange={(e) => setChildren(Number(e.target.value))}
          />
        </label>
      </section>

      <section className="stack">
        <h2>Guest</h2>
        {contextMode && contextDisplayName ? (
          <p data-testid="context-guest">
            Booking for {contextDisplayName} ({contextGuestRef})
          </p>
        ) : (
          <>
            <label>
              Name{' '}
              <input
                data-testid="guest-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <label>
              Email{' '}
              <input
                data-testid="guest-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Phone{' '}
              <input
                data-testid="guest-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </>
        )}
      </section>

      <button
        type="button"
        data-testid="confirm-book"
        disabled={!confirmEnabled || bookMutation.isPending}
        onClick={() => bookMutation.mutate('confirmed')}
      >
        Confirm booking
      </button>
      <button
        type="button"
        data-testid="hold-book"
        disabled={!confirmEnabled || bookMutation.isPending}
        onClick={() => bookMutation.mutate('pending')}
      >
        Hold
      </button>
      <button
        type="button"
        data-testid="quote-book"
        disabled={!quoteEnabled || bookMutation.isPending}
        onClick={() => bookMutation.mutate('inquiry')}
      >
        Quote
      </button>
      {message ? (
        <p className="error" role="alert" data-testid="book-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
