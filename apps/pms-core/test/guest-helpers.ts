import type { ActorContext } from '@hospai/contracts';
import type { OrgDO } from '../src/org-do.js';
import { idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './fixtures.js';

export {
  DEFAULT_TEST_ORG,
  TEST_OWNER_ACTOR,
  TEST_SYSTEM_ACTOR,
  orgStub,
  propertyStub,
  idemFor,
  provisionedOrg,
  provisionedPropertyStub,
} from './fixtures.js';


export type GuestRefs = { guestRef: string; piiKeyId: string };

export async function createGuest(
  org: DurableObjectStub<OrgDO>,
  propertyId: string,
  guestId: string,
  displayName: string,
  actor: ActorContext = TEST_OWNER_ACTOR,
): Promise<GuestRefs> {
  const input = { guestId, profile: { displayName } };
  const result = await org.tryCreateGuest(
    actor,
    propertyId,
    input,
    await idemFor(`guest-create-${guestId}`, input),
  );
  if (!result.ok) throw new Error(`create guest failed: ${result.error}`);
  return { guestRef: guestId, piiKeyId: result.piiKeyId };
}
