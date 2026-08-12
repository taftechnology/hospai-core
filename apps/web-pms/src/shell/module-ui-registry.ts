import { housekeepingUi } from '@hospai/pms-housekeeping/ui';
import { NAV_ENTRIES as CORE_NAV, type NavEntry } from './nav.js';

export const MODULE_UI = [housekeepingUi];

export const ALL_NAV: NavEntry[] = [...CORE_NAV, ...MODULE_UI.flatMap((m) => [...m.nav])].sort(
  (a, b) => a.order - b.order,
);
