import { useQuery } from '@tanstack/react-query';
import { HousekeepingApp as HousekeepingBoard } from '@hospai/pms-housekeeping/ui';
import { hasPropertyPermission, type PropertyMe } from '../auth/me.js';
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

  const me = meQuery.data as PropertyMe | undefined;
  const canAssign = Boolean(me && hasPropertyPermission(me, 'housekeeping:write'));

  return (
    <HousekeepingBoard
      propertyId={propertyId}
      defaultBusinessDate={defaultBusinessDate}
      api={api}
      canAssign={canAssign}
      classifyError={(err) => asClassified(err)}
    />
  );
}
