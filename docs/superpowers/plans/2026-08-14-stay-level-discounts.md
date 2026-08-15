# Stay-level discounts (folio money ops leftover 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-14)

**Goal:** Extend existing `folio.post_discount` with a stay-level branch (no source folio line): one lump negative `DISCOUNT` on the GUEST window at identity ledger FX, `split_of` NULL, no tax restamp — plus reservation-scoped HTTP route `[128]`, client `postStayDiscount`, and SPA branch when no line is selected.

**Architecture:** Widen `tryPostDiscount` into a union RPC inside the same `runIdempotent` / `transactionSync` txn: `sourceFolioLineId` → existing line path (bit-identical, including `stampTaxForChargeSync`); `reservationId` only → new stay path that sums GUEST-window `ledger_amount_minor` with Lock-6 exclusions, posts identity `postToLedger`, inserts one `DISCOUNT` without `splitOf`, skips stamp. Append audit row `[128] post_folio_stay_discount` after `[127] post_demo_seed`. SPA calls stay API when `discountLineId` and `splitLineId` are both empty.

**Tech Stack:** PropertyDO + sqlite (`tryPostDiscount`, `guestFolioWindowId`, `insertFolioLineSync`), `@hospai/money` (`postToLedger`, `roundHalfAwayFromZero`), `@hospai/contracts` (same `folio.post_discount` command; new HTTP audit row), vitest Worker specs (`provisionedPropertyStub`, `provisionHotel`, `worker.fetch`).

**Spec:** `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md` (Approved). Spec commit: `1b9ca43`.

---

## Sequencing gate (read before starting)

This slice closes **folio money ops leftover 6 — stay-level discount (no source line)**.

| After this plan | Do not start |
|---|---|
| Stay lump DISCOUNT on GUEST; `split_of` NULL; no stamp | Stay-level tax allocation / true-up |
| `[128] post_folio_stay_discount` HTTP route | Fan-out stay discount to per-line DISCOUNT + restamp |
| SPA stay path when no line selected | Promo codes (folio-money leftover **7**) |
| Line-level `[102]` bit-identical | City ledger / AR, invoices |
| — | Night-audit auto-transfer (`NIGHT_AUDIT_STEPS` growth) |
| — | Discount tax true-up to remaining |
| — | COMPANY/MASTER stay discount |
| — | New catalog command id / schema v28 |
| — | Demo seed rewrite |
| — | Dry run 2, guest CRM, virtual leftovers, `rooms.delete` |

---

## Open decisions (locked — do not re-litigate)

### D1 — Same command; new HTTP route only

**Locked:** `folio.post_discount` unchanged in catalog (**77** entries). **Append** `[128] post_folio_stay_discount` after `[127] post_demo_seed`. Do **not** move `[102] post_folio_discount` or `[127]`. `AUDIT_WRITER_COMMAND_IDS.size` stays **52** (command already listed — do not add a second id). `PLATFORM_GAPS` `[]`. Schema **27** / org **7**. `NIGHT_AUDIT_STEPS` **7**. Demo seed untouched.

### D2 — RPC union (spec Lock 3)

**Locked:** One `tryPostDiscount`; line branch **untouched** when `sourceFolioLineId` present. Stay when `sourceFolioLineId` absent and `reservationId` present. HTTP **400** `{ error: 'invalid_body' }` when path/body invalid. Reuse existing wire codes only (`LINE_NOT_DISCOUNTABLE`, etc.).

### D3 — Stay insert shape (spec Locks 4–8)

**Locked:** GUEST window via `` `${reservationId}:GUEST` `` — **do not** call `ensureGuestFolioWindowSync` on stay path; missing window → `NOT_FOUND`. Base = sum `ledger_amount_minor` on GUEST window excluding rows where `source IN (…)` **OR** `charge_code IN (…)` (set: `TAX`, `PAYMENT`, `PAYMENT_REFUND`, `SPLIT_REVERSAL`, `TRANSFER_REVERSAL`, `CHARGEBACK`, `FX_GAIN`, `FX_LOSS`, `CHARGEBACK_FEE`). Include prior `DISCOUNT` rows. Identity post: txn = ledger currency, `fxRate: '1'`. **`splitOf` omitted** (null). **No** `stampTaxForChargeSync`. Stay audit `afterJson`: `{ folioLineId, reservationId, amountMinor, reason }` — omit `sourceFolioLineId`.

### D4 — Test discipline

**Locked:** DO cases in `folio-extras.spec.ts` using `provisionedPropertyStub` / `TEST_OWNER_ACTOR` / `idemFor` from `./fixtures`. Fixture ids via `crypto.randomUUID()`. HTTP via `folio-routes.spec.ts` (`provisionHotel` + `getFolio` + `worker.fetch` + `x-dev-actor`) — **do not invent `provisionedPropertyWorker`**. Do not `vi.spyOn` into the DO isolate. Unsharded `pnpm --filter @hospai/pms-core test` may segfault — use `vitest run <file> -t "..."` or `--shard=N/8` (**no `--` before `--shard`**).

### D5 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts`** before pms-core tests when contracts change (Task 2).
2. **Rebuild `@hospai/client-core`** before web-pms tests when client changes (Task 3): `pnpm --filter @hospai/client-core build`.
3. **Contracts pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **not** `-t "COMMAND_CATALOG|post_demo_seed"`.
4. **Night-audit pin:** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"`.
5. **`pnpm generate:ddl` then `git diff --exit-code -- migrations packages/do-runtime`** must be a **true no-op** (no v28).
6. **Do not `|| true` CI failures.** Workerd 503 on a shard: retry that shard once.
7. **Bidirectional one-sentence pointers** in folio-money-ops §7.3 + §19 and taxable-discounts §9 item 3 — **Task 4 only**, plus tick plan Task 4 checkboxes and spec §10 there.
8. Living plan checkboxes: tick `- [x]` on **Task 4 only**.

---

## Global Constraints

- **Heads frozen except route append:** `COMMAND_CATALOG.length === 77`; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `V1_HTTP_ROUTE_AUDIT[102].id === 'post_folio_discount'`; **append** `V1_HTTP_ROUTE_AUDIT[128].id === 'post_folio_stay_discount'`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS = []`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 7`.
- **Append-only folio.** Never mutate existing line amounts.
- **Line-level HTTP `[102]`** body, fingerprint, `{ ok, folioLineId }` response **unchanged**.
- **Stay-level has no tax restamp.** Line-level restamp from taxable-discounts **unchanged**.
- **`FAIL_CLOSED` / `runIdempotent` sync-only** inside `transactionSync` — unchanged.
- **`check:web-pms-colors`** if SPA files touched (Task 3).

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/test/folio-extras.spec.ts` | DO stay cases 1–7 (spec §7) | 1 |
| `apps/pms-core/src/property-do.ts` | Widen `tryPostDiscount`; stay branch (~12695–12851) | 1 |
| `packages/contracts/src/v1-http-routes.ts` | **Append** `[128] post_folio_stay_discount` after `post_demo_seed` | 2 |
| `packages/contracts/src/register.test.ts` | Pin `[128]`; keep `[127]` / add `[102]` pin | 2 |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostFolioStayDiscount` + dispatch route | 2 |
| `apps/pms-core/test/folio-routes.spec.ts` | HTTP stay POST + GET folio; `[102]` line smoke | 2 |
| `packages/client-core/src/api.ts` | Add `postStayDiscount` | 3 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Empty line id → stay API | 3 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Stay RTL + case 55 + line path | 3 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | Pointer §7.3 + §19 leftover 6 | 4 |
| `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md` | Pointer §9 item 3 | 4 |
| `docs/superpowers/plans/2026-08-14-stay-level-discounts.md` | Tick Task 4 checkboxes | 4 |
| `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md` | Tick §10 checklist | 4 |

**Not touched:** `COMMAND_CATALOG` / `catalog.ts` command entry, `AUDIT_WRITER_COMMAND_IDS` membership, `property-migrations.ts`, demo seed, `NIGHT_AUDIT_STEPS`, line-level handler contract, `DISCOUNT.tax_group` seed, `CLASS_DENYLIST`, `PROPERTY_PURGE_INVENTORY_TABLES`.

---

## Spec §1.2 / §7 / §10 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) RPC union in `tryPostDiscount` | 1 |
| §1.2 (2) Append `[128]` HTTP route | 2 |
| §1.2 (3) Stay lump DISCOUNT; no stamp | 1 |
| §1.2 (4) Base ledger Lock 6 | 1 |
| §1.2 (5) SPA stay branch | 3 |
| §1.2 (6) Tests §7 DO + HTTP + SPA | 1–3 |
| §1.2 (7) `register.test.ts` pins | 2 |
| §7 DO cases 1–7 | 1 |
| §7 DO case 8 (preserve 40–41 / 18–23 / 29–30) | 1 verify + 4 CI |
| §7 HTTP stay + line regression | 2 |
| §7 SPA RTL | 3 |
| §10 checklist + spec pointers | 4 |
| §1.3 scope out | forbidden all tasks |

---

### Task 1: DO — stay-level branch in `tryPostDiscount`

**Spec:** §2 Locks 3–8, §7 cases **1–7**, §8 `property-do.ts`.

**Files:**
- Modify: `apps/pms-core/test/folio-extras.spec.ts` — append stay cases after case **41**
- Modify: `apps/pms-core/src/property-do.ts` — `tryPostDiscount` (~12695–12851)

**Interfaces:**
- Consumes: `guestFolioWindowId` (~11937), `readFolioWindowRowSync` (~11960), `assertFolioWindowOpenSync`, `insertFolioLineSync` (~12277), `postToLedger`, `roundHalfAwayFromZero`, `resolvePostingBusinessDateSync`.
- Produces: `tryPostDiscount(actor, { reservationId?, sourceFolioLineId?, kind, bps?, amountMinor?, reason, folioLineId }, idem)` stay branch returning `{ ok: true, folioLineId }` with `splitOf: null` and no tax child on discount line.

**Forbidden this commit:** HTTP route/handler, contracts append, client/SPA, spec pointers.

**Add imports** to `folio-extras.spec.ts`:

```ts
import { DISCOUNT_REASON_REQUIRED, FORBIDDEN, LINE_NOT_DISCOUNTABLE, WINDOW_CLOSED } from '@hospai/contracts';
```

(`DISCOUNT_REASON_REQUIRED` and `FORBIDDEN` already imported — extend the import line.)

- [ ] **Step 1: Write failing DO tests (spec §7 cases 1–7)**

Append inside `describe('folio extras — no-post and discounts')`:

```ts
  it('42: stay percent on GUEST ROOM 10000 → DISCOUNT -1000; splitOf null; no tax on discount', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_pct_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-42', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_disc_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay comp 10%',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-42', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -1000,
      source: 'DESK',
      splitOf: null,
    });
    expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  });

  it('43: stay fixed 2500 on base 10000 → DISCOUNT -2500; splitOf null; no tax on discount', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_fix_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-43', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_fix_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'fixed' as const,
      amountMinor: 2500,
      reason: 'stay fixed comp',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-43', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -2500,
      splitOf: null,
    });
    expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  });

  it('44: prior line-level DISCOUNT reduces stay percent base → stay DISCOUNT -900', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_stack_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLineId = `fl_room_${crypto.randomUUID()}`;
    const roomLine = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 10_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-44', roomLine))).toMatchObject({
      ok: true,
    });

    const lineDisc = {
      sourceFolioLineId: roomLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'line comp',
      folioLineId: `fl_line_disc_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, lineDisc, await idemFor('line-44', lineDisc)),
    ).toMatchObject({ ok: true });

    const stayDiscLineId = `fl_stay_disc_${crypto.randomUUID()}`;
    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay comp',
      folioLineId: stayDiscLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-44', stayDisc)),
    ).toMatchObject({ ok: true, folioLineId: stayDiscLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === stayDiscLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -900,
      splitOf: null,
    });
  });

  it('45: TAX and PAYMENT charge codes excluded from stay base → 10% of 10000 not 15000/5000', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_base_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-45', roomLine))).toMatchObject({
      ok: true,
    });

    // Do not set source: 'TAX' / 'PAYMENT' — insertFolioLineSync throws unless taxOf+taxRuleId
    // are set for source TAX (~12254–12257). Lock 6 excludes by charge_code IN (…) as well.
    const taxLine = {
      folioLineId: `fl_tax_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'TAX',
      amountMinor: 1000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, taxLine, await idemFor('tax-45', taxLine))).toMatchObject({
      ok: true,
    });

    const payLine = {
      folioLineId: `fl_pay_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'PAYMENT',
      amountMinor: -5000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, payLine, await idemFor('pay-45', payLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_base_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'base excludes tax/payment',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, await idemFor('stay-45', discount)),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      amountMinor: -1000,
      splitOf: null,
    });
  });

  it('46: stay discount when baseLedger <= 0 → LINE_NOT_DISCOUNTABLE', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_zero_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLineId = `fl_room_${crypto.randomUUID()}`;
    const roomLine = { folioLineId: roomLineId, reservationId, chargeCode: 'ROOM', amountMinor: 5000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-46', roomLine))).toMatchObject({
      ok: true,
    });

    const lineDisc = {
      sourceFolioLineId: roomLineId,
      kind: 'fixed' as const,
      amountMinor: 5000,
      reason: 'full line comp',
      folioLineId: `fl_line_disc_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, lineDisc, await idemFor('line-46', lineDisc)),
    ).toMatchObject({ ok: true });

    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stay on zero base',
      folioLineId: `fl_stay_zero_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-46', stayDisc)),
    ).toMatchObject({ ok: false, error: LINE_NOT_DISCOUNTABLE });
  });

  it('47: stay discount on CLOSED GUEST window → WINDOW_CLOSED', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_closed_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 10_000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-47', roomLine))).toMatchObject({
      ok: true,
    });

    await stub.stampFolioWindowClosedForTest(`${reservationId}:GUEST`);

    const stayDisc = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'closed window',
      folioLineId: `fl_stay_closed_${crypto.randomUUID()}`,
    };
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, stayDisc, await idemFor('stay-47', stayDisc)),
    ).toMatchObject({ ok: false, error: WINDOW_CLOSED });
  });

  it('48: idempotent stay discount replay → same folioLineId; no duplicate DISCOUNT', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = `res_stay_idem_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const roomLine = {
      folioLineId: `fl_room_${crypto.randomUUID()}`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 8000,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, roomLine, await idemFor('room-48', roomLine))).toMatchObject({
      ok: true,
    });

    const discountLineId = `fl_stay_idem_${crypto.randomUUID()}`;
    const discount = {
      reservationId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'idem stay',
      folioLineId: discountLineId,
    };
    const idem = await idemFor('stay-idem-48', discount);
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });
    expect(
      await stub.tryPostDiscount(TEST_OWNER_ACTOR, discount, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.folioLineId === discountLineId)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "42:|43:|44:|45:|46:|47:|48:"
```

Expected: **FAIL** — stay input rejected (no stay branch yet) or wrong amounts / missing `reservationId` handling.

- [ ] **Step 3: Implement stay branch in `tryPostDiscount`**

Widen input type:

```typescript
input: {
  sourceFolioLineId?: string;
  reservationId?: string;
  kind: 'percent' | 'fixed';
  bps?: number;
  amountMinor?: number;
  reason: string;
  folioLineId: string;
},
```

At the start of the `runIdempotent` callback (~12736), branch before the existing source-line query:

```typescript
if (!input.sourceFolioLineId) {
  if (!input.reservationId) throw new Error('invalid_body');

  const resRows = this.ctx.storage.sql
    .exec(`SELECT reservation_id FROM reservation WHERE reservation_id = ?`, input.reservationId)
    .toArray() as Array<{ reservation_id: string }>;
  if (!resRows[0]) throw new FolioWindowError(NOT_FOUND);

  const guestWindowId = this.guestFolioWindowId(input.reservationId);
  const windowRow = this.readFolioWindowRowSync(guestWindowId);
  if (!windowRow) throw new FolioWindowError(NOT_FOUND);
  this.assertFolioWindowOpenSync(guestWindowId);

  const BASE_EXCLUDE =
    'TAX,PAYMENT,PAYMENT_REFUND,SPLIT_REVERSAL,TRANSFER_REVERSAL,CHARGEBACK,FX_GAIN,FX_LOSS,CHARGEBACK_FEE';
  const baseRows = this.ctx.storage.sql
    .exec(
      `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS base
       FROM folio_line
       WHERE folio_window_id = ?
         AND NOT (
           COALESCE(source, '') IN (${BASE_EXCLUDE.split(',').map(() => '?').join(',')})
           OR charge_code IN (${BASE_EXCLUDE.split(',').map(() => '?').join(',')})
         )`,
      guestWindowId,
      ...BASE_EXCLUDE.split(','),
      ...BASE_EXCLUDE.split(','),
    )
    .toArray() as Array<{ base: number }>;
  const baseLedger = Number(baseRows[0]?.base ?? 0);

  let discountMinor: number;
  if (input.kind === 'percent') {
    const bps = input.bps;
    if (!Number.isInteger(bps) || bps === undefined || bps < 1 || bps > 10000) {
      throw new Error(MONEY_INVALID);
    }
    discountMinor = Number(roundHalfAwayFromZero(BigInt(baseLedger) * BigInt(bps), 10000n));
  } else {
    const amountMinor = input.amountMinor;
    if (
      !Number.isInteger(amountMinor) ||
      amountMinor === undefined ||
      amountMinor <= 0 ||
      amountMinor > baseLedger
    ) {
      throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);
    }
    discountMinor = amountMinor;
  }
  if (baseLedger <= 0 || discountMinor <= 0) throw new FolioWindowError(LINE_NOT_DISCOUNTABLE);

  this.assertChargeCodeSync('DISCOUNT', { requireActive: true });
  const ledger = this.readStoredLedgerCurrencySync();
  if (!ledger) throw new Error(CURRENCY_UNSET);
  const fxRateAt = Date.now();
  const posted = postToLedger(money(-discountMinor, ledger), ledger, '1', fxRateAt);

  this.insertFolioLineSync({
    folioLineId: input.folioLineId,
    folioWindowId: guestWindowId,
    reservationId: input.reservationId,
    chargeCode: 'DISCOUNT',
    posted,
    source: 'DESK',
  });

  this.appendAuditLogSync({
    actor: this.auditActorSync(actor),
    commandId: 'folio.post_discount',
    entityType: 'folio_line',
    entityId: input.folioLineId,
    beforeJson: null,
    afterJson: {
      folioLineId: input.folioLineId,
      reservationId: input.reservationId,
      amountMinor: -discountMinor,
      reason,
    },
    reservationId: input.reservationId,
  });
  return { ok: true as const, folioLineId: input.folioLineId };
}

// existing line-level path unchanged below (source query → stampTaxForChargeSync → audit with sourceFolioLineId)
```

**Do not** call `stampTaxForChargeSync` on the stay path. **Do not** call `ensureGuestFolioWindowSync` on the stay path. Omit `splitOf` on insert so `insertFolioLineSync` stores null (~12277). Leave the line-level block **bit-identical** (including restamp ~12817–12826).

- [ ] **Step 4: Run stay tests to verify they pass**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "42:|43:|44:|45:|46:|47:|48:"
```

Expected: **PASS**.

- [ ] **Step 5: Verify line-level cases 40–41 still green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "40:|41:"
```

Expected: **PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/test/folio-extras.spec.ts apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): post stay-level folio discount without a source line

EOF
)"
```

---

### Task 2: HTTP `[128]` + register pin + HTTP tests

**Spec:** §3.3, §7 HTTP, §8 contracts/dispatch, register pins.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — **append** after `post_demo_seed` (~747–749)
- Modify: `packages/contracts/src/register.test.ts` — pin `[128]`; keep `[127]`; pin `[102]`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostFolioStayDiscount` (~5103+); route after `handlePostFolioDiscount` (~7024)
- Modify: `apps/pms-core/test/folio-routes.spec.ts` — HTTP stay + `[102]` smoke

**Interfaces:**
- Consumes: Task 1 `tryPostDiscount` stay branch.
- Produces: `POST /v1/properties/:pid/reservations/:rid/folio/discount` → `{ ok: true, folioLineId }`; audit `[128] post_folio_stay_discount`; fingerprint `{ reservationId, kind, bps, amountMinor, reason }`.

**Forbidden this commit:** client/SPA, spec pointers, catalog length change.

**Append to `v1-http-routes.ts`** after the `post_demo_seed` entry:

```typescript
  {
    id: 'post_folio_stay_discount',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.post_discount',
    entitlement: 'pms.core',
  },
```

**`handlePostFolioStayDiscount`** (mirror `handlePostFolioDiscount` ~5045–5101; reservation id from path `:rid`):

```typescript
async function handlePostFolioStayDiscount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as {
    kind: 'percent' | 'fixed';
    bps?: number;
    amountMinor?: number;
    reason: string;
    folioLineId: string;
    idempotencyKey: string;
  };
  if (!body?.kind || !body.folioLineId || body.reason == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    reservationId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
    folioLineId: body.folioLineId,
  };
  const fingerprint = await fingerprintPayload({
    reservationId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryPostDiscount']>>>({
    env: ctx.env,
    commandId: 'folio.post_discount',
    routeId: 'post_folio_stay_discount',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryPostDiscount(actor, commandPayload, idem),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:adjust' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}
```

**Dispatch route** (insert after `handlePostFolioDiscount` route ~7024, before capture-due):

```typescript
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/discount$/,
    permission: 'folio:adjust',
    commandId: 'folio.post_discount',
    entitlement: 'pms.core',
    handler: handlePostFolioStayDiscount,
  },
```

**`register.test.ts`** — inside the `"night-audit HTTP routes"` test, after the `[127]` block (~619–624), add:

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[101]?.id).toBe('post_folio_refund');
    expect(V1_HTTP_ROUTE_AUDIT[102]?.id).toBe('post_folio_discount');
    expect(V1_HTTP_ROUTE_AUDIT[102]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'folio.post_discount',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[128]?.id).toBe('post_folio_stay_discount');
    expect(V1_HTTP_ROUTE_AUDIT[128]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'folio.post_discount',
      entitlement: 'pms.core',
    });
```

Keep existing `[127] post_demo_seed` assertions unchanged.

- [ ] **Step 1: Write failing HTTP tests**

Append to `describe('folio vertical HTTP routes')` in `folio-routes.spec.ts`:

```ts
  it('stay POST /reservations/:rid/folio/discount → lump DISCOUNT; GET folio splitOf null; no tax on discount', async () => {
    const owner = `user_stay_http_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = `res_stay_http_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const roomLineId = `fl_room_${crypto.randomUUID()}`;
    expect(
      (
        await postFolioLine(propertyId, owner, reservationId, {
          chargeCode: 'ROOM',
          amountMinor: 10_000,
          idempotencyKey: `idem-room-stay-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(201);

    const discountLineId = `disc_stay_${crypto.randomUUID()}`;
    const discountRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            kind: 'percent',
            bps: 1000,
            reason: 'http stay comp',
            folioLineId: discountLineId,
            idempotencyKey: `idem-stay-disc-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(discountRes.status).toBe(200);
    expect(await discountRes.json()).toMatchObject({ ok: true, folioLineId: discountLineId });

    const folioRes = await getFolio(propertyId, owner, reservationId);
    expect(folioRes.status).toBe(200);
    const body = (await folioRes.json()) as {
      ok: true;
      lines: Array<{ folioLineId: string; chargeCode: string; amountMinor: number; splitOf: string | null; source: string; taxOf?: string }>;
    };
    expect(body.lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -1000,
      splitOf: null,
    });
    expect(body.lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  });

  it('[102] line POST /folio/lines/:lid/discount still works (regression smoke)', async () => {
    const owner = `user_line_disc_http_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = `res_line_disc_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const lineIdem = `idem-misc-line-disc-${crypto.randomUUID()}`;
    const lineRes = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 5000,
      idempotencyKey: lineIdem,
    });
    expect(lineRes.status).toBe(201);
    const chargeLineId = `${reservationId}:item:${lineIdem}`;

    const discountLineId = `disc_line_${crypto.randomUUID()}`;
    const discountRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(chargeLineId)}/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            kind: 'percent',
            bps: 1000,
            reason: 'line smoke',
            folioLineId: discountLineId,
            idempotencyKey: `idem-line-disc-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(discountRes.status).toBe(200);
    expect(await discountRes.json()).toMatchObject({ ok: true, folioLineId: discountLineId });
  });
```

Folio line ids are server-minted as `` `${reservationId}:item:${idempotencyKey}` `` (`handlePostFolioLines` ~3073) — the smoke test derives `chargeLineId` from the idempotency key passed to `postFolioLine`.

- [ ] **Step 2: Run HTTP tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "stay POST|\\[102\\] line POST"
```

Expected: **FAIL** — 404 route not found or handler missing.

- [ ] **Step 3: Implement contracts append, handler, dispatch route, register pins**

Apply normative blocks above. Rebuild contracts.

- [ ] **Step 4: Run HTTP tests and register pin**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "stay POST|\\[102\\] line POST"
```

Expected: **PASS** — `[127] = post_demo_seed`, `[102] = post_folio_discount`, `[128] = post_folio_stay_discount`, catalog **77**, writers **52**.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/folio-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): add stay-level folio discount HTTP route

EOF
)"
```

---

### Task 3: Client + SPA

**Spec:** §3.3 client, §5 SPA, §7 SPA RTL.

**Files:**
- Modify: `packages/client-core/src/api.ts` — add `postStayDiscount` after `postDiscount` (~925–946)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — discount mutation (~682–710)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` — stay RTL cases

**Interfaces:**
- Consumes: Task 2 HTTP route.
- Produces: `api.postStayDiscount(propertyId, reservationId, input, opId)`; SPA calls stay API when `!(discountLineId || splitLineId)`.

**Forbidden this commit:** DO/HTTP changes, spec pointers.

**`api.ts` — add after `postDiscount`:**

```typescript
    async postStayDiscount(
      propertyId: string,
      reservationId: string,
      input: {
        kind: 'percent' | 'fixed';
        bps?: number;
        amountMinor?: number;
        reason: string;
        folioLineId: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
```

**`FolioScreen.tsx` — replace `discount` mutationFn (~692–710):**

```typescript
    mutationFn: () => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      const reason = discountReason.trim();
      if (!reason) throw new Error('discount_reason_required');
      const sourceId = discountLineId || splitLineId;
      const parsed = Number(discountValue);
      const payload = {
        kind: discountKind,
        reason,
        ...(discountKind === 'percent'
          ? { bps: Math.round(parsed * 100) }
          : { amountMinor: Math.round(parsed * 100) }),
      };
      if (!sourceId) {
        return api.postStayDiscount(
          propertyId,
          reservationId,
          {
            ...payload,
            folioLineId: `${reservationId}:stay-disc:${crypto.randomUUID()}`,
          },
          `stay-disc:${reservationId}:${crypto.randomUUID()}`,
        );
      }
      return api.postDiscount(
        propertyId,
        sourceId,
        {
          ...payload,
          folioLineId: `${sourceId}:disc:${crypto.randomUUID()}`,
        },
        `disc:${sourceId}:${crypto.randomUUID()}`,
      );
    },
```

Keep `data-testid="post-discount"` and reason gate (disabled when reason empty).

**`FolioScreen.test.tsx` — add mock:**

At top with other mocks:

```ts
const postStayDiscount = vi.fn();
```

In `vi.mock('../client.js')` api object:

```ts
    postStayDiscount: (...args: unknown[]) => postStayDiscount(...args),
```

- [ ] **Step 1: Write failing RTL tests**

Append after case **55**:

```ts
  it('56: empty discount line id + reason → postStayDiscount; not postDiscount', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postStayDiscount.mockResolvedValue({ ok: true, folioLineId: 'stay_disc_1' });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('post-discount')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('discount-reason'), { target: { value: 'manager comp' } });
    const btn = screen.getByTestId('post-discount') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });

    expect(postStayDiscount).toHaveBeenCalledTimes(1);
    expect(postStayDiscount.mock.calls[0]?.[0]).toBe('prop_demo');
    expect(postStayDiscount.mock.calls[0]?.[1]).toBe('res_1');
    expect(postDiscount).not.toHaveBeenCalled();
  });

  it('57: filled discount line id → postDiscount; not postStayDiscount', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    postDiscount.mockResolvedValue({ ok: true, folioLineId: 'line_disc_1' });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('post-discount')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('discount-line-id'), { target: { value: 'line_room' } });
    fireEvent.change(screen.getByLabelText('discount-reason'), { target: { value: 'line comp' } });
    const btn = screen.getByTestId('post-discount') as HTMLButtonElement;
    await act(async () => {
      invokeReactClick(btn);
      await Promise.resolve();
    });

    expect(postDiscount).toHaveBeenCalledTimes(1);
    expect(postStayDiscount).not.toHaveBeenCalled();
  });
```

Case **55** must remain unchanged (empty reason → no API call).

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "55:|56:|57:"
```

Expected: **FAIL** on cases **56** / **57** (`postStayDiscount` not defined / wrong mutation path). Case **55** should still **PASS**.

- [ ] **Step 3: Implement `postStayDiscount`, FolioScreen branch, mock wiring**

Apply normative blocks above.

- [ ] **Step 4: Re-run RTL tests and color check**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "55:|56:|57:"
pnpm check:web-pms-colors
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts \
  apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): stay-level discount when no folio line selected

EOF
)"
```

---

### Task 4: Pointers + full CI (LAST)

**Spec:** §10 checklist, §1.1 heads, amends folio-money §7.3 + §19 and taxable-discounts §9, D5 reviewer locks.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — §7.3 leftover-6 sentence + §19 item **6**
- Modify: `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md` — §9 item **3**
- Modify: `docs/superpowers/plans/2026-08-14-stay-level-discounts.md` — Task 4 checkboxes (this file)
- Modify: `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md` — tick §10 checklist only

**Pointer sentences (normative):**

Folio-money-ops §7.3 (~390, replace the standalone leftover-6 sentence):

> Stay-level lump DISCOUNT (no source line) on the GUEST window posts with `split_of` NULL and no tax restamp; closed in [2026-08-14 stay-level discounts](./2026-08-14-stay-level-discounts-design.md). Line-level is auditable and foots.

Folio-money-ops §19 item **6** (~801):

> ~~**Stay-level discount** (no source line).~~ **Closed** in [2026-08-14 stay-level discounts](./2026-08-14-stay-level-discounts-design.md).

Taxable-discounts §9 item **3** (~252):

> ~~**Stay-level discount** (no source line). Folio-money leftover **6**~~ **Closed** in [2026-08-14 stay-level discounts](./2026-08-14-stay-level-discounts-design.md). Stay-level tax allocation remains a leftover.

- [x] **Step 1: Pin frozen heads (no schema bump)**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"
```

Expect: catalog **77**; `[127] = post_demo_seed`; `[102] = post_folio_discount`; `[128] = post_folio_stay_discount`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 7`; `generate:ddl` no-op.

- [x] **Step 2: Run targeted stay-discount test superset**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "40:|41:|42:|43:|44:|45:|46:|47:|48:"
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "stay POST|\\[102\\] line POST"
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "55:|56:|57:"
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 18|Test 19|Test 20|Test 21|Test 22|Test 23"
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "29:|30:"
pnpm check:pms-core-test-dates
```

Expected: **PASS** (preserves taxable-discounts line path + FX cases).

- [x] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

```bash
pnpm build
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
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures. Do **not** run unsharded `pnpm --filter @hospai/pms-core test` (may segfault).

- [x] **Step 4: Add spec pointers + tick spec §10 checklist**

Tick every item in spec §10 Implementation checklist in `docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md`.

- [x] **Step 5: Tick Task 4 checkboxes in this plan**

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-14-taxable-discounts-design.md \
  docs/superpowers/specs/2026-08-14-stay-level-discounts-design.md \
  docs/superpowers/plans/2026-08-14-stay-level-discounts.md
git commit -m "$(cat <<'EOF'
docs: close folio-money leftover 6 stay-level discounts

EOF
)"
```

**Stop.** Stay-level tax allocation, fan-out, promo codes, COMPANY/MASTER stay discount, and schema v28 stay deferred per spec §1.3 / §9.

---

## Spec §10 reviewer checklist (Task 4 ticks these in the spec file when CI is green)

| §10 item | Satisfied by |
|---|---|
| `tryPostDiscount` RPC union | Task 1 |
| Stay path: base, identity post, `splitOf` null, no stamp | Task 1 |
| Stay audit `afterJson` shape | Task 1 |
| Append `[128]` + handler + fingerprint | Task 2 |
| Heads frozen; `[102]`/`[127]` unmoved | Task 2 + 4 |
| `postStayDiscount` + SPA branch + RTL | Task 3 |
| DO tests §7 cases 1–7; HTTP stay + line regression | Tasks 1–4 |
| `register.test.ts` pins | Task 2 + 4 |
| Bidirectional pointers folio-money + taxable-discounts | Task 4 |
| Preserve 40–41 / 18–23 / 29–30 | Task 1 verify + Task 4 CI |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–7) | 1–3 |
| §1.3 scope out | forbidden all |
| §2 Lock 1–8 + invariants 9–14 | 1–2 |
| §3 command/HTTP line vs stay | 2–3 |
| §4 schema none | forbidden |
| §5 SPA | 3 |
| §6 errors (reuse only) | 1–2 |
| §7 tests DO + HTTP + SPA | 1–3 |
| §8 file map | 1–3 |
| §9 leftovers deferred | forbidden |
| §10 checklist | 4 |
| Heads table §1.1 | 4 |
| D-locks 1–5 | Open decisions |

**Gaps:** None — all §7 numbered cases and §10 checklist items map to Tasks 1–4.

**Contradictions with spec:** None. Tree matches spec §1.1: `tryPostDiscount` requires `sourceFolioLineId` today; line path includes `stampTaxForChargeSync`; `[127] post_demo_seed` is last audit row before append; `split_of` nullable; GUEST window helpers exist; taxable-discounts line restamp stays on line branch only.
