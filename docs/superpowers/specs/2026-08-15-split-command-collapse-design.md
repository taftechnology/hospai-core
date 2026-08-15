# Split command collapse

**Tree verified 2026-08-15 (post city ledger close `0282a5a`):** `COMMAND_CATALOG` length **92** (`register.test.ts` ~742), `AUDIT_WRITER_COMMAND_IDS.size === 65` (`register.test.ts` ~269 and ~741; `audit-writers.ts` lists `folio.split_charge`, `folio.split_charge_payment`, `folio.split_charge_v2`), `V1_HTTP_ROUTE_AUDIT[145].id === 'get_city_ledger_statement'` (`register.test.ts` ~739; `v1-http-routes.ts` tail), split routes at `[24] post_folio_split`, `[47] post_folio_split_payment`, `[99] post_folio_split_v2`, DO `trySplitFolioLine` ~14990 / `trySplitChargeV2` ~15336 / `trySplitChargePayment` ~18039 / shared `splitFolioLineSync` ~14368, client `splitFolioLine` ~817 / `splitFolioLineV2` ~833 / `splitFolioPayment` ~1006, SPA `FolioScreen.tsx` calls `splitFolioLineV2` + `splitFolioPayment`, `PROPERTY_SCHEMA_HEAD === 33` / `ORG_SCHEMA_HEAD === 7`, `NIGHT_AUDIT_STEPS` length **8**, `PLATFORM_GAPS === []`.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §5 (original split design; §19 leftover **2** — collapse to one command); ARCHITECTURE.md §7.3 (append-only split = reversal + N); `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `packages/client-core/src/api.ts`; `apps/web-pms/src/screens/FolioScreen.tsx`.

**Closes:** Phase 1 leftover **12** / folio-money §19 leftover **2** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~42–43, ~52): collapse `folio.split_charge` / `folio.split_charge_payment` / `folio.split_charge_v2` into one survivor command + one HTTP route + one client method.

**Amends:** [folio money operations](./2026-08-12-folio-money-operations-design.md) §5.1 (three-command table superseded by this spec). One-sentence bidirectional pointer in folio-money §19 when this chunk lands is the **final implementation task**, not this spec writer’s job.

---

## Executive summary

Retire **`folio.split_charge_payment`** and **`folio.split_charge_v2`**. **`folio.split_charge`** is the sole survivor: it keeps `prototypeAction: 'SPLIT_FOLIO_CHARGE'`, absorbs v2 cross-window semantics and payment-line splits, and remains the only catalog id wired to **`post_folio_split`**. Delete the payment and v2 HTTP routes/handlers/DO RPCs; extend the survivor’s request body with optional `folioWindowId` per slice. Client exposes one method **`splitFolioLine`**; SPA keeps charge vs payment split UX affordances but both call the survivor. Catalog **92 → 90**; audit writers **65 → 63**; route audit **146 → 144** entries with index re-pin (first route removal in this repo — no deprecation field on `V1HttpRouteAudit`). Deterministic reverse line id **`${sourceFolioLineId}:split-rev`**. No schema migration, no new events or permissions.

---

## 1. Context & motivation

### 1.1 Problem statement

Folio split shipped as three catalog commands because [folio money operations](./2026-08-12-folio-money-operations-design.md) deferred collapse:

| Command | Role today (verified) |
|---|---|
| `folio.split_charge` | Same-window charge splits; rejects `PAYMENT`; HTTP `POST …/split` (`[24]`); DO `trySplitFolioLine` |
| `folio.split_charge_payment` | Same-window payment splits; requires `source = 'PAYMENT'`; HTTP `POST …/split-payment` (`[47]`); DO `trySplitChargePayment` |
| `folio.split_charge_v2` | Cross-window slices via optional `folioWindowId`; allows `PAYMENT`; HTTP `POST …/split-v2` (`[99]`); DO `trySplitChargeV2`; deterministic reverse `${id}:v2-rev` |

All three wrap the same **`splitFolioLineSync`** helper (~14368). The SPA already uses v2 for charge splits and the payment route for payment splits — the v1-only and payment-only commands are catalog/HTTP debt.

### 1.2 What already exists (do not re-spec)

| Piece | Where |
|---|---|
| Shared sync helper | `splitFolioLineSync` — reverse in source, N children, tax via `allocate(..., { policy: 'LAST' })` with absolute weights |
| Cross-window child rules | Dest window OPEN, same reservation, child `source = 'TRANSFER'` when dest ≠ source |
| Transfer command | `folio.transfer_charge` — **unchanged** this chunk |
| Idempotency | All three use `runIdempotent`; v1/payment used random reverse ids (`:rev:${uuid}`); v2 used `:v2-rev` |
| `REPLAY_DISPATCH` | **No** entries for any split command (all `FAIL_CLOSED`) |
| Event consumer | Shape allowlist only — no split command id references |

**Heads (frozen — this chunk moves catalog, writers, routes only):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **92** | **90** — remove `folio.split_charge_payment`, `folio.split_charge_v2` |
| `AUDIT_WRITER_COMMAND_IDS.size` | **65** | **63** — remove the two retiring ids (`folio.split_charge` stays) |
| `V1_HTTP_ROUTE_AUDIT` | length **146**; `[145] = get_city_ledger_statement` | length **144** — remove `[47] post_folio_split_payment`, `[99] post_folio_split_v2`; re-pin indexes ≥ 48 |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.3 Scope in

1. **Survivor catalog entry** — extend semantics; update notes (Lock 1).
2. **Retire two catalog entries** — delete `folio.split_charge_payment`, `folio.split_charge_v2` (Lock 2).
3. **DO consolidation** — merge into `trySplitFolioLine`; delete `trySplitChargeV2`, `trySplitChargePayment` (Lock 3).
4. **HTTP** — extend `handlePostFolioSplit` body; delete v2/payment handlers and `V1_ROUTES` entries (Lock 4).
5. **Route audit removal + re-pin** — physical delete of two audit rows (Lock 5).
6. **Client** — one `splitFolioLine`; delete `splitFolioLineV2`, `splitFolioPayment` (Lock 6).
7. **SPA** — both split mutations call `splitFolioLine` (Lock 7).
8. **Audit writers** — remove two ids (Lock 8).
9. **Register / invariant test updates** (Lock 9).
10. **Tests** — folio-transfer-split, folio-payments, folio-routes, degraded-mode, client, FolioScreen (Lock 10).

### 1.4 Scope out (normative)

- Schema migration (`PROPERTY_SCHEMA_HEAD` stays **33**)
- New events, wire codes, permissions, entitlements
- Changes to `folio.transfer_charge` semantics
- Retire `reservations.update_extras` (separate queue item **13**)
- SPA split UX redesign — charge vs payment affordances stay; only API calls collapse
- `REPLAY_DISPATCH` changes (no split commands there today)
- Bidirectional folio-money §19 pointer sentence (final implementation task)
- HTTP deprecation shims on removed paths (`404` is correct — clients must migrate)

---

## 2. Locked decisions (verbatim — do not deviate)

1. **Survivor: `folio.split_charge`.** Keeps `prototypeAction: 'SPLIT_FOLIO_CHARGE'`, lane `INTERACTIVE`, `degraded: 'FAIL_CLOSED'`, `idempotent: true`, events `['folio.line_posted']`, `entitlement: 'pms.core'`, `permission: 'folio:adjust'`.
2. **Survivor gains v2 semantics.** Each split slice may name optional `folioWindowId` (omit = source window). Cross-window slices follow existing transfer rules (dest `OPEN`, same reservation, child `source = 'TRANSFER'` when dest differs, tax allocated with absolute weights via `allocate(..., { policy: 'LAST' })`). **PAYMENT** source lines are allowed (absorbs `split_charge_payment`). Reject **`SPLIT_REVERSAL`** / **`TAX`** sources (unchanged). Also reject **`CHARGEBACK`**, **`FX_GAIN`**, **`FX_LOSS`**, **`CHARGEBACK_FEE`** charge codes (existing v1 guard — unchanged). All involved windows must be `OPEN` else `WINDOW_CLOSED`.
3. **Retire `folio.split_charge_payment` and `folio.split_charge_v2`.** Remove from `COMMAND_CATALOG`, `AUDIT_WRITER_COMMAND_IDS`, DO RPC methods, HTTP routes/handlers, and client methods.
4. **One client API method** — `splitFolioLine` hits survivor route `POST …/split`; delete `splitFolioLineV2` / `splitFolioPayment`. SPA `FolioScreen.tsx` collapses `split` and `splitPayment` mutations into one client path; payment split keeps its UX button (`data-testid="split-payment"`) but calls the same command.
5. **Deterministic reverse id: `${sourceFolioLineId}:split-rev`.** Justification: (a) PK backstop under retry without relying on random UUID; (b) distinct from historical v1 rows (`:rev:${uuid}`) and v2 rows (`:v2-rev`) already in append-only ledger — no migration; (c) `:split-rev` is survivor-native, not “v2” debt. **Cached idempotency replays are unaffected:** `runIdempotent` returns stored `{ folioLineIds }` without re-running `splitFolioLineSync`, so old cached v1 responses that reference UUID reverse ids remain valid replay payloads.
6. **Route audit: physical removal, not deprecation.** `V1HttpRouteAudit` has no deprecation marker (`v1-http-routes.ts` ~7–16). Remove the two retiring route rows and **re-pin every** `register.test.ts` index that shifts (Lock 5 table). `scripts/permissions-check.mjs` and `scripts/degraded-check.mjs` require `V1_ROUTES.length === V1_HTTP_ROUTE_AUDIT.length` — delete from **both** arrays in the same commit.
7. **Survivor HTTP path unchanged:** `POST /v1/properties/:propertyId/folio/lines/:sourceFolioLineId/split` (`post_folio_split`, audit index `[24]` — stable). Body gains optional `folioWindowId` per slice only.
8. **Fingerprint (idempotency):** `{ sourceFolioLineId, splits: [{ folioLineId, amountMinor, folioWindowId? }] }` — v2 shape, superset of v1.

---

## 3. Behaviour (normative locks)

### Lock 1 — Survivor catalog entry (`folio.split_charge`)

Update `catalog.ts` entry (~300):

| Field | Value |
|---|---|
| `id` | `folio.split_charge` |
| `prototypeAction` | `'SPLIT_FOLIO_CHARGE'` (**only** catalog row — `PROTOTYPE_ACTIONS` coverage unchanged) |
| `lane` | `INTERACTIVE` |
| `degraded` | `FAIL_CLOSED` |
| `idempotent` | `true` |
| `events` | `['folio.line_posted']` |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `notes` | Replace payment/v2 pointer text with: *Unified split — same-window and cross-window; charge and payment sources. Optional `folioWindowId` per slice.* |

Delete catalog blocks for `folio.split_charge_payment` (~311) and `folio.split_charge_v2` (~463).

**Source-line validation (merged):**

| Condition | Wire code |
|---|---|
| Source missing | `not_found` |
| `source ∈ { SPLIT_REVERSAL, TAX }` | `line_not_splittable` |
| `source = CHARGEBACK` or `charge_code ∈ { FX_GAIN, FX_LOSS, CHARGEBACK_FEE }` | `line_not_splittable` |
| `sum(splits.amountMinor) !== source.amount_minor` (signed) | `split_amount_mismatch` |
| Any involved window not `OPEN` | `window_closed` |
| Cross-window dest on different reservation | `transfer_cross_reservation` |

**Allowed:** `source = 'PAYMENT'` (negative amounts); same-window payment children keep `source = 'PAYMENT'`; cross-window payment children use `source = 'TRANSFER'` per existing helper rule.

**Child insertion:** unchanged `splitFolioLineSync` behaviour; pass `reverseId: \`${source.folio_line_id}:split-rev\``.

### Lock 2 — Retired catalog entries

Remove entirely (no `PLATFORM_GAPS` entries — gaps array stays `[]`):

- `folio.split_charge_payment`
- `folio.split_charge_v2`

### Lock 3 — DO method consolidation

**Keep:** `trySplitFolioLine` — merged public RPC.

**Delete:** `trySplitChargeV2`, `trySplitChargePayment`.

**Merged signature:**

```ts
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
>
```

**Implementation merge rules:**

1. Source reject union = Lock 1 table (drop v1-only `PAYMENT` reject; drop v2-only narrow reject).
2. Call `splitFolioLineSync(source, input.splits, { reverseId: \`${source.folio_line_id}:split-rev\` })`.
3. Audit row always `commandId: 'folio.split_charge'`.
4. Private helper `splitFolioLineSync` — **no signature change** (already accepts optional `folioWindowId`).

Remove stale comment block ~2550 listing `'folio.split_charge_v2'` as audit-writer examples if present.

### Lock 4 — HTTP survivor route

**Keep** `handlePostFolioSplit` + `V1_ROUTES` entry:

| Audit id | Method | Path | Permission | commandId |
|---|---|---|---|---|
| `[24] post_folio_split` | POST | `/v1/properties/:propertyId/folio/lines/:sourceFolioLineId/split` | `folio:adjust` | `folio.split_charge` |

**Extend request body:**

```ts
{
  splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
  idempotencyKey: string;
}
```

**Response:** unchanged `{ ok: true, folioLineIds: string[] }`.

**Add** to route audit row `[24]`: `entitlement: 'pms.core'` (align with catalog and retired v2 route — v1 audit row lacked it).

**Delete handlers and routes:**

| Retiring audit id | Path | Handler |
|---|---|---|
| `[47] post_folio_split_payment` | `…/split-payment` | `handlePostFolioSplitPayment` |
| `[99] post_folio_split_v2` | `…/split-v2` | `handlePostFolioSplitV2` |

Removed paths return **404** (no stub).

### Lock 5 — Route audit removal & re-pin

**Mechanism (locked):** Physical removal from `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`. No deprecation field exists on `V1HttpRouteAudit`. Folio-money “append-only” meant **do not insert before pinned indexes when adding** — first removal chunk re-pins downstream indexes.

**Delete rows:** `post_folio_split_payment`, `post_folio_split_v2`.

**New length:** **144**. **Last index:** `[143] get_city_ledger_statement`.

**Index shift table** (old → new for pinned routes):

| Old index | Route id | New index |
|---|---|---|
| `[24]` | `post_folio_split` | `[24]` *(unchanged)* |
| `[47]` | `post_folio_split_payment` | *(removed)* |
| `[48]` | `get_folio_payment` | `[47]` |
| `[49]` | `get_folio_payments` | `[48]` |
| `[61]`–`[98]` | *(each)* | **−1** |
| `[99]` | `post_folio_split_v2` | *(removed)* |
| `[100]`–`[145]` | *(each)* | **−2** |

**Representative post-land pins** (implementer must update **all** `V1_HTTP_ROUTE_AUDIT[n]` assertions in `register.test.ts` that shift):

| New index | Route id |
|---|---|
| `[60]` | `get_audit_log` |
| `[91]` | `post_reservation_confirm` |
| `[94]` | `post_folio_window` |
| `[97]` | `post_folio_transfer` |
| `[98]` | `post_folio_void` |
| `[101]` | `post_folio_capture_due` |
| `[102]` | `post_room_ooo_range` |
| `[138]` | `post_invoice_void` |
| `[139]` | `post_city_ledger_accounts` |
| `[143]` | `get_city_ledger_statement` |

**Payment-route test** (`register.test.ts` ~977–999): after land, `[45] post_folio_authorize`, `[46] post_folio_capture`, `[47] get_folio_payment`, `[48] get_folio_payments` — remove `folio.split_charge_payment` from entitled-command loop and delete `[47] = post_folio_split_payment` assertion.

### Lock 6 — Client API

**Keep and extend** `splitFolioLine` in `packages/client-core/src/api.ts`:

```ts
async splitFolioLine(
  propertyId: string,
  sourceFolioLineId: string,
  input: {
    splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
  },
  opId: string,
): Promise<...>
```

- URL: `/v1/properties/${propertyId}/folio/lines/${sourceFolioLineId}/split` (unchanged).
- **Delete:** `splitFolioLineV2`, `splitFolioPayment`.

### Lock 7 — SPA (`FolioScreen.tsx`)

- Charge split mutation (~612): `api.splitFolioLine(...)` with `splitPayload()` (may include `folioWindowId` when dest picker set).
- Payment split mutation (~633): same — `api.splitFolioLine(...)`.
- Keep separate buttons/modals and `data-testid="split-payment"` — UX unchanged.
- `FolioScreen.test.tsx`: mock `splitFolioLine` only; remove `splitFolioLineV2` mock.

### Lock 8 — Audit writers

Remove from `AUDIT_WRITER_COMMAND_IDS` (`audit-writers.ts`):

- `folio.split_charge_payment` (~19)
- `folio.split_charge_v2` (~34)

**Keep:** `folio.split_charge` (~18).

**New size:** **63**. No new exemptions.

`register.test.ts` `PropertyDO source wires every AUDIT_WRITER_COMMAND_IDS literal` (~328) must stay green — retiring ids must not appear as `commandId:` literals in `property-do.ts` after delete.

### Lock 9 — Register / invariant updates

| Location | Change |
|---|---|
| `register.test.ts` ~742 | `COMMAND_CATALOG.toHaveLength(90)` |
| `register.test.ts` ~741, ~269 | `AUDIT_WRITER_COMMAND_IDS.size === 63` |
| `register.test.ts` ~752–754 | Remove `folio.split_charge_payment` degraded assertion — replace with `folio.split_charge` if needed |
| `register.test.ts` ~977–999 | Payment routes test — Lock 5 |
| `register.test.ts` ~1002–1040 | `folio money-ops commands` rows: remove `folio.split_charge_v2`; **add** `folio.split_charge` with `events: ['folio.line_posted']` |
| `register.test.ts` ~1091 | Keep `PLATFORM_GAPS` not containing `folio.split_charge_v2` — drop `COMMAND_CATALOG.some(… split_charge_v2)` assertion in folio-transfer-split instead |
| `register.test.ts` | Re-pin all shifted `V1_HTTP_ROUTE_AUDIT[n]` (Lock 5 table + grep `[6-9][0-9]` and `[1][0-4][0-9]`) |
| `subpath-exports.test.ts` ~23 | `toBeGreaterThanOrEqual(68)` stays valid (144 ≥ 68) |
| `scripts/permissions-check.mjs` / `degraded-check.mjs` | Route count **144** after sync |

**Prototype coverage test** (~175): unchanged — `SPLIT_FOLIO_CHARGE` still covered by exactly one command (`folio.split_charge`).

### Lock 10 — Tests (normative — TDD: failing tests first)

**`apps/pms-core/test/folio-transfer-split.spec.ts`**

| # | Update |
|---|---|
| 20 | Keep `trySplitFolioLine`; assert reverse id `${sourceId}:split-rev` |
| 21–24 | Replace `trySplitChargeV2` → `trySplitFolioLine`; assert `:split-rev` not `:v2-rev` |
| 25 | Remove `COMMAND_CATALOG.some(… split_charge_v2)`; keep transfer gap assertions |

**Add:** payment cross-window split via `trySplitFolioLine` on captured PAYMENT line (optional — or cover in folio-payments).

**`apps/pms-core/test/folio-payments.spec.ts`**

- Tests calling `trySplitChargePayment` (~673, ~766, ~788): switch to `trySplitFolioLine`.
- Test 15 (charge line via payment split path): now uses survivor — expect same `line_not_splittable` when attempting payment-only validation is gone; **charge line split via survivor succeeds** — **rewrite Test 15** to assert charge split succeeds on survivor, and add **new test** that non-PAYMENT line split succeeds while PAYMENT line also succeeds (formerly payment-command-only).

**`apps/pms-core/test/folio-routes.spec.ts`**

- Tests 6–7, 10, 12: unchanged route (`/split`); extend Test 6 body with optional `folioWindowId` slice when testing cross-window via HTTP.
- **Add:** `POST …/split-payment` and `…/split-v2` return **404**.

**`apps/pms-core/test/degraded-mode.spec.ts`**

- Test 14 (~625): **unchanged** — still `folio.split_charge` + `post_folio_split` + 503 FAIL_CLOSED.

**`packages/client-core/test/api-folio.test.ts`**

- Replace `splitFolioLineV2` test with `splitFolioLine` posting to `/split` with `folioWindowId` in body.

**`apps/web-pms/src/screens/FolioScreen.test.tsx`**

- Mock/call `splitFolioLine` instead of `splitFolioLineV2`.

---

## 4. Error taxonomy

**Unchanged wire codes** (no new exports):

| Wire code | HTTP | When |
|---|---|---|
| `not_found` | 404 | Source line or window missing |
| `line_not_splittable` | 422 | SPLIT_REVERSAL / TAX / CHARGEBACK / FX_* source |
| `split_amount_mismatch` | 422 | Slice sum ≠ source amount (signed) |
| `window_closed` | 422 | Source or any dest window CLOSED |
| `transfer_cross_reservation` | 422 | Dest window different reservation |
| `forbidden` | 403 | Missing `folio:adjust` |
| `idempotency_key_reused` | 409 | Fingerprint conflict |

Degraded transport: **503** `FAIL_CLOSED` with `commandId: 'folio.split_charge'` (degraded-mode Test 14 shape).

---

## 5. Rollback / migration notes

| Scenario | Action |
|---|---|
| Deploy forward | Old HTTP clients hitting `/split-payment` or `/split-v2` get **404** — intentional; SPA ships with client collapse |
| Idempotency cache | Rows keyed by client idempotency key + fingerprint — survivor uses v2 fingerprint shape; old v2 keys replay cached responses if fingerprint matches |
| Ledger rows | Historical `:rev:${uuid}` and `:v2-rev` lines remain; new splits write `:split-rev` |
| Roll back code | Restores three commands/routes — do not roll back without coordinated client revert |
| Audit log | Historical rows may reference retired `commandId` strings — append-only, no rewrite |

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Delete 2 entries; update survivor notes |
| `packages/contracts/src/commands/audit-writers.ts` | Remove 2 ids |
| `packages/contracts/src/v1-http-routes.ts` | Remove 2 audit rows; add `entitlement` on `[24]` |
| `packages/contracts/src/register.test.ts` | Catalog 90, writers 63, route re-pins, payment/money-ops test updates |
| `apps/pms-core/src/property-do.ts` | Merge `trySplitFolioLine`; delete 2 RPCs; `:split-rev` |
| `apps/pms-core/src/v1-dispatch.ts` | Extend survivor handler body; delete 2 handlers + 2 `V1_ROUTES` blocks |
| `packages/client-core/src/api.ts` | Extend `splitFolioLine`; delete 2 methods |
| `packages/client-core/test/api-folio.test.ts` | Client test update |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Both mutations → `splitFolioLine` |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Mock update |
| `apps/pms-core/test/folio-transfer-split.spec.ts` | RPC + reverse id updates |
| `apps/pms-core/test/folio-payments.spec.ts` | RPC renames + Test 15 rewrite |
| `apps/pms-core/test/folio-routes.spec.ts` | 404 tests for retired paths |

**Not touched:** `property-migrations.ts`, `event-consumer.ts`, `replay-dispatch.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `ARCHITECTURE.md`, `reservations.update_extras`.

---

## 7. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Three split catalog commands for one helper | Single `folio.split_charge` |
| 2 | SPA calls v2 + payment routes | Both → `splitFolioLine` / `post_folio_split` |
| 3 | v1 survivor rejects PAYMENT | Survivor allows PAYMENT (Lock 1) |
| 4 | Duplicate DO RPC surface | One `trySplitFolioLine` |
| 5 | folio-money §19 leftover **2** | This spec |
| 6 | Phase 1 progress item **12** | This spec |

**Still open (explicit):**

| Item | Owner |
|---|---|
| Retire `reservations.update_extras` | Progress item **13** |
| folio-money §19 pointer sentence | Final implementation task |

---

## 8. Implementation checklist

- [x] Delete `folio.split_charge_payment` + `folio.split_charge_v2` from catalog; update survivor notes
- [x] `AUDIT_WRITER_COMMAND_IDS` **63**; remove 2 ids
- [x] Merge `trySplitFolioLine`; delete `trySplitChargeV2` + `trySplitChargePayment`; reverse id `:split-rev`
- [x] Extend `handlePostFolioSplit`; delete payment/v2 handlers; sync `V1_ROUTES` + audit (**144** rows)
- [x] Re-pin all shifted `register.test.ts` route indexes; catalog **90**; writers **63**; `[143] get_city_ledger_statement`
- [x] Client: one `splitFolioLine`; SPA both mutations; test updates (Lock 10)
- [x] `check:permissions` + `check:degraded` route count **144**
- [x] CI: file-filter vitest; no `vi.spyOn` into DO isolate

---

## 9. Tree conflicts with reviewer locks

**None on heads.** Verified post-`0282a5a`: catalog **92**, writers **65**, route tail `[145] get_city_ledger_statement`, schema **33**, steps **8**, `PLATFORM_GAPS === []`.

**Notes for implementer (not lock violations):**

1. **Route re-pin is wide** — grep `V1_HTTP_ROUTE_AUDIT[` in `register.test.ts`; every index ≥ 48 except `[24]` may shift.
2. **Historical ledger ids** — do not rewrite `:v2-rev` or `:rev:uuid` rows; only new writes use `:split-rev`.
3. **Test 15 rewrite** — old test encoded payment-command reject on charge line; survivor allows it — invert expectation.
4. **Entitlement on `[24]`** — add `entitlement: 'pms.core'` to audit row for parity with FAIL_CLOSED folio routes.
