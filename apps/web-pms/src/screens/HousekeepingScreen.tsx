import { HousekeepingApp as HousekeepingBoard } from '@hospai/pms-housekeeping/ui';
import { api, asClassified, tenant } from '../client.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { usePropertyTimeZone } from '../shell/PropertyTimeZone.js';

export function HousekeepingScreen() {
  const timeZone = usePropertyTimeZone();
  const defaultBusinessDate = timeZone
    ? propertyLocalToday(timeZone)
    : new Date().toISOString().slice(0, 10);

  return (
    <HousekeepingBoard
      propertyId={tenant.propertyId}
      defaultBusinessDate={defaultBusinessDate}
      api={api}
      classifyError={(err) => asClassified(err)}
    />
  );
}
