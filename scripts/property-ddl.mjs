#!/usr/bin/env node
/**
 * Generate or check DDL SQL files against @hospai/do-runtime sources.
 *
 *   node scripts/property-ddl.mjs --write
 *   node scripts/property-ddl.mjs --check
 *   node scripts/property-ddl.mjs --self-test
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modPath = join(root, 'packages/do-runtime/dist/index.js');

export function compareDdl(generated, committed) {
  if (committed == null) return { ok: false, reason: 'missing' };
  if (committed !== generated) return { ok: false, reason: 'drift' };
  return { ok: true };
}

function selfTest() {
  let failed = false;
  const gen = '-- header\nCREATE TABLE t (id INTEGER);\n';
  if (!compareDdl(gen, gen).ok) {
    console.error('self-test D1 matching pair should pass');
    failed = true;
  }
  const d2 = compareDdl(gen, gen + '-- drifted\n');
  if (d2.ok || d2.reason !== 'drift') {
    console.error('self-test D2 drift should fail', d2);
    failed = true;
  }
  const d3 = compareDdl(gen, null);
  if (d3.ok || d3.reason !== 'missing') {
    console.error('self-test D3 missing should fail', d3);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('check:ddl --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv.includes('--write') || process.argv.includes('--check')) {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--write') ? 'write' : 'check';

  let FREEZE_GATE_SQL;
  let ROOM_TYPE_SQL;
  let ALARM_SCHEDULE_SQL;
  let RESERVATION_SQL;
  let RESERVATION_V5_SQL;
  let RATE_DAY_SQL;
  let RESERVATION_V7_SQL;
  let RESERVATION_V8_SQL;
  let PROVISIONAL_EXCEPTION_V9_SQL;
  let FOLIO_WINDOW_RESERVATION_INDEX_SQL;
  let ROOM_AND_HOUSEKEEPING_V11_SQL;
  let RATE_PLAN_V12_SQL;
  let PAYMENT_V13_SQL;
  let CHARGE_CODE_V14_SQL;
  let TAX_POSTING_V15_SQL;
  let CASHIERING_V16_SQL;
  let AUDIT_LOG_V17_SQL;
  let FRONT_DESK_READS_V18_SQL;
  let NIGHT_AUDIT_E2E_V19_SQL;
  let RESERVATION_LIFECYCLE_V20_SQL;
  let FOLIO_MONEY_OPS_V21_SQL;
  let ROOM_OOO_V22_SQL;
  let PROTOTYPE_HOLES_V23_SQL;
  let MULTI_CURRENCY_FOLIO_V24_SQL;
  let EXCEPTION_QUEUE_WORKBENCH_V25_SQL;
  let CARD_DISPLAY_TOKEN_V26_SQL;
  let VIRTUAL_ROOM_TYPES_V27_SQL;
  let FOLIO_ROUTING_RULE_V28_SQL;
  let ROOM_ARCHIVE_V29_SQL;
  let DERIVED_RATE_PLANS_V30_SQL;
  let PROMO_CODES_V31_SQL;
  let ORG_SPINE_SQL;
  let ORG_GUEST_PII_SQL;
  let ORG_ALARM_SCHEDULE_SQL;
  let ORG_PROPERTY_MEMBER_SQL;
  let ORG_MEMBER_AUDIT_COLUMNS_SQL;
  let ORG_ROSTER_SQL;
  let ORG_GUEST_BLIND_INDEX_SQL;
  let PLATFORM_REGISTRY_SQL;
  let PLATFORM_ENTITLEMENT_SQL;
  let PLATFORM_SUBSCRIPTION_INVARIANT_SQL;
  let PLATFORM_PURGE_SQL;
  let PLATFORM_PENDING_COMMAND_OPEN_SQL;
  try {
    ({
      FREEZE_GATE_SQL,
      ROOM_TYPE_SQL,
      ALARM_SCHEDULE_SQL,
      RESERVATION_SQL,
      RESERVATION_V5_SQL,
      RATE_DAY_SQL,
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
      ORG_SPINE_SQL,
      ORG_GUEST_PII_SQL,
      ORG_ALARM_SCHEDULE_SQL,
      ORG_PROPERTY_MEMBER_SQL,
      ORG_MEMBER_AUDIT_COLUMNS_SQL,
      ORG_ROSTER_SQL,
      ORG_GUEST_BLIND_INDEX_SQL,
      PLATFORM_REGISTRY_SQL,
      PLATFORM_ENTITLEMENT_SQL,
      PLATFORM_SUBSCRIPTION_INVARIANT_SQL,
      PLATFORM_PURGE_SQL,
      PLATFORM_PENDING_COMMAND_OPEN_SQL,
    } = await import(modPath));
  } catch (e) {
    console.error(
      'Failed to load @hospai/do-runtime dist. Run `pnpm --filter @hospai/do-runtime build` first.',
    );
    console.error(e);
    process.exit(1);
  }


const doPropertyTargets = [
  {
    path: join(root, 'migrations/do-property/0001_freeze_gate.sql'),
    header: `-- Phase 0 schema-freeze gate (§14) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: FREEZE_GATE_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0002_room_type.sql'),
    header: `-- PropertyDO room_type catalog — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ROOM_TYPE_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0003_alarm_schedule.sql'),
    header: `-- PropertyDO alarm_schedule — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ALARM_SCHEDULE_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0004_reservation.sql'),
    header: `-- PropertyDO reservation — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RESERVATION_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0005_reservation_status.sql'),
    header: `-- PropertyDO reservation status (cancelled) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RESERVATION_V5_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0006_rate_day.sql'),
    header: `-- PropertyDO materialized rate_day — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RATE_DAY_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0007_reservation_guest_ref.sql'),
    header: `-- PropertyDO reservation guest_ref + pii_key_id — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RESERVATION_V7_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0008_reservation_status_machine.sql'),
    header: `-- PropertyDO reservation status machine — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RESERVATION_V8_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0009_provisional_exception.sql'),
    header: `-- PropertyDO provisional_exception — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: PROVISIONAL_EXCEPTION_V9_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0010_folio_window_reservation_idx.sql'),
    header: `-- PropertyDO folio_window reservation index — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: FOLIO_WINDOW_RESERVATION_INDEX_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0011_room_and_housekeeping.sql'),
    header: `-- PropertyDO room + reservation.room_id + housekeeping_assignment — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE room BEFORE reservation rebuild (outbound FK).

`,
    sql: ROOM_AND_HOUSEKEEPING_V11_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0012_rate_plan.sql'),
    header: `-- PropertyDO rate_plan + BAR seed — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: RATE_PLAN_V12_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0013_payment.sql'),
    header: `-- PropertyDO payment + folio_line.payment_id — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE payment before ALTER folio_line (FK target).

`,
    sql: PAYMENT_V13_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0014_charge_code.sql'),
    header: `-- PropertyDO charge_code + folio_line.charge_code FK — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: seed → distinct-backfill → rebuild folio_line → indexes after rename.

`,
    sql: CHARGE_CODE_V14_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0015_tax_posting.sql'),
    header: `-- PropertyDO tax_rule + charge_code.tax_group + folio_line tax columns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: tax_rule table → charge_code.tax_group → seed TAX output → folio_line columns → indexes.

`,
    sql: TAX_POSTING_V15_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0016_cashiering.sql'),
    header: `-- PropertyDO shift + payment tender_type/shift_id — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE shift → open-per-cashier index → tender_type DEFAULT CARD → shift_id FK.

`,
    sql: CASHIERING_V16_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0017_audit_log.sql'),
    header: `-- PropertyDO audit_log — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Never silently prune audit_log; ARCHIVE owns future purge under a stated retention policy.

`,
    sql: AUDIT_LOG_V17_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0018_front_desk_reads.sql'),
    header: `-- PropertyDO front-desk list indexes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Additive indexes only: departure_date + partial in-house (checked_in).

`,
    sql: FRONT_DESK_READS_V18_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0019_night_audit_e2e.sql'),
    header: `-- PropertyDO night-audit e2e — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: provisional_exception resolved_at/resolved_by → night_audit_report index.

`,
    sql: NIGHT_AUDIT_E2E_V19_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0020_reservation_lifecycle.sql'),
    header: `-- PropertyDO reservation lifecycle — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: rate_plan ALTERs → CANCEL/NO_SHOW seed → reservation rebuild + indexes.

`,
    sql: RESERVATION_LIFECYCLE_V20_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0021_folio_money_ops.sql'),
    header: `-- PropertyDO folio money ops — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: create *_v21 (children reference new parents) → copy → drop old child-first → rename → indexes → no_post → reservation_rate_night → seeds.
-- FK-safe: never drops a referenced parent; PRAGMA foreign_keys is not honored across DO sql.exec calls.

`,
    sql: FOLIO_MONEY_OPS_V21_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0022_room_ooo.sql'),
    header: `-- PropertyDO room OOO ranges — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE room_ooo → index → label-era backfill INSERT → blocked increment.

`,
    sql: ROOM_OOO_V22_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0023_prototype_holes.sql'),
    header: `-- PropertyDO prototype holes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER reservation ADD dnd_flag.

`,
    sql: PROTOTYPE_HOLES_V23_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0024_multi_currency_folio.sql'),
    header: `-- PropertyDO multi-currency folio — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: create payment_v24 + folio_line_v24 (child FK → payment_v24) → copy (folio_line byte-identical) → drop child-first → rename → indexes → new tables → seeds.
-- FK-safe: never drops a referenced parent; PRAGMA foreign_keys is not honored across DO sql.exec calls. folio_line copy is not a backfill.

`,
    sql: MULTI_CURRENCY_FOLIO_V24_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0025_exception_queue_workbench.sql'),
    header: `-- PropertyDO exception-queue workbench — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER provisional_exception ADD assigned_to, assigned_at, assigned_by, open_retry_key.

`,
    sql: EXCEPTION_QUEUE_WORKBENCH_V25_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0026_card_display_token.sql'),
    header: `-- PropertyDO card display token — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER payment ADD card_last4, card_brand.

`,
    sql: CARD_DISPLAY_TOKEN_V26_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0027_virtual_room_types.sql'),
    header: `-- PropertyDO virtual room types — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: room_type.kind, room_type_constituent, reservation.allocated_room_type_id backfill.

`,
    sql: VIRTUAL_ROOM_TYPES_V27_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0028_folio_routing_rule.sql'),
    header: `-- PropertyDO folio routing rules — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE folio_routing_rule → partial unique index on active charge_code.

`,
    sql: FOLIO_ROUTING_RULE_V28_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0029_room_archive.sql'),
    header: `-- PropertyDO room archive — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ADD archived_at → DROP room_code_uidx → CREATE partial unique index on live codes.

`,
    sql: ROOM_ARCHIVE_V29_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0030_derived_rate_plans.sql'),
    header: `-- PropertyDO derived rate plans — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ADD parent_rate_plan_id → ADD derive_bps CHECK → partial index on active parent.

`,
    sql: DERIVED_RATE_PLANS_V30_SQL,
  },
  {
    path: join(root, 'migrations/do-property/0031_promo_codes.sql'),
    header: `-- PropertyDO promo codes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE promo → partial unique index → reservation.promo_id.

`,
    sql: PROMO_CODES_V31_SQL,
  },
];

const targets = [
  ...doPropertyTargets,
  {
    path: join(root, 'migrations/do-org/0001_org_spine.sql'),
    header: `-- OrgDO spine — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_SPINE_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0002_guest_pii.sql'),
    header: `-- OrgDO guest PII + crypto-shredding keys — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_GUEST_PII_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0003_alarm_schedule.sql'),
    header: `-- OrgDO alarm_schedule — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_ALARM_SCHEDULE_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0004_property_member.sql'),
    header: `-- OrgDO property_member — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_PROPERTY_MEMBER_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0005_member_audit_columns.sql'),
    header: `-- OrgDO member/property_member audit columns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_MEMBER_AUDIT_COLUMNS_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0006_roster.sql'),
    header: `-- OrgDO staff roster + kinds + freeze triggers — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_ROSTER_SQL,
  },
  {
    path: join(root, 'migrations/do-org/0007_guest_blind_index.sql'),
    header: `-- OrgDO guest blind-index hashes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_GUEST_BLIND_INDEX_SQL,
  },
  {
    path: join(root, 'migrations/d1-platform/0001_tenant_registry.sql'),
    header: `-- Platform D1 tenant registry (§4.5) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Jurisdiction is immutable after insert (trigger enforced).

`,
    sql: PLATFORM_REGISTRY_SQL,
  },
  {
    path: join(root, 'migrations/d1-platform/0002_entitlements.sql'),
    header: `-- Platform D1 entitlement plane (§6.1) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: PLATFORM_ENTITLEMENT_SQL,
  },
  {
    path: join(root, 'migrations/d1-platform/0003_subscription_invariants.sql'),
    header: `-- Platform D1 subscription invariants (§6.3) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- entitlement_version is monotonic per org; rows are never deleted.

`,
    sql: PLATFORM_SUBSCRIPTION_INVARIANT_SQL,
  },
  {
    path: join(root, 'migrations/d1-platform/0004_purge.sql'),
    header: `-- Platform D1 purge / tenant lifecycle (§4.8) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: PLATFORM_PURGE_SQL,
  },
  {
    path: join(root, 'migrations/d1-platform/0005_pending_command_open.sql'),
    header: `-- Platform D1 pending-command census for night-audit PRE_CHECK — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Not admission dedupe. INSERT OR IGNORE on (property_id, idempotency_key).

`,
    sql: PLATFORM_PENDING_COMMAND_OPEN_SQL,
  },
];

let failed = false;
for (const t of targets) {
  const expected = t.header + t.sql;
  if (mode === 'write') {
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileSync(t.path, expected);
    console.log(`Wrote ${t.path}`);
  } else {
    let onDisk = null;
    try {
      onDisk = readFileSync(t.path, 'utf8');
    } catch {
      onDisk = null;
    }
    const result = compareDdl(expected, onDisk);
    if (!result.ok) {
      if (result.reason === 'missing') console.error(`Missing ${t.path}`);
      else console.error(`DDL drift: ${t.path}`);
      failed = true;
    } else {
      console.log(`OK ${t.path}`);
    }
  }
}

if (mode === 'check' && failed) {
  console.error('Run: pnpm generate:ddl');
  process.exit(1);
}
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.error('Usage: node scripts/property-ddl.mjs --write | --check | --self-test');
  process.exit(2);
}
