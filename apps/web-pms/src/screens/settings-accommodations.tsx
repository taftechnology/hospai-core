import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@hospai/ui-kit';
import type { PropertyScopedPermission as Permission } from '@hospai/contracts';
import { api, asClassified, tenant } from '../client.js';
import { hasPropertyPermission, meShellStateFromQuery } from '../auth/me.js';

type Destination = {
  id: string;
  title: string;
  description: string;
  to: string;
  linkLabel: string;
  /** Every permission the destination route needs to open and to edit there. */
  needs: Permission[];
};

/**
 * R1.18: accommodations are edited on the Inventory and Housekeeping screens. This tab only
 * points there — it is not a second editor. Floors are a field on each room; out-of-order is
 * set and released on the Housekeeping board. No amenities, spaces or split inventory yet.
 */
const DESTINATIONS: Destination[] = [
  {
    id: 'types',
    title: 'Room types',
    description: 'Codes, names, occupancy and how many rooms of each type you sell.',
    to: '/inventory',
    linkLabel: 'Open room types',
    needs: ['inventory:write'],
  },
  {
    id: 'rooms',
    title: 'Rooms and floors',
    description: 'Room numbers and the floor each room is on. Out-of-order dates show per room.',
    to: '/inventory/rooms',
    linkLabel: 'Open rooms',
    needs: ['inventory:write'],
  },
  {
    id: 'ooo',
    title: 'Out of order',
    description: 'Take a room out of order for a date range, or release it early, on the Housekeeping board.',
    to: '/housekeeping',
    linkLabel: 'Open housekeeping',
    needs: ['housekeeping:read', 'inventory:write'],
  },
];

const PERMISSION_WORDS: Partial<Record<Permission, string>> = {
  'inventory:write': 'inventory',
  'housekeeping:read': 'housekeeping',
};

export function SettingsAccommodationsTab() {
  const propertyId = tenant.propertyId;
  const meQ = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const shell = meShellStateFromQuery({
    status: meQ.status,
    data: meQ.data,
    classified: meQ.isError ? asClassified(meQ.error) : undefined,
  });

  if (shell.kind === 'authority' && shell.authority.kind === 'pending') {
    return <Skeleton label="Loading accommodations" lines={3} />;
  }

  // Same rule as the Users tab: an unknown authority shows the links and the route decides.
  const allowed = (needs: Permission[]): boolean => {
    if (shell.kind !== 'authority') return false;
    if (shell.authority.kind === 'unknown') return true;
    if (shell.authority.kind !== 'live') return false;
    const me = shell.authority.me;
    return needs.every((p) => hasPropertyPermission(me, p));
  };

  return (
    <Card data-testid="settings-accommodations">
      <CardHeader>
        <CardTitle>Accommodations</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="muted">
          Room types, rooms and out-of-order dates are edited on the Inventory and Housekeeping
          screens, not here.
        </p>
        <div className="ui-stack">
          {DESTINATIONS.map((d) => {
            const ok = allowed(d.needs);
            const missing = d.needs.map((p) => PERMISSION_WORDS[p] ?? p).join(' and ');
            return (
              <div key={d.id} data-testid={`accommodations-${d.id}`}>
                <strong>{d.title}</strong>
                <p className="muted">{d.description}</p>
                {ok ? (
                  <Link className="ui-link-btn" to={d.to}>
                    {d.linkLabel}
                  </Link>
                ) : (
                  <p className="muted">Needs {missing} access. Ask a manager.</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
