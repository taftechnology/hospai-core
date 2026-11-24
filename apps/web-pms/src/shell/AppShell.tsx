import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Alert, Button } from '@hospai/ui-kit';
import {
  filterNavEntries,
  meShellStateFromQuery,
  type Authority,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { ExceptionsPanel } from '../screens/ExceptionsPanel.js';
import {
  BedIcon,
  BookIcon,
  CalendarIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  CheckIcon,
  CopilotIcon,
  CreditCardIcon,
  IdCardIcon,
  DashboardIcon,
  NightAuditIcon,
  PlusIcon,
  PropertyIcon,
  ReceiptIcon,
  RoomPlanIcon,
  RosterIcon,
  SettingsIcon,
  UserIcon,
  WalletIcon,
  WarningIcon,
  WrenchIcon,
} from './icons.js';
import { ALL_NAV } from './module-ui-registry.js';
import type { NavEntry } from './nav.js';
import { PropertyFormatProvider } from './PropertyFormat.js';
import { useThemeChoice } from './theme.js';
import { useEntitlementFeatures } from './use-entitlements.js';
import { useFormCApplicable } from '../screens/form-c.js';
import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';
import { FrontOfficeLive } from './FrontOfficeLive.js';
import { consumePermissionDenyFlash } from './PermissionDenyFlash.js';
import { LogoutModal } from './LogoutModal.js';
import { BandHost, BandProvider, useBand } from './Band.js';
import { TopBar } from './TopBar.js';
import { useTenantSwitcher } from './tenant-context.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../copy/classified-user-message.js';

const NAV_ICONS: Record<string, typeof RoomPlanIcon> = {
  dashboard: DashboardIcon,
  copilot: CopilotIcon,
  board: RoomPlanIcon,
  arrivals: CheckIcon,
  'live-rooms': MonitorIcon,
  reservations: CalendarIcon,
  book: PlusIcon,
  housekeeping: BedIcon,
  maintenance: WrenchIcon,
  guests: UserIcon,
  'form-c': IdCardIcon,
  rates: CreditCardIcon,
  folios: ReceiptIcon,
  'city-ledger': BookIcon,
  'night-audit': NightAuditIcon,
  reports: BookIcon,
  accounting: ReceiptIcon,
  settings: SettingsIcon,
  inventory: PropertyIcon,
  staff: UserIcon,
  roster: RosterIcon,
  exceptions: WarningIcon,
  shift: WalletIcon,
};

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

/** R7.1 §7: a suspended account is read-only. Every page says so, through the shared copy. */
export function SuspendedBand() {
  const switcher = useTenantSwitcher();
  const org = switcher?.orgs.find((o) => o.orgId === switcher.active.orgId);
  useBand(
    'org-suspended',
    org?.status === 'suspended'
      ? {
          intent: 'exception',
          message: ACCOUNT_SUSPENDED_MESSAGE,
          testId: 'org-suspended-band',
          role: 'alert',
        }
      : null,
  );
  return null;
}

function PermissionDenyBand({ show }: { show: boolean }) {
  useBand(
    'permission-deny',
    show
      ? {
          intent: 'attention',
          message: "You don't have access to that page.",
          testId: 'permission-deny-toast',
          role: 'status',
        }
      : null,
  );
  return null;
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

function NavItems({ entries }: { entries: NavEntry[] }) {
  return entries.map((entry) => {
    const Icon = NAV_ICONS[entry.id];
    return (
      <NavLink
        key={entry.id}
        to={entry.path}
        end={entry.id !== 'rates' && entry.id !== 'settings' && entry.id !== 'reservations'}
      >
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

  const entitlementFeatures = useEntitlementFeatures(meQuery.isSuccess);
  const formCApplicable = useFormCApplicable();

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
  const navEntries = filterNavEntries(ALL_NAV, authority, entitlementFeatures).filter(
    (e) => !e.indiaOnly || formCApplicable,
  );
  const primaryNav = navEntries.filter((e) => e.tone !== 'quiet');
  const quietNav = navEntries.filter((e) => e.tone === 'quiet');

  return (
    <PropertyFormatProvider>
      <BandProvider>
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
          <TopBar authority={authority} />
          <BandHost />
          <SuspendedBand />
          <PermissionDenyBand show={showPermissionDeny} />
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
      </BandProvider>
    </PropertyFormatProvider>
  );
}
