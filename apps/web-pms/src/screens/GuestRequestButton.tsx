import { useQuery } from '@tanstack/react-query';
import { GuestRequestDialog } from '@hospai/pms-housekeeping/ui';
import { Button } from '@hospai/ui-kit';
import { useState } from 'react';
import { hasPropertyPermission } from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { propertyLocalToday } from '../status/property-local-today.js';

/**
 * Desk entry to R4.11 guest requests: opens the create dialog with the room and the stay fixed.
 * Needs housekeeping access; without it the button is disabled and says why.
 */
export function GuestRequestButton({
  roomId,
  roomCode,
  reservationId,
}: {
  roomId: string;
  /** Shown in the dialog title. Falls back to a plain word while the room list loads. */
  roomCode: string | undefined;
  reservationId: string;
}) {
  const [open, setOpen] = useState(false);
  const timeZone = usePropertyTimeZone();
  const propertyId = tenant.propertyId;
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const allowed =
    Boolean(meQ.data) &&
    hasPropertyPermission(meQ.data!, 'housekeeping:write') &&
    hasPropertyPermission(meQ.data!, 'housekeeping:read');
  const canReadRoster = Boolean(meQ.data) && hasPropertyPermission(meQ.data!, 'roster:read');
  // Empty until the property time zone is known: the dialog never guesses from the browser clock.
  const businessDate = timeZone ? propertyLocalToday(timeZone) : '';

  return (
    <>
      <Button
        type="button"
        data-testid="guest-request"
        disabled={!allowed || !businessDate}
        onClick={() => setOpen(true)}
      >
        Guest request
      </Button>
      {!allowed && meQ.isSuccess ? (
        <span className="muted" data-testid="guest-request-denied">
          Guest requests need housekeeping access.
        </span>
      ) : null}
      {open ? (
        <GuestRequestDialog
          propertyId={propertyId}
          api={api}
          roomId={roomId}
          roomCode={roomCode ?? 'this room'}
          reservationId={reservationId}
          defaultBusinessDate={businessDate}
          canReadRoster={canReadRoster}
          formatError={(err) =>
            classifiedUserMessage(asClassified(err), { fallback: 'Could not log the guest request.' })
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
