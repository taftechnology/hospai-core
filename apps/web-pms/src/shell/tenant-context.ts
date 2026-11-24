import { createContext, useContext } from 'react';
import type { TenantOrg } from '@hospai/client-core';
import type { TenantSelection } from '../tenant-store.js';

/** What the switcher needs (R4.4). Absent outside `TenantProvider`, which renders the plain name. */
export type TenantSwitcherValue = {
  orgs: readonly TenantOrg[];
  active: TenantSelection;
  switchTenant: (next: TenantSelection) => void;
};

export const TenantSwitcherContext = createContext<TenantSwitcherValue | null>(null);

export function useTenantSwitcher(): TenantSwitcherValue | null {
  return useContext(TenantSwitcherContext);
}
