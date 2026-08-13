# Cross-Store Purge Workflow (§4.8)

**Date:** 2026-08-12  
**Status:** Accepted — implementation-ready  
**Sources:** ARCHITECTURE.md §4.5 (residency / Platform D1), §4.8 (crypto-shredding + purge Workflow), §5 (module `lifecycle.onPurge`), Rule 13 (PII by reference); [guests crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md); [guests + PII vertical](./2026-08-06-guests-pii-vertical-design.md); [housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md) (§2.8 deferred `onPurge` check); [LaneGuard](./2026-07-28-laneguard-design.md); [migration orchestrator](./2026-07-28-migration-orchestrator-design.md) (Workflow paging precedent); [gate trust](./2026-08-12-gate-trust-design.md) (`--self-test` idiom)

**Amended by:** [event-log R2 design](./2026-08-12-event-log-r2-design.md) (2026-08-12, twice) — §1.1 gains `retained` and `pending`; R2 skip derived from binding presence; org `PURGE_R2` / guest R2 retained; VERIFY scans only `reached`; halted certificates must not claim `reached` for unattempted stores. See that spec for event-log key layout and bulk-delete smoke. Edits below are the purge-side half of a bidirectional pointer — do not “fix” only one document.

---

## 1. Context & Motivation

Guest erasure’s cryptographic guarantee already works: `tryEraseGuest` shreds the per-guest key inside the OrgDO transaction via `SqlKeyStore.shred()`. §4.8 is explicit that key destruction *is* erasure; steps after that are housekeeping and evidence — “not the cryptographic guarantee.”

What is missing:

1. Provable row reclaim, VERIFY, and a **purge certificate** for guest erasure.
2. **Tenant churn** — no property/org deletion path exists anywhere; §14 calls this needed as soon as the first tenant churns. This is the real driver.
3. The deferred housekeeping rule: entitlement ≠ `pms.core` ⇒ `lifecycle.onPurge` required.

Iceberg still does not exist (`skipped: no_iceberg_binding`). R2’s durable event log is specified in [event-log R2 design](./2026-08-12-event-log-r2-design.md); until that binding is present in a deployment, certificates must still record `r2: skipped, reason: no_r2_binding` (derived, not hardcoded off). A certificate that says “purged” without recording skip/retain honestly overstates coverage — and certificates are ruinous to correct once handed out.

**Module `onPurge` trigger is out:** housekeeping is `pms.core` and correctly omits lifecycle; no add-on modules exist. Wiring the trigger would be vacuous. The entitlement check ships (same shape as the ownership gate).

### 1.1 Certificate scope (normative)

A purge certificate is **not** a boolean success. It records:

| Field | Meaning |
|---|---|
| `subjects[]` | Refs only: `orgId` / `propertyId[]` / `guestRef` + `piiKeyId` as applicable — **never PII** |
| `stores[]` | All five §4.8 names (see below), each `{ store, status: 'pending' \| 'reached' \| 'skipped' \| 'retained', deleted?: number, reason?: string, note?: string }` — see hard rules for which fields each status may carry |
| `limitations[]` | Always includes the §4.8 PITR caveat (DO restore can recover key material; Phase 0 does not cover backups/PITR) |
| `operator` | Human who requested (user id); distinct from `SystemActor` performing steps |
| `workflowId` | Deterministic instance id for this attempt |
| `outcome` | `certified` \| `halted` — halted **never** implies stores were purged |
| `halt_reason?` | Machine reason when halted |
| `recorded_at` | Stamped on **every** append (certified or halted) — sort key for “authoritative” |
| `certified?` | Set only when `outcome = certified` — when coverage was attested |
| `started` | Run start |

**Five stores, always enumerated** (auditor maps 1:1 to §4.8):

| `store` | Phase 0 reality |
|---|---|
| `key_store` | Starts `pending`. After the shred/verify step: `reached`; colocated in OrgDO (`note: colocated_in_org_do`; `deleted: 0` — shredded in place, rows not removed; VERIFY still scans) |
| `property_do` | Starts `pending`. After the property step: `reached` (org: wipe; guest: nothing applicable → `deleted: 0`) |
| `org_do` | Starts `pending`. After the org step: `reached`; may include OrgEntitlementDO wipe folded in (`note: includes_entitlement_do`, `deleted` summed) — not a sixth §4.8 name |
| `r2` | **Derived at init:** binding absent → `skipped: no_r2_binding`; binding present → `pending` until the R2 step. Org step → `reached` + prefix delete ([event-log](./2026-08-12-event-log-r2-design.md)); guest step → `retained, reason: pii_by_reference_event_log` (no `deleted`) |
| `iceberg` | Skipped from init — `reason: no_iceberg_binding` (out of scope this deployment) |

**Hard rules:**

1. **`pending` ≠ `reached` ≠ `skipped` ≠ `retained`.** Four evidentiary claims. **`VERIFY` scans only stores marked `reached`.** `pending` = in scope, not yet attempted (typical on HALT). `retained` = visited, kept on purpose (no scan). `skipped` = out of scope for this deployment/run (no scan).
2. **Reached-with-zero ≠ skipped ≠ retained ≠ pending.** `reached` + `deleted: 0` means the Workflow visited and found nothing applicable to delete (guest PropertyDO). Natural reading of bare `reached` as “purged something” is the overstatement this section exists to prevent. **`retained` carries `reason` and must not carry `deleted`.** **`pending` carries neither `deleted` nor a skip/retain `reason`.**
3. **`deleted: 0` is not one claim across stores.** Guest `property_do` = nothing applicable, VERIFY scans. `key_store` + `colocated_in_org_do` = shredded in place, VERIFY scans. `retained` = kept on purpose, no `deleted` field, VERIFY does not scan. `pending` = not visited — **must not** carry `deleted: 0` (that was the shipped bug: seeding `reached, deleted: 0` before any step).
4. **Purged-but-unrecorded is also forbidden.** Every store the Workflow touches appears in `stores[]` (OrgEntitlementDO folds into `org_do`).
5. **Rule 13 binds certificates.** Platform D1 is global and never purged. Subjects by reference only — never a guest name, never anything the shredded key protected. Certificate column set is **checkable** (`check:` assertion on declared columns) so a future `guest_name` cannot land in the never-purged global store.
6. **Every terminal state leaves a certificate row** — certified, halted, or failed. No run ends without evidence. (See §3.)
7. **Certified certificates contain no `pending`.** A successful run replaced every in-scope store. Halted certificates **may** (and typically do) contain `pending` for steps that never ran — that is the honest record.

**Authoritative certificate for a subject** = latest row by `recorded_at`. Earlier halted (and prior certified) rows are retained — the history *is* the evidence. “The certificate for org X” is a **set**, not a row.

**Append-only:** Platform D1 table `purge_certificate`; `UPDATE`/`DELETE` aborted by triggers (same idiom as `property_jurisdiction_immutable` / `subscription_no_delete`).

**Why Platform D1 (not OrgDO / CertificateDO):**

- §4.8 already assigns purge-governing state (retention window) to Platform D1 — Workflow needs `PLATFORM_DB` regardless.
- Certificate must outlive the DO it certifies; OrgDO placement is destroyed by tenant churn precisely when disputes are most likely.
- A global CertificateDO adds residency exposure (§4.5) and a new binding for a low-write artifact; Platform D1 is already the accepted global control plane.

### 1.2 Scope in

1. One `PurgeWorkflow` (`kind: 'guest' | 'org'`), per-kind **step plans**, shared CERTIFY / skip / HALT helpers + D1 append.
2. `PURGE_WORKFLOW` binding (migration-sweep pattern).
3. Platform D1 lifecycle: org `active ↔ closing → purging → purged`; property `active → purging → purged` (no property `closing`); retention columns on org; per-table transition + no-delete triggers.
4. Status-gated HTTP dispatch, pending-commands replay, property provisioning — one `assertTenantActive` helper.
5. Guest: sync shred unchanged (200); Workflow from `guest.erased` outbox; rows-gone / VERIFY / certificate.
6. Org: `org:cancel` + `org:purge` (owner-only); admin purge route **only creates** the Workflow; status flips inside the Workflow.
7. R2 / Iceberg steps **always declared** — never silently omitted. Iceberg skipped with reason; R2 skip/reach/retain per §1.1 and [event-log](./2026-08-12-event-log-r2-design.md) (bodies land with that chunk).
8. Deferred module check: entitlement `pms.core` ⇒ `onPurge` absence OK; own entitlement ⇒ `onPurge` required; `--self-test`.
9. `SystemActor.reason` gains `'purge'`.

### 1.3 Scope out

- Iceberg step body (warehouse still absent — `no_iceberg_binding`). R2 event-log body: [event-log R2 design](./2026-08-12-event-log-r2-design.md) (was §7 follow-on; no longer blocked inside this document’s open decisions).
- Module `onPurge` *trigger* (no consumer).
- Backup / PITR coverage (§4.8 Phase 0 caveat stays in `limitations[]`).
- Platform-operator elevation purge (`PLATFORM_ONLY_PERMISSIONS` cannot sit on HTTP routes).
- Vertical extraction from DO monoliths.
- Property-only churn (org cascade only this chunk).

---

## 2. Architecture

### 2.1 Spine

One Cloudflare Workflow binding `PURGE_WORKFLOW` → `PurgeWorkflow` (`WorkflowEntrypoint`), params discriminant `kind: 'guest' | 'org'`.

`run()` dispatches to a **per-kind step plan**. Shared helpers: CERTIFY, skip recording, HALT (append halted certificate then stop), D1 certificate append. **Do not** write one linear sequence with `if (kind === …)` inside each step — the paths diverge in about half the steps.

`run()` is wrapped so **every exit path** — explicit HALT, unhandled throw, retry exhaustion — appends a certificate before terminating (try/catch around the step plan with certify-on-throw). Without the wrapper, “every terminal state leaves evidence” holds only for terminal states someone remembered to enumerate.

### 2.2 Triggers

| Kind | Start | HTTP | Workflow id |
|---|---|---|---|
| `guest` | Event consumer on `guest.erased` (transactional with shred via OrgDO outbox) | `guests.erase` stays **200** `{ erased: true, purgeWorkflowId }` | `purge-guest-${guestRef}` — subject-derived; redelivery = same instance |
| `org` | Admin route **only** `WORKFLOW.create()` — **no D1 status write in the handler** | **202** `{ workflowId }` + confirmation body echoing `orgId` | `purge-org-${orgId}-${attempt}`; see attempt formula below |

**Why 200 for erase and 202 for churn (state both reasons side by side):**

- **200 for erase** — the shred *is* the erasure; cryptographic guarantee already delivered. In this API, **202 means provisional-and-unapplied** (`QUEUE_PROVISIONAL` via `invoke-property-do.ts`). `guests.erase` is `FAIL_CLOSED` specifically so it must not queue during outage. Returning 202 would tell the client the opposite of what happened.
- **202 for churn** — nothing has happened yet; the Workflow is genuinely pending. Same shape as migration-sweep’s `{ workflowId }` response.

**Why not start the guest Workflow from the HTTP handler:** shred is already committed and cannot roll back. Handler-side `create()` that fails leaves irreversible erasure with no certificate path. Outbox makes the trigger as durable as the shred; consumers are idempotent by `event_id`.

**Org attempt scheme:** deterministic-per-attempt so halted runs are re-runnable. Formula (**`kind = 'org'` only** — guest certificates also carry `org_id`, and counting them would inflate `attempt` and let concurrent admin POSTs compute different attempts if a guest cert lands between the two `COUNT(*)` reads, spawning two concurrent org purges):

```sql
SELECT COUNT(*) FROM purge_certificate WHERE org_id = ? AND kind = 'org'
-- attempt = 1 + that count
```

Within an attempt, duplicate create is idempotent. After HALT, an org certificate exists → attempt bumps → fresh id. Guest stays pure subject-id (event redelivery must not spawn a second run; guest retry is not an admin POST).

**Concurrent org POSTs:** both compute the same attempt; one wins; the other sees instance exists → return **202 with the existing `workflowId`** (not 409). Collision only happens while a run is in flight (halted runs already bumped the counter).

**Confirmation body:** echo `orgId` (or typed token). Most destructive endpoint; bare POST is one fat finger from destroying a tenant.

**Permissions:** `org:cancel` and `org:purge` are ordinary grantable permissions, **owner-only** (do not add to `admin`’s explicit list; `owner` picks up all grantables). Not `PLATFORM_ONLY_PERMISSIONS` — those are barred from the HTTP route registry. **`org:cancel` covers both directions** of the reversible pair (`active → closing` and `closing → active`).

**SystemActor:** Workflow steps use `{ kind: 'system', reason: 'purge' }`. Certificate `operator` = the human who requested; actor performing each step = system. Auditors ask about that distinction.

### 2.3 Org lifecycle & retention

**Do not reuse `cancelled`.** `subscription.status` already uses `('active','cancelled')` for **billing**. Tenant lifecycle uses distinct tokens. **Org and property do not share the same transition graph** — properties are never individually cancelled; they inherit churn from the org and go `active → purging` on cascade.

| Table | Allowed transitions |
|---|---|
| `org` | `active ↔ closing`, `closing → purging`, `purging → purged`, `purged → ✗` |
| `property` | `active → purging` (cascade only), `purging → purged`, `purged → ✗` |

| Org transition | Who | Effect |
|---|---|---|
| `active → closing` | Owner via `org:cancel` | Stamps `closing_at`, `purge_not_before = closing_at + ORG_PURGE_RETENTION_MS` (Phase 0 **platform constant**, injectable `now` for tests) |
| `closing → active` | Owner via `org:cancel` (same permission, reverse direction) | Clears retention stamps |
| `closing → purging` | Workflow step 1 only | Only when retention elapsed; trigger backstop |
| `purging → purged` | Workflow after CERTIFY | Terminal |
| `purged → *` | — | **ABORT** |

| Property transition | Who | Effect |
|---|---|---|
| `active → purging` | Workflow step 1 cascade | No `closing` state on property |
| `purging → purged` | Workflow after CERTIFY | Terminal |
| `purged → *` | — | **ABORT** |

Encode each table’s **transition graph** in its own triggers (not only the value set) — copy `subscription_update_invariants` conditional style. Value-set alone would allow `purged → active`, resurrecting a tenant whose certificate says it’s gone. Applying the org graph to `property` would ABORT the cascade at step 1 on the first property.

Also: `org_no_delete` / `property_no_delete` (copy `subscription_no_delete`). Registry rows are **never deleted** — jurisdiction (§4.5) and purge join keys stay. Destructive half is DO `deleteAll()`; recreatable empty DO is acceptable **because every write path refuses non-active status**.

**Cascade:** one org run, one certificate; `subjects[]` lists org + every property under `org_id` (per-property detail lives here). Paging copies migration-sweep cursors. Partial property success is a **failed** purge (§4.8: VERIFY can fail the run; silent partial success forbidden). Certificate `stores[].property_do.deleted` is **summed** across all property DOs in the cascade (one store entry, many objects).

### 2.4 Org step plan

```
0. RETENTION       HALT unless status === 'closing'
                     AND purge_not_before IS NOT NULL
                     AND now >= purge_not_before
                   (three explicit conditions, one clean HALT reason each —
                    do not rely on a downstream constraint abort.
                    Trap is JS-only: after reading the column into JS,
                    `Date.now() >= null` is true. SQL `now >= NULL` is
                    three-valued NULL and fails closed in WHERE — safe;
                    the Workflow step compares in JS.)
1. CLOSE_TRAFFIC   org: closing → purging; each property in snapshot: active → purging
2. SHRED_KEYS      shred remaining keys (idempotent)
3. PURGE_PROPERTY_DO  per property page: deleteAll(); BULK admit; no touchInteractive()
4. PURGE_ORG_DO    deleteAll() OrgDO + OrgEntitlementDO
5. PURGE_R2        when EVENT_LOG_R2 present: prefix-delete event-log segments for
                   snapshotted org + properties; record reached + deleted count.
                   when absent: skip with no_r2_binding (derived). See event-log design.
                   Org D1 purge deletes `pending_command_open` rows for the org’s properties (night-audit PRE_CHECK census; see night-audit E2E spec leftover 11).
6. SKIP_ICEBERG    skipped + no_iceberg_binding (visible in Workflow history)
7. VERIFY          re-derive subjects from D1; any unexpected subject → HALT;
                   zero-row inventory via sqlite_master (see §2.6);
                   if r2 status is reached: list subject prefixes, any object → HALT
8. CERTIFY         append certified certificate; status → 'purged'
```

Admin route creates the Workflow **before** any status flip — if `create()` fails, nothing happened. Status → `'purging'` is **inside** the Workflow (step 1), after retention. That removes the tenant-down-forever partial state (closed with no run).

§4.8’s “chunked” BULK delete is **superseded** for tenant wipe by atomic SQLite `deleteAll()` (removes entire private DB including tables). Constructor remigrates on re-open. LaneGuard: single BULK admission before wipe; **purge RPC must not call `touchInteractive()`** (would starve itself via the 250ms quiet window). Quiet window is respected; with `'purging'` refusing interactive traffic it opens within `DEFAULT_QUIET_MS` and does not stick the Workflow. Do not couple lane admission to registry status.

### 2.5 Guest step plan

```
0. (none)          Erasure request must be honored without retention delay
1. (none)          No tenant status flip
2. SHRED_KEYS      verify-only — already done in tryEraseGuest; confirm shredded
3. PURGE_PROPERTY_DO  reached, deleted: 0 (declared guest-PII column set empty — checked)
4. PURGE_ORG_DO    UPDATE guest SET profile_cipher = x'', profile_iv = x''
                   (columns are BLOB NOT NULL — must not assign NULL)
5. R2 / ICEBERG    R2: when binding present → retained, reason pii_by_reference_event_log
                   (no deleted; event log kept — PII by reference). Current-state only:
                   event log is the only guest-touching R2 this chunk creates; ID-document
                   prefixes (§4.7) will need a mixed/sub-entry status — see event-log §5.3.
                   When absent → skipped no_r2_binding. Iceberg: skipped no_iceberg_binding.
6. VERIFY          key-state only (see §2.6); R2 not scanned when retained, skipped, or pending
7. CERTIFY
```

**PropertyDO “refs only”** is enforced by contract (`audit-writers.ts` excludes guest commands from PropertyDO audit_log). Record as reached-nothing-applicable, not skipped.

**Declared guest-PII column set** on PropertyDO (currently empty, with reasons). Purge step asserts declaration matches reality — same declare → enforce → auto-ratchet shape as the ownership gate. Future `billed_party` / free-text `reason` population forces a decision rather than silent certificate overstatement.

**Do not delete the `guest` row** — `assertGuestRef` / `gateGuestRef` distinguish `GUEST_NOT_FOUND` vs `GUEST_ALREADY_ERASED`; deleting collapses never-un-erase. Keep zeroed `data_key` row (partial unique index `WHERE shredded_at IS NULL` still allows a fresh key for the same subject later).

### 2.6 VERIFY residue (normative)

| Path | Residue = HALT | Explicitly *not* residue |
|---|---|---|
| Both | Subject in registry absent from certificate `subjects[]` (re-derive; do not trust snapshot) | — |
| Guest | `data_key` with `shredded_at IS NULL` **or** `length(wrapped_key) > 0`; or row missing (can't prove shredding) | Remaining ciphertext; `erased_at` tombstone; zeroed `data_key` row; R2 event-log objects (`retained`) |
| Tenant | Any non-zero row count in any table from `SELECT name FROM sqlite_master WHERE type='table'`, minus small allowlist (`schema_version`, and CF internals if visible) | Schema bookkeeping the constructor recreates |
| R2 | **Only if `stores[].r2.status === 'reached'`:** any object under subject event-log prefixes (strong LIST — see event-log design) | `skipped`, `retained`, or `pending` — not scanned |
| Iceberg | not scanned | certificate records skipped + reason |

**Ciphertext is not residue** (§4.8): erasure = key destruction; ciphertext may remain permanently undecodable in every store. Do not “tighten” VERIFY with a ciphertext-absence check.

Inventory is **self-derived** at VERIFY time from `sqlite_master`, not a declared allowlist that drifts.

### 2.7 Control-plane helper

`assertTenantActive(env, { orgId?, propertyId? })` — single implementation used by:

1. HTTP property/org dispatch (`resolvePropertyContext` today 404s only when missing — **must** refuse non-`active`)
2. `pending-commands-consumer` (today bypasses registry entirely)
3. Property provisioning under an org (`handlePostOrgProperties` / `provisionProperty`)
4. Cascade snapshot reads

Any other stub-resolution site that bypasses the registry gets the same helper. Drift = purged tenant accepting writes on one path only.

### 2.8 Module `onPurge` check

As deferred from housekeeping §2.8: derive from `entitlement` — `pms.core` ⇒ absence OK; own entitlement ⇒ `onPurge` required. Script + `--self-test`. Vacuous until add-ons exist; self-test is load-bearing.

---

## 3. Error handling & operational surface

**Structural invariant:** `run()` is wrapped so every exit path appends a certificate before terminating.

| Failure | Behavior |
|---|---|
| Step 0 retention / wrong status / null window | Shared `HALT`: append halted certificate (`outcome: halted`, reason), then stop |
| Residue in VERIFY | Same `HALT` helper |
| Unhandled throw / retry exhaustion | Wrapper catch → halted certificate → terminate (must not rely on platform failing the instance with no D1 write) |
| Concurrent admin POSTs | Return **202** with existing `workflowId` |
| `guest.erased` redelivery | Same `purge-guest-${guestRef}` — no second run |
| Enqueue failure after shred | Outbox/consumer retry; shred already durable |
| Admin `create()` fails | Nothing written — safe retry |

HALT certificates always have `recorded_at`; `certified` only when `outcome: certified`.

---

## 4. Data model (Platform D1)

Additive DDL via `platform-migrations.ts` + `check:ddl` (no table rebuild):

**`org` / `property`:**

- Per-table status transition triggers (§2.3 — graphs differ) + no-delete triggers.
- Org: `closing_at INTEGER NULL`, `purge_not_before INTEGER NULL`.

**`purge_certificate`:**

- `certificate_id TEXT PRIMARY KEY`
- `workflow_id TEXT NOT NULL`
- `kind TEXT NOT NULL` (`guest` | `org`)
- `org_id TEXT` (nullable for safety; set when known — including on guest certs)
- `subject_json TEXT NOT NULL` — refs only (guest: `guestRef`/`piiKeyId`; org: org + `propertyId[]`)
- `stores_json TEXT NOT NULL`
- `limitations_json TEXT NOT NULL`
- `operator_user_id TEXT`
- `outcome TEXT NOT NULL` (`certified` | `halted`)
- `halt_reason TEXT`
- `started INTEGER NOT NULL`
- `recorded_at INTEGER NOT NULL`
- `certified INTEGER` — NULL when halted
- Append-only triggers on UPDATE/DELETE
- Indexes: `(org_id, kind, recorded_at)` (supports org-attempt `COUNT` and authoritative lookup), `(workflow_id)`
- **No `property_id` column (Phase 0 choice):** “certificate for property P” is a `subject_json` scan. Org-scoped lookup via `(org_id, recorded_at)` is the supported path; add a column later if property-level churn ships.

**Constant:** `ORG_PURGE_RETENTION_MS` (Phase 0 platform constant; name it in code; document value in DPA). Retention gate accepts injectable `now` (LaneGuard precedent: `opts?.now ?? (() => Date.now())`) and overridable constant in tests — do not shrink the production constant in test config.

---

## 5. Testing (load-bearing)

1. **`deleteAll` smoke** — after wipe + re-open: schema remigrated; zero user rows; purge RPC did not advance `lastInteractiveAt`.
2. **Guest happy path** — erase → 200 + deterministic id → consumer starts Workflow → blobs `x''` → VERIFY key-state → certificate with PropertyDO `reached, deleted: 0`, R2 `retained, reason: pii_by_reference_event_log` (or `skipped: no_r2_binding` if binding absent), Iceberg skipped + reason, PITR limitation, no PII columns.
3. **Org happy path** — cancel → injectable clock past `purge_not_before` → purge confirm → 202 → `'purging'` inside Workflow → wipe → `PURGE_R2` (or skip if no binding) → VERIFY (incl. empty R2 prefixes when reached) → `'purged'` → certificate; dispatch / replay / provision refuse non-active.
4. **Step-0 HALT** — purge while `active`, or `purge_not_before` null, or `now` early → halted certificate → attempt bumps → retry after fix succeeds (second cert). **`stores_json` is load-bearing:** in-scope stores are `pending` (no `deleted`); iceberg (and R2 if unbound) stay `skipped` + reason. No store may be `reached`. This assertion is what would have caught seeding `reached, deleted: 0` before any work.
5. **VERIFY residue HALT** — inject leftover row → halted cert; status not `'purged'`.
6. **Cascade race** — create property under `closing`/`purging` refused; VERIFY re-derive catches stray subject if gate bypassed in test.
7. **Idempotency** — double erase event; double purge POST while in flight → 202 same id.
8. **Terminal wrapper** — force throw mid-plan → halted certificate row exists (falsifies “every terminal state leaves evidence”).
9. **Module check `--self-test`** — `pms.core` omit OK; synthetic non-core without `onPurge` fails.
10. **Certificate column check** — declared allowlist; no PII-shaped names.
11. **Append-only aborts** — `tryUpdatePurgeCertificate` / `tryDeletePurgeCertificate` catch ABORT → `{ ok: false }` (copy `tryDeleteSubscription` pattern).
12. **Terminal guards** — `trySetOrgStatus` / `trySetPropertyStatus` assert `purged → active` aborts; property `active → closing` aborts (not in property graph).

---

## 6. Acceptance

1. **Every terminal state — certified, halted, or failed — leaves a certificate row.** No run can end without evidence.
2. Guest shred guarantee unchanged; housekeeping + certificate added without changing erase to 202.
3. Tenant churn works end-to-end with status graph + retention gate; admin route never writes `'purging'` itself.
4. No certificate can read a skipped, retained, or pending store as purged. Four distinct claims: `pending` (unattempted), `reached` + optional `deleted`, `skipped` + reason, `retained` + reason (no `deleted`). VERIFY scans only `reached`. Halted `stores_json` must not claim `reached` for steps that never ran. Certified `stores_json` contains no `pending`.
5. `assertTenantActive` covers dispatch, replay, and provisioning.
6. Vacuous `onPurge` entitlement gate ships with `--self-test`.
7. Certificate carries no PII; column check enforces it.

---

## 7. Follow-on (out of this chunk)

~~`PURGE_R2` blocked on missing event log~~ — **specified** in [event-log R2 design](./2026-08-12-event-log-r2-design.md) (Worker writer, key layout, org prefix delete, guest `retained`, §11 divergence for ARI). Remaining warehouse gap: **Iceberg / Pipelines (§4.9)** — still `skipped: no_iceberg_binding` until that chunk.

---

## 8. Implementation sketch (non-normative file map)

| Area | Likely touch |
|---|---|
| Workflow | `apps/pms-core/src/purge-workflow.ts`; `env.ts` + `wrangler.jsonc` binding |
| Registry / D1 | `packages/do-runtime/src/platform-migrations.ts`; `apps/pms-core/src/registry.ts` |
| Status helper | `assertTenantActive` near registry; wire `v1-dispatch`, `pending-commands-consumer`, provision |
| Guest trigger | event consumer on `guest.erased` |
| Org HTTP | cancel + purge routes; `org:cancel` / `org:purge` in `permissions.ts`; route audit |
| DO RPCs | PropertyDO / OrgDO purge entrypoints (BULK, no `touchInteractive`) |
| Contracts | `SystemActor` reason `'purge'`; catalog notes if any |
| Checks | module `onPurge` rule + certificate column allowlist + `--self-test` |
| Tests | `apps/pms-core/test/purge-workflow.spec.ts` (isolatedStorage: false like migration-sweep) |
