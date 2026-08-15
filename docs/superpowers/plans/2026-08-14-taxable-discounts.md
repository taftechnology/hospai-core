# Taxable discounts (folio money ops leftover 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-14)

**Goal:** After `folio.post_discount` inserts a negative `DISCOUNT` line, call existing `stampTaxForChargeSync` with the **source product charge code** so negative tax children attach to the discount parent — original ROOM and its TAX rows stay untouched — with no new catalog row, route index, or schema migration.

**Architecture:** Mirror transfer restamp: inside the existing `tryPostDiscount` / `runIdempotent` txn, after `insertFolioLineSync` for `DISCOUNT`, invoke `stampTaxForChargeSync` with `parentSource: 'DESK'`, `chargeCode: source.charge_code`, `posted` = discount `PostedLineAmount`, `postingDate: resolvePostingBusinessDateSync()`. Tax base is `posted.ledgerAmountMinor` (negative at source frozen FX). Exempt sources no-op. Idempotent replay returns cached `{ folioLineId }` without duplicate tax (`folio_line_tax_uniq`).

**Tech Stack:** PropertyDO + sqlite (`stampTaxForChargeSync`, `tryPostDiscount`), `@hospai/money` (`computeTax`, `postToLedger`), `@hospai/contracts` (unchanged `folio.post_discount` / `[102] post_folio_discount`), vitest Worker specs (`provisionHotel`, `worker.fetch`, DO stub).

**Spec:** `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md` (Approved). Spec commit: `b0c108c`.

---

## Sequencing gate (read before starting)

This slice closes **folio money ops leftover 5 — taxable discounts / tax restamp on discount**.

| After this plan | Do not start |
|---|---|
| Discount restamp via `stampTaxForChargeSync` on DISCOUNT parent | Stay-level discount (folio-money leftover **6**) |
| Negative tax children `taxOf` → discount line | Promo codes (folio-money leftover **7**) |
| `computeTax` negative-base unit pin | City ledger / AR, invoices |
| HTTP `{ ok, folioLineId }` unchanged; tax on GET folio | Night-audit auto-transfer (`NIGHT_AUDIT_STEPS` growth) |
| — | Discount tax true-up to remaining |
| — | Reverse original TAX + restamp on source |
| — | Global `DISCOUNT.tax_group` change |
| — | New catalog/route/schema v28 |
| — | Demo seed rewrite |
| — | SPA restamp UI |
| — | Dry run 2, guest CRM, virtual leftovers, `rooms.delete` |
| — | Real PSP |

---

## Open decisions (locked — do not re-litigate)

### D1 — Same command / route

**Locked:** `folio.post_discount` / `[102] post_folio_discount` unchanged. Do not move `[102]`. Last route `[127] = post_demo_seed`. `[101] = post_folio_refund`. Catalog **77**. Writers **52**. `PLATFORM_GAPS` `[]`. Schema **27** (no migration). Org **7**. `NIGHT_AUDIT_STEPS` **7**. Demo seed untouched.

### D2 — Restamp shape (spec Lock 2)

**Locked:** After DISCOUNT insert, `stampTaxForChargeSync` with:

| Param | Value |
|---|---|
| `parentLineId` | discount `folioLineId` |
| `parentSource` | `'DESK'` |
| `chargeCode` | **`source.charge_code`** (not `DISCOUNT`) |
| `posted` | discount `PostedLineAmount` from existing `postToLedger` |
| `postingDate` | `resolvePostingBusinessDateSync()` |
| `folioWindowId` / `reservationId` | source's |
| `parentAmountMinor` | `posted.amountMinor` |

Do **not** reverse original TAX. Do **not** change `DISCOUNT.tax_group`. Do **not** add charge codes.

### D3 — Test discipline

**Locked:** Assert discount tax via **`taxOf === discountFolioLineId`**, never `chargeCode === 'TAX'` alone (ROOM also has TAX). Case 3: MISC seed is GOODS — `patchChargeCode(..., { taxGroup: null })` like `tax-posting.spec.ts` Test 2 (~365). Fixture ids via `crypto.randomUUID()`. Do not `vi.spyOn` into the DO isolate. Unsharded `pnpm --filter @hospai/pms-core test` may segfault — use `vitest run <file> -t "<filter>"` or `--shard=N/8` (**no `--` before `--shard`**).

### D4 — Reviewer locks (CI / tooling)

1. **Rebuild `@hospai/contracts` / `@hospai/client-core`** only if those packages change (they should not).
2. **Contracts pin:** `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"` — **not** `-t "COMMAND_CATALOG|post_demo_seed"`.
3. **Night-audit pin:** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"`.
4. **`pnpm generate:ddl` then `git diff --exit-code -- migrations packages/do-runtime`** must be a **true no-op** (no v28).
5. **Do not `|| true` CI failures.** Workerd 503 on a shard: retry that shard once.
6. **Bidirectional one-sentence pointers** in folio-money-ops §7.3 + §19 and tax-posting §2.5 — **Task 4 only**, plus tick plan checkboxes and spec §10 there.
7. Living plan checkboxes: tick `- [x]` on **Task 4 only**.

---

## Global Constraints

- **Heads frozen:** `COMMAND_CATALOG.length === 77`; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `V1_HTTP_ROUTE_AUDIT[102].id === 'post_folio_discount'`; `V1_HTTP_ROUTE_AUDIT[101].id === 'post_folio_refund'`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS = []`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 7`.
- **Append-only folio.** Never mutate source charge or source TAX amounts. Correction = new DISCOUNT + new negative TAX children only.
- **HTTP body/fingerprint/`{ ok, folioLineId }` unchanged.** Tax lines appear on GET folio only.
- **Zero SPA product change.** Do not touch `FolioScreen.tsx` unless a test mock breaks (it should not).
- **`FAIL_CLOSED` / `runIdempotent` sync-only** inside `transactionSync` — unchanged.
- **Per-line rounding accepted.** Do not true-up net tax to `computeTax(remaining)`.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/money/src/index.test.ts` | Negative `computeTax` pin | 1 |
| `packages/money/src/index.ts` | `computeTax` (fix only if Task 1 test fails) | 1 |
| `apps/pms-core/src/property-do.ts` | `tryPostDiscount` — add `stampTaxForChargeSync` after DISCOUNT insert (~12807–12815) | 2 |
| `apps/pms-core/test/tax-posting.spec.ts` | DO cases 1–4, 7; HTTP discount + GET folio (Task 3) | 2, 3 |
| `apps/pms-core/test/folio-fx-split-transfer.spec.ts` | Case **29** — add `seedRoomTax` + discount-tax assertions | 3 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | One-sentence pointer §7.3 + §19 leftover 5 | 4 |
| `docs/superpowers/specs/2026-08-07-tax-posting-design.md` | One-sentence pointer §2.5 skip/stamp note | 4 |
| `docs/superpowers/plans/2026-08-14-taxable-discounts.md` | Tick checkboxes (Task 4 only) | 4 |
| `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md` | Tick §10 checklist (Task 4 only) | 4 |

**Not touched:** `COMMAND_CATALOG`, `v1-http-routes.ts` append order, `catalog.ts`, `v1-dispatch.ts` contract, `packages/client-core/src/api.ts`, `FolioScreen.tsx` (preferred zero), `property-migrations.ts`, `demo-seed`, `NIGHT_AUDIT_STEPS`, transfer restamp path.

---

## Spec §1.2 / §7 / §10 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) restamp after DISCOUNT insert | 2 |
| §1.2 (2) source + source TAX untouched | 2 |
| §1.2 (3) exempt → DISCOUNT only | 2 |
| §1.2 (4) per-line rounding accepted (no true-up) | 2 (forbidden to fix) |
| §1.2 (5) tests §7 DO + HTTP + money | 1–3 |
| §1.2 (6) `computeTax` negative-base unit | 1 |
| §7 DO cases 1–4, 7 | 2 |
| §7 DO case 5 (FX) | 3 |
| §7 DO case 6 (rejects) | 2 (verify case 30) |
| §7 HTTP POST discount + GET folio tax child | 3 |
| §7 preserve `folio-extras` 40–41 | 2 verify |
| §10 checklist + spec pointers | 4 |
| §1.3 scope out | forbidden all tasks |

---

### Task 1: Money — negative `computeTax`

**Spec:** §1.2 (6), §7 money unit, Lock 6 (negative base valid).

**Files:**
- Modify: `packages/money/src/index.test.ts` (~71–91, inside `describe('computeTax')`)
- Modify (only if test fails): `packages/money/src/index.ts` (~164–174)

**Interfaces:**
- Produces: documented expectation `computeTax(-1000, '0.10') === -100` for discount tax path.

**Forbidden this commit:** `property-do.ts`, pms-core tests.

- [ ] **Step 1: Write the test**

Append inside `describe('computeTax')`:

```ts
it('computes tax on negative base (discount path)', () => {
  expect(computeTax(-1000, '0.10')).toBe(-100);
});
```

- [ ] **Step 2: Run test**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "negative base"
```

Expected: **PASS on first run** (implementation at `packages/money/src/index.ts` ~164–174 already allows negative `baseMinor` — no non-negative guard). If PASS, skip Step 3.

Expected if tree regressed: **FAIL** — wrong sign or thrown error.

- [ ] **Step 3: Fix `computeTax` only if Step 2 failed**

Keep BigInt × rate / `roundHalfAwayFromZero` path. Do **not** add a guard rejecting negative bases.

- [ ] **Step 4: Re-run test**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "negative base"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/money/src/index.test.ts
# include packages/money/src/index.ts only if Step 3 changed it
git commit -m "$(cat <<'EOF'
test(money): pin computeTax on negative bases

EOF
)"
```

---

### Task 2: DO — stamp tax on discount (core product)

**Spec:** §2 Lock 2–5, §7 cases **1–4, 7**, §8 file impact, case 6 verify via existing case 30.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryPostDiscount` (~12807–12815, after DISCOUNT `insertFolioLineSync`)
- Modify: `apps/pms-core/test/tax-posting.spec.ts` — append DO discount tests (reuse existing `idemFor` import from `./fixtures.js` line 21)

**Interfaces:**
- Consumes: `stampTaxForChargeSync` (~1688–1748), `computeTax`, `postToLedger`, `resolvePostingBusinessDateSync`.
- Produces: discount posting that inserts negative TAX children with `taxOf = discountFolioLineId`; idempotent replay without duplicate tax.

**Forbidden this commit:** HTTP discount test (Task 3); `folio-fx-split-transfer.spec.ts` case 29 edits; spec pointers; `DISCOUNT.tax_group` seed change; reversing source TAX.

**Note:** `listFolioLinesForReservation` SELECT omits `fxRate` (`property-do.ts` ~16014). Do not assert `fxRate` on lines from that RPC — use `readFolio` / GET folio for FX fields (Task 3 case 29).

**Normative implementation** — insert immediately after DISCOUNT `insertFolioLineSync` (~12807–12815), before `appendAuditLogSync`:

```ts
this.stampTaxForChargeSync({
  parentLineId: input.folioLineId,
  parentAmountMinor: posted.amountMinor,
  parentSource: 'DESK',
  chargeCode: source.charge_code,
  reservationId: source.reservation_id,
  folioWindowId: source.folio_window_id,
  postingDate: this.resolvePostingBusinessDateSync(),
  posted,
});
```

- [ ] **Step 1: Write failing DO tests (spec §7 cases 1–4, 7)**

Append to `describe('tax posting matrix')` in `apps/pms-core/test/tax-posting.spec.ts`:

```ts
it('Test 18: percent discount on taxable ROOM restamps negative tax on discount line', async () => {
  const owner = `user_tax_disc_pct_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_pct_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  const roomRuleId = `tr_room_${crypto.randomUUID()}`;
  await seedRoomTaxRule(
    propertyId,
    owner,
    arrival,
    roomRuleId,
    `room_sales_${crypto.randomUUID()}`,
    '0.10',
  );

  const { res: roomRes, folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'ROOM',
    amountMinor: 10_000,
    idempotencyKey: `idem-room-${crypto.randomUUID()}`,
  });
  expect(roomRes.status).toBe(201);

  const roomTaxBefore = (await stub.listFolioLinesForReservation(reservationId)).find(
    (l) => l.source === 'TAX' && l.taxOf === roomLineId,
  );
  expect(roomTaxBefore).toMatchObject({
    amountMinor: computeTax(10_000, '0.10'),
    taxRuleId: roomRuleId,
  });

  const discountLineId = `disc_${crypto.randomUUID()}`;
  const discountInput = {
    sourceFolioLineId: roomLineId,
    kind: 'percent' as const,
    bps: 1000,
    reason: 'comp night',
    folioLineId: discountLineId,
  };
  expect(
    await stub.tryPostDiscount(
      { kind: 'user', userId: owner },
      discountInput,
      await idemFor(`disc-${discountLineId}`, discountInput),
    ),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });

  const lines = await stub.listFolioLinesForReservation(reservationId);
  expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
    chargeCode: 'DISCOUNT',
    amountMinor: -1000,
    splitOf: roomLineId,
  });

  const discountTax = lines.find((l) => l.source === 'TAX' && l.taxOf === discountLineId);
  expect(discountTax).toMatchObject({
    amountMinor: computeTax(-1000, '0.10'),
    taxRuleId: roomRuleId,
  });

  const roomTaxAfter = lines.find((l) => l.source === 'TAX' && l.taxOf === roomLineId);
  expect(roomTaxAfter).toEqual(roomTaxBefore);
});

it('Test 19: fixed discount on taxable ROOM restamps negative tax on discount line', async () => {
  const owner = `user_tax_disc_fix_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_fix_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  const roomRuleId = `tr_room_fix_${crypto.randomUUID()}`;
  await seedRoomTaxRule(
    propertyId,
    owner,
    arrival,
    roomRuleId,
    `room_sales_fix_${crypto.randomUUID()}`,
    '0.10',
  );

  const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'ROOM',
    amountMinor: 8000,
    idempotencyKey: `idem-room-fix-${crypto.randomUUID()}`,
  });

  const discountLineId = `disc_fix_${crypto.randomUUID()}`;
  const discountInput = {
    sourceFolioLineId: roomLineId,
    kind: 'fixed' as const,
    amountMinor: 2500,
    reason: 'fixed comp',
    folioLineId: discountLineId,
  };
  expect(
    await stub.tryPostDiscount(
      { kind: 'user', userId: owner },
      discountInput,
      await idemFor(`disc-fix-${discountLineId}`, discountInput),
    ),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });

  const lines = await stub.listFolioLinesForReservation(reservationId);
  expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
    chargeCode: 'DISCOUNT',
    amountMinor: -2500,
  });
  expect(lines.find((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toMatchObject({
    amountMinor: computeTax(-2500, '0.10'),
    taxRuleId: roomRuleId,
  });
});

it('Test 20: exempt MISC (taxGroup null) discount posts DISCOUNT only', async () => {
  const owner = `user_tax_disc_exempt_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_exempt_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  await seedGoodsTaxRule(propertyId, owner, arrival, `tr_goods_${crypto.randomUUID()}`, `goods_${crypto.randomUUID()}`, '0.0825');
  expect((await patchChargeCode(propertyId, owner, 'MISC', { taxGroup: null })).status).toBe(200);

  const { folioLineId: miscLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'MISC',
    amountMinor: 5000,
    idempotencyKey: `idem-misc-${crypto.randomUUID()}`,
  });

  const discountLineId = `disc_exempt_${crypto.randomUUID()}`;
  const discountInput = {
    sourceFolioLineId: miscLineId,
    kind: 'percent' as const,
    bps: 1000,
    reason: 'exempt comp',
    folioLineId: discountLineId,
  };
  expect(
    await stub.tryPostDiscount(
      { kind: 'user', userId: owner },
      discountInput,
      await idemFor(`disc-exempt-${discountLineId}`, discountInput),
    ),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });

  const lines = await stub.listFolioLinesForReservation(reservationId);
  expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
  expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
    chargeCode: 'DISCOUNT',
    amountMinor: -500,
  });
});

it('Test 21: stacked ROOM tax rules produce two negative tax lines on discount', async () => {
  const owner = `user_tax_disc_stack_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_stack_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  const stateRuleId = `tr_state_${crypto.randomUUID()}`;
  const cityRuleId = `tr_city_${crypto.randomUUID()}`;
  expect(
    (
      await postTaxRule(propertyId, owner, {
        taxRuleId: stateRuleId,
        ruleKey: `state_${crypto.randomUUID()}`,
        name: 'State room',
        ruleType: 'PERCENTAGE',
        rate: '0.06',
        taxGroup: 'ROOM',
        outputChargeCode: 'TAX',
        validFrom: arrival,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await postTaxRule(propertyId, owner, {
        taxRuleId: cityRuleId,
        ruleKey: `city_${crypto.randomUUID()}`,
        name: 'City room',
        ruleType: 'PERCENTAGE',
        rate: '0.02',
        taxGroup: 'ROOM',
        outputChargeCode: 'TAX',
        validFrom: arrival,
      })
    ).status,
  ).toBe(201);

  const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'ROOM',
    amountMinor: 10_000,
    idempotencyKey: `idem-room-stack-${crypto.randomUUID()}`,
  });

  const discountLineId = `disc_stack_${crypto.randomUUID()}`;
  const discountInput = {
    sourceFolioLineId: roomLineId,
    kind: 'percent' as const,
    bps: 1000,
    reason: 'stack comp',
    folioLineId: discountLineId,
  };
  expect(
    await stub.tryPostDiscount(
      { kind: 'user', userId: owner },
      discountInput,
      await idemFor(`disc-stack-${discountLineId}`, discountInput),
    ),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });

  const discountTaxLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
    (l) => l.source === 'TAX' && l.taxOf === discountLineId,
  );
  expect(discountTaxLines).toHaveLength(2);
  expect(discountTaxLines.map((l) => l.taxRuleId).sort()).toEqual([cityRuleId, stateRuleId].sort());
  expect(discountTaxLines.every((l) => l.amountMinor < 0)).toBe(true);
});

it('Test 22: idempotent discount replay returns same folioLineId without duplicate tax', async () => {
  const owner = `user_tax_disc_idem_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_idem_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  await seedRoomTaxRule(
    propertyId,
    owner,
    arrival,
    `tr_idem_${crypto.randomUUID()}`,
    `room_idem_${crypto.randomUUID()}`,
    '0.10',
  );

  const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'ROOM',
    amountMinor: 6000,
    idempotencyKey: `idem-room-idem-${crypto.randomUUID()}`,
  });

  const discountLineId = `disc_idem_${crypto.randomUUID()}`;
  const discountInput = {
    sourceFolioLineId: roomLineId,
    kind: 'percent' as const,
    bps: 1000,
    reason: 'idem comp',
    folioLineId: discountLineId,
  };
  const idem = await idemFor(`disc-idem-${crypto.randomUUID()}`, discountInput);
  expect(
    await stub.tryPostDiscount({ kind: 'user', userId: owner }, discountInput, idem),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });
  expect(
    await stub.tryPostDiscount({ kind: 'user', userId: owner }, discountInput, idem),
  ).toMatchObject({ ok: true, folioLineId: discountLineId });

  const lines = await stub.listFolioLinesForReservation(reservationId);
  expect(lines.filter((l) => l.folioLineId === discountLineId)).toHaveLength(1);
  expect(lines.filter((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 18|Test 19|Test 20|Test 21|Test 22"
```

Expected: FAIL — no discount tax lines (`stampTaxForChargeSync` not called yet).

- [ ] **Step 3: Implement `stampTaxForChargeSync` call in `tryPostDiscount`**

Paste normative block above after DISCOUNT insert. Do not reverse source TAX. Do not change `DISCOUNT.tax_group`.

- [ ] **Step 4: Run discount tests to verify they pass**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 18|Test 19|Test 20|Test 21|Test 22"
```

Expected: PASS.

- [ ] **Step 5: Verify rejects + existing MISC discount tests stay green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "30:"
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "40:|41:"
```

Expected: PASS (case **30** unchanged — do not rewrite unless red).

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/tax-posting.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): restamp tax when posting a folio discount

EOF
)"
```

---

### Task 3: FX case 29 + HTTP

**Spec:** §7 case **5** (FX), §7 HTTP, §5 SPA zero change.

**Files:**
- Modify: `apps/pms-core/test/folio-fx-split-transfer.spec.ts` — case **29** (~184–218)
- Modify: `apps/pms-core/test/tax-posting.spec.ts` — HTTP test + `getFolio` helper

**Interfaces:**
- Consumes: Task 2 `tryPostDiscount` restamp behaviour.
- Produces: case 29 asserts discount tax via `taxOf`; HTTP POST discount + GET folio shows tax child `taxOf === folioLineId`.

**Forbidden this commit:** `FolioScreen.tsx`; `vi.spyOn` on DO; rewriting case **30** unless red.

**Add import** to `folio-fx-split-transfer.spec.ts`:

```ts
import { computeTax } from '@hospai/money';
```

**Case 29 patch (normative)** — replace:

```ts
await seedReservation(stub, reservationId);
await createEurRate(stub);
```

with:

```ts
const arrival = await seedReservation(stub, reservationId);
await createEurRate(stub);
await seedRoomTax(stub, arrival);
```

Do not call `seedRoomTax(stub, arrival)` against an unbound `arrival`.

Keep existing DISCOUNT FX assertions (~213–218). After them, add:

```ts
const discountLine = folio.lines.find((l) => l.chargeCode === 'DISCOUNT');
expect(discountLine).toBeTruthy();
if (!discountLine) throw new Error('discount');
const roomTax = folio.lines.find((l) => l.source === 'TAX' && l.taxOf === sourceId);
expect(roomTax).toMatchObject({
  amountMinor: computeTax(11_000, '0.10'),
  ledgerAmountMinor: computeTax(11_000, '0.10'),
});
const discountTax = folio.lines.find((l) => l.source === 'TAX' && l.taxOf === discountLine.folioLineId);
expect(discountTax).toMatchObject({
  amountMinor: computeTax(-1100, '0.10'),
  ledgerAmountMinor: computeTax(-1100, '0.10'),
  txnCurrency: 'USD',
  fxRate: '1',
});
```

**HTTP helper + test** — append to `tax-posting.spec.ts`:

```ts
async function getFolio(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

it('Test 23: HTTP POST discount then GET folio includes tax child on discount line', async () => {
  const owner = `user_tax_disc_http_${crypto.randomUUID()}`;
  const { propertyId, arrival, guestRef } = await provisionHotel(owner);
  const reservationId = `res_tax_disc_http_${crypto.randomUUID()}`;
  expect(
    (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
      .status,
  ).toBe(201);

  await seedRoomTaxRule(
    propertyId,
    owner,
    arrival,
    `tr_http_${crypto.randomUUID()}`,
    `room_http_${crypto.randomUUID()}`,
    '0.10',
  );

  const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
    chargeCode: 'ROOM',
    amountMinor: 10_000,
    idempotencyKey: `idem-room-http-${crypto.randomUUID()}`,
  });

  const discountLineId = `disc_http_${crypto.randomUUID()}`;
  const discountRes = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(roomLineId)}/discount`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          kind: 'percent',
          bps: 1000,
          reason: 'http comp',
          folioLineId: discountLineId,
          idempotencyKey: `idem-disc-http-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
  expect(discountRes.status).toBe(200);
  const posted = (await discountRes.json()) as { ok: true; folioLineId: string };
  expect(posted).toMatchObject({ ok: true, folioLineId: discountLineId });

  const folioRes = await getFolio(propertyId, owner, reservationId);
  expect(folioRes.status).toBe(200);
  const body = (await folioRes.json()) as {
    ok: true;
    lines: Array<{ source: string; taxOf?: string; amountMinor: number }>;
  };
  const taxChild = body.lines.find((l) => l.source === 'TAX' && l.taxOf === posted.folioLineId);
  expect(taxChild).toMatchObject({ amountMinor: computeTax(-1000, '0.10') });
});
```

- [ ] **Step 1: Write failing FX + HTTP tests**

Apply case 29 patch and append Test 23 above.

- [ ] **Step 2: Run tests to verify they fail (before Task 2 landed) or pass (after Task 2)**

If implementing Task 3 immediately after Task 2, run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "29:"
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 23"
```

Expected after Task 2: **PASS** (tests document FX + HTTP paths). If Task 3 runs in isolation before Task 2, expect FAIL on discount tax assertions.

- [ ] **Step 3: Fix only test wiring if red**

Do not change product code unless a test bug (e.g. wrong ledger base in assertion). Product restamp ships in Task 2.

- [ ] **Step 4: Re-run targeted tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "29:"
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 23"
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "30:"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/test/folio-fx-split-transfer.spec.ts apps/pms-core/test/tax-posting.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): cover discount tax restamp over FX and HTTP

EOF
)"
```

---

### Task 4: Pointers + full CI (LAST)

**Spec:** §10 checklist, §1.1 heads, amends folio-money §7.3 + §19 and tax-posting §2.5, D4 reviewer locks.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` — §7.3 + §19 leftover **5**
- Modify: `docs/superpowers/specs/2026-08-07-tax-posting-design.md` — §2.5 skip/stamp note
- Modify: `docs/superpowers/plans/2026-08-14-taxable-discounts.md` — checkboxes (this file)
- Modify: `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md` — tick §10 checklist only

**Pointer sentences (normative):**

Folio-money-ops §7.3 (~387, replace "exempt this chunk — leftover 5, taxable discounts" lead):

> Manual discounts restamp tax on the new DISCOUNT parent using the source product charge code (not `DISCOUNT`); closed in [2026-08-14 taxable discounts](./2026-08-14-taxable-discounts-design.md).

Folio-money-ops §19 item **5** (~800):

> ~~**Taxable discounts** / tax restamp on discount.~~ **Closed** in [2026-08-14 taxable discounts](./2026-08-14-taxable-discounts-design.md).

Tax-posting §2.5 engine skips list (~159, after item 3 or as new bullet):

> Discount parents (`source = 'DESK'`) are **not** skipped; restamp uses the **source product `chargeCode`**, not `DISCOUNT` — see [2026-08-14 taxable discounts](./2026-08-14-taxable-discounts-design.md).

- [x] **Step 1: Pin frozen heads (no schema bump)**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts -t "night-audit step count is 7"
```

Expect: catalog **77**; route **[127] = post_demo_seed**; `[102] = post_folio_discount`; `[101] = post_folio_refund`; `PROPERTY_SCHEMA_HEAD === 27`; `ORG_SCHEMA_HEAD === 7`; `AUDIT_WRITER_COMMAND_IDS.size === 52`; `PLATFORM_GAPS === []`; `NIGHT_AUDIT_STEPS.length === 7`; `generate:ddl` no-op.

- [x] **Step 2: Run targeted taxable-discount test superset**

```bash
pnpm --filter @hospai/money exec vitest run src/index.test.ts -t "negative base"
pnpm --filter @hospai/pms-core exec vitest run test/tax-posting.spec.ts -t "Test 18|Test 19|Test 20|Test 21|Test 22|Test 23"
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-split-transfer.spec.ts -t "29:|30:"
pnpm --filter @hospai/pms-core exec vitest run test/folio-extras.spec.ts -t "40:|41:"
pnpm check:pms-core-test-dates
```

Expected: PASS.

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

Tick every item in spec §10 Implementation checklist in `docs/superpowers/specs/2026-08-14-taxable-discounts-design.md`.

- [x] **Step 5: Tick Task 4 checkboxes in this plan**

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  docs/superpowers/specs/2026-08-07-tax-posting-design.md \
  docs/superpowers/specs/2026-08-14-taxable-discounts-design.md \
  docs/superpowers/plans/2026-08-14-taxable-discounts.md
git commit -m "$(cat <<'EOF'
docs: close folio-money leftover 5 taxable discounts

EOF
)"
```

**Stop.** Stay-level discount, promo codes, true-up, reverse+restamp on source, and SPA restamp UI stay deferred per spec §1.3 / §9.

---

## Spec §10 reviewer checklist (Task 4 ticks these in the spec file when CI is green)

| §10 item | Satisfied by |
|---|---|
| `tryPostDiscount` restamp with lock-2 params | Task 2 |
| Original source + source TAX untouched; no new charge codes | Task 2 |
| Exempt source → DISCOUNT only; no new error code | Task 2 |
| Idempotent replay; no duplicate tax | Task 2 |
| DO tests §7 (cases 1–4, 7) green | Tasks 2–4 |
| HTTP test: POST discount + GET folio tax child | Task 3–4 |
| `computeTax` negative-base unit test | Task 1–4 |
| Case **29**: `seedRoomTax` + `taxOf` discount tax; DISCOUNT FX preserved | Task 3–4 |
| Heads unchanged (`[102]`, catalog **77**, writers **52**, route **[127]**, schema **27**, `NIGHT_AUDIT_STEPS` **7**, `PLATFORM_GAPS` `[]`) | Task 4 pins |
| Demo seed untouched; SPA zero product change | forbidden all tasks |
| Bidirectional pointers in folio-money-ops §7.3 + §19 and tax-posting §2.5 | Task 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–6) | 1–3 |
| §1.3 scope out | forbidden all |
| §2 Lock 1–6 + invariants 7–13 | 2 |
| §3–§4 command/HTTP unchanged | forbidden |
| §5 SPA zero change | forbidden |
| §6 errors unchanged | 2 verify case 30 |
| §7 tests 1–7 + HTTP + money | 1–3 |
| §8 file map | 1–3 |
| §9 leftovers deferred | forbidden |
| §10 checklist | 4 |
| Heads table §1.1 | 4 |
| D-locks 1–4 | Open decisions |

**Gaps:** None — all §7 numbered cases and §10 checklist items map to Tasks 1–4.

**Contradictions with spec:** None. Tree matches spec §1.1: `tryPostDiscount` lacks stamp today; `stampTaxForChargeSync` does not skip `DESK`; transfer restamp uses source charge code; `[102]` discount / `[101]` refund indices frozen.
