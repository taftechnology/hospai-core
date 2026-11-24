import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';

export function createEntitlementStore(opts: {
  loadSnapshot: () => Promise<EntitlementSnapshot>;
}): {
  get: () => EntitlementSnapshot | null;
  set: (s: EntitlementSnapshot) => void;
  onEntitlementRequired: () => Promise<void>;
  /** Forget the snapshot (the active org changed, R4.4); the next 402 reloads it. */
  reset: () => void;
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
    reset: () => {
      current = null;
    },
  };
}
