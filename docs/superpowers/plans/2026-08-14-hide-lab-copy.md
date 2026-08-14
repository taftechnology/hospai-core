# Hide lab copy (P1 leftover scan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Approved (reviewer, 2026-08-14). Implement task-by-task. Do not skip D7.

**Goal:** Remove operator/engineering vocabulary from happy-path SPA copy — wire reservation ids in headings, classified error class tokens in toasts, `idempotency` in user-facing errors, reg-card print fields, shell queued-command dumps, and dynamic `res_*` / `gst_*` / `rt_*` leaks — without hiding functional errors, changing heads, or touching Worker/seed.

**Architecture:** SPA-only copy + compose pass under `apps/web-pms/src/**` and `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`. Reuse existing human labels (`reservationStatusLabel`, room codes, room-type names, guest batch display names). Centralize classified-error → operator English in a new web-pms-local helper; centralize queued-command line formatting for shell + Folio Advanced. No new HTTP routes, no client-core export unless an existing mapper already serves the SPA (rejected for error helper — see D5).

**Tech Stack:** React SPA (`apps/web-pms`), `@tanstack/react-query`, `@hospai/client-core` (read-only reuse), `@hospai/ui-kit`, vitest + Testing Library. Housekeeping module UI re-exported through web-pms shell.

**Spec:** `docs/superpowers/specs/2026-08-14-hide-lab-copy-design.md` (Approved). Spec commit: `0bb128a`.

---

## Sequencing gate (read before starting)

This is **P1 lab-copy scan**. DEMO-READY: P0-1 through P0-5 should already be ticked before merge. This slice does **not** close P1 guest CRM depth, card last-4 / brand, or one hotel voice.

| After this plan | Do not start |
|---|---|
| Tick DEMO-READY P1 lab-copy row (Task 5) | Worker/schema/catalog/seed changes |
| Closes P0-3 deferred lab-copy row (spec §1) | `/dev/ui` gallery edits |
| — | Night audit step rename (`PRE_CHECK`, …) unless reviewer unlocks OQ §8 #1 |
| — | Card last-4 / brand (separate P1 row) |

---

## Open decisions (locked here; spec §8 — do not re-litigate)

### D1 — Night audit step wire names

**Locked:** Keep **`PRE_CHECK`**, **`PENDING`**, **`RUNNING`**, etc. as painted text (P0-3 §8.6). No human labels in this PR.

### D2 — Reg card confirmation line

**Locked:** Label **`Confirmation #`** + **truncated last 8 characters** of `reservationId` (e.g. `…demo_arr_04` → last 8 of full id). Do not show full `res_*` on print.

### D3 — Queued panel when non-empty

**Locked:** **Humanized line** (spec §4.1 #10) — panel stays open and honest during provisional paths. Do **not** hide panel content.

### D4 — Housekeeping status labels

**Locked:** **Title case wire** — option labels **Clean**, **Dirty**, **Inspected**, **Out of order**. `<option value>` / API payload values stay lowercase wire (`clean`, `dirty`, `inspected`, `out_of_order`).

### D5 — Shared error helper location

**Locked:** **`apps/web-pms/src/copy/`** only. Do **not** export from `@hospai/client-core`. Refactor `messageForFolioMutationError` to call the shared helper internally.

### D6 — Kill-list §4.2 in this PR

**Locked:** **In scope, not optional follow-up.** ShiftScreen hide `shiftId`, directory/profile link text, Folio Advanced billed-party placeholder + queued lines + Open company button — all land in Task 4.

### D7 — Reviewer locks at plan approval (do not re-litigate)

1. **Unknown class copy.** Helper unknown path is exactly **Something went wrong — try again or ask a manager.** Do not append `` `(${c.class})` `` or keep `Open shift failed (${c.class})`. Update `ShiftStrip.test.tsx` (`/Open shift failed/i` today) in **Task 1**.
2. **Task 1 test files belong in the Task 1 commit.** `BookingScreen.test.tsx` asserts `Availability unavailable (read_stale)` (~621) — that matcher dies when Task 1 rewrites the availability alert. Also add a `messageForFolioMutationError` unknown-class case in `use-folio-action-mutation.test.ts`.
3. **Booking radios paint `rt_king` only because `listRoomTypes` is mocked empty** (`BookingScreen.test.tsx` beforeEach). **Task 3:** default mock to a named type (`roomTypeId: 'rt_king'`, `name: 'King Deluxe'`, `code` as in seed). Keep wire ids in **fixtures**; change `getByText('rt_king')` / `getByRole('radio', { name: /rt_king/i })` to the human label. Directory-miss tests (if any) expect **Room type unavailable**.
4. **guest-row extra states.** `not_found` and decrypt-unresolved → **Guest unavailable**. Never prefix `gst_*`.
5. **Search ghost button.** `hitPrimaryLabel` must **not** return `guestRef`. `GuestNameLink` is the name; button text = displayName or **Folio**.
6. **Queued line date.** No relative-time library. `businessDate` if present, else `issuedAt.slice(0, 10)` (ISO date). Prefix **Queued action**.
7. **Folio Advanced other-queue.** Drop ` · ${e.reservationId}` / `(untagged)` suffix (~1167). Same helper as shell.
8. **Directory / profile links.** Accessible name **View folio** (dates already sit in the next column — do not duplicate). `href` still uses `reservationId`.
9. **Reg-card test id.** Check-in print test today `expect(card.textContent).toMatch(/res_1/)`. Last-8 of `res_1` still matches `/res_/`. Use a seed-length id (e.g. `res_demo_arr_04` → last 8 `o_arr_04`) and assert **Confirmation #** + truncated token, `not.toMatch(/res_/)`. Add `listRoomTypes` to the CheckInScreen client mock.
10. **Folio checkout provisional** is already operator English — do not rewrite. Charge + check-in provisional lines still change per §4.1 #7.
11. **Out of D6 (leave):** Inventory / Staff `` `Request failed (${c.class})` ``. Night-audit `PRE_CHECK`. `/dev/ui`.

---

## Global Constraints

- **SPA-only.** Edits under `apps/web-pms/src/**`, `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`, and new helpers under `apps/web-pms/src/copy/**`. No `apps/pms-core/**`, `scripts/demo-seed.mjs`, `packages/contracts/**` (unless type re-export — unlikely).
- **Heads frozen.** `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. `PROPERTY_SCHEMA_HEAD` **25**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **7**. `pnpm generate:ddl` is a no-op diff.
- **Do not hide functional errors.** Rewrite to operator English; do not swallow alerts or return empty error UI.
- **Reuse P0-3 voice.** `reservationStatusLabel()`, room **codes**, room-type **names**, `GuestNameLink` / guest batch — no new marketing tone.
- **`data-testid` strings stay** unless a control is removed. Tests may update **copy matchers** and visible-text assertions; do not rename folio/book/check-in testids.
- **Advanced stays collapsed by default.** Kill-list internals remain behind `folio-advanced`; humanize placeholders when touching Advanced anyway (Task 4).
- **`/dev/ui` untouched.**
- **DevTools / headers out of scope.** `x-dev-actor`, `user_owner` in credentials never appear as painted UI copy.
- **Permission errors keep functional copy.** `Requires permission ${perm}. Ask a manager.` stays when `c.class === 'forbidden'` (spec §1.1 related table).
- **Night audit:** verify only — no copy edits beyond D1 lock.
- Living plan checkboxes: tick `- [x]` on merge only (Task 6). Do not backfill historical plans.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/web-pms/src/copy/classified-user-message.ts` | **New.** Map `ClientResultClass` → operator English; unknown fallback | 1 |
| `apps/web-pms/src/copy/classified-user-message.test.ts` | **New.** Unit tests per spec §7.13 | 1 |
| `apps/web-pms/src/copy/queued-command-line.ts` | **New.** Humanized queued line for shell + Advanced | 3 |
| `apps/web-pms/src/copy/queued-command-line.test.ts` | **New.** No `commandId` / idempotency in output | 3 |
| `apps/web-pms/src/screens/use-folio-action-mutation.ts` | Delegate to shared error helper | 1 |
| `apps/web-pms/src/screens/BookingScreen.tsx` | §4.1 #5, #6, #9; availability alert | 1, 3 |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | §4.1 #1, #5, #7, #8 (`listRoomTypes`) | 1, 2 |
| `apps/web-pms/src/screens/registration-card.tsx` | §4.1 #8 — Confirmation #, room type name | 2 |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | §4.1 #5 | 1 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | §4.1 #2, #7; §4.2 Advanced | 3, 4 |
| `apps/web-pms/src/shell/AppShell.tsx` | §4.1 #3 search meta + primary label | 3 |
| `apps/web-pms/src/screens/guest-row.tsx` | §4.1 #4 pending labels | 3 |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | §4.1 #9 room-type fallback | 3 |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | §4.1 #10 | 3 |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | §4.1 #11 title-case labels | 3 |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx` | Label matchers | 3 |
| `apps/web-pms/src/screens/ShiftScreen.tsx` | §4.2 hide `shiftId` in heading + receipt | 4 |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | §4.2 link text | 4 |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | §4.2 stay link text | 4 |
| `apps/web-pms/src/screens/*.test.{ts,tsx}`, `apps/web-pms/src/shell/*.test.{ts,tsx}` | Copy matchers only | 1–5 |
| `DEMO-READY.md` | Tick P1 lab-copy row (242–243) | 5 |
| this plan file | Tick checkboxes | 6 |

**Not touched:** `apps/pms-core/**`, `packages/client-core/**` (no new exports), `scripts/demo-seed.mjs`, `apps/web-pms/src/dev/**`, Clerk/auth providers, `NightAuditScreen.tsx` step labels (D1).

---

## Spec §4.1 → implementation map

| # | Surface | Target (locked) | Task |
|---|---|---|---|
| 1 | Check-in `<h1>` | Guest displayName or **Check in guest** — never wire id | 2 |
| 2 | Folio header fallback | `GuestNameLink` or **Guest** — omit id | 3 |
| 3 | Search results | Primary = display name; meta uses `reservationStatusLabel(status)` | 3 |
| 4 | Guest pending labels | **Name pending** / **Guest unavailable** / **Guest erased** — no `gst_*` | 3 |
| 5 | Classified error leaks | Shared helper; never paint `fail_closed`, `provisional`, etc. | 1 |
| 6 | Booking idempotency / notepad | Operator English per spec §4.1 #6 | 3 |
| 7 | Provisional queue messages | **Request queued — will apply when the property is reachable.** | 3 |
| 8 | Reg card print | **Confirmation #** + last 8; room type = human name | 2 |
| 9 | Room-type fallbacks | **Room type unavailable** or omit — no `rt_*` | 3 |
| 10 | Queued commands panel | **Queued action** + business date or relative time | 3 |
| 11 | Housekeeping filters | Title case labels (D4) | 3 |

---

### Task 1: Shared classified-error helper + wire happy-path mutators

**Spec:** §4.1 #5, §4.3, §7.13, invariant 3–4, D5.

**Files:**
- Create: `apps/web-pms/src/copy/classified-user-message.ts`
- Create: `apps/web-pms/src/copy/classified-user-message.test.ts`
- Modify: `apps/web-pms/src/screens/use-folio-action-mutation.ts`
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` — replace `` `Booking failed (${code ?? c.class})` `` and availability `` `… (${availErrorClassified.class})` `` paths
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` — replace `` `Assign failed (${c.class})` `` / `` `Check-in failed (${c.class})` `` (keep existing operator English for `fail_closed` / `queue_unavailable` branches)
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx` — replace `` `Open shift failed (${c.class})` ``
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx` — availability `read_stale` matcher (D7.2); do **not** yet change `rt_king` radio labels (Task 3)
- Modify: `apps/web-pms/src/shell/ShiftStrip.test.tsx` — unknown-class copy (D7.1)
- Modify: `apps/web-pms/src/screens/use-folio-action-mutation.test.ts` — unknown class must not contain the class token

**Forbidden this commit:** reg card / heading / search / housekeeping / kill-list screens; client-core export; removing permission lines.

**Helper contract (implementer-facing):**

```ts
// classified-user-message.ts — illustrative API
export function classifiedUserMessage(
  classified: ClassifiedResponse,
  context: {
    fallback?: string;
    /** Screen-specific overrides already painted before calling helper */
    knownCode?: string | null;
  },
): string;
```

**Mapping rules (normative):**
- Never append `` `(${c.class})` `` or paint raw class tokens (`fail_closed`, `provisional`, `read_stale`, `forbidden`, …).
- Known classes → operator English (e.g. `fail_closed` → **Property unreachable.** when no screen-specific line already set).
- `forbidden` → keep existing **Requires permission ${perm}. Ask a manager.** pattern (call `permissionForForbidden`).
- Unknown class + no handled `knownCode` → **Something went wrong — try again or ask a manager.**
- Preserve screen-specific messages that are already operator English (`Room assignment refused — property unreachable.`, `Shift unavailable — property unreachable`, etc.) — helper is for the **fallback** paths only.

- [x] **Step 1: Write failing unit tests**

`classified-user-message.test.ts`:
- `classifiedUserMessage({ class: 'fail_closed' }, { fallback: 'Booking failed' })` does **not** match `/fail_closed/`.
- Unknown class does not contain raw token; contains **Something went wrong**.
- `forbidden` with permission body returns **Requires permission** line.

- [x] **Step 2: Implement helper**

Create `apps/web-pms/src/copy/classified-user-message.ts` per D5. No client-core export.

- [x] **Step 3: Refactor `messageForFolioMutationError`**

Replace inline `` `${fallback} (${c.class})` `` tail with `classifiedUserMessage`. Keep idempotency / not_configured / queue_unavailable strings (already operator English).

- [x] **Step 4: Wire Booking, Check-in, ShiftStrip**

Replace all `` `… (${c.class})` `` / `` `… (${code ?? c.class})` `` happy-path fallbacks. Booking availability alert: use helper instead of `` `Availability unavailable (${availErrorClassified.class})` ``.

- [x] **Step 5: Run targeted tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/copy/classified-user-message.test.ts \
  src/screens/use-folio-action-mutation.test.ts \
  src/shell/ShiftStrip.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/CheckInScreen.test.tsx
```

- [x] **Step 6: Commit**

```bash
git add apps/web-pms/src/copy/classified-user-message.ts \
  apps/web-pms/src/copy/classified-user-message.test.ts \
  apps/web-pms/src/screens/use-folio-action-mutation.ts \
  apps/web-pms/src/screens/use-folio-action-mutation.test.ts \
  apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/BookingScreen.test.tsx \
  apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/shell/ShiftStrip.tsx \
  apps/web-pms/src/shell/ShiftStrip.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): centralize classified error copy for happy path

Add web-pms-local classifiedUserMessage helper and wire Booking,
Check-in, folio mutations, and ShiftStrip so c.class tokens never
paint in operator-facing toasts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Check-in heading + registration card print humanization

**Spec:** §4.1 #1, #8; D2; spec §7.8–9, §7.12.

**Files:**
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Modify: `apps/web-pms/src/screens/registration-card.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`

**Forbidden this commit:** folio header, search, kill-list; changing `@media screen` reg-card clip in `styles.css`.

**Check-in heading (§4.1 #1):**
- Today: `<h1>Check in {reservationId}</h1>` (~124).
- Target: resolved guest → **Check in {displayName}**; name pending / no batch → **Check in guest**.
- `guestsQ` / `displayName` already exist (~32–106) — compose only.

**Reg card (§4.1 #8, D2):**
- Add `listRoomTypes` query on `CheckInScreen` (same pattern as `BookingScreen` `typesQ`).
- Pass `roomTypeName` prop into `RegistrationCard` (or resolve inside component via prop).
- Replace `Confirmation {reservation.reservationId}` → **`Confirmation #`** + last 8 chars of id.
- Replace `Room type {reservation.roomTypeId}` → **`Room type {humanName}`** from directory (`name`, fallback `code`, then **Room type unavailable** — never `rt_*`).

- [x] **Step 1: Update failing tests**

`CheckInScreen.test.tsx`:
- Heading: `getByRole('heading', { name: /check in/i })` does **not** match `/res_/`. With resolved guest **Ada Lovelace**, heading is **Check in Ada Lovelace**.
- Add `listRoomTypes` to the `vi.mock('../client.js')` api object (today it is missing).
- Reg card print test (~133–163): reservationId **`res_demo_arr_04`** (D7.9); expect **Confirmation #** + last 8; expect room type human name; `not.toMatch(/res_/)`; `not.toMatch(/rt_/)`.

- [x] **Step 2: Implement heading + listRoomTypes compose**

Wire `RegistrationCard` with `roomTypeLabel` from types map.

- [x] **Step 3: Implement registration-card copy**

Confirmation # truncation + room type line per D2.

- [x] **Step 4: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx
```

- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/screens/registration-card.tsx \
  apps/web-pms/src/screens/CheckInScreen.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): humanize check-in heading and reg card print

Show guest name in the check-in title and Confirmation # plus room
type name on the registration card instead of wire reservation ids.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shell + folio compose, booking copy, queued panel, housekeeping

**Spec:** §4.1 #2–4, #6–7, #9–11; §7.10–11; D3–D4.

**Files:**
- Create: `apps/web-pms/src/copy/queued-command-line.ts` (+ test)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — header fallback (~759), provisional charge message (~277), checkout queued copy if still engineering tone
- Modify: `apps/web-pms/src/shell/AppShell.tsx` — `hitMeta` uses `reservationStatusLabel`; ensure primary label prefers display name (~89–101)
- Modify: `apps/web-pms/src/screens/guest-row.tsx` — `guestLabel` strings (~4–9)
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` — idempotency (~307), notepad (~339), room-type radio fallback (~432)
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` — `typeLabel` fallback (~83–85)
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` — provisional message (~95)
- Modify: `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` (~19–20)
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` — filter `<option>` text + inline `out_of_order` span (~274–277, ~425–426)
- Modify tests: `FolioScreen.test.tsx`, `AppShell.search.test.tsx`, `BookingScreen.test.tsx`, `TapeChartScreen.test.tsx`, `HousekeepingApp.test.tsx`

**Forbidden this commit:** kill-list directory/profile/shift screens (Task 4); Folio Advanced placeholder/button (Task 4).

**Copy targets (normative):**

| Surface | Target string |
|---|---|
| Booking idempotency | **This booking was already submitted — refresh and check arrivals.** |
| Booking fail_closed | **Property unreachable — booking unavailable.** |
| Provisional (check-in / folio charge) | **Request queued — will apply when the property is reachable.** |
| Folio header no guest | **Guest** (not `reservationId`) |
| guest-row pending | **Name pending** / **Guest unavailable** / **Guest erased** (D7.4: `not_found` + decrypt-unresolved → Guest unavailable) |
| Room-type miss | **Room type unavailable** (Booking radio + TapeChart `typeLabel`) |
| Queued panel line | **Queued action** · `{businessDate ?? issuedAt.slice(0, 10)}` — no `commandId`, no idempotency prefix (D7.6) |
| Search button | displayName or **Folio** — never `guestRef` (D7.5) |
| HK filter options | **Clean**, **Dirty**, **Inspected**, **Out of order** |

**Queued line helper:** `businessDate` if set, else `issuedAt.slice(0, 10)` (`packages/client-core/src/queued-commands.ts`). No relative-time helper.

**BookingScreen.test.tsx (D7.3):** change `beforeEach` `listRoomTypes` from `{ roomTypes: [] }` to a named King Deluxe row so existing radio clicks keep working without painting `rt_king`.

- [x] **Step 1: Write failing tests**

- `AppShell.search.test.tsx`: mock `{ displayName: 'Maria', status: 'checked_in' }` → visible meta includes **In house**, not `checked_in`.
- `BookingScreen.test.tsx`: idempotency test (~393–410) expects new copy, `not.toMatch(/idempotency/i)`.
- `FolioScreen.test.tsx`: first-paint `queryByText(/paymentId/i)` null (existing); add provisional charge matcher without **provisional**.
- `HousekeepingApp.test.tsx`: option labels title case.
- `queued-command-line.test.ts`: output matches **Queued action**, rejects `post_folio_charge` / idempotency substrings.

- [x] **Step 2: Implement compose + copy changes**

Apply table above. Import `reservationStatusLabel` in `AppShell.tsx` `hitMeta`.

- [x] **Step 3: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/copy/queued-command-line.test.ts \
  src/shell/AppShell.search.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx
pnpm --filter @hospai/pms-housekeeping exec vitest run src/ui/HousekeepingApp.test.tsx
```

(Adjust package filter to match monorepo name for housekeeping module if different — grep `package.json` name under `modules/pms/housekeeping`.)

- [x] **Step 4: Commit**

```bash
git add apps/web-pms/src/copy/queued-command-line.ts \
  apps/web-pms/src/copy/queued-command-line.test.ts \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/shell/AppShell.tsx \
  apps/web-pms/src/screens/guest-row.tsx \
  apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx \
  apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/shell/QueuedCommandsPanel.tsx \
  modules/pms/housekeeping/src/ui/HousekeepingApp.tsx \
  apps/web-pms/src/shell/AppShell.search.test.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/screens/BookingScreen.test.tsx \
  apps/web-pms/src/screens/TapeChartScreen.test.tsx \
  modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): humanize shell search, folio header, and queue copy

Replace wire status and guest refs in search meta, folio header
fallbacks, booking errors, queued-command panel lines, and
housekeeping filter labels with operator English.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Kill-list §4.2 (required — D6)

**Spec:** §4.2, §3 scope-in #5; D6.

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` — Advanced: placeholder **Company or agency name**; button **Open company folio**; queued lists use `queuedCommandLine` (~1044–1076, ~1164–1168)
- Modify: `apps/web-pms/src/screens/ShiftScreen.tsx` — heading **Shift receipt** / close form without raw id in visible `<strong>` / `<dd>` (~116, ~191); show business date + float where useful
- Modify: `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` — link text **View folio** (or dates — id not shown) (~227, ~271)
- Modify: `apps/web-pms/src/screens/GuestProfileScreen.tsx` — stay link **View folio** (~321)
- Modify: `apps/web-pms/src/screens/ShiftScreen.tsx` — wire `classifiedUserMessage` for `` `… (${c.class})` `` kill-list paths (~80, ~156)
- Modify tests: `ShiftScreen.test.tsx`, `ReservationsDirectoryScreen.test.tsx`, `GuestProfileScreen.test.tsx`, `FolioScreen.test.tsx` (Advanced collapsed — placeholder not visible on first paint; grep still passes)

**Forbidden this commit:** Exceptions workbench, Settings, Staff, Inventory deep IA.

- [x] **Step 1: Update failing tests**

- Directory/profile: `getByRole('link', { name: /res_dir_1/ })` and `getByText(/res_hit/)` today — change to **View folio**; `href` still `/folio/{id}` (D7.8).
- ShiftScreen: close-form `<strong>` and receipt `<dd>` do not contain `shift_` wire id; heading stays **Close shift** / **Shift receipt**.
- Folio Advanced (expand in test): placeholder not **billed party**; button **Open company folio**; queued other list has no `reservationId` suffix (D7.7). Mutation fallback **Open COMPANY failed** → operator English without `COMPANY`.

- [x] **Step 2: Implement kill-list copy**

Reuse `queuedCommandLine` from Task 3 for Folio Advanced queued `<ul>`.

- [x] **Step 3: Run tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/ShiftScreen.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  src/screens/GuestProfileScreen.test.tsx \
  src/screens/FolioScreen.test.tsx
```

- [x] **Step 4: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/ShiftScreen.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx \
  apps/web-pms/src/screens/GuestProfileScreen.tsx \
  apps/web-pms/src/screens/ShiftScreen.test.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/GuestProfileScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): humanize kill-list shift, directory, and folio advanced

Hide shift ids in shift receipt UI, replace reservation id link text,
and clean up Advanced company folio placeholders and queued lines.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Grep acceptance, vitest sweep, DEMO-READY tick

**Spec:** §7, §9 checklist, DEMO-READY 242–243.

**Files:**
- Modify: `DEMO-READY.md` — tick **Hide lab copy** row
- Verify only: grep commands below

**Forbidden this commit:** new product features; ticking this plan (Task 6).

- [x] **Step 1: Run grep-shaped acceptance (spec §7.1–7)**

```bash
# 1 — ariVersion: only BookingScreen wire + visually-hidden
rg 'ariVersion' apps/web-pms/src --glob '!**/*.{test,spec}.*'

# 2 — fail_closed: classify branches only; no JSX text node with word fail_closed
rg 'fail_closed' apps/web-pms/src --glob '!**/*.{test,spec}.*'

# 3 — idempotency: no user-facing string on happy-path files
rg 'idempotency' apps/web-pms/src --glob '!**/*.{test,spec}.*' \
  --glob '!**/use-folio-action-mutation.ts'

# 4 — billed party: none (placeholder humanized)
rg 'billed party' apps/web-pms/src

# 5 — user_owner: credential defaults only
rg 'user_owner' apps/web-pms/src

# 6 — prop_demo|rt_king: zero in web-pms src
rg 'prop_demo|rt_king' apps/web-pms/src --glob '!**/*.{test,spec}.*'

# 7 — paymentId: no JSX text {p.paymentId} on folio first paint (manual spot-check FolioScreen.tsx)
rg 'paymentId' apps/web-pms/src/screens/FolioScreen.tsx
```

Expectations documented in spec §7. Fix any regressions before Step 2.

- [x] **Step 2: Run web-pms test suite (or targeted superset)**

```bash
pnpm --filter @hospai/web-pms exec vitest run
```

- [x] **Step 3: Pin frozen heads**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG|post_demo_seed"
```

Expect: catalog **77**; route **[127] = post_demo_seed**; schema heads **25** / **7**.

- [x] **Step 4: Tick DEMO-READY P1 lab-copy checkbox (lines 242–243)**

Change `- [x] **Hide lab copy**` → `- [x]`.

- [x] **Step 5: Commit**

```bash
git add DEMO-READY.md
git commit -m "$(cat <<'EOF'
docs: tick DEMO-READY P1 hide lab copy row

Lab-copy census fixes merged; grep acceptance and vitest green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Tick this plan

**Spec:** plan housekeeping.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-hide-lab-copy.md` (checkboxes only)

**Forbidden this commit:** product code.

- [x] **Step 1: Re-run Task 5 grep if Tasks 1–4 landed in separate commits**

Confirm acceptance still green.

- [x] **Step 2: Tick every `- [x]` on Tasks 1–6 in this file**

Do not backfill other plans.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-14-hide-lab-copy.md
git commit -m "$(cat <<'EOF'
docs: tick P1 hide lab copy plan checkboxes after merge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Do not open card last-4, guest CRM depth, or night audit step rename without a new slice.

---

## Spec §10 reviewer checklist (copied; implementation must satisfy)

- [ ] Verified census §1.1 complete — visible vs not visible distinguished.
- [ ] Invariants: SPA-only, heads frozen, errors not hidden, testids stable, `/dev/ui` out, P0-3 voice reused.
- [ ] Happy-path priority matches script: sign-in → board → book → check-in → folio → housekeeping → night audit.
- [ ] `c.class` leak table addressed by §4.1 #5 (not just literal `fail_closed` string).
- [ ] Reg card print + check-in heading called out (dynamic `res_*` / `rt_*`).
- [ ] Scope-out names Worker, DevTools, testids, Advanced IA depth, separate P1 rows.
- [ ] Acceptance tests grep-shaped + RTL §7.
- [ ] Open questions §8 locked in plan D1–D6; night audit PRE_CHECK kept.
- [ ] Kill-list §4.2 in Task 4 (D6) — not deferred.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §4.1 #1 check-in heading guest name | 2 |
| §4.1 #2 folio header fallback | 3 |
| §4.1 #3 search meta + primary | 3 |
| §4.1 #4 guest-row pending labels | 3 |
| §4.1 #5 classified error mapping | 1 |
| §4.1 #6 booking idempotency / notepad | 3 |
| §4.1 #7 provisional queue messages | 3 |
| §4.1 #8 reg card Confirmation # + room type name | 2 |
| §4.1 #9 room-type fallbacks | 3 |
| §4.1 #10 queued commands panel | 3 |
| §4.1 #11 housekeeping title case | 3 |
| §4.2 kill-list Advanced / shift / directory / profile | 4 |
| §4.3 replacement copy sources | 1–3 |
| §5 file map | 1–5 |
| §6.1 folded items (census, DoD §6, P0-3 deferred row) | all |
| §6.2 deferred (card last-4, CRM, night audit rename, `/dev/ui`) | forbidden |
| §7.1–7 grep acceptance | 5 |
| §7.8–13 RTL / unit tests | 1–3 |
| §7.14 heads unchanged | 5 |
| §8 OQ #1 night audit wire names keep | D1 (no task) |
| §8 OQ #2 Confirmation # last 8 | 2 (D2) |
| §8 OQ #3 queued panel humanized | 3 (D3) |
| §8 OQ #4 HK title case | 3 (D4) |
| §8 OQ #5 helper web-pms local | 1 (D5) |
| §8 OQ #6 kill-list in PR | 4 (D6) |
| §9 implementation checklist | 1–6 |
| Invariant 1 SPA-only | all |
| Invariant 2 heads frozen | 5 |
| Invariant 9 night audit step names | D1 |
| Invariant 10 reg card print content | 2 |
| DEMO-READY P1 lab-copy tick | 5 |
| P0-3 deferred lab-copy row closed | 5 |
