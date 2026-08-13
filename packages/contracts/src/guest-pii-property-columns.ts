/**
 * PropertyDO columns that may hold guest PII.
 * Empty in Phase 0 — audit-writers boundary keeps guest profiles in OrgDO.
 * When a denylist column starts being written, add it here (and implement guest purge).
 */
export const PROPERTY_GUEST_PII_COLUMNS: readonly { column: string; reason: string }[] = [
  {
    column: 'billed_party',
    reason: 'COMPANY folio window billed-party label (operator-supplied; not a city-ledger FK)',
  },
];

/**
 * Columns that must not be written under apps/pms-core unless listed in
 * PROPERTY_GUEST_PII_COLUMNS — declare → enforce → auto-ratchet.
 */
export const PROPERTY_GUEST_PII_DENYLIST = ['billed_party'] as const;

export type PropertyGuestPiiDenylistColumn = (typeof PROPERTY_GUEST_PII_DENYLIST)[number];
