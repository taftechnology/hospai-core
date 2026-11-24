import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NativeSelect, VisuallyHidden } from '@hospai/ui-kit';
import { hasPropertyPermission, type Authority } from '../auth/me.js';
import { api, tenant } from '../client.js';
import { CalendarIcon } from './icons.js';
import { GlobalSearch } from './GlobalSearch.js';
import { useFormat } from './PropertyFormat.js';
import { usePropertyBusinessDate } from './use-business-date.js';
import { ShiftStrip } from './ShiftStrip.js';
import { useTenantSwitcher } from './tenant-context.js';

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
  const switcher = useTenantSwitcher();
  const orgSelectId = useId();
  const hotelSelectId = useId();
  const activeOrg = switcher?.orgs.find((o) => o.orgId === switcher.active.orgId);
  // R4.4: the hotel switcher shows only on a multi-property plan with more than one hotel.
  const showHotelSelect = !!switcher && !!activeOrg && activeOrg.multiProperty && activeOrg.properties.length > 1;
  const showOrgSelect = !!switcher && switcher.orgs.length > 1;
  const canSearch =
    authority.kind === 'live' && hasPropertyPermission(authority.me, 'reservations:read');

  return (
    <header className="top-bar">
      <div className="top-bar__search">{canSearch ? <GlobalSearch /> : null}</div>
      <ShiftStrip authority={authority} />
      <div className="top-bar__spacer" />
      {switcher && showOrgSelect ? (
        <>
          <VisuallyHidden>
            <label htmlFor={orgSelectId}>Organisation</label>
          </VisuallyHidden>
          <NativeSelect
            id={orgSelectId}
            data-testid="org-switcher"
            value={switcher.active.orgId}
            onChange={(e) => {
              const org = switcher.orgs.find((o) => o.orgId === e.target.value);
              const first = org?.properties[0];
              if (org && first) switcher.switchTenant({ orgId: org.orgId, propertyId: first.propertyId });
            }}
          >
            {switcher.orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name ?? o.orgId}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : null}
      {switcher && activeOrg && showHotelSelect ? (
        <>
          <VisuallyHidden>
            <label htmlFor={hotelSelectId}>Hotel</label>
          </VisuallyHidden>
          <NativeSelect
            id={hotelSelectId}
            data-testid="property-switcher"
            value={switcher.active.propertyId}
            onChange={(e) =>
              switcher.switchTenant({ orgId: switcher.active.orgId, propertyId: e.target.value })
            }
          >
            {activeOrg.properties.map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : propertyName ? (
        <span data-testid="property-name" title={propertyName}>
          {propertyName}
        </span>
      ) : null}
      {businessDate ? (
        <span className="chip" data-testid="business-date-chip">
          <CalendarIcon size={12} /> Business date: {date(businessDate)}
        </span>
      ) : null}
    </header>
  );
}
