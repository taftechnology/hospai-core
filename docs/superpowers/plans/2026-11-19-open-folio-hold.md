# Open folio — bill on hold (R4.23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Ready for controller execution
>
> **Spec/plan writers do not commit.** This session forbids commits. Every step that would normally commit says **Do NOT commit — leave changes unstaged/uncommitted**. Work on `main`. No push. Do not stash/reset/checkout.

**Goal:** Ship R4.23 open-folio holds — place/extend/release on the GUEST window, post-checkout charge gate, checkout-by-hold, three night-audit checks, auto-open/auto-close inside `POST_ROOM_CHARGES`, and the Folio / Folios / Settings SPA — without growing `NIGHT_AUDIT_STEPS`.

**Architecture:** A hold is an append-only record (`folio_hold` + `folio_hold_event`) on `<res>:GUEST`, never a window state. Desk charge paths into GUEST call one helper that refuses `checked_out` stays without an ACTIVE hold. Checkout with an ACTIVE hold passes the balance gate and stamps `heldBy` / `folio.balance_due.held`. Night-audit automation runs inside the existing `POST_ROOM_CHARGES` step (per-row try/catch). Config DOMAIN key `pms.folio.open_folio` is read inside every DO transaction that needs it.

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts` catalog/routes/permissions/config/night-audit checks, `@hospai/do-runtime` migrations, React SPA (`apps/web-pms` + `@hospai/ui-kit` + `@hospai/client-core`), vitest (pms-core **8 shards** via `scripts/test-pms-core-shards.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-19-open-folio-hold-design.md` (Accepted). Roadmap R4.23 (READ ONLY — do not edit `docs/roadmap.md`).

---

## Global Constraints

- **Do NOT commit** — leave all changes unstaged/uncommitted. No push, stash, reset, or checkout.
- **Do NOT edit** `docs/roadmap.md`.
- **D1–D9 locked** — do not reopen (see Locked behaviour). D9 = auto-open and auto-close **inside `POST_ROOM_CHARGES`** only; do not add a night-audit step.
- **Characterization first:** Task 1 must **pass on today's code** (charge after checkout without hold succeeds). Production gate flip is a later task.
- **Pins AFTER this slice (same work):** `COMMAND_CATALOG` **125** (+3); `V1_HTTP_ROUTE_AUDIT` **204** (+5), last id **`get_open_folios`**; `AUDIT_WRITER_COMMAND_IDS` **91** (+3); `PROPERTY_SCHEMA_HEAD` **50**; `NIGHT_AUDIT_CHECK_IDS` **10** (+3); `NIGHT_AUDIT_STEPS` unchanged (length 8, `[3]==='AUTO_TRANSFER'`). Update `AGENTS.md` pins heading to **"After roadmap R4.23 …"** and the R1.10 night-audit operator spec check list.
- **Permission `folio:hold`:** admin (explicit); owner via `GRANTABLE_PERMISSIONS`; **not** staff.
- **Idempotency:** fingerprint `{ commandId, payload }` over the object sent; key in **`x-idempotency-key`** (same as `post_reservation_check_out`); per-user key at the DO boundary.
- **New errors** all **422** in the single `commandErrorHttpStatus` table: `open_folio_disabled`, `hold_already_active`, `no_active_hold`, `checked_out_requires_hold`.
- **No `await` inside `transactionSync`.** Bind SQL; identifiers are constants.
- **Every new property route:** `permission` on route def, `V1_HTTP_ROUTE_AUDIT`, `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`, JSON via parse helper, array caps (open-folios list cap **200**).
- **SPA:** ui-kit only; `classifiedUserMessage` + operator copy for the four new codes; settled `Alert` on success; op ids rotate after success; query keys `['folio-hold', propertyId, reservationId]` and `['open-folios', propertyId]` asserted in tests; local invalidate folio + board keys; never print raw codes/enums/UUIDs.
- **pms-core tests:** single-file via `pnpm --filter @hospai/pms-core exec vitest run test/<file>.spec.ts`. Never unsharded full pms-core. Do **not** put `--` before `--shard`. Run `node scripts/test-pms-core-shards.mjs` **once** at the end of the last task.
- **Two-pass zoned dates** if touching wall-clock (`zonedMidnightMs` pattern); stay/business calendar dates via `addCalendarDays` / business date — not naked `Date` across RPC.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **D1** | Hold = record on GUEST window; never window state; never deleted; ≤1 ACTIVE per window (partial unique index); history in `folio_hold_event`. |
| **D2** | Permission `folio:hold` places/extends/releases. Admin has it; owner via `GRANTABLE_PERMISSIONS`; staff does not. Approver = acting user (no two-person flow). |
| **D3** | DOMAIN `pms.folio.open_folio` default `{ enabled: false, followUpDays: 3, closeByDays: 14, autoOpenOnDepartWithBalance: false, autoCloseAtZeroAfterDays: null }`. Ranges: followUpDays 0–60; closeByDays 1–180 (≥ followUpDays); autoCloseAtZeroAfterDays null or 0–30. pms-core reads every field inside the DO transaction. `enabled: false` → place → `422 open_folio_disabled`; existing holds keep working. |
| **D4** | Checked-out + positive charge onto **GUEST** → ACTIVE hold required else `422 checked_out_requires_hold`. One helper for every desk charge path into GUEST (inventory below). Not payments/refunds/voids/discounts/transfers-out. COMPANY untouched. CLOSED window still `window_closed`; hold never reopens. |
| **D5** | Checkout with ACTIVE hold: balance gate passes (no `overrideBalance`); audit `heldBy: holdId`; emit `folio.balance_due` with `held: true`. Window stays OPEN; `close_window_on_check_out` only at zero as today. |
| **D6** | Place on `checked_in` or `checked_out`, OPEN GUEST, no ACTIVE hold. reason 1–200; notes ≤1000; followUpDate ≥ business date; closeByDate ≥ followUpDate (defaults from D3); expectedSettlement ≤120. Errors: `hold_already_active`, `window_closed`, `invalid_request`. |
| **D7** | Extend: followUp/closeBy + required reason. Release: required reason → RELEASED. Closing at zero via existing `folio.close_window` marks ACTIVE hold CLOSED + `closed` event in same txn. |
| **D8** | Checks `open_folio_unsettled`, `open_folio_past_close_by`, `open_folio_zero_balance` (default `warn`). Steps unchanged. |
| **D9** | Auto-open + auto-close inside **`POST_ROOM_CHARGES`**. Per-row try/catch; fail → log + skip; step continues. Auto-open: checked out on closing business date, GUEST balance > 0, no ACTIVE hold → system hold (`approvedBy: 'system:night_audit'`, reason `auto_open`). Auto-close: ACTIVE hold, GUEST balance 0 for ≥ `autoCloseAtZeroAfterDays` business days (latest line business date) → `closeFolioWindowSync` + mark hold CLOSED. |
| **Idempotency** | `{commandId, payload}`; header `x-idempotency-key`; per-user. |
| **Commits** | **Do NOT commit — leave changes unstaged/uncommitted.** |

### D4 charge-path inventory (gate these; list in PR)

**Gated — call `assertGuestChargeAllowedSync(reservationId)` (name below) before inserting a positive charge onto GUEST:**

| Path | Command / helper | Notes |
|---|---|---|
| Desk add line | `folio.add_item` → `tryAddFolioLine` → `insertTaxableChargeSync` | Primary SPA path; always GUEST today |
| Desk cancel/no-show penalty | `postDeskPenaltySync` (from cancel / no-show) | Positive DESK charge on GUEST; helper no-ops unless status is `checked_out` |

**Explicitly NOT gated (do not call the helper):**

| Path | Why |
|---|---|
| `folio.record_cash_payment` / `record_upi_payment` / `authorize` / `capture` / `capture_due` / `reconcile_payment` | Payments |
| `folio.refund` / `folio.void` / `folio.post_discount` | Refunds / voids / discounts |
| `folio.transfer_charge` (out) / `folio.split_charge` | Transfers out / splits |
| `folio.post_fx_adjustment` / `folio.record_chargeback` | Money-ops adjustments, not desk bill-on-hold charges |
| `postRoomChargesSync` / `postAuditNoShowPenaltySync` | Night-audit / system |
| Any COMPANY window insert | AGENTS §2; COMPANY untouched |

---

## Sequencing gate

```
Task 1   §1 characterization (passes on today's code — no production flip)
Task 2   Migration 0050 + purge inventory + schema head 50
Task 3   Permission, config key, error codes, night-audit check ids (+ contracts pins)
Task 4   Commands place/extend/release + close_window closes hold + HTTP + client-core
Task 5   Flip characterization + D4 helper + D5 checkout-by-hold
Task 6   Read routes get_folio_hold + get_open_folios
Task 7   Night-audit check counts + POST_ROOM_CHARGES auto-open/auto-close
Task 8   SPA FolioScreen card + checkout label + charge disable + copy
Task 9   SPA Open folios list + Settings + night-audit links + cache-key tests
Task 10  AGENTS pins + R1.10 check-list + me.test mirror
Task 11  Final verification (full ci.yml + shards)
```

---

## File map

| File | Task | Change |
|---|---|---|
| `apps/pms-core/test/open-folio.spec.ts` | 1, 5, 6, 7 | **Create** — §1 characterization; flip + hold/checkout/night-audit cases |
| `packages/do-runtime/src/property-migrations.ts` | 2 | Migration version **50** `folio_hold` |
| `migrations/do-property/0050_folio_hold.sql` | 2 | Generated via `pnpm generate:ddl` |
| `packages/do-runtime/src/migrate.test.ts` | 2 | `PROPERTY_SCHEMA_HEAD` **50**; v50 name |
| `scripts/property-ddl.mjs` | 2 | Regenerated / self-test still green |
| `apps/pms-core/src/property-do.ts` | 2–7 | Purge tables; try* holds; D4 helper; D5 checkout; close_window closes hold; night-audit checks + POST_ROOM_CHARGES automation |
| `packages/contracts/src/permissions.ts` | 3 | `folio:hold` in PROPERTY_SCOPED + admin ROLE_GRANTS |
| `packages/contracts/src/idempotency.ts` | 3 | Four new error constants |
| `apps/pms-core/src/command-error-http.ts` | 3 | All four → 422 |
| `packages/contracts/src/config/register.ts` | 3 | `pms.folio.open_folio` DOMAIN entry |
| `packages/contracts/src/night-audit-checks.ts` | 3, 7 | +3 ids, schema, defaults |
| `packages/contracts/src/commands/catalog.ts` | 4 | +3 commands INTERACTIVE / pms.core / folio:hold / idempotent |
| `packages/contracts/src/commands/audit-writers.ts` | 4 | +3 |
| `packages/contracts/src/v1-http-routes.ts` | 4, 6 | +5 routes; last `get_open_folios` |
| `packages/contracts/src/register.test.ts` | 3, 4, 6, 10 | Pins 125 / 204 / 91 / checks 10 |
| `apps/pms-core/src/v1-dispatch.ts` | 4, 6 | Handlers + V1_ROUTES wiring |
| `apps/pms-core/src/replay-dispatch.ts` | 4 | Replay entries for three commands |
| `packages/client-core/src/api.ts` | 4, 6, 8 | place/extend/release/get hold / open-folios |
| `packages/client-core/test/api-folio.test.ts` | 4, 6 | Client method coverage |
| `apps/web-pms/src/copy/classified-user-message.ts` | 8 | Four operator messages |
| `apps/web-pms/src/copy/classified-user-message.test.ts` | 8 | Assert four codes |
| `apps/web-pms/src/copy/night-audit-check-labels.ts` | 9 | Labels + descriptions for three checks |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 8 | Open folio card; checkout label; charge disable |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | 8, 9 | Card/dialogs/checkout/charge/cache keys |
| `apps/web-pms/src/screens/FoliosDirectoryScreen.tsx` | 9 | Open folios section |
| `apps/web-pms/src/screens/FoliosDirectoryScreen.test.tsx` | 9 | List + overdue Badge + links |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | 9 | Open folio settings group |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | 9 | Fields save |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | 9 | checkLink → open folios for three ids |
| `apps/web-pms/src/screens/NightAuditScreen.test.tsx` | 9 | Link targets |
| `apps/web-pms/src/auth/me.test.ts` | 10 | staff lacks `folio:hold`; admin-shaped has it |
| `AGENTS.md` | 10 | Pins table after R4.23 |
| `docs/superpowers/specs/2026-10-30-night-audit-operator-job-design.md` | 10 | Check list: open-folio checks shipped |

**Not touched:** `docs/roadmap.md`; `NIGHT_AUDIT_STEPS`; POS bill hold; R4.14 register report; COMPANY holds; two-person approval; Playwright.

---

## Normative scope-out (matches spec §8)

- Source-module bypass controls.
- A generic document hold.
- POS bill hold (R4.21).
- The open-folio register report (R4.14, Q10).
- Two-person approval (Q12).
- Hold on COMPANY windows.

---

### Task 1: §1 characterization — charge after checkout succeeds today

**Files:**
- Create: `apps/pms-core/test/open-folio.spec.ts`

**Interfaces:**
- Consumes: existing `tryCheckOut` with `overrideBalance`, `tryAddFolioLine`, fixtures from `apps/pms-core/test/folio-windows.spec.ts` / `./fixtures` / `./guest-helpers` / `./date-helpers`.
- Produces: green characterization proving today's hole (input for Task 5 flip).

**Reference paths (read before coding):**
- Checkout override: `apps/pms-core/test/folio-windows.spec.ts` case 3 (~174).
- `tryAddFolioLine`: `apps/pms-core/src/property-do.ts` ~21514 — reservation exists + window OPEN only.
- Default `pms.folio.close_window_on_check_out` is `false` (GUEST stays OPEN after override checkout).

- [ ] **Step 1: Write the characterization that must pass on today's code**

Create `apps/pms-core/test/open-folio.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WINDOW_CLOSED } from '@hospai/contracts';
import { addCalendarDays } from './date-helpers';
import {
  idemFor,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './fixtures';
import { provisionedPropertyWithGuest } from './guest-helpers';

describe('open folio — characterization (R4.23 §1)', () => {
  it('checked_out with OPEN GUEST (overrideBalance): folio.add_item still posts today', async () => {
    const propertyId = crypto.randomUUID();
    const { stub, guestRef } = await provisionedPropertyWithGuest(propertyId, 'UTC', 'USD');
    // Mirror folio-windows: room type, room, create, check-in, post a charge, checkout with overrideBalance:true
    // leaving GUEST OPEN (default close_window_on_check_out false).
    const reservationId = `res_of_char_${crypto.randomUUID().slice(0, 8)}`;
    // … seed stay checked_in, add charge so balance > 0, then:
    const co = await stub.tryCheckOut(
      TEST_OWNER_ACTOR,
      { reservationId, overrideBalance: true },
      await idemFor(`co-${reservationId}`, { reservationId, overrideBalance: true }),
    );
    expect(co).toMatchObject({ ok: true });

    const late = {
      folioLineId: crypto.randomUUID(),
      reservationId,
      chargeCode: 'MISC', // or a seeded active code used by sibling specs
      amountMinor: 500,
    };
    const added = await stub.tryAddFolioLine(
      TEST_OWNER_ACTOR,
      late,
      await idemFor(`late-${reservationId}`, late),
    );
    // TODAY: must succeed (documents the hole). Task 5 flips this expect.
    expect(added).toMatchObject({ ok: true, folioLineId: late.folioLineId });
  });
});
```

Use the same room-type / check-in helpers as `folio-windows.spec.ts` (`stayCheckedIn` pattern or `provisionedPropertyWithGuest`). Do **not** encode the future gate. Do **not** call any hold API yet.

- [ ] **Step 2: Run — must PASS on today's code**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
```

Expected: PASS. If FAIL, fix the test setup (not production) until it passes while still asserting a successful post-checkout charge.

- [ ] **Step 3: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 2: Migration `0050_folio_hold` + purge + schema head 50

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` (header comment + version 50 entry)
- Create (via generate): `migrations/do-property/0050_folio_hold.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts` (expect head **50**, v50 name `folio_hold`)
- Modify: `apps/pms-core/src/property-do.ts` — `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` SQL sums

**Interfaces:**
- Produces: tables `folio_hold`, `folio_hold_event`; `PROPERTY_SCHEMA_HEAD === 50`.

- [ ] **Step 1: Add migration statements in do-runtime**

In `packages/do-runtime/src/property-migrations.ts`, set header to `PROPERTY_SCHEMA_HEAD = 50` and append:

```ts
const FOLIO_HOLD_V50_STATEMENTS: string[] = [
  `CREATE TABLE folio_hold (
  hold_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  folio_window_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CLOSED')),
  reason TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT NOT NULL,
  close_by_date TEXT NOT NULL,
  expected_settlement TEXT,
  approved_by TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_reason TEXT
)`,
  `CREATE UNIQUE INDEX folio_hold_one_active ON folio_hold (folio_window_id) WHERE status = 'ACTIVE'`,
  `CREATE TABLE folio_hold_event (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
)`,
];

// … in PROPERTY_MIGRATIONS array:
{
  version: 50,
  name: 'folio_hold',
  statements: FOLIO_HOLD_V50_STATEMENTS,
},
```

- [ ] **Step 2: Regenerate DDL + update migrate test**

```bash
pnpm generate:ddl
```

In `packages/do-runtime/src/migrate.test.ts`: assert `PROPERTY_SCHEMA_HEAD` is **50**; assert migration 50 name is `folio_hold`.

- [ ] **Step 3: Purge inventory**

In `PROPERTY_PURGE_INVENTORY_TABLES` add `'folio_hold'` and `'folio_hold_event'` (alphabetically near other `folio_*`). Extend `countPropertyInventoryRows` with matching `(SELECT COUNT(*) FROM folio_hold) +` and `folio_hold_event` terms (same pattern as `folio_window`).

- [ ] **Step 4: Verify**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
pnpm check:ddl
pnpm check:purge
node scripts/property-ddl.mjs --self-test
node scripts/purge-check.mjs --self-test
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 3: Permission, config, errors, night-audit check ids

**Files:**
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `apps/pms-core/src/command-error-http.ts`
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/night-audit-checks.ts`
- Modify: `packages/contracts/src/register.test.ts` (check length **10**; permission/config assertions; leave catalog/route length bumps for Tasks 4–6 if those entries are not yet present — if you add pin expects early, add the catalog/route stubs in the same task)

**Interfaces:**
- Produces: `Permission` includes `folio:hold`; config key `pms.folio.open_folio`; four error string constants; three check ids default `warn`.

- [ ] **Step 1: Failing contracts assertions**

In `register.test.ts` (or extend existing blocks):

```ts
expect(NIGHT_AUDIT_CHECK_IDS).toHaveLength(10);
expect(NIGHT_AUDIT_CHECK_IDS).toEqual([
  'arrivals_not_checked_in',
  'departures_not_checked_out',
  'cashier_shift_open',
  'dirty_room_assigned',
  'departed_with_balance',
  'id_proof_missing',
  'arrival_deposit_missing',
  'open_folio_unsettled',
  'open_folio_past_close_by',
  'open_folio_zero_balance',
]);
expect(NIGHT_AUDIT_CHECKS_DEFAULT.open_folio_unsettled).toBe('warn');
// … same for past_close_by and zero_balance

expect(PROPERTY_SCOPED_PERMISSIONS).toContain('folio:hold');
expect(ROLE_GRANTS.admin).toContain('folio:hold');
expect(ROLE_GRANTS.staff).not.toContain('folio:hold');
expect(GRANTABLE_PERMISSIONS).toContain('folio:hold'); // owner

const openFolio = CONFIG_REGISTER.find((x) => x.key === 'pms.folio.open_folio');
expect(openFolio?.class).toBe('DOMAIN');
expect(openFolio?.default).toEqual({
  enabled: false,
  followUpDays: 3,
  closeByDays: 14,
  autoOpenOnDepartWithBalance: false,
  autoCloseAtZeroAfterDays: null,
});
```

Also assert `commandErrorHttpStatus` mapping in a pms-core test or contracts-adjacent spot once constants exist (Task 5's open-folio.spec can assert 422).

- [ ] **Step 2: Run contracts tests — expect FAIL**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

- [ ] **Step 3: Implement permission**

In `packages/contracts/src/permissions.ts`:

- Add `'folio:hold'` to `PROPERTY_SCOPED_PERMISSIONS` immediately after `'folio:adjust'`.
- Add `'folio:hold'` to `ROLE_GRANTS.admin` after `'folio:adjust'`.
- Do **not** add to `ROLE_GRANTS.staff`. Owner already gets it via `GRANTABLE_PERMISSIONS`.

- [ ] **Step 4: Implement error constants + HTTP status**

In `packages/contracts/src/idempotency.ts`:

```ts
export const OPEN_FOLIO_DISABLED = 'open_folio_disabled' as const;
export const HOLD_ALREADY_ACTIVE = 'hold_already_active' as const;
export const NO_ACTIVE_HOLD = 'no_active_hold' as const;
export const CHECKED_OUT_REQUIRES_HOLD = 'checked_out_requires_hold' as const;
```

In `apps/pms-core/src/command-error-http.ts`, import and map each to **422** in the single `commandErrorHttpStatus` switch (same arm as other validation domain errors).

- [ ] **Step 5: Config DOMAIN key**

In `packages/contracts/src/config/register.ts`, after the other `pms.folio.*` entries:

```ts
entry({
  key: 'pms.folio.open_folio',
  prototypeKey: null,
  class: 'DOMAIN',
  schema: z
    .object({
      enabled: z.boolean(),
      followUpDays: z.number().int().min(0).max(60),
      closeByDays: z.number().int().min(1).max(180),
      autoOpenOnDepartWithBalance: z.boolean(),
      autoCloseAtZeroAfterDays: z.number().int().min(0).max(30).nullable(),
    })
    .strict()
    .refine((v) => v.closeByDays >= v.followUpDays, { message: 'closeByDays_lt_followUpDays' }),
  default: {
    enabled: false,
    followUpDays: 3,
    closeByDays: 14,
    autoOpenOnDepartWithBalance: false,
    autoCloseAtZeroAfterDays: null,
  },
  consumersExempt: true, // DO reads inside txn; no ARI/night-schedule consumer flags required
}),
```

- [ ] **Step 6: Night-audit check ids**

In `packages/contracts/src/night-audit-checks.ts`, append the three ids to `NIGHT_AUDIT_CHECK_IDS`, `NightAuditChecksSchema`, and `NIGHT_AUDIT_CHECKS_DEFAULT` (all `'warn'`).

- [ ] **Step 7: Re-run contracts tests**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
```

Expected: PASS for permission/config/check assertions (catalog/route length may still be old until Task 4 — only bump those expects when the entries land).

- [ ] **Step 8: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 4: Commands place / extend / release + HTTP + close_window closes hold

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts` (three POST routes; GETs in Task 6)
- Modify: `packages/contracts/src/register.test.ts` — catalog **125**, audit writers **91** (route length **204** after Task 6)
- Modify: `apps/pms-core/src/property-do.ts` — `tryPlaceFolioHold`, `tryExtendFolioHold`, `tryReleaseFolioHold`; mark hold CLOSED inside `tryCloseFolioWindow` / `closeFolioWindowSync` path when ACTIVE
- Modify: `apps/pms-core/src/v1-dispatch.ts` — handlers using `requireIdempotencyHeader`, `parseJsonBody` / shared JSON helper, `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`, `commandFingerprint`
- Modify: `apps/pms-core/src/replay-dispatch.ts`
- Modify: `packages/client-core/src/api.ts` + `packages/client-core/test/api-folio.test.ts`
- Extend: `apps/pms-core/test/open-folio.spec.ts` — place/extend/release/idempotency/permission/disabled cases (spec §6 items 4–6 partial)

**Interfaces:**
- Consumes: D3 config reader; migration tables; `folio:hold` permission.
- Produces:

```ts
// tryPlaceFolioHold input
{
  reservationId: string;
  reason: string;           // 1–200
  notes?: string;           // ≤1000
  followUpDate?: string;    // default businessDate + followUpDays
  closeByDate?: string;     // default businessDate + closeByDays
  expectedSettlement?: string; // ≤120
}
// success: { ok: true, holdId: string }
// errors: open_folio_disabled | hold_already_active | window_closed | invalid_request | not_found | forbidden | …

// tryExtendFolioHold: { reservationId, reason, followUpDate?, closeByDate? } — at least one date; requires ACTIVE
// tryReleaseFolioHold: { reservationId, reason } — ACTIVE → RELEASED
```

HTTP (permission `folio:hold`, entitlement `pms.core`, kill-switch on via catalog):

| Route id | Method / path |
|---|---|
| `post_folio_hold` | `POST /v1/properties/:propertyId/reservations/:reservationId/folio-hold` |
| `post_folio_hold_extend` | `POST …/folio-hold/extend` |
| `post_folio_hold_release` | `POST …/folio-hold/release` |

Catalog entries: `folio.place_hold`, `folio.extend_hold`, `folio.release_hold` — `lane: 'INTERACTIVE'`, `degraded: 'FAIL_CLOSED'` (or match sibling folio adjust FAIL_CLOSED), `idempotent: true`, `permission: 'folio:hold'`, `entitlement: 'pms.core'`, audit writers, kill-switch applies (mutating entitled commands).

- [ ] **Step 1: Write failing open-folio command tests**

Append to `open-folio.spec.ts` (enable config via `writeConfigValueForTest('pms.folio.open_folio', { …enabled: true… })`):

```ts
describe('folio.place_hold / extend / release', () => {
  it('place while disabled → open_folio_disabled', async () => { /* default enabled false */ });
  it('place on checked_in OPEN GUEST → ACTIVE + placed event + audit', async () => {});
  it('second ACTIVE → hold_already_active; same idempotency key → one hold', async () => {});
  it('place on CLOSED window → window_closed', async () => {});
  it('extend + release write events; after release status RELEASED', async () => {});
  it('folio.close_window at zero marks ACTIVE hold CLOSED with closed event', async () => {});
  it('actor without folio:hold → forbidden', async () => {
    // use a staff-shaped actor fixture if the suite has one; else gatePermission denial path
  });
});
```

- [ ] **Step 2: Run — expect FAIL (methods missing)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
```

- [ ] **Step 3: Catalog + audit writers + POST routes**

Add three catalog rows and three `AUDIT_WRITER_COMMAND_IDS` entries. Append three `V1_HTTP_ROUTE_AUDIT` rows (GETs come in Task 6 — do not claim length 204 yet unless both GET routes are added here).

Wire `V1_ROUTES` handlers modeled on `handlePostReservationCheckOut` (header idempotency) and `handlePostFolioWindowClose` (property resolve + fingerprint).

Replay-dispatch: map `folio.place_hold` / `extend_hold` / `release_hold` to the new try* methods.

- [ ] **Step 4: Implement try* in PropertyDO**

Shared helpers (private, sync, no await):

```ts
private readOpenFolioConfigSync(): {
  enabled: boolean;
  followUpDays: number;
  closeByDays: number;
  autoOpenOnDepartWithBalance: boolean;
  autoCloseAtZeroAfterDays: number | null;
} { /* merge register default with stored object */ }

private readActiveHoldSync(folioWindowId: string): /* row | null */

private insertHoldEventSync(…): void

private placeHoldSync(args: {
  reservationId: string;
  reason: string;
  notes: string | null;
  followUpDate: string;
  closeByDate: string;
  expectedSettlement: string | null;
  approvedBy: string;
  actor: ActorContext;
}): { holdId: string }
```

Place rules (D6): reservation status `checked_in` | `checked_out`; GUEST OPEN (`assertFolioWindowOpenSync`); no ACTIVE; `enabled` true else `OPEN_FOLIO_DISABLED`; validate lengths/dates against `readBusinessDateSync()`; defaults from config days via `addCalendarDays`-equivalent calendar math already used in DO (stay date helpers — not wall-clock).

On `tryCloseFolioWindow` success path when closing GUEST at zero: if ACTIVE hold exists, set status CLOSED, `ended_at`, `ended_reason` (e.g. `window_closed`), insert `closed` event, same transaction.

- [ ] **Step 5: client-core API**

```ts
async placeFolioHold(propertyId, reservationId, body, opId) // header x-idempotency-key via stableKeyForOperation
async extendFolioHold(...)
async releaseFolioHold(...)
```

- [ ] **Step 6: Re-run tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts
```

Expected: place/extend/release cases PASS. Characterization from Task 1 still PASS (gate not flipped yet).

- [ ] **Step 7: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 5: Flip characterization + D4 charge helper + D5 checkout-by-hold

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `assertGuestChargeAllowedSync`; call sites from inventory; `tryCheckOut` balance/audit/outbox
- Modify: `apps/pms-core/test/open-folio.spec.ts` — flip §1; add hold charge + payment + checkout cases (spec §6 items 1–3, 9)

**Interfaces:**
- Produces:

```ts
/** Throws CheckedOutRequiresHoldError → CHECKED_OUT_REQUIRES_HOLD when:
 *  reservation.status === 'checked_out'
 *  AND target window is GUEST
 *  AND no ACTIVE hold on that window.
 *  CLOSED window still throws WindowClosedError first (call after assertFolioWindowOpenSync).
 */
private assertGuestChargeAllowedSync(reservationId: string, folioWindowId: string): void
```

- [ ] **Step 1: Flip characterization + add gate tests (RED)**

Replace Task 1 expectation:

```ts
expect(added).toMatchObject({ ok: false, error: CHECKED_OUT_REQUIRES_HOLD });
// assert no new folio_line for late.folioLineId
```

Add:

```ts
it('with ACTIVE hold, charge on checked_out GUEST posts', async () => {});
it('payment on checked_out without hold still posts', async () => {});
it('CLOSED GUEST refuses charge with window_closed whether or not hold exists', async () => {});
it('checkout with ACTIVE hold + balance: ok without overrideBalance; audit heldBy; balance_due held:true', async () => {});
it('checkout without hold + balance + no override → balance_due', async () => {});
it('COMPANY window charge path unchanged by hold ops', async () => {});
```

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
```

Expected: flipped case FAIL until production gate lands.

- [ ] **Step 2: Implement D4 helper + call sites**

Inside `tryAddFolioLine` transaction, after ensuring GUEST window id and **after** open-window assert path used by `insertTaxableChargeSync` / `insertFolioLineSync` (today open check is inside `insertFolioLineSync` ~19792): call `assertGuestChargeAllowedSync(reservationId, folioWindowId)` immediately before `insertTaxableChargeSync`.

Also call from `postDeskPenaltySync` before `insertTaxableChargeSync` (safe no-op unless somehow `checked_out`).

Map new error in `tryAddFolioLine` catch like `WINDOW_CLOSED`.

Do **not** gate payment/refund/void/discount/transfer/FX/chargeback/night-audit paths.

- [ ] **Step 3: Implement D5 checkout**

In `tryCheckOut` balance gate (~12673):

```ts
const activeHold = this.readActiveHoldSync(guestWindowId);
const heldOpen = activeHold !== null;
if (
  requireZero &&
  balanceMinor > 0 &&
  !heldOpen &&
  !(input.overrideBalance === true && allowOverride)
) {
  throw new BalanceDueError(balanceMinor);
}
```

Audit `afterJson`: when `heldOpen`, include `heldBy: activeHold.hold_id` (do not require `overrideBalance`).

`folio.balance_due` payload: add `held: true` when `heldOpen` (and keep `overridden` semantics for override path without hold).

- [ ] **Step 4: Re-run open-folio.spec.ts**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 6: Read routes — `get_folio_hold` + `get_open_folios`

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append both; **last id `get_open_folios`**
- Modify: `packages/contracts/src/register.test.ts` — `V1_HTTP_ROUTE_AUDIT` length **204**, last id `get_open_folios`
- Modify: `apps/pms-core/src/property-do.ts` — `tryGetFolioHold` / `tryListOpenFolios` (or sync read methods invoked from HTTP)
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `packages/client-core/src/api.ts` + tests
- Extend: `apps/pms-core/test/open-folio.spec.ts`

**Interfaces:**
- `GET …/folio-hold` → `{ ok: true, hold: ActiveHold | null, history: HoldEvent[] }` permission `folio:read`
- `GET /v1/properties/:propertyId/open-folios` → `{ ok: true, items: OpenFolioRow[] }` capped **200**, ordered by `close_by_date` ASC; each row: reservationId, roomCode (nullable), departureDate, balanceMinor, followUpDate, closeByDate, overdue (closeByDate < businessDate), holdId, reason, approvedBy — permission `folio:read`

- [ ] **Step 1: Failing read tests + route pin expects**

```ts
it('get hold returns null then active + history after place', async () => {});
it('open-folios lists ACTIVE with overdue flag; cap 200', async () => {});
```

Update `register.test.ts`:

```ts
expect(V1_HTTP_ROUTE_AUDIT).toHaveLength(204);
expect(V1_HTTP_ROUTE_AUDIT.at(-1)?.id).toBe('get_open_folios');
```

- [ ] **Step 2: Implement reads + wire routes**

Handlers: `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`; no idempotency on GET. SQL join reservation + room for room code; GUEST balance via `windowBalanceMinorSync` / SUM ledger.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts
pnpm check:permissions
```

Expected: PASS; catalog **125**, routes **204**, writers **91**.

- [ ] **Step 4: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 7: Night-audit checks + `POST_ROOM_CHARGES` automation

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `countNightAuditCheckSync` cases; inside `POST_ROOM_CHARGES` branch after/before `postRoomChargesSync` as fits (same txn B); private `runOpenFolioAutoOpenSync` / `runOpenFolioAutoCloseSync`
- Modify: `apps/pms-core/test/open-folio.spec.ts` — spec §6 items 7–8
- Modify: `apps/pms-core/test/night-audit-checks.spec.ts` — ordered list length **10**
- Touch labels in Task 9 for SPA; evaluator counts here

**Interfaces:**
- Check queries (business date `D`):
  - `open_folio_unsettled`: ACTIVE holds whose GUEST `SUM(ledger_amount_minor) > 0`
  - `open_folio_past_close_by`: ACTIVE holds with `close_by_date < D`
  - `open_folio_zero_balance`: ACTIVE holds whose GUEST balance `= 0`
- Auto-open (when `autoOpenOnDepartWithBalance`): reservations `checked_out` with `checked_out_business_date = D`, GUEST balance > 0, no ACTIVE hold → `placeHoldSync` with `approvedBy: 'system:night_audit'`, reason `auto_open`, default dates from config.
- Auto-close (when `autoCloseAtZeroAfterDays !== null`): each ACTIVE hold with balance 0 and latest folio_line `business_date` (or window activity) ≤ `D − N` days → `closeFolioWindowSync` + mark hold CLOSED + `closed` event. Per-row try/catch; log failure; continue.

- [ ] **Step 1: Write failing night-audit tests**

```ts
describe('open folio night audit (R4.23 D8/D9)', () => {
  it('past close-by counts in preview and PRE_CHECK under open_folio_past_close_by', async () => {});
  it('unsettled and zero-balance counts are correct', async () => {});
  it('severity config accepts the three ids; NIGHT_AUDIT_STEPS length unchanged (8)', async () => {});
  it('auto-open places system hold for departed-with-balance when enabled', async () => {});
  it('auto-close closes zero-balance hold after N days', async () => {});
  it('one failing auto-open/close row does not stop the others', async () => {});
});
```

In `night-audit-checks.spec.ts`, update ordered `checkId` length expectation to **10**.

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts test/night-audit-checks.spec.ts
```

- [ ] **Step 3: Implement counts**

Extend `countNightAuditCheckSync` switch with three SQL branches (join `folio_hold` → `folio_window` kind GUEST → SUM lines). Read config via existing night-audit checks map (ids already in schema from Task 3).

- [ ] **Step 4: Implement automation inside POST_ROOM_CHARGES**

In `runAuditStep` txn B where `step === 'POST_ROOM_CHARGES'` (~3819):

```ts
} else if (step === 'POST_ROOM_CHARGES') {
  if (this.readConfigValueSync('pms.night_audit.auto_extend') === true) {
    this.runAutoExtendSync(businessDate);
  }
  this.postRoomChargesSync(businessDate);
  this.runOpenFolioNightAuditAutomationSync(businessDate); // auto-open + auto-close; per-row catch
}
```

Inside automation: read full `pms.folio.open_folio` object; if auto-open flag false skip open loop; if `autoCloseAtZeroAfterDays === null` skip close loop. Never throw out of the step for a single row failure — catch, write provisional_exception or structured log consistent with other per-row night-audit patterns (`postRoomChargesSync` failedCount style), continue.

- [ ] **Step 5: Re-run**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts test/night-audit-checks.spec.ts
```

Expected: PASS. Assert `NIGHT_AUDIT_STEPS.length === 8` and `[3] === 'AUTO_TRANSFER'` in the open-folio night-audit describe.

- [ ] **Step 6: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 8: SPA FolioScreen — Open folio card, checkout label, charge disable, copy

**Files:**
- Modify: `apps/web-pms/src/copy/classified-user-message.ts` + `.test.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` + `FolioScreen.test.tsx`
- Modify: `packages/client-core/src/api.ts` if any SPA-facing helpers remain

**Interfaces:**
- Query: `useQuery({ queryKey: ['folio-hold', propertyId, reservationId], … getFolioHold })`
- Mutations invalidate: `['folio-hold', propertyId, reservationId]`, `['open-folios', propertyId]`, `['folio', propertyId, reservationId]`, `['board']` (prefix the screen already uses)

Operator copy (exact intent; polish wording OK if tests match):

| Code | Operator sentence |
|---|---|
| `open_folio_disabled` | Open folio is off for this property. Turn it on in Settings → Folio. |
| `hold_already_active` | This stay already has an open-folio hold. |
| `no_active_hold` | There is no active open-folio hold on this stay. |
| `checked_out_requires_hold` | Place an open-folio hold to post charges after checkout. |

- [ ] **Step 1: Failing copy + FolioScreen tests**

In `classified-user-message.test.ts`, assert the four codes.

In `FolioScreen.test.tsx`:

- Card hidden/absent copy when status not `checked_in`/`checked_out`.
- No hold + `folio:hold` + enabled → Place hold opens Dialog; reason required.
- Active hold → details, Extend Dialog, Release `intent=destructive` with confirm + reason.
- Disabled config → "Open folio is off for this property" (+ Settings link when `settings:configure`).
- Checkout with hold → button **Check out on open folio**; skips Depart-with-open-balance override dialog.
- Checked-out without hold → post-charge controls disabled with the hold copy; server `checked_out_requires_hold` maps via `classifiedUserMessage`.
- After successful place/extend/release: settled `Alert`; op id rotates; invalidate keys include `folio-hold` and `open-folios` and folio/board.

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/copy/classified-user-message.test.ts \
  src/screens/FolioScreen.test.tsx
```

- [ ] **Step 3: Implement copy + FolioScreen UI**

ui-kit only: `Card`, `CardTitle`, `Button`, `Dialog`, `Field`, `Input`, `Alert`, `Badge` as needed. Prefill follow-up/close-by from config defaults (read property config key already loaded on Settings or a small config query — same pattern as other DomainBool screens; Folio may read `getDomainConfig` / existing property keys query). Never print hold UUID as the primary label (show dates/reason).

Checkout button label when `hold` active: **Check out on open folio**; `mutationFn(false)` without opening override dialog even if balance > 0.

- [ ] **Step 4: Re-run web-pms tests**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 9: SPA Open folios list + Settings + night-audit links

**Files:**
- Modify: `apps/web-pms/src/screens/FoliosDirectoryScreen.tsx` (+ test file create/extend)
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` + `.test.tsx`
- Modify: `apps/web-pms/src/copy/night-audit-check-labels.ts`
- Modify: `apps/web-pms/src/screens/NightAuditScreen.tsx` + `.test.tsx`
- Confirm: `settings-night-audit-checks.tsx` iterates `NIGHT_AUDIT_CHECK_IDS` (no logic change if typed correctly)

**Interfaces:**
- Open folios section query key: `['open-folios', propertyId]`
- Settings group saves whole `pms.folio.open_folio` object with existing reason-required config pattern (`putDomainConfig`)
- `checkLink` for the three open-folio check ids → Folios page open-folios anchor/section (e.g. `/folios#open-folios` or query `?section=open-folios`)

- [ ] **Step 1: Failing SPA tests**

- Folios directory: section renders rows; overdue → `Badge`; link to `/folio/:id`; empty vs error vs no matches distinct.
- Settings: Open folio fields (enabled switch, followUpDays, closeByDays, autoOpen switch, autoClose days or blank); save with reason.
- Night audit: three labels present; check links target open folios list.
- Cache-key assertion for `['open-folios', propertyId]` invalidation after hold mutation (may live in FolioScreen.test from Task 8 — assert here if not already).

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/FoliosDirectoryScreen.test.tsx \
  src/screens/SettingsScreen.test.tsx \
  src/screens/NightAuditScreen.test.tsx \
  src/screens/FolioScreen.test.tsx
```

- [ ] **Step 3: Implement**

**FoliosDirectoryScreen:** add **Open folios** `Card` above or below the existing directory using `api.listOpenFolios(propertyId)`. Overdue rows: `Badge`. Row action: `Link` `ui-link-btn` to folio. Cap is server-side 200.

**SettingsScreen Folio card:** add **Open folio** subgroup bound to `pms.folio.open_folio` (object save). Blank auto-close means `null`.

**Labels:**

```ts
open_folio_unsettled: 'Open folios with a balance',
open_folio_past_close_by: 'Open folios past close-by',
open_folio_zero_balance: 'Open folios at zero balance',
```

**NightAuditScreen `checkLink`:** for the three ids return `{ to: '/folios#open-folios', label: 'Open folios' }` (or the chosen query form — keep one).

- [ ] **Step 4: Re-run**

Same vitest command. Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 10: AGENTS pins + R1.10 check list + me.test mirror

**Files:**
- Modify: `AGENTS.md` — pins table heading **"After roadmap R4.23 (open folio — bill on hold, 2026-11-19)"** (or equivalent date) and values:
  - `COMMAND_CATALOG` **125**
  - `V1_HTTP_ROUTE_AUDIT` **204** routes, last id **`get_open_folios`**
  - `AUDIT_WRITER_COMMAND_IDS` **91**
  - `PROPERTY_SCHEMA_HEAD` **50**
  - `NIGHT_AUDIT_CHECK_IDS` length **10**, includes the three open-folio ids (and still `arrival_deposit_missing`)
  - `NIGHT_AUDIT_STEPS` unchanged note
- Modify: `docs/superpowers/specs/2026-10-30-night-audit-operator-job-design.md` — update the BluePMS / configurable check list so open-folio checks are no longer "lands in R4.23"; document the three ids as shipped configurable checks (counts only) with links to Open folios; keep "do not grow steps" language.
- Modify: `apps/web-pms/src/auth/me.test.ts` — staff-shaped permissions lack `folio:hold`; admin-shaped includes `folio:hold`
- Confirm: `packages/contracts/src/register.test.ts` pins all match

- [ ] **Step 1: Apply doc + me.test edits**

R1.10 table row that currently says open folios land in R4.23 → mark as built with the three check ids and automation-inside-`POST_ROOM_CHARGES` note. Add the three ids to the configurable checks documentation table (label + count definition + link Open folios).

- [ ] **Step 2: Verify pins + me tests**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/auth/me.test.ts
pnpm check:web-pms-me-gating
```

Expected: PASS.

- [ ] **Step 3: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 11: Final verification suite

**Files:** none intentional (fix only if a check fails with a one-line pin/type nit).

- [ ] **Step 1: Build + wrangler dry-run + every `check:*` + self-tests + typecheck + package tests + lint (ci.yml `checks` job order)**

Run in order:

```bash
pnpm install
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
pnpm check:error-mapper-singleton
pnpm check:resolve-property-prefetch
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

(`pnpm lint` runs `eslint .` on the full tree per AGENTS; if local eslint needs the ignore used in CI extras, use `pnpm exec eslint . --ignore-pattern '.claude/**'` as an additional pass matching the controller request.)

- [ ] **Step 2: pms-core shards once at end (never unsharded; no `--` before `--shard`)**

```bash
node scripts/test-pms-core-shards.mjs
```

Also ensure focused specs still green:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/open-folio.spec.ts
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/FolioScreen.test.tsx \
  src/screens/FoliosDirectoryScreen.test.tsx \
  src/copy/classified-user-message.test.ts
```

- [ ] **Step 3: Confirm pins**

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` | **125** |
| `V1_HTTP_ROUTE_AUDIT` | **204**, last **`get_open_folios`** |
| `AUDIT_WRITER_COMMAND_IDS` | **91** |
| `PROPERTY_SCHEMA_HEAD` | **50** |
| `ORG_SCHEMA_HEAD` | **13** (unchanged) |
| `NIGHT_AUDIT_CHECK_IDS` | **10** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3]==='AUTO_TRANSFER'` |

- [ ] **Step 4: Do NOT commit — leave changes unstaged/uncommitted**

---

## Self-review (plan author)

1. **Spec coverage:** §1 characterization (T1); D1–D3 data/permission/config (T2–T3); D6–D7 commands + close (T4); D4–D5 gate + checkout (T5); §4 reads (T6); D8–D9 checks + POST_ROOM_CHARGES (T7); §5 SPA (T8–T9); §7 pins + R1.10 list (T10); §6 tests distributed; §8 scope-out listed. Charge-path inventory locked for D4.
2. **Placeholders:** none intentional — no TBD/TODO/"similar to Task N".
3. **Type consistency:** hold statuses ACTIVE/RELEASED/CLOSED; event kinds placed/extended/released/closed; config object fields match D3; query keys `folio-hold` / `open-folios`; errors four codes → 422; automation step name `POST_ROOM_CHARGES`.
4. **Final CI:** Task 11 mirrors `.github/workflows/ci.yml` `checks` + local shard runner.
