/**
 * Every `export class` name in the repo — kept in sync via `pnpm check:class-denylist`.
 * Snapshot: 2026-08-07 (29 entries).
 */
export const CLASS_DENYLIST = [
  'AlarmScheduler',
  'ClassifiedError',
  'CurrencyMismatchError',
  'EntitlementDoCache',
  'EntitlementRequiredError',
  'EntitlementResolutionError',
  'HaltError',
  'PermissionDoCache',
  'HousekeepingOooViaRangeError',
  'HousekeepingRoomNotFoundError',
  'HousekeepingRoomOutOfOrderError',
  'IdempotencyKeyReused',
  'InvalidAssigneeRefError',
  'InvalidFxRateError',
  'InvalidMoneyError',
  'InvalidTaxRateError',
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
  'PurgeWorkflow',
  'SecretConfigRejectedError',
  'SqlKeyStore',
  'UndeclaredConfigError',
] as const;

export type DenylistedClassName = (typeof CLASS_DENYLIST)[number];

export const CLASS_DENYLIST_SET = new Set<string>(CLASS_DENYLIST);
