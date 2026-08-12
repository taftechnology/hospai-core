import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import {
  filterNavEntries,
  meShellStateFromQuery,
  type Authority,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { ExceptionsPanel } from '../screens/ExceptionsPanel.js';
import { ALL_NAV } from './module-ui-registry.js';
import { PropertyTimeZoneProvider } from './PropertyTimeZone.js';
import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';
import { ShiftStrip } from './ShiftStrip.js';

export function AppShell() {
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

  useEffect(() => {
    if (shell.kind === 'unauthorized') {
      window.location.assign('/sign-in');
    }
  }, [shell.kind]);

  if (shell.kind === 'unauthorized') {
    return null;
  }

  if (shell.kind === 'no_access') {
    return (
      <div className="app-shell">
        <header className="top-bar">
          <strong>HospAI</strong>
        </header>
        <main className="main">
          <div className="error" role="alert" data-testid="me-no-access">
            You don&apos;t have access to this property.
          </div>
        </main>
      </div>
    );
  }

  const authority: Authority = shell.authority;
  const navEntries = filterNavEntries(ALL_NAV, authority);

  return (
    <PropertyTimeZoneProvider>
      <div className="app-shell">
        <header className="top-bar">
          <strong>HospAI</strong>
          <nav className="nav" aria-label="Front desk">
            {navEntries.map((entry) => (
              <NavLink key={entry.id} to={entry.path} end>
                {entry.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <ShiftStrip authority={authority} />
        <main className="main">
          <Outlet />
        </main>
        <div className="side-panels">
          <QueuedCommandsPanel />
          <ExceptionsPanel />
        </div>
      </div>
    </PropertyTimeZoneProvider>
  );
}
