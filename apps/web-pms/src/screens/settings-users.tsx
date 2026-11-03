import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@hospai/ui-kit';
import { api, asClassified, tenant } from '../client.js';
import { hasPropertyPermission, meShellStateFromQuery } from '../auth/me.js';

export function SettingsUsersTab() {
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

  if (shell.kind === 'no_access' || shell.kind === 'unauthorized') {
    return (
      <Card>
        <CardContent>
          <EmptyState title="You do not have access to staff management for this property." />
        </CardContent>
      </Card>
    );
  }

  if (shell.authority.kind === 'pending') {
    return (
      <Card>
        <CardContent>
          <Skeleton label="Loading staff access" lines={3} />
        </CardContent>
      </Card>
    );
  }

  const failOpen = shell.authority.kind === 'unknown';
  const staffRead =
    failOpen ||
    (shell.authority.kind === 'live' && hasPropertyPermission(shell.authority.me, 'staff:read'));
  const rosterRead =
    failOpen ||
    (shell.authority.kind === 'live' && hasPropertyPermission(shell.authority.me, 'roster:read'));

  if (!staffRead && !rosterRead) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="You do not have access to staff management for this property." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff accounts</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          Staff accounts, roles, and rosters are managed on the Staff and Roster screens — not here.
        </p>
        <div className="ui-stack">
          {staffRead ? (
            <Link className="ui-link-btn" to="/staff">
              Open Staff
            </Link>
          ) : null}
          {rosterRead ? (
            <Link className="ui-link-btn" to="/roster">
              Open Roster
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
