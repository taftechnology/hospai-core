# Audit Log (`audit.append`)

**Date:** 2026-08-07  
**Status:** Draft — slice reserved (not born inside cashiering); detail lock after cashiering lands  
**Sources:** ARCHITECTURE.md §14 ("audit log on money/inventory mutations"); command catalog `audit.append` (declared, no table); [cashiering](./2026-08-07-cashiering-design.md) (explicitly does **not** own this); [tax posting](./2026-08-07-tax-posting-design.md); [payments](./2026-08-06-payments-ledger-simulate-design.md)

**Implementation order:** after tax and cashiering. Pulled out of cashiering so the table is born as a **property-wide money/inventory audit**, not a per-cashier log that must be widened later (retrofit pattern avoided all session).

---

## 1. Context & Motivation

`audit.append` sits in the catalog with nothing behind it. §14 lists an audit log on money/inventory mutations as its own Phase 1 item. §7.3 / cashiering need "per-cashier audit," but that is a **query** over a general log (filter by actor / `shift_id`), not a reason to create a shift-scoped table.

Building the log inside cashiering would:

1. Scope rows to drawer events first.
2. Force a later migration to cover folio, inventory, rates, tax rules.
3. Repeat the declared-but-unread / narrow-then-widen pattern.

### Scope in (when this slice lands)

1. **Audit log table** on the property DO (append-only).
2. **`audit.append` implementation** — catalog command finally writes.
3. **Writers** for money and inventory mutations in scope for Phase 1 (exact set in plan: folio posts/splits/payments, shift open/close/force-close, room/inventory mutations already emitting domain events, tax rule supersession, charge-code changes — pick the minimal set that makes §14 true without boiling the ocean).
4. **Read API** sufficient for per-cashier and per-reservation investigation (filter by actor, time, optional `shift_id` / `reservation_id`).

### Scope out

- Replacing domain outbox / queue consumers.
- Immutable external WORM store (future compliance).
- Tax / cash tender / shift schema (prior slices).
- Full "every config key" history (domain config may remain separate).

---

## 2. Design Decisions (pre-lock sketch)

These are **directional** — fine-grained shape locks when this slice's design pass starts. Constraints from the tax/cashiering pass that this doc must not violate:

| Constraint | Source |
|---|---|
| Not born inside cashiering | This session |
| Covers money **and** inventory, not shifts only | §14 + catalog |
| Per-cashier view = filter, not schema | Cashiering overlay |
| Append-only; corrections are new rows | Ledger house style |
| Must not become a posting gate | Same as shifts |

### 2.1 Likely schema shape (not locked)

```sql
CREATE TABLE audit_log (
  audit_id       TEXT PRIMARY KEY,
  at             INTEGER NOT NULL,
  actor_user_id  TEXT,              -- NULL for system
  command_id     TEXT,
  entity_type    TEXT NOT NULL,     -- 'payment' | 'folio_line' | 'shift' | 'room' | …
  entity_id      TEXT NOT NULL,
  payload_json   TEXT NOT NULL,     -- redaction rules TBD
  shift_id       TEXT,              -- nullable attribution when present
  reservation_id TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX audit_log_at_idx ON audit_log (at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, at);
```

### 2.2 Write path

Prefer **same `transactionSync` as the mutation** so a committed money change always has an audit row (or neither). Avoid best-effort after-commit appends that can drop under crash.

### 2.3 PII / redaction

Guest PII stays in OrgDO. Audit payloads reference ids (`guestRef`, `payment_id`) — do not copy display names/emails into property audit JSON. Exact allowlist in the slice plan.

---

## 3. Relationship to prior slices

| Slice | Delivers | Leaves for audit log |
|---|---|---|
| Tax | Tax lines, rules, split allocate | Who changed a rule / when |
| Cashiering | Shifts, cash tender, force-close | Durable trail of open/close/cash/card with actor |
| Audit log | Table + `audit.append` + readers | — |

Cashiering may emit domain events only until this slice; it must **not** create a `cashier_audit` table.

---

## 4. Acceptance (when implemented)

1. `audit.append` writes rows; catalog is no longer hollow.
2. Money and inventory mutations in the agreed set always leave an audit row in the same txn.
3. Per-cashier and per-reservation queries work without a separate cashiering table.
4. No PII blobs in property audit payloads.

---

## 5. Open questions (defer to this slice's design pass)

1. Exact mutation set for Phase 1 vs later.
2. Payload schema / versioning / redaction allowlist.
3. Retention / archival vs night-audit `ARCHIVE` stub.
4. Whether force-closed shifts require a distinct audit `action` enum vs status on the shift row alone.

---

## 6. Status

**Not implementation-ready** in the same sense as tax/cashiering — this document **reserves the slice and forbids** building the log inside cashiering. Cashiering is approved; detail-lock this doc when that slice lands.
