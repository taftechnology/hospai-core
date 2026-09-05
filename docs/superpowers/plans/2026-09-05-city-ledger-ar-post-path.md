# City ledger AR post path hardening (R0.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **L1**, **L2**, **L3**, **L4**, **U8**, **G2**, **G10** — city-ledger AR posts on desk transfer/checkout (not close-at-zero only), transfer guards and tax copy are honest, FolioScreen toast matches reality, smoke asserts COMPANY AR once.

**Architecture:** Characterization tests land **first** and must fail on current `main`. Replace `postCityLedgerChargeSync` insert-or-skip with private `syncCityLedgerArForWindowSync` (query charge + adjustment rows; delta posts `adjustment`). **Primary trigger:** transfer into COMPANY. **Catch-up:** checkout + existing night-audit CLOSED path. Relax COMPANY `WINDOW_BALANCE_DUE`; GUEST/MASTER unchanged. No new catalog command, route, or migration — **PROPERTY_SCHEMA_HEAD stays 34**.

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts`, vitest + `cloudflare:test`, React SPA (`apps/web-pms`), `scripts/smoke-staging.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-05-city-ledger-ar-post-path-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — query-only AR tracking; no v35 |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. No catalog/route/schema pin updates in any task unless a denormalized posted-AR column is added (explicitly rejected).

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| Primary AR trigger | `syncCityLedgerArForWindowSync` on transfer into **COMPANY** for `postedReceivableMinorSync` |
| Catch-up | Same sync at **checkout** (guest window still gates — B1); night-audit CLOSED catch-up may remain |
| COMPANY close | **No** `WINDOW_BALANCE_DUE` for receivable; sync before `closeFolioWindowSync` |
| L3 reopen | Delta `adjustment` row; never skip-forever on existing charge |
| L2 | **422** `line_already_transferred` if source already transferred to another COMPANY window |
| L4 | Copy tax amounts on transfer; **forbidden** `stampTaxForChargeSync` on dest parent |
| U8 | `cityLedgerSynced === true` → “Charge transferred.”; COMPANY dest without sync → “Moved to company folio.” |
| G2 | **Keep** `setupCompanyWindowAtZeroBalance` hook tests unchanged; add desk path beside them |
| G10 | One COMPANY transfer + close + AR assert in smoke; no night audit / Playwright |
| Money | Integer minor units; `allocate` only where split already does; **no `await` in `transactionSync`** |

**Out of scope:** new routes/commands, city ledger SPA rebuild, R0.1/R0.2, L5/L6, PropertyDO extraction, Playwright.

---

## Sequencing gate

```
Task 1 (red tests) → Task 2 (DO + contracts + dispatch, green) → Task 3 (SPA + smoke) → Task 4 (full CI + R0.3 tick)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T8, T10). Task 2 makes pms-core specs green. Task 3 makes SPA + smoke green. Task 4 runs full CI `checks` job + `pnpm test:local`.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Modify: `apps/pms-core/test/city-ledger.spec.ts`
- Modify: `apps/pms-core/test/folio-transfer-split.spec.ts`
- Modify: `apps/pms-core/test/folio-windows.spec.ts`
- Modify: `apps/pms-core/test/reservations-check-out-direct-bill.spec.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Interfaces:** none (tests only). Tests call existing DO RPCs (`tryTransferCharge`, `tryCloseFolioWindow`, `tryCheckOut`, `readCityLedgerAccount`, `readCityLedgerChargeForWindowForTest`).

### Step 1 — Test helper: posted AR sum (optional, local)

Add near `setupCompanyWindowAtZeroBalance` in `city-ledger.spec.ts`:

```ts
async function readCityLedgerPostedMinorForWindowForTest(
  stub: DurableObjectStub<PropertyDO>,
  folioWindowId: string,
): Promise<number> {
  const charge = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
  if (!charge) return 0;
  const detail = await stub.readCityLedgerAccount(charge.accountId);
  if (!detail.ok) return 0;
  return detail.entries
    .filter((e) => e.folioWindowId === folioWindowId && (e.kind === 'charge' || e.kind === 'adjustment'))
    .reduce((sum, e) => sum + e.amountMinor, 0);
}
```

If `readCityLedgerAccount` entries omit `folioWindowId`, sum via a new `readCityLedgerEntriesForWindowForTest` on PropertyDO in Task 2 — until then, assert via `readCityLedgerAccount(...).openBalanceMinor` and `readCityLedgerChargeForWindowForTest` + entry count on account detail.

### Step 2 — T1 desk path: transfer → close posts AR (`city-ledger.spec.ts`)

Add new `describe('city ledger desk path (L1)')` **after** existing hook tests in `describe('city ledger charge posting')` — do **not** edit hook tests.

```ts
  it('desk path: transfer ROOM to COMPANY then close posts AR without payment netting', async () => {
    const { stub } = await provisionedPropertyStub(`cl-desk-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const account = await createCityLedgerAccount(stub, { name: 'Desk Co', creditLimitMinor: 1_000_000 });
    if (!account.ok) throw new Error(account.error);

    const openFp = { reservationId, kind: 'COMPANY' as const, billedParty: 'Desk Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-desk-co', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) return;
    const companyWindowId = opened.folioWindowId;

    const roomLineId = `${reservationId}:room-desk`;
    await stub.insertFolioLineRawForTest({
      folioLineId: roomLineId,
      folioWindowId: `${reservationId}:GUEST`,
      reservationId,
      chargeCode: 'ROOM',
      amountMinor: 15_000,
      source: 'desk',
      businessDate,
    });

    const xfer = { sourceFolioLineId: roomLineId, destinationFolioWindowId: companyWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-desk', xfer)),
    ).toMatchObject({ ok: true });

    const closeFp = { folioWindowId: companyWindowId };
    const closed = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      closeFp,
      await idemFor('close-desk-co', closeFp),
    );
    expect(closed).toMatchObject({ ok: true });
    expect(closed).not.toMatchObject({ error: 'window_balance_due' });

    const charge = await stub.readCityLedgerChargeForWindowForTest(companyWindowId);
    expect(charge).toMatchObject({
      kind: 'charge',
      amountMinor: 15_000,
      accountId: account.accountId,
    });

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBe(15_000);
  });
```

**Red on `main`:** close returns `{ ok: false, error: 'window_balance_due' }`; no charge row.

### Step 3 — T2 reopen delta (`city-ledger.spec.ts`)

Uses hook helper for first close (G2); asserts adjustment on second close.

```ts
  it('reopen adds adjustment when receivable increases — AR not stuck at first close', async () => {
    const { stub } = await provisionedPropertyStub(`cl-reopen-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const firstReceivable = 10_000;
    const deltaReceivable = 3_500;
    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Reopen Co',
      receivableMinor: firstReceivable,
    });

    const closeFp = { folioWindowId };
    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        closeFp,
        await idemFor('close-reopen-1', closeFp),
      ),
    ).toMatchObject({ ok: true });

    expect(
      await stub.tryReopenFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId },
        await idemFor('reopen-co', { folioWindowId }),
      ),
    ).toMatchObject({ ok: true });

    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId,
      reservationId,
      chargeCode: 'MISC',
      amountMinor: deltaReceivable,
      source: 'desk',
      businessDate,
    });

    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        closeFp,
        await idemFor('close-reopen-2', closeFp),
      ),
    ).toMatchObject({ ok: true });

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBe(firstReceivable + deltaReceivable);
    expect(detail.entries.filter((e) => e.kind === 'charge')).toHaveLength(1);
    expect(detail.entries.filter((e) => e.kind === 'adjustment')).toHaveLength(1);
    expect(detail.entries.find((e) => e.kind === 'adjustment')?.amountMinor).toBe(deltaReceivable);
  });
```

**Red on `main`:** open balance stays `firstReceivable`; no adjustment row.

### Step 4 — T3 checkout catch-up (`city-ledger.spec.ts` or extend direct-bill spec)

Add to `city-ledger.spec.ts` (needs checked-in stay — copy minimal helpers from `reservations-check-out-direct-bill.spec.ts` or import shared pattern):

```ts
  it('checkout catch-up posts AR for open COMPANY window without close', async () => {
    const name = `cl-co-catch-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name); // inline or import helper
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_cl_co', 'rm_cl_co', arrival, addCalendarDays(arrival, 1));
    await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');

    expect(
      await stub.tryCreateCityLedgerAccount(
        TEST_OWNER_ACTOR,
        { name: 'Catch Co', creditLimitMinor: 1_000_000 },
        await idemFor('cla-catch', { name: 'Catch Co' }),
      ),
    ).toMatchObject({ ok: true });

    const openFp = { reservationId: 'res_cl_co', kind: 'COMPANY' as const, billedParty: 'Catch Co' };
    const opened = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      openFp,
      await idemFor('open-catch', openFp),
    );
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) return;

    const receivableMinor = 9_000;
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: opened.folioWindowId,
      reservationId: 'res_cl_co',
      chargeCode: 'ROOM',
      amountMinor: receivableMinor,
      source: 'desk',
      businessDate: (await stub.readBusinessDate())!,
    });

    expect(
      await stub.tryCheckOut(
        TEST_OWNER_ACTOR,
        { reservationId: 'res_cl_co' },
        await idemFor('co-catch', { reservationId: 'res_cl_co' }),
      ),
    ).toMatchObject({ ok: true });

    const charge = await stub.readCityLedgerChargeForWindowForTest(opened.folioWindowId);
    expect(charge).toMatchObject({ kind: 'charge', amountMinor: receivableMinor, source: 'check_out' });
  });
```

**Implementer note:** If importing `provisionedPropertyWithGuest` / `stayCheckedIn` from another spec file is awkward, duplicate the small helpers locally in `city-ledger.spec.ts` (same pattern as `reservations-check-out-direct-bill.spec.ts` lines 6–64).

**Red on `main`:** no charge row after checkout.

### Step 5 — T4 L2 double transfer (`folio-transfer-split.spec.ts`)

Add import: `LINE_ALREADY_TRANSFERRED` (constant added in Task 2 — use string literal `'line_already_transferred'` in Task 1 test to avoid contracts import failure, or import and accept compile error until Task 2).

```ts
  it('26: second transfer of same source to different COMPANY window → line_already_transferred', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    await seedReservation(stub, reservationId);

    const sourceId = `${reservationId}:misc-l2`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'MISC', amountMinor: 4000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('misc-l2', line))).toMatchObject({
      ok: true,
    });

    await seedCityLedgerAccount(stub, 'CoA', 'l2-a');
    await seedCityLedgerAccount(stub, 'CoB', 'l2-b');

    const openA = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'CoA' },
      await idemFor('open-l2-a', { reservationId, kind: 'COMPANY', billedParty: 'CoA' }),
    );
    const openB = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'CoB' },
      await idemFor('open-l2-b', { reservationId, kind: 'COMPANY', billedParty: 'CoB' }),
    );
    expect(openA).toMatchObject({ ok: true });
    expect(openB).toMatchObject({ ok: true });
    const destA = openA.ok ? openA.folioWindowId : '';
    const destB = openB.ok ? openB.folioWindowId : '';

    const xfer1 = { sourceFolioLineId: sourceId, destinationFolioWindowId: destA };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer1, await idemFor('xfer-l2-1', xfer1)),
    ).toMatchObject({ ok: true });

    const xfer2 = { sourceFolioLineId: sourceId, destinationFolioWindowId: destB };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer2, await idemFor('xfer-l2-2', xfer2)),
    ).toMatchObject({ ok: false, error: 'line_already_transferred' });
  });
```

**Red on `main`:** second transfer succeeds (duplicate dest on two COMPANY windows).

### Step 6 — T5 L4 tax copy (`folio-transfer-split.spec.ts`)

```ts
  it('27: transfer copies source tax amounts — does not restamp at new rule rate', async () => {
    const { stub } = await provisionedPropertyStub(crypto.randomUUID(), 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const arrival = await seedReservation(stub, reservationId);

    const tax10 = {
      taxRuleId: `tr_10_${crypto.randomUUID()}`,
      ruleKey: `room_sales_10_${crypto.randomUUID()}`,
      name: 'Room tax 10%',
      ruleType: 'PERCENTAGE' as const,
      rate: '0.10',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    };
    expect(
      await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, tax10, await idemFor(`tax-10`, tax10)),
    ).toMatchObject({ ok: true });

    const sourceId = `${reservationId}:room-l4`;
    const room = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 10_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, room, await idemFor('room-l4', room))).toMatchObject({
      ok: true,
    });

    const sourceTax = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX' && l.taxOf === sourceId,
    );
    expect(sourceTax?.amountMinor).toBe(1000);

    const tax20 = {
      taxRuleId: `tr_20_${crypto.randomUUID()}`,
      ruleKey: `room_sales_20_${crypto.randomUUID()}`,
      name: 'Room tax 20%',
      ruleType: 'PERCENTAGE' as const,
      rate: '0.20',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    };
    expect(
      await stub.tryCreateTaxRule(TEST_OWNER_ACTOR, tax20, await idemFor(`tax-20`, tax20)),
    ).toMatchObject({ ok: true });

    await seedCityLedgerAccount(stub, 'L4Co', 'l4');
    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId, kind: 'COMPANY', billedParty: 'L4Co' },
      await idemFor('open-l4', { reservationId, kind: 'COMPANY', billedParty: 'L4Co' }),
    );
    expect(open).toMatchObject({ ok: true });
    const destWindowId = open.ok ? open.folioWindowId : '';

    const xfer = { sourceFolioLineId: sourceId, destinationFolioWindowId: destWindowId };
    expect(
      await stub.tryTransferCharge(TEST_OWNER_ACTOR, xfer, await idemFor('xfer-l4', xfer)),
    ).toMatchObject({ ok: true });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const dest = lines.find((l) => l.source === 'TRANSFER' && l.chargeCode === 'ROOM');
    const destTax = lines.find((l) => l.source === 'TAX' && l.taxOf === dest?.folioLineId);
    expect(destTax?.amountMinor).toBe(sourceTax?.amountMinor);
    expect(destTax?.amountMinor).toBe(1000);
    expect(destTax?.amountMinor).not.toBe(2000);
  });
```

**Red on `main`:** dest tax restamped to 2000 via `stampTaxForChargeSync`.

### Step 7 — T6 AR on transfer (extend test 15)

At end of existing test `15: transfer ROOM from GUEST to COMPANY...`, add:

```ts
    const accountDetail = await stub.readCityLedgerAccount(
      (
        await stub.tryCreateCityLedgerAccount(
          TEST_OWNER_ACTOR,
          { name: 'Acme' },
          await idemFor('cla-lookup-15', { name: 'Acme' }),
        )
      ).ok
        ? /* resolve accountId via list or reuse seedCityLedgerAccount side effect */ ''
        : '',
    );
```

**Cleaner:** after transfer in test 15, resolve account by name:

```ts
    const accounts = await stub.readCityLedgerAccounts({ status: 'active' });
    const acme = accounts.find((a) => a.name === 'Acme');
    expect(acme).toBeTruthy();
    const detail = await stub.readCityLedgerAccount(acme!.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBeGreaterThan(0);
    expect(detail.openBalanceMinor).toBe(11_000); // 10000 ROOM + 1000 TAX
```

**Red on `main`:** `openBalanceMinor === 0`.

### Step 8 — T7 COMPANY non-zero close (`folio-windows.spec.ts`)

Add after test 11:

```ts
  it('15: close COMPANY with non-zero receivable succeeds when city ledger account exists', async () => {
    const name = `fw-15-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    await stayCheckedIn(stub, guestRef, 'res_fw15', 'rm_fw15', arrival, addCalendarDays(arrival, 1));
    await seedCityLedgerAccount(stub, 'Direct Bill Co', 'fw15');

    const open = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_fw15', kind: 'COMPANY', billedParty: 'Direct Bill Co' },
      await idemFor('open-fw15', { reservationId: 'res_fw15', kind: 'COMPANY', billedParty: 'Direct Bill Co' }),
    );
    expect(open).toMatchObject({ ok: true });
    if (!open.ok) return;
    const companyId = open.folioWindowId;

    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: companyId,
      reservationId: 'res_fw15',
      chargeCode: 'ROOM',
      amountMinor: 7_500,
      source: 'desk',
      businessDate: (await stub.readBusinessDate())!,
    });

    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        { folioWindowId: companyId },
        await idemFor('close-fw15', { folioWindowId: companyId }),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.readFolioWindowForTest(companyId))?.status).toBe('CLOSED');
  });
```

**Red on `main`:** `{ ok: false, error: 'window_balance_due' }`.

### Step 9 — T8 extend direct-bill checkout (`reservations-check-out-direct-bill.spec.ts`)

In first test after `expect(result).toMatchObject({ ok: true });`, add:

```ts
    const charge = await stub.readCityLedgerChargeForWindowForTest(opened.folioWindowId);
    expect(charge).toMatchObject({
      kind: 'charge',
      amountMinor: receivableMinor,
      source: 'check_out',
    });
    const detail = await stub.readCityLedgerAccount(account.ok ? account.accountId : '');
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBe(receivableMinor);
```

Fix `account` reference — first test uses `account` from `tryCreateCityLedgerAccount` result; use `if (!account.ok) throw` then `account.accountId`.

**Red on `main`:** `charge` is null.

### Step 10 — T10 U8 FolioScreen toast (`FolioScreen.test.tsx`)

Add tests after test 53. Pattern: mock `transferFolioLine` return value; trigger transfer UI; assert alert/message text.

```ts
  it('55: transfer to COMPANY with cityLedgerSynced shows Charge transferred.', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      windows: [
        {
          folioWindowId: 'res_1:GUEST',
          kind: 'GUEST',
          status: 'OPEN',
          billedParty: null,
          closedAt: null,
          balanceMinor: 5000,
        },
        {
          folioWindowId: 'res_1:COMPANY',
          kind: 'COMPANY',
          status: 'OPEN',
          billedParty: 'Acme',
          closedAt: null,
          balanceMinor: 0,
        },
      ],
      balanceMinor: 5000,
      lines: [miscLine],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    transferFolioLine.mockResolvedValue({
      ok: true,
      reverseFolioLineId: 'rev',
      destFolioLineId: 'dest',
      cityLedgerSynced: true,
    });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('transfer-dest-line_room')).toBeTruthy());
    // fire transfer confirm — match existing test 53 interaction pattern for select + submit
    await userEvent.selectOptions(screen.getByTestId('transfer-dest-line_room'), 'res_1:COMPANY');
    await userEvent.click(screen.getByRole('button', { name: /transfer/i }));

    await waitFor(() => expect(screen.getByText('Charge transferred.')).toBeTruthy());
  });

  it('56: transfer to COMPANY without cityLedgerSynced shows Moved to company folio.', async () => {
    // same setup; cityLedgerSynced: false (or omitted)
    transferFolioLine.mockResolvedValue({
      ok: true,
      reverseFolioLineId: 'rev',
      destFolioLineId: 'dest',
      cityLedgerSynced: false,
    });
    // ... same UI steps ...
    await waitFor(() => expect(screen.getByText('Moved to company folio.')).toBeTruthy());
  });
```

**Red on `main`:** always shows “Charge transferred.” (line ~844).

### Step 11 — Run vitest; confirm red

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/city-ledger.spec.ts \
  test/folio-transfer-split.spec.ts \
  test/folio-windows.spec.ts \
  test/reservations-check-out-direct-bill.spec.ts

pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

- [ ] T1–T8 fail on current `main` for the asserted behaviour
- [ ] Existing `setupCompanyWindowAtZeroBalance` hook tests (**T9 regression**) still pass unchanged
- [ ] T10 fails until Task 3 implements message branching
- [ ] Do **not** change production code in this task

### Step 12 — Commit (tests only)

```bash
git add \
  apps/pms-core/test/city-ledger.spec.ts \
  apps/pms-core/test/folio-transfer-split.spec.ts \
  apps/pms-core/test/folio-windows.spec.ts \
  apps/pms-core/test/reservations-check-out-direct-bill.spec.ts \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
test(pms-core,web-pms): city-ledger AR desk path characterization (red)

Add L1/L2/L3/L4/G2 desk-path tests beside hook helper; extend direct-bill
and FolioScreen U8 expectations. Tests fail on main where AR never posts.
EOF
)"
```

---

## Task 2 — DO production + contracts + dispatch

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (~14572, ~15506, ~15675, ~9662, ~19441–19552)
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/command-error.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (~374–509, ~6060–6093)

**Interfaces:**

```ts
// private sync helper (property-do.ts)
private postedArMinorForWindowSync(folioWindowId: string): number;

private syncCityLedgerArForWindowSync(input: {
  folioWindowId: string;
  source: 'transfer' | 'window_close' | 'check_out' | 'night_audit';
  actor: ActorContext;
}):
  | { ok: true; postedMinor: number; arSynced: boolean; alreadySynced?: true; entryId?: string }
  | { ok: false; error: typeof NOT_FOUND | typeof CITY_LEDGER_ACCOUNT_NOT_FOUND | typeof CITY_LEDGER_ACCOUNT_ARCHIVED };

// tryTransferCharge success (extended)
| { ok: true; reverseFolioLineId: string; destFolioLineId: string; cityLedgerSynced?: boolean }

// packages/contracts/src/idempotency.ts
export const LINE_ALREADY_TRANSFERRED = 'line_already_transferred' as const;
```

### Step 1 — Contracts: `LINE_ALREADY_TRANSFERRED`

In `packages/contracts/src/idempotency.ts`, after `LINE_NOT_TRANSFERABLE`:

```ts
export const LINE_ALREADY_TRANSFERRED = 'line_already_transferred' as const;
```

In `packages/contracts/src/command-error.ts`, add to folio error union (near `LINE_NOT_TRANSFERABLE`).

In `packages/contracts/src/idempotency.test.ts`:

```ts
expect(LINE_ALREADY_TRANSFERRED).toBe('line_already_transferred');
```

### Step 2 — `postedArMinorForWindowSync`

In `property-do.ts` near `postedReceivableMinorSync`:

```ts
private postedArMinorForWindowSync(folioWindowId: string): number {
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM city_ledger_entry
       WHERE folio_window_id = ? AND kind IN ('charge', 'adjustment')`,
      folioWindowId,
    )
    .toArray() as Array<{ total: number }>;
  return Number(rows[0]?.total ?? 0);
}
```

### Step 3 — Refactor `postCityLedgerChargeSync` → `syncCityLedgerArForWindowSync`

Replace insert-or-skip body (~19453–19530) with spec §2.1 algorithm:

```ts
private syncCityLedgerArForWindowSync(input: {
  folioWindowId: string;
  source: 'transfer' | 'window_close' | 'check_out' | 'night_audit';
  actor: ActorContext;
}):
  | { ok: true; postedMinor: number; arSynced: boolean; alreadySynced?: true; entryId?: string }
  | {
      ok: false;
      error:
        | typeof NOT_FOUND
        | typeof CITY_LEDGER_ACCOUNT_NOT_FOUND
        | typeof CITY_LEDGER_ACCOUNT_ARCHIVED;
    } {
  const window = this.readFolioWindowRowSync(input.folioWindowId);
  if (!window || window.kind !== 'COMPANY') return { ok: false, error: NOT_FOUND };

  const targetMinor = this.postedReceivableMinorSync(input.folioWindowId);
  if (targetMinor <= 0) {
    return { ok: true, postedMinor: 0, arSynced: false };
  }

  const billedParty = window.billedParty?.trim() ?? '';
  const account = this.resolveCityLedgerAccountSync(billedParty);
  if (!account) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };
  if (account.status === 'archived') return { ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED };

  const postedMinor = this.postedArMinorForWindowSync(input.folioWindowId);
  const deltaMinor = targetMinor - postedMinor;
  if (deltaMinor === 0) {
    return { ok: true, postedMinor, arSynced: false, alreadySynced: true };
  }

  const accountRow = this.readCityLedgerAccountRowSync(account.accountId);
  if (!accountRow) return { ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND };

  const open = this.openBalanceMinorSync(account.accountId);
  if (accountRow.creditLimitMinor > 0 && open + deltaMinor > accountRow.creditLimitMinor) {
    throw new CityLedgerCreditLimitExceededError();
  }

  const businessDate = this.readBusinessDateSync() ?? new Date().toISOString().slice(0, 10);
  const currency = this.readStoredLedgerCurrencySync() ?? 'USD';
  const propertyId = this.getPropertyIdSync();
  const now = Date.now();

  const existingCharge = this.ctx.storage.sql
    .exec(
      `SELECT entry_id FROM city_ledger_entry
       WHERE folio_window_id = ? AND kind = 'charge' LIMIT 1`,
      input.folioWindowId,
    )
    .toArray() as Array<{ entry_id: string }>;

  if (!existingCharge[0]) {
    const entryId = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      `INSERT INTO city_ledger_entry
       (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
        business_date, source, reference, created_at)
       VALUES (?, ?, ?, ?, 'charge', ?, ?, ?, ?, NULL, ?)`,
      entryId,
      account.accountId,
      window.reservationId,
      input.folioWindowId,
      targetMinor,
      currency,
      businessDate,
      input.source,
      now,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'city_ledger.charge_posted',
      payload: {
        propertyId,
        entryId,
        folioWindowId: input.folioWindowId,
        accountId: account.accountId,
        amountMinor: targetMinor,
        source: input.source,
        reservationId: window.reservationId,
      },
    });
    return { ok: true, postedMinor: targetMinor, arSynced: true, entryId };
  }

  const entryId = crypto.randomUUID();
  this.ctx.storage.sql.exec(
    `INSERT INTO city_ledger_entry
     (entry_id, account_id, reservation_id, folio_window_id, kind, amount_minor, currency,
      business_date, source, reference, created_at)
     VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?)`,
    entryId,
    account.accountId,
    window.reservationId,
    input.folioWindowId,
    deltaMinor,
    currency,
    businessDate,
    input.source,
    existingCharge[0].entry_id,
    now,
  );
  return { ok: true, postedMinor: postedMinor + deltaMinor, arSynced: true, entryId };
}
```

Keep thin wrapper for night-audit call site:

```ts
private postCityLedgerChargeSync(input: {
  folioWindowId: string;
  source: 'window_close' | 'night_audit';
  actor: ActorContext;
}) {
  const sync = this.syncCityLedgerArForWindowSync(input);
  if (!sync.ok) return sync;
  if (sync.arSynced && sync.entryId) return { ok: true as const, entryId: sync.entryId };
  if (sync.alreadySynced) {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT entry_id FROM city_ledger_entry WHERE folio_window_id = ? AND kind = 'charge' LIMIT 1`,
        input.folioWindowId,
      )
      .toArray() as Array<{ entry_id: string }>;
    return { ok: true as const, entryId: row[0]?.entry_id ?? '', alreadyPosted: true as const };
  }
  return { ok: true as const, entryId: '' };
}
```

- [ ] All SQL stays inside existing `transactionSync` callers — **no `await`**
- [ ] First charge uses full `targetMinor`; adjustments use signed `deltaMinor`
- [ ] `city_ledger.charge_posted` event only on first charge insert

### Step 4 — `tryCloseFolioWindow`: relax COMPANY balance gate

Replace ~14604–14623:

```ts
          const balance = this.windowBalanceMinorSync(input.folioWindowId);
          if (window.kind === 'GUEST') {
            const resRows = this.ctx.storage.sql
              .exec(`SELECT status FROM reservation WHERE reservation_id = ?`, window.reservationId)
              .toArray() as Array<{ status: string }>;
            const status = resRows[0]?.status;
            if (status !== 'checked_out' && status !== 'cancelled' && status !== 'no_show') {
              throw new FolioWindowError(WINDOW_NOT_CLOSABLE);
            }
            if (balance !== 0) throw new FolioWindowError(WINDOW_BALANCE_DUE);
          } else if (window.kind === 'MASTER') {
            if (balance !== 0) throw new FolioWindowError(WINDOW_BALANCE_DUE);
          }

          if (window.kind === 'COMPANY') {
            const syncResult = this.syncCityLedgerArForWindowSync({
              folioWindowId: input.folioWindowId,
              source: 'window_close',
              actor,
            });
            if (!syncResult.ok) throw new CityLedgerError(syncResult.error);
          }
```

- [ ] COMPANY never hits `WINDOW_BALANCE_DUE` for non-zero receivable
- [ ] GUEST/MASTER balance rules unchanged

### Step 5 — `tryCheckOut`: COMPANY catch-up loop

Add private helper:

```ts
private listCompanyFolioWindowsForReservationSync(reservationId: string): Array<{ folioWindowId: string }> {
  return this.ctx.storage.sql
    .exec(
      `SELECT folio_window_id FROM folio_window
       WHERE reservation_id = ? AND kind = 'COMPANY'`,
      reservationId,
    )
    .toArray() as Array<{ folio_window_id: string }>;
}
```

Inside `tryCheckOut` `transactionSync`, **after** audit log append (~9805) and **before** guest auto-close block:

```ts
          for (const row of this.listCompanyFolioWindowsForReservationSync(input.reservationId)) {
            const syncResult = this.syncCityLedgerArForWindowSync({
              folioWindowId: row.folio_window_id,
              source: 'check_out',
              actor,
            });
            if (!syncResult.ok) throw new CityLedgerError(syncResult.error);
          }
```

- [ ] Guest balance gate (~9716–9724) untouched (B1)
- [ ] Does not auto-close COMPANY windows

### Step 6 — L4 tax copy + AR sync in `transferFolioLineSync`

**Replace** `stampTaxForChargeSync` block (~15613–15628) with tax copy loop:

```ts
    for (const tax of taxLines) {
      this.insertFolioLineSync({
        folioLineId: `${tax.folio_line_id}:xfer:${input.destinationFolioWindowId}`,
        folioWindowId: input.destinationFolioWindowId,
        reservationId: source.reservation_id,
        chargeCode: tax.charge_code,
        posted: {
          amountMinor: tax.amount_minor,
          txnCurrency,
          ledgerAmountMinor: tax.ledger_amount_minor,
          fxRate: source.fx_rate,
          fxRateAt: source.fx_rate_at,
        },
        source: 'TAX',
        taxOf: destFolioLineId,
        taxRuleId: tax.tax_rule_id,
        splitOf: source.folio_line_id,
        paymentId: null,
      });
    }
```

Extend `taxLines` query (~15564) to include `txn_currency`, `fx_rate`, `fx_rate_at` from source parent (join or reuse `source` row for FX fields on tax lines).

After dest lines inserted, if dest window is COMPANY:

```ts
    const destWindow = this.readFolioWindowRowSync(input.destinationFolioWindowId);
    let cityLedgerSynced = false;
    if (destWindow?.kind === 'COMPANY') {
      const sync = this.syncCityLedgerArForWindowSync({
        folioWindowId: input.destinationFolioWindowId,
        source: 'transfer',
        actor: input.deskActor ?? { kind: 'system', reason: 'night_audit.auto_transfer' },
      });
      if (!sync.ok) throw new CityLedgerError(sync.error);
      cityLedgerSynced = sync.arSynced;
    }

    return { reverseFolioLineId, destFolioLineId, cityLedgerSynced };
```

Update return type of `transferFolioLineSync` and night-audit caller (~3718) to ignore extra field.

### Step 7 — L2 guards + `cityLedgerSynced` in `tryTransferCharge`

Before `transferFolioLineSync` (~15747), add:

```ts
          const priorReverse = this.ctx.storage.sql
            .exec(
              `SELECT 1 AS one FROM folio_line
               WHERE split_of = ? AND source = 'TRANSFER_REVERSAL' LIMIT 1`,
              input.sourceFolioLineId,
            )
            .toArray();
          if (priorReverse.length > 0) {
            throw new FolioWindowError(LINE_ALREADY_TRANSFERRED);
          }

          const otherDest = this.ctx.storage.sql
            .exec(
              `SELECT folio_window_id FROM folio_line
               WHERE split_of = ? AND source = 'TRANSFER'
                 AND folio_window_id != ?
               LIMIT 1`,
              input.sourceFolioLineId,
              input.destinationFolioWindowId,
            )
            .toArray() as Array<{ folio_window_id: string }>;
          if (otherDest.length > 0) {
            throw new FolioWindowError(LINE_ALREADY_TRANSFERRED);
          }
```

Import `LINE_ALREADY_TRANSFERRED` from `@hospai/contracts`.

Update success return:

```ts
          const xfer = this.transferFolioLineSync({ ... });
          return {
            ok: true as const,
            reverseFolioLineId: xfer.reverseFolioLineId,
            destFolioLineId: xfer.destFolioLineId,
            cityLedgerSynced: xfer.cityLedgerSynced,
          };
```

Extend Promise return type union accordingly.

### Step 8 — Dispatch: map `line_already_transferred` → 422

In `mapReservationConcreteCommandErrorStatus` (~465–473), add:

```ts
    case LINE_ALREADY_TRANSFERRED:
```

Import constant in `v1-dispatch.ts`. Falls through to **422** with other folio errors.

`handlePostFolioTransfer` already returns `json(result, 200)` on success — `cityLedgerSynced` passes through automatically once DO returns it.

### Step 9 — Update test 15 title (L4)

In `folio-transfer-split.spec.ts`, rename test 15 description from “tax restamped” to “tax copied” (behaviour change).

### Step 10 — Focused test run (must go green)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/city-ledger.spec.ts \
  test/folio-transfer-split.spec.ts \
  test/folio-windows.spec.ts \
  test/reservations-check-out-direct-bill.spec.ts \
  test/reservations-check-out.spec.ts
```

- [ ] T1–T8 green
- [ ] Hook tests in `city-ledger.spec.ts` (G2) still green
- [ ] B1 checkout tests in `reservations-check-out.spec.ts` unchanged green

```bash
pnpm typecheck
```

### Step 11 — Commit

```bash
git add \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/command-error.ts \
  packages/contracts/src/idempotency.test.ts \
  apps/pms-core/test/folio-transfer-split.spec.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): sync city-ledger AR on transfer, close, and checkout

Add syncCityLedgerArForWindowSync with adjustment deltas; relax COMPANY
close balance gate; L2 transfer guard; L4 tax copy; checkout catch-up.
EOF
)"
```

---

## Task 3 — SPA U8 + smoke G10

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~831–847)
- Modify: `packages/client-core/src/api.ts` (~873–890) — response typing only
- Modify: `scripts/smoke-staging.mjs`

**Interfaces:**
- Consumes: `tryTransferCharge` success `{ ok: true, ..., cityLedgerSynced?: boolean }` from Task 2

### Step 1 — Client-core typing

Near folio transfer return type in `api.ts` (or infer from usage), document optional field:

```ts
// Transfer success body includes optional cityLedgerSynced from post_folio_transfer
```

If `getJson` is untyped, add a narrow type alias used by FolioScreen:

```ts
export type FolioTransferResult = {
  ok: true;
  reverseFolioLineId: string;
  destFolioLineId: string;
  cityLedgerSynced?: boolean;
};
```

### Step 2 — FolioScreen U8 message branching

Replace `transferLine` mutation (~831–847):

```tsx
  const transferLine = useFolioActionMutation({
    fallback: 'Transfer failed',
    setMessage,
    mutationFn: (input: { folioLineId: string; destinationFolioWindowId: string }) => {
      if (!canAdjust) throw new Error('policy_blocked_adjust');
      return api.transferFolioLine(
        propertyId,
        input.folioLineId,
        { destinationFolioWindowId: input.destinationFolioWindowId },
        `xfer:${input.folioLineId}:${crypto.randomUUID()}`,
      );
    },
    onSuccess: (result, input) => {
      const destWindow = folio?.windows?.find((w) => w.folioWindowId === input.destinationFolioWindowId);
      const destIsCompany = destWindow?.kind === 'COMPANY';
      if (destIsCompany && result && typeof result === 'object' && 'cityLedgerSynced' in result && result.cityLedgerSynced === true) {
        setMessage('Charge transferred.');
      } else if (destIsCompany) {
        setMessage('Moved to company folio.');
      } else {
        setMessage('Charge transferred.');
      }
      void queryClient.invalidateQueries({ queryKey: ['folio', propertyId, reservationId] });
    },
  });
```

- [ ] Use existing `setMessage` / Alert pattern — no raw JSON errors
- [ ] Non-COMPANY dest keeps “Charge transferred.”

**Note:** Adjust `useFolioActionMutation` generic/onSuccess signature if it currently strips response — pass through success body.

### Step 3 — Smoke G10: COMPANY transfer + close + AR assert

Insert **after step 9 (check-in)** and **before step 10 (invoice)** in `scripts/smoke-staging.mjs`. Re-number later steps in comments only (keep script short).

```js
  const accountName = `Smoke Direct ${suffix}`;

  // Step 9b: POST city-ledger account
  const claRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: accountName,
        creditLimitMinor: 500_000,
        idempotencyKey: `idem-cla-${suffix}`,
      }),
    },
  );
  const claBody = await readJson(claRes);
  if (claRes.status !== 201) fail('9b', claRes.status, snippet(claBody));
  const accountId = claBody?.accountId;
  console.log('✓ step 9b: POST city-ledger account');

  // Step 9c: GET folio — find ROOM line on GUEST window
  const folioRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
    { headers: bearerOnly },
  );
  const folioBody = await readJson(folioRes);
  if (folioRes.status !== 200) fail('9c', folioRes.status, snippet(folioBody));
  const guestLine = (folioBody?.lines ?? []).find(
    (l) => l.chargeCode === 'ROOM' && l.folioWindowId === `${reservationId}:GUEST`,
  );
  if (!guestLine?.folioLineId) fail('9c', folioRes.status, 'missing GUEST ROOM folio line');

  // Step 9d: POST folio window (COMPANY)
  const fwRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/folio/windows`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        reservationId,
        kind: 'COMPANY',
        billedParty: accountName,
        idempotencyKey: `idem-fw-co-${suffix}`,
      }),
    },
  );
  const fwBody = await readJson(fwRes);
  if (fwRes.status !== 201 && fwRes.status !== 200) fail('9d', fwRes.status, snippet(fwBody));
  const companyWindowId = fwBody?.folioWindowId;
  if (!companyWindowId) fail('9d', fwRes.status, 'missing company folioWindowId');

  // Step 9e: POST folio transfer GUEST → COMPANY
  const xferRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(guestLine.folioLineId)}/transfer`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        destinationFolioWindowId: companyWindowId,
        idempotencyKey: `idem-xfer-${suffix}`,
      }),
    },
  );
  const xferBody = await readJson(xferRes);
  if (xferRes.status !== 200) fail('9e', xferRes.status, snippet(xferBody));
  console.log('✓ step 9e: POST folio transfer to COMPANY');

  // Step 9f: POST folio window close (COMPANY)
  const closeRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/folio/windows/${encodeURIComponent(companyWindowId)}/close`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ idempotencyKey: `idem-close-co-${suffix}` }),
    },
  );
  const closeBody = await readJson(closeRes);
  if (closeRes.status !== 200) fail('9f', closeRes.status, snippet(closeBody));
  console.log('✓ step 9f: POST folio window close (COMPANY)');

  // Step 9g: GET city-ledger account — openBalanceMinor > 0
  const clDetailRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts/${encodeURIComponent(accountId)}`,
    { headers: bearerOnly },
  );
  const clDetailBody = await readJson(clDetailRes);
  if (clDetailRes.status !== 200) fail('9g', clDetailRes.status, snippet(clDetailBody));
  if (!(clDetailBody?.openBalanceMinor > 0)) {
    fail('9g', clDetailRes.status, `expected openBalanceMinor > 0, got ${clDetailBody?.openBalanceMinor}`);
  }
  console.log('✓ step 9g: GET city-ledger account (AR posted)');
```

- [ ] No night audit step
- [ ] Verify folio/transfer/close URL paths against `V1_ROUTES` if smoke fails (adjust path segments to match kebab routes in `v1-dispatch.ts`)

### Step 4 — Run tests

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
pnpm typecheck
```

- [ ] T10 (tests 55–56) green

Smoke (staging credentials required, after deploy):

```bash
BASE=… CLERK_SESSION_JWT=… pnpm smoke:staging
```

### Step 5 — Commit

```bash
git add \
  apps/web-pms/src/screens/FolioScreen.tsx \
  packages/client-core/src/api.ts \
  scripts/smoke-staging.mjs
git commit -m "$(cat <<'EOF'
fix(web-pms,smoke): honest transfer toast and COMPANY AR smoke assert

Branch FolioScreen copy on cityLedgerSynced; extend smoke-staging with
direct-bill transfer, close, and openBalanceMinor check (G10/U8).
EOF
)"
```

---

## Task 4 — Full CI + tick R0.3

**Files:** `docs/roadmap.md` (R0.3 checkbox only)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/city-ledger.spec.ts \
  test/folio-transfer-split.spec.ts \
  test/folio-windows.spec.ts \
  test/reservations-check-out-direct-bill.spec.ts

pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
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

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.3

In `docs/roadmap.md` line ~179, change:

```markdown
- [ ] **R0.3** Audit V3 — L1, L2, L3, L4, U8, G2, G10. ...
```

to:

```markdown
- [x] **R0.3** Audit V3 — L1, L2, L3, L4, U8, G2, G10. ...
```

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.3 after city-ledger AR post path hardening

Full CI checks and pms-core shards green; audit L1/L2/L3/L4/U8/G2/G10 closed.
EOF
)"
```

---

## Test matrix (spec §5 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `city-ledger.spec.ts` | 1 | Transfer → close → AR charge; not `window_balance_due` | Yes |
| T2 | `city-ledger.spec.ts` | 1 | Reopen → +charges → adjustment delta | Yes |
| T3 | `city-ledger.spec.ts` | 1 | Checkout → AR `check_out` source | Yes |
| T4 | `folio-transfer-split.spec.ts` | 1 | 2nd COMPANY dest → `line_already_transferred` | Yes |
| T5 | `folio-transfer-split.spec.ts` | 1 | Tax copied not restamped | Yes |
| T6 | `folio-transfer-split.spec.ts` | 1 | Test 15 → `openBalanceMinor === 11000` | Yes |
| T7 | `folio-windows.spec.ts` | 1 | COMPANY non-zero close ok | Yes |
| T8 | `reservations-check-out-direct-bill.spec.ts` | 1 | Checkout → CL row + balance | Yes |
| T9 | `city-ledger.spec.ts` | 1–2 | Hook helper tests unchanged | No (regression) |
| T10 | `FolioScreen.test.tsx` | 1–3 | U8 toast branching | Yes |
| T11 | `reservations-check-out.spec.ts` | 2 | B1 guest balance gate | No (regression) |

---

## Success criteria (spec §10)

1. Desk path transfer → close or checkout → posted receivable on city ledger (**L1**).
2. Reopen + charges → adjustment; AR not stuck (**L3**).
3. Second transfer same source → **422** `line_already_transferred` (**L2**).
4. Transfer tax copied (**L4**).
5. FolioScreen honest toast (**U8**).
6. Hook tests beside desk tests (**G2**).
7. Smoke COMPANY AR assert once (**G10**).
8. B1 checkout tests green.
9. Pins unchanged (head **34**).
10. `pnpm test:local` green.

---

## Plan vs codebase mismatches (reviewer)

| Item | Notes |
|---|---|
| `listCompanyWindowsForReservationSync` in spec pseudocode | **Not on `main`** — plan uses `listCompanyFolioWindowsForReservationSync` (new private helper). |
| `reservations-check-out-direct-bill.spec.ts` test 1 title | Claims “city ledger entry” but **never asserted** until Task 1 T8. |
| Test 15 title “tax restamped” | **Wrong after L4** — rename in Task 2 Step 9. |
| `tryCloseFolioWindow` ~14614 | Balance gate applies to **all** kinds today; plan splits GUEST/MASTER vs COMPANY. |
| `postCityLedgerChargeSync` source type | Only `'window_close' \| 'night_audit'` today; sync adds `'transfer' \| 'check_out'`. |
| Smoke folio/transfer URL paths | Verify against live `V1_ROUTES` patterns before staging run — paths in Task 3 are indicative. |
| FolioScreen `onSuccess` | Currently no `result` parameter — Task 3 must extend `useFolioActionMutation` if needed. |
| Spec §4.3 dispatch “folio handler block ~467” | Actual mapping is `mapReservationConcreteCommandErrorStatus` ~465; plan uses that switch. |
