import {
  ClassifiedError,
  createClient,
  createEntitlementStore,
  createQueuedCommandLog,
  createTransport,
  requestJson,
  stableKeyForOperation,
  type ClassifiedResponse,
} from '@hospai/client-core';
import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';
import { readTenantConfig } from './config/tenant.js';
import { configureTenantDefault, createTenantAccessor } from './tenant-store.js';
import { createClerkCredentials } from './providers/clerk-credentials.js';
import { createDevActorCredentials } from './providers/dev-actor-credentials.js';

// R4.4: the tenant is chosen at runtime; the build-time ids are only an optional default.
configureTenantDefault(readTenantConfig(import.meta.env));
const tenant = createTenantAccessor();

function credentialProvider() {
  if (import.meta.env.VITE_USE_DEV_ACTOR === '1') {
    return createDevActorCredentials(import.meta.env.VITE_DEV_ACTOR || 'user_owner');
  }
  return createClerkCredentials();
}

const queued = createQueuedCommandLog();
const keyStore = new Map<string, string>();

const transport = createTransport({
  baseUrl: '',
  fetchImpl: fetch.bind(globalThis),
  credentials: credentialProvider(),
});

const entitlements = createEntitlementStore({
  loadSnapshot: async () => {
    const res = await transport.fetch(`/v1/orgs/${encodeURIComponent(tenant.orgId)}/entitlements`);
    if (!res.ok) throw new Error('entitlement_snapshot_load_failed');
    return (await res.json()) as EntitlementSnapshot;
  },
});

export const api = createClient({
  transport,
  queued,
  entitlements,
  keyStore,
  propertyDoRpc: {
    async generateCityLedgerStatement(propertyId, accountId, input) {
      const idempotencyKey =
        input?.idempotencyKey ??
        stableKeyForOperation(
          `city-ledger:statement:${accountId}:${input?.asOfDate ?? 'today'}`,
          keyStore,
        );
      return requestJson({
        transport,
        path: `/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts/${encodeURIComponent(accountId)}/statements/generate`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey,
            ...(input?.asOfDate ? { asOfDate: input.asOfDate } : {}),
          }),
        },
      });
    },
  },
});
export const queuedCommands = queued;

/** Forget everything bound to the previous hotel (R4.4): entitlement snapshot, queued log, idempotency keys. */
export function resetTenantBoundState(): void {
  entitlements.reset();
  queued.clear();
  keyStore.clear();
}
export { tenant };

export function asClassified(err: unknown): ClassifiedResponse {
  if (err instanceof ClassifiedError) return err.classified;
  return {
    class: 'server_error',
    status: 500,
    body: { error: String(err) },
    retryAfterMs: null,
  };
}
