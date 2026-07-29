/**
 * Every `export class` name in the repo — kept in sync via `pnpm check:class-denylist`.
 * Snapshot: 2026-07-29 (27 entries).
 */
export const CLASS_DENYLIST = [
  'AlarmScheduler',
  'CurrencyMismatchError',
  'EntitlementDoCache',
  'EntitlementRequiredError',
  'EntitlementResolutionError',
  'PermissionDoCache',
  'IdempotencyKeyReused',
  'InvalidFxRateError',
  'InvalidMoneyError',
  'InvalidTenantIdError',
  'InvalidTimeZoneError',
  'JurisdictionMismatchError',
  'JurisdictionUnavailableError',
  'KeyNotFoundError',
  'KeyShreddedError',
  'LaneGuard',
  'LedgerAmountMismatchError',
  'MigrationSweepWorkflow',
  'NightAuditWorkflow',
  'OrgDO',
  'OrgEntitlementDO',
  'OutboxPayloadTooLargeError',
  'PiiVault',
  'PropertyDO',
  'SecretConfigRejectedError',
  'SqlKeyStore',
  'UndeclaredConfigError',
] as const;

export type DenylistedClassName = (typeof CLASS_DENYLIST)[number];

export const CLASS_DENYLIST_SET = new Set<string>(CLASS_DENYLIST);
