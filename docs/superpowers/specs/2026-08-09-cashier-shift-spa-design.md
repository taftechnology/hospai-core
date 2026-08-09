# Cashier Shift SPA (Open / Close / Force-Close Visibility)

**Date:** 2026-08-09  
**Status:** Approved — locks Q1=C, Q2=B, Q3=B (+ pinned read), Q4=B, Q5 as scoped; `propertyLocalToday: string | null` on `shiftSeverity` / callout (null → neutral / suppress)  
**Sources:** [cashiering](./2026-08-07-cashiering-design.md) (server shifts + cash tender); [folio front desk](./2026-08-08-folio-front-desk-design.md) §2.3–2.4 (authority unknown → attempt; unattributed cash until this vertical); [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md); [get_property partial / forbidden bodies](./2026-08-09-get-property-partial-forbidden-bodies-design.md) (`check:do-transport-guards`); `ShiftStrip.tsx`; `tryOpenShift` / `tryCloseShift` / `readCurrentOpenShift` / `forceCloseCashierShiftsSync` in `property-do.ts`

**Implementation order:** after folio front-desk SPA + the 2026-08-09 transport/403 slice (CI already enforces GET transport guards).

---

## 1. Context & Motivation

Server cashiering is complete: `folio.open_shift` / `folio.close_shift` are **`FAIL_CLOSED`**, `folio:post`, idempotent, audit-writing — no provisional path. Cash posts without an open shift are allowed and stamped `shift_id NULL`; close returns `unattributedCashCount`. Night audit force-closes open shifts with `FORCE_CLOSED` and null count/variance.

The SPA strip already calls `get_front_desk_shift` live and shows “No open shift” because nothing opens one. Folio §2.4 accepted every cash post as unattributed until this vertical. Opening without closing would force nightly force-close — worse than today’s silence. This slice lands **open + close + force-close visibility** so the accountability record is something a cashier can see.

### Scope in

1. **Shift strip** — open control (opening float) when none open; live open-shift chrome; link into close / recent.
2. **`/shift` screen** — blind close ceremony; post-submit receipt that survives refresh via `shiftId` in the URL + `get_shift`.
3. **`get_front_desk_recent_shifts`** — self-scoped closed/force-closed list (Q3 pin below).
4. **Folio cash warning** when the cashier has no open shift (post still allowed).
5. Client typed methods for open / close / recent / by-id read; invalidation per §3.5.
6. Classify `shift_not_open` / `shift_already_open` among 422s; stable idempotency keys for open/close keyed on `shiftId`.
7. **Money formatting** — minor units on the wire; major units in UI (fix today’s raw `openingFloat` display bug); signed variance copy; count ≠ money.
8. **`shiftSeverity` mapper** in `apps/web-pms/src/status/` — exhaustive over shift UI states; no ad-hoc colours on strip/`/shift`.

### Scope out

- Manager oversight of **other** cashiers’ shifts (needs its own read + permission story).
- Drawer denominations / till composition UI.
- Gating cash (or any folio write) on an open shift (rejected in cashiering §2.2; unchanged).
- Provisional cash during outage (cashiering leftover).
- Night-audit chrome / force-close **action** from the SPA (audit already force-closes; this slice only surfaces the result).

---

## 2. Design Decisions

### 2.1 Q1 — Where open and close live → **C**

| Action | Surface |
|---|---|
| Open | Inline in the shift strip — one integer field (`openingFloat`) + submit |
| Close | Dedicated `/shift` (and `/shift/:shiftId` after close) — not global chrome |

Open belongs next to the state it creates. Close is a ceremony (blind count → variance reveal → unattributed disclosure). An irreversible money-reconciliation form in shell chrome invites mis-clicks from any board/folio screen.

### 2.2 Q2 — After variance reveal → **B (receipt that survives refresh)**

`tryCloseShift` returns `{ ok, shiftId, variance, unattributedCashCount }`. Variance is also persisted; `get_shift` returns `closingCount`, `variance`, `unattributedCashCount`, `status`.

**Lock:** after successful close, navigate to (or stay on) `/shift/:shiftId` and render a receipt-shaped summary from `get_shift` (not only the mutation response). Refresh re-fetches the same facts. Strip flips to “No open shift” via invalidated `get_front_desk_shift`.

A variance a cashier can lose by refreshing is exactly the number a manager will ask about later.

### 2.3 Q3 — Force-closed visibility → **B (in-scope read)**

Force-close writes `FORCE_CLOSED` with null count/variance. `readCurrentOpenShift` only returns `OPEN`. `get_shift` needs a `shiftId` the client no longer has after audit. Without a recent list, the strip says “No open shift” and never discloses that the drawer was never counted — a softer replay of the open-without-close accountability hole folio §2.4 called out.

#### `get_front_desk_recent_shifts` (pinned)

**Route**

```
GET /v1/properties/:propertyId/front-desk/shifts/recent
```

**Audit row — append last** (index **68** after `get_front_desk_shift`; do **not** insert beside `get_shift` — `check:permissions` is element-wise; pins at 19/43/44/61/62 must not shift):

```ts
{
  id: 'get_front_desk_recent_shifts',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
}
```

No `commandId` (`check:degraded` XOR satisfied). New GET must wrap the stub call in `isPropertyDoTransportFailure` — `check:do-transport-guards` fails the build otherwise.

**Limit:** fixed **5**, newest first, `ORDER BY opened_at DESC`. No cursor. Other front-desk lists are cursor-paged; this answers “was my last drawer counted?” — glanceable, not browsable. `opened_at` is `NOT NULL` in DDL (total sort). Manager oversight over all cashiers would need paging — scoped out of Q5.

**Response**

```ts
{
  ok: true,
  shifts: Array<{
    shiftId: string;
    businessDate: string;
    openedAt: number;
    closedAt: number | null;
    openingFloat: number;
    closingCount: number | null;
    variance: number | null;
    status: 'CLOSED' | 'FORCE_CLOSED';
  }>
}
```

| Constraint | Why |
|---|---|
| Exclude `OPEN` | `get_front_desk_shift` owns the open row; two sources of truth for one shift is worse than a second fetch |
| Omit `unattributedCashCount` | `readShift` computes it via `countUnattributedCashForBusinessDateSync` — **business-date-wide, not per-shift**. In a list, two same-date rows would show identical counts that look per-shift. Keep it on `get_shift` / Q2 receipt only |
| No expected cash on the wire | `computeShiftExpectedCashSync` stays private; only feeds `tryCloseShift`. Force-closed rows have null count/variance by construction = “never counted” |
| Derive copy client-side | SPA phrases “drawer never counted” from `status === 'FORCE_CLOSED'`; server returns facts |
| Self-scoped | Filter `cashier_user_id = actor.userId`. If `actor.kind !== 'user'`, return `{ ok: true, shifts: [] }` — same guard pattern as `readCurrentOpenShift`. Managers with `folio:read` see **their own** shifts, not oversight |

**`get_shift` is not self-scoped.** `handleGetShift` → `readShift(shiftId)` takes no actor and applies no ownership filter. Any `folio:read` holder who knows a `shiftId` can read another cashier’s `closingCount` / `variance` / `unattributedCashCount`. **Accepted this slice:** authenticated staff, non-enumerable ids; Q2=B increases traffic to this route but does not invent the gap. Do not imply uniform self-scoping across shift reads. Tightening ownership (or a manager-only peer view) sits beside leftover #1 (oversight), not as silent assumption.

### 2.4 Q4 — Cash with no open shift → **B (warn, allow)**

Server still posts unattributed cash. Client:

- When `get_front_desk_shift` shows no open shift, show an inline warning on the folio cash control (not a hard block).
- Submit still calls `post_cash_payment`.
- Close receipt / `unattributedCashCount` remains the disclosure.

**Reject A:** blocking strands a guest because the cashier forgot a ceremony; unlike policy C, the failure mode is already recorded and disclosed. **Reject C:** opening is now possible — silence would waste the strip.

### 2.5 Q5 — Scope boundary

**In:** §1 scope list.  
**Out:** §1 scope-out list.  
**Retire (folio leftover):** §2.4 “unattributed cash until cashiering open+close UI” — mark retired when this lands; residual unattributed cash remains possible (warn path) and is intentional.

**Outage:** open/close are FAIL_CLOSED — strip/close show property-unreachable; no queue. Consistent with catalog.

### 2.6 Classify shift 422s (force-close race + already-open)

`SHIFT_NOT_OPEN` / `SHIFT_ALREADY_OPEN` map to **422** via `mapReservationCommandErrorStatus`. Today `classify.ts` buckets every 422 as generic `client_error` — copy collapses to the fallback, identical to a malformed body.

That is the vertical’s most likely real failure (overnight force-close, then morning blind count) and the interaction §2.3 exists to make visible. `SHIFT_ALREADY_OPEN` is also guaranteed reachable: unique partial index `shift_open_per_cashier` on open rows — second tab / stale strip hits it.

**Lock:** add dedicated `ClientResultClass` values keyed on body `error` among 422s — same pattern as `idempotency_key_reused` among 409s and `queue_unavailable` among 503s:

| Body `error` | Class | Copy / next step |
|---|---|---|
| `shift_not_open` | `shift_not_open` | “Your shift was force-closed by the night audit. This count was not recorded.” → send to `/shift/:shiftId` receipt (null variance / FORCE_CLOSED via `get_shift`) |
| `shift_already_open` | `shift_already_open` | “You already have an open shift” → invalidate/refresh open-shift strip |

Neither retries (`shouldRetry` unchanged — still only `read_stale`).

### 2.7 Idempotency keys for open and close

Close is the highest-stakes idempotent write in the product (a money count). A fresh key per click + lost response + retry becomes `SHIFT_NOT_OPEN` (already closed) instead of a replay of `{ variance, unattributedCashCount }` — the cashier never learns their variance. That breaks the flaky-connection case Q2=B was designed for.

**Lock:** use `stableKeyForOperation` (existing client-core helper) with op ids keyed on **`shiftId`**:

| Mutation | Op id |
|---|---|
| Open | `shift:open:${shiftId}` |
| Close | `shift:close:${shiftId}` |

Mint `shiftId` once when the open form is prepared (or once for the close target). Retries reuse the same idempotency key → server replays the original success body. Do **not** key close on the closing-count value alone without `shiftId` — count edits before first success may mint a new logical op; after first success the key must stick to that `shiftId`.

**Dependency (load-bearing, invisible):** mint-once is safe **only because** `tryOpenShift` validates `MONEY_INVALID` **before** `runIdempotent`. A fat-fingered float rejected with 422 leaves the idempotency slot unconsumed, so correcting and resubmitting with the same key succeeds. If that validation ever moves inside the transaction, the correction path starts returning 409 with no way forward — do not move it without a new keying story.

### 2.8 Money units (fix live strip bug)

Wire fields (`openingFloat`, `closingCount`, `variance`, payment `amount_minor`) are **integer minor units**. Today’s strip does `String(body.shift.openingFloat)` — a £200 float shows as **“float 20000”**. This slice rewrites the strip; do not carry the bug forward.

| Surface | Rule |
|---|---|
| Display money | Folio helper pattern: `(n / 100).toFixed(2)` (shared `formatMinor` or extract to a tiny util if both screens need it) |
| Open / close inputs | Major units in the field → `Math.round(Number(x) * 100)` on submit (folio cash/charge pattern). Typing `200.00` must not submit `200` against expected `20000` |
| `variance` (signed) | Never bare `String(n)`. Present major units with polarity: **short** when `variance < 0`, **over** when `variance > 0`, **even** when `0`. Force-closed / null → no variance figure (never invent `0`) |
| `attributedCashCount` | A **count of posts**, not money — label as “cash posts N”, never pass through `formatMinor` |

### 2.9 Status tokens — `shiftSeverity`

Do not invent strip/`/shift` colours outside the token system. Add `apps/web-pms/src/status/shift-severity.ts` with exhaustive `never` + tests (same pattern as `boardRowSeverity` / `guestSeverity`).

**Pure mapper — pass `propertyLocalToday: string | null` as an input**, never call `usePropertyTimeZone` inside. Same shape as `boardRowSeverity({ mode, status, overstay })`. Null is a testable third state: the hook is null while `get_property` is pending and if it fails. (Registry-half `get_property` narrowed the failure window, but every mount still has a pending gap.)

| State | Severity |
|---|---|
| No open shift (idle) | `neutral` |
| `OPEN` and `propertyLocalToday === null` | `neutral` — do not assert “past” without a checked date (avoids first-paint flicker to `attention`) |
| `OPEN` and `businessDate >= propertyLocalToday` | `neutral` |
| `OPEN` and `businessDate < propertyLocalToday` | `attention` (open past its business date — overnight / forgotten close risk) |
| `CLOSED` and `variance === 0` | `settled` |
| `CLOSED` and `variance !== 0` (non-null) | `attention` — counted but not even; not the same as never counted |
| `FORCE_CLOSED` | `exception` — the accountability signal §2.3 surfaces |
| `fail_closed` / load error | existing strip error chrome (not a severity row) |

Apply via `statusClass(severity)` on strip badge / receipt status chrome. **`check:web-pms-colors` is merge-blocking** for this slice (new screen = exact what it guards).

### 2.10 Open control in shell chrome (authority unknown)

The strip is global; users without `folio:post` still see Open and may 403. **Correct under folio §2.3:** hide when a *precondition* is unknown; **attempt** when *authority* is unknown. Server stamps `permission: 'folio:post'`; body-only `permissionForForbidden` supplies copy. First application of that principle to shell chrome — do not pre-hide Open for lack of a `/me` permissions endpoint.

---

## 3. SPA surfaces

### 3.1 Shift strip (`ShiftStrip.tsx`)

| State | Chrome |
|---|---|
| Loading | Existing muted / minimal |
| `fail_closed` | Existing “Shift unavailable — property unreachable” |
| No open shift | “No open shift” + open form (major-unit float → minor on submit) + recent callout per §3.1a |
| Open | Shift id · **formatted** float · “cash posts N” · severity chrome · **Close** → `/shift` |

**§3.1a Force-close callout bound:** show “drawer never counted” only when the newest recent row is `FORCE_CLOSED` **and** `propertyLocalToday != null` **and** its `businessDate` is the **current or previous** calendar date relative to that property-local today. If `propertyLocalToday` is null, **suppress the callout** (folio §2.3 — hide when a precondition is unknown). Older force-closes stay in the recent list / `/shift/:id` but do not nag in the strip forever. No session-dismiss state required.

**Boot-test mocks:** `AppShell.boot.test.tsx` must stub `getOpenShift`, `getRecentShifts`, and `openShift`. Omitting `getRecentShifts` fails silently — `queryFn` TypeError → React Query error → mock `asClassified` → `fail_closed` chrome the test already expects.

### 3.2 Close screen (`/shift`, `/shift/:shiftId`)

**Pre-close (`/shift` with open shift):**

1. Blind closing count entry (no expected cash shown — structural).
2. Submit → `put_shift_close` with open `shiftId` + stable close idempotency key (§2.7).
3. On success → navigate to `/shift/:shiftId`.
4. On `shift_not_open` → copy from §2.6; navigate to `/shift/:shiftId` so receipt shows force-closed facts.

**Receipt (`/shift/:shiftId`):**

- Load `get_shift` (by id) — **not self-scoped** (§2.3).
- Show `closingCount`, `variance`, `unattributedCashCount`, `status`, `businessDate`.
- If navigated here for a force-closed id from recent list: same read; copy from `FORCE_CLOSED` + null variance (never invent a zero shortage).

**No open shift and bare `/shift`:** redirect attention to strip open + recent list (no empty close form).

### 3.3 Folio cash warning

Beside / above cash submit when strip query says no open shift: short warning that the payment will be unattributed until close discloses the count. Do not disable the control.

### 3.4 Client naming note

Today `api.getShift(propertyId)` hits **`get_front_desk_shift`** (open shift). Prefer renaming or adding aliases in this slice so by-id `get_shift` and recent are not confused (`getOpenShift` / `getShiftById` / `getRecentShifts`) — mechanical clarity, not a wire change.

### 3.5 Query invalidation

Opening creates no closed row — do not invalidate recent on open (folio authorize lesson: invalidate only what the mutation writes).

| Action | Invalidate |
|---|---|
| Open | Open-shift query (`get_front_desk_shift`) **only** |
| Close | Open-shift query **+** recent-shifts query |
| Cash post | **Neither** this slice — strip shows `attributedCashCount` (a count), not an amount; accepting stale count until next strip refetch avoids a refetch on every cash click. Leftover if live count is later required |

On `shift_already_open`, invalidate open-shift only (refresh strip).

---

## 4. Server work

| Piece | Detail |
|---|---|
| DO method | e.g. `readRecentShiftsForActor(actor, { limit: 5 })` — SQL filter self + `status IN ('CLOSED','FORCE_CLOSED')`, `ORDER BY opened_at DESC LIMIT 5` |
| Handler | `handleGetFrontDeskRecentShifts` — transport guard → `degradedFailClosedReadResponse()` |
| Routes | Append audit + `V1_ROUTES` at end (identical order) |
| Pins | Update/add register.test pin for index 68; existing pins unchanged |
| Open/close HTTP | Already exist (`post_shifts`, `put_shift_close`, `get_shift`) — SPA wiring only |

---

## 5. Test matrix

| # | Case | Assert |
|---|---|---|
| 1 | Recent shifts: actor sees own CLOSED + FORCE_CLOSED, newest first, max 5 | Wire + DO unit/HTTP |
| 2 | Recent excludes OPEN | Even with an open shift, list has no OPEN row |
| 3 | Recent omits `unattributedCashCount` | Shape |
| 4 | Non-user actor → empty list | DO |
| 5 | Transport blocked → FAIL_CLOSED 503 | HTTP + `check:do-transport-guards` green |
| 6 | Audit append at 68; pins 19/43/44/61/62 unchanged | `register.test` / `check:permissions` |
| 7 | Strip open → strip shows open; close → receipt variance survives refresh | web-pms |
| 8 | Folio cash with no open shift: warning visible; mutation still fires | web-pms (not disabled-only) |
| 9 | Force-closed in recent: client copy from status, not server phrase | unit / screen |
| 10 | `classify`: 422 + `shift_not_open` / `shift_already_open` → dedicated classes; other 422 stays `client_error` | client-core |
| 11 | Close: same `stableKeyForOperation('shift:close:'+shiftId)` replay returns same variance body | client-core / pms-core |
| 12 | Close after force-close: `shift_not_open` copy; navigate to receipt with null variance | web-pms |
| 13 | Open while already open: `shift_already_open`; strip refreshes | web-pms |
| 14 | Invalidation: open does **not** refetch recent; close refetches open + recent | web-pms |
| 15 | `shiftSeverity` exhaustive + FORCE_CLOSED → exception; variance≠0 → attention | web-pms status tests |
| 16 | Strip/receipt money: float formatted; variance short/over/even; count not currency | web-pms |
| 17 | Force-close strip callout only for current/previous `businessDate` | web-pms |
| 18 | Boot test mocks `getRecentShifts` / `openShift` (not green via silent fail_closed) | web-pms |

---

## 6. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Manager shift oversight | All cashiers; needs permission + paging. Related: optional ownership check on `get_shift` (today any `folio:read` + id) |
| 2 | Denominations / till UI | Not on wire today |
| 3 | Provisional cash during outage | Cashiering §2.1 leftover |
| 4 | Rename `api.getShift` → open-shift clarity | Prefer in this slice; leftover if deferred |
| 5 | Live `attributedCashCount` after cash post | §3.5 chooses no invalidation; revisit if strip must be live |

**Retired this slice (folio):** unattributed-cash-until-open+close-UI leftover — opening exists; warn path remains for forgotten open.

---

## 7. Acceptance checklist

- [ ] Strip opens a shift (`post_shifts`); shows open chrome from `get_front_desk_shift`
- [ ] `/shift` close is blind; success → `/shift/:shiftId` receipt via `get_shift` (refresh-safe)
- [ ] Close/open use `stableKeyForOperation` keyed on `shiftId` (§2.7)
- [ ] `shift_not_open` / `shift_already_open` classified; force-close race copy + receipt path
- [ ] `get_front_desk_recent_shifts` at audit index 68; FAIL_CLOSED; self-scoped; no OPEN; no `unattributedCashCount`
- [ ] Spec states `get_shift` is not self-scoped (accepted)
- [ ] Force-closed rows surface “never counted” copy derived client-side
- [ ] Folio cash warns when no open shift; post still allowed
- [ ] Invalidation matrix §3.5 honoured
- [ ] `shiftSeverity` mapper + money formatting (incl. signed variance) + callout date bound
- [ ] `check:permissions` / `check:degraded` / `check:do-transport-guards` / `check:web-pms-colors` green
- [ ] Final sweep: `pnpm typecheck`, `pnpm lint`, full sharded `pnpm --filter @hospai/pms-core test`
- [ ] Folio leftover #4 (unattributed until cashiering UI) marked retired
- [ ] Relevant `pms-core` / `client-core` / `web-pms` tests green

---

## 8. Open questions

None. Q1–Q5, Q3 read, classify, scoping, idempotency, money units, `shiftSeverity`, and callout bound locked in this revision.
