import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';

export function createEntitlementStore(opts: {
  loadSnapshot: () => Promise<EntitlementSnapshot>;
}): {
  get: () => EntitlementSnapshot | null;
  set: (s: EntitlementSnapshot) => void;
  onEntitlementRequired: () => Promise<void>;
} {
  let current: EntitlementSnapshot | null = null;
  return {
    get: () => current,
    set: (s) => {
      current = s;
    },
    onEntitlementRequired: async () => {
      current = await opts.loadSnapshot();
    },
  };
}
