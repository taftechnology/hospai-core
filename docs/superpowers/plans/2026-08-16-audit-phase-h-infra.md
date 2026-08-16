# Audit Phase H — test, deployment, and documentation infrastructure (H1–H4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-16)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit Phase **H** items **H1**–**H4** — CI `wrangler deploy --dry-run`, `env.staging` config scaffold (no live deploy), jurisdiction-success test verification/strengthening, `@vitest/coverage-v8` on non-pms-core packages (no threshold), expanded sold-ledger property tests (24 seeds + richer op mix + virtual-type second file), and ARCHITECTURE/README documentation reconciliation. **No frozen head counts move.**

**Architecture:** Three parallel-safe batches (**H4 ∥ H1 ∥ H2**) touch disjoint file sets; **H3** lands last (pms-core tests + CI ledger-prop job). H1 live Cloudflare deploy is **explicitly out of scope** — staging block is config scaffolding only.

**Tech Stack:** GitHub Actions (`.github/workflows/ci.yml`), Wrangler (`apps/pms-core/wrangler.jsonc`), vitest + `@vitest/coverage-v8`, `vitest-pool-workers` property tests, root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-16-audit-phase-h-infra-design.md` (Locks 1–7 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `idempotency.ts` `export const` count | **158** | **158** — unchanged |

Tree verified 2026-08-16. Phases **A** through **G** must be landed. **No DDL** this phase — `pnpm check:ddl` is confirm-only in final verify.

---

## Sequencing gate (read before starting)

| Batch | Items | Parallel-safe? | Rationale |
|---|---|---|---|
| **1** | H4 (Lock 7) | **Yes** — docs only | Zero code files |
| **1** | H1 (Locks 1–3) | **Yes** — CI + wrangler + tenant-router test | No overlap with H2/H4 |
| **1** | H2 (Lock 4) | **Yes** — root + 16 package vitest configs | Excludes pms-core |
| **2** | H3 (Locks 5–6) | **No** — longest pole; after batch 1 for review clarity | pms-core tests + CI comment |
| **Blocked on owner** | H1 staging **live deploy** | — | Secrets + workflow — **not Phase H** |

**Locked execution order (recommended):**

```
(H4 ∥ H1 ∥ H2)  →  H3 Lock 5  →  H3 Lock 6  →  verify
```

Three implementers **may** run Tasks 1–3 concurrently on separate working trees. On a **single** working tree, run Tasks 1–3 sequentially in any order, then Tasks 4–5 strictly in order.

**TDD order:** H1 dry-run locally → tenant-router test strengthen → H2 `pnpm test:coverage` locally → H3 expand physical spec → H3 add virtual spec + deliberate-break verify → H4 docs read-back → full §Verification matrix.

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1 (H1): wrangler dry-run in CI (spec §2 Lock 1)

**Locked:** One step in `.github/workflows/ci.yml` job `checks`, **after `pnpm build`**, **before** first `check:*` gate:

```yaml
- run: pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
```

**Verify locally:** exit 0 on clean tree; deliberately break a binding name → dry-run fails (revert before commit).

**Gotcha:** Dry-run is local config validation — **no `CLOUDFLARE_API_TOKEN` required**; confirm on fork PR if possible.

### D2 — Lock 2 (H1): staging env scaffold only — live deploy **OUT OF SCOPE** (spec §2 Lock 2)

**Locked:** Add `"env": { "staging": { … } }` to `apps/pms-core/wrangler.jsonc` mirroring top-level bindings with staging placeholders:

| Binding kind | Staging placeholder |
|---|---|
| Worker `name` | `hospai-pms-core-staging` |
| `d1_databases[].database_id` | `00000000-0000-0000-0000-000000000010` |
| `kv_namespaces[].id` | `…012`, `…013`, `…014` (increment from dev `…002`, `…003`, `…004`) |
| `r2_buckets[].bucket_name` | `hospai-event-log-staging` |
| Queue names | `hospai-events-staging`, `hospai-pending-commands-staging`, DLQ `-staging` suffixes |
| Workflow names | `hospai-night-audit-staging`, `hospai-migration-sweep-staging`, `hospai-purge-staging` |

Comment **above** the `staging` block (verbatim):

```jsonc
// Staging env — config scaffold only (Audit Phase H). Live deploy requires owner
// Cloudflare account setup + secrets; do not wire CI deploy until enabled.
```

**Explicitly NOT in scope (call out loudly — implementer must not add):**

- No `.github/workflows/*` deploy job (not even disabled-by-default)
- No `CLOUDFLARE_API_TOKEN` / account secrets
- No smoke test against real bindings
- No docs claiming staging is live

**Follow-up vertical (not Phase H):** owner enables `workflow_dispatch` or deploy-on-`main` + HTTP smoke.

### D3 — Lock 3 (H1): jurisdiction production branch test (spec §2 Lock 3)

**Primary:** Existing `uses jurisdictional subnamespace when available` (`packages/tenant-router/src/index.test.ts:71–97`) — **verify and strengthen**, do **not** duplicate.

**Implementer must:**

1. Confirm test exercises branch 1 (`scoped = ns.jurisdiction(j)` success) — **not** `simulateJurisdiction` shim.
2. Strengthen: capture `resolvePropertyStub` **return value**; assert sub-namespace `get` result (e.g. `expect(result).toEqual({ stub: { id: 'eu-prop_123' } })`); assert default namespace `get` is **never** called (already throws — keep).
3. Do **not** add a duplicate test file.

**Out of scope:** miniflare/workerd integration with real `jurisdiction()` API.

### D4 — Lock 4 (H2): coverage without threshold (spec §2 Lock 4)

| Decision | Value |
|---|---|
| Package | `@vitest/coverage-v8` in **root** `package.json` `devDependencies` (hoisted) |
| Config block | `coverage: { provider: 'v8', reporter: ['text', 'json-summary'], include: ['src/**/*.ts'], exclude: ['**/*.test.ts', '**/dist/**'] }` on **16** `vitest.config.ts` files — **exclude** `apps/pms-core/vitest.config.ts` |
| Root script | `"test:coverage": "pnpm exec turbo run test:coverage --filter=!@hospai/pms-core"` |
| Per-package script | `"test:coverage": "vitest run --coverage"` on each covered package |
| Turbo | Add `"test:coverage": { "dependsOn": ["^build"] }` to `turbo.json` |
| CI | **`checks`** — **replace** (not supplement) `pnpm exec turbo run test --filter=!@hospai/pms-core` with `pnpm test:coverage` |
| Threshold | **None** |
| Artifact upload | **No** — CI log text summary is sufficient (pinned; spec left implementer choice) |
| pms-core | **Deferred** — 8-shard merge is follow-up |

**16 vitest configs (exact list — no others):**

1. `packages/kernel/vitest.config.ts`
2. `packages/contracts/vitest.config.ts`
3. `packages/do-runtime/vitest.config.ts`
4. `packages/client-core/vitest.config.ts`
5. `packages/money/vitest.config.ts`
6. `packages/temporal-utils/vitest.config.ts`
7. `packages/tenant-router/vitest.config.ts`
8. `packages/entitlement-client/vitest.config.ts`
9. `packages/ui-kit/vitest.config.ts`
10. `tooling/eslint-plugin-hospai/vitest.config.ts`
11. `apps/web-pms/vitest.config.ts`
12. `modules/pms/reservations/vitest.config.ts`
13. `modules/pms/rates/vitest.config.ts`
14. `modules/pms/inventory/vitest.config.ts`
15. `modules/pms/housekeeping/vitest.config.ts`
16. `modules/pms/restrictions/vitest.config.ts`

**Gotcha:** `packages/crypto-shredding` has tests but **no** `vitest.config.ts` — **out of H2 scope** per spec 16-config list. Do **not** add pms-core coverage.

**web-pms note:** Preserve existing `test.environment` / `environmentMatchGlobs`; add `coverage` alongside `test` block only.

### D5 — Lock 5 (H3): expanded operation mix (spec §2 Lock 5)

**File:** `apps/pms-core/test/reservations-ledger.property.spec.ts`

**Seeds:** Default array **5 → 24** fixed hex-labelled seeds. Keep `LEDGER_PROP_SEED` override (single seed when set).

**Pinned seed array (24):**

```ts
const defaults = [
  0xdecaf, 0xcafe, 0xbeef, 0xfeed, 0xface,
  0x1a2b, 0x2b3c, 0x3c4d, 0x4d5e, 0x5e6f,
  0x6f70, 0x7081, 0x8192, 0x92a3, 0xa3b4,
  0xb4c5, 0xc5d6, 0xd6e7, 0xe7f8, 0xf809,
  0xabcd, 0xbcde, 0xcdef, 0xdef0,
];
```

**Setup additions (once per seed case):**

- After `tryAddRoomType` for `rt_king` (`roomCount: 4`), call `tryCreateRoom` for **`room_k1`** and **`room_k2`** (required for OOO).
- Track `live` with `{ status: 'confirmed' | 'pending' | 'inquiry' | 'checked_in'; roomId?: string }`.

**Operation mix (60 steps; renormalize weights when preconditions fail — `continue` on skip):**

| Op | Weight | Method | Preconditions |
|---|---|---|---|
| Create confirmed | 30% | `tryCreateReservation` default | Same as today |
| Create pending | 8% | `{ status: 'pending' }` | — |
| Create inquiry | 7% | `{ status: 'inquiry' }` | — |
| Confirm | 10% | `tryConfirm` | Target `inquiry` or `pending` in `live` |
| Hold | 5% | `tryHold` `{ holdMinutes: 30 }` | Target `inquiry` |
| Cancel | 12% | `tryCancelReservation` | Non-checked-in |
| Modify | 10% | `tryModifyReservation` | Non-checked-in |
| Check-in | 8% | `tryCheckIn` | `confirmed` only; set `roomId` on success |
| No-show | 5% | `tryNoShow` | `confirmed`, `arrival <= business_date` |
| OOO | 5% | `trySetOooRange` | Unassigned room; skip on `OOO_ROOM_ASSIGNED` |

**Patterns:** `reservations-lifecycle.spec.ts` (confirm/hold/no-show); `rooms-ooo.spec.ts` (OOO); `night-audit.spec.ts` (`tryAdvanceBusinessDate` if needed for no-show eligibility).

**Invariant:** Unchanged — every 3 steps + final, `assertSoldMatchesReservations(stub, 'rt_king', anchor)` only. **Do not** assert virtual SKU rows in this file.

**Timeout:** Keep **60_000** ms; raise to **90_000** only if CI flakes (document in commit message if changed).

### D6 — Lock 6 (H3): virtual-type property test (spec §2 Lock 6)

**New file:** `apps/pms-core/test/reservations-ledger-virtual.property.spec.ts`

**Shared seeds:** Extract `ledgerPropSeedCases()` to `apps/pms-core/test/ledger-prop-seeds.ts` (pinned — both specs import; avoids >15-line duplication).

**Setup:** Reuse `seedKingQueenRoh` pattern from `virtual-reservations.spec.ts:29–73` — `rt_king` (1 room), `rt_queen` (1 room), virtual `rt_roh` over `['rt_king', 'rt_queen']`; BAR rates for all three.

**Operations (48 steps):** Interleave book on `rt_roh` (confirmed + pending), book on `rt_king` / `rt_queen`, cancel, modify, check-in, no-show, confirm pending virtual bookings.

**Invariant:** After every 3 steps + final, `assertSoldMatchesReservations` for **`rt_king` AND `rt_queen`** — **never** assert `sold` on `rt_roh`.

**Mandatory deliberate-break verify (local only — revert before commit):**

1. Temporarily break virtual allocation (e.g. comment one constituent decrement in `commitSoldNightsSync` or test-local shim).
2. Run virtual property spec → **must fail**.
3. Physical-only spec may or may not fail — virtual **must**.
4. **Revert** break before any commit.

**CI updates:**

1. `test-pms-core-ledger-prop` job:

```yaml
- run: pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

2. `test-pms-core` shard `--exclude` comment: mention **both** property spec files (still exclude both from 8-shard matrix).

### D7 — Lock 7 (H4): documentation reconciliation (spec §2 Lock 7)

**§10.1:** Intended 7-day retention; sweep **not yet implemented**; cross-link `docs/superpowers/specs/2026-07-28-queues-consumer-design.md:92`; records persist for DO lifetime; remove imperative BULK sweep language.

**§4.1 Archival:** Planned fiscal-year R2/Iceberg — not Phase 1; cross-link §10.1 deferred purge.

**§4.1 Sizing:** One sentence — 10 GB assumes folio/reservation working set; idempotency/outbox/audit_log grow until retention/archival land.

**§16.4:** Add viewport subsection after ui-kit table, before Enforcement (verbatim block in spec Lock 7).

**README:** Verify-only — pre-push table `:28` lists `pnpm test:local`; sentence `:31` explains segfault + ledger CI split. **No change** if consistent. **Do not** change line 11 `pnpm test # primary loop` (Phase A scope-out).

**H4 touches only:** `ARCHITECTURE.md`, optionally `README.md` (fix-only). **Zero code files.**

### D8 — CI discipline (normative — all tasks)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry shard once. Never `|| true`. Prefer `pnpm test:local`. Ledger property specs run in **`test-pms-core-ledger-prop`**, not the 8-shard matrix.

### D9 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. No push.

---

## Global constraints

- **Head counts unchanged** — wrangler `env.staging` shape change and root devDependency add are not catalog/route/schema heads.
- **H1 live deploy boundary:** config scaffold only — no deploy workflow, no secrets, no smoke (D2).
- **H2:** no coverage threshold; pms-core excluded.
- **H3:** deliberate-break verify mandatory locally; **revert before commit**.
- **H4:** docs-only.

### Scope out (forbidden across all tasks)

- DO / schema / catalog / HTTP route changes
- Product-code behaviour changes (`property-do.ts`, `v1-dispatch.ts`, etc.)
- H1 live deploy job / Cloudflare secrets / staging smoke
- Coverage threshold or pms-core shard merge
- Changing §7.1 ledger invariant
- Retention sweep **implementation**
- README line 11 primary-loop wording change
- Push

---

## File map

| File | Change | Task |
|---|---|---|
| `ARCHITECTURE.md` | H4 §4.1, §10.1, §16.4 | 1 |
| `README.md` | H4 verify-only (edit if drift) | 1 |
| `.github/workflows/ci.yml` | H1 dry-run; H2 `test:coverage`; H3 ledger-prop paths + shard comment | 2, 3, 5 |
| `apps/pms-core/wrangler.jsonc` | H1 `env.staging` scaffold + comment | 2 |
| `packages/tenant-router/src/index.test.ts` | H1 jurisdiction test strengthen | 2 |
| `package.json` (root) | H2 `@vitest/coverage-v8`, `test:coverage` | 3 |
| `turbo.json` | H2 `test:coverage` task | 3 |
| 16 × `vitest.config.ts` | H2 coverage block | 3 |
| 16 × `package.json` | H2 `test:coverage` script | 3 |
| `apps/pms-core/test/reservations-ledger.property.spec.ts` | H3 Lock 5 expanded mix + 24 seeds | 4 |
| `apps/pms-core/test/ledger-prop-seeds.ts` | H3 shared seed helper | 4 |
| `apps/pms-core/test/reservations-ledger-virtual.property.spec.ts` | H3 Lock 6 **new** | 5 |

**Not touched:** `property-do.ts`, migrations, catalog, routes, `tenant-router/src/index.ts`, web-pms UI, idempotency constants.

---

## Spec §1.7 / §5 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 7 (H4) — docs | 1 |
| Locks 1–3 (H1) — dry-run, staging scaffold, jurisdiction test | 2 |
| Lock 4 (H2) — coverage | 3 |
| Lock 5 (H3) — expanded physical property test | 4 |
| Lock 6 (H3) — virtual property test + CI | 5 |
| §5 verification matrix + §8 checklist | 6 |

---

### Task 1: H4 — documentation reconciliation (Lock 7)

**Spec:** Lock 7, §5 rows 8.

**Files:**
- Modify: `ARCHITECTURE.md` (§4.1 sizing + archival, §10.1 retention, §16.4 viewport subsection)
- Modify: `README.md` **only if drift found** (verify-only expected)

**Interfaces:**
- Produces: docs accurately state retention/archival/viewport as planned or deferred
- Frozen heads: unchanged
- **Zero code files**

**Forbidden this commit:** any `.ts`, `.tsx`, `.yml`, `wrangler.jsonc`; README line 11 change.

- [ ] **Step 1: Reword §10.1 Scope and retention (`ARCHITECTURE.md:1715–1718`)**

Per spec Lock 7:
- Intended retention: keys scoped `(property_id, key)`; **target** 7-day for OTA retry windows.
- Sweep **not yet implemented** — reference `docs/superpowers/specs/2026-07-28-queues-consumer-design.md:92`.
- Records persist for DO lifetime; `DEDUPE_TTL_SEC ≥ retention` already honoured.
- Remove imperative language implying BULK lane already sweeps idempotency.

- [ ] **Step 2: Reword §4.1 Archival rule (`ARCHITECTURE.md:336–338`)**

Frame as **planned** fiscal-year archival to R2/Iceberg — not implemented in Phase 1. Cross-link §10.1 deferred purge.

- [ ] **Step 3: Add §4.1 Sizing caveat (`ARCHITECTURE.md:333–334`)**

One sentence: 10 GB sizing assumes folio/reservation working set; **idempotency, outbox, and audit_log grow until retention/archival land**.

- [ ] **Step 4: Add §16.4 viewport subsection (after ui-kit table, before Enforcement)**

Insert verbatim (spec Lock 7):

> **Viewport (2026-08-16, Audit Phase H).** Operator SPA targets **desktop terminals** (≥1280px effective width): fixed 16rem sidebar, no collapse, no width breakpoints. **Tablet support is deferred** — the housekeeping board (attendants in corridors) is the most likely surface to force a revisit; track as an unscheduled Phase 2+ UX decision.

- [ ] **Step 5: Verify README Phase A consistency (no change expected)**

Read `README.md`:
- Pre-push table row **`:28`** — must list `pnpm test:local`.
- Sentence **`:31`** — must explain unsharded segfault + ledger CI split.
- Line **`:11`** — `pnpm test # primary loop` stays unchanged (Phase A scope-out).

If drift found (e.g. `test:local` removed), restore Phase A Lock 3 wording only.

- [ ] **Step 6: Read-back verify**

```bash
rg -n "swept in the \`BULK\`" ARCHITECTURE.md   # expect no matches post-edit
rg -n "Viewport \(2026-08-16" ARCHITECTURE.md   # expect match
rg -n "not yet implemented|not implemented in Phase 1" ARCHITECTURE.md
```

Expected: no imperative unimplemented sweep/archival claims; viewport subsection present.

- [ ] **Step 7: Commit**

```bash
git add ARCHITECTURE.md
# Only if README was edited for drift:
# git add README.md
git commit -m "$(cat <<'EOF'
docs(architecture): reconcile retention, archival, and viewport claims

Mark idempotency sweep and fiscal archival as planned-not-implemented,
clarify DO sizing assumptions, and record desktop-only viewport decision.
EOF
)"
```

---

### Task 2: H1 — CI dry-run, staging scaffold, jurisdiction test (Locks 1–3)

**Spec:** Locks 1–3, §5 rows 1–2, 9.

**Files:**
- Modify: `.github/workflows/ci.yml` (dry-run step only in this task — H2/H3 CI edits come later)
- Modify: `apps/pms-core/wrangler.jsonc`
- Modify: `packages/tenant-router/src/index.test.ts`

**Interfaces:**
- Produces: CI validates wrangler config post-build; staging env block with placeholders; strengthened jurisdiction success assertions
- Frozen heads: unchanged

**Scope boundary (LOUD):** This task adds **config scaffolding only**. **Do not** add deploy workflows, Cloudflare secrets, or smoke tests. Live staging deploy is **owner follow-up**, not Phase H.

**Forbidden this commit:** H2 `test:coverage` CI change; H3 ledger-prop CI change; any deploy job; secrets.

- [ ] **Step 1: Add wrangler dry-run to CI `checks` (Lock 1)**

In `.github/workflows/ci.yml`, after `- run: pnpm build`, before `- run: pnpm check:ddl`:

```yaml
- run: pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
```

Verify locally:

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
```

Expected: **exit 0**.

Optional negative test (revert before commit): typo a binding name in `wrangler.jsonc` → dry-run **non-zero**.

- [ ] **Step 2: Add `env.staging` scaffold to wrangler.jsonc (Lock 2)**

Add comment + `"env": { "staging": { … } }` mirroring all top-level bindings per D2 table. Preserve top-level dev config unchanged.

Structure checklist:
- `name`: `hospai-pms-core-staging`
- Same `durable_objects`, `migrations`, `compatibility_*`, `assets` shape
- Staging-specific IDs/names per D2

Verify dry-run still passes (validates top-level; staging block is parseable):

```bash
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run --env staging
```

Expected: both **exit 0** (staging dry-run validates scaffold shape).

- [ ] **Step 3: Verify and strengthen jurisdiction success test (Lock 3)**

In `packages/tenant-router/src/index.test.ts` test `uses jurisdictional subnamespace when available` (`:71–97`):

1. Confirm mock path: `jurisdiction('eu')` **returns** sub-namespace (branch 1) — not simulate shim.
2. Capture return value:

```ts
const result = resolvePropertyStub(ns, {
  orgId: 'o1',
  propertyId: 'prop_123',
  jurisdiction: 'eu',
});
expect(result).toEqual({ stub: { id: 'eu-prop_123' } });
```

3. Keep assertion default `get` throws (`should not get on default ns`).
4. Do **not** add duplicate test file.

Verify:

```bash
pnpm --filter @hospai/tenant-router test
```

Expected: **PASS**; jurisdiction test asserts sub-namespace `get` return.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml \
  apps/pms-core/wrangler.jsonc \
  packages/tenant-router/src/index.test.ts
git commit -m "$(cat <<'EOF'
chore(ci,pms-core): add wrangler dry-run and staging scaffold

Validate Worker config in CI after build, add staging env placeholders
(config only — no deploy job), and strengthen tenant-router jurisdiction test.
EOF
)"
```

---

### Task 3: H2 — coverage measurement without threshold (Lock 4)

**Spec:** Lock 4, §5 row 3.

**Files:**
- Modify: `package.json` (root)
- Modify: `turbo.json`
- Modify: all **16** `vitest.config.ts` files (list in D4)
- Modify: matching **16** `package.json` files (add `test:coverage` script)
- Modify: `.github/workflows/ci.yml` — replace non-pms-core test step with `pnpm test:coverage`

**Interfaces:**
- Produces: hoisted `@vitest/coverage-v8`; per-package coverage reports in CI log; **no threshold gates**
- Frozen heads: unchanged

**Forbidden this commit:** pms-core coverage; coverage threshold; artifact upload (pinned no); changing `apps/pms-core/vitest.config.ts`.

- [ ] **Step 1: Add root devDependency and script**

In root `package.json`:

```json
"test:coverage": "pnpm exec turbo run test:coverage --filter=!@hospai/pms-core"
```

Add to `devDependencies`:

```json
"@vitest/coverage-v8": "^3.0.9"
```

Run:

```bash
pnpm install
```

- [ ] **Step 2: Add turbo `test:coverage` task**

In `turbo.json`:

```json
"test:coverage": {
  "dependsOn": ["^build"]
}
```

- [ ] **Step 3: Add coverage block to 16 vitest configs**

For each file in D4 list, add top-level `coverage` key:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary'],
  include: ['src/**/*.ts'],
  exclude: ['**/*.test.ts', '**/dist/**'],
},
```

**web-pms:** merge alongside existing `test: { environment, include, environmentMatchGlobs }` — do not drop jsdom globs.

- [ ] **Step 4: Add per-package `test:coverage` scripts**

Each of the 16 packages:

```json
"test:coverage": "vitest run --coverage"
```

Package paths (mirror vitest config list):
`packages/kernel`, `packages/contracts`, `packages/do-runtime`, `packages/client-core`, `packages/money`, `packages/temporal-utils`, `packages/tenant-router`, `packages/entitlement-client`, `packages/ui-kit`, `tooling/eslint-plugin-hospai`, `apps/web-pms`, `modules/pms/reservations`, `modules/pms/rates`, `modules/pms/inventory`, `modules/pms/housekeeping`, `modules/pms/restrictions`.

- [ ] **Step 5: Replace CI non-pms-core test step**

In `.github/workflows/ci.yml` `checks`, replace:

```yaml
- run: pnpm exec turbo run test --filter=!@hospai/pms-core
```

with:

```yaml
- run: pnpm test:coverage
```

- [ ] **Step 6: Verify locally**

```bash
pnpm test:coverage
```

Expected: **PASS**; stdout shows per-package **text** coverage summaries; **no threshold failure**.

Spot-check one package:

```bash
pnpm --filter @hospai/tenant-router test:coverage
```

Expected: `coverage/coverage-summary.json` emitted under package dir.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml turbo.json .github/workflows/ci.yml \
  packages/kernel/vitest.config.ts packages/kernel/package.json \
  packages/contracts/vitest.config.ts packages/contracts/package.json \
  packages/do-runtime/vitest.config.ts packages/do-runtime/package.json \
  packages/client-core/vitest.config.ts packages/client-core/package.json \
  packages/money/vitest.config.ts packages/money/package.json \
  packages/temporal-utils/vitest.config.ts packages/temporal-utils/package.json \
  packages/tenant-router/vitest.config.ts packages/tenant-router/package.json \
  packages/entitlement-client/vitest.config.ts packages/entitlement-client/package.json \
  packages/ui-kit/vitest.config.ts packages/ui-kit/package.json \
  tooling/eslint-plugin-hospai/vitest.config.ts tooling/eslint-plugin-hospai/package.json \
  apps/web-pms/vitest.config.ts apps/web-pms/package.json \
  modules/pms/reservations/vitest.config.ts modules/pms/reservations/package.json \
  modules/pms/rates/vitest.config.ts modules/pms/rates/package.json \
  modules/pms/inventory/vitest.config.ts modules/pms/inventory/package.json \
  modules/pms/housekeeping/vitest.config.ts modules/pms/housekeeping/package.json \
  modules/pms/restrictions/vitest.config.ts modules/pms/restrictions/package.json
git commit -m "$(cat <<'EOF'
chore(test): add vitest coverage for non-pms-core packages

Hoist @vitest/coverage-v8, wire test:coverage across 16 vitest configs,
and run coverage in CI checks with no threshold gate.
EOF
)"
```

---

### Task 4: H3 — expanded physical ledger property test (Lock 5)

**Spec:** Lock 5, §5 row 4 (partial).

**Files:**
- Create: `apps/pms-core/test/ledger-prop-seeds.ts`
- Modify: `apps/pms-core/test/reservations-ledger.property.spec.ts`

**Interfaces:**
- Produces: 24-seed property test with confirm/hold/no-show/OOO ops; shared seed helper
- Frozen heads: unchanged

**Forbidden this commit:** virtual property spec; CI workflow edits; product code changes; deliberate-break that is not reverted.

- [ ] **Step 1: Extract `ledgerPropSeedCases()` to shared helper**

Create `apps/pms-core/test/ledger-prop-seeds.ts`:

- Move `ledgerPropSeedCases()` from property spec (uses `env.LEDGER_PROP_SEED` override logic unchanged).
- Default seeds: **24** entries per D5 pinned array.
- Export function for both property spec files.

Update `reservations-ledger.property.spec.ts` to import from `./ledger-prop-seeds.js`.

- [ ] **Step 2: Extend setup — rooms for OOO**

After `tryAddRoomType` for `rt_king` (`roomCount: 4`):

```ts
// room_k1, room_k2 via tryCreateRoom — pattern from rooms-ooo.spec.ts
```

- [ ] **Step 3: Expand `LiveReservation` tracking**

Add `status` and optional `roomId`; update on create/confirm/hold/check-in/cancel/no-show.

- [ ] **Step 4: Implement 60-step weighted operation mix (D5 table)**

Renormalize on skip (`continue`). Reference:
- `reservations-lifecycle.spec.ts` — confirm/hold/no-show
- `rooms-ooo.spec.ts` — `trySetOooRange`
- `night-audit.spec.ts` / helpers — `tryAdvanceBusinessDate` for no-show date eligibility

Keep invariant checks every 3 steps + final on **`rt_king` only**.

- [ ] **Step 5: Verify locally**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts
```

Expected: **PASS**; **24** seed cases (or 1 with `LEDGER_PROP_SEED=0x1`).

Single-seed smoke:

```bash
LEDGER_PROP_SEED=0xdecaf pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts
```

Expected: **1** case, **PASS**.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/test/ledger-prop-seeds.ts \
  apps/pms-core/test/reservations-ledger.property.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): expand sold-ledger property test operation mix

Add 24 deterministic seeds, confirm/hold/no-show/OOO operations, and
shared ledgerPropSeedCases helper for property test suites.
EOF
)"
```

---

### Task 5: H3 — virtual ledger property test + CI (Lock 6)

**Spec:** Lock 6, §5 rows 4–5, 9.

**Files:**
- Create: `apps/pms-core/test/reservations-ledger-virtual.property.spec.ts`
- Modify: `.github/workflows/ci.yml` (`test-pms-core-ledger-prop` run line + `test-pms-core` exclude comment)

**Interfaces:**
- Produces: virtual-type interleaved property test; both specs in dedicated CI job; both excluded from shards
- Frozen heads: unchanged

**Forbidden this commit:** un-reverted deliberate-break in product code; asserting `rt_roh` sold invariant.

- [ ] **Step 1: Create virtual property spec**

New file importing:
- `ledgerPropSeedCases` from `./ledger-prop-seeds.js`
- Fixtures/helpers from `./fixtures`, `./guest-helpers` (match existing property spec imports)
- `assertSoldMatchesReservations` — duplicate or import from shared test helper if extracted in Task 4

**Setup per seed:** `seedKingQueenRoh` pattern (`virtual-reservations.spec.ts:29–73`) — king/queen 1 room each, virtual `rt_roh`, BAR rates.

**48 steps:** interleave virtual + physical bookings, cancel, modify, check-in, no-show, confirm.

**Invariant:** `assertSoldMatchesReservations(stub, 'rt_king', anchor)` **and** `rt_queen` every 3 steps + final. **Never** assert on `rt_roh`.

Timeout: **60_000** ms (same flake rule as Lock 5).

- [ ] **Step 2: Mandatory deliberate-break verify (revert before commit)**

Local only:

1. Temporarily break virtual allocation (e.g. comment constituent decrement in `commitSoldNightsSync` — locate via grep).
2. Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger-virtual.property.spec.ts
```

Expected: **FAIL**.

3. Optionally run physical spec — may pass; virtual **must** fail.
4. **Revert** break completely; re-run both specs green.

Document in commit message: "deliberate-break verified locally".

- [ ] **Step 3: Update CI ledger-prop job (Lock 6)**

In `.github/workflows/ci.yml`:

**`test-pms-core-ledger-prop`:**

```yaml
- run: pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

**`test-pms-core` shard exclude comment** — update to mention both files; keep exclude flag covering both:

```yaml
--exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
```

(or single `--exclude` with pattern if vitest supports — prefer explicit two-file exclude matching current style).

- [ ] **Step 4: Verify locally**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/reservations-ledger.property.spec.ts \
  test/reservations-ledger-virtual.property.spec.ts
```

Expected: **PASS**; 24 + 24 seed cases total.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/test/reservations-ledger-virtual.property.spec.ts \
  .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
test(pms-core): add virtual sold-ledger property test

Assert §7.1 invariant on physical rows under virtual/physical interleaving;
run both ledger property specs in dedicated CI job (deliberate-break verified).
EOF
)"
```

---

### Task 6: Final verification + checklist

**Spec:** §1.7, §5, §8 checklist.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-audit-phase-h-infra-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-16-audit-phase-h-infra.md` — Task 6 checkboxes only

**Forbidden this commit:** new features; scope-out items; un-reverted deliberate-break.

- [ ] **Step 1: Spec §5 matrix (rows 1–5)**

```bash
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm --filter @hospai/tenant-router test
pnpm test:coverage
pnpm --filter @hospai/pms-core exec vitest run \
  test/reservations-ledger.property.spec.ts \
  test/reservations-ledger-virtual.property.spec.ts
```

Expected: all **PASS**; coverage shows text summaries, no threshold failure; 24 + 24 seed cases.

- [ ] **Step 2: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 3: All 14 `check:*` gates**

```bash
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
```

Expected: all **PASS** (`check:ddl` confirm-only).

- [ ] **Step 4: Full local test loop — long pole**

```bash
pnpm test:local
```

Expected: non-pms-core tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [ ] **Step 5: ARCHITECTURE read-back (spec §5 row 8)**

```bash
rg -n "swept in the \`BULK\`" ARCHITECTURE.md          # expect no matches
rg -n "Viewport \(2026-08-16" ARCHITECTURE.md         # expect match
rg -n "not yet implemented|not implemented in Phase 1" ARCHITECTURE.md
```

Expected: no imperative unimplemented sweep/archival claims; viewport subsection present.

- [ ] **Step 6: Pin frozen heads — counts unchanged**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG|AUDIT_WRITER"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 158
```

Expect: catalog **89**; writers **63**; routes **144** tail `get_city_ledger_statement`; schema **34**; steps **8** `[3] AUTO_TRANSFER`; idempotency consts **158**.

- [ ] **Step 7: Scope-out grep — must be clean**

```bash
! rg "CLOUDFLARE_API_TOKEN" .github/workflows/ci.yml
! rg "deploy-on|workflow_dispatch.*staging" .github/workflows/ --glob '*.yml'
rg "config scaffold only" apps/pms-core/wrangler.jsonc
```

Expected: no deploy secrets/job; staging comment present.

- [ ] **Step 8: CI workflow sanity (spec §5 row 9)**

Confirm in `.github/workflows/ci.yml`:
- `checks`: dry-run after build; `pnpm test:coverage` (not plain turbo test)
- `test-pms-core-ledger-prop`: both property spec paths
- `test-pms-core`: both files excluded from shards

- [ ] **Step 9: Tick spec §8 reviewer checklist**

Tick every item in `docs/superpowers/specs/2026-08-16-audit-phase-h-infra-design.md` §8.

- [ ] **Step 10: Tick Task 6 checkboxes in this plan only**

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-audit-phase-h-infra-design.md \
  docs/superpowers/plans/2026-08-16-audit-phase-h-infra.md
git commit -m "$(cat <<'EOF'
chore(docs): finalize audit Phase H verification checklist

Confirm H1–H4 infra items green across full gate suite and frozen head
counts unchanged after wrangler scaffold, coverage, and property tests.
EOF
)"
```

**Stop.** Audit **H1–H4** closed.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run` | Exit 0 | 2, 6 |
| 2 | `pnpm --filter @hospai/tenant-router test` | Green; sub-namespace `get` return asserted | 2, 6 |
| 3 | `pnpm test:coverage` | Green; text summaries; **no threshold** | 3, 6 |
| 4 | Both ledger property specs vitest run | Green; 24 + 24 seeds | 4, 5, 6 |
| 5 | Deliberate virtual allocation break | Virtual spec **fails**; reverted before commit | 5 |
| 6 | `pnpm test:local` | **Long pole** — 8 shards green | 6 |
| 7 | All **14** `check:*` + typecheck + lint | Green | 6 |
| 8 | Read ARCHITECTURE §4.1, §10.1, §16.4 | No imperative unimplemented sweep/archival | 1, 6 |
| 9 | CI workflow on PR | dry-run + test:coverage in checks; both specs in ledger-prop job | 2, 3, 5, 6 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. Ledger property specs: **`test-pms-core-ledger-prop` job only** — exclude both from 8-shard matrix.

---

## Spec §8 reviewer checklist (Task 6 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Lock 1 (H1): `wrangler deploy --dry-run` in `checks` after build | 2 |
| Lock 2 (H1): `env.staging` scaffold; **no** deploy job / secrets | 2 |
| Lock 3 (H1): jurisdiction success path verified/strengthened | 2 |
| Lock 4 (H2): `@vitest/coverage-v8`; `test:coverage` turbo + CI; **no threshold** | 3 |
| Lock 5 (H3): expanded mix; **24 seeds**; `LEDGER_PROP_SEED` preserved | 4 |
| Lock 6 (H3): virtual property spec; physical rows only; deliberate-break verified | 5 |
| Lock 7 (H4): §10.1 / §4.1 / §16.4 reword; README verified | 1 |
| Frozen head **counts** unchanged | 6 |
| Scope-out respected | 1–6 |
| `pnpm test:local` green | 6 |
| All **14** `check:*` gates green | 6 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.7 scope in | 1–6 |
| §1.8 scope out | forbidden all |
| §2 Locks 1–7 | 1–5 |
| §3 file map | 1–6 |
| §4 / §5 test plan | 1–6 |
| §8 checklist | 6 |
| Frozen heads §1.6 / §9 | unchanged |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** Spec §9 — `wrangler.jsonc` adds `env.staging` (shape only); root adds `@vitest/coverage-v8` — not catalog heads.

---

## Plan writer interpretations (flagged for reviewer)

1. **Coverage artifact upload:** spec §6 left implementer choice — plan **pins NO upload** (CI log sufficient).
2. **Shared seed helper:** spec §6 preferred extract if >15 lines — plan **pins** `test/ledger-prop-seeds.ts` in Task 4 (both specs import).
3. **CI test step:** spec Lock 4 preferred **replace** — plan **pins replace** (not supplement).
4. **H3 commit split:** spec allows one H3 commit — plan uses **two commits** (Task 4 physical, Task 5 virtual+CI) for implementer sizing; acceptable per "commit per task".
5. **Task 2 CI scope:** Task 2 adds dry-run only; Task 3 replaces test step; Task 5 updates ledger-prop — avoids parallel merge conflicts on `ci.yml`.
6. **Staging dry-run verify:** Task 2 includes `wrangler deploy --dry-run --env staging` as optional local shape check (not spec-mandatory but catches scaffold typos).
7. **Shard exclude syntax:** use two `--exclude` flags unless vitest version supports comma list — implementer verifies against vitest 3.0.9.
8. **24 seed values:** spec did not enumerate all 24 — plan **pins** D5 array for determinism (implementer must not shrink).
9. **crypto-shredding:** has tests but no vitest.config — **explicitly out of H2** per spec 16-file list.

---

## Risks

| Risk | Mitigation |
|---|---|
| Dry-run fails on fork PRs | Dry-run is local validation — no API token; verify on fork |
| Coverage slows `checks` | Non-pms-core only; no threshold blocking |
| H3 property tests saturate events queue | Separate `test-pms-core-ledger-prop` job; exclude both from shards |
| H3 runtime exceeds 60s (24 seeds × expanded ops) | Raise to 90s with commit note; split jobs last resort |
| Staging scaffold mistaken for live env | Comment + D2 scope-out; no deploy workflow |
| Deliberate-break left un-reverted | Task 5 Step 2 + Task 6 scope-out grep |
| Parallel Tasks 1–3 collide on `ci.yml` | Single-tree: sequential; multi-tree: assign H1/H2/H3 CI edits to Tasks 2/3/5 only |
| H4 wording triggers retention implementation pressure | Cross-link deferred queues-consumer spec; do-not-fix table unchanged |

---

## Approximate line numbers — read actual code first

| Area | Spec cites | Plan note |
|---|---|---|
| CI `checks` build step | `ci.yml:19` | Task 2 — insert dry-run after |
| CI non-pms-core test | `ci.yml:44` | Task 3 — replace with test:coverage |
| Ledger-prop job | `ci.yml:82` | Task 5 — both spec paths |
| Shard exclude comment | `ci.yml:67–69` | Task 5 — mention both files |
| Jurisdiction test | `index.test.ts:71–97` | Task 2 — strengthen return assert |
| Property spec seeds | `reservations-ledger.property.spec.ts:55` | Task 4 — move to ledger-prop-seeds.ts |
| §10.1 retention | `ARCHITECTURE.md:1715–1718` | Task 1 |
| §4.1 sizing/archival | `ARCHITECTURE.md:333–338` | Task 1 |
| §16.4 viewport | `ARCHITECTURE.md:2128–2130` | Task 1 — insert before Enforcement |
| README test:local | `README.md:28,31` | Task 1 verify-only |
| seedKingQueenRoh | `virtual-reservations.spec.ts:29–73` | Task 5 |
