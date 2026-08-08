import { useMutation } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useState } from 'react';
import { api, asClassified, tenant } from '../client.js';

export function CheckInScreen() {
  const { reservationId = '' } = useParams();
  const [roomId, setRoomId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const assign = useMutation({
    mutationFn: () =>
      api.assignRoom(tenant.propertyId, reservationId, roomId, `assign:${reservationId}:${roomId}`),
    onError: (err) => {
      const c = asClassified(err);
      if (c.class === 'fail_closed') {
        setMessage('Room assignment refused — property unreachable. You can still queue check-in.');
        return;
      }
      setMessage(`Assign failed (${c.class})`);
    },
    onSuccess: () => setMessage('Room assigned'),
  });

  const checkIn = useMutation({
    mutationFn: () => api.checkIn(tenant.propertyId, reservationId, `checkin:${reservationId}`),
    onError: (err) => {
      const c = asClassified(err);
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

  return (
    <div className="panel">
      <p>
        <Link to="/arrivals">← Arrivals</Link>
      </p>
      <h1>Check in {reservationId}</h1>
      <p className="muted">
        Room assignment is optional. During an outage, assignment refuses and check-in can still
        queue.
      </p>
      <div className="stack-row">
        <input
          placeholder="room id"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <button type="button" disabled={!roomId || assign.isPending} onClick={() => assign.mutate()}>
          Assign room
        </button>
        <button type="button" disabled={checkIn.isPending} onClick={() => checkIn.mutate()}>
          Check in
        </button>
      </div>
      {message ? <p>{message}</p> : null}
    </div>
  );
}
