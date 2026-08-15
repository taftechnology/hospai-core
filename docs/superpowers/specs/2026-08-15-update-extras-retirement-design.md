# Update extras retirement

**Tree verified 2026-08-15 (post split command collapse `c0ce5ef`):** `COMMAND_CATALOG` length **90** (`register.test.ts` ~751), `AUDIT_WRITER_COMMAND_IDS.size === 63` (`register.test.ts` ~269 and ~750; `reservations.update_extras` **not** a member), `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'` (`register.test.ts` ~748; `v1-http-routes.ts` tail), `PROTOTYPE_ACTIONS` length **35** (`register.test.ts` ~176; includes `'UPDATE_RESERVATION_EXTRAS'`), retiring catalog row ~856–864 (`catalog.ts`), `PROPERTY_SCHEMA_HEAD === 33` / `ORG_SCHEMA_HEAD === 7`, `NIGHT_AUDIT_STEPS` length **8**, `PLATFORM_GAPS === []`.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [booking wizard](./2026-08-11-booking-wizard-design.md) §2.8 / leftover **7**; [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) leftover **7**; [booking plan picker](./2026-08-15-booking-plan-picker-design.md) leftover **5**; [exception queue workbench](./2026-08-13-exception-queue-workbench-design.md) §2 / leftover **16**; [command catalog](./2026-07-27-command-catalog-design.md) row 35; `packages/contracts/src/commands/catalog.ts`; `apps/pms-core/test/exception-workbench.spec.ts` test 13.

**Closes:** Phase 1 leftover **13** / progress item **13** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~43): retire catalog-only `reservations.update_extras` and its prototype action carrier. Bidirectional one-sentence pointers in booking-wizard, lifecycle, and booking-plan-picker specs are the **final implementation task**, not this spec writer’s job.

---

## Executive summary

Physically remove **`reservations.update_extras`** from `COMMAND_CATALOG` and remove **`UPDATE_RESERVATION_EXTRAS`** from `PROTOTYPE_ACTIONS`. The row was catalog debt only: no PropertyDO method, no HTTP route, not in `REPLAY_DISPATCH`, no client method, no SPA usage. A queued extras update would always replay as `unknown_command` (exception-workbench leftover **16**). Desk “extras” are already covered by folio charge-code postings (`ADD_FOLIO_ITEM` / `folio.add_item`). Catalog **90 → 89**; prototype actions **35 → 34**. Audit writers **63** unchanged. No replacement command, no migration shim, no `PLATFORM_GAPS` entry. Historical audit-log rows referencing the retired id stay append-only.

---

## 1. Context & motivation

### 1.1 Problem statement

The prototype had `UPDATE_RESERVATION_EXTRAS`. The platform mapped it to a catalog row that was never wired:

| Fact | Verified |
|---|---|
| Catalog id | `reservations.update_extras` ~856–864 |
| `prototypeAction` | `'UPDATE_RESERVATION_EXTRAS'` |
| `lane` | `INTERACTIVE` |
| `degraded` | `QUEUE_PROVISIONAL` |
| `idempotent` | `true` |
| `events` | `['reservation.modified']` |
| `permission` | `reservations:write` |
| `entitlement` | **absent** |
| `AUDIT_WRITER_COMMAND_IDS` | **not a member** |
| PropertyDO RPC | **none** |
| HTTP route / `commandId` | **none** |
| `REPLAY_DISPATCH` | **none** — replay would fail `unknown_command` |
| Client / SPA | **none** |
| Live code references | **one** — `exception-workbench.spec.ts` test 13 uses the id as an arbitrary unknown-command sample |

[Booking wizard](./2026-08-11-booking-wizard-design.md) §2.8 once flagged retirement as needing a third prototype category (“not carried forward”). That category is **not** justified here: the prototype extras surface has no sellable desk flow beyond charge-code folio postings, and keeping a dead action in `PROTOTYPE_ACTIONS` only preserves false coverage.

### 1.2 Superseding desk flow (locked rationale)

| Prototype action | Platform survivor |
|---|---|
| `UPDATE_RESERVATION_EXTRAS` | **`ADD_FOLIO_ITEM` → `folio.add_item`** — charge-code postings on the folio cover incidental/extras desk work today |

`reservation.modified` **stays** on the platform — still emitted by `reservations.modify` and other lifecycle commands. Removing the dead row does not retire the event type or consumer allowlist entry.

### 1.3 What already exists (do not re-spec)

| Piece | Where |
|---|---|
| Folio extras posting | `folio.add_item` — `QUEUE_PROVISIONAL`, `prototypeAction: 'ADD_FOLIO_ITEM'`, replay wired |
| Unknown-command workbench path | `exception-workbench.spec.ts` test 13 — retry 422 / resolve 200 |
| Audit side-effect pattern | `ADD_AUDIT_LOG` stays in `PROTOTYPE_ACTIONS` with `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` — **different** retirement class (prototype record preserved; platform implements as side effect) |

**Heads (frozen — this chunk moves catalog + prototype list only):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **90** | **89** — remove `reservations.update_extras` |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged (retiring id was never a writer) |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143] = get_city_ledger_statement` | **unchanged** |
| `PROTOTYPE_ACTIONS` | length **35** | **34** — remove `'UPDATE_RESERVATION_EXTRAS'` |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.4 Scope in

1. **Delete catalog entry** — remove `reservations.update_extras` block (Lock 1).
2. **Shrink `PROTOTYPE_ACTIONS`** — remove `'UPDATE_RESERVATION_EXTRAS'` (Lock 2).
3. **Register / invariant test updates** (Lock 3).
4. **Exception workbench test 13** — swap sample unknown-command type (Lock 4).
5. **Historical spec pointers** — one-line closed notes in three upstream specs + progress file (Lock 5; final implementation task).

### 1.5 Scope out (normative)

- DO / HTTP / client / SPA product changes
- Schema migration (`PROPERTY_SCHEMA_HEAD` stays **33**)
- New or removed events / wire codes (`reservation.modified` unchanged)
- `REPLAY_DISPATCH` changes (retiring the id removes the gap; no new replay entry)
- `AUDIT_WRITER_COMMAND_IDS` / `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` changes
- Replacement “extras” feature design — future sellable vertical if ever productized
- `PLATFORM_GAPS` entry — gaps array stays `[]`
- Audit-log rewrite for historical `commandId` strings — append-only posture (same as split collapse)
- Bidirectional pointer sentences in upstream specs (final implementation task)

---

## 2. Locked decisions (verbatim — do not deviate)

1. **Physical removal** of `reservations.update_extras` from `COMMAND_CATALOG` (~856–864). Delete the entire object; do not deprecate-in-place or move to `PLATFORM_GAPS`.
2. **Remove `'UPDATE_RESERVATION_EXTRAS'` from `PROTOTYPE_ACTIONS`** (~1040). **Rationale (normative):** the prototype reservation-extras surface is superseded by folio charge-code postings (`ADD_FOLIO_ITEM` / `folio.add_item` covers the desk flow). Unlike `ADD_AUDIT_LOG` (preserved in the list with a side-effect exemption), this action has no platform analogue and no sellable vertical — a “not carried forward” register category is not justified for a single dead row.
3. **`exception-workbench.spec.ts` test 13** (~578–588): change `type: 'reservations.update_extras'` to an obviously-fake id, e.g. `type: 'noop.unknown_command'`. Behavior under test (unknown_command retry **422** / resolve **200**) is unchanged.
4. **No replacement command, no migration shim, no `PLATFORM_GAPS` entry.** Audit-log history referencing the retired id stays (append-only, no rewrite).
5. **Heads that do not move:** `AUDIT_WRITER_COMMAND_IDS.size === 63`, `V1_HTTP_ROUTE_AUDIT.length === 144`, schema heads, night-audit steps, route tail index.

---

## 3. Register / invariant analysis (research → locked)

### 3.1 `assertRegisterInvariants()` (`register.ts` ~457–468)

Operates on **`CONFIG_REGISTER` only** — duplicate keys and DOMAIN consumer rules. **Not affected** by catalog retirement.

### 3.2 `EXCLUDED_PROTOTYPE_KEYS` / `PROTOTYPE_CONFIG_KEYS` (`register.ts` ~56–67, ~437)

No extras-related keys. **No edits.**

### 3.3 Catalog invariants enforced in `register.test.ts`

| Invariant | Retiring entry today | After removal |
|---|---|---|
| `covers all N prototype actions (catalog ∪ side-effect)` (~175–192) | Satisfied via catalog row + union with `ADD_AUDIT_LOG` side effect | Update **N: 35 → 34**; remove `'UPDATE_RESERVATION_EXTRAS'` from `PROTOTYPE_ACTIONS`; union still equals sorted `PROTOTYPE_ACTIONS` |
| Side-effect exemption guard (~195–204) | Unrelated | **Unchanged** |
| `audit.append` retired (~207–209) | Unrelated | **Unchanged** |
| Entitled commands have writer or exemption (~253–269) | Row has **no** `entitlement` — outside entitled set | **Unchanged**; `AUDIT_WRITER_COMMAND_IDS.size` pin stays **63** |
| Provisional / night-audit operator commands (~272–325) | Unrelated | **Unchanged** |
| PropertyDO wires every writer id (~328–338) | Retiring id not in writers | **Unchanged** |
| Route audit pins (~341–748) | Unrelated | **Unchanged** |
| `COMMAND_CATALOG.toHaveLength(90)` (~751) | Pin | **→ 89** |
| `PLATFORM_GAPS === []` (~752, ~801–804, ~1091–1095) | Unrelated | **Unchanged** |
| Degraded class spot checks (~758–779) | Does not mention `update_extras` | **Unchanged** |
| Mutating commands idempotent (~791–798) | Row was idempotent INTERACTIVE | Removal satisfies loop |
| Folio / inventory / guest / payment catalog tables (~807+) | Does not list `update_extras` | **Unchanged** |

### 3.4 CI scripts (catalog-derived expectations)

| Script | Rule touching retiring row | After removal |
|---|---|---|
| `scripts/permissions-check.mjs` | Every catalog entry needs valid `permission`; route `commandId` ∈ catalog | **Pass** — no hardcoded catalog length; one fewer permission iteration |
| `scripts/degraded-check.mjs` | HTTP-routed `QUEUE_PROVISIONAL` must appear in `REPLAY_DISPATCH` | **Pass** — row had **no** HTTP route, so never in that check |
| `scripts/degraded-check.mjs` | `availability.changed` emitters must be `FAIL_CLOSED` | **Pass** — row did not emit `availability.changed` |
| `scripts/entitlements-check.mjs` | `FAIL_CLOSED` + non-empty `events` need entitlement or opt-out | **Pass** — row was `QUEUE_PROVISIONAL`, no entitlement (script skips non-`FAIL_CLOSED`) |
| `scripts/entitlements-check.mjs` | Opt-out ids must exist in catalog | **Pass** — row was never in opt-out list |

### 3.5 Repo-wide reference grep (verified pre-spec)

| Area | Hits |
|---|---|
| `apps/` | `exception-workbench.spec.ts` test 13 only |
| `packages/` | `catalog.ts` catalog row + `PROTOTYPE_ACTIONS` entry |
| `scripts/` | **none** |
| `docs/superpowers/` | Historical specs/plans (pointer task only) |

---

## 4. Behaviour (normative locks)

### Lock 1 — Delete catalog entry

Remove from `packages/contracts/src/commands/catalog.ts`:

```ts
  {
    id: 'reservations.update_extras',
    prototypeAction: 'UPDATE_RESERVATION_EXTRAS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.modified'],
    permission: 'reservations:write',
  },
```

Neighbouring rows (`staff.delete` → `rooms.delete`) must remain contiguous with no gap comment debt.

### Lock 2 — Shrink `PROTOTYPE_ACTIONS`

Delete the `'UPDATE_RESERVATION_EXTRAS'` line (~1040). Do **not** add a `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` row — there is no side-effect implementation to document.

Update coverage test title and assertion:

| Location | Change |
|---|---|
| `register.test.ts` ~175 | Test name: `covers all 34 prototype actions …` |
| `register.test.ts` ~176 | `expect(PROTOTYPE_ACTIONS).toHaveLength(34)` |

The union assertion (~191–192) stays structurally the same — sorted union of catalog `prototypeAction`s + side-effect actions must equal sorted `PROTOTYPE_ACTIONS`.

### Lock 3 — Register test pins

| Location | Change |
|---|---|
| `register.test.ts` ~751 | `expect(COMMAND_CATALOG).toHaveLength(89)` |
| `register.test.ts` ~269, ~750 | `AUDIT_WRITER_COMMAND_IDS.size === 63` — **unchanged** |

No other `register.test.ts` edits required (grep confirmed no `update_extras` / `UPDATE_RESERVATION_EXTRAS` assertions beyond length pins).

### Lock 4 — Exception workbench test 13

`apps/pms-core/test/exception-workbench.spec.ts` ~582:

```ts
// before
type: 'reservations.update_extras',
// after
type: 'noop.unknown_command',
```

Assertions ~587–591 unchanged.

### Lock 5 — Historical spec pointers (final implementation task)

Add **one closed sentence** each (implementer edits upstream specs when this chunk lands):

| File | Anchor | Exact sentence |
|---|---|---|
| [booking wizard](./2026-08-11-booking-wizard-design.md) | §2.8 bullet `reservations.update_extras` (~141) | **`Closed` in [update extras retirement](./2026-08-15-update-extras-retirement-design.md): catalog row and `UPDATE_RESERVATION_EXTRAS` removed; desk extras use `folio.add_item` / charge codes.** |
| [booking wizard](./2026-08-11-booking-wizard-design.md) | §7 leftover **7** row (~293) | Replace deferred `update_extras` clause with: **`update_extras` closed in [update extras retirement](./2026-08-15-update-extras-retirement-design.md); `update_status` retargeted 2026-08-12.** |
| [reservation lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) | §17 item **7** (~855) | **`Closed` in [update extras retirement](./2026-08-15-update-extras-retirement-design.md).** |
| [booking plan picker](./2026-08-15-booking-plan-picker-design.md) | §5 leftover **5** row (~268) | **`Closed` in [update extras retirement](./2026-08-15-update-extras-retirement-design.md).** |
| [progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) | item **13** (~43) | Mark **DONE** with commit hash when landed (same pattern as item **12**). |

Optional hygiene (same final task, not blocking): strike exception-queue leftover **16** (~515) — moot once the catalog id no longer exists.

---

## 5. Test plan

| # | Target | Expectation |
|---|---|---|
| 1 | `pnpm --filter @hospai/contracts test` | Green; catalog **89**, prototype **34**, writers **63** |
| 2 | `apps/pms-core/test/exception-workbench.spec.ts` test 13 | Green with `noop.unknown_command` |
| 3 | `pnpm check:permissions` | Green; log line shows **89** catalog entries |
| 4 | `pnpm check:degraded` | Green — route count **144** unchanged |
| 5 | `pnpm check:entitlements` | Green — no opt-out / writer pairing change |
| 6 | Grep `reservations.update_extras` / `UPDATE_RESERVATION_EXTRAS` in `apps/`, `packages/`, `scripts/` | **Zero** hits (docs may retain historical mentions until pointer task) |

TDD order: failing contracts test pins first (catalog 89, prototype 34), then delete rows, then exception-workbench sample swap.

---

## 6. Rollback / migration notes

| Scenario | Action |
|---|---|
| Deploy forward | No runtime behaviour change — id was never dispatchable |
| Provisional queue rows | Any historical `provisional_exception` payload with `type: 'reservations.update_extras'` remains replayable only as `unknown_command` — same as today |
| Audit log | Historical rows may reference retired `commandId` — append-only, no rewrite |
| Roll back code | Restore catalog block + `PROTOTYPE_ACTIONS` line + test pins + workbench sample id |

---

## 7. File-level impact

| Area | Touch |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Delete catalog entry; remove `PROTOTYPE_ACTIONS` line |
| `packages/contracts/src/register.test.ts` | Length pins **89** / **34**; coverage test title |
| `apps/pms-core/test/exception-workbench.spec.ts` | Test 13 sample type |
| Upstream specs + progress file | Lock 5 pointer sentences (final task) |

**Not touched:** `property-do.ts`, `v1-dispatch.ts`, `v1-http-routes.ts`, `audit-writers.ts`, `entitlements.ts`, `replay-dispatch.ts`, `packages/client-core`, `apps/web-pms`, `property-migrations.ts`, `event-consumer.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `ARCHITECTURE.md`.

---

## 8. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Catalog-only `reservations.update_extras` with no DO/HTTP/replay | Physical delete |
| 2 | False `UPDATE_RESERVATION_EXTRAS` prototype coverage | Removed from `PROTOTYPE_ACTIONS` — superseded by `ADD_FOLIO_ITEM` |
| 3 | Exception-workbench test tied to retiring id | `noop.unknown_command` sample |
| 4 | booking-wizard leftover **7** (`update_extras` half) | This spec + pointer task |
| 5 | lifecycle leftover **7** | This spec + pointer task |
| 6 | booking-plan-picker leftover **5** | This spec + pointer task |
| 7 | Phase 1 progress item **13** | This spec |
| 8 | exception-queue leftover **16** (replay gap for dead id) | Id removed — gap moot |

**Still open (explicit):**

| Item | Owner |
|---|---|
| Upstream spec pointer sentences | Final implementation task (Lock 5) |
| Future VIP/extras sellable vertical | Out of scope — would be new product design, not resurrection of this id |

---

## 9. Implementation checklist

- [x] Delete `reservations.update_extras` from `COMMAND_CATALOG`; remove `'UPDATE_RESERVATION_EXTRAS'` from `PROTOTYPE_ACTIONS`
- [x] `register.test.ts`: `COMMAND_CATALOG` **89**, `PROTOTYPE_ACTIONS` **34**, writers **63** unchanged
- [x] `exception-workbench.spec.ts` test 13: `noop.unknown_command`
- [x] `pnpm --filter @hospai/contracts test`; `pnpm check:permissions`; `pnpm check:degraded`; `pnpm check:entitlements`
- [x] Grep clean in `apps/`, `packages/`, `scripts/`
- [x] Lock 5 pointer sentences + progress item **13** DONE line (final task)

---

## 10. Tree conflicts with reviewer locks

**None on heads.** Verified post-`c0ce5ef`: catalog **90**, writers **63**, route tail `[143] get_city_ledger_statement`, prototype **35**, schema **33**, steps **8**, `PLATFORM_GAPS === []`, retiring row has no entitlement and is not in `AUDIT_WRITER_COMMAND_IDS`.

**Notes for implementer (not lock violations):**

1. **Do not add `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` for extras** — reviewer locked shrink, not reclassify (contrast `ADD_AUDIT_LOG`).
2. **Do not bump audit writers** — the row never had an entitlement-gated writer path.
3. **Pick a obviously-fake retry sample** — `noop.unknown_command` is canonical; any non-catalog id with the same replay behaviour is acceptable if tests stay green.
