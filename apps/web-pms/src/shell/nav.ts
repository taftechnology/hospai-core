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
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals', order: 10, permission: 'reservations:read' },
  { id: 'in-house', label: 'In-house', path: '/in-house', order: 20, permission: 'reservations:read' },
  { id: 'departures', label: 'Departures', path: '/departures', order: 30, permission: 'reservations:read' },
  { id: 'book', label: 'Book', path: '/book', order: 40, permission: 'reservations:write' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 50, permission: 'staff:read' },
];
