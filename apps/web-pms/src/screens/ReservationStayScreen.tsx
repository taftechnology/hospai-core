import type { FolioPaymentRow, GuestRowState, ReservationRead } from '@hospai/client-core';
import type { GuestPreferences } from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  RowActions,
  Skeleton,
  StatField,
  StatusBadge,
  isReservationStatus,
  type AlertIntent,
} from '@hospai/ui-kit';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { NightlyRatesEditor } from './NightlyRatesEditor.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.js';
import { FormDialog } from '../shell/FormDialog.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { GuestRequestButton } from './GuestRequestButton.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { GuestDocumentBadges, GuestPreferenceBadges, useGuestPreferences } from './guest-identity.js';
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import { FrontOfficeEditor } from './front-office-editor.js';
import { GuestNameLink } from './guest-row.js';
import { AdvancePayments } from './AdvancePayments.js';
import { FormCPanel } from './form-c.js';
import {
  cancelChargeSentence,
  cancelCheckInOpId,
  cancelReservationOpId,
  cancellationPolicySentence,
  changeInHouseStayOpId,
  checkInBlockReason,
  confirmReservationOpId,
  damageHoldWord,
  inHouseChangePreview,
  invalidateStayMutations,
  isTerminalStay,
  modifyReservationOpId,
  noShowBlockReason,
  noShowChargeSentence,
  noShowReservationOpId,
  stayNights,
  type InHouseChangeDraft,
  type StayModifyBody,
} from './stay-workspace.js';

type StayMessage = { intent: AlertIntent; text: string };

/** Statuses the cancel command accepts; the policy line means nothing on the others. */
const CANCELLABLE = new Set(['inquiry', 'pending', 'confirmed']);

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

function isNotFound(err: unknown): boolean {
  const c = asClassified(err);
  return c.status === 404 || bodyErrorCode(c.body) === 'not_found';
}

export function ReservationStayScreen() {
  const { reservationId = '' } = useParams();
  const propertyId = tenant.propertyId;
  const queryClient = useQueryClient();
  const { money, date, dateRange, dateTime, fmt } = useFormat();
  const timeZone = usePropertyTimeZone();
  const businessDate = timeZone ? propertyLocalToday(timeZone) : null;
  const [message, setMessage] = useState<StayMessage | null>(null);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [cancelCheckInOpen, setCancelCheckInOpen] = useState(false);
  const [draft, setDraft] = useState<StayModifyBody | null>(null);
  const [changeDraft, setChangeDraft] = useState<InHouseChangeDraft | null>(null);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const changeAttemptRef = useRef<string | null>(null);

  const reservationQ = useQuery({
    queryKey: ['reservation', propertyId, reservationId],
    queryFn: () => api.getReservation(propertyId, reservationId),
    enabled: Boolean(reservationId),
  });
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    retry: false,
  });
  const canChangeInHouse = Boolean(
    meQ.data && hasPropertyPermission(meQ.data, 'reservations:change_in_house'),
  );
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const guestRef = reservationQ.data?.guestRef;
  const guestsQ = useQuery({
    queryKey: ['stay-guest', propertyId, guestRef],
    queryFn: () => api.postGuestsBatch(propertyId, guestRef ? [guestRef] : []),
    enabled: Boolean(guestRef),
  });
  const roomsQ = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.listRooms(propertyId),
    retry: false,
  });
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
  const paymentsQ = useQuery({
    queryKey: ['folio-payments', propertyId, reservationId],
    queryFn: () => api.getFolioPayments(propertyId, reservationId),
    enabled: Boolean(reservationId),
  });

  const res = reservationQ.data;
  const changeTypeDiffers =
    Boolean(changeDraft && res && changeDraft.roomTypeId !== res.roomTypeId);
  const availableRoomsQ = useQuery({
    queryKey: [
      'front-desk-available',
      propertyId,
      businessDate,
      changeDraft?.roomTypeId,
      changeDraft?.departureDate,
    ],
    queryFn: () =>
      api.getAvailableRooms(propertyId, {
        fromDate: businessDate!,
        toDate: changeDraft!.departureDate,
        roomTypeId: changeDraft!.roomTypeId,
      }),
    enabled: Boolean(
      changeOpen && changeTypeDiffers && businessDate && changeDraft && changeDraft.departureDate > businessDate,
    ),
    retry: false,
  });
  const propertyName = propertyQ.data?.property?.name;
  const guestState = guestRef ? guestsQ.data?.states[guestRef] : undefined;
  const preferences = useGuestPreferences(propertyId, guestRef, guestsQ.data, guestsQ.isFetched);
  const displayName =
    guestState?.kind === 'resolved'
      ? guestState.displayName
      : guestState?.kind === 'erased'
        ? 'Guest erased'
        : guestRef
          ? 'Name pending'
          : null;
  const roomCode =
    res?.roomId == null
      ? null
      : (roomsQ.data?.rooms ?? []).find((room) => room.roomId === res.roomId)?.code ?? null;
  const roomTypes = (typesQ.data?.roomTypes ?? []) as Array<{
    roomTypeId: string;
    code: string;
    name: string;
  }>;
  const plans = (plansQ.data?.plans ?? []) as Array<{ ratePlanId: string; code: string; name: string }>;
  const roomTypeName = roomTypes.find((t) => t.roomTypeId === res?.roomTypeId)?.name;
  const ratePlanName = plans.find((p) => p.ratePlanId === res?.ratePlanId)?.name;
  const damageHolds = (paymentsQ.data?.payments ?? []).filter(
    (payment) => payment.purpose === 'DAMAGE',
  );

  function refresh() {
    invalidateStayMutations(queryClient, propertyId, reservationId);
  }

  function fail(err: unknown, fallback: string) {
    setMessage({ intent: 'exception', text: classifiedUserMessage(asClassified(err), { fallback, fmt }) });
  }

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmReservation(propertyId, reservationId, confirmReservationOpId(reservationId)),
    onSuccess: (result) => {
      setMessage(
        isQueuedResult(result)
          ? { intent: 'attention', text: queuedWriteCopy() }
          : { intent: 'settled', text: 'Stay confirmed.' },
      );
      refresh();
    },
    onError: (err) => fail(err, 'Confirm failed'),
  });

  const modify = useMutation({
    mutationFn: (body: StayModifyBody) =>
      api.modifyReservation(propertyId, reservationId, modifyReservationOpId(reservationId, body), body),
    onSuccess: () => {
      setModifyOpen(false);
      setModifyError(null);
      setMessage({ intent: 'settled', text: 'Stay updated.' });
      refresh();
    },
    onError: (err) => {
      setModifyError(classifiedUserMessage(asClassified(err), { fallback: 'Modify failed', fmt }));
    },
  });

  const changeStay = useMutation({
    mutationFn: (body: InHouseChangeDraft) => {
      if (!changeAttemptRef.current) {
        changeAttemptRef.current = crypto.randomUUID();
      }
      const payload: {
        departureDate?: string;
        roomTypeId?: string;
        roomId?: string;
        ratePlanId?: string;
        adults?: number;
        children?: number;
        reason: string;
      } = { reason: body.reason.trim() };
      if (res && body.departureDate !== res.departureDate) payload.departureDate = body.departureDate;
      if (res && body.roomTypeId !== res.roomTypeId) {
        payload.roomTypeId = body.roomTypeId;
        payload.roomId = body.roomId;
      }
      if (res && body.ratePlanId !== res.ratePlanId) payload.ratePlanId = body.ratePlanId;
      if (res && body.adults !== (res.adults ?? 1)) payload.adults = body.adults;
      if (res && body.children !== (res.children ?? 0)) payload.children = body.children;
      return api.changeInHouseStay(
        propertyId,
        reservationId,
        changeInHouseStayOpId(reservationId, changeAttemptRef.current),
        payload,
      );
    },
    onSuccess: () => {
      changeAttemptRef.current = null;
      setChangeOpen(false);
      setChangeError(null);
      setMessage({ intent: 'settled', text: 'Stay updated.' });
      refresh();
    },
    onError: (err) => {
      const classified = asClassified(err);
      const typeChange =
        Boolean(res && changeDraft && changeDraft.roomTypeId !== res.roomTypeId);
      const pickedCode =
        typeChange && changeDraft?.roomId
          ? (availableRoomsQ.data?.rooms ?? []).find((r) => r.roomId === changeDraft.roomId)?.code ??
            changeDraft.roomId
          : undefined;
      setChangeError(
        classifiedUserMessage(classified, {
          fallback: 'Could not change the stay',
          fmt,
          ...(typeChange && bodyErrorCode(classified.body) === 'room_already_assigned'
            ? { roomCode: pickedCode ?? changeDraft?.roomId ?? 'that room' }
            : {}),
        }),
      );
    },
  });

  const cancel = useMutation({
    mutationFn: () =>
      api.cancelReservation(propertyId, reservationId, cancelReservationOpId(reservationId)),
    onSuccess: () => {
      setCancelOpen(false);
      setMessage({ intent: 'settled', text: 'Reservation cancelled.' });
      refresh();
    },
    onError: (err) => {
      setCancelOpen(false);
      fail(err, 'Cancel failed');
    },
  });

  const noShow = useMutation({
    mutationFn: () =>
      api.noShowReservation(propertyId, reservationId, noShowReservationOpId(reservationId)),
    onSuccess: () => {
      setNoShowOpen(false);
      setMessage({ intent: 'settled', text: 'Marked as no-show.' });
      refresh();
    },
    onError: (err) => {
      setNoShowOpen(false);
      fail(err, 'No-show failed');
    },
  });

  const cancelCheckIn = useMutation({
    mutationFn: () =>
      api.cancelCheckIn(
        propertyId,
        reservationId,
        cancelCheckInOpId(reservationId, res?.updatedAt ?? 0),
      ),
    onSuccess: (result) => {
      setCancelCheckInOpen(false);
      setMessage(
        isQueuedResult(result)
          ? { intent: 'attention', text: queuedWriteCopy() }
          : { intent: 'settled', text: 'Check-in cancelled. The stay is confirmed again.' },
      );
      refresh();
    },
    onError: (err) => {
      setCancelCheckInOpen(false);
      fail(err, 'Cancel check-in failed');
    },
  });

  const subtitle = [displayName, propertyName].filter(Boolean).join(' · ') || undefined;

  if (reservationQ.isLoading) {
    return (
      <div className="board-page">
        <PageHeader title="Reservation" subtitle={propertyName} back={<Link to="/reservations">Reservations</Link>} />
        <Card>
          <CardContent>
            <Skeleton label="Loading reservation" lines={6} />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reservationQ.isError && isNotFound(reservationQ.error)) {
    return (
      <div className="board-page">
        <PageHeader title="Reservation" subtitle={propertyName} back={<Link to="/reservations">Reservations</Link>} />
        <Card>
          <CardContent>
            <EmptyState kind="empty" title="Reservation not found." />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reservationQ.isError || !res) {
    return (
      <div className="board-page">
        <PageHeader title="Reservation" subtitle={propertyName} back={<Link to="/reservations">Reservations</Link>} />
        <Card>
          <CardContent>
            <Alert>
              {reservationQ.isError
                ? classifiedUserMessage(asClassified(reservationQ.error), {
                    fallback: "Couldn't load this reservation.",
                    fmt,
                  })
                : "Couldn't load this reservation."}
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="board-page">
      <PageHeader
        title="Reservation"
        subtitle={subtitle}
        back={<Link to="/reservations">Reservations</Link>}
      />
      <StayActions
        res={res}
        roomCode={roomCode}
        businessDate={businessDate}
        message={message}
        pending={
          confirm.isPending ||
          modify.isPending ||
          changeStay.isPending ||
          cancel.isPending ||
          noShow.isPending ||
          cancelCheckIn.isPending
        }
        canChangeInHouse={canChangeInHouse}
        onConfirm={() => confirm.mutate()}
        onModify={() => {
          setDraft({
            roomTypeId: res.roomTypeId,
            arrivalDate: res.arrivalDate,
            departureDate: res.departureDate,
            adults: res.adults ?? 1,
            children: res.children ?? 0,
            ratePlanId: res.ratePlanId,
          });
          setModifyError(null);
          setModifyOpen(true);
        }}
        onChangeStay={() => {
          changeAttemptRef.current = null;
          setChangeDraft({
            departureDate: res.departureDate,
            roomTypeId: res.roomTypeId,
            roomId: res.roomId ?? '',
            ratePlanId: res.ratePlanId ?? '',
            adults: res.adults ?? 1,
            children: res.children ?? 0,
            reason: '',
          });
          setChangeError(null);
          setChangeOpen(true);
        }}
        onCancel={() => setCancelOpen(true)}
        onNoShow={() => setNoShowOpen(true)}
        onCancelCheckIn={() => setCancelCheckInOpen(true)}
      />
      <StayCard
        res={res}
        guestState={guestState}
        guestRef={res.guestRef}
        roomTypeName={roomTypeName}
        roomCode={roomCode}
        ratePlanName={ratePlanName}
        dateRange={dateRange}
        dateTime={dateTime}
        money={money}
        preferences={preferences}
      />
      <FormCPanel reservationId={reservationId} guestRef={res.guestRef} stayStatus={res.status} />
      <Card>
        <CardHeader>
          <CardTitle>Nightly rates</CardTitle>
        </CardHeader>
        <CardContent>
          <NightlyRatesEditor propertyId={propertyId} reservationId={reservationId} />
        </CardContent>
      </Card>
      <DamagePanel
        reservationId={reservationId}
        loading={paymentsQ.isLoading}
        error={paymentsQ.isError}
        holds={damageHolds}
        money={money}
      />
      {res.status === 'pending' ||
      res.status === 'confirmed' ||
      res.status === 'checked_in' ? (
        <Card>
          <CardHeader>
            <CardTitle>Advance</CardTitle>
          </CardHeader>
          <CardContent>
            <AdvancePayments
              propertyId={propertyId}
              reservationId={reservationId}
              context="stay"
              status={res.status}
            />
          </CardContent>
        </Card>
      ) : null}
      <FrontOfficeEditor
        reservationId={reservationId}
        frontOfficeComment={res.frontOfficeComment}
        vipFlag={res.vipFlag}
        dndFlag={res.dndFlag}
        sourceCode={res.sourceCode}
        marketSegmentCode={res.marketSegmentCode}
        disabled={isTerminalStay(res.status)}
      />
      {modifyOpen && draft ? (
        <FormDialog title="Modify stay" onClose={() => setModifyOpen(false)} actions={
          <>
          <Button type="button" onClick={() => setModifyOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            intent="primary"
            data-testid="modify-save"
            disabled={modify.isPending}
            onClick={() => {
              if (draft.departureDate <= draft.arrivalDate) {
                setModifyError('Departure must be after arrival.');
                return;
              }
              modify.mutate(draft);
            }}
          >
            Save
          </Button>
          </>
        }>
          <Field
            label="Arrival"
            control={
              <Input
                type="date"
                data-testid="modify-arrival"
                value={draft.arrivalDate}
                onChange={(e) => setDraft({ ...draft, arrivalDate: e.target.value })}
              />
            }
          />
          <Field
            label="Departure"
            control={
              <Input
                type="date"
                data-testid="modify-departure"
                value={draft.departureDate}
                onChange={(e) => setDraft({ ...draft, departureDate: e.target.value })}
              />
            }
          />
          <Field
            label="Room type"
            control={
              <NativeSelect
                data-testid="modify-room-type"
                value={draft.roomTypeId}
                onChange={(e) => setDraft({ ...draft, roomTypeId: e.target.value })}
              >
                {roomTypes.some((t) => t.roomTypeId === draft.roomTypeId) ? null : (
                  <option value={draft.roomTypeId}>{draft.roomTypeId}</option>
                )}
                {roomTypes.map((t) => (
                  <option key={t.roomTypeId} value={t.roomTypeId}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Adults"
            control={
              <Input
                type="number"
                data-testid="modify-adults"
                value={String(draft.adults)}
                onChange={(e) => setDraft({ ...draft, adults: Number(e.target.value) })}
              />
            }
          />
          <Field
            label="Children"
            control={
              <Input
                type="number"
                data-testid="modify-children"
                value={String(draft.children)}
                onChange={(e) => setDraft({ ...draft, children: Number(e.target.value) })}
              />
            }
          />
          <Field
            label="Rate plan"
            control={
              <NativeSelect
                data-testid="modify-rate-plan"
                value={draft.ratePlanId ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, ratePlanId: e.target.value || undefined })
                }
              >
                {draft.ratePlanId && !plans.some((p) => p.ratePlanId === draft.ratePlanId) ? (
                  <option value={draft.ratePlanId}>{draft.ratePlanId}</option>
                ) : null}
                {plans.map((p) => (
                  <option key={p.ratePlanId} value={p.ratePlanId}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {modifyError ? <Alert>{modifyError}</Alert> : null}
        </FormDialog>
      ) : null}
      {changeOpen && changeDraft && res ? (
        <FormDialog
          title="Change stay"
          onClose={() => setChangeOpen(false)}
          actions={
            <>
              <Button type="button" onClick={() => setChangeOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                intent="primary"
                data-testid="change-stay-save"
                disabled={changeStay.isPending || !changeDraft.reason.trim()}
                onClick={() => changeStay.mutate(changeDraft)}
              >
                Save
              </Button>
            </>
          }
        >
          {changeDraft.departureDate < res.departureDate ? (
            <Alert intent="informational" data-testid="change-stay-early-depart">
              To shorten the stay use Early departure.{' '}
              <Link to={`/folio/${encodeURIComponent(res.reservationId)}`}>Open folio</Link>
            </Alert>
          ) : null}
          <Field
            label="Departure"
            control={
              <Input
                type="date"
                data-testid="change-departure"
                min={res.departureDate}
                value={changeDraft.departureDate}
                onChange={(e) => setChangeDraft({ ...changeDraft, departureDate: e.target.value })}
              />
            }
          />
          <Field
            label="Room type"
            control={
              <NativeSelect
                data-testid="change-room-type"
                value={changeDraft.roomTypeId}
                onChange={(e) =>
                  setChangeDraft({
                    ...changeDraft,
                    roomTypeId: e.target.value,
                    roomId: e.target.value === res.roomTypeId ? (res.roomId ?? '') : '',
                  })
                }
              >
                {roomTypes.map((t) => (
                  <option key={t.roomTypeId} value={t.roomTypeId}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          {changeDraft.roomTypeId !== res.roomTypeId ? (
            <Field
              label="Room"
              control={
                <NativeSelect
                  data-testid="change-room"
                  value={changeDraft.roomId}
                  onChange={(e) => setChangeDraft({ ...changeDraft, roomId: e.target.value })}
                >
                  <option value="">Select a room</option>
                  {(availableRoomsQ.data?.rooms ?? [])
                    .filter(
                      (room) =>
                        room.roomId !== res.roomId &&
                        (room.status === 'clean' || room.status === 'inspected'),
                    )
                    .map((room) => (
                      <option key={room.roomId} value={room.roomId}>
                        {room.code}
                      </option>
                    ))}
                </NativeSelect>
              }
            />
          ) : null}
          <Field
            label="Rate plan"
            control={
              <NativeSelect
                data-testid="change-rate-plan"
                value={changeDraft.ratePlanId}
                onChange={(e) => setChangeDraft({ ...changeDraft, ratePlanId: e.target.value })}
              >
                {plans.map((p) => (
                  <option key={p.ratePlanId} value={p.ratePlanId}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
          <Field
            label="Adults"
            control={
              <Input
                type="number"
                data-testid="change-adults"
                value={String(changeDraft.adults)}
                onChange={(e) => setChangeDraft({ ...changeDraft, adults: Number(e.target.value) })}
              />
            }
          />
          <Field
            label="Children"
            control={
              <Input
                type="number"
                data-testid="change-children"
                value={String(changeDraft.children)}
                onChange={(e) => setChangeDraft({ ...changeDraft, children: Number(e.target.value) })}
              />
            }
          />
          <Field
            label="Reason"
            control={
              <Input
                data-testid="change-reason"
                value={changeDraft.reason}
                onChange={(e) => setChangeDraft({ ...changeDraft, reason: e.target.value })}
              />
            }
          />
          {(() => {
            const readyRooms = (availableRoomsQ.data?.rooms ?? []).filter(
              (room) =>
                room.roomId !== res.roomId &&
                (room.status === 'clean' || room.status === 'inspected'),
            );
            const preview = inHouseChangePreview(
              {
                departureDate: res.departureDate,
                roomTypeId: res.roomTypeId,
                ratePlanId: res.ratePlanId ?? '',
                adults: res.adults ?? 1,
                children: res.children ?? 0,
              },
              changeDraft,
              {
                roomTypeName: roomTypes.find((t) => t.roomTypeId === changeDraft.roomTypeId)?.name,
                roomCode: readyRooms.find((r) => r.roomId === changeDraft.roomId)?.code,
                ratePlanName: plans.find((p) => p.ratePlanId === changeDraft.ratePlanId)?.name,
                formatDate: date,
              },
            );
            return preview ? (
              <p className="muted" data-testid="change-stay-preview">
                {preview}
              </p>
            ) : null;
          })()}
          {changeError ? <Alert>{changeError}</Alert> : null}
        </FormDialog>
      ) : null}
      {cancelOpen ? (
        <ConfirmDialog
          title="Cancel this reservation?"
          description={cancelChargeSentence(res.cancellation?.cancelNowMinor, money, res.cancellation?.currency)}
          confirmLabel="Cancel reservation"
          intent="destructive"
          onCancel={() => setCancelOpen(false)}
          onConfirm={() => cancel.mutate()}
        />
      ) : null}
      {noShowOpen ? (
        <ConfirmDialog
          title="Mark this stay as a no-show?"
          description={noShowChargeSentence(res.cancellation?.noShowMinor, money, res.cancellation?.currency)}
          confirmLabel="Mark no-show"
          intent="destructive"
          onCancel={() => setNoShowOpen(false)}
          onConfirm={() => noShow.mutate()}
        />
      ) : null}
      {cancelCheckInOpen ? (
        <ConfirmDialog
          title="Cancel check-in?"
          description="The guest goes back to Confirmed. The room stays assigned and the folio is kept."
          confirmLabel="Cancel check-in"
          intent="destructive"
          onCancel={() => setCancelCheckInOpen(false)}
          onConfirm={() => cancelCheckIn.mutate()}
        />
      ) : null}
    </div>
  );
}

function StayCard({
  res,
  guestState,
  guestRef,
  roomTypeName,
  roomCode,
  ratePlanName,
  dateRange,
  dateTime,
  money,
  preferences,
}: {
  res: ReservationRead;
  guestState: GuestRowState | undefined;
  guestRef: string;
  roomTypeName?: string;
  roomCode: string | null;
  ratePlanName?: string;
  dateRange: (from: string, to: string) => string;
  dateTime: (ms: number) => string;
  money: (minor: number, currency?: string) => string;
  preferences?: GuestPreferences;
}) {
  const nights = stayNights(res.arrivalDate, res.departureDate);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stay</CardTitle>
      </CardHeader>
      <CardContent>
        <>
          <div className="ui-row">
            <GuestNameLink state={guestState} guestRef={guestRef} />
            {isReservationStatus(res.status) ? (
              <StatusBadge status={res.status} />
            ) : (
              reservationStatusLabel(res.status)
            )}
          </div>
          <GuestDocumentBadges propertyId={tenant.propertyId} guestRef={guestRef} />
          <GuestPreferenceBadges preferences={preferences} />
          <div className="ui-stat-grid">
            <StatField
              label="Dates"
              value={`${dateRange(res.arrivalDate, res.departureDate)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`}
            />
            <StatField label="Room type" value={roomTypeName || res.roomTypeId} />
            <StatField label="Room" value={res.roomId == null ? 'Not assigned' : roomCode || res.roomId} />
            <StatField label="Adults" value={String(res.adults ?? 1)} />
            <StatField label="Children" value={String(res.children ?? 0)} />
            <StatField label="Rate plan" value={ratePlanName || res.ratePlanId || '—'} />
            <StatField label="Source" value={res.sourceCode || '—'} />
            <StatField label="Segment" value={res.marketSegmentCode || '—'} />
            <StatField label="Reference" value={res.reservationId} />
            <StatField label="Created" value={dateTime(res.createdAt)} />
            <StatField label="Updated" value={dateTime(res.updatedAt)} />
          </div>
          {CANCELLABLE.has(res.status) ? (
            <p data-testid="cancellation-policy">
              {cancellationPolicySentence(res.cancellation, money, dateTime, Date.now())}
            </p>
          ) : null}
        </>
      </CardContent>
    </Card>
  );
}

function DamagePanel({
  reservationId,
  loading,
  error,
  holds,
  money,
}: {
  reservationId: string;
  loading: boolean;
  error: boolean;
  holds: FolioPaymentRow[];
  money: (minor: number, currency?: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Damage deposit</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton label="Loading damage deposit" lines={2} />
        ) : error ? (
          <Alert>Couldn't load payments for this stay.</Alert>
        ) : holds.length === 0 ? (
          <p className="muted">No damage deposit hold.</p>
        ) : (
          <div className="ui-stack">
            {holds.map((hold) => (
              <p key={hold.paymentId} data-testid={`damage-hold-${hold.paymentId}`}>
                {money(hold.amountMinor, hold.currency)} · {damageHoldWord(hold.status)}
              </p>
            ))}
          </div>
        )}
        <p>
          <Link to={`/folio/${encodeURIComponent(reservationId)}`}>Manage on folio</Link>
        </p>
      </CardContent>
    </Card>
  );
}

function StayActions({
  res,
  roomCode,
  businessDate,
  message,
  pending,
  canChangeInHouse,
  onConfirm,
  onModify,
  onChangeStay,
  onCancel,
  onNoShow,
  onCancelCheckIn,
}: {
  res: ReservationRead;
  roomCode: string | null | undefined;
  businessDate: string | null;
  message: StayMessage | null;
  pending: boolean;
  canChangeInHouse: boolean;
  onConfirm: () => void;
  onModify: () => void;
  onChangeStay: () => void;
  onCancel: () => void;
  onNoShow: () => void;
  onCancelCheckIn: () => void;
}) {
  const status = res.status;
  const terminal = isTerminalStay(status);
  const checkInReason = checkInBlockReason(status);
  const noShowReason = noShowBlockReason(res.arrivalDate, businessDate);
  const showConfirm = status === 'inquiry' || status === 'pending';
  const showModify = showConfirm || status === 'confirmed';
  const showChangeStay = status === 'checked_in' && canChangeInHouse;
  const showCancel = showConfirm || status === 'confirmed';
  const showNoShow = status === 'confirmed';
  const showCheckIn = showConfirm || status === 'confirmed';
  const showCancelCheckIn = status === 'checked_in';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="ui-stack">
          {terminal ? (
            <Alert intent="informational">
              This reservation is {reservationStatusLabel(status)} and can't be changed.
            </Alert>
          ) : null}
          {message ? (
            <Alert intent={message.intent} data-testid="stay-message">
              {message.text}
            </Alert>
          ) : null}
          {res.roomId && !terminal ? (
            <div className="ui-row" data-testid="stay-guest-request">
              <span className="muted">Guest request</span>
              <RowActions>
                <GuestRequestButton
                  roomId={res.roomId}
                  roomCode={roomCode ?? undefined}
                  reservationId={res.reservationId}
                />
              </RowActions>
            </div>
          ) : null}
          <div className="ui-row" data-testid="stay-documents">
            <span className="muted">Documents</span>
            <RowActions>
              <Link
                className="ui-link-btn"
                to={`/reservations/${encodeURIComponent(res.reservationId)}/proforma`}
              >
                Proforma
              </Link>
              <Link
                className="ui-link-btn"
                to={`/reservations/${encodeURIComponent(res.reservationId)}/registration-card`}
              >
                Registration card
              </Link>
            </RowActions>
          </div>
          <div className="ui-row">
            <Link className="ui-link-btn" to={`/folio/${encodeURIComponent(res.reservationId)}`}>
              Folio
            </Link>
            {showCheckIn && checkInReason == null ? (
              <Link
                className="ui-link-btn ui-link-btn--primary"
                data-testid="stay-check-in"
                to={`/check-in/${encodeURIComponent(res.reservationId)}`}
              >
                Check in
              </Link>
            ) : null}
            {showCheckIn && checkInReason ? (
              <>
                <Button type="button" data-testid="stay-check-in" disabled aria-describedby="stay-check-in-reason">
                  Check in
                </Button>
                <p className="muted" id="stay-check-in-reason">
                  {checkInReason}
                </p>
              </>
            ) : null}
            {showConfirm ? (
              <Button type="button" intent="primary" data-testid="stay-confirm" disabled={pending} onClick={onConfirm}>
                Confirm
              </Button>
            ) : null}
            {showModify ? (
              <Button
                type="button"
                data-testid="stay-modify"
                disabled={pending}
                onClick={onModify}
              >
                Modify
              </Button>
            ) : null}
            {showChangeStay ? (
              <Button
                type="button"
                intent="primary"
                data-testid="stay-change-stay"
                disabled={pending}
                onClick={onChangeStay}
              >
                Change stay
              </Button>
            ) : null}
            {showCancel ? (
              <Button
                type="button"
                intent="destructive"
                data-testid="stay-cancel"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </Button>
            ) : null}
            {showNoShow ? (
              <>
                <Button
                  type="button"
                  intent="destructive"
                  data-testid="stay-no-show"
                  disabled={pending || noShowReason != null}
                  aria-describedby={noShowReason ? 'stay-no-show-reason' : undefined}
                  onClick={onNoShow}
                >
                  No-show
                </Button>
                {noShowReason ? (
                  <p className="muted" id="stay-no-show-reason">
                    {noShowReason}
                  </p>
                ) : null}
              </>
            ) : null}
            {showCancelCheckIn ? (
              <Button
                type="button"
                intent="destructive"
                data-testid="stay-cancel-check-in"
                disabled={pending}
                onClick={onCancelCheckIn}
              >
                Cancel check-in
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
