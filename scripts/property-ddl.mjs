#!/usr/bin/env node
/**
 * Generate or check DDL SQL files against @hospai/do-runtime sources.
 *
 *   node scripts/property-ddl.mjs --write
 *   node scripts/property-ddl.mjs --check
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modPath = join(root, 'packages/do-runtime/dist/index.js');

const args = new Set(process.argv.slice(2));
const mode = args.has('--write') ? 'write' : args.has('--check') ? 'check' : null;
if (!mode) {
  console.error('Usage: node scripts/property-ddl.mjs --write | --check');
  process.exit(2);
}

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
let ORG_SPINE_SQL;
let ORG_GUEST_PII_SQL;
let ORG_ALARM_SCHEDULE_SQL;
let ORG_PROPERTY_MEMBER_SQL;
let PLATFORM_REGISTRY_SQL;
let PLATFORM_ENTITLEMENT_SQL;
let PLATFORM_SUBSCRIPTION_INVARIANT_SQL;
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
    ORG_SPINE_SQL,
    ORG_GUEST_PII_SQL,
    ORG_ALARM_SCHEDULE_SQL,
    ORG_PROPERTY_MEMBER_SQL,
    PLATFORM_REGISTRY_SQL,
    PLATFORM_ENTITLEMENT_SQL,
    PLATFORM_SUBSCRIPTION_INVARIANT_SQL,
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
];

let failed = false;
for (const t of targets) {
  const expected = t.header + t.sql;
  if (mode === 'write') {
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileSync(t.path, expected);
    console.log(`Wrote ${t.path}`);
  } else {
    let onDisk;
    try {
      onDisk = readFileSync(t.path, 'utf8');
    } catch {
      console.error(`Missing ${t.path}`);
      failed = true;
      continue;
    }
    if (onDisk !== expected) {
      console.error(`DDL drift: ${t.path}`);
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
