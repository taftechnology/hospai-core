export type NavEntry = {
  id: string;
  label: string;
  path: string;
};

/** Plain data — a later module registry concatenates contributions here. */
export const NAV_ENTRIES: NavEntry[] = [
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals' },
  { id: 'in-house', label: 'In-house', path: '/in-house' },
  { id: 'departures', label: 'Departures', path: '/departures' },
];
