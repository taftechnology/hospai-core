import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Alert, Button, Input } from '@hospai/ui-kit';
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
import { reservationStatusLabel } from '../status/reservation-status-label.js';
import {
  BedIcon,
  BookIcon,
  CalendarIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  CheckIcon,
  CreditCardIcon,
  DashboardIcon,
  NightAuditIcon,
  PlusIcon,
  PropertyIcon,
  ReceiptIcon,
  RoomPlanIcon,
  RosterIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  WarningIcon,
  WrenchIcon,
} from './icons.js';
import { ALL_NAV } from './module-ui-registry.js';
import type { NavEntry } from './nav.js';
import { PropertyFormatProvider, useFormat, usePropertyTimeZone } from './PropertyFormat.js';
import { useThemeChoice } from './theme.js';
import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';
import { ShiftStrip } from './ShiftStrip.js';
import { FrontOfficeLive } from './FrontOfficeLive.js';
import { consumePermissionDenyFlash } from './PermissionDenyFlash.js';
import { LogoutModal } from './LogoutModal.js';

type SearchHit = {
  reservationId: string;
  guestRef?: string;
  displayName?: string | null;
  status?: string;
  arrivalDate?: string;
  departureDate?: string;
};

const NAV_ICONS: Record<string, typeof RoomPlanIcon> = {
  dashboard: DashboardIcon,
  board: RoomPlanIcon,
  arrivals: CheckIcon,
  reservations: CalendarIcon,
  book: PlusIcon,
  housekeeping: BedIcon,
  maintenance: WrenchIcon,
  guests: UserIcon,
  rates: CreditCardIcon,
  folios: ReceiptIcon,
  'city-ledger': BookIcon,
  'night-audit': NightAuditIcon,
  settings: SettingsIcon,
  inventory: PropertyIcon,
  staff: UserIcon,
  roster: RosterIcon,
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
  return 'Folio';
}

function hitMeta(hit: SearchHit, dateRange: (from: string, to: string) => string): string {
  const parts: string[] = [];
  if (hit.arrivalDate && hit.departureDate) {
    parts.push(dateRange(hit.arrivalDate, hit.departureDate));
  }
  if (hit.status) parts.push(reservationStatusLabel(hit.status));
  return parts.join(' · ');
}

function ReservationSearch() {
  const navigate = useNavigate();
  const { dateRange } = useFormat();
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
    void navigate(`/folio/${encodeURIComponent(id)}`);
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
      <Input
        data-testid="reservation-search"
        type="search"
        aria-label="Search reservations"
        placeholder="Reservation id"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {failClosed ? <Alert>Search unavailable — property unreachable.</Alert> : null}
      {debounced.length > 0 && items.length > 0 ? (
        <ul data-testid="reservation-search-results">
          {items.map((hit) => {
            const primary = hitPrimaryLabel(hit);
            const meta = hitMeta(hit, dateRange);
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
                <Button type="button" intent="ghost" onClick={() => goFolio(hit.reservationId)}>
                  {primary}
                  {primary && meta ? ' · ' : ''}
                  {meta}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ThemeSwitch() {
  const [choice, choose] = useThemeChoice();
  return (
    <div className="ui-theme-switch" role="group" aria-label="Theme">
      <Button
        type="button"
        intent="ghost"
        size="sm"
        aria-label="System theme"
        aria-pressed={choice === 'system'}
        onClick={() => choose('system')}
      >
        <MonitorIcon />
      </Button>
      <Button
        type="button"
        intent="ghost"
        size="sm"
        aria-label="Light theme"
        aria-pressed={choice === 'light'}
        onClick={() => choose('light')}
      >
        <SunIcon />
      </Button>
      <Button
        type="button"
        intent="ghost"
        size="sm"
        aria-label="Dark theme"
        aria-pressed={choice === 'dark'}
        onClick={() => choose('dark')}
      >
        <MoonIcon />
      </Button>
    </div>
  );
}

function OpsRail({ authority }: { authority: Authority }) {
  const propertyId = tenant.propertyId;
  const timeZone = usePropertyTimeZone();
  const { date } = useFormat();
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
      <div className="ops-rail-meta">
        {propertyName ? (
          <span data-testid="property-name">{propertyName}</span>
        ) : null}{' '}
        {businessDate ? (
          <span className="chip" data-testid="business-date-chip">
            <CalendarIcon size={12} /> Business date: {date(businessDate)}
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
      <NavLink key={entry.id} to={entry.path} end={entry.id !== 'rates' && entry.id !== 'settings'}>
        {Icon ? <Icon size={16} /> : null}
        {entry.label}
      </NavLink>
    );
  });
}

export function AppShell() {
  const propertyId = tenant.propertyId;
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [showPermissionDeny, setShowPermissionDeny] = useState(() => consumePermissionDenyFlash());

  useEffect(() => {
    if (!showPermissionDeny) return;
    const t = window.setTimeout(() => setShowPermissionDeny(false), 4000);
    return () => window.clearTimeout(t);
  }, [showPermissionDeny]);
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
          <Alert data-testid="me-no-access">You don&apos;t have access to this property.</Alert>
        </main>
      </div>
    );
  }

  const authority: Authority = shell.authority;
  const navEntries = filterNavEntries(ALL_NAV, authority);
  const primaryNav = navEntries.filter((e) => e.tone !== 'quiet');
  const quietNav = navEntries.filter((e) => e.tone === 'quiet');

  return (
    <PropertyFormatProvider>
      <div className="app-shell">
        <aside className="app-sidebar">
          <div>
            <div className="app-sidebar-brand">
              <span className="app-sidebar-mark">✦</span>
              <p className="app-sidebar-title">HospAI <span>PMS</span></p>
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
            <ThemeSwitch />
            {authority.kind === 'live' ? (
              <div className="app-sidebar-footer__account">
                <span data-testid="shell-role">
                  <UserIcon size={16} />
                  {roleLabel(authority.me.role)}
                </span>
                <Button
                  type="button"
                  intent="default"
                  size="sm"
                  onClick={() => setLogoutOpen(true)}
                >
                  Log out
                </Button>
              </div>
            ) : null}
            {logoutOpen ? <LogoutModal onCancel={() => setLogoutOpen(false)} /> : null}
          </footer>
        </aside>
        <div className="app-main">
          <OpsRail authority={authority} />
          <ShiftStrip authority={authority} />
          <FrontOfficeLive authority={authority} />
          <main className="main">
            {showPermissionDeny ? (
              <div role="status" className="app-flash" data-testid="permission-deny-toast">
                You don&apos;t have access to that page.
              </div>
            ) : null}
            <Outlet />
          </main>
          <div className="side-panels">
            <QueuedCommandsPanel />
            <ExceptionsPanel />
          </div>
        </div>
      </div>
    </PropertyFormatProvider>
  );
}
