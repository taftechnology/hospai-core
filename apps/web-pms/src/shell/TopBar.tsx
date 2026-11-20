import { useQuery } from '@tanstack/react-query';
import { hasPropertyPermission, type Authority } from '../auth/me.js';
import { api, tenant } from '../client.js';
import { CalendarIcon } from './icons.js';
import { GlobalSearch } from './GlobalSearch.js';
import { useFormat } from './PropertyFormat.js';
import { usePropertyBusinessDate } from './use-business-date.js';
import { ShiftStrip } from './ShiftStrip.js';

export function TopBar({ authority }: { authority: Authority }) {
  const propertyId = tenant.propertyId;
  const { date } = useFormat();
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const propertyName = propertyQ.data?.property?.name;
  // The open business date from the property read; nothing while loading or unreachable.
  const businessDate = usePropertyBusinessDate();
  const canSearch =
    authority.kind === 'live' && hasPropertyPermission(authority.me, 'reservations:read');

  return (
    <header className="top-bar">
      <div className="top-bar__search">{canSearch ? <GlobalSearch /> : null}</div>
      <ShiftStrip authority={authority} />
      <div className="top-bar__spacer" />
      {propertyName ? <span data-testid="property-name">{propertyName}</span> : null}
      {businessDate ? (
        <span className="chip" data-testid="business-date-chip">
          <CalendarIcon size={12} /> Business date: {date(businessDate)}
        </span>
      ) : null}
    </header>
  );
}
