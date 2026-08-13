import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import {
  filterNavEntries,
  hasPropertyPermission,
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
import { FrontOfficeLive } from './FrontOfficeLive.js';

type SearchHit = {
  reservationId: string;
  guestRef?: string;
  displayName?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
};

function searchItems(result: unknown): SearchHit[] {
  if (!result || typeof result !== 'object') return [];
  const rec = result as { body?: { items?: unknown }; items?: unknown };
  const raw = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.body?.items)
      ? rec.body.items
      : [];
  return raw.filter(
    (row): row is SearchHit =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as SearchHit).reservationId === 'string',
  );
}

function ReservationSearch() {
  const navigate = useNavigate();
  const propertyId = tenant.propertyId;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ['reservation-search', propertyId, debounced],
    queryFn: () => api.searchReservations(propertyId, debounced),
    enabled: debounced.length > 0,
    retry: false,
  });

  const items = searchQ.isSuccess ? searchItems(searchQ.data) : [];
  const failClosed =
    searchQ.isError && asClassified(searchQ.error).class === 'fail_closed';

  function goFolio(id: string) {
    navigate(`/folio/${encodeURIComponent(id)}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && items.length === 1 && items[0]) {
      e.preventDefault();
      goFolio(items[0].reservationId);
    }
  }

  return (
    <div role="search" className="reservation-search">
      <input
        data-testid="reservation-search"
        placeholder="Reservation id or guest name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {failClosed ? (
        <p className="error" role="alert">
          Search unavailable — property unreachable.
        </p>
      ) : null}
      {debounced.length > 0 && items.length > 0 ? (
        <ul data-testid="reservation-search-results">
          {items.map((hit) => (
            <li key={hit.reservationId}>
              <button type="button" onClick={() => goFolio(hit.reservationId)}>
                {hit.displayName ?? hit.guestRef ?? hit.reservationId} · {hit.reservationId}
                {hit.arrivalDate && hit.departureDate
                  ? ` · ${hit.arrivalDate} → ${hit.departureDate}`
                  : ''}
                {hit.status ? ` · ${hit.status}` : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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
          {authority.kind === 'live' &&
          hasPropertyPermission(authority.me, 'reservations:read') ? (
            <ReservationSearch />
          ) : null}
        </header>
        <ShiftStrip authority={authority} />
        <FrontOfficeLive authority={authority} />
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
