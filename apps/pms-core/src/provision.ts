import type { ProvisionPropertyInput, ProvisionPropertyResult, PropertyRecord } from '@hospai/contracts';
import { fingerprintPayload, InvalidTenantIdError, validateTenantId } from '@hospai/contracts';
import { currencyCode, InvalidMoneyError } from '@hospai/money';
import {
  InvalidTimeZoneError,
  locationHintFromTimeZone,
  resolveOrgStub,
  resolvePropertyStub,
} from '@hospai/tenant-router';
import { isJurisdictionSimulate, type PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';
import { getOrg, getProperty, insertProperty, upsertOrg, assertTenantActive } from './registry.js';

export async function provisionProperty(
  env: PmsEnv,
  input: ProvisionPropertyInput,
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
    if (existing.jurisdiction !== input.jurisdiction) {
      return { ok: false, error: 'jurisdiction_conflict', existing };
    }
    await syncOrgAndPropertyDo(env, existing, locationHint, input.actorUserId, ledgerCurrency);
    return { ok: true, property: existing, locationHint };
  }

  await upsertOrg(env, input.orgId, input.orgName ?? input.orgId);
  const property = await insertProperty(env, {
    propertyId: input.propertyId,
    orgId: input.orgId,
    name: input.name,
    jurisdiction: input.jurisdiction,
    timeZone: input.timeZone,
  });

  await syncOrgAndPropertyDo(env, property, locationHint, input.actorUserId, ledgerCurrency);
  return { ok: true, property, locationHint };
}

async function syncOrgAndPropertyDo(
  env: PmsEnv,
  property: PropertyRecord,
  locationHint: string,
  actorUserId: string,
  ledgerCurrency: string,
): Promise<void> {
  const org = resolveOrgStub(env.ORG_DO, { orgId: property.orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMember(actorUserId, 'owner');
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
): Promise<{ stub: DurableObjectStub<PropertyDO>; property: PropertyRecord; locationHint: string } | null> {
  const property = await getProperty(env, propertyId);
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
