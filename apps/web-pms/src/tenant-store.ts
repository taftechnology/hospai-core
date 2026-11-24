/**
 * The active tenant (R4.4): one module-level store so the ~190 `tenant.orgId` /
 * `tenant.propertyId` call sites do not change. No React and no client imports, so it can be read
 * from anywhere (the entitlement loader, the WebSocket URL, query keys) at call time.
 *
 * Until `TenantProvider` selects, the store holds the env default when one is set (local dev and
 * tests that import the real module keep working). Reading with neither throws
 * `tenant_not_selected`.
 */
import type { TenantOrg } from '@hospai/client-core';
import type { TenantConfig } from './config/tenant.js';

export type TenantSelection = { orgId: string; propertyId: string };

export const TENANT_STORAGE_KEY = 'hospai.tenant';

let envDefault: TenantConfig | null = null;
let selection: TenantSelection | null = null;

function tenantNotSelected(): Error {
  const e = new Error('tenant_not_selected');
  e.name = 'TenantNotSelectedError';
  return e;
}

export function configureTenantDefault(next: TenantConfig | null): void {
  envDefault = next;
}

export function getTenantDefault(): TenantConfig | null {
  return envDefault;
}

function current(): TenantSelection {
  const active = selection ?? envDefault;
  if (!active) throw tenantNotSelected();
  return active;
}

/** Live view over the store: every read sees the current selection. */
export function createTenantAccessor(): Readonly<TenantSelection> {
  return {
    get orgId() {
      return current().orgId;
    },
    get propertyId() {
      return current().propertyId;
    },
  };
}

/** Set the active tenant in memory only (no persistence, no cache reset). Idempotent. */
export function setTenantSelection(next: TenantSelection | null): void {
  if (
    selection === next ||
    (selection && next && selection.orgId === next.orgId && selection.propertyId === next.propertyId)
  ) {
    return;
  }
  selection = next ? { orgId: next.orgId, propertyId: next.propertyId } : null;
}

export function getTenantSelection(): TenantSelection | null {
  return selection;
}

/** The per-browser saved choice. Wrapped like `hospai.theme`: storage may be blocked or corrupt. */
export function readSavedTenant(): TenantSelection | null {
  try {
    const raw = localStorage.getItem(TENANT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).orgId === 'string' &&
      typeof (parsed as Record<string, unknown>).propertyId === 'string'
    ) {
      const { orgId, propertyId } = parsed as TenantSelection;
      return { orgId, propertyId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTenant(next: TenantSelection): void {
  try {
    localStorage.setItem(
      TENANT_STORAGE_KEY,
      JSON.stringify({ orgId: next.orgId, propertyId: next.propertyId }),
    );
  } catch {
    /* storage may be blocked; the choice still applies for this session */
  }
}

function inList(orgs: readonly TenantOrg[], pick: TenantSelection | null): pick is TenantSelection {
  if (!pick) return false;
  return orgs.some(
    (o) => o.orgId === pick.orgId && o.properties.some((p) => p.propertyId === pick.propertyId),
  );
}

/**
 * Selection order (spec §3.1): the saved choice if it is still in the list, else the env default
 * if set and in the list, else the first property of the first org. Null for an empty list.
 */
export function chooseTenant(
  orgs: readonly TenantOrg[],
  saved: TenantSelection | null,
  fallback: TenantConfig | null,
): TenantSelection | null {
  if (inList(orgs, saved)) return saved;
  if (inList(orgs, fallback)) return fallback;
  const org = orgs.find((o) => o.properties.length > 0);
  const property = org?.properties[0];
  return org && property ? { orgId: org.orgId, propertyId: property.propertyId } : null;
}
