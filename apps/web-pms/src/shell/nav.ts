import type { PropertyScopedPermission } from '@hospai/contracts';

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
  tone?: 'primary' | 'quiet';
};

/** Core SPA contribution — module UI registry concatenates alongside this. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', order: 5, permission: 'reservations:read' },
  { id: 'board', label: 'Room Plan', path: '/board', order: 10, permission: 'reservations:read' },
  { id: 'arrivals', label: 'Front Desk', path: '/arrivals', order: 20, permission: 'reservations:read' },
  { id: 'reservations', label: 'Reservations', path: '/reservations', order: 30, permission: 'reservations:read' },
  { id: 'book', label: 'New Booking', path: '/book', order: 40, permission: 'reservations:write' },
  { id: 'guests', label: 'Guests', path: '/guests', order: 60, permission: 'guests:read' },
  { id: 'rates', label: 'Rates', path: '/rates', order: 70, permission: 'rates:write' },
  { id: 'city-ledger', label: 'City ledger', path: '/city-ledger', order: 75, permission: 'folio:read' },
  { id: 'night-audit', label: 'Night Audit', path: '/night-audit', order: 80, permission: 'night_audit:run' },
  { id: 'settings', label: 'Settings', path: '/settings', order: 90, permission: 'settings:configure' },
  { id: 'inventory', label: 'Inventory', path: '/inventory', order: 100, permission: 'inventory:write', tone: 'quiet' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 110, permission: 'staff:read', tone: 'quiet' },
  { id: 'roster', label: 'Roster', path: '/roster', order: 120, permission: 'roster:read', tone: 'quiet' },
  { id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 130, permission: 'property:read', tone: 'quiet' },
];
