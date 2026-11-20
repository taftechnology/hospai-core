# Draft bill, splits and reversals (R4.29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Ready for controller execution
>
> **Spec/plan writers do not commit.** This session forbids commits. Every step that would normally commit says **Do NOT commit — leave changes unstaged/uncommitted**. Work on `main`. No push. Do not stash/reset/checkout.

**Goal:** Ship R4.29 — read-only draft bill (charge review + tariff check), N-part custom/equal splits via existing `folio.split_charge`, bulk same-stay `folio.transfer_charges`, high-privilege `folio:reverse` (invoice void + undo checkout), hold reactivation on window reopen, and an SPA settlement-cancel flow — without cross-reservation line transfer (F1), penalty void, credit notes, email/PDF files, or IRN state.

**Architecture:** Draft bill is a read that reuses `readReservationProformaSync` / `buildNightChargeLines` / `nightConsumedSync` / `rateNightAmountSync(..., { persist: false })`. Bulk transfer loops `transferFolioLineSync` all-or-nothing under one `transactionSync`. Undo checkout reopens stay + GUEST window in one txn and reactivates a `CLOSED`/`window_closed` hold. Settlement cancel is SPA-orchestrated separate calls (`invoice.void` → `folio.refund` → optional `reservations.undo_check_out`), not one server command.

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts` catalog/routes/permissions/limits, `@hospai/do-runtime` migration 51, `@hospai/money` `allocate`, React SPA (`apps/web-pms` + `@hospai/ui-kit` + `@hospai/client-core`), vitest (pms-core **8 shards** via `scripts/test-pms-core-shards.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-20-draft-bill-reversals-design.md` (Accepted). Roadmap R4.29 + fork F1 (READ ONLY — do not edit `docs/roadmap.md`).

---

## Global Constraints

- **Do NOT commit** — leave all changes unstaged/uncommitted. No push, stash, reset, or checkout.
- **Do NOT edit** `docs/roadmap.md`.
- **Follow `AGENTS.md`:** URL tenant owns the operation; `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` on every property handler; no `await` inside `transactionSync`; bind SQL; one `commandErrorHttpStatus` table; arrays capped at HTTP **and** RPC; idempotency fingerprint `{ commandId, payload }` (same object hashed as executed); money via integer minor units + `allocate`; ui-kit only; `classifiedUserMessage` for errors; never raw codes in SPA.
- **D1–D8 locked** — do not reopen. **F1:** line transfer to another reservation stays `transfer_cross_reservation` for both `folio.transfer_charge` and `folio.transfer_charges`.
- **Characterize-first (invoice.void):** permission moves `folio:adjust` → `folio:reverse` and **reason becomes required** (1–500). Existing tests that void without a reason or assert the old permission **must be updated in the same task** — named files below. Do not encode the old optional-reason behaviour as expected.
- **Pins AFTER this slice (same work):** `COMMAND_CATALOG` **127** (+2); `V1_HTTP_ROUTE_AUDIT` **207** (+3), last id **`get_reservation_draft_bill`**; `AUDIT_WRITER_COMMAND_IDS` **93** (+2); `PROPERTY_SCHEMA_HEAD` **51**; `ORG_SCHEMA_HEAD` **13** unchanged; `NIGHT_AUDIT_STEPS` / `NIGHT_AUDIT_CHECK_IDS` unchanged. Update `AGENTS.md` pins table in Task 1.
- **New limit:** `FOLIO_TRANSFER_BULK_MAX = 50` in `packages/contracts/src/request-limits.ts` (mirror `FOLIO_SPLIT_MAX`). Over cap → `422 limit_exceeded` at HTTP and RPC.
- **New error:** `check_out_not_today` → **422** in `commandErrorHttpStatus`.
- **Idempotency:**
  - `folio.transfer_charges`: body `idempotencyKey` (same as `post_folio_transfer`); fingerprint sorted `{ folioLineIds, destinationFolioWindowId }`.
  - `reservations.undo_check_out`: header **`x-idempotency-key`** (same as check-out); fingerprint `{ reservationId, reason }`.
  - `invoice.void`: when reason is required, fingerprint must include trimmed `reason` with `invoiceId` (object sent to DO).
- **pms-core tests:** single-file via `pnpm --filter @hospai/pms-core exec vitest run test/<file>.spec.ts`. Never unsharded full pms-core. Do **not** put `--` before `--shard`. Run `node scripts/test-pms-core-shards.mjs` **once** at the end of the last task.
- **Commits:** every task ends with **Do NOT commit — leave changes unstaged/uncommitted.**

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **D1** | Draft bill = read `get_reservation_draft_bill` for `checked_in` \| `checked_out`. No invoice number, no writes, no audit row. Final bill = existing `invoice.generate`. Append-only corrections. |
| **D2** | Draft payload: charge review (non-payment parents by window→charge code), tariff rows (`posted`/`unposted`/`future` via `nightConsumedSync` + business date), expected via `rateNightAmountSync(..., { persist: false })`, posted ROOM net (tax excluded, transfers net out), `mismatch` on posted nights, totals reuse proforma helpers, active invoice or null, guest header from proforma. |
| **D3** | Custom split = N parts 2–20 via existing `folio.split_charge`. Equal = SPA `allocate` then same command. Source-based = new `folio.transfer_charges` (≤50, sorted ids, all-or-nothing, `transferFolioLineSync` each). Cross-reservation → `transfer_cross_reservation` (F1). |
| **D4** | Permission `folio:reverse`: admin explicit; owner via `GRANTABLE_PERMISSIONS`; **not** staff. Guards `invoice.void` (moved from `folio:adjust`, reason required) and `reservations.undo_check_out`. `folio.refund` / `folio.void` unchanged. |
| **D5** | Void pending bill then regenerate via existing commands; voided number never reused. No penalty void. No IRN state in this slice. |
| **D6** | `reservations.undo_check_out`: same-day checkout only else `check_out_not_today`; no active invoice else `invoice_already_exists`; room free via `assertRoomVacantNowSync` + `assertRoomAssignableSync` over `[businessDate, departure)`; then `checked_in`, clear `checked_out_business_date`, reopen CLOSED GUEST via reopen writer, D7 hold, audit+reason, `reservation.status_changed`. No `availability_day` write; HK status untouched. |
| **D7** | On GUEST window reopen: latest hold `CLOSED` + `ended_reason='window_closed'` → `ACTIVE` + `reactivated` event; `RELEASED` never reactivated. Migration 51 rebuilds `folio_hold_event` kind CHECK to include `reactivated`. |
| **D8** | Cancel settlement = SPA flow only: reason → void invoice → refund selected payments → optional undo checkout (today only). Op ids `settlement-cancel:{reservationId}:{step}:{uuid}`; Retry failed steps only. |
| **F1** | Cross-reservation transfer stays rejected. |
| **Commits** | **Do NOT commit — leave changes unstaged/uncommitted.** |

---

## Sequencing gate

```
Task 1   Contracts: folio:reverse, FOLIO_TRANSFER_BULK_MAX, check_out_not_today, catalog/routes/writers, AGENTS pins
Task 2   Migration 51 folio_hold_event + reactivated kind + DDL regenerate
Task 3   invoice.void → folio:reverse + required reason (update existing void tests)
Task 4   Draft bill read (DO + HTTP + client) + characterization §4.1
Task 5   folio.transfer_charges + equal-split footing + F1 (§4.2, §4.3, §4.8)
Task 6   Hold reactivation helper + reservations.undo_check_out (§4.5, D7)
Task 7   Settlement-cancel HTTP sequence + hold reactivation e2e (§4.6, §4.7)
Task 8   SPA Draft bill view + print banner
Task 9   SPA Split dialog (Custom N / Equal) + Move charges
Task 10  SPA Void reason + Cancel settlement + me.test + copy + cache keys
Task 11  Final verification (full ci.yml checks + shards)
```

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/contracts/src/permissions.ts` | 1 | Add `folio:reverse` to `PROPERTY_SCOPED_PERMISSIONS` + `ROLE_GRANTS.admin` |
| `packages/contracts/src/request-limits.ts` | 1 | Add `FOLIO_TRANSFER_BULK_MAX = 50` |
| `packages/contracts/src/idempotency.ts` | 1 | Export `CHECK_OUT_NOT_TODAY = 'check_out_not_today'` |
| `packages/contracts/src/commands/catalog.ts` | 1 | +`folio.transfer_charges`, +`reservations.undo_check_out`; change `invoice.void` permission → `folio:reverse` |
| `packages/contracts/src/commands/audit-writers.ts` | 1 | +2 writer ids |
| `packages/contracts/src/v1-http-routes.ts` | 1 | +3 audit routes; change `post_invoice_void` permission → `folio:reverse`; last = `get_reservation_draft_bill` |
| `packages/contracts/src/register.test.ts` | 1 | Pins 127 / 207 / 93; permission grants; limit; last route id |
| `AGENTS.md` | 1 | Pins table → catalog 127, routes 207 last `get_reservation_draft_bill`, writers 93, schema head 51 |
| `packages/do-runtime/src/property-migrations.ts` | 2 | v51 rebuild `folio_hold_event` kind CHECK + copy |
| `migrations/do-property/0051_folio_hold_event_reactivated.sql` | 2 | Generated via `pnpm generate:ddl` / `property-ddl.mjs` target |
| `scripts/property-ddl.mjs` | 2 | Add 0051 target |
| `packages/do-runtime/src/migrate.test.ts` | 2 | Head 51; v51 accepts `reactivated`, keeps rows |
| `apps/pms-core/src/property-do.ts` | 3–7 | `tryVoidInvoice` gate+reason; `readReservationDraftBillSync`; `tryTransferCharges`; hold reactivate helper; `tryUndoCheckOut`; widen `insertHoldEventSync` kind |
| `apps/pms-core/src/v1-dispatch.ts` | 3–6 | Handlers + `V1_ROUTES` entries |
| `apps/pms-core/src/command-error-http.ts` | 1/6 | `CHECK_OUT_NOT_TODAY` → 422 |
| `packages/client-core/src/api.ts` | 3–6 | `getReservationDraftBill`, `transferFolioLines`, `undoCheckOut`; `voidInvoice` reason required |
| `apps/pms-core/test/invoice-generation.spec.ts` | 3 | **Update** — pass required `reason` on every `tryVoidInvoice` |
| `apps/pms-core/test/buyer-gst.spec.ts` | 3 | **Update** — same reason requirement |
| `apps/pms-core/test/draft-bill-reversals.spec.ts` | 4–7 | **Create** — all §4 pms-core cases |
| `apps/pms-core/test/property-me.spec.ts` | 1/10 | Mirror staff lacks `folio:reverse`; admin has it |
| `apps/web-pms/src/auth/me.test.ts` | 10 | Mirror `folio:hold` tests for `folio:reverse` |
| `apps/web-pms/src/screens/draft-bill-document.tsx` | 8 | **Create** — read-only draft view + print banner |
| `apps/web-pms/src/screens/draft-bill-document.test.tsx` | 8 | Words not codes; FAIL_CLOSED Alert |
| `apps/web-pms/src/screens/proforma-document.tsx` | 8 | Reuse print chrome patterns / banner prop if shared |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 8–10 | Draft button; split N/Equal; move charges; void reason; cancel settlement |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | 8–10 | Cache keys + flows |
| `apps/web-pms/src/copy/classified-user-message.ts` | 10 | `check_out_not_today` (+ any missing void codes) |
| `apps/web-pms/src/copy/classified-user-message.test.ts` | 10 | Copy assertions |

**Not touched:** `docs/roadmap.md`; IRN state; penalty void command; credit notes; email/PDF file generation; cross-reservation transfer lift; `NIGHT_AUDIT_STEPS` / `CHECK_IDS`; `ORG_SCHEMA_HEAD`.

---

## Normative scope-out (matches spec §6)

- Line transfer to another room / reservation (fork F1 / client Q17).
- Voiding penalty rows (desk uses `folio.post_discount`).
- Group master bill (R4.1).
- Controlled negative adjustments with approval threshold; facility charge bills (client Q16).
- Email and PDF files (browser print only).
- Credit notes (wait tax advisor + R5.5).
- Undoing a checkout from an earlier business date.
- IRN acknowledged-state guard (lands with R5.5; nothing added here).

---

### Task 1: Contracts — `folio:reverse`, limit, error, catalog/routes/writers, AGENTS pins

**Files:**
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/request-limits.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `AGENTS.md` (pins table only)
- Modify: `apps/pms-core/src/command-error-http.ts` (import + case for new error)
- Touch if needed: `apps/pms-core/test/property-me.spec.ts` (staff lacks `folio:reverse`)

**Interfaces:**
- Consumes: existing `FOLIO_SPLIT_MAX` / `folio:hold` grant pattern; `V1_HTTP_ROUTE_AUDIT` append order.
- Produces:
  - `Permission` includes `'folio:reverse'`
  - `FOLIO_TRANSFER_BULK_MAX = 50`
  - `CHECK_OUT_NOT_TODAY = 'check_out_not_today'`
  - Catalog entries:
    - `folio.transfer_charges` — INTERACTIVE, FAIL_CLOSED, idempotent, `pms.core`, `folio:adjust`, events `['folio.line_posted','folio.charge_transferred']` (same shape as single transfer)
    - `reservations.undo_check_out` — INTERACTIVE, FAIL_CLOSED, idempotent, `pms.core`, `folio:reverse`, events `['reservation.status_changed']` (and window/hold side effects stay in audit, not required as catalog events beyond status)
  - `invoice.void.permission === 'folio:reverse'`
  - Routes (append in this order so last id is draft bill):
    1. `post_folio_transfer_bulk` — `POST` body route, `folio:adjust`, command `folio.transfer_charges`
    2. `post_reservation_undo_check_out` — `folio:reverse`, command `reservations.undo_check_out`
    3. `get_reservation_draft_bill` — `folio:read`, `degradedRead: 'FAIL_CLOSED'`, no commandId
  - Pins: catalog **127**, routes **207**, writers **93**

- [ ] **Step 1: Write failing register.test assertions**

In `packages/contracts/src/register.test.ts`:

```ts
expect(COMMAND_CATALOG).toHaveLength(127);
expect(V1_HTTP_ROUTE_AUDIT).toHaveLength(207);
expect(V1_HTTP_ROUTE_AUDIT.at(-1)?.id).toBe('get_reservation_draft_bill');
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(93);
expect(COMMAND_CATALOG.find((c) => c.id === 'invoice.void')?.permission).toBe('folio:reverse');
expect(COMMAND_CATALOG.find((c) => c.id === 'folio.transfer_charges')).toMatchObject({
  lane: 'INTERACTIVE',
  permission: 'folio:adjust',
  entitlement: 'pms.core',
});
expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.undo_check_out')).toMatchObject({
  lane: 'INTERACTIVE',
  permission: 'folio:reverse',
  entitlement: 'pms.core',
});
expect(FOLIO_TRANSFER_BULK_MAX).toBe(50);
expect(PROPERTY_SCOPED_PERMISSIONS).toContain('folio:reverse');
expect(ROLE_GRANTS.admin).toContain('folio:reverse');
expect(ROLE_GRANTS.staff).not.toContain('folio:reverse');
expect(GRANTABLE_PERMISSIONS).toContain('folio:reverse');
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

Expected: FAIL on length / missing ids / permission.

- [ ] **Step 3: Implement contracts + error constant + AGENTS pins**

1. `permissions.ts` — insert `'folio:reverse'` after `'folio:hold'` in `PROPERTY_SCOPED_PERMISSIONS` and in `ROLE_GRANTS.admin` (same place as `folio:hold`).
2. `request-limits.ts` — after `FOLIO_SPLIT_MAX`:

```ts
/** Line ids on `folio.transfer_charges`, at HTTP and in the try* RPC. */
export const FOLIO_TRANSFER_BULK_MAX = 50 as const;
```

3. `idempotency.ts` — export `CHECK_OUT_NOT_TODAY = 'check_out_not_today' as const`.
4. `catalog.ts` — change `invoice.void` permission; append the two new commands (next to `folio.transfer_charge` / near `reservations.check_out`).
5. `audit-writers.ts` — add `'folio.transfer_charges'` and `'reservations.undo_check_out'`.
6. `v1-http-routes.ts` — change `post_invoice_void.permission` to `'folio:reverse'`; append three audit rows; last must be `get_reservation_draft_bill`.
7. `command-error-http.ts` — import `CHECK_OUT_NOT_TODAY` and add `case CHECK_OUT_NOT_TODAY:` in the **422** group (alongside `LIMIT_EXCEEDED` / `INVOICE_ALREADY_EXISTS`).
8. `AGENTS.md` pins table — catalog **127**, routes **207** last **`get_reservation_draft_bill`**, writers **93**, `PROPERTY_SCHEMA_HEAD` **51** (head lands with Task 2; assert here so Task 2 cannot forget).

- [ ] **Step 4: Re-run register.test**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

Expected: PASS for new assertions (handlers may still be unwired — `permissions-check` may fail until Task 4–6 add `V1_ROUTES`; if `check:permissions` is run early and fails on missing handlers, that is expected until those tasks).

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 2: Migration 51 — `folio_hold_event` allows `reactivated`

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `scripts/property-ddl.mjs`
- Create (via generate): `migrations/do-property/0051_folio_hold_event_reactivated.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts`

**Interfaces:**
- Consumes: v50 `folio_hold_event` shape (`event_id`, `hold_id`, `kind`, `reason`, `before_json`, `after_json`, `actor`, `at`).
- Produces: `PROPERTY_SCHEMA_HEAD === 51`; kind CHECK includes `'reactivated'`; existing rows preserved.

- [ ] **Step 1: Write failing migrate tests**

```ts
it('applies property migrations through version 51', () => {
  // … existing migrate helper …
  expect(sql.schemaVersion).toHaveLength(51);
});

describe('folio hold event v51', () => {
  it('rebuilds folio_hold_event to allow reactivated and copies rows', () => {
    const v51 = PROPERTY_MIGRATIONS.find((m) => m.version === 51);
    expect(v51?.name).toBe('folio_hold_event_reactivated');
    expect(v51?.statements.some((s) => s.includes("'reactivated'"))).toBe(true);
    expect(PROPERTY_SCHEMA_HEAD).toBe(51);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

Expected: FAIL (head still 50).

- [ ] **Step 3: Add migration statements**

In `property-migrations.ts`, after v50:

```ts
/** v51 — R4.29: folio_hold_event.kind allows reactivated (table rebuild + copy). */
export const FOLIO_HOLD_EVENT_REACTIVATED_V51_STATEMENTS: string[] = [
  `CREATE TABLE folio_hold_event_v51 (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed','reactivated')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
)`,
  `INSERT INTO folio_hold_event_v51 (
     event_id, hold_id, kind, reason, before_json, after_json, actor, at)
   SELECT event_id, hold_id, kind, reason, before_json, after_json, actor, at
   FROM folio_hold_event`,
  `DROP TABLE folio_hold_event`,
  `ALTER TABLE folio_hold_event_v51 RENAME TO folio_hold_event`,
];
```

Register `{ version: 51, name: 'folio_hold_event_reactivated', statements: … }` in `PROPERTY_MIGRATIONS`.

Wire `scripts/property-ddl.mjs` target `0051_folio_hold_event_reactivated.sql` (mirror 0050 header). Run:

```bash
pnpm generate:ddl
# or: node scripts/property-ddl.mjs
```

Confirm generated SQL matches statements. Purge inventory already lists `folio_hold_event` — no inventory change unless a check asserts kind enum (only update if a purge/self-test hard-codes kinds).

- [ ] **Step 4: Re-run migrate tests**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
node scripts/property-ddl.mjs --self-test
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 3: `invoice.void` → `folio:reverse` + required reason (update existing tests)

**Characterize-first note:** Today `tryVoidInvoice` gates `folio:adjust` and treats `reason` as optional (`apps/pms-core/src/property-do.ts` ~26775). Spec D4 makes reason **required** and permission **`folio:reverse`**. Existing voids without reason will fail — update them; do not keep optional-reason as the expected contract.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryVoidInvoice`)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handlePostInvoiceVoid` — require reason; fingerprint includes reason; `finishPropertyDoInvoke` permission `'folio:reverse'`)
- Modify: `packages/client-core/src/api.ts` (`voidInvoice` — require `reason: string`)
- Modify: `apps/pms-core/test/invoice-generation.spec.ts` — **every** `tryVoidInvoice` / HTTP void must pass `reason: 'test-void'` (or similar 1–500)
- Modify: `apps/pms-core/test/buyer-gst.spec.ts` — same
- Create/extend: `apps/pms-core/test/draft-bill-reversals.spec.ts` — §4.4 invoice void cases

**Interfaces:**
- Consumes: `gatePermission(actor, 'folio:reverse')`; `INVALID_VOID_REASON`.
- Produces: void without permission → `forbidden`; missing/blank/too-long reason → `invalid_void_reason`; with both → void; regenerate new number (existing behaviour).

- [ ] **Step 1: Write failing characterization + break old optional-reason calls intentionally**

In `draft-bill-reversals.spec.ts`:

```ts
describe('invoice.void (R4.29 D4/D5)', () => {
  it('without folio:reverse → forbidden (403 path)', async () => {
    // staff-shaped actor with folio:adjust but not folio:reverse
  });
  it('without reason → INVALID_VOID_REASON', async () => {
    // owner actor, omit reason
  });
  it('with folio:reverse + reason → void; regenerate takes new number', async () => {
    // mirror invoice-generation case 6 with reason present
  });
});
```

In `invoice-generation.spec.ts` / `buyer-gst.spec.ts`, **first** change call sites to pass `reason` (so they stay green after the DO change), then implement DO.

Why these files: they call `stub.tryVoidInvoice(..., { invoiceId }, …)` **without** `reason` today (e.g. `invoice-generation.spec.ts` cases 3, 5, 6 ~236–322; `buyer-gst.spec.ts` ~156). After D4 they would get `INVALID_VOID_REASON` if left unchanged.

- [ ] **Step 2: Run focused specs (expect new cases fail; old files may still pass until DO flips)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts test/buyer-gst.spec.ts
```

- [ ] **Step 3: Implement DO + HTTP + client**

`tryVoidInvoice`:

```ts
const permDenied = await this.gatePermission(actor, 'folio:reverse');
// …
const trimmed = (input.reason ?? '').trim();
if (trimmed.length < 1 || trimmed.length > 500) {
  return { ok: false, error: INVALID_VOID_REASON };
}
// always persist trimmed reason on audit/outbox
```

`handlePostInvoiceVoid`: reject missing/blank reason at HTTP with same validation mapping; fingerprint:

```ts
const commandPayload = { invoiceId, reason: body.reason.trim() };
const fingerprint = await commandFingerprint('invoice.void', commandPayload);
```

`finishPropertyDoInvoke({ …, permission: 'folio:reverse' })`.

`api.voidInvoice(propertyId, invoiceId, { reason, idempotencyKey? })` — `reason` required in the type; always send it.

- [ ] **Step 4: Re-run**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/draft-bill-reversals.spec.ts \
  test/invoice-generation.spec.ts \
  test/buyer-gst.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 4: Draft bill read — DO + HTTP + client + §4.1

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — add `readReservationDraftBill` / `readReservationDraftBillSync`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handleGetReservationDraftBill` + `V1_ROUTES` entry
- Modify: `packages/client-core/src/api.ts` — `getReservationDraftBill`
- Extend: `apps/pms-core/test/draft-bill-reversals.spec.ts` — §4.1

**Interfaces:**
- Consumes:
  - `readReservationProformaSync(reservationId)` (~21266) for guest header fields + advance/balance helpers
  - `buildNightChargeLines` (imported)
  - `nightConsumedSync(reservationId, stayDate)` (~9966)
  - `rateNightAmountSync(reservationId, roomTypeId, ratePlanId, stayDate, { persist: false })` (~9834)
- Produces (wire JSON camelCase):

```ts
type DraftBillOk = {
  ok: true;
  reservationId: string;
  status: 'checked_in' | 'checked_out' | string;
  // header: same fields proforma exposes publicly after guest hydrate
  chargeReview: Array<{
    folioWindowId: string;
    chargeCode: string;
    label: string;
    lineCount: number;
    baseMinor: number;
    taxMinor: number;
    totalMinor: number;
  }>;
  tariffCheck: Array<{
    stayDate: string;
    state: 'posted' | 'unposted' | 'future';
    expectedRoomMinor: number;
    postedRoomNetMinor: number;
    mismatch: boolean;
  }>;
  totals: {
    postedChargesMinor: number;
    futureEstimateMinor: number;
    advancePaidMinor: number;
    balanceNowMinor: number;
    projectedBalanceMinor: number;
  };
  invoice: { invoiceNumber: string; generatedAt: number } | null;
};
```

Invalid status → `422 invalid_status` (or existing `INVALID_STATUS`). Not found → 404.

- [ ] **Step 1: Write failing §4.1 test**

```ts
it('draft changes nothing: folio/invoice counter/audit byte-equal; tariff states + mismatch', async () => {
  // checked_in multi-night stay; consume some nights; change rate for a posted night
  // snapshot folio_line rows, invoice counter, audit_log count/hash
  // GET draft-bill → 200
  // re-snapshot → equal
  // tariffCheck includes posted, unposted, future; mismatch true on altered posted night
});
```

HTTP pattern: mirror `handleGetReservationProforma` (`resolvePropertyContext`, guest hydrate via OrgDO, FAIL_CLOSED on transport).

Route pattern:

```ts
pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/draft-bill$/,
method: 'GET',
permission: 'folio:read',
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

Expected: FAIL (route/DO missing).

- [ ] **Step 3: Implement read path**

Implementation rules (D2):
- Charge review: parent lines where `source` is not payment/tax/reversal noise — **non-payment parents** only; group by `folio_window_id` then `charge_code`; sum base; attach tax via `tax_of`.
- Tariff: enumerate stay nights `[arrival, departure)`; state from `nightConsumedSync` + compare to business date; expected = `rateNightAmountSync(..., { persist: false })`; posted net ROOM = sum of ROOM (and room-like) parent lines for that `business_date` across stay windows, **tax excluded**, net of transfer reversals.
- Totals: posted charges from folio; future estimate via same `buildNightChargeLines` skip rule as proforma; `advancePaidMinor` / balance from proforma GUEST payment ledger math; projected = balanceNow + futureEstimate (or equivalent proforma composition — **no second money model**).
- Invoice: active (non-voided) invoice on GUEST window or null.
- **Writes nothing** — no `transactionSync` needed for the read; never call audit append.

Client:

```ts
async getReservationDraftBill(propertyId: string, reservationId: string) {
  return getJson(`/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/draft-bill`);
}
```

- [ ] **Step 4: Re-run**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

Expected: §4.1 PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 5: `folio.transfer_charges` + equal-split footing + F1

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryTransferCharges`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostFolioTransferBulk` + route
  - pattern: `/^\/v1\/properties\/([^/]+)\/folio\/transfer$/` (distinct from `/folio/lines/:id/transfer`)
- Modify: `packages/client-core/src/api.ts` — `transferFolioLines`
- Extend: `apps/pms-core/test/draft-bill-reversals.spec.ts` — §4.2, §4.3, §4.8
- Reference: `transferFolioLineSync` (~23019), `tryTransferCharge` (~23210), `trySplitCharge` / `FOLIO_SPLIT_MAX`, `apps/pms-core/test/folio-transfer-split.spec.ts`

**Interfaces:**
- Consumes: `transferFolioLineSync({ sourceFolioLineId, destinationFolioWindowId, deskActor })`; `FOLIO_TRANSFER_BULK_MAX`; `LIMIT_EXCEEDED`.
- Produces:

```ts
async tryTransferCharges(
  actor: ActorContext,
  input: { folioLineIds: string[]; destinationFolioWindowId: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; results: Array<{ reverseFolioLineId: string; destFolioLineId: string }> }
  | { ok: false; error: typeof LIMIT_EXCEEDED | /* same errors as tryTransferCharge */ }
>
```

Handler **must** sort ids before fingerprint + DO:

```ts
const folioLineIds = [...body.folioLineIds].sort();
const commandPayload = { folioLineIds, destinationFolioWindowId: body.destinationFolioWindowId };
```

- [ ] **Step 1: Write failing tests**

```ts
describe('folio.transfer_charges (D3)', () => {
  it('moves N lines + tax all-or-nothing; one bad line rolls back all', async () => { /* … */ });
  it('over 50 → 422 limit_exceeded at HTTP and RPC', async () => { /* … */ });
  it('cross-reservation destination → transfer_cross_reservation', async () => { /* … */ });
  it('replay → one move', async () => { /* … */ });
});

describe('equal split footing (D3)', () => {
  it('1000 split 3 ways via allocate foots; tax re-splits', async () => {
    const parts = allocate(1000, [1, 1, 1], { policy: 'LAST' }); // e.g. [333,333,334]
    // trySplitCharge with those amounts → ok; sum children + reverse = 0 net
  });
});

describe('F1', () => {
  it('transfer_charge and transfer_charges to another reservation → transfer_cross_reservation', async () => { /* … */ });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

- [ ] **Step 3: Implement bulk transfer**

Inside one `transactionSync` + `runIdempotent`:
1. If `folioLineIds.length > FOLIO_TRANSFER_BULK_MAX` → `LIMIT_EXCEEDED` (also enforce in HTTP before invoke).
2. For each id (sorted order): reuse the same guards as `tryTransferCharge` (transferable, open windows, same reservation, not already transferred) then `transferFolioLineSync`.
3. Any throw → whole txn rolls back.
4. One audit row for `folio.transfer_charges` with afterJson listing moved ids (or N child audit events — prefer **one** command audit row listing results; line events already emitted by `transferFolioLineSync` if it posts outbox — match single-transfer behaviour).

Permission: `folio:adjust`. Entitlement: `pms.core`. Kill-switch on (same as other folio adjust writes).

Client:

```ts
async transferFolioLines(
  propertyId: string,
  input: { folioLineIds: string[]; destinationFolioWindowId: string },
  opId: string,
) { /* POST /v1/properties/:id/folio/transfer with sorted ids + idempotencyKey */ }
```

Equal split: no new server command — test only proves `allocate` + existing `trySplitCharge`.

- [ ] **Step 4: Re-run**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

Expected: §4.2, §4.3, §4.8 PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 6: Hold reactivation (D7) + `reservations.undo_check_out` (D6)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
  - Widen `insertHoldEventSync` kind: `'placed'|'extended'|'released'|'closed'|'reactivated'` (~19914)
  - Add `reactivateHoldOnWindowReopenSync(folioWindowId, actor)` used by `tryReopenFolioWindow` **and** undo-checkout
  - Add `tryUndoCheckOut`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostReservationUndoCheckOut`
- Modify: `packages/client-core/src/api.ts` — `undoCheckOut`
- Extend: `apps/pms-core/test/draft-bill-reversals.spec.ts` — §4.5

**Interfaces:**
- Consumes:
  - `assertRoomVacantNowSync(roomId, reservationId)` (~8956)
  - `assertRoomAssignableSync(roomId, { reservationId, allocatedRoomTypeId, arrivalDate, departureDate }, { from: businessDate, to: departureDate })` (~9004)
  - Reopen writer logic inside `tryReopenFolioWindow` (~20721) — extract shared `reopenFolioWindowSync` if needed so undo can call it without nested idempotency
- Produces:

```ts
async tryUndoCheckOut(
  actor: ActorContext,
  input: { reservationId: string; reason: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof CHECK_OUT_NOT_TODAY | typeof INVOICE_ALREADY_EXISTS | /* room errors */ | typeof FORBIDDEN | … }
>
```

HTTP:

```
POST /v1/properties/:propertyId/reservations/:reservationId/undo-check-out
Header: x-idempotency-key
Body: { reason: string }
```

Mirror `handlePostReservationCheckOut` header helper (`requireIdempotencyHeader`).

- [ ] **Step 1: Write failing §4.5 tests**

```ts
describe('undo check-out (D6)', () => {
  it('same-day → checked_in; CLOSED GUEST reopens', async () => {});
  it('active invoice → invoice_already_exists', async () => {});
  it('earlier-day checkout → check_out_not_today', async () => {});
  it('room occupied by another stay → existing room error; nothing changes', async () => {});
  it('replay → one transition', async () => {});
  it('without folio:reverse → forbidden', async () => {});
  it('availability_day unchanged', async () => {});
});
```

Also a unit-level case: `folio.reopen_window` alone reactivates CLOSED/`window_closed` hold (D7) — can live here or Task 7.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

- [ ] **Step 3: Implement reactivation + undo**

`reactivateHoldOnWindowReopenSync`:
1. Select latest hold for window ordered by `placed_at DESC` (or `ended_at`).
2. If `status === 'CLOSED' && ended_reason === 'window_closed'`: set `ACTIVE`, clear `ended_at`/`ended_reason`, insert event `kind: 'reactivated'` (reason null or copy reopen reason — dates/reason/approver on hold row **unchanged** per D7).
3. If `RELEASED`: no-op.

Call it at end of reopen path inside the same `transactionSync`.

`tryUndoCheckOut` (all in one `transactionSync`):
1. `gatePermission(actor, 'folio:reverse')`.
2. Load reservation; require `status === 'checked_out'` and `checked_out_business_date === currentBusinessDate` else `CHECK_OUT_NOT_TODAY`.
3. If active invoice on GUEST → `INVOICE_ALREADY_EXISTS`.
4. If `room_id` set: `assertRoomVacantNowSync` + `assertRoomAssignableSync` with window `[businessDate, departure)`.
5. Update status → `checked_in`; set `checked_out_business_date = NULL`.
6. If GUEST window CLOSED → reopen sync + reactivate hold.
7. Audit `reservations.undo_check_out` with reason; emit `reservation.status_changed`.
8. **Do not** write `availability_day`; **do not** change room HK status.

- [ ] **Step 4: Re-run**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

Expected: §4.5 PASS.

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 7: Settlement-cancel HTTP sequence + hold reactivation e2e (§4.6, §4.7)

**Files:**
- Extend: `apps/pms-core/test/draft-bill-reversals.spec.ts` only (no new command)
- Uses existing HTTP/DO: `invoice.void`, `folio.refund`, `reservations.undo_check_out`, hold place/close paths from open-folio tests

**Interfaces:**
- Consumes: Task 3 void, existing `tryRefund` / `refundPayment`, Task 6 undo, D7 helper.
- Produces: green characterization for D8 server-side building blocks + D7 e2e.

- [ ] **Step 1: Write failing tests**

```ts
describe('settlement cancel sequence (D8 via HTTP)', () => {
  it('cash refund posts once on replay with same key; balance returns', async () => {
    // checked_out today, invoice active, captured cash payment
    // 1) void invoice with reason + key settlement-cancel:{res}:void:{uuid}
    // 2) refund cash remaining with settlement-cancel:{res}:refund:{payId}:{uuid}
    // replay refund → still one refund row; guest balance reflects refund
  });
});

describe('hold reactivation (D7)', () => {
  it('CLOSED window_closed → reopen → ACTIVE + reactivated event; RELEASED stays released', async () => {
    // place hold, checkout/close at zero → CLOSED/window_closed
    // reopen window (or undo path) → ACTIVE + event kind reactivated
    // separate case: release hold → RELEASED; reopen must not reactivate
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
```

Expected: FAIL until sequences wired; implement only test helpers — production already from prior tasks. If hold reactivation missing on plain `folio.reopen_window`, fix in `property-do.ts` (Task 6 helper must be wired there).

- [ ] **Step 3: Fix gaps only**

No new routes. Ensure reopen path always calls reactivation helper.

- [ ] **Step 4: Re-run until §4.6 and §4.7 PASS**

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 8: SPA — Draft bill view + print banner

**Files:**
- Create: `apps/web-pms/src/screens/draft-bill-document.tsx`
- Create: `apps/web-pms/src/screens/draft-bill-document.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — *Draft bill* button + query
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Reference: `apps/web-pms/src/screens/proforma-document.tsx` (R4.13 print view); print CSS / `window.print` patterns from registration-card / proforma tests

**Interfaces:**
- Consumes: `api.getReservationDraftBill`; query key `['draft-bill', propertyId, reservationId]`.
- Produces: read-only view; print headed **"Draft — not a tax invoice"**; FAIL_CLOSED → `Alert`, no numbers; tariff states as words (`Posted` / `Unposted` / `Future`) + mismatch `Badge` (word always shown).

- [ ] **Step 1: Write failing component/screen tests**

```ts
it('renders Posted/Unposted/Future words, not raw state codes', async () => {});
it('FAIL_CLOSED shows Alert and no money figures', async () => {});
it('print banner text is Draft — not a tax invoice', async () => {});
```

FolioScreen: button visible for `checked_in` / `checked_out` with `folio:read`.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/draft-bill-document.test.tsx \
  src/screens/FolioScreen.test.tsx
```

- [ ] **Step 3: Implement view + Folio wire**

ui-kit: `PageHeader`/`Card`/`Badge`/`Alert`/`Button`/`DataTable` or definition lists — no raw controls. Hex only via tokens. Reuse money formatters from FolioScreen/`useFormat`.

On open: `useQuery({ queryKey: ['draft-bill', propertyId, reservationId], … })`.

- [ ] **Step 4: Re-run until PASS**

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 9: SPA — Split dialog (Custom N / Equal) + Move charges

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~3607 split UI today is two fixed parts `splitA`/`splitB`)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Uses: `allocate` from `@hospai/money`; `api.splitFolioLine`; `api.transferFolioLines`

**Interfaces:**
- Custom: N rows (2–20) each `{ amountMajor, folioWindowId }`; post through existing `splitFolioLine`.
- Equal: pick N + per-part window; preview `allocate(sourceAmountMinor, weights, { policy: 'LAST' })` before post.
- Move charges: multi-select by charge code or source group (room nights / inclusions / scheduled add-ons / manual); show total; destination window; `transferFolioLines` with sorted ids; op id `xfer-bulk:{reservationId}:{uuid}`.

- [ ] **Step 1: Write failing tests**

```ts
it('equal split posts allocate parts that foot the source amount', async () => {});
it('bulk move posts sorted folioLineIds to transferFolioLines', async () => {});
it('split N>20 disabled / refused client-side', async () => {});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

- [ ] **Step 3: Replace two-part split state with parts array; add Equal mode + Move charges panel**

Keep server footing as the guard. On success invalidate:

```ts
['folio', propertyId, reservationId]
['folio-payments', propertyId, reservationId]
['reservation-proforma', propertyId, reservationId]
['draft-bill', propertyId, reservationId]
['folio-hold', propertyId, reservationId]
['open-folios', propertyId]
// + reservation detail key used by stay screen if present
```

- [ ] **Step 4: Re-run until PASS**

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 10: SPA — Void reason, Cancel settlement, me.test, copy, cache keys

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — void dialog requires reason; gate on `folio:reverse`; Cancel settlement flow (D8)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts` — mirror `folio:hold` cases for `folio:reverse`
- Modify: `apps/web-pms/src/copy/classified-user-message.ts` (+ test) — `check_out_not_today`
- Touch: `apps/pms-core/test/property-me.spec.ts` if staff permissions list needs explicit `not.toContain('folio:reverse')`

**Interfaces:**
- Void: show control only if `hasPropertyPermission(me, 'folio:reverse')`; `ConfirmDialog`/`Field` reason required; refuse mutate without trim length ≥ 1.
- Cancel settlement (`intent=destructive` + confirm):
  1. Collect reason
  2. Void active invoice if any (`settlement-cancel:{res}:void:{uuid}`)
  3. Refund: preselect all captured CASH+UPI for remaining amount; CARD selectable; each `settlement-cancel:{res}:refund:{paymentId}:{uuid}`
  4. If stay checked out **today**, offer *Also reopen the stay* → `undoCheckOut` with same reason / `settlement-cancel:{res}:undo:{uuid}`
  5. On step failure: `classifiedUserMessage`; stop; Retry resumes from failed step with **same** keys; successes never re-post
  6. Success Alert: `"Settlement cancelled."` + `"Stay reopened."` when undo ran
- After undo: also invalidate `['board']` and tape key `['front-desk-tape', propertyId, from, to]` (use the same from/to the desk tape query uses if available on screen; otherwise invalidate prefix carefully — prefer full key if FolioScreen knows range, else `['board']` + `['front-desk-tape']` with propertyId predicate matching existing Folio patterns).

- [ ] **Step 1: Write failing tests**

```ts
// FolioScreen.test.tsx
it('void invoice hidden without folio:reverse; requires reason before send', async () => {});
it('cancel settlement retries only failed steps with same op ids', async () => {});
it('undo checkout offered only when checked_out_business_date is today', async () => {});
it('after mutations invalidates draft-bill, folio, payments, proforma, folio-hold, open-folios', async () => {});

// me.test.ts
it('hasPropertyPermission: staff-shaped lacks folio:reverse; admin-shaped includes it', () => {
  // mirror folio:hold block ~234–249
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/FolioScreen.test.tsx \
  src/auth/me.test.ts \
  src/copy/classified-user-message.test.ts
```

- [ ] **Step 3: Implement UI + copy**

`classified-user-message.ts`:

```ts
check_out_not_today: () =>
  'This stay checked out on an earlier business date and cannot be reopened.',
```

Wire void reason into `api.voidInvoice(..., { reason })`.

- [ ] **Step 4: Re-run until PASS**

- [ ] **Step 5: Do NOT commit — leave changes unstaged/uncommitted**

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

- [ ] **Step 2: pms-core shards once at end (never unsharded; no `--` before `--shard`)**

```bash
node scripts/test-pms-core-shards.mjs
```

Also ensure focused specs still green:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/draft-bill-reversals.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/invoice-generation.spec.ts test/buyer-gst.spec.ts
```

- [ ] **Step 3: Confirm pins**

- `COMMAND_CATALOG` **127**
- `V1_HTTP_ROUTE_AUDIT` **207**, last **`get_reservation_draft_bill`**
- `AUDIT_WRITER_COMMAND_IDS` **93**
- `PROPERTY_SCHEMA_HEAD` **51**, `ORG_SCHEMA_HEAD` **13**
- `NIGHT_AUDIT_STEPS` / `CHECK_IDS` unchanged
- `folio:reverse` on admin/owner, not staff; `invoice.void` uses it; reason required

- [ ] **Step 4: Do NOT commit — leave changes unstaged/uncommitted**

---

## Self-review (plan author)

1. **Spec coverage (D1–D8 + §4 tests):**
   - D1/D2 + §4.1 → Task 4
   - D3 custom/equal/source + §4.2/§4.3/§4.8 → Tasks 5, 9
   - D4/D5 + §4.4 + existing void test updates → Task 3 (named files: `invoice-generation.spec.ts`, `buyer-gst.spec.ts`)
   - D6 + §4.5 → Task 6
   - D7 + §4.7 → Tasks 2, 6, 7
   - D8 + §4.6 → Tasks 7, 10
   - SPA §3 + cache keys → Tasks 8–10
   - contracts/do-runtime pins → Tasks 1–2
   - F1 → Task 5
2. **Placeholders:** none intentional; signatures and paths are concrete.
3. **Type consistency:** `FOLIO_TRANSFER_BULK_MAX`, `CHECK_OUT_NOT_TODAY`, `tryTransferCharges`, `tryUndoCheckOut`, draft query key, settlement-cancel op id format reused across tasks.
4. **Final CI:** Task 11 mirrors `.github/workflows/ci.yml` `checks` + `node scripts/test-pms-core-shards.mjs`.
5. **Scope-out:** matches spec §6 / roadmap F1.
