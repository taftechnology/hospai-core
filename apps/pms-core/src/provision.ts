import type { ProvisionPropertyInput, ProvisionPropertyResult, PropertyRecord } from '@hospai/contracts';
import { fingerprintPayload, InvalidTenantIdError, validateTenantId } from '@hospai/contracts';
import { currencyCode, InvalidMoneyError } from '@hospai/money';
import {
  InvalidTimeZoneError,
  locationHintFromTimeZone,
  resolveOrgEntitlementStub,
  resolveOrgStub,
  resolvePropertyStub,
} from '@hospai/tenant-router';
import { isJurisdictionSimulate, type PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import type { OrgEntitlementDO } from './org-entitlement-do.js';
import type { PropertyDO } from './property-do.js';
import { getOrg, getProperty, insertProperty, upsertOrg, assertTenantActive } from './registry.js';
import { indexUserOrg } from './user-org-index.js';

export type ProvisionPropertyOptions = {
  /**
   * R7.1 D7: statements committed in the same `db.batch()` as the registry insert. `ops.add_property`
   * passes its `operator_action` row so the change and its record commit together. Not run when the
   * property already exists in the same org (an idempotent re-sync changes nothing).
   */
  withRegistryInsert?: (created: PropertyRecord) => D1PreparedStatement[];
};

export async function provisionProperty(
  env: PmsEnv,
  input: ProvisionPropertyInput,
  opts?: ProvisionPropertyOptions,
): Promise<ProvisionPropertyResult> {
  try {
    validateTenantId(input.orgId);
    validateTenantId(input.propertyId);
  } catch (e) {
    if (e instanceof InvalidTenantIdError) {
      return { ok: false, error: 'invalid_tenant_id' };
    }
    throw e;
  }

  // upsertOrg creates a missing org as active; only gate when the org already exists.
  const existingOrg = await getOrg(env, input.orgId);
  if (existingOrg) {
    const orgGate = await assertTenantActive(env, { orgId: input.orgId });
    if (!orgGate.ok) {
      return { ok: false, error: 'tenant_not_active' };
    }
  }

  let locationHint: string;
  try {
    locationHint = locationHintFromTimeZone(input.timeZone);
  } catch (e) {
    if (e instanceof InvalidTimeZoneError) {
      return { ok: false, error: 'invalid_timezone' };
    }
    throw e;
  }

  let ledgerCurrency: string;
  try {
    ledgerCurrency = currencyCode(input.currency);
  } catch (e) {
    if (e instanceof InvalidMoneyError) {
      return { ok: false, error: 'invalid_currency' };
    }
    throw e;
  }

  const existing = await getProperty(env, input.propertyId);
  if (existing) {
    if (existing.orgId !== input.orgId) {
      return { ok: false, error: 'property_exists' };
    }
    if (existing.jurisdiction !== input.jurisdiction) {
      return { ok: false, error: 'jurisdiction_conflict' };
    }
    await syncOrgAndPropertyDo(env, existing, locationHint, provisionActor(input), ledgerCurrency);
    return { ok: true, property: existing, locationHint };
  }

  await upsertOrg(env, input.orgId, input.orgName ?? input.orgId);

  const entitlement = resolveOrgEntitlementStub(
    env.ORG_ENTITLEMENT_DO,
    input.orgId,
  ) as DurableObjectStub<OrgEntitlementDO>;
  const slot = await entitlement.reservePropertySlot(input.orgId);
  if (!slot.ok) {
    return { ok: false, error: 'limit_exceeded', featureKey: 'pms.properties.limit' };
  }

  let property: PropertyRecord;
  try {
    property = await insertProperty(
      env,
      {
        propertyId: input.propertyId,
        orgId: input.orgId,
        name: input.name,
        jurisdiction: input.jurisdiction,
        timeZone: input.timeZone,
      },
      opts?.withRegistryInsert,
    );
  } catch (e) {
    await entitlement.releasePropertySlot(input.orgId);
    throw e;
  }

  await syncOrgAndPropertyDo(env, property, locationHint, provisionActor(input), ledgerCurrency);
  return { ok: true, property, locationHint };
}

type ProvisionActor = { kind: 'user'; userId: string } | { kind: 'operator'; operatorId: string };

function provisionActor(input: ProvisionPropertyInput): ProvisionActor {
  return input.actor ?? { kind: 'user', userId: input.actorUserId };
}

async function syncOrgAndPropertyDo(
  env: PmsEnv,
  property: PropertyRecord,
  locationHint: string,
  actor: ProvisionActor,
  ledgerCurrency: string,
): Promise<void> {
  const org = resolveOrgStub(env.ORG_DO, { orgId: property.orgId }) as DurableObjectStub<OrgDO>;
  // An operator is never a tenant member (R7.1 §5): no membership, no discovery-index row. The hotel
  // gets its owner from `ops.add_org_owner`.
  if (actor.kind === 'user') {
    await org.ensureMember(actor.userId, 'owner');
    await indexUserOrg(env, actor.userId, property.orgId);
  }
  await org.upsertPropertyRef({
    propertyId: property.propertyId,
    name: property.name,
    jurisdiction: property.jurisdiction,
    timeZone: property.timeZone,
    status: property.status,
  });

  const prop = resolvePropertyStub(
    env.PROPERTY_DO,
    {
      orgId: property.orgId,
      propertyId: property.propertyId,
      jurisdiction: property.jurisdiction,
      locationHint,
    },
    { simulateJurisdiction: isJurisdictionSimulate(env) },
  ) as DurableObjectStub<PropertyDO>;
  await prop.setRecordedJurisdiction(property.jurisdiction);
  await prop.ensureMetaPropertyId(property.propertyId);
  await prop.ensureMetaOrgId(property.orgId);
  const fingerprint = await fingerprintPayload({
    propertyId: property.propertyId,
    timeZone: property.timeZone,
  });
  await prop.ensureTimeZoneIfAbsent(property.timeZone, {
    key: `provision:timezone:${property.propertyId}`,
    fingerprint,
  });
  const currencyFingerprint = await fingerprintPayload({
    propertyId: property.propertyId,
    currency: ledgerCurrency,
  });
  await prop.ensureCurrencyIfAbsent(ledgerCurrency, {
    key: `provision:currency:${property.propertyId}`,
    fingerprint: currencyFingerprint,
  });
  // Same clock instant drives both the first-write business_date and the initial
  // night-audit alarm arm, keeping provisioning internally consistent.
  const instant = new Date();
  await prop.ensureBusinessDateIfAbsent(property.timeZone, instant);
  await prop.ensureNightAuditSchedule(property.timeZone, instant);
  await prop.ensureOutboxScheduleIfAbsent();
  await prop.ensureAuthHoldLapseScheduleIfAbsent();
}

/** Resolve a PropertyDO stub using only the D1 registry (callers never pass jurisdiction). */
export async function resolvePropertyFromRegistry(
  env: PmsEnv,
  propertyId: string,
  prefetched?: PropertyRecord,
): Promise<{ stub: DurableObjectStub<PropertyDO>; property: PropertyRecord; locationHint: string } | null> {
  const property =
    prefetched?.propertyId === propertyId ? prefetched : await getProperty(env, propertyId);
  if (!property) return null;
  const locationHint = locationHintFromTimeZone(property.timeZone);
  const stub = resolvePropertyStub(
    env.PROPERTY_DO,
    {
      orgId: property.orgId,
      propertyId: property.propertyId,
      jurisdiction: property.jurisdiction,
      locationHint,
    },
    { simulateJurisdiction: isJurisdictionSimulate(env) },
  ) as DurableObjectStub<PropertyDO>;
  return { stub, property, locationHint };
}
