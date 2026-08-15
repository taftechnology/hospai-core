# Split command collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Collapse three split catalog commands into one survivor — `folio.split_charge` absorbs v2 cross-window + payment-line semantics; one HTTP route (`post_folio_split`); one DO RPC (`trySplitFolioLine`); one client method (`splitFolioLine`). Retire `folio.split_charge_payment`, `folio.split_charge_v2`, their HTTP paths, and DO RPCs. Catalog **92 → 90**; audit writers **65 → 63**; route audit **146 → 144** with first-ever physical removal re-pin. Deterministic reverse id **`${sourceFolioLineId}:split-rev`**. No schema migration, no new events/wire codes/permissions.

**Architecture:** All three split commands already wrap `splitFolioLineSync` (~14368). Survivor merges v2 validation (optional `folioWindowId` per slice, PAYMENT allowed, cross-window TRANSFER children) into `trySplitFolioLine`; deletes `trySplitChargeV2` (~15336) and `trySplitChargePayment` (~18039). HTTP survivor `handlePostFolioSplit` (~5554) gains optional `folioWindowId` in body; retired paths return **404** (no stub). Route audit uses physical row deletion — grep every `V1_HTTP_ROUTE_AUDIT[n]` in `register.test.ts` and apply Lock 5 shift table.

**Tech Stack:** `@hospai/contracts` catalog/routes, PropertyDO (`apps/pms-core/src/property-do.ts`), vitest Worker HTTP (`folio-transfer-split.spec.ts`, `folio-payments.spec.ts`, `folio-routes.spec.ts`), `@hospai/client-core`, web-pms RTL (`FolioScreen.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-15-split-command-collapse-design.md` (every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes Phase 1 leftover **12** and folio-money §19 leftover **2** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~42–43, ~52).

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **92 → 90** | Retire `reservations.update_extras` (item **13**) |
| `AUDIT_WRITER_COMMAND_IDS.size` **65 → 63** | Schema migration (`PROPERTY_SCHEMA_HEAD` stays **33**) |
| `V1_HTTP_ROUTE_AUDIT` length **146 → 144**; last `[143] get_city_ledger_statement` | HTTP deprecation shims on `/split-payment` / `/split-v2` |
| `PROPERTY_SCHEMA_HEAD` **33** unchanged | New events, wire codes, permissions |
| `NIGHT_AUDIT_STEPS` length **8** unchanged | SPA split UX redesign (buttons stay; API calls collapse) |
| `PLATFORM_GAPS === []` | `REPLAY_DISPATCH` changes (no split commands today) |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.2)

**Locked:** `COMMAND_CATALOG` **92 → 90** — delete `folio.split_charge_payment`, `folio.split_charge_v2`; update survivor notes. `AUDIT_WRITER_COMMAND_IDS.size` **65 → 63** — remove two retiring ids; keep `folio.split_charge`. `V1_HTTP_ROUTE_AUDIT` **146 → 144** — delete `post_folio_split_payment` (was `[47]`) and `post_folio_split_v2` (was `[99]`); re-pin all shifted indexes; add `entitlement: 'pms.core'` on survivor `[24] post_folio_split`. `PROPERTY_SCHEMA_HEAD` **33**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8**. `PLATFORM_GAPS` stays `[]`.

### D2 — Survivor semantics (spec Lock 1)

**Locked:** `folio.split_charge` keeps `prototypeAction: 'SPLIT_FOLIO_CHARGE'`, `lane: 'INTERACTIVE'`, `degraded: 'FAIL_CLOSED'`, `idempotent: true`, `events: ['folio.line_posted']`, `entitlement: 'pms.core'`, `permission: 'folio:adjust'`. Allows `PAYMENT` source; optional `folioWindowId` per slice; rejects `SPLIT_REVERSAL` / `TAX` / `CHARGEBACK` / FX_* charge codes. Reverse id **`${sourceFolioLineId}:split-rev`**. Fingerprint `{ sourceFolioLineId, splits: [{ folioLineId, amountMinor, folioWindowId? }] }`.

### D3 — Retire two commands (spec Locks 2–3)

**Locked:** Delete catalog entries, audit writer ids, DO RPCs `trySplitChargeV2` + `trySplitChargePayment`, HTTP handlers `handlePostFolioSplitV2` + `handlePostFolioSplitPayment`, client methods `splitFolioLineV2` + `splitFolioPayment`. Audit row always `commandId: 'folio.split_charge'`.

### D4 — Route audit removal (spec Lock 5)

**Locked:** Physical delete from `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in the **same commit**. No deprecation field. Shift table:

| Old index | Route id | New index |
|---|---|---|
| `[24]` | `post_folio_split` | `[24]` *(add `entitlement: 'pms.core'`)* |
| `[47]` | `post_folio_split_payment` | *(removed)* |
| `[48]`–`[98]` | *(each)* | **−1** |
| `[99]` | `post_folio_split_v2` | *(removed)* |
| `[100]`–`[145]` | *(each)* | **−2** |

Representative post-land pins: `[47] get_folio_payment`, `[48] get_folio_payments`, `[60] get_audit_log`, `[91] post_reservation_confirm`, `[94] post_folio_window`, `[97] post_folio_transfer`, `[98] post_folio_void`, `[101] post_folio_capture_due`, `[102] post_room_ooo_range`, `[138] post_invoice_void`, `[139] post_city_ledger_accounts`, `[143] get_city_ledger_statement`.

### D5 — Client + SPA (spec Locks 6–7)

**Locked:** One `splitFolioLine` with v2 body shape → `POST …/split`. FolioScreen charge split (~612) and payment split (~633) both call `api.splitFolioLine`. Keep separate buttons and `data-testid="split-payment"`.

### D6 — Tests / CI discipline (spec Lock 10)

**Locked:** TDD — failing tests before implementation per task. File-filter vitest; **no `vi.spyOn` into DO isolate.** Rebuild `@hospai/contracts` before pms-core tests (Task 2+). Rebuild `@hospai/client-core` before web-pms tests (Task 5). `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D7 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 6 only** at implementation time. Folio-money §19 pointer — **Task 6 only**. No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` stays 33** — no migration, no DDL.
- **Catalog 90 / writers 63 / routes 144** — physical removal; re-pin every shifted `register.test.ts` assertion (grep `V1_HTTP_ROUTE_AUDIT[`).
- **Historical ledger ids untouched** — existing `:rev:${uuid}` and `:v2-rev` rows remain; only new writes use `:split-rev`.
- **Idempotency cache replays unaffected** — `runIdempotent` returns stored `{ folioLineIds }` without re-running sync.
- **`folio.transfer_charge` unchanged** this chunk.
- **Scope-out (forbidden all tasks):** schema migration; new events/wire codes/permissions; HTTP stubs on retired paths; `reservations.update_extras` retirement; SPA UX redesign; `REPLAY_DISPATCH`; `ARCHITECTURE.md`; push; ticking Tasks 1–5 living boxes.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/test/folio-transfer-split.spec.ts` | DO tests 20–25; `:split-rev`; drop v2 catalog assertion | 1 |
| `apps/pms-core/test/folio-payments.spec.ts` | RPC rename; Test 15 rewrite; payment split cases | 1 |
| `apps/pms-core/test/folio-routes.spec.ts` | 404 on retired paths; optional cross-window body in Test 6 | 1 |
| `packages/contracts/src/register.test.ts` | Catalog 90, writers 63, route re-pins, payment/money-ops tests | 1, 2 |
| `packages/contracts/src/commands/catalog.ts` | Delete 2 entries; update survivor notes | 2 |
| `packages/contracts/src/commands/audit-writers.ts` | Remove 2 ids | 2 |
| `packages/contracts/src/v1-http-routes.ts` | Remove 2 audit rows; `entitlement` on `[24]` | 2 |
| `apps/pms-core/src/property-do.ts` | Merge `trySplitFolioLine`; delete 2 RPCs; `:split-rev` | 3 |
| `apps/pms-core/src/v1-dispatch.ts` | Extend survivor handler; delete 2 handlers + 2 `V1_ROUTES` | 4 |
| `packages/client-core/src/api.ts` | Extend `splitFolioLine`; delete 2 methods | 5 |
| `packages/client-core/test/api-folio.test.ts` | Client test update | 5 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Both mutations → `splitFolioLine` | 5 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Mock `splitFolioLine` only | 5 |
| `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` | §19 leftover 2 pointer | 6 |
| `.superpowers/sdd/progress-phase1-leftovers.md` | Item **12** DONE | 6 |
| `docs/superpowers/specs/2026-08-15-split-command-collapse-design.md` | Tick §8 checklist | 6 |
| `docs/superpowers/plans/2026-08-15-split-command-collapse.md` | Task 6 checkboxes (this file) | 6 |

**Not touched:** `property-migrations.ts`, `event-consumer.ts`, `replay-dispatch.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `ARCHITECTURE.md`, `degraded-mode.spec.ts` (Test 14 unchanged).

---

## Spec §1.3 / §8 → task map

| Spec item | Task |
|---|---|
| §1.3 (1) Survivor catalog entry | 2 |
| §1.3 (2) Retire two catalog entries | 2 |
| §1.3 (3) DO consolidation | 3 |
| §1.3 (4) HTTP survivor + delete handlers | 4 |
| §1.3 (5) Route audit removal + re-pin | 2, 4 |
| §1.3 (6) Client one method | 5 |
| §1.3 (7) SPA collapse | 5 |
| §1.3 (8) Audit writers | 2 |
| §1.3 (9) Register / invariant updates | 1, 2 |
| §1.3 (10) Tests Lock 10 | 1, 5 |
| §8 checklist + folio-money §19 pointer | 6 |
| §1.4 scope out | forbidden all |

---

### Task 1: Failing tests — DO specs + register pin targets

**Spec:** Lock 10 (TDD first), Lock 9 (register targets).

**Files:**
- Modify: `apps/pms-core/test/folio-transfer-split.spec.ts` (~202–345)
- Modify: `apps/pms-core/test/folio-payments.spec.ts` (~652–788)
- Modify: `apps/pms-core/test/folio-routes.spec.ts` (~326+)
- Modify: `packages/contracts/src/register.test.ts` (~741–742, ~752–754, ~977–1040, all shifted `V1_HTTP_ROUTE_AUDIT[n]`)

**Interfaces:**
- Tests expect `trySplitFolioLine` everywhere (not `trySplitChargeV2` / `trySplitChargePayment`)
- Tests expect reverse id `:split-rev` (not `:v2-rev`)
- Register expects catalog **90**, writers **63**, route tail `[143] get_city_ledger_statement`

**Forbidden this commit:** Production implementation changes (`property-do.ts`, `v1-dispatch.ts`, `catalog.ts`, `api.ts`, `FolioScreen.tsx`).

- [ ] **Step 1: Update `folio-transfer-split.spec.ts`**

**Test 20** — add reverse id assertion after split:

```typescript
  it('20: split_charge same-window reverse+children; balanceMinor unchanged; reverse id :split-rev', async () => {
    // ... existing setup unchanged ...
    expect(
      await stub.trySplitFolioLine(TEST_OWNER_ACTOR, split, await idemFor('v1-20', split)),
    ).toMatchObject({ ok: true });
    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === `${sourceId}:split-rev`)?.source).toBe('SPLIT_REVERSAL');
    expect(lines.filter((l) => l.splitOf === sourceId && l.source !== 'SPLIT_REVERSAL')).toHaveLength(2);
    // ... balance assertion unchanged ...
  });
```

**Tests 21–24** — replace every `trySplitChargeV2` → `trySplitFolioLine`; replace `:v2-rev` → `:split-rev`:

```typescript
    expect(lines.find((l) => l.folioLineId === `${sourceId}:split-rev`)?.source).toBe('SPLIT_REVERSAL');
```

**Test 25** — remove `COMMAND_CATALOG.some(… split_charge_v2)`; keep transfer gap assertions:

```typescript
  it('25: PLATFORM_GAPS no longer contains folio.transfer_charge', () => {
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.transfer_charge');
    expect(COMMAND_CATALOG.some((c) => c.id === 'folio.transfer_charge')).toBe(true);
  });
```

- [ ] **Step 2: Update `folio-payments.spec.ts`**

Replace all `trySplitChargePayment` (~673, ~766, ~788) with `trySplitFolioLine`.

**Rewrite Test 15** — survivor allows charge split (invert old expectation):

```typescript
  it('Test 15: charge line split via survivor succeeds (payment-only command retired)', async () => {
    // ... same setup as today ...
    const split = await stub.trySplitFolioLine(
      { kind: 'user', userId: actor },
      splitInput,
      {
        key: `idem-psplit-15-${crypto.randomUUID()}`,
        fingerprint: await fingerprintPayload(splitInput),
      },
    );
    expect(split).toMatchObject({ ok: true, folioLineIds: expect.any(Array) });
  });
```

**Add Test 15b** — captured PAYMENT line splits via survivor:

```typescript
  it('Test 15b: captured PAYMENT line splits via trySplitFolioLine', async () => {
    // provision + reservation + authorize + capture payment (reuse helpers from Test 1–14)
    const paymentLine = lines.find((l) => l.source === 'PAYMENT');
    expect(paymentLine).toBeDefined();
    const splitInput = {
      sourceFolioLineId: paymentLine!.folioLineId,
      splits: [
        { folioLineId: 'pay_a', amountMinor: Math.round(paymentLine!.amountMinor / 2) },
        { folioLineId: 'pay_b', amountMinor: paymentLine!.amountMinor - Math.round(paymentLine!.amountMinor / 2) },
      ],
    };
    const split = await stub.trySplitFolioLine(
      { kind: 'user', userId: actor },
      splitInput,
      { key: `idem-pay-split-${crypto.randomUUID()}`, fingerprint: await fingerprintPayload(splitInput) },
    );
    expect(split).toMatchObject({ ok: true });
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).find(
        (l) => l.folioLineId === `${paymentLine!.folioLineId}:split-rev`,
      ),
    ).toBeTruthy();
  });
```

- [ ] **Step 3: Update `folio-routes.spec.ts`**

Extend `postFolioSplit` helper body type to accept optional `folioWindowId`:

```typescript
  body: {
    splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
    idempotencyKey: string;
  },
```

**Add** retired-path 404 tests:

```typescript
  it('retired POST .../split-payment returns 404', async () => {
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/line_x/split-payment`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            splits: [{ folioLineId: 'a', amountMinor: 1 }],
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      ),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('retired POST .../split-v2 returns 404', async () => {
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/line_x/split-v2`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            splits: [{ folioLineId: 'a', amountMinor: 1 }],
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 4: Update `register.test.ts` pin targets**

In `night-audit HTTP routes` block (~717–742):

```typescript
    expect(V1_HTTP_ROUTE_AUDIT[24]).toMatchObject({
      id: 'post_folio_split',
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'folio.split_charge',
      entitlement: 'pms.core',
    });
    // ... shift all indexes ≥ 48 per Lock 5 ...
    expect(V1_HTTP_ROUTE_AUDIT[47]?.id).toBe('get_folio_payment');
    expect(V1_HTTP_ROUTE_AUDIT[48]?.id).toBe('get_folio_payments');
    expect(V1_HTTP_ROUTE_AUDIT[60]?.id).toBe('get_audit_log');
    expect(V1_HTTP_ROUTE_AUDIT[91]?.id).toBe('post_reservation_confirm');
    expect(V1_HTTP_ROUTE_AUDIT[94]?.id).toBe('post_folio_window');
    expect(V1_HTTP_ROUTE_AUDIT[97]?.id).toBe('post_folio_transfer');
    expect(V1_HTTP_ROUTE_AUDIT[98]?.id).toBe('post_folio_void');
    expect(V1_HTTP_ROUTE_AUDIT[101]?.id).toBe('post_folio_capture_due');
    expect(V1_HTTP_ROUTE_AUDIT[102]?.id).toBe('post_room_ooo_range');
    expect(V1_HTTP_ROUTE_AUDIT[138]?.id).toBe('post_invoice_void');
    expect(V1_HTTP_ROUTE_AUDIT[139]?.id).toBe('post_city_ledger_accounts');
    expect(V1_HTTP_ROUTE_AUDIT[143]?.id).toBe('get_city_ledger_statement');
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(63);
    expect(COMMAND_CATALOG).toHaveLength(90);
```

**Grep and update every** `V1_HTTP_ROUTE_AUDIT[` assertion with index ≥ 48 (except `[24]`): apply −1 for old 48–98, −2 for old 100–145. Representative lines to touch: ~342, ~363–377, ~437–579, ~626–739.

Payment routes test (~977–999):

```typescript
  it('payment commands are entitled and route audit 45–48 are payment routes', () => {
    for (const id of ['folio.authorize', 'folio.capture'] as const) {
      expect(COMMAND_CATALOG.find((c) => c.id === id)?.entitlement).toBe('pms.core');
      expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === id)).toBeUndefined();
    }
    expect(V1_HTTP_ROUTE_AUDIT[45]?.id).toBe('post_folio_authorize');
    expect(V1_HTTP_ROUTE_AUDIT[46]?.id).toBe('post_folio_capture');
    expect(V1_HTTP_ROUTE_AUDIT[47]?.id).toBe('get_folio_payment');
    expect(V1_HTTP_ROUTE_AUDIT[48]?.id).toBe('get_folio_payments');
  });
```

Degraded assertion (~752–754) — replace `folio.split_charge_payment` with survivor if needed:

```typescript
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.split_charge')?.degraded).toBe('FAIL_CLOSED');
```

Money-ops test (~1002–1040) — replace `folio.split_charge_v2` with `folio.split_charge`:

```typescript
      { id: 'folio.split_charge', permission: 'folio:adjust', events: ['folio.line_posted'] },
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|payment commands|folio money-ops|degraded classes"
pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 15|split"
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "split|retired"
```

Expected: **FAIL** — catalog still 92; `:v2-rev` still written; retired paths still 200/422; register length mismatch.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/test/folio-transfer-split.spec.ts \
  apps/pms-core/test/folio-payments.spec.ts \
  apps/pms-core/test/folio-routes.spec.ts \
  packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
test: pin split collapse expectations (TDD red)

EOF
)"
```

---

### Task 2: Contracts — catalog, audit writers, route audit

**Spec:** Locks 1–2, 5 (audit array), 8–9.

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts` (~298–319, ~463)
- Modify: `packages/contracts/src/commands/audit-writers.ts` (~18–19, ~34)
- Modify: `packages/contracts/src/v1-http-routes.ts` (~136–141, ~264–268, ~550–556)

**Interfaces:**
- Produces: catalog length **90**; writers **63**; route audit length **144**
- Produces: survivor notes updated; `[24]` has `entitlement: 'pms.core'`

**Forbidden this commit:** DO/HTTP/client/SPA implementation.

- [ ] **Step 1: Run register tests to confirm catalog/route failures**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|payment commands|folio money-ops"
```

Expected: **FAIL** on catalog length / route ids (tests from Task 1).

- [ ] **Step 2: Update survivor + delete retired catalog entries**

In `packages/contracts/src/commands/catalog.ts`, update survivor (~300):

```typescript
  {
    id: 'folio.split_charge',
    prototypeAction: 'SPLIT_FOLIO_CHARGE',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.line_posted'],
    notes:
      'Unified split — same-window and cross-window; charge and payment sources. Optional `folioWindowId` per slice.',
    entitlement: 'pms.core',
    permission: 'folio:adjust',
  },
```

Delete entire blocks for `folio.split_charge_payment` (~311–319) and `folio.split_charge_v2` (~463).

- [ ] **Step 3: Remove audit writer ids**

In `packages/contracts/src/commands/audit-writers.ts`:

```typescript
// DELETE these lines:
  'folio.split_charge_payment',
  'folio.split_charge_v2',
// KEEP:
  'folio.split_charge',
```

- [ ] **Step 4: Update route audit array**

In `packages/contracts/src/v1-http-routes.ts`:

**Add entitlement** to survivor `[24]`:

```typescript
  {
    id: 'post_folio_split',
    scope: 'property',
    permission: 'folio:adjust',
    commandId: 'folio.split_charge',
    entitlement: 'pms.core',
  },
```

**Delete** blocks for `post_folio_split_payment` (~264–268) and `post_folio_split_v2` (~550–556).

Verify array length **144**; last entry `get_city_ledger_statement`.

- [ ] **Step 5: Rebuild contracts + run register tests**

```bash
pnpm build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|payment commands|folio money-ops|degraded classes|PLATFORM_GAPS"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "PropertyDO source wires every AUDIT_WRITER"
```

Expected: register pins **PASS**; audit-writer grep test may still fail if DO references retired ids (fixed Task 3).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/v1-http-routes.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): collapse split catalog to survivor

EOF
)"
```

---

### Task 3: DO consolidation — merge `trySplitFolioLine`

**Spec:** Lock 3.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (~2550, ~14990–15077, ~15336–15417, ~18039–18110)

**Interfaces:**
- Produces: merged `trySplitFolioLine` with v2 signature + validation
- Produces: `reverseId: \`${source.folio_line_id}:split-rev\``
- Consumes: Task 2 catalog (survivor only)

**Forbidden this commit:** HTTP handlers, client, SPA, doc pointers.

- [ ] **Step 1: Run DO tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 15|split"
```

Expected: **FAIL** — still `:v2-rev` or `trySplitChargeV2` missing; PAYMENT rejected on v1 path.

- [ ] **Step 2: Merge `trySplitFolioLine`**

Replace `trySplitFolioLine` (~14990) with merged implementation (v2 validation + `:split-rev`):

```typescript
  async trySplitFolioLine(
    actor: ActorContext,
    input: {
      sourceFolioLineId: string;
      splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
    },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; folioLineIds: string[] }
    | { ok: false; error: typeof NOT_FOUND }
    | { ok: false; error: typeof SPLIT_AMOUNT_MISMATCH }
    | { ok: false; error: typeof LINE_NOT_SPLITTABLE }
    | { ok: false; error: typeof WINDOW_CLOSED }
    | { ok: false; error: typeof TRANSFER_CROSS_RESERVATION }
    | { ok: false; error: typeof FORBIDDEN | 'not_member' }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof IDEM_KEY_REUSED }
    | { ok: false; error: string }
  > {
    // ... gateCoreEntitlement + gatePermission unchanged ...
    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const source = /* load source row — same SELECT as today */;
          if (!source) return { ok: false as const, error: NOT_FOUND };
          if (
            source.source === 'SPLIT_REVERSAL' ||
            source.source === 'TAX' ||
            source.source === 'CHARGEBACK' ||
            source.charge_code === 'FX_GAIN' ||
            source.charge_code === 'FX_LOSS' ||
            source.charge_code === 'CHARGEBACK_FEE'
          ) {
            return { ok: false as const, error: LINE_NOT_SPLITTABLE };
          }
          const splitTotal = input.splits.reduce((sum, split) => sum + split.amountMinor, 0);
          if (splitTotal !== source.amount_minor) {
            return { ok: false as const, error: SPLIT_AMOUNT_MISMATCH };
          }
          const folioLineIds = this.splitFolioLineSync(source, input.splits, {
            reverseId: `${source.folio_line_id}:split-rev`,
          });
          this.appendAuditLogSync({
            actor: this.auditActorSync(actor),
            commandId: 'folio.split_charge',
            entityType: 'folio_line',
            entityId: input.sourceFolioLineId,
            beforeJson: { amountMinor: source.amount_minor },
            afterJson: { sourceFolioLineId: input.sourceFolioLineId, folioLineIds },
            reservationId: source.reservation_id,
          });
          return { ok: true as const, folioLineIds };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof WindowClosedError) return { ok: false, error: WINDOW_CLOSED };
      if (e instanceof FolioWindowError) return { ok: false, error: e.code };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
```

**Key merge rules:**
1. Drop v1-only `PAYMENT` reject (Lock 1 allows PAYMENT).
2. Use v2 throw/catch pattern for `WINDOW_CLOSED` / `TRANSFER_CROSS_RESERVATION` via `splitFolioLineSync`.
3. Always audit `commandId: 'folio.split_charge'`.

- [ ] **Step 3: Delete retired RPCs**

Remove entire methods:
- `trySplitChargeV2` (~15336–15417)
- `trySplitChargePayment` (~18039–18110)

Remove stale comment ~2550 referencing `'folio.split_charge_v2'` in audit-writer examples if present.

- [ ] **Step 4: Run DO test suite**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "Test 15|split"
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts -t "14:"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "PropertyDO source wires every AUDIT_WRITER"
```

Expected: **PASS**; degraded Test 14 unchanged (`folio.split_charge` + 503).

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): merge split RPC into trySplitFolioLine

EOF
)"
```

---

### Task 4: HTTP + routes — survivor handler + delete retired paths

**Spec:** Locks 4–5.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (~5554–5600, ~5757+, ~6231+, ~7341, ~7523, ~7942)

**Interfaces:**
- Produces: extended `handlePostFolioSplit` body with optional `folioWindowId`
- Produces: `V1_ROUTES.length === V1_HTTP_ROUTE_AUDIT.length === 144`
- Consumes: Task 2 route audit + Task 3 DO RPC

**Forbidden this commit:** Client, SPA, doc pointers.

- [ ] **Step 1: Run route tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "split|retired"
pnpm check:permissions
pnpm check:degraded
```

Expected: **FAIL** — retired paths not 404; `check:permissions` / `check:degraded` route count drift.

- [ ] **Step 2: Extend survivor handler**

In `handlePostFolioSplit` (~5559):

```typescript
  const body = (await ctx.request.json()) as {
    splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
    idempotencyKey: string;
  };
```

No other survivor handler changes — still invokes `trySplitFolioLine`.

- [ ] **Step 3: Delete retired handlers and V1_ROUTES entries**

Delete functions:
- `handlePostFolioSplitV2` (~5757+)
- `handlePostFolioSplitPayment` (~6231+)

Delete from `V1_ROUTES`:
- `split-payment` pattern (~7523)
- `split-v2` pattern (~7942)

Ensure `V1_ROUTES` count matches `V1_HTTP_ROUTE_AUDIT` (**144**). Grep `post_folio_split_payment|post_folio_split_v2|split-payment|split-v2` — zero hits in dispatch.

- [ ] **Step 4: Run HTTP tests + guard scripts**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "Test 6|Test 7|Test 10|retired"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: survivor `/split` **PASS**; retired paths **404**; guard scripts **PASS** at 144 routes.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): collapse split HTTP to survivor route

EOF
)"
```

---

### Task 5: Client + SPA — one `splitFolioLine`

**Spec:** Locks 6–7, Lock 10 client/SPA tests.

**Files:**
- Modify: `packages/client-core/src/api.ts` (~817–850, ~1006–1021)
- Modify: `packages/client-core/test/api-folio.test.ts` (~86–108)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~612, ~633)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` (~17–81, ~829–850)

**Interfaces:**
- Produces: one `splitFolioLine` with v2 body shape → `/split`
- Produces: SPA charge + payment mutations both call survivor

**Forbidden this commit:** doc pointers, ticking Task 6 boxes.

- [ ] **Step 1: Write failing client + SPA tests**

In `api-folio.test.ts`, replace `splitFolioLineV2` test:

```typescript
  it('splitFolioLine posts /split with optional folioWindowId', async () => {
    let seen = '';
    let body = '';
    const { client } = clientWith(async (path, init) => {
      seen = path;
      body = typeof init?.body === 'string' ? init.body : '';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await client.splitFolioLine(
      'p',
      'line_1',
      {
        splits: [
          { folioLineId: 'a', amountMinor: 60, folioWindowId: 'res_1:COMPANY' },
          { folioLineId: 'b', amountMinor: 40 },
        ],
      },
      'op-split',
    );
    expect(seen).toBe('/v1/properties/p/folio/lines/line_1/split');
    expect(JSON.parse(body).splits[0].folioWindowId).toBe('res_1:COMPANY');
    expect(JSON.parse(body).idempotencyKey).toBeTruthy();
  });
```

In `FolioScreen.test.tsx`:
- Remove `splitFolioLineV2` mock; use `splitFolioLine` mock for cross-window charge split test (~829–850).
- Add payment split test asserting `splitFolioLine` called from `data-testid="split-payment"` if not already covered.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts -t "splitFolio"
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "split"
```

Expected: **FAIL** — still hits `/split-v2` or `splitFolioLineV2` mock.

- [ ] **Step 3: Update client API**

Extend survivor method; delete retired methods:

```typescript
    async splitFolioLine(
      propertyId: string,
      sourceFolioLineId: string,
      input: {
        splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/lines/${enc(sourceFolioLineId)}/split`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ splits: input.splits, idempotencyKey }),
        },
      );
    },
```

Delete `splitFolioLineV2` (~833–850) and `splitFolioPayment` (~1006–1021).

- [ ] **Step 4: Update FolioScreen mutations**

```typescript
    mutationFn: () => {
      if (!canSplit) throw new Error('policy_blocked_split');
      const opId = `split:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioLine(propertyId, splitLineId, splitPayload(), opId);
    },
```

```typescript
    mutationFn: () => {
      if (!canSplit) throw new Error('policy_blocked_split');
      const opId = `splitpay:${reservationId}:${splitLineId}:${crypto.randomUUID()}`;
      return api.splitFolioLine(propertyId, splitLineId, splitPayload(), opId);
    },
```

- [ ] **Step 5: Rebuild + run client/SPA tests**

```bash
pnpm build
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts -t "splitFolio"
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "split"
```

Expected: **PASS**.

- [ ] **Step 6: Commit**

```bash
git add packages/client-core/src/api.ts \
  packages/client-core/test/api-folio.test.ts \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(client): collapse split API to splitFolioLine

EOF
)"
```

---

### Task 6: Pointers + final verification

**Spec:** §8 checklist, folio-money §19 pointer, D6/D7.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` (~786)
- Modify: `.superpowers/sdd/progress-phase1-leftovers.md` (~42, ~52)
- Modify: `docs/superpowers/specs/2026-08-15-split-command-collapse-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-split-command-collapse.md` — Task 6 checkboxes only

**Pointer sentence (normative — one sentence):**

`docs/superpowers/specs/2026-08-12-folio-money-operations-design.md` §19 item **2** (~786):

> ~~2. **Collapse `split_charge` / `split_charge_payment` / `split_charge_v2`** into one command once SPA speaks v2 only.~~ **Closed** in [2026-08-15 split command collapse](./2026-08-15-split-command-collapse-design.md): survivor `folio.split_charge` + `post_folio_split` + `splitFolioLine`; retired payment/v2 commands and HTTP paths.

`.superpowers/sdd/progress-phase1-leftovers.md` item **12** (~42):

> **12. Collapse split commands** — DONE `…` (spec `…`, plan `…`; catalog 90, routes 144, SPA → `splitFolioLine`).

- [x] **Step 1: Pin frozen heads**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|payment commands|folio money-ops|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **90**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 33`; `PLATFORM_GAPS === []`.

- [x] **Step 2: Targeted test superset (Lock 10 full slice)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/folio-transfer-split.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts -t "split|Test 15"
pnpm --filter @hospai/pms-core exec vitest run test/folio-routes.spec.ts -t "split|retired|Test 12"
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts -t "14:"
pnpm --filter @hospai/client-core exec vitest run test/api-folio.test.ts -t "splitFolio"
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "split"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: **PASS**; route count **144**.

- [x] **Step 3: Full CI sequence**

```bash
pnpm build
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

If any shard fails with workerd 503, retry that shard once. Do not `|| true`.

- [x] **Step 4: Apply doc pointers + tick split spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-split-command-collapse-design.md` §8.

- [x] **Step 5: Tick Task 6 checkboxes in this plan only**

Do **not** tick Tasks 1–5 checkboxes.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-12-folio-money-operations-design.md \
  .superpowers/sdd/progress-phase1-leftovers.md \
  docs/superpowers/specs/2026-08-15-split-command-collapse-design.md \
  docs/superpowers/plans/2026-08-15-split-command-collapse.md
git commit -m "$(cat <<'EOF'
docs: close split command collapse leftovers

EOF
)"
```

**Stop.** `reservations.update_extras` retirement stays item **13**. No schema migration. No new events or permissions.

---

## Spec §8 reviewer checklist (Task 6 ticks these in the spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Delete 2 catalog entries; update survivor notes | 2 |
| `AUDIT_WRITER_COMMAND_IDS` **63** | 2 |
| Merge `trySplitFolioLine`; delete 2 RPCs; `:split-rev` | 3 |
| Extend survivor handler; delete payment/v2 handlers; sync routes **144** | 4 |
| Re-pin register; catalog **90**; `[143] get_city_ledger_statement` | 1, 2 |
| Client one method; SPA both mutations; test updates | 5 |
| `check:permissions` + `check:degraded` route count **144** | 4, 6 |
| CI file-filter vitest; no DO isolate spy | 1–6 |
| Folio-money §19 pointer | 6 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.3 scope in (1–10) | 1–6 |
| §1.4 scope out | forbidden all |
| §2 Locks 1–10 | 1–6 |
| §6 file map | 1–6 |
| §8 checklist + pointers | 6 |
| Heads table §1.2 | 2 + 6 verify |
| D-locks 1–7 | Open decisions |

**Gaps:** None — spec scope fully mapped.

**Placeholder scan:** No TBD-only references.

**Tree conflicts:** None (spec §9). Verified on `main` post-`0282a5a`: catalog **92**, writers **65**, route tail `[145] get_city_ledger_statement`, `trySplitFolioLine` ~14990, `trySplitChargeV2` ~15336, `trySplitChargePayment` ~18039, client triple methods, SPA uses v2 + payment routes, `PROPERTY_SCHEMA_HEAD` **33**.

**Implementer notes (from spec §9, not lock violations):**

1. **Route re-pin is wide** — grep `V1_HTTP_ROUTE_AUDIT[` in `register.test.ts`; every index ≥ 48 except `[24]` may shift.
2. **Historical ledger ids** — do not rewrite `:v2-rev` or `:rev:uuid` rows.
3. **Test 15 rewrite** — old test encoded payment-command reject on charge line; survivor allows it.
4. **Entitlement on `[24]`** — add in `v1-http-routes.ts` and assert in register Task 1/2.
5. **Same commit for audit + V1_ROUTES** — `permissions-check.mjs` / `degraded-check.mjs` compare lengths.
