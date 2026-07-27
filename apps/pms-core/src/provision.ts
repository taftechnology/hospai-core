import type { ProvisionPropertyInput, ProvisionPropertyResult, PropertyRecord } from '@hospai/contracts';
import {
  InvalidTimeZoneError,
  locationHintFromTimeZone,
  resolveOrgStub,
  resolvePropertyStub,
} from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';
import { getProperty, insertProperty, upsertOrg } from './registry.js';

export async function provisionProperty(
  env: PmsEnv,
  input: ProvisionPropertyInput,
): Promise<ProvisionPropertyResult> {
  let locationHint: string;
  try {
    locationHint = locationHintFromTimeZone(input.timeZone);
  } catch (e) {
    if (e instanceof InvalidTimeZoneError) {
      return { ok: false, error: 'invalid_timezone' };
    }
    throw e;
  }

  const existing = await getProperty(env, input.propertyId);
  if (existing) {
    if (existing.jurisdiction !== input.jurisdiction) {
      return { ok: false, error: 'jurisdiction_conflict', existing };
    }
    // Idempotent re-provision with same jurisdiction — refresh OrgDO mirror + DO meta.
    await syncOrgAndPropertyDo(env, existing, locationHint, input.actorUserId);
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

  await syncOrgAndPropertyDo(env, property, locationHint, input.actorUserId);
  return { ok: true, property, locationHint };
}

async function syncOrgAndPropertyDo(
  env: PmsEnv,
  property: PropertyRecord,
  locationHint: string,
  actorUserId: string,
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
    { simulateJurisdiction: env.HOSPAI_JURISDICTION_MODE === 'simulate' },
  ) as DurableObjectStub<PropertyDO>;
  await prop.setRecordedJurisdiction(property.jurisdiction);
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
    { simulateJurisdiction: env.HOSPAI_JURISDICTION_MODE === 'simulate' },
  ) as DurableObjectStub<PropertyDO>;
  return { stub, property, locationHint };
}
