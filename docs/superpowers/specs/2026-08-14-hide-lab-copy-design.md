# Hide lab copy (P1 leftover scan)

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P1 lab-copy row (242–243), definition of done §6 (286); [8-minute script](../../demo/8-minute-script.md) happy path + kill list; [prototype chrome (P0-3)](./2026-08-13-prototype-chrome-skin-design.md) §8, §13 row 3 (deferred lab-copy scan), §3.4 (no `user_owner` in footer); [folio first-paint (P0-2)](./2026-08-13-folio-first-paint-design.md) (Advanced collapsed; tenders not `paymentId`); `apps/web-pms/src/**` census (2026-08-14, non-test).

**Closes:** DEMO-READY P1 row *Hide lab copy leftover scan* (`ariVersion`, `fail_closed` strings, `idempotencyKey`, `billed party` placeholders, `user_owner` anywhere visible). Contributes to definition of done §6 (no `rt_king`, `prop_demo`, `paymentId` in the room — plus dynamic `res_*` / `gst_*` / wire `c.class` leaks found in census).

**Amends:** None. P0-3 deferred row 531 (*lab-copy scan stays until P1*) is **closed** by this chunk when implemented.

**Does not close:** P1 guest CRM depth, card last-4 / brand, one hotel voice; P0-5 script/dry runs; Worker/schema/catalog changes; `/dev/ui` gallery; sign-out; second property seed.

---

## 1. Context & Motivation

P0-1 through P0-5 and ui-kit batches 1–7 landed: named hotel, folio first-paint, prototype chrome, Clerk sign-in, and a written 8-minute script. The happy path already **looks** like a product. Remaining leaks are **operator/engineering vocabulary** painted as UI copy: wire reservation ids in headings, classified error class names in toast lines, `idempotency` in user-facing errors, registration-card print fields, and shell queued-command dumps.

This chunk is a **SPA copy + compose pass** only. It reuses existing human labels (`reservation-status-label.ts`, room **codes**, room-type **names**, guest display names). It does not invent a second voice. Functional errors stay visible — but as operator English, never as `fail_closed`, `provisional`, or raw `c.class`.

### 1.1 Verified census (2026-08-14 — every grep hit in `apps/web-pms/src`, non-test)

**Legend:** **Visible** = text a presenter or investor could read on screen or on a printed reg card during the demo. **Not visible** = wire/API, DevTools headers, `data-testid` / `aria-label` only, comments, or branch logic with operator English already painted. **Kill-list** = off the 8-minute path; fix if the same file is touched cheaply.

#### Summary counts

| Class | Rows in census | Action |
|---|---|---|
| **Visible — happy path** | **19** | Must fix (§4) |
| **Visible — kill-list / Advanced only** | **14** | Fix if cheap in same PR (§4.2) |
| **Not visible (false positive for UI scope)** | **58** | Leave; document so grep does not re-open |
| **Intentionally retained (P0-3 lock)** | **2** | Night audit step **wire names**; do not humanize unless reviewer overrides OQ §12 |

#### `ariVersion`

| File:line | Snippet / role | Class |
|---|---|---|
| `BookingScreen.tsx:173` | Read `availQ.data.ariVersion` for confirm gate | Not visible |
| `BookingScreen.tsx:220,237,271` | Confirm precondition / wire payload | Not visible |
| `BookingScreen.tsx:443–445` | `<p className="visually-hidden" data-testid="quote-version">{quoteAriVersion}</p>` | Not visible (P0-3 hidden hook) |

#### `fail_closed` (string literal in source — none painted as the word `fail_closed`)

| File:line | Snippet / role | Class |
|---|---|---|
| `GuestProfileScreen.tsx:122,125,162` | Classify query errors; paint **organization unreachable** / **Save failed.** | Not visible (`fail_closed` word absent) |
| `ExceptionsPanel.tsx:18–19,34` | Panel count error → **Exceptions unavailable — property unreachable** | Not visible |
| `AppShell.tsx:123–124,150` | Search error → **Search unavailable — property unreachable.** | Not visible |
| `ExceptionsScreen.tsx:423–424` | List error alert (kill-list route) | Kill-list; operator English OK |
| `GuestsDirectoryScreen.tsx:85–91` | Directory error alert | Kill-list |
| `RatesScreen.tsx:240–241,267` | Rates error alert | Kill-list |
| `use-folio-action-mutation.ts:24–25` | Maps to **Property unreachable.** | Not visible |
| `InventoryScreen.tsx:63,170–171,177` | Inventory alerts / helper | Kill-list |
| `SettingsScreen.tsx:286,333,337` | Settings alert | Kill-list |
| `StaffScreen.tsx:86,89` | Staff error helper | Kill-list |
| `BookingScreen.tsx:338–339` | **Property unreachable — booking refused (no walk-in notepad).** | **Visible** (happy path error — rewrite §4.1 #6) |
| `CheckInScreen.tsx:59–60,87–88` | Operator English (**Room assignment refused…** / **Check-in refused.**) | Not visible |
| `ShiftStrip.tsx:86–87` | **Shift unavailable — property unreachable** | Visible shell; operator English OK |
| `auth/me.ts:21` | Comment only | Not visible |
| `BoardScreen.tsx:267–269` | Board alert (Front Desk — off timed path) | Kill-list |
| `TapeChartScreen.tsx:205–208` | **Property unreachable — board cannot load…** | Visible on `/board` (happy path shell) — operator English OK |
| `ShiftScreen.tsx:90–91` | Shift alert | Kill-list |
| `ReservationsDirectoryScreen.tsx:193–195` | Directory alert | Kill-list |
| `FolioScreen.tsx:773–774` | **Folio unreadable — property unreachable** (+ optional policy reason) | Visible on `/folio/:id` error path — operator English OK (`packages/client-core/src/folio-action-policy.ts` never emits `fail_closed`) |
| `registration-card.tsx:59` | Unreachable muted line | Not visible on happy path |

**Related — `c.class` painted in UI (lab copy even when `fail_closed` word is absent):**

| File:line | Visible text pattern | Class |
|---|---|---|
| `BookingScreen.tsx:358` | `Booking failed (${code ?? c.class})` | **Visible** happy path |
| `BookingScreen.tsx:411` | `Availability unavailable (${availErrorClassified.class}).…` | **Visible** happy path |
| `CheckInScreen.tsx:63` | `Assign failed (${c.class})` | **Visible** happy path |
| `CheckInScreen.tsx:91` | `Check-in failed (${c.class})` | **Visible** happy path |
| `use-folio-action-mutation.ts:30` | `${fallback} (${c.class})` | **Visible** on folio mutation errors |
| `ShiftStrip.tsx:68` | `Open shift failed (${c.class})` | **Visible** shell |
| `ShiftScreen.tsx:80,156` | Close failed / load shift `({c.class})` | Kill-list |
| `InventoryScreen.tsx:64` | `Request failed (${c.class})` | Kill-list |
| `StaffScreen.tsx:92` | `Request failed (${c.class})` | Kill-list |

#### `idempotencyKey` / `idempotency`

| File:line | Snippet / role | Class |
|---|---|---|
| `BookingScreen.tsx:306–307` | **Booking conflict (idempotency). Do not retry…** | **Visible** happy path error |
| `use-folio-action-mutation.ts:21–22` | **An earlier submission of this form already posted…** (no word *idempotency*) | Not visible |
| `QueuedCommandsPanel.tsx:19–20` | `{e.commandId} · {e.idempotencyKey.slice(0, 8)}…` when panel open | **Visible** shell when queue non-empty |
| `FolioScreen.tsx:1154–1155,1165–1167` | Advanced queued lists | Kill-list (inside `folio-advanced`) |
| `HousekeepingApp.tsx:65,210,233` | Wire payload keys only | Not visible |
| `FolioScreen.tsx:1154+` keys in React `key=` | DOM keys only | Not visible |

#### `billed party` / `billedParty`

| File:line | Snippet / role | Class |
|---|---|---|
| `FolioScreen.tsx:81,590` | State + mutation wire | Not visible |
| `FolioScreen.tsx:1044–1047,1064–1067` | `placeholder="billed party"`, `aria-label="company-billed-party"` | Kill-list (Advanced / Open COMPANY) |

#### `user_owner`

| File:line | Snippet / role | Class |
|---|---|---|
| `FrontOfficeLive.tsx:174,186` | Default dev actor for seed/engineer paths | Not visible |
| `client.ts:18` | `VITE_DEV_ACTOR \|\| 'user_owner'` credential default | Not visible |

#### `rt_king` / `prop_demo` / `org_demo` (literal strings)

| Result | Class |
|---|---|
| **Zero hits** in `apps/web-pms/src` (non-test) | N/A — demo seed uses human names on rail (P0-1). Dynamic **`roomTypeId`** still renders on reg card print (below). |

#### `paymentId`

| File:line | Snippet / role | Class |
|---|---|---|
| `FolioScreen.tsx:302,335,425–645` | Mutation / state | Not visible |
| `FolioScreen.tsx:806–850` | Tender row text = **Card/Cash · amount**; `paymentId` only in `key`, `aria-label`, `data-testid` | Not visible (DoD §6: not in room) |
| Advanced capture/refund controls | `void-payment-${p.paymentId}` etc. | Kill-list; testid only |

#### `X-Dev-Actor` / `x-dev-actor` / dev-actor

| File:line | Snippet / role | Class |
|---|---|---|
| `dev-actor-credentials.ts:5` | Header builder | Not visible (DevTools only; P0-4) |
| `client.ts:12` | Import path | Not visible |
| `FrontOfficeLive.tsx:92` | Query key segment | Not visible |

#### `shiftId` (visible text)

| File:line | Snippet / role | Class |
|---|---|---|
| `ShiftStrip.tsx:44,98,114` | Wire / URL in `<Link to={/shift/…}>` | URL only — not link text |
| `ShiftStrip.tsx:160–161` | **Open shift · float … · cash posts …** (no id — P0-3) | Not visible |
| `ShiftScreen.tsx:110–116,191` | **Shift `{shiftId}`** heading + receipt `<dd>` | Kill-list |
| `App.tsx:57` | Route param | Not visible |

#### Raw `res_` / `gst_` / `rm_` (dynamic values — no literal `res_` in source)

| File:line | What renders | Class |
|---|---|---|
| `CheckInScreen.tsx:124` | `<h1>Check in {reservationId}</h1>` | **Visible** happy path |
| `FolioScreen.tsx:759` | Header fallback `{reservationId}` when no `guestRef` | **Visible** edge on `/folio/:id` |
| `registration-card.tsx:25` | **Confirmation {reservation.reservationId}** | **Visible on print** (check-in beat clicks print) |
| `registration-card.tsx:18,30` | Room fallback `roomId`; **Room type {roomTypeId}** | **Visible on print** (`rt_*` risk) |
| `AppShell.tsx:91` | Search primary = `guestRef` when no `displayName` | **Visible** shell |
| `guest-row.tsx:5,7,8,9` | `{guestRef} (name pending)` / `(erased)` / … | **Visible** when guest batch pending |
| `ReservationsDirectoryScreen.tsx:227,271` | Lead cell / link = `reservationId` | Kill-list |
| `GuestProfileScreen.tsx:321` | Stay link text = `reservationId` | Kill-list |
| `FolioScreen.tsx:1167` | Advanced queued **other** list | Kill-list |
| `BookingScreen.tsx:432` | Room-type radio label falls back to wire `id` if directory miss | **Visible** happy path (edge) |
| `TapeChartScreen.tsx:85` | `typeLabel` falls back to wire `id` | **Visible** on `/board` (edge if types GET fails) |

#### Other lab copy (not in DEMO-READY grep list but found in census)

| File:line | Snippet | Class |
|---|---|---|
| `AppShell.tsx:100` | Search meta includes raw `hit.status` wire | **Visible** shell |
| `CheckInScreen.tsx:95` | **Check-in queued (provisional). See session log below.** | **Visible** happy path (edge) |
| `FolioScreen.tsx:277,516` | **Charge queued (provisional).** | **Visible** folio edge |
| `BookingScreen.tsx:353`, `ShiftStrip.tsx:63`, `use-folio-action-mutation.ts:15` | **Requires permission ${perm}.…** | Visible on permission errors — **keep** (functional) |
| `HousekeepingApp.tsx:274–277,309–310,425–440` | Filter/status options **`clean`**, **`dirty`**, **`out_of_order`** | **Visible** happy path §5:30 |
| `NightAuditScreen.tsx:194,196` | Step **`PRE_CHECK`** … + status **`PENDING`/`RUNNING`/…** | **Intentionally retained** (P0-3 §8.6) |
| `NightAuditScreen.tsx:56–58` | Report id title-cased (**Revenue**) | OK |
| `FolioScreen.tsx:891` | Post charge default input **`MISC`** | OK (charge code, not wire id) |

### 1.2 What already exists (do not re-spec)

| Piece | Where (verified) |
|---|---|
| Status human labels | `apps/web-pms/src/status/reservation-status-label.ts` — used on board tables, directory, folio header |
| Room codes on stays | `listRooms` compose on board, folio, check-in picker, tape |
| Room type names on Book | `BookingScreen.tsx` `listRoomTypes` → name + code |
| Hidden `ariVersion` | `BookingScreen.tsx:443–445` visually hidden `quote-version` |
| Folio first-paint tenders | `tenderMethod()` → Card/Cash · amount (no `paymentId` text) |
| Advanced collapsed | `FolioScreen.tsx:976` `details[data-testid="folio-advanced"]` |
| Reg card screen clip | `styles.css:551–557` `@media screen` — blob not on screen until print |
| Shift badge without id | `ShiftStrip.tsx:160–161` (P0-3) |
| Property name on rail | `AppShell.tsx` `property-name` — not `prop_demo` |
| Sign-in surface | `SignInScreen.tsx` — no dev-actor copy |
| `/dev/ui` | `App.tsx:83` — **not** demo path; out of scope |

**Heads (this chunk does not move them):** `COMMAND_CATALOG` **77**, route audit **[127] = post_demo_seed**, `PROPERTY_SCHEMA_HEAD` **25**, `ORG_SCHEMA_HEAD` **7**, `NIGHT_AUDIT_STEPS` **7**.

### 1.3 What is broken today (motivation)

| # | Gap | Evidence | Symptom in the room |
|---|---|---|---|
| 1 | Check-in title is a wire id | `CheckInScreen.tsx:124` | Header reads `Check in res_…` |
| 2 | Classified class names leak to users | §1.1 `c.class` table | **Booking failed (fail_closed)** under stress |
| 3 | Engineering words in errors | `BookingScreen.tsx:307,339` | *idempotency*, *notepad* |
| 4 | Print reg card exposes wire ids | `registration-card.tsx:25,30` | Printed **`rt_king`** / **`res_…`** during check-in beat |
| 5 | Search paints wire status / guestRef | `AppShell.tsx:91,100` | Rail search shows **`confirmed`** / **`gst_…`** |
| 6 | Shell queue dumps command keys | `QueuedCommandsPanel.tsx:20` | **`post_folio_charge · a1b2c3d4…`** if queue opens |
| 7 | DoD §6 gaps beyond grep literals | Dynamic ids §1.1 | Investor sees **`res_*`** even when literals absent from source |

---

## 2. Invariants (normative)

1. **SPA-only.** Edits under `apps/web-pms/src/**` and shared **copy helpers** in `packages/client-core` only when an existing mapper already serves the SPA (e.g. extend error message helper — **no** new HTTP routes).
2. **Heads frozen** per §1.2. No catalog, schema, or seed changes.
3. **Do not hide functional errors.** Rewrite to operator English; do not swallow alerts or return empty error UI.
4. **Reuse P0-3 voice.** `reservationStatusLabel`, room **codes**, room-type **names**, `GuestNameLink` / batch guest display names — no new marketing tone.
5. **`data-testid` strings stay** unless a control is removed. Tests may update **copy matchers** and **visible text** assertions; do not rename folio/book/check-in testids.
6. **Advanced stays collapsed by default.** Kill-list internals may remain behind `folio-advanced`; humanize placeholders when touching Advanced anyway.
7. **`/dev/ui` untouched.**
8. **DevTools / headers out of scope.** `x-dev-actor`, `user_owner` in credentials never appear as painted UI copy.
9. **Night audit step wire names** (`PRE_CHECK`, …) stay unless reviewer resolves OQ §12 #1.
10. **Print reg card remains a print control** (screen clip unchanged). Print **content** may humanize room type and confirmation label (OQ §12 #2).

---

## 3. Scope in

1. **Happy-path screens (priority order):** `/sign-in` (verify only), `/board`, `/book`, `/check-in/:id`, `/folio/:id`, `/housekeeping`, `/night-audit`.
2. **Shell surfaces on every happy-path route:** ops-rail search, shift strip messages, queued-commands panel when non-empty, exceptions panel error copy (already operator English).
3. **Shared copy helpers:** centralize classified-error → user string mapping where duplicated (`BookingScreen`, `CheckInScreen`, `ShiftStrip`, `use-folio-action-mutation`).
4. **Registration card print fields** on check-in (and folio Advanced print block).
5. **Kill-list cheap fixes** in files already open for happy-path work (§4.2).
6. **DEMO-READY tick:** P1 lab-copy row in the implementation PR.

### 3.1 Scope out (normative)

- **Worker / PropertyDO / demo seed / schema / catalog.**
- **`/dev/ui` / `UiGallery.tsx`.**
- **DevTools Network tab** (`X-Dev-Actor`, `user_owner` header).
- **`data-testid` / `aria-label` values** that are not painted as visible text (e.g. `void-payment-pay_*`, `capture-amount-pay_*`).
- **Folio Advanced deep IA** (split, FX, transfer, chargeback) beyond placeholder/label humanization.
- **Exceptions workbench**, **Settings charge codes**, **Staff**, **Rates grid**, **Inventory** — unless §4.2 cheap pass.
- **Replacing night-audit step enum names** without reviewer override (P0-3 lock).
- **Card last-4 / brand** (separate P1 row).
- **New i18n framework.**

---

## 4. Decisions (normative)

### 4.1 Happy-path fixes (locked intent — implementer chooses exact strings)

| # | Surface | Today | Target |
|---|---|---|---|
| 1 | **Check-in title** `CheckInScreen.tsx:124` | `Check in {reservationId}` | **Check in {guest displayName}** from existing guest batch; if name pending use **Check in guest** — never wire id in heading |
| 2 | **Folio header** `FolioScreen.tsx:759` | Falls back to `reservationId` | Guest name link or **Guest** — omit id |
| 3 | **Search results** `AppShell.tsx:89–101` | `guestRef` primary; meta includes raw `status` | Primary = display name; meta uses `reservationStatusLabel(status)`; dates unchanged |
| 4 | **Guest pending labels** `guest-row.tsx:4–9` | `{guestRef} (name pending)` etc. | **Name pending** / **Guest unavailable** / **Guest erased** — no `gst_*` prefix |
| 5 | **Classified error leaks** | `… (${c.class})`, `… (${code ?? c.class})` | Map known classes to operator English; unknown → **Something went wrong — try again or ask a manager.** Never show `fail_closed`, `provisional`, `read_stale`, `forbidden` as raw tokens |
| 6 | **Booking idempotency / notepad** `BookingScreen.tsx:307,339` | *idempotency* / *notepad* | **This booking was already submitted — refresh and check arrivals.** / **Property unreachable — booking unavailable.** |
| 7 | **Provisional queue messages** `CheckInScreen.tsx:95`, `FolioScreen.tsx:277` | *provisional* | **Request queued — will apply when the property is reachable.** (no *session log* imperative on happy path) |
| 8 | **Reg card print** `registration-card.tsx` | Confirmation + room type wire ids | **Confirmation** may keep opaque id **or** show last 8 chars only (OQ §12 #2); **Room type** = human name from `listRoomTypes` (add query on check-in if needed — existing `listRoomTypes` API) |
| 9 | **Room-type fallbacks** `BookingScreen.tsx:432`, `TapeChartScreen.tsx:85` | Wire id when directory miss | Omit label or **Room type unavailable** — do not paint `rt_*` |
| 10 | **Queued commands panel** `QueuedCommandsPanel.tsx:20` | `commandId · idempotencyKey…` | **Queued action** + relative time or business date only — no command id or idempotency prefix |
| 11 | **Housekeeping status copy** `HousekeepingApp.tsx` | lowercase wire enums in filters/select | Title case labels (**Clean**, **Dirty**, **Inspected**, **Out of order**) — values stay wire for API |

### 4.2 Kill-list — fix if cheap (same PR, same files)

| Surface | Hits | Target |
|---|---|---|
| Folio Advanced | `billed party` placeholder, queued command lists, `Open COMPANY` button label | Placeholder **Company or agency name**; queued lines match §4.1 #10; button **Open company folio** |
| Shift receipt / close | `ShiftScreen.tsx:116,191` | **Shift receipt** / **Shift details** — hide raw `shiftId` in `<dd>` (show business date + float) |
| Reservations directory / guest profile | `reservationId` as link text | Link text **View folio** / dates; id not shown |
| Availability alert | `BookingScreen.tsx:411` | Covered by §4.1 #5 |

### 4.3 Replacement copy source (locked)

| Need | Source | Rejected |
|---|---|---|
| Reservation status | `reservationStatusLabel()` | Inline new maps |
| Room code | Existing `listRooms` maps | Raw `roomId` |
| Room type name | `listRoomTypes` (`name` / `code`) | Raw `roomTypeId` |
| Guest name | `postGuestsBatch` / `GuestNameLink` | Raw `guestRef` |
| Error classes | New small helper `apps/web-pms/src/copy/classified-user-message.ts` (name illustrative) | Duplicated switch per screen |

**No Worker widening** unless census finds a GET with no human field — none found; `listRoomTypes` + `listRooms` + guest batch suffice.

---

## 5. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `apps/web-pms/src/screens/CheckInScreen.tsx` | §4.1 #1, #8 (guest header; optional `listRoomTypes` for reg card) |
| `apps/web-pms/src/screens/registration-card.tsx` | §4.1 #8 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | §4.1 #2; §4.2 Advanced placeholders |
| `apps/web-pms/src/shell/AppShell.tsx` | §4.1 #3 |
| `apps/web-pms/src/screens/guest-row.tsx` | §4.1 #4 |
| `apps/web-pms/src/screens/BookingScreen.tsx` | §4.1 #5, #6, #9 |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | §4.1 #9 |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | §4.1 #5, #7 |
| `apps/web-pms/src/screens/use-folio-action-mutation.ts` | §4.1 #5, #7 |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | §4.1 #5 |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | §4.1 #10 |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | §4.1 #11 |
| `apps/web-pms/src/copy/classified-user-message.ts` (or equivalent) | **New** — shared error mapping |
| `apps/web-pms/src/screens/ShiftScreen.tsx` | §4.2 (optional) |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx`, `GuestProfileScreen.tsx` | §4.2 (optional) |
| Tests under `apps/web-pms/src/**/*.test.{ts,tsx}` | Copy matchers only |
| `DEMO-READY.md` | Tick P1 lab-copy row |

**Not touched:** `apps/pms-core/**`, `scripts/demo-seed.mjs`, `packages/contracts/**` (unless re-exporting a type — unlikely), `apps/web-pms/src/dev/**`, Clerk/auth providers.

---

## 6. Leftovers

### 6.1 Folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Census-driven lab copy sweep | DEMO-READY P1 |
| 2 | DoD §6 dynamic id leaks on happy path | Definition of done |
| 3 | P0-3 deferred lab-copy row | prototype-chrome §13 #3 |
| 4 | Classified-error operator English | `fail_closed` string scan intent |
| 5 | Tick DEMO-READY P1 lab-copy checkbox | This spec |

### 6.2 Deferred (explicitly out)

| # | Item | Notes |
|---|---|---|
| 1 | Card last-4 / brand on tenders | P1 separate row |
| 2 | Guest CRM depth | P1 separate row |
| 3 | Night audit step rename (`PRE_CHECK` → …) | P0-3 lock unless OQ resolved |
| 4 | Exceptions workbench command-type copy | Kill-list; heavy |
| 5 | Settings / Rates / Inventory lab labels | Kill-list |
| 6 | `/dev/ui` gallery | Not demo path |
| 7 | Hiding DevTools headers | P0-4 scope |

---

## 7. Tests (acceptance-shaped)

**Grep-shaped (happy-path source — non-test)**

1. `rg 'ariVersion' apps/web-pms/src --glob '!**/*.{test,spec}.*'` — only `BookingScreen.tsx` wire + visually-hidden node.
2. `rg 'fail_closed' apps/web-pms/src --glob '!**/*.{test,spec}.*'` — only classify branches; **no** JSX text node containing `fail_closed`.
3. `rg 'idempotency' apps/web-pms/src --glob '!**/*.{test,spec}.*'` — **no** user-facing string in happy-path files (`BookingScreen`, shell panels) except comments/types.
4. `rg 'billed party' apps/web-pms/src` — **none** (Advanced placeholder humanized) or only inside Advanced summary not visible when collapsed.
5. `rg 'user_owner' apps/web-pms/src` — credential defaults only.
6. `rg 'prop_demo|rt_king' apps/web-pms/src` — zero.
7. `rg 'paymentId' apps/web-pms/src --glob '!**/*.{test,spec}.*'` — no JSX text content `{p.paymentId}` on first-paint folio paths.

**Rendered copy (Vitest / RTL — update matchers)**

8. Check-in: `getByRole('heading', { name: /check in/i })` does **not** match `/res_/`.
9. Book: `queryByText(/ariVersion/i)` null; `queryByText(/idempotency/i)` null.
10. Folio first paint (Advanced collapsed): `queryByText(/paymentId/i)` null; tender list matches `/Card|Cash/i`.
11. Search: with mock hit `{ displayName: 'Maria', status: 'checked_in' }`, visible meta includes **In house**, not `checked_in`.
12. Reg card print DOM (simulate print media or unit test component props): room type line matches **King Deluxe** (or seeded name), not `rt_`.
13. Error mapping unit tests: `classifiedUserMessage({ class: 'fail_closed' }, 'Booking failed')` does **not** contain `fail_closed`.

**Heads unchanged**

14. Catalog **77**, route **[127]**, schema **25** / **7**.

**Manual (dry run — optional, not merge gate)**

15. Walk 8-minute script; kill list respected; no wire id spoken from UI; print reg card checked if beat performed.

---

## 8. Open questions (locked unless noted)

1. **Night audit step wire names (`PRE_CHECK`, …)?** **Default locked: keep** (P0-3 §8.6). Reviewer may unlock human labels in this chunk.
2. **Reg card confirmation line:** show full `reservationId`, truncated token, or **Confirmation number on file** without id? **Default: truncated last 8** + label **Confirmation #** for demo hotel legibility.
3. **Queued panel when non-empty during demo:** hide panel content entirely vs humanized line? **Default: humanized line** (§4.1 #10) so provisional path stays honest.
4. **Housekeeping status humanization:** title case only vs full labels (**Ready for guest**)? **Default: title case wire** (§4.1 #11).
5. **Shared error helper location:** `apps/web-pms/src/copy/` only vs also export from `client-core`? **Default: web-pms local** unless another app needs it.
6. **Kill-list directory/profile reservation links in this PR?** **Default: yes if file touched**; otherwise follow-up acceptable — note in PR description.

---

## 9. Implementation checklist (for the plan author; not a plan)

- [ ] Add shared classified-error → user message helper; wire Booking, Check-in, Folio mutations, ShiftStrip.
- [ ] Fix check-in heading + reg card room type name (compose `listRoomTypes`).
- [ ] Fix folio header fallback; search meta + guest pending labels.
- [ ] Humanize booking errors (idempotency, notepad, availability).
- [ ] Humanize queued-commands panel lines.
- [ ] Housekeeping status labels (title case).
- [ ] Optional kill-list pass §4.2.
- [ ] Update Vitest copy matchers; grep acceptance §7.
- [ ] Tick DEMO-READY P1 lab-copy row.
- [ ] Stop. No plan in spec turn. No commit in spec turn.

---

## 10. Reviewer checklist

- [ ] Verified census §1.1 complete — every listed grep pattern has file:line rows; visible vs not visible distinguished.
- [ ] Summary counts plausible: **~19** happy-path visible, **~58** false positives, **~14** kill-list.
- [ ] Invariants: SPA-only, heads frozen, errors not hidden, testids stable, `/dev/ui` out, P0-3 voice reused.
- [ ] Happy-path priority matches script: sign-in → board → book → check-in → folio → housekeeping → night audit.
- [ ] `c.class` leak table addressed by §4.1 #5 (not just literal `fail_closed` string).
- [ ] Reg card print + check-in heading called out (dynamic `res_*` / `rt_*`).
- [ ] Scope-out names Worker, DevTools, testids, Advanced IA depth, separate P1 rows.
- [ ] Acceptance tests grep-shaped + RTL §7.
- [ ] Open questions §8 present; night audit PRE_CHECK default locked.
- [ ] Status **Draft** — not Approved; no plan; no code in spec-authoring turn.
