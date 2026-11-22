import {
  REPORT_GROUP_PERMISSION,
  type FeatureKey,
  reportGroupsWithReports,
  type PropertyScopedPermission,
} from '@hospai/contracts';

/** The data permission of every report group that has a registered report. */
const REPORT_PERMISSIONS: readonly PropertyScopedPermission[] = [
  ...new Set(reportGroupsWithReports().map((g) => REPORT_GROUP_PERMISSION[g])),
];

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
  /** Visible when the user holds any one of these (the Reports entry spans the report groups). */
  anyPermission?: readonly PropertyScopedPermission[];
  /** Shown only when the org's plan grants this feature (the Copilot entry, R4.16). */
  entitlement?: FeatureKey;
  tone?: 'primary' | 'quiet';
  /** Shown only when the property's tax location is India (the Form C register, R6.2). */
  indiaOnly?: boolean;
};

/** Core SPA contribution — module UI registry concatenates alongside this. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', order: 5, permission: 'reservations:read' },
  {
    id: 'copilot',
    label: 'Copilot',
    path: '/copilot',
    order: 7,
    permission: 'copilot:use',
    entitlement: 'ai_ops.enabled',
  },
  { id: 'board', label: 'Room Plan', path: '/board', order: 10, permission: 'reservations:read' },
  { id: 'arrivals', label: 'Front Desk', path: '/arrivals', order: 20, permission: 'reservations:read' },
  { id: 'live-rooms', label: 'Live rooms', path: '/rooms/live', order: 25, permission: 'reservations:read' },
  { id: 'reservations', label: 'Reservations', path: '/reservations', order: 30, permission: 'reservations:read' },
  { id: 'book', label: 'New Booking', path: '/book', order: 40, permission: 'reservations:write' },
  {
    id: 'maintenance',
    label: 'Maintenance',
    path: '/maintenance',
    order: 51,
    permission: 'maintenance:read',
  },
  { id: 'guests', label: 'Guests', path: '/guests', order: 60, permission: 'guests:read' },
  { id: 'form-c', label: 'Form C', path: '/form-c', order: 62, permission: 'guests:read', indiaOnly: true },
  { id: 'rates', label: 'Rates', path: '/rates', order: 70, permission: 'rates:write' },
  { id: 'folios', label: 'Folios', path: '/folios', order: 72, permission: 'folio:read' },
  { id: 'reports', label: 'Reports', path: '/reports', order: 85, anyPermission: REPORT_PERMISSIONS },
  {
    id: 'accounting',
    label: 'Accounting',
    path: '/accounting',
    order: 86,
    permission: 'accounting:export',
    entitlement: 'accounting_export.enabled',
  },
  { id: 'night-audit', label: 'Night Audit', path: '/night-audit', order: 80, permission: 'night_audit:run' },
  { id: 'settings', label: 'Settings', path: '/settings', order: 90, permission: 'settings:configure' },
  { id: 'inventory', label: 'Inventory', path: '/inventory', order: 100, permission: 'inventory:write', tone: 'quiet' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 110, permission: 'staff:read', tone: 'quiet' },
  { id: 'roster', label: 'Roster', path: '/roster', order: 120, permission: 'roster:read', tone: 'quiet' },
  { id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 130, permission: 'property:read', tone: 'quiet' },
  // R2.1: back-office money surfaces sit with the quiet links. Shift needs folio:read, as the
  // open-shift and shift-receipt reads do; the AppShell strip still opens and closes shifts.
  { id: 'city-ledger', label: 'City ledger', path: '/city-ledger', order: 140, permission: 'folio:read', tone: 'quiet' },
  { id: 'shift', label: 'Shift', path: '/shift', order: 150, permission: 'folio:read', tone: 'quiet' },
];
