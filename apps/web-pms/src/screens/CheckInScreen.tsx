import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import { api, asClassified, tenant } from '../client.js';

function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return null;
}

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

  return (
    <div className="panel">
      <p>
        <Link to="/arrivals">← Arrivals</Link>
      </p>
      <h1>Check in {reservationId}</h1>
      <p className="muted">A room is required to check in.</p>
      <div className="stack-row">
        <input
          placeholder="room id"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button type="button" disabled={!roomId || assign.isPending} onClick={() => assign.mutate()}>
          Assign room
        </button>
        <button
          type="button"
          data-testid="check-in"
          disabled={!canCheckIn}
          onClick={() => checkIn.mutate()}
        >
          Check in
        </button>
      </div>
      {showOverride ? (
        <label>
          <input
            type="checkbox"
            data-testid="override-cleanliness"
            checked={overrideCleanliness}
            onChange={(e) => setOverrideCleanliness(e.target.checked)}
          />{' '}
          Override cleanliness
        </label>
      ) : null}
      {message ? <p>{message}</p> : null}
    </div>
  );
}
