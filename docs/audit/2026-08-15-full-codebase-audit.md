# Full codebase audit — remediation plan

**Date:** 2026-08-15
**Scope:** whole monorepo at commit `246ea33` (branch `main`, clean tree) — ~115k lines across 13 packages, 2 apps, 5 modules.
**Method:** eight review passes, each with a different priority lens — general correctness, code quality/consistency, security, business logic, UX, UI, performance, and CI/test reliability.

---

## How to use this document

Each work item has a stable ID (`A1`, `B2`, …). Phases are ordered by dependency, not just severity — **do them in order**. Phase A restores a trustworthy test signal; without it you cannot verify anything else. Phase D introduces the closed error union that Phase F's large refactors depend on for safety.

Every item states:

- **Severity** — `critical` (data/money/security consequence), `high` (user-visible defect or systemic risk), `medium`, `low`.
- **Evidence** — the exact file:line and current code. All references were read directly; none are inferred.
- **Fix** — what to change, and what *not* to change.
- **Verify** — a concrete command or assertion that proves the fix.

### Ground rules for the implementing agent

1. **Do not batch across phases.** Finish and verify a phase before starting the next.
2. **Do not "fix" anything in [§ Do not fix](#do-not-fix--deliberate-decisions).** Those are documented decisions; changing them contradicts a spec.
3. **Run the local suite in shards.** `pnpm test` unsharded segfaults (see `A2`). Use `pnpm test:local` **or** manual shards:
   ```bash
   pnpm test:local
   # or: pnpm --filter @hospai/pms-core exec vitest run --shard=1/8  # … through 8/8
   ```
   Local runner uses **8** shards to match CI (`test-pms-core` matrix). Note: **no `--` before `--shard`** — pnpm forwards a bare `--` and vitest then treats `--shard` as a file filter, silently running the full suite in every shard.
4. **Every change must keep all 14 `check:*` gates green.** They were all passing at audit time.
5. **Do not relax a gate to make a change pass.** If a gate blocks you, the gate is probably right.
6. **Prefer adding a test that fails first**, then fixing. Several items below are latent (not user-reachable yet) — a test is the only proof they're fixed.

### Confidence notes

- Items marked **[verified failing]** were reproduced during the audit.
- Items marked **[latent]** are real defects that are not currently reachable through the SPA or client — they are contract bugs that will bite when the path is wired up. Fix them, but they are not live incidents.
- I did not run this system against real Cloudflare infrastructure. All performance findings are structural counts from reading code, not measurements. `G1` in particular should be measured before and after.

---

## Phase A — Restore a trustworthy signal

**Nothing else in this document can be verified until this phase is done.** Currently the local suite fails to complete on most runs, and when it does complete it can fail for reasons unrelated to your change.

### A1 — Three tests assert absence on a globally shared log channel

**Severity:** high · **[verified failing]**

**Evidence.** Six spec files spy on the global `console`. Three assert that a message did *not* appear. The suite runs `singleWorker` with `isolatedStorage: false`, so every property's 30-second outbox alarm writes to that same console during any capture window.

The correct, scoped pattern already exists — `apps/pms-core/test/observability.spec.ts:339`:

```ts
expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);
```

Three assertions dropped the `property_id` filter:

| File:line | Current assertion |
|---|---|
| `apps/pms-core/test/observability.spec.ts:374` | `capture.lines.some((l) => l.msg === 'outbox.flush')` |
| `apps/pms-core/test/lane-guard.spec.ts:88` | `capture.lines.some((l) => l.msg === 'outbox.flush')` |
| `apps/pms-core/test/reservations-routes.spec.ts:295` | `lines.some((l) => l.msg === 'ari.reject_on_commit')` |

A full local run failed at `lane-guard.spec.ts:88` (`1 failed | 302 passed`); the same file passes 3/3 in isolation.

**Why this is first.** CI shards `pms-core` 8 ways, so whether the interference fires depends on which spec files land in the same shard. That produces *intermittent* red, which trains the team to re-run rather than investigate — the habit that lets real regressions through.

**Fix.** Add the property scope to all three. Each test already has the property name in scope (`name`).

```ts
// lane-guard.spec.ts:88
expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);
```

For `reservations-routes.spec.ts:295`, scope by whatever property identifier that test creates.

**Also consider (optional, prevents recurrence):** a lint rule or a `check:` script rejecting `.some((l) => l.msg === …)` inside a `console` capture without a `property_id`/`org_id` conjunct. The repo already has `check:pms-core-test-dates` guarding a different flake class, so the pattern is established.

**Verify.**
```bash
pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```
All eight green, repeated twice.

---

### A2 — The documented "primary loop" command cannot complete locally

**Severity:** high · **[verified failing]**

**Evidence.** `README.md:11` presents `pnpm test` as `# primary loop`, and `README.md:18` instructs *"CI runs these in order (run them before pushing)"* with `pnpm test` in the table.

It segfaults. Three full-suite attempts during this audit:

| Invocation | Outcome |
|---|---|
| `pnpm test` (turbo, whole monorepo) | Completed — surfaced the `A1` flake |
| `pnpm exec vitest run` in `apps/pms-core` | `*** Received signal #11: Segmentation fault` |
| `pnpm --filter @hospai/pms-core exec vitest run` | Segfault in `reservations.spec.ts`, then `ECONNREFUSED` |

The CI workflow comment states it plainly: *"Unsharded local runs segfault workerd."* The workaround is documented — but only in `docs/superpowers/plans/2026-08-13-exception-queue-workbench.md:34`, a dated per-slice plan file, not where a developer about to push would look.

**Consequence.** The realistic developer loop is *run the file I touched, then push and let CI find the rest.* That lengthens feedback from seconds to a CI cycle and puts full weight on a CI signal that `A1` makes unreliable.

**Fix.** Two parts, both small.

1. Add a sequential-shard script to root `package.json`:
   ```json
   "test:local": "pnpm exec turbo run test --filter=!@hospai/pms-core && node scripts/test-pms-core-shards.mjs"
   ```
   The script runs `vitest run --shard=N/8` for N=1..8 in sequence (`scripts/test-pms-core-shards.mjs`), exits non-zero on the first failure. Keep the "no `--` before `--shard`" note as a comment in the script — it is a real, silent footgun.

2. Update the `README.md` table: replace `pnpm test` with `pnpm test:local` in the "run them before pushing" list, and add one sentence: *"`pnpm test` unsharded segfaults workerd locally; `test:local` shards pms-core 8 ways to match CI. The sold-ledger property spec runs in a separate CI job but is included in local shards."*

**Verify.** `pnpm test:local` completes on a clean tree, twice in a row.

---

## Phase B — Business-logic defects with money or guest impact

These are live or near-live correctness bugs. Phase A must be green first so you can trust the tests you add.

### B1 — Check-out sums the balance across *all* folio windows, breaking direct billing

**Severity:** critical

**Evidence.** `apps/pms-core/src/property-do.ts:9340`, inside `tryCheckOut`:

```sql
SELECT COALESCE(SUM(ledger_amount_minor), 0) AS balance
FROM folio_line WHERE reservation_id = ?
```

No window filter. But `folio_window.kind` is `'GUEST' | 'COMPANY' | 'MASTER'` (`packages/do-runtime/src/property-migrations.ts:649`), and a `COMPANY` window is direct billing — charges routed to a corporate `city_ledger_account` that the employer settles later.

Transferring a COMPANY window to the city ledger inserts a row into `city_ledger_entry` (`property-do.ts:19050`) and **posts no offsetting credit to `folio_line`**. The charge lines remain, with `reservation_id` intact and positive `ledger_amount_minor` — so they keep counting against the guest.

The same `balanceMinor` drives three decisions, all of which misfire for a corporate guest:

| Consequence | Effect |
|---|---|
| `BalanceDueError` thrown | Corporate checkout blocked, every time |
| `folio.balance_due` event emitted when `> 0` | Spurious event to downstream consumers |
| Window auto-close requires `=== 0` | Guest window never closes despite the guest being settled |

**This is a defect, not a policy choice.** Fourteen lines below (`property-do.ts:9354`), the auto-invoice gate scopes correctly:

```ts
const guestWindowId = this.guestFolioWindowId(input.reservationId);
if (!this.hasActiveInvoiceForWindowSync(input.reservationId, guestWindowId)) {
```

Two money gates in the same function disagree about what "the guest owes" means.

**Fix.** Scope the checkout balance to the guest's obligation. A per-window balance query already exists at `property-do.ts:14038` (`WHERE folio_window_id = ?`). Decide explicitly between:

- **(a)** Sum only the GUEST window — simplest, matches the invoice gate ten lines below.
- **(b)** Sum all windows *except* COMPANY windows whose charges have been accepted onto the city ledger — more precise if a COMPANY window can exist without a city-ledger transfer.

Check whether (b)'s case is reachable before choosing. Whichever you pick, apply the same scoping to **all three** consumers of `balanceMinor` — the throw, the event emission, and the auto-close condition. Do not fix only the throw.

**Do not** simply widen the override to paper over this. See `E4` for the client half.

**Verify.** Add a spec: reservation with a GUEST window at zero and a COMPANY window with a positive balance transferred to the city ledger →
- `tryCheckOut` succeeds **without** `overrideBalance`
- no `folio.balance_due` event in the outbox
- the guest window auto-closes when `pms.folio.close_window_on_check_out` is `true`

---

### B2 — `reservations.modify` accepts `ratePlanId` over HTTP and silently ignores it

**Severity:** high · **[latent]**

**Evidence.** `apps/pms-core/src/v1-dispatch.ts:1963` builds `commandPayload` including `ratePlanId`, and includes it in the idempotency fingerprint at `v1-dispatch.ts:1948`. But `tryModifyReservation`'s input type (`property-do.ts:8586`) is:

```ts
input: { reservationId, roomTypeId, arrivalDate, departureDate, adults?, children?, noPost? }
```

No `ratePlanId`. Inside the method, `rate_plan_id` is only ever *read* from the existing reservation and reused when re-snapshotting rate nights (`property-do.ts:8906`). Never written.

Result: `PATCH /v1/properties/:pid/reservations/:rid` with a changed rate plan returns **200 OK with the old rate plan intact** — a silent no-op on a money-affecting field.

Two aggravating factors:

- `ratePlanId` **is** in the fingerprint. Two requests differing only in rate plan hash differently and are treated as distinct commands while doing the same thing; a retry with the same key but a corrected rate plan fails `idempotency_key_reused` for a field with no effect.
- `tryCreateReservation`, `tryConfirm`, and `tryHold` **all** accept `ratePlanId`. Modify is the sole outlier — this reads as an oversight, not a decision.

It escaped the compiler because `commandPayload` is assigned to a `const` before being passed; TypeScript's excess-property check only fires on direct object literals.

**Blast radius today:** `client-core` and the SPA do not send `ratePlanId` on modify. Latent, not live.

**Fix.** Add `ratePlanId?: string` to the input type and honour it: validate via `assertActiveRatePlanSync`, write `rate_plan_id` on the reservation, and pass the *new* plan to `syncReservationRateNightsOnModifySync` at `property-do.ts:8906` instead of `reservation.rate_plan_id`. Confirm the rate-night re-snapshot behaviour you want when the plan changes but dates don't — that is a product decision worth stating in the commit message.

**Systematic check performed:** I parsed all 39 `commandPayload` → `try*` pairs and diffed each against the DO's declared input type. This is the **only** mismatch. No need to re-sweep.

**Verify.** Spec: create a reservation on `rp_bar`, `PATCH` with `ratePlanId: 'rp_corp'` and unchanged dates → reservation's `rate_plan_id` is `rp_corp` and rate nights re-snapshot at the new plan's amounts.

---

### B3 — `noPost` on modify is dead, and would be silently dropped if wired up

**Severity:** medium · **[latent]**

**Evidence.** `tryModifyReservation` declares `noPost?: boolean`, but `applyNoPostIfPresentSync` is called exactly once — `property-do.ts:8900` — which is **after both early-return branches**:

- the full no-op return when room type, dates, adults, and children are all unchanged (~`property-do.ts:8676`)
- the party-size-only branch that updates adults/children and returns (~`property-do.ts:8692`)

A modify carrying only `{ noPost: true }` would return `ok: true` with no audit row, no outbox event, and `no_post` unchanged.

Not reachable today: `handlePatchReservation` never reads `body.noPost`, and the SPA toggles no-post through `updateFrontOffice`. But this is the **same bug class** as the adults-only drop that was already found and fixed in the 2026-08-13 prototype-holes sweep — it will recur the moment someone wires `noPost` into the modify payload, failing on the exact case they'd test first.

**Fix.** Move `applyNoPostIfPresentSync` above the early returns, and include `noPost` in the no-op comparison so a `noPost`-only change is not treated as a no-op. Mirror the existing party-size-only branch, which already does this correctly for adults/children.

**Verify.** Spec: modify with only `noPost: true` → `no_post` flips, an audit row is written, and a `reservation.modified` outbox event is appended.

---

### B4 — Wrong error class for a misconfigured cancel policy

**Severity:** low

**Evidence.** In `penaltyMinor` (`apps/pms-core/src/property-do.ts`), `cancel_penalty_type === 'nights'` with `count < 1` throws `RateMissingError(row.arrival_date)`. The rate is not missing — the policy is invalid. It surfaces at the desk as "rate missing for 2026-08-20."

`normalizeRatePlanPolicy` (`property-do.ts:1043`) validates `nights >= 1` at plan level, so this is currently unreachable defensive code. Fix the error anyway; the branch exists precisely for data that bypassed validation, and the wrong error would send an operator down the wrong path.

**Fix.** Throw a distinct `InvalidCancelPolicyError` (already exists) or a new `CANCEL_POLICY_INVALID` code. Add it to the wire error union in `D1`.

---

## Phase C — Security

### C1 — Degraded-mode replay executes with no attributable operator

**Severity:** critical (compliance/forensics, not exploitation)

**Evidence.** Provisional commands queued during degraded mode replay with a **system actor** (`apps/pms-core/src/pending-commands-consumer.ts:19`), short-circuiting `gatePermission`.

**The bypass itself is deliberate and well-argued** — `docs/superpowers/specs/2026-08-04-degraded-mode-server-design.md:325–335` explicitly rejects passing the user actor and documents the rejected alternative. **Do not change the permission behaviour.**

The problem is the compensating control the decision rests on:

> "The envelope records `actor.userId` for audit." … "**`userId` is the audit anchor.**" — *ibid:162*

That anchor is not persisted anywhere. `ProvisionalCommand.actor.userId` is populated at enqueue (`apps/pms-core/src/invoke-property-do.ts:58`), rides the queue message, and is dropped. Every store that could hold it lacks the column:

| Store | State |
|---|---|
| PropertyDO `audit_log` | records `system:queue_replay` (`property-do.ts:2540`) |
| `provisional_exception` | **no actor column** (`property-migrations.ts:260`) |
| `pending_command_open` (D1) | **no actor column** (`platform-migrations.ts:226`); deleted on ack |
| Structured logs | `degraded.replayed` / `degraded.exception` both omit it |

So for every command replayed after an outage — success *or* failure — "who authorized this?" answers `system:queue_replay`.

**Why it matters.** The outage window is the highest-scrutiny period: writes bypass the DO permission gate, exceptions get hand-resolved, and an incident review will ask exactly this. It's also the one window where the accepted risk (role revoked between admission and replay) becomes unauditable after the fact — you can't even enumerate the affected commands.

**Fix.** Three additive changes; none alter the authorization decision.

1. Add `actor_user_id TEXT` to `provisional_exception` (new migration; regenerate DDL — see verify).
2. Include `actorUserId: provisional.actor.userId` in the `degraded.replayed` and `degraded.exception` log lines (`pending-commands-consumer.ts:106`, `:124`).
3. In `replay-dispatch.ts`, pass the envelope's `userId` through to `appendAuditLogSync` as the **audit** actor while keeping `REPLAY_ACTOR` as the **permission** actor. If that requires threading a second parameter, do it — the distinction between "who is authorized" and "who is accountable" is the point.

**Verify.** `pnpm generate:ddl && pnpm check:ddl` clean. Spec: enqueue a provisional command as `user_alice`, force replay → the resulting `audit_log` row attributes `user_alice`, not `system:queue_replay`; a failing replay writes `actor_user_id = 'user_alice'` on the exception row.

---

### C2 — Front-desk WebSockets never re-authorize, and their stored identity is dead

**Severity:** high

**Evidence.** `handleGetFrontOfficeStream` correctly runs the full dispatch gate (`reservations:read` + `pms.core`) and defensively strips any client-supplied actor header before setting the verified one (`v1-dispatch.ts:5427`). Good.

But once accepted, the socket is authorized for its entire lifetime:

- `broadcastFrontOffice` (`property-do.ts:10690`) filters recipients **only by the attachment's date window**. It never consults identity, membership, permission, entitlement, or the kill switch.
- `FrontOfficeAttachment.userId` is written at accept (`property-do.ts:10630`) and **never read anywhere**. I grepped for every read — there are none. It reads like an access control and enforces nothing.
- `fetch` accepts sockets with **no cap on concurrent connections** per PropertyDO and no maximum lifetime (`property-do.ts:10609`).

Concretely: revoke a clerk's role, remove them from the org, close the tenant, or trip the kill switch — their open socket keeps streaming reservation deltas (guest refs, room assignments, arrival/departure dates, VIP and DND flags). DO hibernation means these persist well beyond a browser session.

**Fix.** Three parts:

1. **Re-check authorization periodically.** On `subscribe` (`property-do.ts:10666`) and on a bounded interval during broadcast, re-resolve the socket's `userId` through the existing permission cache. Close with a policy code on failure. The permission cache makes this cheap — do not add a round trip per frame.
2. **Cap concurrent sockets per property.** Pick a number (e.g. 50) and reject beyond it. §4.2's premise is that the front desk must never stall; unbounded hibernatable sockets against a single-threaded object contradict that.
3. **Use `att.userId` or delete it.** After (1) it becomes load-bearing. Do not leave it written-but-unread.

**Verify.** Spec: open a stream as a member, revoke their role in OrgDO, trigger a broadcast → socket receives no further frames and is closed. Second spec: opening sockets past the cap is rejected.

---

### C3 — The Clerk JWT is echoed back in the WebSocket handshake response

**Severity:** medium

**Evidence.** `apps/pms-core/src/property-do.ts:10641–10642`:

```ts
const protocol = request.headers.get('Sec-WebSocket-Protocol');
if (protocol) headers.set('Sec-WebSocket-Protocol', protocol);
```

In the Clerk path the client offers `hospai.clerk.<JWT>` as the subprotocol — a documented necessity, since browser `WebSocket` cannot set `Authorization`. But echoing the **entire raw header** in the 101 response puts a bearer token in a response header. Response headers are far more likely to be captured by intermediaries, CDN logging, and observability tooling than request headers, and Cloudflare sits in front of this.

It is also not RFC 6455-conformant: the server must select a *single* subprotocol, whereas a client offering `hospai.clerk.TOKEN, foo` gets both echoed.

**Fix.** Echo a fixed constant (`'front-office'`) rather than the offered value. Confirm the browser client accepts it — `apps/web-pms/src/screens/FrontOfficeLive.tsx` sets the subprotocol; the response subprotocol must match one the client offered, so you may need the client to offer `['hospai.clerk.<token>', 'front-office']` and the server to select `'front-office'`.

**Verify.** Spec asserting the 101 response's `Sec-WebSocket-Protocol` contains no `.` -separated JWT segment. Manual check that the live board still connects.

---

### C4 — `reconcileHorizonForTest` is the only ungated test method

**Severity:** low (defense-in-depth)

**Evidence.** I audited all 54 `*ForTest` methods across the three DOs. 53 gate on `assertUnsafeLocal` (`org-entitlement-do.ts:69` uses an equivalent inline check). `property-do.ts:2888` does not — and it mutates `availability_day` while deliberately bypassing `night_audit_run` / ARI / outbox, so a call would leave the projection silently diverged from the DO.

Not externally reachable: absent from `V1_ROUTES`, callable only over DO RPC from the Worker.

**Fix.** Add `this.assertUnsafeLocal('reconcileHorizonForTest');` as the first statement.

**Verify.** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts` still green (bindings set `HOSPAI_UNSAFE_LOCAL=1`).

---

### C5 — Blind-index key is global, not per-org

**Severity:** medium · **needs a migration + backfill — schedule as its own slice**

**Evidence.** `apps/pms-core/src/org-do.ts:263` derives the key from `HOSPAI_ORG_MASTER_KEY` via HKDF with a constant `info` and empty salt. `packages/crypto-shredding/src/blind-index.ts:65` hashes only `kind ‖ 0x1F ‖ value`. No `orgId` is mixed in.

Consequence: `jane@example.com` produces a byte-identical `index_hash` in **every** org's `guest_blind_index` table. Anywhere two orgs' rows meet — warehouse, backups, a support export, DO PITR — hash equality reveals shared guests across tenants without decrypting anything. §4.8's "Separate key scopes" rule and §2's structural-isolation stance both point the other way.

**Fix.** Mix `orgId` into the HKDF `info` (e.g. `hospai.guest-blind-index.v2:${orgId}`) in `importBlindIndexKeyHex`, threading `orgId` from `OrgDO.blindIndexKey()`. This invalidates every existing `guest_blind_index` row, so:

1. Bump the info string to `v2`.
2. Add a backfill that recomputes `guest_blind_index` for all non-erased guests — `ensureGuestBlindIndex` (`org-do.ts:322`) already does chunked repair for missing rows and is the natural place to extend.
3. Run the backfill in the `BACKGROUND` lane with a cursor; do not rebuild every guest in one transaction.

**Do not** ship the key change without the backfill — guest search silently returns nothing until rows are recomputed.

**Verify.** Spec: same email in two orgs produces **different** `index_hash` values. Second spec: after backfill, guest search by email/name/phone still resolves in both orgs.

---

## Phase D — Close the error channel (foundation for Phase F)

`D1` is the highest-leverage change in this document. It converts three separate convention problems into compiler errors and makes Phase F's large refactors safe. **Do it before Phase F.**

### D1 — The error channel is untyped

**Severity:** high

**Evidence.** `packages/contracts/src/idempotency.ts` defines **117** error-code constants. Every `try*` method declares a careful per-command error union — then **78 signatures across all 72 `try*` methods** end with:

```ts
| { ok: false; error: string }
```

That catch-all collapses the union to `string` for narrowing. Four consequences, all present in the code:

**(a) Constants and literals mixed in one expression** — `v1-dispatch.ts:419`:
```ts
if (error === FORBIDDEN || error === 'scope_mismatch') return 403;
if (error === 'not_member') return 404;
if (error === 'org_id_unset') return 500;
```
`org_id_unset` is the most-repeated code in the DO (72 literal occurrences) and has no constant at all.

**(b) The same code produces two different statuses.** `not_member` → `404 not_found` in 58 places (plus 3 mappers), and → `500 internal_error` in 9: `handlePostRoomTypes`, `handlePutRoomType`, `handleDeleteRoomType`, `handleDeleteRoom`, and the four night-audit / provisional-exception handlers. No principle separates them. Both are defensible in isolation (the 500 argues "`requirePermission` already cleared membership, so a DO disagreeing is internal inconsistency") — but only one can be right, and nothing records which.

**(c) An English sentence used as a wire error code** — `property-do.ts:5093`:
```ts
return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
```
matched at `v1-dispatch.ts:437` with `error.startsWith('Only DOMAIN config')`. Rewording that message silently flips the status from 400 to 422. It also ships internal class names to clients and is the only non-snake_case code in the API.

**(d) The six status mappers take `error: string`** and cannot be exhaustive. Unmatched codes fall to `return 422` — so a *new* internal-invariant failure (the `org_id_unset` class, explicitly special-cased to 500) would reach clients as 422 Unprocessable Entity, blaming the caller for a server bug.

**Fix — in this order:**

1. **Define a closed `CommandError` union in `packages/contracts`.** Collect the 117 constants plus the currently-literal codes (`org_id_unset`, `scope_mismatch`, `not_member`, `validation_error`, `invalid_stay_range`, `psp_adapter_failed`, …). Add constants for every literal; no bare strings.
2. **Replace `| { ok: false; error: string }`** on all 78 signatures with `| { ok: false; error: CommandError }`. Expect a large compile-error surface — that surface *is* the audit.
3. **Replace the English-sentence code (c)** with `CONFIG_CLASS_NOT_DOMAIN` and carry the class as a separate field. Update `mapConfigErrorStatus` to match the constant, not a prefix.
4. **Decide `not_member` once.** Recommendation: **404** everywhere, matching the 58-site majority and `requirePermission`'s own behaviour (`auth.ts:115`). Record the decision in a comment.
5. **Type the six mappers** `(error: CommandError) => number` with an exhaustive `switch` and a `never` default. Adding a code without a status mapping becomes a compile error.

**Verify.** `pnpm typecheck` and `pnpm build` clean. `pnpm check:forbidden-bodies` and `check:degraded` still green. Add a compile-time test (alongside `packages/do-runtime/src/idempotency.compile-time.ts`, which uses this pattern) asserting a bogus code is rejected.

---

## Phase E — User-facing behaviour

### E1 — Every screen-specific error message is written, passed, then discarded

**Severity:** high

**Evidence.** `apps/web-pms/src/copy/classified-user-message.ts:22`:

```ts
export function classifiedUserMessage(
  classified: ClassifiedResponse,
  _context: { fallback?: string; knownCode?: string | null },
): string {
```

`_context` is underscore-prefixed — **unused**. Eight call sites pass hand-written fallbacks and none reach the user:

| Call site | Intended | Actually shown |
|---|---|---|
| `CheckInScreen.tsx:81` | "Assign failed" | "Something went wrong — try again or ask a manager." |
| `CheckInScreen.tsx:112` | "Check-in failed" | same |
| `ShiftStrip.tsx:69` | "Open shift failed" | same |
| `ShiftScreen.tsx:81`, `:177` | "Close shift failed" / "Could not load shift" | same |
| `BookingScreen.tsx:496` | "Booking failed" + `knownCode` | same |
| `use-folio-action-mutation.ts:31` | caller's `fallback` | same |

The underlying principle is right and tested — `classified-user-message.test.ts` asserts raw class tokens like `fail_closed` never reach the user. But the implementation overshot and discards the human copy too, and **the tests now codify the discard** (`fallback: 'Open shift failed'` → asserts "Something went wrong").

**Fix.** Use the parameter: when `classified.class` has no mapped message and no `knownCode` match, return `context.fallback ?? UNKNOWN_MESSAGE`. Update the two tests that currently assert the fallback is ignored — they should assert the fallback *is* used while still asserting the raw token never appears.

**Verify.** `pnpm --filter @hospai/web-pms test`. Updated tests assert `classifiedUserMessage(classified({class:'client_error'}), {fallback:'Open shift failed'})` returns "Open shift failed" and does not contain `client_error`.

---

### E2 — The front desk's most common failures all say "try again", and none are retryable

**Severity:** high

**Evidence.** The booking wizard is well covered — 25 domain codes get specific copy (`no_availability`, `restriction_violated`, `occupancy_exceeded`, `unbookable`, `rate_missing`, …). That effort didn't reach check-in / check-out / assign:

| Code | Currently shown | Needs to say |
|---|---|---|
| `balance_due` | "Something went wrong — try again" | Guest owes money; show the amount |
| `room_already_assigned` | same | That room is taken — pick another |
| `room_out_of_order` | same | Room is OOO — pick another |
| `room_type_mismatch` | same | Wrong room type for this booking |
| `hold_expired` / `inquiry_expired` | same | The hold lapsed — rebook |
| `invoice_required` | same | Generate the invoice first |
| `not_modifiable` | same | Too late in the lifecycle to edit |

The unifying problem is not vagueness — it is that the generic copy ends in **"try again"**, and not one of these is transient. Retrying `balance_due` or `room_out_of_order` fails identically, forever.

**Fix.** Extend `CLASS_MESSAGES` in `classified-user-message.ts` with a domain-code map keyed off `bodyErrorCode(classified.body)`, checked before the class map. Depends on `E1` (so `knownCode` is honoured). For `balance_due` and `no_availability`, surface the payload detail (amount, date) — the server already returns both.

Follow the model already in `CheckInScreen.tsx:99`: `room_not_ready` doesn't just error, it sets `showOverride` and reveals the recovery affordance. Prefer that shape where a remedy exists in-screen.

**Verify.** A spec per code asserting the rendered message names the cause and does not contain "try again".

---

### E3 — Check-in and the shift strip give no accessible feedback

**Severity:** high

**Evidence.** `Field` (`packages/ui-kit/src/Field.tsx`) is textbook — `useId`, correct `htmlFor`, composed `aria-describedby`, `aria-invalid`, `role="alert"` on the error. `Alert` also carries `role="alert"`.

But the async status channel bypasses them in exactly two of eleven screens:

- **9 announce correctly** via `<Alert>` (Folio, Booking, Rates, Settings, Staff, Inventory, Shift, CityLedger, front-office-editor)
- `apps/web-pms/src/screens/CheckInScreen.tsx:205` — `<p>{message}</p>`
- `apps/web-pms/src/shell/ShiftStrip.tsx:146` and `:165` — `<p className="muted">{message}</p>`

No `role`, no `aria-live`. "Checked in", "Room assigned", and every check-in failure are silent to a screen reader. These are the two worst places for it: check-in is the highest-traffic screen, and `ShiftStrip` is in the shell, so it's the shift feedback on *every* page.

**Fix.** Replace the bare `<p>` with `<Alert>` in all three locations.

**Verify.** `getByRole('alert')` finds the message in existing CheckInScreen and ShiftStrip tests.

---

### E4 — The checkout override prompt fires on credit balances

**Severity:** medium

**Evidence.** `apps/web-pms/src/screens/FolioScreen.tsx:654`:

```ts
const overrideBalance = typeof balanceMinor === 'number' && balanceMinor !== 0;
```

The server only blocks when `balanceMinor > 0` (`property-do.ts:9349`). So a guest who **overpaid** gets an alarming modal reading *"Depart with open balance -$50.00?"* for a checkout the server would allow silently.

The confirm copy itself is well written — it names the exact amount and states the consequence. Keep that pattern.

**Fix.** Change `!== 0` to `> 0`. Add distinct copy for a credit balance (refund due) that does **not** use the word "balance override".

**Note the interaction with `B1`:** until `B1` lands, direct-bill guests also trip this modal with a balance they don't owe. The cumulative effect is behavioural — staff learn the balance warning is usually wrong and click through it, which is the wrong reflex for the one case where it's real. `B1` and `E4` should ship together.

**Verify.** Spec: negative `balanceMinor` → no confirm dialog, checkout proceeds. Positive → existing confirm unchanged.

---

### E5 — The degraded-mode queue says *that* something is pending, not *what*

**Severity:** medium

**Evidence.** `apps/web-pms/src/copy/queued-command-line.ts`:

```ts
return `Queued action · ${date}`;
```

`QueuedCommandEntry` carries `commandId` and `reservationId` (`packages/client-core/src/queued-commands.ts:1`) — both discarded. A clerk who queued a check-in, a payment, and a folio post during an outage sees three identical rows.

Degraded mode is exactly when the user most needs to know what's outstanding — the difference between "the payment went through" and "I need to take it again."

**Fix.** Render a human label from `commandId` (a small map: `reservations.check_in` → "Check-in", `folio.add_item` → "Folio charge", …) and append the reservation reference when present.

**Verify.** Update `queued-command-line.test.ts` to assert distinct lines for distinct `commandId`s.

---

## Phase F — Performance

`G`-series items are structural counts, not measurements. **Measure `F1` before and after** — instrument the dispatch path with timing and confirm the round-trip reduction.

### F1 — Every property-scoped request runs the same D1 lookup four times, sequentially

**Severity:** high

**Evidence.** Tracing one property command end to end:

| # | Call | Source | Query |
|---|---|---|---|
| 1 | `getProperty` | `resolveTenant` (`v1-dispatch.ts:591`) | `SELECT * FROM property WHERE property_id = ?` |
| 2 | `getProperty` | `resolvePropertyContext` | **identical** |
| 3 | `getProperty` | `assertTenantActive` (`registry.ts:103`) | **identical** |
| 4 | `getOrg` | `assertTenantActive` | `SELECT … FROM org WHERE org_id = ?` |
| 5 | `getProperty` | `resolvePropertyFromRegistry` (`provision.ts:140`) | **identical** |

Four byte-identical property reads and one org read, each a network round trip from the Worker to D1, all strictly sequential — before the PropertyDO is contacted. There is **no caching on the registry path**; I checked `registry.ts` and `provision.ts` for any KV or in-memory layer and found none.

§4.3 prescribes the mitigation by name — *"hot, cacheable reads (**permissions, property registry**, org settings) are projected to KV, version-keyed exactly like entitlement snapshots (§6.3)."* The entitlement plane does this. The registry does not.

**Fix — start with the cheap one.** `resolveTenant` already has the full `PropertyRecord` at step 1 and discards everything but `{orgId, propertyId}`. Thread it through:

1. Change `ResolvedTenant` to carry the `PropertyRecord`.
2. Pass it into `resolvePropertyContext`, which passes it to `assertTenantActive` (add an optional pre-fetched-property parameter) and to `resolvePropertyFromRegistry`.

That removes three round trips with no new infrastructure. The KV projection is a larger follow-up; do not start there.

**Verify.** Instrument `PLATFORM_DB.prepare` call count per request in a spec, assert it drops from 5 to 2 (property + org). Then measure wall-clock latency on a representative route before/after.

---

### F2 — The pre-handler chain is sequential where it needn't be

**Severity:** medium

**Evidence.** `dispatchV1` (`v1-dispatch.ts:8508`) awaits five things in strict order: `resolveActor` → `checkKillSwitch` (KV) → `resolveTenant` (D1) → `requirePermission` (OrgDO RPC) → `gateEntitlement` (KV).

Two are needlessly serialized:

- `checkKillSwitch` depends only on the route's feature key, computed from `entitlementForRoute(route)` before any tenant resolution — it can start in parallel with `resolveActor`.
- `requirePermission` and `gateEntitlement` both depend only on `tenant.orgId`, not on each other — a natural `Promise.all`.

**Fix.** Kick off the kill-switch check eagerly and `await` it at the existing decision point. Wrap permission + entitlement in `Promise.all`. **Preserve the response precedence** — if both fail, return the same status the sequential version would have (permission denial before entitlement). Add a test for that precedence; it is easy to get wrong.

**Verify.** Existing dispatch specs green; new spec asserting a request failing both permission and entitlement returns the permission response.

---

### F3 — ~70 of 89 client queries have no `staleTime`, with window-focus refetch on

**Severity:** medium

**Evidence.** `apps/web-pms/src/App.tsx:31` sets `defaultOptions` for `retry` and `retryDelay` but **no `staleTime`**. React Query defaults to `staleTime: 0` and `refetchOnWindowFocus: true`. Counting: **89 `useQuery` call sites, 19 with `staleTime`.**

Front-desk staff move constantly between the PMS, email, a channel manager, and the phone. Every tab-back fires a refetch burst across all mounted queries — each paying the full five-D1-query pipeline from `F1`. The findings multiply.

The team already solved this in one place: `StaffScreen.tsx:132,140` sets `refetchOnWindowFocus: false`, with `StaffScreen.test.tsx:317` asserting single-fetch. It didn't generalize.

**Fix.** Add `staleTime: 60_000` to the `QueryClient` `defaultOptions.queries` — the value all 17 explicit sites already chose. Consider `refetchOnWindowFocus: false` globally, but check per-screen: the board and arrivals lists may genuinely want focus refresh. If so, opt those in explicitly rather than defaulting everything on.

**Verify.** `pnpm --filter @hospai/web-pms test` green. Spec asserting a mounted query does not refetch on a simulated focus event.

---

### F4 — Cold-path horizon reconcile is O(types × 365) with a per-date subquery and no yield

**Severity:** medium

**Evidence.** `reconcileHorizon` (`property-do.ts:1377`) is a good set-reconcile — one query per room type for existing dates, work only on missing ones. Steady state (night audit adds one date) is ~3 queries per room type. Fine.

The cold path differs. On first provisioning every date is missing, and the inner loop runs a `COUNT(*)` join against `room_ooo` **per room type per date**: 20 types × 365 dates × 2 queries ≈ **14,600 queries** in one uninterrupted transaction on a single-threaded object, with no cursor and no yield. §4.2 requires `BULK` methods to take and return a cursor precisely to prevent this; `reconcileHorizon` isn't classified `BULK`, so the rule never applied.

**Fix.** Hoist the OOO count to one grouped query per room type over the whole date range, into a `Map<stayDate, count>`. That removes ~7,300 queries. Only if it is reachable outside provisioning, add a cursor and classify it `BULK`.

**Verify.** Existing `night-audit.spec.ts` horizon tests green. New spec: provisioning a property with 20 room types completes and `insertedCount` matches `20 × HORIZON_DAYS`.

---

## Phase G — Structural cleanup (large mechanical diffs — after Phase D)

These touch many files. **Do them after `D1`**, so the compiler is checking error handling while you move it.

### G1 — Seven route guards, one concept

**Severity:** medium

**Evidence.** `apps/web-pms/src/screens/*Route.tsx` — 317 lines across 7 files. `RatesRoute.tsx` and `InventoryRoute.tsx` are **byte-identical** after renaming. The others differ only in permission string, redirect target, and render target. Each repeats the `data: meQuery.data as PropertyMe | undefined` cast.

They also split into two composition models with no rule: Rates / Inventory / Settings render `<Outlet/>`; Book / NightAudit / Roster / Staff render `<XScreen/>` directly.

**Fix.** One `<PermissionRoute permission={...} fallback="/arrivals">` component rendering `<Outlet/>`. Convert the four direct-render routes to nested routes in `App.tsx`. Collapses ~317 lines to ~50.

**Preserve** the deliberate fail-open on `authority.kind === 'unknown'` — `apps/web-pms/src/auth/me.ts:21` documents it as intentional with the server as the real gate. Do not "fix" it.

**Also:** `HousekeepingScreen` has no route guard and computes permissions from a possibly-`undefined` `me`, causing a read-only→editable flicker. Give it the same guard.

**Verify.** All existing route-guard specs green; deep-linking without the permission still redirects.

---

### G2 — The `invokePropertyDo` preamble appears 61 times

**Severity:** low

**Evidence.** The same six-line argument block (`orgId` / `propertyId` / `timeZone` / `actorUserId` / `idempotencyKey` / `requestFingerprint`) is hand-assembled in 61 handlers, all reading from the same `resolvedCtx` and `ctx`.

**Fix.** A `commandEnvelope(ctx, resolvedCtx, { commandId, routeId, idempotencyKey, fingerprint, commandPayload })` builder. Mechanical; do it in reviewable batches by domain (reservations, folio, rates, …), not one commit.

---

### G3 — The error-tail ladder is hand-rolled ~15 times next to an extracted helper

**Severity:** low

**Evidence.** `rosterWriteErrorResponse` (`v1-dispatch.ts:1483`) is a clean 5-line helper used 5 times. The identical ladder (`not_member` → 404, `FORBIDDEN || scope_mismatch` → 403, else `map…Status`) is written inline in at least 15 other handlers. `mapGuestCommandErrorStatus` and `mapRosterCommandErrorStatus` are structurally identical apart from three lines.

**Fix.** After `D1`, generalize `rosterWriteErrorResponse` into `commandErrorResponse(err: CommandError, permission: Permission)` and adopt it. Merge the two near-identical mappers.

---

### G4 — Route-audit drift check couples two 144-entry lists by array position

**Severity:** medium

**Evidence.** `scripts/permissions-check.mjs:80` compares `parsedRoutes[i]` to `V1_HTTP_ROUTE_AUDIT[i]` — matched by **index**, not `id`. Reordering one file without the other cascades confusing mismatches; if two adjacent routes share scope/permission/commandId/entitlement, a swap passes silently.

Also: `routeId` is typed `string` (`invoke-property-do.ts:17`) and never validated against `audit.id`. It flows into `ProvisionalCommand.routeId` for degraded replay, where a typo surfaces only at replay time. I cross-checked all 70 distinct `routeId` literals against the 144 audit ids — **all currently match**, so this is a latent gap, not a live bug.

The parser is regex-over-source and fails closed on any brace in a route literal (its own comment flags `{2,}` quantifiers).

**Fix.** Add `id` to each `V1_ROUTES` entry, key the comparison on it, and derive a `RouteId` union type from `V1_HTTP_ROUTE_AUDIT` for `invoke-property-do`'s `routeId` parameter. All three weaknesses close at once.

**Verify.** `pnpm check:permissions` green; deliberately reorder two routes in one file and confirm the check reports a clear per-id mismatch.

---

### G5 — UI system residue outside the gates

**Severity:** medium

**Evidence.** §16.4 (decided 2026-08-14) states appearance is platform-owned via tokens + ui-kit, not per-screen CSS. Two duplicates remain, and the gates cannot see them:

- **`.panel` is byte-identical to `.ui-card`** — `apps/web-pms/src/styles.css:199` vs `packages/ui-kit/src/styles.css:171`, same four declarations, same tokens. 13 `className="panel"` usages vs 44 `<Card>`.
- **`.badge` duplicates `.ui-badge`**, used raw at `TapeChartScreen.tsx:280` and `:343` (2 sites) vs 12 `<Badge>` elsewhere.

**Root cause:** both `no-raw-controls-in-web-pms.ts:15` and `ui-kit-adoption-check.mjs:17` forbid the same ten intrinsics — `button input select textarea table th td tr thead tbody`. `Card`/`Badge`/`Alert`/`Separator` render as `div`/`span`/`hr` and are invisible to a tag-based rule. The ratchet reads **0** while this drifts.

**Fix.**
1. Extend `ui-kit-adoption-check.mjs` to also count `className="panel"` and `className="badge"` string literals; set the new baseline at the current count, then ratchet down.
2. Replace the 13 `panel` usages with `<Card>` and the 2 badge spans with `<Badge>`.
3. Delete `.panel` and `.badge` from `apps/web-pms/src/styles.css`.

**Also in the same file:** `.side-panels` is declared twice at top level (`styles.css:165` and `:421`), the second setting `border-bottom: none` to cancel the first. Merge them. (I parsed at brace depth 0 — this is the *only* true duplicate selector in the 606-line file.)

**Verify.** `pnpm check:ui-kit-adoption` green at the new baseline; `pnpm check:web-pms-colors` green; `pnpm --filter @hospai/web-pms test` green.

---

## Phase H — Test, deployment, and documentation infrastructure

### H1 — Nothing verifies the Worker runs outside miniflare

**Severity:** high

**Evidence.** CI has **no deploy, staging, or smoke step**, and `apps/pms-core/wrangler.jsonc` has no `env` blocks. Every check runs under `vitest-pool-workers`.

One gap is sharp enough to name: **DO jurisdiction is never exercised on its production path.** `packages/tenant-router/src/index.ts:119` branches three ways — `ns.jurisdiction()` succeeds, throws "not implemented" with simulate on, or throws and fails closed. Local workerd *always* throws, so the branch that runs in production (`scoped = ns.jurisdiction(j)` succeeding) executes **nowhere in the suite**. This is code §2 calls "the most security-critical code in the system."

**Fix.**
1. Add `- run: pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run` to the `checks` job. Near-zero cost; catches config and binding errors.
2. Add a `staging` env to `wrangler.jsonc` and a deploy-on-`main` job with a smoke test (provision → book → check-in → check-out against real bindings).
3. Until (2) exists, add a unit test for `resolvePropertyStub` with a **mock namespace whose `jurisdiction()` succeeds**, covering the production branch.

**Verify.** Dry-run passes in CI; the new tenant-router test covers the success branch.

---

### H2 — No coverage measurement

**Severity:** medium

**Evidence.** No `@vitest/coverage-v8`, no coverage config, no CI step. `pnpm test` reports pass/fail only.

The concrete cost surfaced during this audit: I tried to answer "does every DO command have a test?" statically and **got the wrong answer**. Twelve `try*` methods appear untested by name, but `tryStartNightAudit` *is* exercised via `nightAuditUrl(propertyId, '/run')` — a URL-builder helper that defeats string matching. Untested code is currently indistinguishable from tested code at review time.

**Fix.** Add `@vitest/coverage-v8` and a coverage run to the non-sharded job (`turbo run test --filter=!@hospai/pms-core`) first; merging 8 shard reports for pms-core is a follow-up. **Do not set a threshold** — the number invites gaming. The report is the deliverable.

---

### H3 — The ledger property test omits the paths §7.1 flags as highest-risk

**Severity:** medium

**Evidence.** `apps/pms-core/test/reservations-ledger.property.spec.ts` is well-built: deterministic `mulberry32`, a `LEDGER_PROP_SEED` override for reproducing failures, and it asserts the §7.1 invariant directly (`sold === countSoldHoldingReservationsCovering`). It gets its own CI job.

Two limits:

- **Five fixed seeds is five randomized test cases**, not property-based testing — no shrinking, no broad state-space exploration.
- **It exercises only** `tryCreateReservation`, `tryCancelReservation`, `tryModifyReservation`, `tryCheckIn`. Not exercised: `tryConfirm` and `tryHold` (both commit inventory via `commitSoldNightsSync`), the no-show full-release path, OOO/`blocked` interaction, and **virtual room types**.

§7.1 names virtual types as *the* oversell mechanism — "two types selling the same bed, each believing it has stock" — and designates property-based tests as the structural enforcement. Virtual types do have six example-based specs, so they aren't untested; what's missing is randomized interleaving on the construct the architecture says is most likely to drift.

**Fix.** Add `tryConfirm`, `tryHold`, no-show, and OOO to the operation mix. Add a second property test with a virtual room type over two physical constituents, asserting the invariant on the **physical** rows. Raise the seed count (20+) now that operations are cheap, keeping the `LEDGER_PROP_SEED` override.

**Verify.** New property test fails if you deliberately break virtual allocation (e.g. decrement only one constituent).

---

### H4 — Documentation reconciliation

**Severity:** low — **docs only, change no code**

Three places where the docs assert something the code does not do:

1. **`ARCHITECTURE.md:1715` (§10.1)** states *"Retention is 7 days — … swept in the `BULK` lane."* No such sweep exists — `DELETE FROM idempotency` appears nowhere. Nor is there one for `outbox` (rows are marked `acked = 1`, never removed) or `audit_log`. The gap is **correctly recorded as deferred** in `docs/superpowers/specs/2026-07-28-queues-consumer-design.md:92`, and the dependent constraint is honoured (`DEDUPE_TTL_SEC = 30 days ≥ retention`, `event-consumer.ts:10`). Reword §10.1 to describe the *intended* policy as not-yet-implemented, so the 10 GB sizing argument at `ARCHITECTURE.md:334` isn't read as covering tables that only grow. §4.1's "Archival rule" has the same character.

2. **§16.4 says nothing about viewport strategy.** There are **zero width breakpoints** in the product — four `@media` queries total (`prefers-reduced-motion`, `screen`, `print` ×2). `.app-shell` is flex with a `16rem`, `flex-shrink: 0` sticky sidebar and no collapse path. Desktop-only is reasonable for a desk terminal, but "does this need to work on a tablet?" is an unscheduled open question of exactly the kind §16.4 exists to close — and the housekeeping board (attendants working rooms) is the surface most likely to force it. Add one sentence recording the decision either way.

3. **`README.md`** — see `A2`.

---

## Do not fix — deliberate decisions

Changing these contradicts a written spec. Listed so an agent does not "helpfully" undo them.

| Thing | Why it stays | Reference |
|---|---|---|
| Degraded replay uses a system actor and skips `gatePermission` | Deliberate; v3's user-actor proposal was rejected with reasoning, and the alternative is documented for later | `docs/superpowers/specs/2026-08-04-degraded-mode-server-design.md:325–335` — fix only the *attribution* (`C1`) |
| No rate limiting anywhere | Planned as an entitlement (`api.rate_limit_rpm`) enforced **at the edge**, Phase 3 | `ARCHITECTURE.md:1657`, `:140` — but `C2`'s socket cap still belongs in the DO |
| SPA password gate is client-side only, password in the bundle | Explicit non-goal: "making the password-gate a security boundary"; "not production auth" | `docs/superpowers/specs/2026-08-13-sign-in-clerk-design.md:87`, `:114` — just never deploy that build publicly |
| No idempotency / outbox / audit-log retention sweep | Recorded as deferred with the dependent TTL constraint honoured | `docs/superpowers/specs/2026-07-28-queues-consumer-design.md:92` — docs fix only (`H4`) |
| `client-core` `"test"` tsconfig include | Deliberately deferred | — |
| Route-guard fail-open on `authority.kind === 'unknown'` | Documented intentional fail-open; server is the real gate | `apps/web-pms/src/auth/me.ts:21` |
| `held` column always 0 | Reserved schema for Phase 3 central reservations; adding later is a fleet-wide migration | `ARCHITECTURE.md` §7.1 |
| No code splitting in `web-pms` | Defensible: 19 screens, unusually lean deps (no chart/icon/motion/date libraries), terminal loaded once per shift | Note as a decision, don't change |

---

## Verified correct — do not "fix" these either

Probed during the audit and found sound. Listed to save re-investigation.

- **SQL injection: no exposure.** All 13 interpolated `exec()` templates are generated `?` placeholder lists, static constants (`activeOnly`, `frontDeskSelect`), or `WHERE` clauses assembled from hardcoded fragments with every value bound. The two dynamic table names (`org-do.ts:612`, `org-entitlement-do.ts:60`) come from `sqlite_master` and are guarded by `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- **Permission enforcement is genuine defense-in-depth.** All **72** `try*` methods call `gatePermission` — verified programmatically, zero exceptions. `gatePermission` fails closed on every branch (`property-do.ts:1747`).
- **The `system` actor is unreachable from HTTP** — constructed only in the queue consumer and DO-internal paths.
- **Tenant resolution is correct by construction.** `resolveTenant` derives `orgId` from the D1 registry off `propertyId`; it never accepts a caller-supplied pairing.
- **No PII in logs; events carry references only.** Verified across every `logInfo`/`logWarn`/`logError` call and every outbox payload.
- **Staff compensation is correctly gated** by a separate `roster:compensation` permission on both read and write (`roster-http.ts:36–74`), per §4.8.
- **Money math is sound** — BigInt, integer minor units, no floats, half-away-from-zero so reversals foot.
- **Validate-then-mutate is honoured** exactly as §7.1 requires in `commitSoldNightsSync` / `releaseSoldNightsSync`.
- **Erasure is complete** — shred key → clear blind index → zero blobs → re-verify → certify, halting on residue.
- **Occupancy holes from the 2026-08-13 sweep are closed** — all five paths (create/confirm/hold/modify/check-in) assert, and the party-size-only no-op was fixed.
- **Night-audit date semantics are right** — `arrival_date <= businessDate AND departure_date > businessDate`; deterministic folio line ids make re-runs idempotent; tax is stamped.
- **No-show full release preserves the §7.1 invariant** (`no_show` is excluded from the counted statuses).
- **`ui-kit`'s closed API holds** — zero `className` / `style` / `...rest` leakage across all components.
- **The colour gate enforces WCAG AA 4.5:1** across nine chrome/action pairs plus every `--status-*-fg`.
- **Front-desk reads are not N+1** — `readFrontOfficeTape` 3 queries, `listArrivals` and `readFrontOfficeSummary` 1 each.
- **The check scripts have their own self-tests** — 8 `--self-test` invocations in CI.
- **Nine migration tests run real SQLite.**

---

## Appendix — verification commands

Run after every phase:

```bash
pnpm build
pnpm typecheck
pnpm lint
```

All fourteen invariant gates (all green at audit time):

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:module-manifests
pnpm check:purge
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
```

Tests — **sharded** (no `--` before `--shard`):

```bash
pnpm test:local
# or manually:
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

After any change to `packages/do-runtime` migrations:

```bash
pnpm generate:ddl && pnpm check:ddl
```

---

## Item index

| ID | Severity | Title |
|---|---|---|
| A1 | high | Unscoped absence assertions on global console |
| A2 | high | `pnpm test` segfaults locally; primary loop undocumented |
| B1 | critical | Check-out balance ignores folio windows (direct billing) |
| B2 | high | `ratePlanId` silently ignored on modify |
| B3 | medium | `noPost` dead on modify; dropped by early returns |
| B4 | low | Wrong error class for misconfigured cancel policy |
| C1 | critical | Degraded replay drops operator attribution |
| C2 | high | WebSockets never re-authorize; no cap; dead `userId` |
| C3 | medium | Clerk JWT echoed in handshake response |
| C4 | low | `reconcileHorizonForTest` ungated |
| C5 | medium | Blind-index key global, not per-org |
| D1 | high | Untyped error channel (4 downstream symptoms) |
| E1 | high | `classifiedUserMessage` discards `fallback` |
| E2 | high | Desk errors render unactionable "try again" |
| E3 | high | CheckIn / ShiftStrip status not announced |
| E4 | medium | Checkout override prompt fires on credit balances |
| E5 | medium | Queued-command list drops what was queued |
| F1 | high | Four identical D1 lookups per request |
| F2 | medium | Pre-handler chain needlessly sequential |
| F3 | medium | ~70 client queries without `staleTime` |
| F4 | medium | Cold horizon reconcile: per-date subquery, no yield |
| G1 | medium | Seven duplicated route guards |
| G2 | low | `invokePropertyDo` preamble ×61 |
| G3 | low | Error ladder hand-rolled ×15 beside a helper |
| G4 | medium | Route audit keyed by array index |
| G5 | medium | `.panel`/`.badge` duplicates outside the gates |
| H1 | high | No deploy pipeline; jurisdiction branch never executed |
| H2 | medium | No coverage measurement |
| H3 | medium | Ledger property test omits virtual types, confirm/hold |
| H4 | low | Documentation reconciliation (§10.1, §16.4, README) |
