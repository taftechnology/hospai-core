import { ClassifiedError } from '@hospai/client-core';
import {
  GUEST_NOTES_LENGTH_MAX,
  GUEST_TAG_LENGTH_MAX,
  GUEST_TAGS_MAX,
  normalizeGuestCrmFields,
} from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Textarea,
  isReservationStatus,
  StatusBadge,
} from '@hospai/ui-kit';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';

type GuestProfile = {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  vip?: boolean;
  notes?: string;
};
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

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, index) => tag === b[index]);
}

function buildUpdatePayload(
  displayName: string,
  email: string,
  phone: string,
  editTags: string[],
  editVip: boolean,
  editNotes: string,
): {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  vip?: boolean;
  notes?: string;
} {
  const normalised = normalizeGuestCrmFields({
    displayName,
    ...(email.trim() ? { email: email.trim() } : {}),
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(editTags.length > 0 ? { tags: editTags } : {}),
    ...(editVip ? { vip: true } : {}),
    ...(editNotes.length > 0 ? { notes: editNotes } : {}),
  });
  return {
    displayName: normalised.displayName,
    ...(normalised.email !== undefined ? { email: normalised.email } : {}),
    ...(normalised.phone !== undefined ? { phone: normalised.phone } : {}),
    ...(normalised.tags !== undefined ? { tags: normalised.tags } : {}),
    ...(normalised.vip !== undefined ? { vip: normalised.vip } : {}),
    ...(normalised.notes !== undefined ? { notes: normalised.notes } : {}),
  };
}

export function GuestProfileScreen() {
  const propertyId = tenant.propertyId;
  const { dateRange } = useFormat();
  const guestRef = decodeURIComponent(useParams().guestRef ?? '');
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [editVip, setEditVip] = useState(false);
  const [editNotes, setEditNotes] = useState('');
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
    const g = asGuestRead(guestQ.data);
    if (g && !g.erased) {
      setDisplayName(g.profile.displayName);
      setEmail(g.profile.email ?? '');
      setPhone(g.profile.phone ?? '');
      setEditTags(g.profile.tags ?? []);
      setTagDraft('');
      setEditVip(Boolean(g.profile.vip));
      setEditNotes(g.profile.notes ?? '');
    }
  }, [guestQ.data]);

  const dirty =
    editing &&
    guest !== null &&
    !guest.erased &&
    (displayName !== guest.profile.displayName ||
      email !== (guest.profile.email ?? '') ||
      phone !== (guest.profile.phone ?? '') ||
      editVip !== Boolean(guest.profile.vip) ||
      editNotes !== (guest.profile.notes ?? '') ||
      !tagsEqual(editTags, guest.profile.tags ?? []));
  const unsavedGuard = useUnsavedChanges(dirty);

  const saveM = useMutation({
    mutationFn: () =>
      api.updateGuest(
        propertyId,
        guestRef,
        buildUpdatePayload(displayName, email, phone, editTags, editVip, editNotes),
        `guest-update:${guestRef}:${crypto.randomUUID()}`,
      ),
    onSuccess: async () => {
      setEditError(null);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['guest', propertyId, guestRef] });
      await queryClient.invalidateQueries({ queryKey: ['guests-directory', propertyId] });
    },
    onError: (err) => {
      setEditError(classifiedUserMessage(asClassified(err), {}));
    },
  });

  const eraseM = useMutation({
    mutationFn: () => api.eraseGuest(propertyId, guestRef, `guest-erase:${guestRef}`),
    onSuccess: async () => {
      setConfirmErase(false);
      await queryClient.invalidateQueries({ queryKey: ['guest', propertyId, guestRef] });
    },
  });

  function addTagFromDraft() {
    const draft = tagDraft.trim();
    if (!draft) return;
    const merged = normalizeGuestCrmFields({
      displayName: 'x',
      tags: [...editTags, draft],
    }).tags;
    if (!merged) return;
    setEditTags(merged);
    setTagDraft('');
  }

  function onTagDraftKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromDraft();
    }
  }

  const pageTitle: ReactNode =
    contactFailClosed || !guest || guest.erased ? (
      guestRef
    ) : (
      <span className="guest-profile__title-row">
        {guest.profile.displayName}
        {guest.profile.vip ? <Badge rung="attention">VIP</Badge> : null}
      </span>
    );

  const highlightedStay =
    stays.items.find((s) => STAY_ACTIVE_STATUSES.has(s.status)) ?? stays.items[0] ?? null;

  const atTagCap = editTags.length >= GUEST_TAGS_MAX;

  return (
    <div className="guest-profile" data-testid="guest-profile">
      {unsavedGuard}
      <PageHeader
        back={<Link to="/guests">← Guests</Link>}
        title={pageTitle}
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
                    {dateRange(stay.arrivalDate, stay.departureDate)}
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
        <>
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
                    onSubmit={(e: FormEvent) => {
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
                    <Field
                      label="VIP guest"
                      control={
                        <Checkbox checked={editVip} onChange={(e) => setEditVip(e.target.checked)} />
                      }
                    />
                    <div className="guest-tag-list">
                      {editTags.length > 0 ? (
                        <div className="guest-preferences-badges">
                          {editTags.map((tag) => (
                            <Button
                              key={tag}
                              type="button"
                              size="sm"
                              onClick={() => setEditTags((prev) => prev.filter((t) => t !== tag))}
                              aria-label={`Remove tag ${tag}`}
                            >
                              {tag}
                              <span aria-hidden="true">×</span>
                            </Button>
                          ))}
                        </div>
                      ) : null}
                      <div className="ui-row guest-tag-add-row">
                        <Field
                          label="Preference tag"
                          control={
                            <Input
                              value={tagDraft}
                              onChange={(e) => setTagDraft(e.target.value)}
                              onKeyDown={onTagDraftKeyDown}
                              autoComplete="off"
                              maxLength={GUEST_TAG_LENGTH_MAX}
                              data-testid="guest-tag-input"
                            />
                          }
                        />
                        <Button type="button" disabled={atTagCap} onClick={addTagFromDraft}>
                          Add
                        </Button>
                      </div>
                      {atTagCap ? <p className="muted">Maximum of 20 tags.</p> : null}
                    </div>
                    <Field
                      label="Notes"
                      hint={`${editNotes.length} / ${GUEST_NOTES_LENGTH_MAX}`}
                      control={
                        <Textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          maxLength={GUEST_NOTES_LENGTH_MAX}
                          data-testid="guest-notes-input"
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

          {guest.erased ? null : (
            <>
              <Card data-testid="guest-preferences-card">
                <CardHeader>
                  <CardTitle>Preferences</CardTitle>
                </CardHeader>
                <CardContent>
                  {guest.profile.tags && guest.profile.tags.length > 0 ? (
                    <div className="guest-preferences-badges">
                      {guest.profile.tags.map((tag) => (
                        <Badge key={tag} rung="neutral">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="No preferences recorded." />
                  )}
                </CardContent>
              </Card>

              <Card data-testid="guest-notes-card">
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  {guest.profile.notes ? (
                    <p className="guest-notes-body">{guest.profile.notes}</p>
                  ) : (
                    <EmptyState title="No notes." />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
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
                        <Link className="ui-link-btn ui-link-btn--sm" to={`/folio/${encodeURIComponent(row.reservationId)}`}>
                          View folio
                        </Link>
                      </DataTableCell>
                      <DataTableCell>
                        {dateRange(row.arrivalDate, row.departureDate)}
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
