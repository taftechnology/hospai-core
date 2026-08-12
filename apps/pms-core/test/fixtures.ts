import { env } from 'cloudflare:test';
import { fingerprintPayload } from '@hospai/contracts';
import { resolveOrgStub, resolvePropertyStub } from '@hospai/tenant-router';
import type { OrgDO } from '../src/org-do';
import type { PropertyDO } from '../src/property-do';
import { seedSubscription } from '../src/registry';

import type { ActorContext } from '@hospai/contracts';

export const DEFAULT_TEST_ORG = 'org_test';
export const TEST_OWNER_ACTOR: ActorContext = { kind: 'user', userId: 'user_owner' };
export const TEST_SYSTEM_ACTOR: ActorContext = { kind: 'system', reason: 'night_audit' };

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
  await stub.ensureMember('user_owner', 'owner');
  return stub;
}

/** Provision a PropertyDO stub with meta rows + Starter entitlement for `orgId`. */
export async function provisionedPropertyStub(
  name: string,
  timeZone: string,
  currency: string,
  orgId?: string,
  opts?: { flushOutbox?: boolean },
): Promise<{ stub: DurableObjectStub<PropertyDO>; orgId: string }> {
  const targetOrgId = orgId ?? `org_prop_${name}`;
  await seedSubscription(env, targetOrgId, 'starter');
  const org = orgStub(targetOrgId);
  await org.ensureMember('user_owner', 'owner');
  const stub = propertyStub(name, targetOrgId);
  await stub.ensureMetaPropertyId(name);
  await stub.ensureMetaOrgId(targetOrgId);

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
  await stub.ensureOutboxScheduleIfAbsent();
  if (opts?.flushOutbox !== false) {
    await stub.flushOutbox();
  }
  return { stub, orgId: targetOrgId };
}

export async function ensureEntitledMeta(
  stub: DurableObjectStub<PropertyDO>,
  propertyId?: string,
  orgId?: string,
): Promise<void> {
  const targetOrgId = orgId ?? (propertyId ? `org_meta_${propertyId}` : `org_meta_${crypto.randomUUID()}`);
  await seedSubscription(env, targetOrgId, 'starter');
  const org = orgStub(targetOrgId);
  await org.ensureMember('user_owner', 'owner');
  await stub.ensureMetaOrgId(targetOrgId);
  if (propertyId) {
    await stub.ensureMetaPropertyId(propertyId);
  }
}




