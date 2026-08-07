# Audit Log (Property Money / Inventory Attribution)

**Date:** 2026-08-07  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §14 ("audit log on money/inventory mutations"), §7.3 (folio archival / retention), §11 ("Audit log… retention as an entitlement"); command catalog `audit.append` (hollow — **retired** by this slice); [cashiering](./2026-08-07-cashiering-design.md) (forbids birthing the log there); [tax posting](./2026-08-07-tax-posting-design.md); `property_config_audit` (house precedent); outbox (`packages/do-runtime/src/outbox.ts` — delivery buffer, not compliance store)

**Implementation order:** after cashiering (v16). Migration head **v17**.

---

## 1. Context & Motivation

§14 lists an audit log on money/inventory mutations. The catalog declared `audit.append` with nothing behind it. Cashiering needs "per-cashier audit," but that is a **query** over a general log (filter by actor / `shift_id`), not a reason to create a shift-scoped table.

### Finding that reframes the slice

The PropertyDO **already** holds an append-only, monotonically ordered record of every domain mutation: `outbox` (`seq`, `event_id`, `event_type`, `payload`, `acked`, `created_at`). The only lifecycle statement is `UPDATE outbox SET acked = 1 WHERE seq <= ?` — **nothing ever deletes an outbox row**. Of ~47 `appendPropertyOutbox` call sites, exactly one carries an actor (`config.changed`, via `auditActor`). The other sites record *what* changed, not *who*.

**So the gap §14 names is not "a record of mutations." It is attribution** — plus a retention promise that is contractual, not accidental.

### Why not the outbox (option B) — load-bearing

**The outbox's permanence is accidental, not contractual.** It is a delivery buffer with an `acked` flag, and pruning acked rows is the obvious future optimization the moment DO storage matters. Basing a compliance requirement on an implementation detail nobody has promised to keep is how audit trails disappear in a performance PR.

That argument rules out:

| Option | Reject because |
|---|---|
| **B.** Add `actor_user_id` / `shift_id` to `outbox` | Compliance rides a buffer that may be pruned |
| **C.** Thin `audit_attribution` keyed by outbox `seq` | Same fate unless it copies payload — then it is A with a FK to something that may vanish |

**Lock: option A** — own `audit_log` table, written in the same `transactionSync` as the mutation.

**Leftover (not this slice's done criteria):** event-contract attribution — 46/47 outbox sites omit actor. Queue consumers building projections cannot attribute either. Track separately; `audit_log` does not fix consumer payloads.

### Scope in

1. **`audit_log` table** on the property DO (append-only) — v17.
2. **Private sync helper** (`appendAuditLogSync` or equivalent) called inside mutation `transactionSync` blocks — not a dispatchable command.
3. **Retire** catalog entry `audit.append` (see §2.2).
4. **Writers** for every PropertyDO mutation belonging to a catalog command that carries an **entitlement** (see §2.5) — coverage by construction.
5. **Read API** sufficient for per-cashier and per-reservation investigation (filter by actor, time, optional `shift_id` / `reservation_id`).
6. **Prototype-coverage exemption** for `ADD_AUDIT_LOG` (see §2.6) — do not shrink `PROTOTYPE_ACTIONS`.
7. **Remove** consumer `case 'audit.recorded'` (see §2.7).

### Scope out

- Replacing domain outbox / queue consumers.
- Emitting audit content onto the queue (`audit.recorded`).
- Immutable external WORM store / external audit sink (leftover).
- Implementing night-audit `ARCHIVE` purge body (name the policy only — §2.4).
- Outbox prune policy; outbox actor backfill (leftover).
- Tax / cash tender / shift schema (prior slices).
- Birthing a `cashier_audit` table (forbidden — cashiering already reserved against this).

---

## 2. Design Decisions (locked)

### 2.1 Own table — not outbox columns (Q1)

**Lock: A.** Schema in §2.3. Same-txn write with the money/inventory mutation so a committed change always has an audit row (or neither). Avoid best-effort after-commit appends.

Audit must **never** become a posting gate (same class as shifts): helper failures that indicate programmer error may throw inside the txn; the helper must not introduce new business rejection codes that staff hit on a good post.

### 2.2 Retire dispatchable `audit.append` (Q2)

The hollow catalog entry is incompatible with §2.1:

| Catalog said | Same-txn audit needs |
|---|---|
| `lane: 'BACKGROUND'` | Runs inside the mutating command's txn |
| `degraded: 'QUEUE_PROVISIONAL'` | Must not diverge from committed money |
| `permission: 'shell:internal'` | Not an org-invocable API |
| Own events `['audit.recorded']` | Audit is a side effect of *other* commands |

**Lock:**

1. **Delete** `audit.append` from `COMMAND_CATALOG`.
2. Implement a **private** PropertyDO helper; no HTTP route; no `REPLAY_DISPATCH` entry.
3. **`shell:internal` stays** — still carried by `shell.set_role` / `shell.set_property`; `check:permissions` count unchanged.
4. Catalog length is reported, not asserted — no pin to repair.

ARCHITECTURE §11 ("Written from the application layer via events") is read as: *audit is driven by domain mutations that also emit events* — not *a queued `audit.append` command writes the trail*.

### 2.3 Schema, actor, payload-vs-diff (Q3)

Follow `property_config_audit` so the two audit surfaces read identically when correlating config changes with money movements.

**Actor is `NOT NULL`.** Use the existing convention:

```ts
const auditActor = actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;
```

Nullable actor reintroduces *"we don't know"* — the single hole this table exists to eliminate. System paths (night-audit force-close, alarms) use `system:<reason>`, never NULL.

**Shape: diff envelope** (not payload-only). Append-only folio events use `before_json = NULL` and `after_json` = the posted fact; updates (shift close, tax supersession, charge-code status) populate both sides.

```sql
CREATE TABLE audit_log (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  at               INTEGER NOT NULL,
  actor            TEXT NOT NULL,
  command_id       TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  before_json      TEXT,
  after_json       TEXT NOT NULL,
  shift_id         TEXT,
  reservation_id   TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor, at);
CREATE INDEX audit_log_shift_idx ON audit_log (shift_id, at);
CREATE INDEX audit_log_reservation_idx ON audit_log (reservation_id, at);
```

| Column | Rule |
|---|---|
| `actor` | `NOT NULL`; user id or `system:<reason>` |
| `command_id` | Catalog id of the mutating command (e.g. `folio.record_cash_payment`, `shifts.close`) |
| `entity_type` / `entity_id` | Primary subject (`payment` / `pay_…`, `shift` / `shift_…`, `folio_line` / …) |
| `before_json` | NULL on create/append; prior snapshot on update |
| `after_json` | NOT NULL — state after the mutation (ids + money fields; **no guest PII**) |
| `shift_id` / `reservation_id` | Nullable attribution for investigation filters |

**Force-close:** no separate audit `action` enum. The row's `command_id` (night-audit / force-close path) plus `after_json` reflecting `force_closed` (or equivalent status already on `shift`) is enough. Per-cashier history is `WHERE shift_id = ?` or `WHERE actor = ?`.

**PII / redaction:** Guest PII stays in OrgDO. Audit JSON references ids (`guestRef`, `payment_id`, amounts, tender, status) — never display names or emails. Exact field allowlist in the implementation plan.

### 2.4 Retention (Q4)

The outbox already grows forever. A second forever-growing table doubles DO storage growth per property unless retention is named.

**Lock (policy, not ARCHIVE body):**

1. **`audit_log` must never be silently pruned.** Whoever implements night-audit `ARCHIVE` (or any storage cleanup) owns purge of `audit_log` under a **stated** retention policy — the same failure mode that ruled out option B.
2. This slice **does not** implement the `ARCHIVE` stub. It documents the prohibition and the ownership handoff.
3. Directional policy (align with §7.3 folio archival + §11 "retention as an entitlement"): PropertyDO retains audit rows for **open stays + current fiscal year**; closed years are projected out under `ARCHIVE` when that step graduates from no-op. Entitlement may tighten/loosen retention later — purge still goes through the named owner, never a drive-by DELETE.

### 2.5 Writer scoping rule

**Do not maintain a hand list of 47 outbox sites.**  

**Rule:** every PropertyDO mutation path for a catalog command that carries an **`entitlement`** field writes an `audit_log` row in the same txn. That boundary is already what `check:entitlements` enforces for money/inventory. New entitled commands are covered by construction.

Reads, platform-only shell commands without entitlement, and pure projection paths do not write audit rows under this rule.

### 2.6 Prototype coverage — `ADD_AUDIT_LOG` exemption

`audit.append` is the **only** carrier of `prototypeAction: 'ADD_AUDIT_LOG'`. Deleting the catalog entry breaks:

```ts
// packages/contracts/src/register.test.ts — covers all 35 prototype actions
expect(covered).toEqual([...PROTOTYPE_ACTIONS].sort());
```

**Do not** drop `'ADD_AUDIT_LOG'` from `PROTOTYPE_ACTIONS` or change 35 → 34. That list is a Phase 0 record of what the reference prototype actually had; the prototype *did* have an audit-log action. Shrinking it to make a check pass falsifies the record rather than the claim.

**Lock:** keep both statements true — *the prototype had this action*, and *we implement it as a side effect, not a command* — via an explicit exemption list (same spirit as `PLATFORM_GAPS`), e.g.:

```ts
export const PROTOTYPE_ACTIONS_AS_SIDE_EFFECT: { action: string; reason: string }[] = [
  {
    action: 'ADD_AUDIT_LOG',
    reason:
      'Prototype had ADD_AUDIT_LOG; platform implements audit as same-txn side effect of entitled mutations, not a dispatchable command (see audit-log design).',
  },
];
```

Coverage test becomes: catalog-covered ∪ side-effect actions = `PROTOTYPE_ACTIONS`. One entry, one reason string; the test still fails if any *other* action silently disappears from the catalog.

### 2.7 `audit.recorded` — remove

With the catalog entry gone, nothing declares or emits `audit.recorded`. The consumer has `case 'audit.recorded':` ([event-consumer.ts](../../../apps/pms-core/src/event-consumer.ts)) — a stray allowlist case that becomes another unreachable branch.

**Lock: remove the case.** Audit rows are internal. Emitting them onto the queue pushes audit content into consumer payloads — opposite of the PII posture in §2.3. An external audit sink is a leftover, not this slice.

---

## 3. Relationship to prior slices

| Slice | Delivers | Leaves for / from audit log |
|---|---|---|
| Tax | Tax lines, rules, split allocate | Who changed a rule / when (entitled tax commands) |
| Cashiering | Shifts, cash tender, force-close | Durable trail with actor; per-cashier = filter |
| Config | `property_config_audit` + actor on `config.changed` | Precedent for actor / diff shape; remains separate table |
| Audit log | `audit_log` + sync helper + read API; retire hollow command | Outbox actor backfill; ARCHIVE purge body; external sink |

Cashiering must **not** create a `cashier_audit` table (already forbidden there).

---

## 4. Acceptance

1. `audit_log` exists (v17); entitled money/inventory mutations leave a row in the **same txn** as the mutation.
2. Catalog no longer contains `audit.append`; no HTTP route; no `QUEUE_PROVISIONAL` / `REPLAY_DISPATCH` for audit.
3. `PROTOTYPE_ACTIONS` still length 35 and still includes `ADD_AUDIT_LOG`; coverage test uses the side-effect exemption with a stated reason.
4. Consumer has no `audit.recorded` case; nothing emits that event type.
5. Actor always present (`user id` or `system:<reason>`); no nullable-actor rows.
6. Per-cashier and per-reservation queries work via filters — no separate cashiering audit table.
7. No guest PII blobs in `before_json` / `after_json`.
8. Design/docs state: **`audit_log` must never be silently pruned**; `ARCHIVE` owns future purge under a stated policy.

---

## 5. Leftovers (explicitly not this slice)

1. **Outbox event-contract actor** — backfill actor into domain event payloads for projection attribution.
2. **Night-audit `ARCHIVE` body** — folio + audit_log projection/purge under §2.4 policy.
3. **External / WORM audit sink** — if required later; may reintroduce a queue event under a new name with a redaction contract.
4. **Outbox prune** — when DO storage forces it; must not touch `audit_log`.

---

## 6. Status

**Approved — implementation-ready.** Cashiering is landed; this doc locks A + retire dispatchable entry, Q3/Q4, prototype-coverage resolution, and `audit.recorded` removal. Next: implementation plan + v17 + helper + writers + read route + matrix tests (including kill-switch / entitlement on the read/mutate surfaces that this slice adds).
