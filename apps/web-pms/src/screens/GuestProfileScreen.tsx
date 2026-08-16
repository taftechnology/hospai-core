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
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  Field,
  Input,
  PageHeader,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import type { StatusSeverity } from '../status/types.js';
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

function staySeverity(status: string): StatusSeverity {
  if (status === 'checked_in') return 'neutral';
  if (status === 'pending' || status === 'no_show') return 'attention';
  if (status === 'cancelled' || status === 'checked_out' || status === 'inquiry') return 'informational';
  return 'informational';
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

  return (
    <div data-testid="guest-profile">
      {unsavedGuard}
      <PageHeader title={heading} />
      {contactFailClosed ? (
        <Alert>Guest profile unavailable — organization unreachable.</Alert>
      ) : guestQ.isLoading ? (
        <p className="muted">Loading…</p>
      ) : guest ? (
        <Card>
          <CardHeader>
            <header className="board-header">
              {canBook ? (
                <Link to={`/book?guestRef=${encodeURIComponent(guestRef)}`} data-testid="guest-book">
                  Book for guest
                </Link>
              ) : null}
            </header>
          </CardHeader>
          <CardContent>
            <p>
              PII: <strong>{guest.erased ? 'Erased' : 'Live'}</strong>
            </p>
            {guest.erased ? null : (
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{guest.profile.displayName}</dd>
                </div>
                {guest.profile.email ? (
                  <div>
                    <dt>Email</dt>
                    <dd>{guest.profile.email}</dd>
                  </div>
                ) : null}
                {guest.profile.phone ? (
                  <div>
                    <dt>Phone</dt>
                    <dd>{guest.profile.phone}</dd>
                  </div>
                ) : null}
              </dl>
            )}
            {canWrite && !guest.erased ? (
              editing ? (
                <form
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
                  <Button type="submit" disabled={saveM.isPending}>
                    {saveM.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button type="button" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button type="button" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            ) : null}
            {canErase && !guest.erased ? (
              <Button type="button" data-testid="guest-erase" onClick={() => setConfirmErase(true)}>
                Erase
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Alert>Guest not found.</Alert>
      )}

      <section data-testid="guest-stays">
      <Card>
        <CardHeader>
          <h2>Stays</h2>
        </CardHeader>
        <CardContent>
          {staysFailClosed ? (
            <Alert>Stay history unavailable — property unreachable.</Alert>
          ) : staysQ.isLoading ? (
            <p className="muted">Loading…</p>
          ) : stays.items.length === 0 ? (
            <p className="muted">No stays at this property.</p>
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
                      <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>View folio</Link>
                    </DataTableCell>
                    <DataTableCell>
                      {row.arrivalDate} → {row.departureDate}
                    </DataTableCell>
                    <DataTableCell rung={staySeverity(row.status)}>
                      {reservationStatusLabel(row.status)}
                    </DataTableCell>
                    <DataTableCell>
                      {row.roomId ? (roomsById.get(row.roomId) ?? '') : ''}
                    </DataTableCell>
                    <DataTableCell>
                      {row.adults}+{row.children}
                      {row.vipFlag ? <span data-testid="badge-vip"> VIP</span> : null}
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

      {confirmErase ? (
        <div role="dialog" aria-modal="true">
        <Card>
          <CardContent>
            <p>
              This permanently destroys the guest’s contact details. Stay records remain. This cannot be
              undone.
            </p>
            <Button type="button" onClick={() => setConfirmErase(false)} aria-label="Cancel erase">
              Cancel
            </Button>
            <Button
              type="button"
              intent="destructive"
              onClick={() => eraseM.mutate()}
              disabled={eraseM.isPending}
              data-testid="guest-erase-confirm"
            >
              {eraseM.isPending ? 'Erasing…' : 'Erase guest'}
            </Button>
          </CardContent>
        </Card>
        </div>
      ) : null}
    </div>
  );
}
