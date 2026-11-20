import { useQuery } from '@tanstack/react-query';
import { HousekeepingApp as HousekeepingBoard, type HousekeepingGuests } from '@hospai/pms-housekeeping/ui';
import { useMemo } from 'react';
import { useLocation } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { fetchGuestStatesChunked } from '../guest-batch-chunked.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { guestLabel } from './guest-row.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';
import { usePropertyActorLabel } from '../status/use-property-actor-label.js';

export function HousekeepingScreen() {
  const timeZone = usePropertyTimeZone();
  const { date, dateHeading, dateTime } = useFormat();
  // Empty until the property time zone is known: the views wait for it rather than guess from the browser.
  const defaultBusinessDate = timeZone ? propertyLocalToday(timeZone) : '';
  const propertyId = tenant.propertyId;

  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });

  const shell = meShellStateFromQuery({
    status: meQuery.status,
    data: meQuery.data as PropertyMe | undefined,
    classified: meQuery.isError ? asClassified(meQuery.error) : undefined,
  });

  const liveMe =
    shell.kind === 'authority' && shell.authority.kind === 'live'
      ? shell.authority.me
      : undefined;

  const canAssign = liveMe ? hasPropertyPermission(liveMe, 'housekeeping:write') : false;
  const canReadRoster = liveMe ? hasPropertyPermission(liveMe, 'roster:read') : false;
  const canSetOoo = liveMe ? hasPropertyPermission(liveMe, 'inventory:write') : false;
  const canReadStaff = liveMe ? hasPropertyPermission(liveMe, 'staff:read') : false;
  const actorLabel = usePropertyActorLabel(canReadStaff);
  const canReadGuests = liveMe ? hasPropertyPermission(liveMe, 'guests:read') : false;
  // Names come only through the property-scoped batch and search (R4.11); never from housekeeping reads.
  const guests = useMemo<HousekeepingGuests | undefined>(
    () =>
      canReadGuests
        ? {
            labels: async (refs) => {
              const { states } = await fetchGuestStatesChunked(api.postGuestsBatch, propertyId, refs);
              return Object.fromEntries(refs.map((ref) => [ref, guestLabel(states[ref], ref)]));
            },
            search: async (q) => {
              const result = (await api.searchGuests(propertyId, { q })) as {
                body?: { items?: Array<{ guestId?: unknown; profile?: { displayName?: unknown } }> };
              };
              return (result.body?.items ?? []).flatMap((row) =>
                typeof row.guestId === 'string' && typeof row.profile?.displayName === 'string'
                  ? [{ guestRef: row.guestId, label: row.profile.displayName }]
                  : [],
              );
            },
          }
        : undefined,
    [canReadGuests, propertyId],
  );
  const path = useLocation().pathname;
  const priority = path.endsWith('/priority');
  const inventory = path.endsWith('/inventory');
  const tasks = path.endsWith('/tasks');
  const requests = path.endsWith('/requests');
  const lostFound = path.endsWith('/lost-found');
  const cases = path.endsWith('/cases');
  const inspections = path.endsWith('/inspections');
  const guestAudit = path.endsWith('/guest-audit');
  const { subtitle } = usePropertySubtitle(
    inventory
      ? 'Par levels and stock counts'
      : priority
        ? 'Cleaning queue'
        : tasks
          ? 'Tasks and attendants'
          : requests
            ? 'Guest requests by room'
            : lostFound
              ? 'Lost and found custody'
              : cases
                ? 'Missing and damaged items'
                : inspections
                  ? 'Scored room inspections'
                  : guestAudit
                    ? 'Front office against housekeeping counts'
                    : 'Room status and assignments',
  );

  return (
    <HousekeepingBoard
      propertyId={propertyId}
      defaultBusinessDate={defaultBusinessDate}
      api={api}
      canAssign={canAssign}
      canReadRoster={canReadRoster}
      canSetOoo={canSetOoo}
      guests={guests}
      actorLabel={actorLabel}
      subtitle={subtitle}
      classifyError={(err) => asClassified(err)}
      format={{ date, dateHeading, dateTime }}
      formatError={(err) =>
        classifiedUserMessage(asClassified(err), {
          fallback: inventory
            ? 'Could not load housekeeping inventory'
            : priority
              ? 'Could not load housekeeping priority'
              : tasks
                ? 'Could not load housekeeping tasks'
                : requests
                  ? 'Could not load guest requests'
                  : lostFound
                    ? 'Could not load lost and found'
                    : cases
                      ? 'Could not load missing and damaged cases'
                      : inspections
                        ? 'Could not load inspections'
                        : guestAudit
                          ? 'Could not load the guest audit'
                          : 'Could not load housekeeping',
        })
      }
      isQueuedResult={isQueuedResult}
      queuedCopy={queuedWriteCopy()}
    />
  );
}
