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
  ORG_SCHEMA_HEAD,
  ORG_SPINE_SQL,
  PLATFORM_REGISTRY_SQL,
  PLATFORM_REGISTRY_STATEMENTS,
  PLATFORM_SUBSCRIPTION_INVARIANT_STATEMENTS,
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
    if (q.startsWith('INSERT INTO reservation_v20')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation_v20 RENAME TO reservation')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE rate_plan ADD COLUMN')) return { toArray: () => [] };
    if (q.startsWith('PRAGMA foreign_keys')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_window_v21')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE folio_window')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_window_v21 RENAME TO folio_window')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO payment_v21')) return { toArray: () => [] };
    if (q.startsWith('INSERT INTO folio_line_v21')) return { toArray: () => [] };
    if (q.startsWith('DROP TABLE payment')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE payment_v21 RENAME TO payment')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE folio_line_v21 RENAME TO folio_line')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN no_post')) return { toArray: () => [] };
    if (q.startsWith('ALTER TABLE reservation ADD COLUMN dnd_flag')) return { toArray: () => [] };
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
    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

describe('migrateSql', () => {
  it('applies property migrations through version 23', () => {
    const sql = new MemorySql();
    const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v1).toBe(23);
    const v2 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v2).toBe(23);
    expect(sql.schemaVersion).toHaveLength(23);
    expect(sql.schemaVersion.map((r) => r.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
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
    expect(migrateSql(sql, [...ORG_MIGRATIONS])).toBe(6);
    expect(sql.tables.size).toBeGreaterThanOrEqual(8);
  });
});

describe('freeAvailability', () => {
  it('matches ledger formula', () => {
    expect(freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 })).toBe(7);
  });
});

describe('schema head constants', () => {
  it('match current migration array tails', () => {
    expect(PROPERTY_SCHEMA_HEAD).toBe(23);
    expect(ORG_SCHEMA_HEAD).toBe(6);
    expect(ORG_ENTITLEMENT_SCHEMA_HEAD).toBe(1);
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
    expect(PROPERTY_SCHEMA_HEAD).toBe(23);
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
});
