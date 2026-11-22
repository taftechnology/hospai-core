import { getConfigEntry } from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  NativeSelect,
  PageHeader,
  isReservationStatus,
  StatusBadge,
} from '@hospai/ui-kit';
import type { PackageListItem } from '@hospai/contracts';
import { hasPropertyPermission, meShellStateFromQuery } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { resolveDocumentPrintGate } from './document-print-views.js';
import { FrontOfficeEditor } from './front-office-editor.js';
import { NightlyRatesEditor } from './NightlyRatesEditor.js';
import {
  PrintRegCardControl,
  RegistrationCardDocument,
  type RegistrationCardData,
} from './registration-card.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { useFormat } from '../shell/PropertyFormat.js';
import {
  GuestDocumentBadges,
  GuestPreferenceBadges,
  ID_DOCUMENT_BLOCK_REASON,
  RecordIdDocumentDialog,
  useGuestDocumentList,
  useGuestPreferences,
} from './guest-identity.js';
import { isStayGuarantee, stayGuaranteeText } from './tender-label.js';
import { AdvancePayments } from './AdvancePayments.js';
import { FormCCheckInNotice, invalidateFormC } from './form-c.js';

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

const TERMINAL_STATUSES = new Set(['cancelled', 'checked_out', 'no_show']);

const CHECK_IN_CLEANLINESS = 'pms.reservations.check_in_cleanliness';
const REQUIRE_INSPECTION = 'pms.housekeeping.require_inspection';
const ALLOW_DIRTY_OVERRIDE = 'pms.reservations.allow_dirty_check_in_override';
const AUTO_ASSIGN_ROOMS = 'pms.ops.auto_assign_rooms';
const REQUIRE_PREPAYMENT = 'pms.booking.require_prepayment';

const PREPAYMENT_BLOCK_REASON =
  'This hotel requires a card hold or payment before check-in. Authorize a card or take a payment on the folio.';

const CHECK_IN_BLOCK_REASON_ID = 'check-in-block-reason';

type ConfigKey = { key: string; value: unknown };

type CheckInRoom = {
  code: string;
  status: string;
  oooRanges?: Array<{ startDate: string; endDate: string }>;
};

function configBool(keys: ConfigKey[] | undefined, key: string, fallback: boolean): boolean {
  const row = keys?.find((k) => k.key === key);
  if (row?.value === true) return true;
  if (row?.value === false) return false;
  return fallback;
}

function configStr(keys: ConfigKey[] | undefined, key: string, fallback: string): string {
  const row = keys?.find((k) => k.key === key);
  return typeof row?.value === 'string' ? row.value : fallback;
}

function registeredBool(key: string, fallback: boolean): boolean {
  const value = getConfigEntry(key)?.default;
  return typeof value === 'boolean' ? value : fallback;
}

function registeredStr(key: string, fallback: string): string {
  const value = getConfigEntry(key)?.default;
  return typeof value === 'string' ? value : fallback;
}

/** Same window as PropertyDO: start < departure and end > arrival. */
function roomOutOfOrder(room: CheckInRoom, arrival: string, departure: string): boolean {
  if (room.status === 'out_of_order') return true;
  if (!arrival || !departure) return false;
  return (room.oooRanges ?? []).some(
    (range) => range.startDate < departure && range.endDate > arrival,
  );
}

function roomNotReady(
  room: CheckInRoom,
  cleanliness: string,
  requireInspection: boolean,
): 'dirty' | 'uninspected' | null {
  if (cleanliness !== 'strict') return null;
  if (room.status === 'dirty') return 'dirty';
  if (requireInspection && room.status === 'clean') return 'uninspected';
  return null;
}

function checkInBlockReason(input: {
  status: string | undefined;
  roomPicked: boolean;
  room: CheckInRoom | null;
  autoAssign: boolean;
  cleanliness: string;
  requireInspection: boolean;
  allowOverride: boolean;
  overrideTicked: boolean;
  arrival: string;
  departure: string;
  prepaymentRequired: boolean;
  guaranteed: boolean;
}): string | null {
  const { status } = input;
  if (status == null || status === 'checked_in' || TERMINAL_STATUSES.has(status)) return null;
  if (status === 'pending') return 'Confirm the booking before check-in.';
  if (status !== 'confirmed') return 'Only a confirmed booking can be checked in.';
  if (input.prepaymentRequired && !input.guaranteed) return PREPAYMENT_BLOCK_REASON;
  if (!input.roomPicked) {
    return input.autoAssign ? null : 'Pick a room first.';
  }
  if (!input.room) return null;
  if (roomOutOfOrder(input.room, input.arrival, input.departure)) {
    return `Room ${input.room.code} is out of order. Pick another room.`;
  }
  const notReady = roomNotReady(input.room, input.cleanliness, input.requireInspection);
  if (!notReady || input.overrideTicked) return null;
  const lead =
    notReady === 'dirty'
      ? `Room ${input.room.code} is dirty.`
      : `Room ${input.room.code} has not been inspected.`;
  const tail = input.allowOverride
    ? 'Tick Override cleanliness to check in anyway.'
    : 'Pick a clean room.';
  return `${lead} ${tail}`;
}

function nightsBetween(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function CheckInScreen() {
  const { dateRange, money } = useFormat();
  const queryClient = useQueryClient();
  const { reservationId = '' } = useParams();
  const [roomId, setRoomId] = useState('');
  const [message, setMessageText] = useState<string | null>(null);
  const [messageIntent, setMessageIntent] = useState<'exception' | 'attention' | 'settled'>(
    'exception',
  );
  const setMessage = (text: string | null) => {
    setMessageIntent('exception');
    setMessageText(text);
  };
  const setQueuedNotice = (text: string) => {
    setMessageIntent('attention');
    setMessageText(text);
  };
  const setSettledNotice = (text: string) => {
    setMessageIntent('settled');
    setMessageText(text);
  };
  const [showOverride, setShowOverride] = useState(false);
  const [overrideCleanliness, setOverrideCleanliness] = useState(false);
  const [recordIdOpen, setRecordIdOpen] = useState(false);
  const [idNotice, setIdNotice] = useState<string | null>(null);
  const [applyPackageId, setApplyPackageId] = useState('');
  const applyPackageOpIdRef = useRef<string | null>(null);

  const reservationQ = useQuery({
    queryKey: ['reservation', tenant.propertyId, reservationId],
    queryFn: () => api.getReservation(tenant.propertyId, reservationId),
    enabled: Boolean(reservationId),
  });

  const rateNightsQ = useQuery({
    queryKey: ['reservation-rate-nights', tenant.propertyId, reservationId],
    queryFn: () => api.getReservationRateNights(tenant.propertyId, reservationId),
    enabled: Boolean(reservationId),
  });

  const packagesQ = useQuery({
    queryKey: ['packages', tenant.propertyId, 'active'],
    queryFn: () => api.listPackages(tenant.propertyId, { status: 'active' }),
    retry: false,
  });

  const guestRef = reservationQ.data?.guestRef;
  const guestsQ = useQuery({
    queryKey: ['check-in-guest', tenant.propertyId, guestRef],
    queryFn: () => api.postGuestsBatch(tenant.propertyId, guestRef ? [guestRef] : []),
    enabled: Boolean(guestRef),
  });
  const propertyQ = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
  });
  const roomsQ = useQuery({
    queryKey: ['rooms', tenant.propertyId],
    queryFn: () => api.listRooms(tenant.propertyId),
    retry: false,
  });
  const typesQ = useQuery({
    queryKey: ['room-types', tenant.propertyId, 'active'],
    queryFn: () => api.listRoomTypes(tenant.propertyId, { status: 'active' }),
    retry: false,
  });
  const domainConfigQ = useQuery({
    queryKey: ['domain-config', tenant.propertyId],
    queryFn: () => api.listDomainConfig(tenant.propertyId),
    retry: false,
  });
  const paymentsQ = useQuery({
    queryKey: ['folio-payments', tenant.propertyId, reservationId],
    queryFn: () => api.getFolioPayments(tenant.propertyId, reservationId),
    enabled: Boolean(reservationId),
  });
  const regCardQ = useQuery({
    queryKey: ['reservation-registration-card', tenant.propertyId, reservationId],
    queryFn: () => api.getReservationRegistrationCard(tenant.propertyId, reservationId),
    staleTime: 0,
    enabled: Boolean(reservationId),
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

  useEffect(() => {
    const preassigned = reservationQ.data?.roomId;
    if (preassigned && !roomId) setRoomId(preassigned);
  }, [reservationQ.data?.roomId, roomId]);

  const assign = useMutation({
    mutationFn: () =>
      api.assignRoom(tenant.propertyId, reservationId, roomId, `assign:${reservationId}:${roomId}`),
    onError: (err) => {
      setMessage(classifiedUserMessage(asClassified(err), { fallback: 'Assign failed' }));
    },
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setQueuedNotice(queuedWriteCopy());
        return;
      }
      setSettledNotice('Room assigned');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', tenant.propertyId] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-free', tenant.propertyId] });
    },
  });

  const checkIn = useMutation({
    mutationFn: () =>
      api.checkIn(
        tenant.propertyId,
        reservationId,
        `checkin:${reservationId}:${roomId || 'auto'}:${overrideCleanliness ? '1' : '0'}`,
        {
          ...(roomId.trim() ? { roomId: roomId.trim() } : {}),
          ...(overrideCleanliness ? { overrideCleanliness: true } : {}),
        },
      ),
    onError: (err) => {
      const c = asClassified(err);
      if (bodyErrorCode(c.body) === 'room_not_ready') {
        setShowOverride(true);
        setMessage('Room is not ready. Override cleanliness if allowed.');
        return;
      }
      setMessage(classifiedUserMessage(c, { fallback: 'Check-in failed' }));
    },
    onSuccess: (result) => {
      if (isQueuedResult(result)) {
        setQueuedNotice(queuedWriteCopy());
        return;
      }
      setSettledNotice('Checked in');
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-tape', tenant.propertyId] });
      void queryClient.invalidateQueries({ queryKey: ['front-desk-free', tenant.propertyId] });
      // A foreign passport makes check-in create the booked guest's Form C row.
      invalidateFormC(queryClient, tenant.propertyId, reservationId);
    },
  });

  const applyPackage = useMutation({
    mutationFn: (packageId: string) => {
      const opId =
        applyPackageOpIdRef.current ??
        `checkin-apply-package:${reservationId}:${packageId}:${crypto.randomUUID()}`;
      applyPackageOpIdRef.current = opId;
      return api.applyPackage(
        tenant.propertyId,
        reservationId,
        { packageId },
        opId,
      );
    },
    onError: (err) => {
      setMessage(
        classifiedUserMessage(asClassified(err), { fallback: 'Could not apply the package' }),
      );
    },
    onSuccess: (result) => {
      applyPackageOpIdRef.current = null;
      setApplyPackageId('');
      if (isQueuedResult(result)) {
        setQueuedNotice(queuedWriteCopy());
        return;
      }
      setSettledNotice('Package applied');
      void queryClient.invalidateQueries({
        queryKey: ['reservation', tenant.propertyId, reservationId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['reservation-rate-nights', tenant.propertyId, reservationId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['recurring-charges', tenant.propertyId, reservationId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['folio', tenant.propertyId, reservationId],
      });
    },
  });

  const status = reservationQ.data?.status;
  const terminalOrInHouse =
    status != null &&
    (TERMINAL_STATUSES.has(status) || status === 'checked_in');
  const guestState = guestRef ? guestsQ.data?.states[guestRef] : undefined;
  const displayName = guestState?.kind === 'resolved' ? guestState.displayName : null;
  const adults = reservationQ.data?.adults ?? 1;
  const children = reservationQ.data?.children ?? 0;
  const editorDisabled = Boolean(
    reservationQ.data && TERMINAL_STATUSES.has(reservationQ.data.status),
  );
  const rooms = roomsQ.data?.rooms ?? [];
  const assignTypeId =
    reservationQ.data?.allocatedRoomTypeId &&
    reservationQ.data.allocatedRoomTypeId !== reservationQ.data.roomTypeId
      ? reservationQ.data.allocatedRoomTypeId
      : reservationQ.data?.roomTypeId;
  const typedRooms = assignTypeId ? rooms.filter((r) => r.roomTypeId === assignTypeId) : rooms;
  const roomOptions = typedRooms.length > 0 ? typedRooms : rooms;
  const roomTypeId = reservationQ.data?.roomTypeId;
  const allocatedRoomTypeId = reservationQ.data?.allocatedRoomTypeId;
  const roomTypeEntry = roomTypeId ? typeDir.get(roomTypeId) : undefined;
  const roomTypeLabel = roomTypeEntry?.name || roomTypeEntry?.code;
  const allocatedEntry = allocatedRoomTypeId ? typeDir.get(allocatedRoomTypeId) : undefined;
  const res = reservationQ.data;
  const regCardData =
    regCardQ.data &&
    typeof regCardQ.data === 'object' &&
    (regCardQ.data as { ok?: unknown }).ok === true
      ? (regCardQ.data as RegistrationCardData)
      : null;
  const configKeys = Array.isArray(domainConfigQ.data?.keys)
    ? (domainConfigQ.data.keys as ConfigKey[])
    : undefined;
  const cleanliness = configStr(
    configKeys,
    CHECK_IN_CLEANLINESS,
    registeredStr(CHECK_IN_CLEANLINESS, 'strict'),
  );
  const requireInspection = configBool(
    configKeys,
    REQUIRE_INSPECTION,
    registeredBool(REQUIRE_INSPECTION, false),
  );
  const allowDirtyOverride = configBool(
    configKeys,
    ALLOW_DIRTY_OVERRIDE,
    registeredBool(ALLOW_DIRTY_OVERRIDE, true),
  );
  const autoAssign = configBool(
    configKeys,
    AUTO_ASSIGN_ROOMS,
    registeredBool(AUTO_ASSIGN_ROOMS, true),
  );
  const requirePrepayment = configBool(
    configKeys,
    REQUIRE_PREPAYMENT,
    registeredBool(REQUIRE_PREPAYMENT, false),
  );
  const payments = paymentsQ.data?.payments ?? [];
  const guaranteed = paymentsQ.isSuccess && payments.some(isStayGuarantee);
  const guaranteeText = paymentsQ.isSuccess ? stayGuaranteeText(payments, money) : null;
  const selectedRoom = rooms.find((r) => r.roomId === roomId) ?? null;
  const arrival = res?.arrivalDate ?? '';
  const departure = res?.departureDate ?? '';
  const docsQ = useGuestDocumentList(tenant.propertyId, guestRef ?? '', Boolean(guestRef));
  const preferences = useGuestPreferences(tenant.propertyId, guestRef, guestsQ.data, guestsQ.isFetched);
  const meQ = useQuery({
    queryKey: ['me', tenant.propertyId],
    queryFn: () => api.getMe(tenant.propertyId),
  });
  const meShell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data,
    classified: meQ.error ? asClassified(meQ.error) : undefined,
  });
  const authorityLive = meShell.kind === 'authority' && meShell.authority.kind === 'live';
  const printGate = resolveDocumentPrintGate({
    isPending: regCardQ.isPending,
    isError: regCardQ.isError,
    isSuccess: regCardQ.isSuccess,
    error: regCardQ.error,
    okPayload: regCardData != null,
    authorityLive,
  });
  const canPrint = printGate.canPrint;
  const canRecordId = Boolean(meQ.data && hasPropertyPermission(meQ.data, 'guests:write'));
  const idRequired = docsQ.data?.requireIdAtCheckIn === true;
  const docCount = docsQ.data && 'documents' in docsQ.data ? docsQ.data.documents.length : 0;
  const idBlock = idRequired && docsQ.isSuccess && docCount === 0 ? ID_DOCUMENT_BLOCK_REASON : null;
  const blockReason = idBlock ?? checkInBlockReason({
    status,
    roomPicked: roomId.trim().length > 0,
    room: selectedRoom,
    autoAssign,
    cleanliness,
    requireInspection,
    allowOverride: allowDirtyOverride,
    overrideTicked: overrideCleanliness,
    arrival,
    departure,
    prepaymentRequired: requirePrepayment,
    guaranteed,
  });
  const canCheckIn = !checkIn.isPending && !terminalOrInHouse && blockReason == null;
  const offerOverride =
    showOverride ||
    (status === 'confirmed' &&
      selectedRoom != null &&
      !roomOutOfOrder(selectedRoom, arrival, departure) &&
      roomNotReady(selectedRoom, cleanliness, requireInspection) != null &&
      allowDirtyOverride);
  const nightsPosted =
    rateNightsQ.isSuccess &&
    (rateNightsQ.data?.nights ?? []).some((n) => n.posted === true);
  const stayPackageId = reservationQ.data?.packageId;
  const hasPackage = stayPackageId != null && String(stayPackageId).length > 0;
  const activePackages = (packagesQ.data?.packages ?? []) as PackageListItem[];
  const canApplyPackage =
    !hasPackage &&
    !nightsPosted &&
    (status === 'pending' || status === 'confirmed' || status === 'checked_in') &&
    activePackages.length > 0;

  return (
    <>
      {status === 'checked_in' ? (
        <Alert>Guest is already in house.</Alert>
      ) : status != null && TERMINAL_STATUSES.has(status) ? (
        <Alert>
          This reservation is {reservationStatusLabel(status)} — check-in is not available.
        </Alert>
      ) : null}
      <PageHeader
        back={<Link to="/arrivals">Arrivals</Link>}
        title={`Check in ${displayName ?? 'guest'}`}
        subtitle={
          res
            ? (() => {
                const roomLabel = roomTypeLabel;
                return (
                  <>
                    {isReservationStatus(res.status) ? (
                      <StatusBadge status={res.status} />
                    ) : (
                      reservationStatusLabel(res.status)
                    )}
                    {roomLabel ? (
                      <>
                        <span className="sep">·</span> {roomLabel}
                      </>
                    ) : null}
                    <span className="sep">·</span>
                    {dateRange(res.arrivalDate, res.departureDate)}
                    <span className="sep">·</span>{' '}
                    {nightsBetween(res.arrivalDate, res.departureDate)} nights
                  </>
                );
              })()
            : undefined
        }
        actions={
          <div className="ui-stack ui-stack--tight">
            <Button
              type="button"
              intent="primary"
              data-testid="check-in"
              disabled={!canCheckIn}
              aria-describedby={blockReason ? CHECK_IN_BLOCK_REASON_ID : undefined}
              onClick={() => checkIn.mutate()}
            >
              Check in
            </Button>
            {blockReason ? (
              <p className="muted" id={CHECK_IN_BLOCK_REASON_ID}>
                {blockReason}
                {blockReason === PREPAYMENT_BLOCK_REASON ? (
                  <>
                    {' '}
                    <Link className="ui-link-btn" to={`/folio/${reservationId}`}>
                      Folio
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        }
      />
      {reservationId ? (
        <Card>
          <CardHeader>
            <CardTitle>Nightly rates</CardTitle>
          </CardHeader>
          <CardContent>
            <NightlyRatesEditor
              propertyId={tenant.propertyId}
              reservationId={reservationId}
              collapsedDefault
            />
          </CardContent>
        </Card>
      ) : null}

      {canApplyPackage ? (
        <Card data-testid="check-in-apply-package">
          <CardHeader>
            <CardTitle>Apply package</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-row">
              <Field
                label="Package"
                control={
                  <NativeSelect
                    data-testid="check-in-package"
                    value={applyPackageId}
                    onChange={(e) => {
                      setApplyPackageId(e.target.value);
                      applyPackageOpIdRef.current = null;
                    }}
                  >
                    <option value="">Choose a package</option>
                    {activePackages.map((p) => (
                      <option key={p.packageId} value={p.packageId}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <Button
                type="button"
                data-testid="check-in-apply-package-btn"
                disabled={!applyPackageId || applyPackage.isPending}
                onClick={() => applyPackage.mutate(applyPackageId)}
              >
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {reservationQ.isError ? (
        <Alert data-testid="check-in-reservation-error">
          {classifiedUserMessage(asClassified(reservationQ.error), {
            fallback: 'Could not load this reservation.',
          })}
        </Alert>
      ) : null}
      {roomsQ.isError ? (
        <Alert data-testid="check-in-rooms-error">
          {classifiedUserMessage(asClassified(roomsQ.error), {
            fallback: 'Could not load rooms.',
          })}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Room assignment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            {autoAssign ? (
              <p className="muted">Leave blank to auto-assign a vacant room of the booked type.</p>
            ) : null}
            {res ? (
              <p>
                Adults {adults} · Children {children}
              </p>
            ) : null}
            <p data-testid="check-in-guarantee">
              Guarantee{guaranteeText ? `: ${guaranteeText}` : ''}
            </p>
            {status === 'pending' || status === 'confirmed' || status === 'checked_in' ? (
              <AdvancePayments
                propertyId={tenant.propertyId}
                reservationId={reservationId}
                context="check-in"
                status={status}
                onAdvanceSuccess={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ['folio-payments', tenant.propertyId, reservationId],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ['folio', tenant.propertyId, reservationId],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ['reservation-proforma', tenant.propertyId, reservationId],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ['open-shift', tenant.propertyId],
                  });
                }}
              />
            ) : null}
            <div className="ui-row">
              {roomsQ.isSuccess ? (
                <Field
                  label="Room"
                  control={
                    <NativeSelect
                      data-testid="check-in-room"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                    >
                      <option value="">Select room</option>
                      {roomOptions.map((r) => (
                        <option key={r.roomId} value={r.roomId}>
                          {r.code}
                        </option>
                      ))}
                    </NativeSelect>
                  }
                />
              ) : null}
              <Button
                type="button"
                disabled={!roomId || assign.isPending}
                onClick={() => assign.mutate()}
              >
                Assign room
              </Button>
            </div>
            {offerOverride ? (
              <Field
                label="Override cleanliness"
                control={
                  <Checkbox
                    data-testid="override-cleanliness"
                    checked={overrideCleanliness}
                    onChange={(e) => setOverrideCleanliness(e.target.checked)}
                  />
                }
              />
            ) : null}
            {message ? (
              <Alert intent={messageIntent} data-testid="check-in-message">
                {message}
              </Alert>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {guestRef ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity and preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="ui-stack">
              {idNotice ? <Alert intent="settled">{idNotice}</Alert> : null}
              <GuestDocumentBadges propertyId={tenant.propertyId} guestRef={guestRef} />
              <FormCCheckInNotice guestRef={guestRef} />
              <GuestPreferenceBadges preferences={preferences} />
              {canRecordId ? (
                <Button type="button" onClick={() => setRecordIdOpen(true)}>
                  Record ID
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {guestRef ? (
        <RecordIdDocumentDialog
          open={recordIdOpen}
          onClose={() => setRecordIdOpen(false)}
          propertyId={tenant.propertyId}
          guestRef={guestRef}
          onRecorded={() => setIdNotice('Identity document recorded.')}
        />
      ) : null}

      {res ? (
        <FrontOfficeEditor
          reservationId={reservationId}
          frontOfficeComment={res.frontOfficeComment}
          vipFlag={res.vipFlag}
          dndFlag={res.dndFlag}
          sourceCode={res.sourceCode}
          marketSegmentCode={res.marketSegmentCode}
          disabled={editorDisabled}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Registration card</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="ui-stack">
            <PrintRegCardControl canPrint={canPrint} reason={printGate.reason} />
            {allocatedEntry && allocatedRoomTypeId !== roomTypeId ? (
              <p className="muted">Allocated: {allocatedEntry.name || allocatedEntry.code}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {regCardData && !regCardQ.isError ? (
        <RegistrationCardDocument
          propertyName={propertyQ.data?.property?.name ?? null}
          data={regCardData}
        />
      ) : null}
    </>
  );
}
