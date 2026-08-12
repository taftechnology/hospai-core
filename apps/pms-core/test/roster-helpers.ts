import type { ActorContext } from '@hospai/contracts';
import type { StaffProfileCreate } from '@hospai/crypto-shredding';
import type { OrgDO } from '../src/org-do.js';
import { idemFor, TEST_OWNER_ACTOR } from './fixtures.js';

export { idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './fixtures.js';

export type StaffRefs = { staffId: string; piiKeyId: string };

export async function createHousekeeper(
  org: DurableObjectStub<OrgDO>,
  propertyId: string,
  displayName: string,
  extra?: Partial<StaffProfileCreate> & { kinds?: string[] },
  actor: ActorContext = TEST_OWNER_ACTOR,
): Promise<StaffRefs> {
  const { kinds: extraKinds, ...profileFields } = extra ?? {};
  const kinds = [...(extraKinds ?? ['housekeeper'])].sort();
  const profile: StaffProfileCreate = { displayName, ...profileFields };
  const input = { profile, kinds };
  const result = await org.tryCreateRoster(
    actor,
    propertyId,
    input,
    await idemFor(`roster-create-${displayName}-${crypto.randomUUID()}`, input),
  );
  if (!result.ok) throw new Error(`create housekeeper failed: ${result.error}`);
  return { staffId: result.staffId, piiKeyId: result.piiKeyId };
}
