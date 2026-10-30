export type SqlStorageLike = {
  exec(query: string, ...bindings: unknown[]): {
    toArray(): unknown[];
  };
};

export type Migration = {
  version: number;
  name: string;
  /** Prefer discrete statements — avoids `;` splitting hazards. */
  statements?: readonly string[];
  /** @deprecated Prefer `statements`. Kept for ad-hoc tests. */
  sql?: string;
};

/**
 * Apply pending SQL migrations. Version check is cheap — runs on every DO wake.
 * Prefer Migration.statements over sql strings so triggers / string literals are safe.
 */
export function migrateSql(sql: SqlStorageLike, migrations: Migration[]): number {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = sql.exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`).toArray() as Array<{
    v: number;
  }>;
  let current = Number(rows[0]?.v ?? 0);

  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const stmts =
      m.statements ??
      (m.sql
        ? m.sql
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)
        : []);
    for (const stmt of stmts) {
      sql.exec(stmt);
    }
    sql.exec(`INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)`, m.version, m.name, Date.now());
    current = m.version;
  }
  return current;
}

export { freeAvailability } from '@hospai/contracts';

export {
  PROPERTY_MIGRATIONS,
  FREEZE_GATE_SQL,
  FREEZE_GATE_STATEMENTS,
  ROOM_TYPE_SQL,
  ROOM_TYPE_STATEMENTS,
  ALARM_SCHEDULE_SQL,
  ALARM_SCHEDULE_STATEMENTS,
  RESERVATION_SQL,
  RESERVATION_STATEMENTS,
  RESERVATION_V5_SQL,
  RESERVATION_V5_STATEMENTS,
  RESERVATION_V7_SQL,
  RESERVATION_V7_STATEMENTS,
  RESERVATION_V8_SQL,
  RESERVATION_V8_STATEMENTS,
  PROVISIONAL_EXCEPTION_V9_SQL,
  PROVISIONAL_EXCEPTION_V9_STATEMENTS,
  FOLIO_WINDOW_RESERVATION_INDEX_SQL,
  FOLIO_WINDOW_RESERVATION_INDEX_STATEMENTS,
  ROOM_AND_HOUSEKEEPING_V11_SQL,
  ROOM_AND_HOUSEKEEPING_V11_STATEMENTS,
  RATE_PLAN_V12_SQL,
  RATE_PLAN_V12_STATEMENTS,
  PAYMENT_V13_SQL,
  PAYMENT_V13_STATEMENTS,
  SYSTEM_CHARGE_CODES,
  CHARGE_CODE_V14_SQL,
  CHARGE_CODE_V14_STATEMENTS,
  TAX_POSTING_V15_SQL,
  TAX_POSTING_V15_STATEMENTS,
  CASHIERING_V16_SQL,
  CASHIERING_V16_STATEMENTS,
  AUDIT_LOG_V17_SQL,
  AUDIT_LOG_V17_STATEMENTS,
  FRONT_DESK_READS_V18_SQL,
  FRONT_DESK_READS_V18_STATEMENTS,
  NIGHT_AUDIT_E2E_V19_SQL,
  NIGHT_AUDIT_E2E_V19_STATEMENTS,
  RESERVATION_LIFECYCLE_V20_SQL,
  RESERVATION_LIFECYCLE_V20_STATEMENTS,
  FOLIO_MONEY_OPS_V21_SQL,
  FOLIO_MONEY_OPS_V21_STATEMENTS,
  ROOM_OOO_V22_SQL,
  ROOM_OOO_V22_STATEMENTS,
  PROTOTYPE_HOLES_V23_SQL,
  PROTOTYPE_HOLES_V23_STATEMENTS,
  MULTI_CURRENCY_FOLIO_V24_SQL,
  MULTI_CURRENCY_FOLIO_V24_STATEMENTS,
  EXCEPTION_QUEUE_WORKBENCH_V25_SQL,
  EXCEPTION_QUEUE_WORKBENCH_V25_STATEMENTS,
  CARD_DISPLAY_TOKEN_V26_SQL,
  CARD_DISPLAY_TOKEN_V26_STATEMENTS,
  VIRTUAL_ROOM_TYPES_V27_SQL,
  VIRTUAL_ROOM_TYPES_V27_STATEMENTS,
  FOLIO_ROUTING_RULE_V28_SQL,
  FOLIO_ROUTING_RULE_V28_STATEMENTS,
  ROOM_ARCHIVE_V29_SQL,
  ROOM_ARCHIVE_V29_STATEMENTS,
  DERIVED_RATE_PLANS_V30_SQL,
  DERIVED_RATE_PLANS_V30_STATEMENTS,
  PROMO_CODES_V31_SQL,
  PROMO_CODES_V31_STATEMENTS,
  INVOICE_GENERATION_V32_SQL,
  INVOICE_GENERATION_V32_STATEMENTS,
  CITY_LEDGER_AR_V33_SQL,
  CITY_LEDGER_AR_V33_STATEMENTS,
  PROVISIONAL_EXCEPTION_ACTOR_V34_SQL,
  PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS,
  PRODUCTS_V35_SQL,
  PRODUCTS_V35_STATEMENTS,
  RESERVATION_SEGMENTS_V36_SQL,
  RESERVATION_SEGMENTS_V36_STATEMENTS,
  HOUSEKEEPING_PRIORITY_V37_SQL,
  HOUSEKEEPING_PRIORITY_V37_STATEMENTS,
  HOUSEKEEPING_INVENTORY_V38_SQL,
  HOUSEKEEPING_INVENTORY_V38_STATEMENTS,
  RATE_DAY_SQL,
  RATE_DAY_STATEMENTS,
  TYPE_WIDE_RATE_PLAN,
  DEFAULT_RATE_PLAN_ID,
} from './property-migrations.js';

export { AlarmScheduler, ALARM_FAILURE_BACKOFF_MS, type AlarmHandler } from './alarm-scheduler.js';

export {
  DEFAULT_QUIET_MS,
  DEFAULT_MAX_CHUNK_MS,
  LaneGuard,
  type LaneGuardOptions,
} from './lane-guard.js';

export {
  ORG_MIGRATIONS,
  ORG_SPINE_SQL,
  ORG_SPINE_STATEMENTS,
  ORG_GUEST_PII_SQL,
  ORG_ALARM_SCHEDULE_SQL,
  ORG_PROPERTY_MEMBER_SQL,
  ORG_MEMBER_AUDIT_COLUMNS_SQL,
  ORG_ROSTER_SQL,
  ORG_GUEST_BLIND_INDEX_SQL,
  ORG_GUEST_BLIND_INDEX_STATEMENTS,
  ORG_PROPERTY_PII_ASSOCIATION_SQL,
  ORG_PROPERTY_PII_ASSOCIATION_STATEMENTS,
  ORG_DATA_KEY_VERSION_SQL,
  ORG_OPERATIONAL_CONFIG_SQL,
  ORG_ROSTER_OPS_V11_SQL,
  GUEST_PII_STATEMENTS,
} from './org-migrations.js';

export {
  PLATFORM_REGISTRY_STATEMENTS,
  PLATFORM_REGISTRY_SQL,
  PLATFORM_ENTITLEMENT_STATEMENTS,
  PLATFORM_ENTITLEMENT_SEED_STATEMENTS,
  PLATFORM_ENTITLEMENT_STATEMENTS_ALL,
  PLATFORM_ENTITLEMENT_SQL,
  PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
  PLATFORM_SUBSCRIPTION_INVARIANT_SQL,
  ORG_PURGE_RETENTION_MS,
  PLATFORM_PURGE_ALTERS,
  PLATFORM_PURGE_STATEMENTS,
  PLATFORM_PURGE_SQL,
  PLATFORM_PENDING_COMMAND_OPEN_STATEMENTS,
  PLATFORM_PENDING_COMMAND_OPEN_SQL,
  PLATFORM_ALL_STATEMENTS,
  PLATFORM_ALL_SQL,
  PLATFORM_SEED_FEATURE_KEYS,
} from './platform-migrations.js';

export {
  ORG_ENTITLEMENT_MIGRATIONS,
  ENTITLEMENT_DO_V1_SQL,
} from './entitlement-migrations.js';

export {
  PROPERTY_SCHEMA_HEAD,
  ORG_SCHEMA_HEAD,
  ORG_ENTITLEMENT_SCHEMA_HEAD,
} from './schema-head.js';

export {
  appendOutbox,
  drainOutbox,
  ackOutboxThrough,
  domainEventMessageUtf8Bytes,
  queueMessageUtf8Bytes,
  outboxAppendQueueBytes,
  toQueueMessage,
  toQueueBatchEntry,
  OUTBOX_SWEEP_INTERVAL_MS,
  OUTBOX_BACKLOG_DELAY_MS,
  QUEUE_MAX_BATCH_BYTES,
  QUEUE_MAX_MESSAGE_BYTES,
  QUEUE_MAX_MESSAGES,
  OutboxPayloadTooLargeError,
  type OutboxRow,
  type DrainOutboxResult,
  outboxBacklogSnapshot,
} from './outbox.js';

export {
  IdempotencyKeyReused,
  readIdempotentCacheSync,
  runIdempotent,
  scopeIdempotencyKey,
} from './idempotency.js';
