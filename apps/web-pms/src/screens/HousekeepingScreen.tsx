import { useQuery } from '@tanstack/react-query';
import { HousekeepingApp as HousekeepingBoard } from '@hospai/pms-housekeeping/ui';
import { useLocation } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { isQueuedResult, queuedWriteCopy } from '../copy/is-queued-result.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { useFormat, usePropertyTimeZone } from '../shell/PropertyFormat.js';

export function HousekeepingScreen() {
  const timeZone = usePropertyTimeZone();
  const { dateHeading, dateTime } = useFormat();
  const defaultBusinessDate = timeZone
    ? propertyLocalToday(timeZone)
    : new Date().toISOString().slice(0, 10);
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
  const path = useLocation().pathname;
  const priority = path.endsWith('/priority');
  const inventory = path.endsWith('/inventory');
  const { subtitle } = usePropertySubtitle(
    inventory ? 'Par levels and stock counts' : priority ? 'Cleaning queue' : 'Room status and assignments',
  );

  return (
    <HousekeepingBoard
      propertyId={propertyId}
      defaultBusinessDate={defaultBusinessDate}
      api={api}
      canAssign={canAssign}
      canReadRoster={canReadRoster}
      canSetOoo={canSetOoo}
      subtitle={subtitle}
      classifyError={(err) => asClassified(err)}
      format={{ dateHeading, dateTime }}
      formatError={(err) =>
        classifiedUserMessage(asClassified(err), {
          fallback: inventory
            ? 'Could not load housekeeping inventory'
            : priority
              ? 'Could not load housekeeping priority'
              : 'Could not load housekeeping',
        })
      }
      isQueuedResult={isQueuedResult}
      queuedCopy={queuedWriteCopy()}
    />
  );
}
