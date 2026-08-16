import { useQuery } from '@tanstack/react-query';
import { HousekeepingApp as HousekeepingBoard } from '@hospai/pms-housekeeping/ui';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';

export function HousekeepingScreen() {
  const timeZone = usePropertyTimeZone();
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

  return (
    <HousekeepingBoard
      propertyId={propertyId}
      defaultBusinessDate={defaultBusinessDate}
      api={api}
      canAssign={canAssign}
      canReadRoster={canReadRoster}
      canSetOoo={canSetOoo}
      classifyError={(err) => asClassified(err)}
    />
  );
}
