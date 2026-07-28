import { env } from 'cloudflare:test';
import { fingerprintPayload } from '@hospai/contracts';
import { resolveOrgStub, resolvePropertyStub } from '@hospai/tenant-router';
import type { OrgDO } from '../src/org-do';
import type { PropertyDO } from '../src/property-do';
import { seedSubscription } from '../src/registry';

export const DEFAULT_TEST_ORG = 'org_test';

export function orgStub(orgId = DEFAULT_TEST_ORG) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

export function propertyStub(name: string, orgId = DEFAULT_TEST_ORG) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId,
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

export async function idemFor(key: string, payload: unknown) {
  return { key, fingerprint: await fingerprintPayload(payload) };
}

export async function provisionedOrg(orgId = DEFAULT_TEST_ORG): Promise<DurableObjectStub<OrgDO>> {
  await seedSubscription(env, orgId, 'starter');
  const stub = orgStub(orgId);
  await stub.ensureMetaOrgId(orgId);
  return stub;
}

/** Provision a PropertyDO stub with meta rows + Starter entitlement for `orgId`. */
export async function provisionedPropertyStub(
  name: string,
  timeZone: string,
  currency: string,
  orgId = DEFAULT_TEST_ORG,
): Promise<DurableObjectStub<PropertyDO>> {
  await seedSubscription(env, orgId, 'starter');
  const stub = propertyStub(name, orgId);
  await stub.ensureMetaPropertyId(name);
  await stub.ensureMetaOrgId(orgId);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone });
  await stub.ensureTimeZoneIfAbsent(timeZone, { key: `provision:timezone:${name}`, fingerprint });
  const currencyFp = await fingerprintPayload({
    propertyId: name,
    currency,
  });
  await stub.ensureCurrencyIfAbsent(currency, {
    key: `provision:currency:${name}`,
    fingerprint: currencyFp,
  });
  const instant = new Date();
  await stub.ensureBusinessDateIfAbsent(timeZone, instant);
  await stub.ensureNightAuditSchedule(timeZone, instant);
  await stub.flushOutbox();
  return stub;
}

export async function ensureEntitledMeta(
  stub: DurableObjectStub<PropertyDO>,
  propertyId?: string,
  orgId = DEFAULT_TEST_ORG,
): Promise<void> {
  await seedSubscription(env, orgId, 'starter');
  await stub.ensureMetaOrgId(orgId);
  if (propertyId) {
    await stub.ensureMetaPropertyId(propertyId);
  }
}
