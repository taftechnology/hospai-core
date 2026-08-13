import type { PropertyScopedPermission } from '@hospai/contracts';

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
};

/** Core SPA contribution — module UI registry concatenates alongside this. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'board', label: 'Board', path: '/board', order: 8, permission: 'reservations:read' },
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals', order: 10, permission: 'reservations:read' },
  { id: 'in-house', label: 'In-house', path: '/in-house', order: 20, permission: 'reservations:read' },
  { id: 'departures', label: 'Departures', path: '/departures', order: 30, permission: 'reservations:read' },
  { id: 'reservations', label: 'Reservations', path: '/reservations', order: 35, permission: 'reservations:read' },
  { id: 'guests', label: 'Guests', path: '/guests', order: 36, permission: 'guests:read' },
  { id: 'book', label: 'Book', path: '/book', order: 40, permission: 'reservations:write' },
  { id: 'inventory', label: 'Inventory', path: '/inventory', order: 42, permission: 'inventory:write' },
  { id: 'rates', label: 'Rates', path: '/rates', order: 44, permission: 'rates:write' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 50, permission: 'staff:read' },
  { id: 'roster', label: 'Roster', path: '/roster', order: 55, permission: 'roster:write' },
  { id: 'night-audit', label: 'Night audit', path: '/night-audit', order: 60, permission: 'night_audit:run' },
  { id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 65, permission: 'property:read' },
  { id: 'settings', label: 'Settings', path: '/settings', order: 70, permission: 'settings:configure' },
];
