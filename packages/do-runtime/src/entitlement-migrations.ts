/** OrgEntitlementDO v1 — hard-limit counters + resolve metadata. */

export const ENTITLEMENT_METER_COUNTER_SQL = `CREATE TABLE IF NOT EXISTS meter_counter (
  meter_key  TEXT NOT NULL,
  period     TEXT NOT NULL,
  value      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meter_key, period)
)`;

export const ENTITLEMENT_META_SQL = `CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
)`;

export const ENTITLEMENT_DO_V1_STATEMENTS = [ENTITLEMENT_METER_COUNTER_SQL, ENTITLEMENT_META_SQL];

export const ENTITLEMENT_DO_V1_SQL = ENTITLEMENT_DO_V1_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_ENTITLEMENT_MIGRATIONS = [
  {
    version: 1,
    name: 'entitlement_meters',
    statements: ENTITLEMENT_DO_V1_STATEMENTS,
  },
] as const;
