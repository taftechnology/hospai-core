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
import { GuestNameLink } from '../screens/guest-row.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import {
  BedIcon,
  CalendarIcon,
  CheckIcon,
  CreditCardIcon,
  NightAuditIcon,
  PlusIcon,
  PropertyIcon,
  RoomPlanIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  WarningIcon,
} from './icons.js';
import { ALL_NAV } from './module-ui-registry.js';
import type { NavEntry } from './nav.js';
import { PropertyTimeZoneProvider, usePropertyTimeZone } from './PropertyTimeZone.js';
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

const NAV_ICONS: Record<string, typeof RoomPlanIcon> = {
  board: RoomPlanIcon,
  arrivals: CheckIcon,
  reservations: CalendarIcon,
  book: PlusIcon,
  housekeeping: BedIcon,
  guests: UserIcon,
  rates: CreditCardIcon,
  'night-audit': NightAuditIcon,
  settings: SettingsIcon,
  inventory: PropertyIcon,
  staff: UserIcon,
  roster: CalendarIcon,
  exceptions: WarningIcon,
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

function roleLabel(role: PropertyMe['role']): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'staff':
      return 'Staff';
  }
}

function hitPrimaryLabel(hit: SearchHit): string {
  if (hit.displayName) return hit.displayName;
  if (hit.guestRef) return hit.guestRef;
  return '';
}

function hitMeta(hit: SearchHit): string {
  const parts: string[] = [];
  if (hit.arrivalDate && hit.departureDate) {
    parts.push(`${hit.arrivalDate} → ${hit.departureDate}`);
  }
  if (hit.status) parts.push(hit.status);
  return parts.join(' · ');
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
      <span className="reservation-search-icon">
        <SearchIcon size={14} />
      </span>
      <input
        data-testid="reservation-search"
        placeholder="Guest name or reservation"
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
          {items.map((hit) => {
            const primary = hitPrimaryLabel(hit);
            const meta = hitMeta(hit);
            return (
              <li key={hit.reservationId}>
                {hit.guestRef ? (
                  <GuestNameLink
                    state={
                      hit.displayName
                        ? { kind: 'resolved', displayName: hit.displayName }
                        : undefined
                    }
                    guestRef={hit.guestRef}
                  />
                ) : null}{' '}
                <button type="button" onClick={() => goFolio(hit.reservationId)}>
                  {primary}
                  {primary && meta ? ' · ' : ''}
                  {meta}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function OpsRail({ authority }: { authority: Authority }) {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const propertyQ = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    retry: false,
  });
  const propertyName = propertyQ.data?.property?.name;
  const businessDate = timeZone ? propertyLocalToday(timeZone) : null;

  return (
    <header className="ops-rail">
      {authority.kind === 'live' &&
      hasPropertyPermission(authority.me, 'reservations:read') ? (
        <div className="ops-rail-search">
          <ReservationSearch />
        </div>
      ) : (
        <div className="ops-rail-search" />
      )}
      <div>
        {propertyName ? (
          <span data-testid="property-name">{propertyName}</span>
        ) : null}{' '}
        {businessDate ? (
          <span className="chip" data-testid="business-date-chip">
            <CalendarIcon size={12} /> Business date: {businessDate}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function NavItems({ entries }: { entries: NavEntry[] }) {
  return entries.map((entry) => {
    const Icon = NAV_ICONS[entry.id];
    return (
      <NavLink key={entry.id} to={entry.path} end>
        {Icon ? <Icon size={14} /> : null}
        {entry.label}
      </NavLink>
    );
  });
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
          <strong>HospAI PMS</strong>
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
  const primaryNav = navEntries.filter((e) => e.tone !== 'quiet');
  const quietNav = navEntries.filter((e) => e.tone === 'quiet');

  return (
    <PropertyTimeZoneProvider>
      <div className="app-shell">
        <aside className="app-sidebar">
          <div>
            <div className="app-sidebar-brand">
              <span className="app-sidebar-mark">✦</span>
              <h1 className="app-sidebar-title">HospAI <span>PMS</span></h1>
            </div>
            <nav aria-label="HospAI PMS">
              <div className="app-nav-list">
                <NavItems entries={primaryNav} />
              </div>
              {quietNav.length > 0 ? (
                <div className="app-nav-list app-nav-quiet">
                  <NavItems entries={quietNav} />
                </div>
              ) : null}
            </nav>
          </div>
          <footer className="app-sidebar-footer">
            {authority.kind === 'live' ? (
              <span data-testid="shell-role">{roleLabel(authority.me.role)}</span>
            ) : null}
          </footer>
        </aside>
        <div className="app-main">
          <OpsRail authority={authority} />
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
      </div>
    </PropertyTimeZoneProvider>
  );
}
