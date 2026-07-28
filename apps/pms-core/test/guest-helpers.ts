import { env } from 'cloudflare:test';
import { fingerprintPayload } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import type { OrgDO } from '../src/org-do';

export const TEST_ORG_ID = 'org_test';

export function orgStub(orgId = TEST_ORG_ID) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

export async function idemFor(key: string, payload: unknown) {
  return { key, fingerprint: await fingerprintPayload(payload) };
}

export async function provisionedOrg(orgId = TEST_ORG_ID): Promise<DurableObjectStub<OrgDO>> {
  const stub = orgStub(orgId);
  await stub.ensureMetaOrgId(orgId);
  return stub;
}

export type GuestRefs = { guestRef: string; piiKeyId: string };

export async function createGuest(
  org: DurableObjectStub<OrgDO>,
  guestId: string,
  displayName: string,
): Promise<GuestRefs> {
  const input = { guestId, profile: { displayName } };
  const result = await org.tryCreateGuest(input, await idemFor(`guest-create-${guestId}`, input));
  if (!result.ok) throw new Error(`create guest failed: ${result.error}`);
  return { guestRef: guestId, piiKeyId: result.piiKeyId };
}
