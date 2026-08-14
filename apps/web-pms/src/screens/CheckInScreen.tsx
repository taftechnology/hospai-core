import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, NativeSelect } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { FrontOfficeEditor } from './front-office-editor.js';
import { PrintRegCardControl, RegistrationCard } from './registration-card.js';

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

const TERMINAL_STATUSES = new Set(['cancelled', 'checked_out', 'no_show']);

export function CheckInScreen() {
  const { reservationId = '' } = useParams();
  const [roomId, setRoomId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideCleanliness, setOverrideCleanliness] = useState(false);

  const reservationQ = useQuery({
    queryKey: ['reservation', tenant.propertyId, reservationId],
    queryFn: () => api.getReservation(tenant.propertyId, reservationId),
    enabled: Boolean(reservationId),
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

  useEffect(() => {
    const preassigned = reservationQ.data?.roomId;
    if (preassigned && !roomId) setRoomId(preassigned);
  }, [reservationQ.data?.roomId, roomId]);

  const assign = useMutation({
    mutationFn: () =>
      api.assignRoom(tenant.propertyId, reservationId, roomId, `assign:${reservationId}:${roomId}`),
    onError: (err) => {
      const c = asClassified(err);
      if (c.class === 'fail_closed') {
        setMessage('Room assignment refused — property unreachable.');
        return;
      }
      setMessage(`Assign failed (${c.class})`);
    },
    onSuccess: () => setMessage('Room assigned'),
  });

  const checkIn = useMutation({
    mutationFn: () =>
      api.checkIn(
        tenant.propertyId,
        reservationId,
        `checkin:${reservationId}:${roomId}:${overrideCleanliness ? '1' : '0'}`,
        { roomId, ...(overrideCleanliness ? { overrideCleanliness: true } : {}) },
      ),
    onError: (err) => {
      const c = asClassified(err);
      if (bodyErrorCode(c.body) === 'room_not_ready') {
        setShowOverride(true);
        setMessage('Room is not ready. Override cleanliness if allowed.');
        return;
      }
      if (c.class === 'queue_unavailable') {
        setMessage('Check-in could not be queued — queue unavailable.');
        return;
      }
      if (c.class === 'fail_closed') {
        setMessage('Check-in refused.');
        return;
      }
      setMessage(`Check-in failed (${c.class})`);
    },
    onSuccess: (result) => {
      if (result.classified.class === 'provisional') {
        setMessage('Check-in queued (provisional). See session log below.');
        return;
      }
      setMessage('Checked in');
    },
  });

  const canCheckIn = roomId.trim().length > 0 && !checkIn.isPending;
  const guestState = guestRef ? guestsQ.data?.states[guestRef] : undefined;
  const guestResolved = guestState?.kind === 'resolved';
  const canPrint = reservationQ.isSuccess && guestResolved;
  const displayName = guestState?.kind === 'resolved' ? guestState.displayName : null;
  const adults = reservationQ.data?.adults ?? 1;
  const children = reservationQ.data?.children ?? 0;
  const editorDisabled = Boolean(
    reservationQ.data && TERMINAL_STATUSES.has(reservationQ.data.status),
  );
  const rooms = roomsQ.data?.rooms ?? [];
  const typedRooms = reservationQ.data?.roomTypeId
    ? rooms.filter((r) => r.roomTypeId === reservationQ.data?.roomTypeId)
    : rooms;
  const roomOptions = typedRooms.length > 0 ? typedRooms : rooms;
  const selectedCode = rooms.find((r) => r.roomId === roomId)?.code;

  return (
    <div className="panel">
      <p>
        <Link to="/arrivals">← Arrivals</Link>
      </p>
      <h1>Check in {reservationId}</h1>
      <p className="muted">A room is required to check in.</p>
      {reservationQ.isSuccess ? (
        <p>
          Adults {adults} · Children {children}
        </p>
      ) : null}
      <div className="stack-row">
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
        <Button type="button" disabled={!roomId || assign.isPending} onClick={() => assign.mutate()}>
          Assign room
        </Button>
        <Button
          type="button"
          intent="primary"
          data-testid="check-in"
          disabled={!canCheckIn}
          onClick={() => checkIn.mutate()}
        >
          Check in
        </Button>
      </div>
      {showOverride ? (
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
      {message ? <p>{message}</p> : null}
      {reservationQ.isSuccess ? (
        <FrontOfficeEditor
          reservationId={reservationId}
          frontOfficeComment={reservationQ.data.frontOfficeComment}
          vipFlag={reservationQ.data.vipFlag}
          dndFlag={reservationQ.data.dndFlag}
          disabled={editorDisabled}
        />
      ) : null}
      <PrintRegCardControl canPrint={canPrint} />
      <RegistrationCard
        propertyName={propertyQ.data?.property?.name ?? null}
        reservation={reservationQ.data}
        displayName={displayName}
        roomLabel={selectedCode ?? null}
      />
    </div>
  );
}
