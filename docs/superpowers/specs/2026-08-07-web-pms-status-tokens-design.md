# web-pms Status Tokens

**Date:** 2026-08-07  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §9 (shell); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md); reservation status CHECK in `packages/do-runtime/src/property-migrations.ts` (v8+)

**Implementation order:** after front-desk SPA shell. This slice adds a tested severity vocabulary, applies it on the board, and enforces colour/style boundaries.

---

## 1. Context & Motivation

`apps/web-pms` has seven presentational tokens (`--ink`, `--muted`, `--line`, `--bg`, `--panel`, `--danger`, `--warn`), two escaped colour literals (`#fff5f5`, `#fff` / equivalent), no status chrome, and guest states encoded only as text suffixes in `guestLabel`. Reservation `status` arrives on list rows and is never visually distinguished; overstays are sorted first by the server and rendered identically to every other row. The exception-count `.badge` is always `--warn`, including at zero.

Visual consistency usually has no failing test. Two properties here **can** fail the build:

1. **State → severity** — a pure total function over system enums.
2. **Foreground contrast** — computable WCAG AA ratios from token hexes.

Everything else is honesty about what cannot be verified yet.

### Scope in

1. Two-layer tokens: primitives + status/action semantics; refactor existing chrome onto greys.
2. Closed `RESERVATION_STATUSES` in `@hospai/contracts` + CHECK sync check (do-runtime or scripts).
3. Pure mappers + totality tests in `apps/web-pms/src/status/`.
4. Apply on board: guest cells, reservation rows, departures grouping (due-out / departed / other), overstay (property-local today, non-blocking timezone), exception badge severity.
5. Enforcement: `check:web-pms-colors` (literals + contrast); ESLint `no-inline-styles-in-web-pms`.

### Scope out

- Folio / payment / shift **alias tokens** (paper mapping only).
- Server `isOverstay` / open business date on the wire.
- Fixing `get_property` FAIL_CLOSED classification (leftover; named).
- Spacing scale (leftover; converted inlines are the input).
- Dark theme / second brand palette.

---

## 2. Design Decisions

### 2.1 Apply, don’t only define (Q1)

**Lock A.** Defining a scale nothing renders is a stylesheet carrier. Apply on day one: guest states, board row conditions, badge count.

**Verifiable core:** mappers are pure total functions with tests — not inline JSX. Colour is **additive** to existing text suffixes (WCAG / eight-hour readability).

### 2.2 Scale now; aliases per vertical (Q2)

**Lock A.** Define the severity **scale** and action **intent** vocabulary now. Vertical-specific aliases (`--status-variance`, …) land with their consumers. Folio enums are validated **on paper** in §5 — zero folio tokens created.

### 2.3 Five-rung status scale (Q2b)

**Lock A.**

| Rung | Meaning | Green? |
|---|---|---|
| `settled` | Affirmatively fine | Yes — only when an operator should want green |
| `neutral` | Nothing to say | No |
| `informational` | Correction / tombstone / notable non-problem | No |
| `attention` | Needs operator awareness | No |
| `exception` | Problem / hard domain failure signal | No |

**Test that keeps `neutral` ≠ `settled`:** would an operator want green? If not, it is not `settled`.

**Separate vocabulary — action intent:** `default` · `primary` · `destructive`.  
Destructive is an **affordance**, not a status. Status and action may share primitives; they must not share names. **`destructive` is unexercised this slice** (no delete/cancel on the board) — defined so overstay cannot borrow delete-red; same posture as `READ_STALE` in client-core.

### 2.4 Two layers, constrained (Q3)

**Lock A.** Primitives (`--color-*`) + semantic aliases. Constraints:

- Emit **values in use** only — no 9-step ramps per hue.
- Refactor existing seven chrome tokens onto grey primitives in this slice (no dual grey systems).
- Each non-neutral status rung: **fg / border / surface**.
- **Two primitives per hue** (fg weight + surface weight); **border derived** via `color-mix` toward `--color-surface-base` (or equivalent panel primitive) — **not** toward the named colour `white` (that would violate the colour check).
- Expect ~12–16 primitives.

### 2.5 Enforcement split (Q4)

**Lock A + placement.**

| Surface | Tool |
|---|---|
| Colour literals in CSS | `pnpm check:web-pms-colors` (scripts/) — not ESLint (no CSS AST today) |
| Inline `style={{}}` in TSX | ESLint `no-inline-styles-in-web-pms` (eleventh merge-blocking rule) |

Colour check matches hex, `rgb()`/`hsl()`, and **named CSS colours**. Allowlist predicate (mechanical, no marker comments): **a colour literal is permitted only in a declaration whose property name starts with `--color-`**. That is the primitives surface; semantic tokens (`--status-*`, `--action-*`, chrome aliases like `--ink`) must reference `var(...)` only — a literal there fails the check.

**Contrast:** same check script asserts every `--status-*-fg` clears **WCAG AA 4.5:1** against its paired `-surface` and against the panel/chrome surface. Regression-proof, not a prose bar.

**Inline escape hatch:** `style={{ ['--x' as string]: value }}` (custom properties only) allowed; layout/colour via classes.

### 2.6 Approach — mapper in `web-pms`, not `client-core`

**Lock Approach 1.** Severity is presentation vocabulary. `no-dom-in-client-core` cannot catch a DOM-free mapper — putting it in client-core would erode the boundary with no check firing.

---

## 3. Architecture

### 3.1 Boot-path principle

> **Nothing on the shell's boot path may depend on the PropertyDO.**

`GET …/properties/:id` for `timeZone` is **non-blocking** after first paint. Shell renders without it; overstay is *not computed* until `timeZone` arrives (honest unknown). During PropertyDO outage, shell still shows queued log / exceptions / hard-refusal UI.

**Server leftover:** `get_property` today makes unguarded DO calls and can return an unclassified 500 — should map transport failure like sibling reads (`FAIL_CLOSED`).

### 3.2 Contracts: `RESERVATION_STATUSES`

Export closed const + type from `@hospai/contracts` (browser-safe subpath, e.g. `./reservation-status`) matching the SQL CHECK:

`confirmed | cancelled | checked_in | checked_out | no_show`

**Sync test:** do-runtime or `scripts/` — not contracts (do-runtime owns migrations; contracts must not import do-runtime).

### 3.3 Mappers (`apps/web-pms/src/status/`)

**Convention:** severity string → class `status-${severity}`. No second lookup table.

Emitting `class="status-neutral"` is **intentional** even though that rule sets nothing: it keeps the mapper’s mechanical convention total, aids debugging in the DOM, and must not be “completed” with a transparent-border rule (that would erase cell separators — §3.4). Do not delete the emitted class; do not add chrome to “complete the set.”

#### `guestSeverity(state: GuestRowState): StatusSeverity`

Compile-time `never` exhaustiveness + one test per case.

| State | Severity |
|---|---|
| `resolved` | `neutral` |
| `name_pending` | `neutral` |
| `erased` | `informational` |
| `not_found` | `exception` |
| `decrypt_unresolved` | `exception` |

`guestLabel` text suffixes **remain**; severity is additive.

#### `boardRowSeverity(…): StatusSeverity`

Exhaustive over `ReservationStatus` (and mode / overstay). **No silent `otherwise → neutral`.** New status → compile + test fail.

| Condition | Severity |
|---|---|
| In-house + overstay | `exception` |
| Departures + `checked_in` (due-out) | `attention` |
| Departures + `checked_out` (departed) | `neutral` — balance unknown; **not** `settled` |
| Departures + `cancelled` | `informational` |
| Departures + `no_show` | `attention` |
| Departures + `confirmed` | `attention` — unprocessed no-show (`PROCESS_NO_SHOWS` still a stub; these accumulate) |
| Arrivals + `confirmed` | `neutral` |
| In-house + not overstay | `neutral` |

Departures returns **all statuses** for the date by design. Exhaustiveness over `RESERVATION_STATUSES` must include `confirmed` — it is not an edge case while `PROCESS_NO_SHOWS` is a stub.

**Departures layout:** three groups — **due-out** · **departed** · **other** (`cancelled` / `no_show` / `confirmed`). Severities require rendered rows.

**Overstay:** `departureDate < propertyLocalToday(timeZone)` once `timeZone` from non-blocking `get_property` is available; else omit overstay marker. Browser-local forbidden. Audit-boundary vs business date documented; leftover = server `isOverstay` or open business date on the wire.

**Departed ≠ settled on the board:** list payload has no balance. Settled vs open-balance departed is **folio-screen only** (leftover already).

#### `exceptionBadgeSeverity(count: number)`

`0 → neutral`, `> 0 → exception`.

**Domain vs connectivity:** mappers are domain-only. FAIL_CLOSED / unreachable chrome reuses the **exception** visual rung via `.error` — not via `boardRowSeverity`.

### 3.4 Tokens / CSS

**File:** `apps/web-pms/src/styles/tokens.css`.

**`neutral` rule:** “No chrome” means **no declarations** (or only `color: inherit`) — not `transparent`. Transparent borders would erase `td` separator lines (`border-bottom: 1px solid var(--line)`).

**Non-neutral utilities:** `.status-settled|informational|attention|exception` set fg / border / surface from roles.

**Apply level:** **row** for board/reservation severity; **cell** for guest severity. Neutral sets nothing so they compose.

**Border derivation example:**

```css
--status-exception-border: color-mix(
  in srgb,
  var(--status-exception-fg) 35%,
  var(--color-surface-base)
);
```

---

## 4. Testing & enforcement

### 4.1 Canaries / checks (verifiable)

| Decision | Mechanism |
|---|---|
| `guestSeverity` total | vitest + `never` exhaustiveness |
| `boardRowSeverity` total over statuses | vitest table; contracts union + CHECK sync |
| Badge count → severity | vitest |
| Colour literals only on `--color-*` props | `check:web-pms-colors` allowlist predicate |
| FG contrast ≥ 4.5:1 vs surface/panel | same check script |
| No inline styles (except CSS variables) | `no-inline-styles-in-web-pms` |
| `RESERVATION_STATUSES` ↔ SQL CHECK | do-runtime test or scripts check |

### 4.2 Unexercised / honesty (not canaries)

| Decision | Why it exists anyway |
|---|---|
| Action `destructive` tokens | Separate vocabularies; no delete UI this slice |
| Status `settled` visual | Folio paper mapping; board must not fake green on departed |
| Folio alias tokens | Zero created; §5 paper table only |
| Overstay at audit boundary | Property-local today ≠ business date; leftover named |
| Spacing scale | Deferred; inline conversion surfaces ad-hoc rem |

### 4.3 Non-canary render

Layout grouping of departures, visual taste of hexes (beyond contrast ratios), real browser behaviour.

**Boot path ⊀ PropertyDO (render test, not reasoning):** stub transport so every PropertyDO-backed call fails; assert the shell still mounts, still shows nav, and still renders the queued-command log and exception panel. This is a non-canary render assertion (belongs with shell tests) — not a pure unit canary — but it is a *test*, not outage reasoning. Failure mode: a shell that does not boot during the outage it was designed for.

---

## 5. Paper-only folio validation (zero tokens)

| State | Candidate rung |
|---|---|
| `payment.captured`, variance 0 | `settled` |
| `payment.authorized` | `attention` |
| `payment.declined` / `unknown` | `exception` |
| `shift.FORCE_CLOSED` | `exception` |
| `shift.CLOSED` + variance | `attention` |
| `folio_line.source = SPLIT_REVERSAL` | `informational` |
| Departed + balance 0 / open | `settled` / `attention` — folio screen only |

If a future folio state cannot land on a rung, **widen the scale in a design pass** — do not invent a parallel vocabulary.

---

## 6. Leftovers

| Leftover | Why |
|---|---|
| Server `isOverstay` or expose open business date | Correct overstay at night-audit boundary |
| `get_property` FAIL_CLOSED on transport failure | Unclassified 500; boot path must not wait on it |
| Implement `PROCESS_NO_SHOWS` | Stub today; departures board will surface accumulating `confirmed` rows as `attention` until night audit converts them |
| Departed + balance severity | Needs folio; not on list payload |
| Spacing scale | After measuring rem values from converted inlines |
| Folio/payment/shift CSS aliases | When those screens land |
| Action `destructive` consumer | When cancel/delete UI exists |

---

## 7. Acceptance checklist

- [ ] Primitives + status/action semantics; chrome refactored onto greys; no dual grey systems.
- [ ] Borders via `color-mix` toward surface primitive — no named `white`; literals only on `--color-*` declarations.
- [ ] `check:web-pms-colors` green (literals + contrast).
- [ ] `no-inline-styles-in-web-pms` green; four prior inlines converted.
- [ ] `RESERVATION_STATUSES` exported; CHECK sync green.
- [ ] `guestSeverity` / `boardRowSeverity` / badge canaries green; no silent status default; departures+`confirmed` → `attention`.
- [ ] Departures three groups; cancelled/no_show/`confirmed` visible in other; overstay only when `timeZone` loaded.
- [ ] Non-canary render: shell mounts with PropertyDO transport failing (nav + queued log + exception panel).
- [ ] `destructive` and `settled`-on-board absent as claimed.
- [ ] `.error` reuses exception visuals; mappers remain domain-only.

---

## 8. Decision → verification map (self-review)

| Locked decision | Canary / check | Or explicit unexercised |
|---|---|---|
| Apply tokens on board | Render + mapper tests | — |
| Five-rung scale + neutral≠settled | Mapper tables; settled unused on board | settled visual unexercised on board |
| Action ≠ status; destructive | — | destructive unexercised |
| Two-layer; no ramps; chrome refactor | colour check (`--color-*` only for literals) | — |
| Border via mix to surface primitive | colour check (no `white`) | — |
| FG 4.5:1 | contrast in colour check | — |
| Colour check script + no-inline ESLint | those tools | — |
| Mapper in web-pms not client-core | package boundary / review | — |
| Boot path ⊀ PropertyDO | non-canary render test (PropertyDO stub fails; shell mounts) | get_property FAIL_CLOSED leftover |
| RESERVATION_STATUSES + exhaustive board map | union + CHECK sync + vitest | — |
| Departed → neutral on board | mapper test | folio settled leftover |
| Departures + `confirmed` → `attention` | mapper test | PROCESS_NO_SHOWS leftover |
| cancelled / no_show / confirmed in other group | mapper + board layout | — |
| Overstay property-local | unit over date helper | audit-boundary leftover |
| Badge from count | vitest | — |
| Neutral CSS sets nothing (not transparent) | stylesheet review; no canary | — |
| Emit `status-neutral` intentionally | documented convention; mapper always emits | — |
| Row vs cell apply | convention in apply code | — |
| Connectivity reuses exception chrome | `.error` uses tokens | not in mapper |
| Folio paper table | — | unexercised aliases |
| Spacing scale | — | leftover |
