import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALARM_SCHEDULE_SQL,
  FREEZE_GATE_SQL,
  ORG_ALARM_SCHEDULE_SQL,
  ORG_ENTITLEMENT_SCHEMA_HEAD,
  ORG_GUEST_PII_SQL,
  ORG_MIGRATIONS,
  ORG_PROPERTY_MEMBER_SQL,
  ORG_MEMBER_AUDIT_COLUMNS_SQL,
  ORG_ROSTER_SQL,
  ORG_GUEST_BLIND_INDEX_SQL,
  ORG_PROPERTY_PII_ASSOCIATION_SQL,
  ORG_DATA_KEY_VERSION_SQL,
  ORG_OPERATIONAL_CONFIG_SQL,
  ORG_ROSTER_OPS_V11_SQL,
  ORG_SCHEMA_HEAD,
  ORG_SPINE_SQL,
  PLATFORM_REGISTRY_SQL,
  PLATFORM_REGISTRY_STATEMENTS,
  PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
  PLATFORM_ENTITLEMENT_CATALOG_SQL,
  PROPERTY_SCHEMA_HEAD,
  RESERVATION_SQL,
  RESERVATION_V5_SQL,
  RESERVATION_V7_SQL,
  RESERVATION_V8_SQL,
  PROVISIONAL_EXCEPTION_V9_SQL,
  FOLIO_WINDOW_RESERVATION_INDEX_SQL,
  ROOM_AND_HOUSEKEEPING_V11_SQL,
  RATE_PLAN_V12_SQL,
  PAYMENT_V13_SQL,
  CHARGE_CODE_V14_SQL,
  TAX_POSTING_V15_SQL,
  CASHIERING_V16_SQL,
  AUDIT_LOG_V17_SQL,
  FRONT_DESK_READS_V18_SQL,
  NIGHT_AUDIT_E2E_V19_SQL,
  RESERVATION_LIFECYCLE_V20_SQL,
  FOLIO_MONEY_OPS_V21_SQL,
  ROOM_OOO_V22_SQL,
  PROTOTYPE_HOLES_V23_SQL,
  MULTI_CURRENCY_FOLIO_V24_SQL,
  EXCEPTION_QUEUE_WORKBENCH_V25_SQL,
  CARD_DISPLAY_TOKEN_V26_SQL,
  VIRTUAL_ROOM_TYPES_V27_SQL,
  FOLIO_ROUTING_RULE_V28_SQL,
  ROOM_ARCHIVE_V29_SQL,
  DERIVED_RATE_PLANS_V30_SQL,
  PROMO_CODES_V31_SQL,
  INVOICE_GENERATION_V32_SQL,
  CITY_LEDGER_AR_V33_SQL,
  PROVISIONAL_EXCEPTION_ACTOR_V34_SQL,
  PRODUCTS_V35_SQL,
  RESERVATION_SEGMENTS_V36_SQL,
  HOUSEKEEPING_PRIORITY_V37_SQL,
  HOUSEKEEPING_INVENTORY_V38_SQL,
  MAINTENANCE_V39_SQL,
  NIGHT_AUDIT_CHECKS_V40_SQL,
  RECURRING_CHARGES_V41_SQL,
  TAX_ENGINE_V42_SQL,
  RATE_PLAN_INCLUSIONS_V43_SQL,
  EVENT_CONSUMER_EXCEPTION_V44_SQL,
  RATE_DAY_SQL,
  ROOM_TYPE_SQL,
  freeAvailability,
  migrateSql,
  PROPERTY_MIGRATIONS,
  type SqlStorageLike,
} from './index.js';

class MemorySql implements SqlStorageLike {
  schemaVersion: Array<{ version: number; name: string; applied_at: number }> = [];
  tables = new Set<string>();
  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    if (q.startsWith('CREATE TABLE IF NOT EXISTS schema_version')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('SELECT COALESCE(MAX(version)')) {
      const max = this.schemaVersion.reduce((m, r) => Math.max(m, r.version), 0);
      return { toArray: () => [{ v: max }] };
    }
    if (q.startsWith('INSERT INTO schema_version')) {
      this.schemaVersion.push({
        version: bindings[0] as number,
        name: bindings[1] as string,
        applied_at: bindings[2] as number,
      });
      return { toArray: () => [] };
    }
    if (
      q.startsWith('CREATE TABLE') ||
      q.startsWith('CREATE UNIQUE INDEX') ||
      q.startsWith('CREATE INDEX') ||
      q.startsWith('CREATE TRIGGER')
    ) {
      this.tables.add(q.slice(0, 80));
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO reservation_v5')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO reservation_v7')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO reservation_v8')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO reservation_v11')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO rate_plan')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('DROP TABLE reservation')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation_v5 RENAME TO reservation')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation_v7 RENAME TO reservation')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation_v8 RENAME TO reservation')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation_v11 RENAME TO reservation')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE folio_line ADD COLUMN payment_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT OR IGNORE INTO charge_code')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO folio_line_v14')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('DROP TABLE folio_line')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE folio_line_v14 RENAME TO folio_line')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE charge_code ADD COLUMN tax_group')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('UPDATE charge_code SET tax_group')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE folio_line ADD COLUMN tax_of')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE folio_line ADD COLUMN tax_rule_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE payment ADD COLUMN tender_type')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE payment ADD COLUMN shift_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN resolved_at')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN resolved_by')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_to')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_at')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN assigned_by')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN open_retry_key')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE provisional_exception ADD COLUMN actor_user_id')) {
      return { toArray: () => [] };
    }
    if (
      q.startsWith('ALTER TABLE reservation ADD COLUMN source_code') ||
      q.startsWith('ALTER TABLE reservation ADD COLUMN market_segment_code')
    ) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE payment ADD COLUMN card_last4')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE payment ADD COLUMN card_brand')) {
      return { toArray: () => [] };
    }
    if (q.startsWith(`ALTER TABLE room_type ADD COLUMN kind TEXT NOT NULL DEFAULT 'physical'`)) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN allocated_room_type_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('UPDATE reservation SET allocated_room_type_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE room ADD COLUMN archived_at INTEGER')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('DROP INDEX room_code_uidx')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO reservation_v20')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation_v20 RENAME TO reservation')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE rate_plan ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN promo_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('PRAGMA foreign_keys')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_window_v21')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE folio_window')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_window_v21 RENAME TO folio_window')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO payment_v21')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_line_v21')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE payment')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE payment_v21 RENAME TO payment')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO payment_v24')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_line_v24')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE payment_v24 RENAME TO payment')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line_v24 RENAME TO folio_line')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line_v21 RENAME TO folio_line')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO payment_v48')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_line_v48')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO payment_dispute_v48')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE payment_dispute')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE payment_v48 RENAME TO payment')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line_v48 RENAME TO folio_line')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE payment_dispute_v48 RENAME TO payment_dispute')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN checked_out_business_date')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN no_post')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN dnd_flag')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN id_document_on_file')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO room_ooo')) return { toArray: () => [] };
    if (q.startsWith('UPDATE availability_day')) return { toArray: () => [] };
    if (
      q.startsWith('ALTER TABLE member ADD COLUMN updated_at') ||
      q.startsWith('ALTER TABLE member ADD COLUMN updated_by') ||
      q.startsWith('ALTER TABLE property_member ADD COLUMN updated_at') ||
      q.startsWith('ALTER TABLE property_member ADD COLUMN updated_by')
    ) {
      return { toArray: () => [] };
    }
    if (
      q.startsWith('UPDATE member SET updated_at') ||
      q.startsWith('UPDATE property_member SET updated_at')
    ) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE data_key ADD COLUMN key_version')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO roster_kind_v11')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE roster_kind')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE roster_kind_v11 RENAME TO roster_kind')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE roster_property ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE tax_rule ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line ADD COLUMN tax_component')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line ADD COLUMN tax_band_base_minor')) return { toArray: () => [] };
    if (q.startsWith('DROP INDEX folio_line_tax_uniq')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO tax_rule_band')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO tax_rule_component')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE city_ledger_account ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE invoice ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation_rate_night ADD COLUMN is_override')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO recurring_charge_v49')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE recurring_charge')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE recurring_charge_v49 RENAME TO recurring_charge')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN checked_in_at')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN package_id')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO folio_hold_event_v51')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE folio_hold_event')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_hold_event_v51 RENAME TO folio_hold_event')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE room_ooo ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO housekeeping_task_v54')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE housekeeping_task')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE housekeeping_task_v54 RENAME TO housekeeping_task')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO room_status_history_v54')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE room_status_history')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE room_status_history_v54 RENAME TO room_status_history')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('INSERT INTO housekeeping_inventory_item_v55')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO housekeeping_inventory_movement_v55')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE housekeeping_inventory_movement')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE housekeeping_inventory_item')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE housekeeping_inventory_item_v55 RENAME TO housekeeping_inventory_item')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('ALTER TABLE housekeeping_inventory_movement_v55 RENAME TO housekeeping_inventory_movement')) {
      return { toArray: () => [] };
    }
    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

describe('migrateSql', () => {
  it('applies property migrations through version 57', () => {
    const sql = new MemorySql();
    const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v1).toBe(57);
    const v2 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v2).toBe(57);
    expect(sql.schemaVersion).toHaveLength(57);
    expect(sql.schemaVersion.map((r) => r.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
      49, 50, 51, 52, 53, 54, 55, 56, 57,
    ]);
    expect(sql.tables.size).toBeGreaterThanOrEqual(14);
  });
});

describe('freeze DDL single source', () => {
  it('migrations/do-property/0001_freeze_gate.sql matches FREEZE_GATE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0001_freeze_gate.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(FREEZE_GATE_SQL.trim());
  });

  it('migrations/do-property/0002_room_type.sql matches ROOM_TYPE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0002_room_type.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ROOM_TYPE_SQL.trim());
  });

  it('migrations/do-property/0003_alarm_schedule.sql matches ALARM_SCHEDULE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0003_alarm_schedule.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ALARM_SCHEDULE_SQL.trim());
  });

  it('migrations/do-property/0004_reservation.sql matches RESERVATION_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0004_reservation.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_SQL.trim());
  });

  it('migrations/do-property/0005_reservation_status.sql matches RESERVATION_V5_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0005_reservation_status.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_V5_SQL.trim());
  });

  it('migrations/do-property/0006_rate_day.sql matches RATE_DAY_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0006_rate_day.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RATE_DAY_SQL.trim());
  });

  it('migrations/do-property/0007_reservation_guest_ref.sql matches RESERVATION_V7_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0007_reservation_guest_ref.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_V7_SQL.trim());
  });

  it('migrations/do-property/0008_reservation_status_machine.sql matches RESERVATION_V8_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0008_reservation_status_machine.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_V8_SQL.trim());
  });

  it('migrations/do-property/0009_provisional_exception.sql matches PROVISIONAL_EXCEPTION_V9_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0009_provisional_exception.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PROVISIONAL_EXCEPTION_V9_SQL.trim());
  });

  it('migrations/do-property/0010_folio_window_reservation_idx.sql matches FOLIO_WINDOW_RESERVATION_INDEX_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0010_folio_window_reservation_idx.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(FOLIO_WINDOW_RESERVATION_INDEX_SQL.trim());
  });

  it('migrations/do-property/0011_room_and_housekeeping.sql matches ROOM_AND_HOUSEKEEPING_V11_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0011_room_and_housekeeping.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ROOM_AND_HOUSEKEEPING_V11_SQL.trim());
  });

  it('migrations/do-property/0012_rate_plan.sql matches RATE_PLAN_V12_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0012_rate_plan.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RATE_PLAN_V12_SQL.trim());
  });

  it('migrations/do-property/0013_payment.sql matches PAYMENT_V13_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0013_payment.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PAYMENT_V13_SQL.trim());
  });

  it('migrations/do-property/0016_cashiering.sql matches CASHIERING_V16_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0016_cashiering.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(CASHIERING_V16_SQL.trim());
  });

  it('migrations/do-property/0017_audit_log.sql matches AUDIT_LOG_V17_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0017_audit_log.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(AUDIT_LOG_V17_SQL.trim());
  });

  it('migrations/do-property/0018_front_desk_reads.sql matches FRONT_DESK_READS_V18_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0018_front_desk_reads.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(FRONT_DESK_READS_V18_SQL.trim());
  });

  it('migrations/do-property/0020_reservation_lifecycle.sql matches RESERVATION_LIFECYCLE_V20_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0020_reservation_lifecycle.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_LIFECYCLE_V20_SQL.trim());
  });

  it('migrations/do-property/0021_folio_money_ops.sql matches FOLIO_MONEY_OPS_V21_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0021_folio_money_ops.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(FOLIO_MONEY_OPS_V21_SQL.trim());
  });

  it('migrations/do-property/0019_night_audit_e2e.sql matches NIGHT_AUDIT_E2E_V19_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0019_night_audit_e2e.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(NIGHT_AUDIT_E2E_V19_SQL.trim());
  });

  it('migrations/do-property/0015_tax_posting.sql matches TAX_POSTING_V15_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0015_tax_posting.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(TAX_POSTING_V15_SQL.trim());
  });

  it('migrations/do-property/0014_charge_code.sql matches CHARGE_CODE_V14_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0014_charge_code.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(CHARGE_CODE_V14_SQL.trim());
  });

  it('migrations/do-org/0001_org_spine.sql matches ORG_SPINE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0001_org_spine.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_SPINE_SQL.trim());
  });

  it('migrations/do-org/0002_guest_pii.sql matches ORG_GUEST_PII_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0002_guest_pii.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_GUEST_PII_SQL.trim());
  });

  it('migrations/do-org/0003_alarm_schedule.sql matches ORG_ALARM_SCHEDULE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0003_alarm_schedule.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_ALARM_SCHEDULE_SQL.trim());
  });

  it('migrations/do-org/0004_property_member.sql matches ORG_PROPERTY_MEMBER_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0004_property_member.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_PROPERTY_MEMBER_SQL.trim());
  });

  it('migrations/do-org/0005_member_audit_columns.sql matches ORG_MEMBER_AUDIT_COLUMNS_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0005_member_audit_columns.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_MEMBER_AUDIT_COLUMNS_SQL.trim());
  });

  it('migrations/do-org/0006_roster.sql matches ORG_ROSTER_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0006_roster.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_ROSTER_SQL.trim());
  });

  it('migrations/do-org/0007_guest_blind_index.sql matches ORG_GUEST_BLIND_INDEX_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0007_guest_blind_index.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_GUEST_BLIND_INDEX_SQL.trim());
  });

  it('migrations/do-org/0008_property_pii_association.sql matches ORG_PROPERTY_PII_ASSOCIATION_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0008_property_pii_association.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_PROPERTY_PII_ASSOCIATION_SQL.trim());
  });

  it('migrations/do-org/0009_data_key_key_version.sql matches ORG_DATA_KEY_VERSION_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0009_data_key_key_version.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_DATA_KEY_VERSION_SQL.trim());
  });

  it('migrations/do-org/0010_operational_config.sql matches ORG_OPERATIONAL_CONFIG_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0010_operational_config.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_OPERATIONAL_CONFIG_SQL.trim());
  });

  it('migrations/do-org/0011_roster_ops.sql matches ORG_ROSTER_OPS_V11_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0011_roster_ops.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_ROSTER_OPS_V11_SQL.trim());
  });

  it('migrations/d1-platform/0001_tenant_registry.sql matches PLATFORM_REGISTRY_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/d1-platform/0001_tenant_registry.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PLATFORM_REGISTRY_SQL.trim());
  });

  it('migrations/d1-platform/0006_entitlement_catalog.sql matches PLATFORM_ENTITLEMENT_CATALOG_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/d1-platform/0006_entitlement_catalog.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PLATFORM_ENTITLEMENT_CATALOG_SQL.trim());
  });

  it('platform registry statements include jurisdiction immutability trigger', () => {
    expect(PLATFORM_REGISTRY_STATEMENTS.some((s) => s.includes('property_jurisdiction_immutable'))).toBe(
      true,
    );
  });

  it('platform subscription invariant statements include monotonic version triggers', () => {
    expect(PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS.some((s) => s.includes('subscription_no_delete'))).toBe(
      true,
    );
    expect(
      PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS.some((s) =>
        s.includes('entitlement_version must increase when plan or status changes'),
      ),
    ).toBe(true);
    expect(
      PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS.some((s) =>
        s.includes('subscription_update_invariants'),
      ),
    ).toBe(true);
  });

  it('applies org spine migrations', () => {
    const sql = new MemorySql();
    expect(migrateSql(sql, [...ORG_MIGRATIONS])).toBe(14);
    expect(sql.schemaVersion).toHaveLength(14);
    expect(sql.schemaVersion.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(sql.tables.size).toBeGreaterThanOrEqual(8);
  });
});

describe('freeAvailability', () => {
  it('matches ledger formula', () => {
    expect(freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 })).toBe(7);
  });
});

describe('upi tender v48', () => {
  it('rebuilds payment child-first and widens the tender check', () => {
    const v48 = PROPERTY_MIGRATIONS.find((m) => m.version === 48);
    expect(v48?.name).toBe('upi_tender');
    expect(v48?.statements.some((s) => /PRAGMA foreign_keys/i.test(s))).toBe(false);
    const drops = v48!.statements.filter((s) => s.startsWith('DROP TABLE'));
    expect(drops.map((d) => d.replace('DROP TABLE ', ''))).toEqual([
      'payment_dispute',
      'folio_line',
      'payment',
    ]);
    expect(v48?.statements.some((s) => s.includes("tender_type IN ('CARD', 'CASH', 'UPI')"))).toBe(
      true,
    );
    expect(v48?.statements.some((s) => s.includes('payment_upi_reference_uidx'))).toBe(true);
  });
});

describe('packages schedules v49', () => {
  it('rebuilds recurring_charge with wider patterns and package tables', () => {
    const v49 = PROPERTY_MIGRATIONS.find((m) => m.version === 49);
    expect(v49?.name).toBe('packages_schedules');
    expect(v49?.statements.some((s) => s.includes("pattern IN ('NIGHTLY','ARRIVAL','LAST_NIGHT','DAYS_OF_WEEK','DATES')"))).toBe(
      true,
    );
    expect(v49?.statements.some((s) => s.includes('tax_charge_code'))).toBe(true);
    expect(v49?.statements.some((s) => s.includes('CREATE TABLE package ('))).toBe(true);
    expect(v49?.statements.some((s) => s.includes('CREATE TABLE package_component ('))).toBe(true);
    expect(v49?.statements.some((s) => s.includes('CREATE TABLE recurring_charge_date ('))).toBe(true);
    expect(v49?.statements.some((s) => s.includes('ALTER TABLE reservation ADD COLUMN package_id'))).toBe(
      true,
    );
  });
});

describe('folio hold v50', () => {
  it('creates folio_hold and folio_hold_event with one-active index', () => {
    const v50 = PROPERTY_MIGRATIONS.find((m) => m.version === 50);
    expect(v50?.name).toBe('folio_hold');
    expect(v50?.statements.some((s) => s.includes('CREATE TABLE folio_hold ('))).toBe(true);
    expect(v50?.statements.some((s) => s.includes('CREATE TABLE folio_hold_event ('))).toBe(true);
    expect(v50?.statements.some((s) => s.includes('folio_hold_one_active'))).toBe(true);
    expect(v50?.statements.some((s) => s.includes("status IN ('ACTIVE','RELEASED','CLOSED')"))).toBe(true);
  });
});

describe('folio hold event v51', () => {
  it('rebuilds folio_hold_event to allow reactivated and copies rows', () => {
    const v51 = PROPERTY_MIGRATIONS.find((m) => m.version === 51);
    expect(v51?.name).toBe('folio_hold_event_reactivated');
    expect(v51?.statements.some((s) => s.includes("'reactivated'"))).toBe(true);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(51);
  });
});

describe('housekeeping tasks and status history v52', () => {
  it('creates the task and history tables, block columns and the OOO event table', () => {
    const v52 = PROPERTY_MIGRATIONS.find((m) => m.version === 52);
    expect(v52?.name).toBe('housekeeping_tasks_status_history');
    const has = (needle: string) => v52?.statements.some((st) => st.includes(needle)) === true;
    expect(has('CREATE TABLE housekeeping_task (')).toBe(true);
    expect(has('CREATE TABLE room_status_history (')).toBe(true);
    expect(has('CREATE TABLE room_ooo_event (')).toBe(true);
    expect(has('ALTER TABLE room_ooo ADD COLUMN block_type')).toBe(true);
    expect(has('ALTER TABLE room_ooo ADD COLUMN start_time')).toBe(true);
    expect(has('ALTER TABLE room_ooo ADD COLUMN end_time')).toBe(true);
    expect(has('ALTER TABLE room_ooo ADD COLUMN inspection_notes')).toBe(true);
    expect(has("source IN ('desk','bulk','check_out','room_move','stay_change','ooo')")).toBe(true);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(52);
  });
});

describe('housekeeping depth A v53', () => {
  it('creates the request, lost item, lost item event and case tables with no name column', () => {
    const v53 = PROPERTY_MIGRATIONS.find((m) => m.version === 53);
    expect(v53?.name).toBe('housekeeping_depth_a');
    const has = (needle: string) => v53?.statements.some((st) => st.includes(needle)) === true;
    expect(has('CREATE TABLE housekeeping_request (')).toBe(true);
    expect(has('CREATE TABLE housekeeping_lost_item (')).toBe(true);
    expect(has('CREATE TABLE housekeeping_lost_item_event (')).toBe(true);
    expect(has('CREATE TABLE housekeeping_case (')).toBe(true);
    expect(has("department IN ('housekeeping','front_office','maintenance','food_beverage')")).toBe(true);
    expect(has("status IN ('found','handed_over','claimed','disposed','closed')")).toBe(true);
    // No plaintext person column: claimants and guests are guest_ref records only.
    const ddl = (v53?.statements ?? []).join('\n');
    expect(ddl).not.toMatch(/claimant_name|guest_name|display_name|\bemail\b|\bphone\b/i);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(53);
  });
});

describe('housekeeping depth B v54', () => {
  it('rebuilds the task and history tables and creates the seven Part B tables with no name column', () => {
    const v54 = PROPERTY_MIGRATIONS.find((m) => m.version === 54);
    expect(v54?.name).toBe('housekeeping_depth_b');
    const has = (needle: string) => v54?.statements.some((st) => st.includes(needle)) === true;
    expect(has("status IN ('pending','in_progress','paused','completed','reviewed','cancelled')")).toBe(true);
    expect(has("'ooo','task_release'")).toBe(true);
    for (const t of [
      'housekeeping_task_stage',
      'housekeeping_inspection_template',
      'housekeeping_inspection_template_item',
      'housekeeping_inspection',
      'housekeeping_guest_audit_session',
      'housekeeping_guest_audit_line',
      'housekeeping_guest_audit_line_event',
    ]) {
      expect(has(`CREATE TABLE ${t} (`), t).toBe(true);
    }
    expect(has('housekeeping_guest_audit_one_open')).toBe(true);
    const ddl = (v54?.statements ?? []).join('\n');
    expect(ddl).not.toMatch(/guest_name|display_name|\bemail\b|\bphone\b/i);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(54);
  });
});

describe('housekeeping depth C v55', () => {
  it('rebuilds the stock tables with the new categories, kinds and columns and adds the five Part C tables', () => {
    const v55 = PROPERTY_MIGRATIONS.find((m) => m.version === 55);
    expect(v55?.name).toBe('housekeeping_depth_c');
    const ddl = (v55?.statements ?? []).join('\n');
    expect(ddl).toContain("'minibar','amenities'");
    expect(ddl).toContain("'receive','issue','count','return','laundry_out','laundry_in','discard','adjust','minibar','amenity'");
    expect(ddl).toContain('room_id       TEXT');
    expect(ddl).toContain('attendant_ref TEXT');
    for (const t of [
      'housekeeping_minibar_pickup',
      'housekeeping_minibar_pickup_line',
      'housekeeping_amenity',
      'housekeeping_amenity_rule',
      'housekeeping_amenity_dispatch',
    ]) {
      expect(ddl, t).toContain(`CREATE TABLE ${t} (`);
    }
    expect(ddl).not.toMatch(/guest_name|display_name|\bemail\b|\bphone\b/i);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(55);
  });

  it('copies existing stock rows into the rebuilt tables on a real SQLite database', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const sql: SqlStorageLike = {
      exec(query: string, ...bindings: unknown[]) {
        const rows = db.prepare(query).all(...(bindings as never[]));
        return { toArray: () => rows };
      },
    };
    const upTo54 = PROPERTY_MIGRATIONS.filter((m) => m.version <= 54);
    migrateSql(sql, [...upTo54]);
    sql.exec(
      `INSERT INTO housekeeping_inventory_item (item_id, name, category, unit, par_level, on_hand, archived_at, created_at, updated_at)
       VALUES ('i1', 'Bath towel', 'towels', 'each', 10, 7, NULL, 1, 1), ('i2', 'Old soap', 'toiletries', 'each', 5, 0, 9, 1, 1)`,
    );
    sql.exec(
      `INSERT INTO housekeeping_inventory_movement (movement_id, item_id, kind, quantity, on_hand_after, note, actor_ref, business_date, created_at)
       VALUES ('m1', 'i1', 'receive', 7, 7, 'first', 'usr_a', '2026-11-20', 2)`,
    );
    const head = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(head).toBe(57);
    const items = sql.exec(`SELECT item_id, name, category, on_hand, archived_at FROM housekeeping_inventory_item ORDER BY item_id`).toArray();
    expect(items).toEqual([
      { item_id: 'i1', name: 'Bath towel', category: 'towels', on_hand: 7, archived_at: null },
      { item_id: 'i2', name: 'Old soap', category: 'toiletries', on_hand: 0, archived_at: 9 },
    ]);
    const moves = sql.exec(`SELECT movement_id, kind, quantity, room_id, attendant_ref FROM housekeeping_inventory_movement`).toArray();
    expect(moves).toEqual([{ movement_id: 'm1', kind: 'receive', quantity: 7, room_id: null, attendant_ref: null }]);
    // New categories and kinds are accepted; the foreign key still points at the live item table.
    sql.exec(
      `INSERT INTO housekeeping_inventory_item (item_id, name, category, unit, par_level, on_hand, created_at, updated_at)
       VALUES ('i3', 'Cola', 'minibar', 'can', 0, 12, 1, 1)`,
    );
    sql.exec(
      `INSERT INTO housekeeping_inventory_movement (movement_id, item_id, kind, quantity, on_hand_after, actor_ref, business_date, created_at, room_id, attendant_ref)
       VALUES ('m2', 'i3', 'minibar', 2, 10, 'usr_a', '2026-11-20', 3, 'r1', 'staff_x')`,
    );
    expect(() =>
      sql.exec(
        `INSERT INTO housekeeping_inventory_movement (movement_id, item_id, kind, quantity, on_hand_after, actor_ref, business_date, created_at)
         VALUES ('m3', 'missing', 'issue', 1, 0, 'usr_a', '2026-11-20', 3)`,
      ),
    ).toThrow();
    expect(() =>
      sql.exec(
        `INSERT INTO housekeeping_inventory_movement (movement_id, item_id, kind, quantity, on_hand_after, actor_ref, business_date, created_at)
         VALUES ('m4', 'i3', 'bogus', 1, 0, 'usr_a', '2026-11-20', 3)`,
      ),
    ).toThrow();
    const fks = sql.exec(`PRAGMA foreign_key_list(housekeeping_inventory_movement)`).toArray() as Array<{ table: string }>;
    expect(fks.map((f) => f.table)).toEqual(['housekeeping_inventory_item']);
    db.close();
  });
});

describe('manager report v56', () => {
  it('adds the per-day statistics table with integer columns and no guest PII', () => {
    const v56 = PROPERTY_MIGRATIONS.find((m) => m.version === 56);
    expect(v56?.name).toBe('manager_report');
    const ddl = (v56?.statements ?? []).join('\n');
    expect(ddl).toContain('CREATE TABLE night_audit_day_stats (');
    expect(ddl).toContain('business_date          TEXT PRIMARY KEY');
    expect(ddl).toContain('source_mix_json');
    expect(ddl).not.toMatch(/guest_name|display_name|\bemail\b|\bphone\b|guest_ref/i);
    expect(PROPERTY_SCHEMA_HEAD).toBeGreaterThanOrEqual(56);
  });

  it('stores one row per business date on a real SQLite database', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const sql: SqlStorageLike = {
      exec(query: string, ...bindings: unknown[]) {
        const rows = db.prepare(query).all(...(bindings as never[]));
        return { toArray: () => rows };
      },
    };
    expect(migrateSql(sql, [...PROPERTY_MIGRATIONS])).toBe(57);
    const insert = `INSERT INTO night_audit_day_stats (business_date, currency, physical, blocked, sold, no_show_nights, arrivals, departures, no_shows, cancellations, in_house_adults, in_house_children, room_revenue_minor, fnb_revenue_minor, other_revenue_minor, tax_minor, pay_card_minor, pay_cash_minor, pay_upi_minor, pay_other_minor, recorded_at) VALUES (?, 'USD', 5, 0, 1, 0, 0, 0, 0, 0, 1, 0, 10000, 0, 0, 0, 0, 0, 0, 0, 1)`;
    sql.exec(insert, '2026-11-20');
    expect(() => sql.exec(insert, '2026-11-20')).toThrow();
    const row = sql.exec(`SELECT comp_nights, source_mix_json FROM night_audit_day_stats`).toArray();
    expect(row).toEqual([{ comp_nights: 0, source_mix_json: '{}' }]);
    db.close();
  });
});

describe('form c v57 and org v14', () => {
  it('adds checked_in_at and a PII-free tracker table with one live booked guest per stay', async () => {
    const v57 = PROPERTY_MIGRATIONS.find((m) => m.version === 57);
    expect(v57?.name).toBe('form_c');
    const ddl = (v57?.statements ?? []).join('\n');
    expect(ddl).toContain('ALTER TABLE reservation ADD COLUMN checked_in_at');
    expect(ddl).toContain('CREATE TABLE form_c_record (');
    expect(ddl).toContain('form_c_one_booked_guest');
    expect(ddl).not.toMatch(/surname|given_name|passport|display_name|guest_ref/i);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const sql: SqlStorageLike = {
      exec(query: string, ...bindings: unknown[]) {
        const rows = db.prepare(query).all(...(bindings as never[]));
        return { toArray: () => rows };
      },
    };
    expect(migrateSql(sql, [...PROPERTY_MIGRATIONS])).toBe(57);
    const ins = `INSERT INTO form_c_record (id, reservation_id, kind, status, deadline_at, created_at, created_by) VALUES (?, 'r1', ?, ?, 1, 1, 'u')`;
    sql.exec(ins, 'a', 'BOOKED_GUEST', 'TO_FILE');
    expect(() => sql.exec(ins, 'b', 'BOOKED_GUEST', 'TO_FILE')).toThrow();
    sql.exec(ins, 'c', 'ADDITIONAL', 'TO_FILE');
    sql.exec(ins, 'd', 'ADDITIONAL', 'TO_FILE');
    sql.exec(`UPDATE form_c_record SET status = 'REMOVED' WHERE id = 'a'`);
    sql.exec(ins, 'e', 'BOOKED_GUEST', 'TO_FILE');
    expect(() => sql.exec(ins, 'f', 'ADDITIONAL', 'BOGUS')).toThrow();
    db.close();
  });

  it('org v14 holds encrypted person rows and an access log with no plaintext columns', () => {
    const v14 = ORG_MIGRATIONS.find((m) => m.version === 14);
    expect(v14?.name).toBe('0014_form_c');
    const ddl = (v14?.statements ?? []).join('\n');
    expect(ddl).toContain('CREATE TABLE form_c_person (');
    expect(ddl).toContain('CREATE TABLE form_c_access (');
    expect(ddl).not.toMatch(/surname|passport_number|display_name/i);
    expect(ORG_SCHEMA_HEAD).toBe(14);
  });
});

describe('schema head constants', () => {
  it('match current migration array tails', () => {
    expect(PROPERTY_SCHEMA_HEAD).toBe(57);
    expect(ORG_SCHEMA_HEAD).toBe(14);
    expect(ORG_ENTITLEMENT_SCHEMA_HEAD).toBe(2);
  });

  it('property schema head is 19 after night-audit e2e', () => {
    const v19 = PROPERTY_MIGRATIONS.find((m) => m.version === 19);
    expect(v19?.name).toBe('night_audit_e2e');
    expect(v19?.statements.some((s) => s.includes('resolved_at'))).toBe(true);
    expect(v19?.statements.some((s) => s.includes('night_audit_report'))).toBe(true);
  });

  it('property schema head is 20 after reservation lifecycle', () => {
    const v20 = PROPERTY_MIGRATIONS.find((m) => m.version === 20);
    expect(v20?.name).toBe('reservation_lifecycle');
    expect(v20?.statements.some((s) => s.includes('reservation_v20'))).toBe(true);
    expect(v20?.statements.some((s) => s.includes('CANCEL'))).toBe(true);
  });

  it('property schema head is 21 after folio money ops', () => {
    expect(Math.max(...PROPERTY_MIGRATIONS.filter((m) => m.version <= 21).map((m) => m.version))).toBe(21);
    const v21 = PROPERTY_MIGRATIONS.find((m) => m.version === 21);
    expect(v21?.name).toBe('folio_money_ops');
    expect(v21?.statements.some((s) => s.includes('folio_window_v21'))).toBe(true);
    expect(v21?.statements.some((s) => s.includes('reservation_rate_night'))).toBe(true);
    // FK-safe rebuild: no PRAGMA foreign_keys toggle (not honored across DO sql.exec calls),
    // old tables drop child-first after the *_v21 copies are populated.
    expect(v21?.statements.some((s) => /PRAGMA foreign_keys/i.test(s))).toBe(false);
    const drops = v21!.statements.filter((s) => s.startsWith('DROP TABLE'));
    expect(drops.map((d) => d.replace('DROP TABLE ', ''))).toEqual([
      'folio_line',
      'payment',
      'folio_window',
    ]);
  });

  it('property schema head is 22 after room_ooo', () => {
    expect(Math.max(...PROPERTY_MIGRATIONS.filter((m) => m.version <= 22).map((m) => m.version))).toBe(22);
    const v22 = PROPERTY_MIGRATIONS.find((m) => m.version === 22);
    expect(v22?.name).toBe('room_ooo');
    expect(v22?.statements.some((s) => s.includes('CREATE TABLE room_ooo'))).toBe(true);
    expect(v22?.statements.some((s) => s.includes('ooo_backfill_'))).toBe(true);
  });

  it('migrations/do-property/0022_room_ooo.sql matches ROOM_OOO_V22_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0022_room_ooo.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ROOM_OOO_V22_SQL.trim());
  });

  it('property schema head is 23 after prototype holes', () => {
    expect(Math.max(...PROPERTY_MIGRATIONS.filter((m) => m.version <= 23).map((m) => m.version))).toBe(
      23,
    );
    const v23 = PROPERTY_MIGRATIONS.find((m) => m.version === 23);
    expect(v23?.name).toBe('prototype_holes');
    expect(v23?.statements.some((s) => s.includes('dnd_flag'))).toBe(true);
  });

  it('migrations/do-property/0023_prototype_holes.sql matches PROTOTYPE_HOLES_V23_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0023_prototype_holes.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PROTOTYPE_HOLES_V23_SQL.trim());
  });

  it('property schema head is 24 after multi_currency_folio', () => {
    expect(Math.max(...PROPERTY_MIGRATIONS.filter((m) => m.version <= 24).map((m) => m.version))).toBe(
      24,
    );
    const v24 = PROPERTY_MIGRATIONS.find((m) => m.version === 24);
    expect(v24?.name).toBe('multi_currency_folio');
    expect(v24?.statements.some((s) => s.includes('payment_v24'))).toBe(true);
    expect(v24?.statements.some((s) => s.includes('fx_rate'))).toBe(true);
    expect(v24?.statements.some((s) => s.includes('payment_event'))).toBe(true);
    expect(v24?.statements.some((s) => s.includes('payment_dispute'))).toBe(true);
    expect(v24?.statements.some((s) => s.includes('FX_GAIN'))).toBe(true);
    expect(v24?.statements.some((s) => s.includes('folio_line_v24'))).toBe(true);
    // FK-safe rebuild: no PRAGMA foreign_keys toggle (not honored across DO sql.exec calls).
    // Child folio_line drops first; payment rename rewrites folio_line_v24's payment FK.
    expect(v24?.statements.some((s) => /PRAGMA foreign_keys/i.test(s))).toBe(false);
    const drops = v24!.statements.filter((s) => s.startsWith('DROP TABLE'));
    expect(drops.map((d) => d.replace('DROP TABLE ', ''))).toEqual(['folio_line', 'payment']);
    const renames = v24!.statements.filter((s) => s.startsWith('ALTER TABLE') && s.includes('RENAME'));
    expect(renames).toEqual([
      'ALTER TABLE payment_v24 RENAME TO payment',
      'ALTER TABLE folio_line_v24 RENAME TO folio_line',
    ]);
  });

  it('migrations/do-property/0024_multi_currency_folio.sql matches MULTI_CURRENCY_FOLIO_V24_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0024_multi_currency_folio.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(MULTI_CURRENCY_FOLIO_V24_SQL.trim());
  });

  it('property schema head is 25 after exception_queue_workbench', () => {
    const v25 = PROPERTY_MIGRATIONS.find((m) => m.version === 25);
    expect(v25?.name).toBe('exception_queue_workbench');
    expect(v25?.statements).toEqual([
      'ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT',
      'ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER',
      'ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT',
      'ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT',
    ]);
  });

  it('migrations/do-property/0025_exception_queue_workbench.sql matches EXCEPTION_QUEUE_WORKBENCH_V25_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0025_exception_queue_workbench.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(EXCEPTION_QUEUE_WORKBENCH_V25_SQL.trim());
  });

  it('property schema head is 26 after card_display_token', () => {
    expect(Math.max(...PROPERTY_MIGRATIONS.filter((m) => m.version <= 26).map((m) => m.version))).toBe(
      26,
    );
    const v26 = PROPERTY_MIGRATIONS.find((m) => m.version === 26);
    expect(v26?.name).toBe('card_display_token');
    expect(v26?.statements).toEqual([
      'ALTER TABLE payment ADD COLUMN card_last4 TEXT',
      'ALTER TABLE payment ADD COLUMN card_brand TEXT',
    ]);
  });

  it('migrations/do-property/0026_card_display_token.sql matches CARD_DISPLAY_TOKEN_V26_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0026_card_display_token.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(CARD_DISPLAY_TOKEN_V26_SQL.trim());
  });

  it('property schema head is 27 after virtual_room_types', () => {
    const v27 = PROPERTY_MIGRATIONS.find((m) => m.version === 27);
    expect(v27?.name).toBe('virtual_room_types');
    expect(v27?.statements.some((s) => s.includes(`kind TEXT NOT NULL DEFAULT 'physical'`))).toBe(
      true,
    );
    expect(v27?.statements.some((s) => s.includes('CREATE TABLE room_type_constituent'))).toBe(
      true,
    );
    expect(v27?.statements.some((s) => s.includes('allocated_room_type_id'))).toBe(true);
  });

  it('migrations/do-property/0027_virtual_room_types.sql matches VIRTUAL_ROOM_TYPES_V27_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0027_virtual_room_types.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(VIRTUAL_ROOM_TYPES_V27_SQL.trim());
  });

  it('property schema head is 28 after folio_routing_rule', () => {
    const v28 = PROPERTY_MIGRATIONS.find((m) => m.version === 28);
    expect(v28?.name).toBe('folio_routing_rule');
    expect(v28?.statements.some((s) => s.includes('CREATE TABLE folio_routing_rule'))).toBe(true);
    expect(v28?.statements.some((s) => s.includes('folio_routing_rule_active_code_uniq'))).toBe(true);
    expect(v28?.statements.some((s) => s.includes("dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER'))"))).toBe(true);
  });

  it('property schema head is 29 after room_archive', () => {
    const v29 = PROPERTY_MIGRATIONS.find((m) => m.version === 29);
    expect(v29?.name).toBe('room_archive');
    expect(v29?.statements).toEqual([
      'ALTER TABLE room ADD COLUMN archived_at INTEGER',
      'DROP INDEX room_code_uidx',
      'CREATE UNIQUE INDEX room_code_live_uidx ON room(code) WHERE archived_at IS NULL',
    ]);
  });

  it('migrations/do-property/0029_room_archive.sql matches ROOM_ARCHIVE_V29_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0029_room_archive.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ROOM_ARCHIVE_V29_SQL.trim());
  });

  it('property schema head is 30 after derived_rate_plans', () => {
    const v30 = PROPERTY_MIGRATIONS.find((m) => m.version === 30);
    expect(v30?.name).toBe('derived_rate_plans');
    expect(v30?.statements).toEqual([
      'ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT',
      `ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000))`,
      'CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = \'active\'',
    ]);
  });

  it('migrations/do-property/0030_derived_rate_plans.sql matches DERIVED_RATE_PLANS_V30_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0030_derived_rate_plans.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(DERIVED_RATE_PLANS_V30_SQL.trim());
  });

  it('property schema head is 31 after promo_codes', () => {
    const v31 = PROPERTY_MIGRATIONS.find((m) => m.version === 31);
    expect(v31?.name).toBe('promo_codes');
    expect(v31?.statements[0]).toContain('CREATE TABLE promo');
    expect(v31?.statements.some((s) => s.includes('promo_code_active'))).toBe(true);
    expect(v31?.statements.some((s) => s.includes('ADD COLUMN promo_id'))).toBe(true);
  });

  it('migrations/do-property/0031_promo_codes.sql matches PROMO_CODES_V31_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0031_promo_codes.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PROMO_CODES_V31_SQL.trim());
  });

  it('property schema head is 32 after invoice_generation', () => {
    const v32 = PROPERTY_MIGRATIONS.find((m) => m.version === 32);
    expect(v32?.name).toBe('invoice_generation');
    expect(v32?.statements[0]).toContain('CREATE TABLE invoice');
    expect(v32?.statements.some((s) => s.includes('invoice_active_window'))).toBe(true);
  });

  it('migrations/do-property/0032_invoice_generation.sql matches INVOICE_GENERATION_V32_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0032_invoice_generation.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(INVOICE_GENERATION_V32_SQL.trim());
  });

  it('property schema head is 33 after city_ledger_ar', () => {
    const v33 = PROPERTY_MIGRATIONS.find((m) => m.version === 33);
    expect(v33?.name).toBe('city_ledger_ar');
    expect(v33?.statements[0]).toContain('CREATE TABLE city_ledger_account');
    expect(v33?.statements.some((s) => s.includes('city_ledger_charge_window'))).toBe(true);
    expect(v33?.statements.some((s) => s.includes('folio_window_billed_party_city_ledger_insert'))).toBe(
      true,
    );
  });

  it('migrations/do-property/0033_city_ledger_ar.sql matches CITY_LEDGER_AR_V33_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0033_city_ledger_ar.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(CITY_LEDGER_AR_V33_SQL.trim());
  });

  it('property schema head is 34 after provisional_exception_actor', () => {
    const v34 = PROPERTY_MIGRATIONS.find((m) => m.version === 34);
    expect(v34?.name).toBe('provisional_exception_actor');
    expect(v34?.statements[0]).toContain('actor_user_id');
  });

  it('migrations/do-property/0034_provisional_exception_actor.sql matches PROVISIONAL_EXCEPTION_ACTOR_V34_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0034_provisional_exception_actor.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PROVISIONAL_EXCEPTION_ACTOR_V34_SQL.trim());
  });

  it('property schema head is 35 after products', () => {
    const v35 = PROPERTY_MIGRATIONS.find((m) => m.version === 35);
    expect(v35?.name).toBe('products');
    expect(v35?.statements[0]).toContain('products_category');
  });

  it('migrations/do-property/0035_products.sql matches PRODUCTS_V35_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0035_products.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(PRODUCTS_V35_SQL.trim());
  });

  it('property schema head is 36 after reservation_segments', () => {
    const v36 = PROPERTY_MIGRATIONS.find((m) => m.version === 36);
    expect(v36?.name).toBe('reservation_segments');
    expect(v36?.statements.join(' ')).toContain('market_segment_code');
  });

  it('migrations/do-property/0036_reservation_segments.sql matches RESERVATION_SEGMENTS_V36_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0036_reservation_segments.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RESERVATION_SEGMENTS_V36_SQL.trim());
  });

  it('property schema head is 37 after housekeeping_priority', () => {
    const v37 = PROPERTY_MIGRATIONS.find((m) => m.version === 37);
    expect(v37?.name).toBe('housekeeping_priority');
    expect(v37?.statements[0]).toContain('housekeeping_priority');
  });

  it('migrations/do-property/0037_housekeeping_priority.sql matches HOUSEKEEPING_PRIORITY_V37_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0037_housekeeping_priority.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(HOUSEKEEPING_PRIORITY_V37_SQL.trim());
  });

  it('property schema head is 38 after housekeeping_inventory', () => {
    const v38 = PROPERTY_MIGRATIONS.find((m) => m.version === 38);
    expect(v38?.name).toBe('housekeeping_inventory');
    expect(v38?.statements[0]).toContain('housekeeping_inventory_item');
  });

  it('migrations/do-property/0038_housekeeping_inventory.sql matches HOUSEKEEPING_INVENTORY_V38_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0038_housekeeping_inventory.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(HOUSEKEEPING_INVENTORY_V38_SQL.trim());
  });

  it('property schema head is 39 after maintenance', () => {
    const v39 = PROPERTY_MIGRATIONS.find((m) => m.version === 39);
    expect(v39?.name).toBe('maintenance');
    expect(v39?.statements[0]).toContain('maintenance_task_type');
  });

  it('migrations/do-property/0039_maintenance.sql matches MAINTENANCE_V39_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0039_maintenance.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(MAINTENANCE_V39_SQL.trim());
  });

  it('property schema head is 40 after night audit checks', () => {
    const v40 = PROPERTY_MIGRATIONS.find((m) => m.version === 40);
    expect(v40?.name).toBe('night_audit_checks');
    expect(v40?.statements[0]).toContain('night_audit_check_result');
    expect(v40?.statements.some((s) => s.includes('checked_out_business_date'))).toBe(true);
  });

  it('migrations/do-property/0040_night_audit_checks.sql matches NIGHT_AUDIT_CHECKS_V40_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0040_night_audit_checks.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(NIGHT_AUDIT_CHECKS_V40_SQL.trim());
  });

  it('property schema head is 42 after the tax engine', () => {
    const v42 = PROPERTY_MIGRATIONS.find((m) => m.version === 42);
    expect(v42?.name).toBe('tax_engine');
    expect(v42?.statements.some((s) => s.includes('tax_rule_band'))).toBe(true);
    expect(v42?.statements.some((s) => s.includes('DROP INDEX folio_line_tax_uniq'))).toBe(true);
    expect(v42?.statements.some((s) => s.includes('tax_declaration'))).toBe(true);
  });

  it('property schema head is 43 after rate-plan inclusions', () => {
    const v43 = PROPERTY_MIGRATIONS.find((m) => m.version === 43);
    expect(v43?.name).toBe('rate_plan_inclusions');
    expect(v43?.statements.some((s) => s.includes('rate_plan_inclusion'))).toBe(true);
    expect(v43?.statements.some((s) => s.includes('reservation_inclusion_night'))).toBe(true);
    expect(v43?.statements.some((s) => s.includes('tax_band_base_minor'))).toBe(true);
  });

  it('migrations/do-property/0043_rate_plan_inclusions.sql matches RATE_PLAN_INCLUSIONS_V43_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0043_rate_plan_inclusions.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RATE_PLAN_INCLUSIONS_V43_SQL.trim());
  });

  it('property schema head is 44 after event-consumer exceptions', () => {
    const v44 = PROPERTY_MIGRATIONS.find((m) => m.version === 44);
    expect(v44?.name).toBe('event_consumer_exception');
    expect(v44?.statements.some((s) => s.includes('event_consumer_exception'))).toBe(true);
    expect(v44?.statements.some((s) => s.includes('UNIQUE (consumer_id, event_id)'))).toBe(true);
  });

  it('migrations/do-property/0044_event_consumer_exception.sql matches EVENT_CONSUMER_EXCEPTION_V44_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0044_event_consumer_exception.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(EVENT_CONSUMER_EXCEPTION_V44_SQL.trim());
  });

  it('migrations/do-property/0042_tax_engine.sql matches TAX_ENGINE_V42_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0042_tax_engine.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(TAX_ENGINE_V42_SQL.trim());
  });

  it('property schema head is 41 after recurring charges', () => {
    const v41 = PROPERTY_MIGRATIONS.find((m) => m.version === 41);
    expect(v41?.name).toBe('recurring_charges');
    expect(v41?.statements[0]).toContain('recurring_charge');
    expect(v41?.statements.some((s) => s.includes('recurring_charge_reservation'))).toBe(true);
  });

  it('migrations/do-property/0041_recurring_charges.sql matches RECURRING_CHARGES_V41_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0041_recurring_charges.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(RECURRING_CHARGES_V41_SQL.trim());
  });

  it('property schema head is 46 after buyer gst columns', () => {
    const v46 = PROPERTY_MIGRATIONS.find((m) => m.version === 46);
    expect(v46?.name).toBe('buyer_gst');
    expect(v46?.statements.some((s) => s.includes('ALTER TABLE invoice ADD COLUMN buyer_gstin'))).toBe(true);
    expect(v46?.statements.some((s) => s.includes('invoice_registered_requires_gstin'))).toBe(true);
  });
});
