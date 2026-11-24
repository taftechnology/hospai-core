import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Alert, EmptyState, Skeleton } from '@hospai/ui-kit';
import { api, asClassified, resetTenantBoundState } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import {
  chooseTenant,
  getTenantDefault,
  readSavedTenant,
  saveTenant,
  setTenantSelection,
  type TenantSelection,
} from '../tenant-store.js';
import { TenantSwitcherContext } from './tenant-context.js';

const HOME_PATH = '/';

function ShellMessage({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>HospAI PMS</strong>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

/**
 * Chooses the active `{ orgId, propertyId }` from `GET /v1/me/tenants` (R4.4) and remounts
 * everything under it when the choice changes, so every component (the live WebSocket included)
 * reads the new tenant with no per-screen switch logic.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<TenantSelection | null>(null);
  const [switching, setSwitching] = useState<TenantSelection | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ['me-tenants'],
    queryFn: async () => {
      const first = await api.getMeTenants();
      const fallback = getTenantDefault();
      if (first.tenants.length > 0 || !fallback) return first.tenants;
      // A user who existed before the discovery index has no row yet. A successful `/me` on the
      // default hotel writes it (server back-fill), so ask once and list again.
      try {
        await api.getMe(fallback.propertyId);
      } catch {
        return first.tenants;
      }
      return (await api.getMeTenants()).tenants;
    },
    staleTime: 60_000,
    retry: false,
  });

  const orgs = useMemo(() => tenantsQuery.data ?? [], [tenantsQuery.data]);
  const active = useMemo(
    () => chosen ?? chooseTenant(orgs, readSavedTenant(), getTenantDefault()),
    [chosen, orgs],
  );

  // Publish the selection before the children render, so their first read already sees it.
  // The store write is idempotent and has no React subscribers. Not while a switch is pending:
  // the store already holds (or is about to hold) the new choice.
  if (active && !switching) setTenantSelection(active);

  // A switch is two commits. First the old tree unmounts (a placeholder renders), so none of its
  // observers can rebuild a query for the old hotel; then this effect runs the switch proper.
  const switchTenant = useCallback((next: TenantSelection) => setSwitching(next), []);

  useEffect(() => {
    if (!switching) return;
    // 1. save the choice and make it current
    saveTenant(switching);
    setTenantSelection(switching);
    // 2. drop every singleton bound to the previous hotel
    resetTenantBoundState();
    // 3. no data from another hotel survives: clear the cache, then re-seed the tenant list
    const tenants = queryClient.getQueryData(['me-tenants']);
    queryClient.clear();
    if (tenants) queryClient.setQueryData(['me-tenants'], tenants);
    // 4. a switch always lands on the home path
    void navigate(HOME_PATH, { replace: true });
    // 5. remount everything under the provider (the key below)
    setChosen(switching);
    setSwitching(null);
  }, [switching, navigate, queryClient]);

  if (tenantsQuery.isPending || switching) {
    return (
      <ShellMessage>
        <Skeleton label="Loading your hotels" lines={3} />
      </ShellMessage>
    );
  }

  if (tenantsQuery.isError) {
    const classified = asClassified(tenantsQuery.error);
    if (classified.class === 'unauthorized') {
      window.location.assign('/sign-in');
      return null;
    }
    return (
      <ShellMessage>
        <Alert data-testid="tenants-error">
          {classifiedUserMessage(classified, { fallback: 'Could not load your hotels.' })}
        </Alert>
      </ShellMessage>
    );
  }

  if (!active) {
    return (
      <ShellMessage>
        <EmptyState
          data-testid="tenants-no-access"
          title="You don't have access to any hotel"
          description="Ask an owner or admin of your hotel to add you."
        />
      </ShellMessage>
    );
  }

  return (
    <TenantSwitcherContext.Provider value={{ orgs, active, switchTenant }}>
      <Fragment key={`${active.orgId}:${active.propertyId}`}>{children}</Fragment>
    </TenantSwitcherContext.Provider>
  );
}
