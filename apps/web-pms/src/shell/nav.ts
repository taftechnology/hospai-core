import type { PropertyScopedPermission } from '@hospai/contracts';

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  permission?: PropertyScopedPermission;
};

/** Plain data — a later module registry concatenates contributions here. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals', permission: 'reservations:read' },
  { id: 'in-house', label: 'In-house', path: '/in-house', permission: 'reservations:read' },
  { id: 'departures', label: 'Departures', path: '/departures', permission: 'reservations:read' },
];
