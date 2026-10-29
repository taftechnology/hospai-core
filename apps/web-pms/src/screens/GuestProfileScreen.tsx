import { ClassifiedError } from '@hospai/client-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  EmptyState,
  Field,
  Input,
  PageHeader,
  StatField,
  isReservationStatus,
  StatusBadge,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

type GuestProfile = { displayName: string; email?: string; phone?: string };
type GuestRead =
  | { guestId: string; erased: false; profile: GuestProfile }
  | { guestId: string; erased: true; profile: null };

type StayItem = {
  reservationId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  roomId: string | null;
  adults: number;
  children: number;
  vipFlag: boolean;
  dndFlag: boolean;
  ratePlanId: string | null;
};

function asGuestRead(result: unknown): GuestRead | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as { body?: unknown; guestId?: unknown; erased?: unknown; profile?: unknown };
  const inner = rec.guestId !== undefined ? rec : rec.body;
  if (!inner || typeof inner !== 'object') return null;
  const g = inner as { guestId?: unknown; erased?: unknown; profile?: unknown };
  if (typeof g.guestId !== 'string') return null;
  if (g.erased === true) return { guestId: g.guestId, erased: true, profile: null };
  const profile = g.profile as GuestProfile | null | undefined;
  if (!profile || typeof profile.displayName !== 'string') return null;
  return { guestId: g.guestId, erased: false, profile };
}

function asStayPage(result: unknown): { items: StayItem[]; nextCursor: string | null } {
  if (!result || typeof result !== 'object') return { items: [], nextCursor: null };
  const rec = result as { body?: { items?: unknown; nextCursor?: unknown }; items?: unknown; nextCursor?: unknown };
  const page = Array.isArray(rec.items) ? rec : rec.body;
  const raw = Array.isArray(page?.items) ? page.items : [];
  const items = raw.filter((row): row is StayItem => {
    if (!row || typeof row !== 'object') return false;
    return typeof (row as { reservationId?: unknown }).reservationId === 'string';
  });
  const next = page && typeof page === 'object' ? (page as { nextCursor?: unknown }).nextCursor : null;
  return { items, nextCursor: typeof next === 'string' ? next : null };
}

const STAY_ACTIVE_STATUSES = new Set(['checked_in', 'confirmed', 'pending']);

function formatGuestDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).formatToParts(new Date(`${iso}T12:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}`;
}

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function GuestProfileScreen() {
  const propertyId = tenant.propertyId;
  const guestRef = decodeURIComponent(useParams().guestRef ?? '');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId) as Promise<PropertyMe>,
  });
  const me = meQ.data;
  const canWrite = Boolean(me && hasPropertyPermission(me, 'guests:write'));
  const canErase = Boolean(me && hasPropertyPermission(me, 'guests:erase'));
  const canBook = Boolean(me && hasPropertyPermission(me, 'reservations:write'));

  const guestQ = useQuery({
    queryKey: ['guest', propertyId, guestRef],
    queryFn: () => api.getGuest(propertyId, guestRef),
    enabled: Boolean(guestRef),
  });
  const staysQ = useQuery({
    queryKey: ['guest-stays', propertyId, guestRef],
    queryFn: () => api.listGuestStays(propertyId, guestRef),
    enabled: Boolean(guestRef),
  });
  const roomsQ = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
    retry: false,
  });
  const roomsById = new Map(
    (roomsQ.data?.rooms ?? []).map((r) => [r.roomId, r.code] as const),
  );

  const guest = asGuestRead(guestQ.data);
  const stays = asStayPage(staysQ.data);
  const contactFailClosed =
    guestQ.isError &&
    (asClassified(guestQ.error).class === 'fail_closed' || guestQ.error instanceof ClassifiedError);
  const staysFailClosed =
    staysQ.isError &&
    (asClassified(staysQ.error).class === 'fail_closed' || staysQ.error instanceof ClassifiedError);

  useEffect(() => {
    if (guest && !guest.erased) {
      setDisplayName(guest.profile.displayName);
      setEmail(guest.profile.email ?? '');
      setPhone(guest.profile.phone ?? '');
    }
  }, [guest]);

  const dirty =
    editing &&
    guest !== null &&
    !guest.erased &&
    (displayName !== guest.profile.displayName ||
      email !== (guest.profile.email ?? '') ||
      phone !== (guest.profile.phone ?? ''));
  const unsavedGuard = useUnsavedChanges(dirty);

  const saveM = useMutation({
    mutationFn: () =>
      api.updateGuest(
        propertyId,
        guestRef,
        {
          displayName,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
        `guest-update:${guestRef}`,
      ),
    onSuccess: async () => {
      setEditError(null);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['guest', propertyId, guestRef] });
    },
    onError: (err) => {
      setEditError(asClassified(err).class === 'fail_closed' ? 'Save failed — organization unreachable.' : 'Save failed.');
    },
  });

  const eraseM = useMutation({
    mutationFn: () => api.eraseGuest(propertyId, guestRef, `guest-erase:${guestRef}`),
    onSuccess: async () => {
      setConfirmErase(false);
      await queryClient.invalidateQueries({ queryKey: ['guest', propertyId, guestRef] });
    },
  });

  const heading =
    contactFailClosed || !guest
      ? guestRef
      : guest.erased
        ? guestRef
        : guest.profile.displayName;

  const highlightedStay =
    stays.items.find((s) => STAY_ACTIVE_STATUSES.has(s.status)) ?? stays.items[0] ?? null;

  return (
    <div className="guest-profile" data-testid="guest-profile">
      {unsavedGuard}
      <PageHeader
        back={<Link to="/guests">← Guests</Link>}
        title={heading}
        subtitle={
          highlightedStay
            ? (() => {
                const stay = highlightedStay;
                const roomCode = stay.roomId ? (roomsById.get(stay.roomId) ?? null) : null;
                return (
                  <>
                    {isReservationStatus(stay.status) ? (
                      <StatusBadge status={stay.status} vip={stay.vipFlag} />
                    ) : (
                      reservationStatusLabel(stay.status)
                    )}
                    {roomCode ? (
                      <>
                        <span className="sep">·</span> Room {roomCode}
                      </>
                    ) : null}
                    <span className="sep">·</span>
                    {formatGuestDate(stay.arrivalDate)} → {formatGuestDate(stay.departureDate)}
                    <span className="sep">·</span>{' '}
                    {nightsBetween(stay.arrivalDate, stay.departureDate)} nights
                  </>
                );
              })()
            : undefined
        }
        actions={
          canBook ? (
            <Link
              className="ui-link-btn"
              to={`/book?guestRef=${encodeURIComponent(guestRef)}`}
              data-testid="guest-book"
            >
              Book for guest
            </Link>
          ) : null
        }
      />
      {contactFailClosed ? (
        <Alert>Guest profile unavailable — organization unreachable.</Alert>
      ) : guestQ.isLoading ? (
        <p className="muted">Loading…</p>
      ) : guest ? (
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              PII: <strong>{guest.erased ? 'Erased' : 'Live'}</strong>
            </p>
            {guest.erased ? null : (
              <div className="ui-stat-grid">
                <StatField label="Name" value={guest.profile.displayName} />
                {guest.profile.email ? <StatField label="Email" value={guest.profile.email} /> : null}
                {guest.profile.phone ? <StatField label="Phone" value={guest.profile.phone} /> : null}
              </div>
            )}
            {canWrite && !guest.erased ? (
              editing ? (
                <form
                  className="ui-stack guest-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!displayName.trim()) {
                      setEditError('Name is required.');
                      return;
                    }
                    saveM.mutate();
                  }}
                >
                  {editError ? <Alert>{editError}</Alert> : null}
                  <Field
                    label="Name"
                    control={
                      <Input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        autoComplete="off"
                        required
                      />
                    }
                  />
                  <Field
                    label="Email"
                    control={
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  <Field
                    label="Phone"
                    control={
                      <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        autoComplete="off"
                      />
                    }
                  />
                  <div className="ui-row">
                    <Button type="submit" intent="primary" disabled={saveM.isPending}>
                      {saveM.isPending ? 'Saving…' : 'Save'}
                    </Button>
                    {canErase ? (
                      <Button
                        type="button"
                        data-testid="guest-erase"
                        onClick={() => setConfirmErase(true)}
                      >
                        Erase
                      </Button>
                    ) : null}
                    <Button type="button" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : null
            ) : null}
            <div className={`guest-actions${editing ? ' guest-actions--solo' : ''}`}>
              {canWrite && !guest.erased && !editing ? (
                <Button type="button" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              ) : null}
              {canErase && !guest.erased && !editing ? (
                <Button
                  type="button"
                  data-testid="guest-erase"
                  onClick={() => setConfirmErase(true)}
                >
                  Erase
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert>Guest not found.</Alert>
      )}

      {confirmErase ? (
        <ConfirmDialog
          title="Erase guest?"
          description="This permanently destroys the guest's contact details. Stay records remain. This cannot be undone."
          confirmLabel={eraseM.isPending ? 'Erasing…' : 'Erase guest'}
          intent="destructive"
          onCancel={() => setConfirmErase(false)}
          onConfirm={() => eraseM.mutate()}
        />
      ) : null}

      <section data-testid="guest-stays">
      <Card>
        <CardHeader>
          <CardTitle>Stays</CardTitle>
        </CardHeader>
        <CardContent>
          {staysFailClosed ? (
            <Alert>Stay history unavailable — property unreachable.</Alert>
          ) : staysQ.isLoading ? (
            <p className="muted">Loading…</p>
          ) : stays.items.length === 0 ? (
            <EmptyState title="No stays at this property." />
          ) : (
            <DataTable>
              <caption>Stays at this property.</caption>
              <DataTableHead>
                <DataTableRow>
                  <DataTableHeaderCell>Reservation</DataTableHeaderCell>
                  <DataTableHeaderCell>Dates</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell>Room</DataTableHeaderCell>
                  <DataTableHeaderCell>Party</DataTableHeaderCell>
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {stays.items.map((row) => (
                  <DataTableRow key={row.reservationId}>
                    <DataTableCell>
                      <Link className="ui-link-btn ui-link-btn--sm" to={`/folio/${encodeURIComponent(row.reservationId)}`}>View folio</Link>
                    </DataTableCell>
                    <DataTableCell>
                      {formatGuestDate(row.arrivalDate)} → {formatGuestDate(row.departureDate)}
                    </DataTableCell>
                    <DataTableCell>
                      {isReservationStatus(row.status) ? (
                        <StatusBadge status={row.status} vip={row.vipFlag} />
                      ) : (
                        reservationStatusLabel(row.status)
                      )}
                    </DataTableCell>
                    <DataTableCell>
                      {row.roomId ? (roomsById.get(row.roomId) ?? '') : ''}
                    </DataTableCell>
                    <DataTableCell>
                      {row.adults}+{row.children}
                      {row.dndFlag ? <span data-testid="badge-dnd"> DND</span> : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          )}
        </CardContent>
      </Card>
      </section>
    </div>
  );
}
