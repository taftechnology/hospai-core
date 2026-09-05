# Operator SPA UX + UI (R0.11)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 11](../../audit/2026-09-04-full-codebase-audit.md) (**U4–U17**, **I1–I15**, **E3**, **Q4**, **Q18**, **Q19**, **L12**); [AGENTS.md §4 SPA](../../../AGENTS.md); [`.cursor/rules/spa-page-chrome.mdc`](../../../.cursor/rules/spa-page-chrome.mdc); [SPA page-shell consistency](./2026-08-16-spa-page-shell-consistency-design.md); [UI system convergence](./2026-08-13-ui-system-convergence-design.md); [Audit Phase E — user-facing](./2026-08-15-audit-phase-e-user-facing-design.md) (**E3** remainder); `apps/web-pms/src/shell/LogoutModal.tsx` (`.app-modal` reference); `packages/ui-kit/src/Layout.tsx` (`VisuallyHidden`).

**Closes:** Audit **U4–U17**, **I1–I15**, **E3** (folio mutation `<Alert>` remainder), **Q4** (Room Plan fail-closed), **Q18** (Shift close + BoardGroup bare `<p>`), **Q19** (statement / exceptions raw JSON), **L12** (hide unread Booking settings). **Roadmap:** **R0.11**. **Requires:** R0.10 HTTP error contracts landed (SPA may now rely on stable `{ ok: false, error }` / gate shapes). **Does not** advance R0.14 early-departure command, Playwright, `tokens.css` / `styles.css` visual rewrite, occupancy trend colors, new HTTP routes, catalog pin bumps, or PropertyDO extraction.

---

## Executive summary

Vertical 11 closes the operator SPA audit bucket: one accessible page shell, one confirm overlay, operator-grade error copy, honest Settings, and clerk-safe checkout messaging — **without** restyling the 1,943-line stylesheet or inventing a fourth dialog system.

Today the desk still paints rate-matrix labels in every cell (`RatesScreen.tsx:157–186`), uses two competing `<h1>` landmarks (sidebar brand + `PageHeader`), hardcodes “The Meridian Seattle” on four directory screens, mixes three overlay patterns (`Card role=dialog`, native `<dialog>`, `.app-modal`), leaves night-audit Run silently disabled, prints folio chrome alongside `.reg-card`, shows raw JSON on city-ledger and exceptions paths, and gates Roster nav on `roster:write` so read-only staff never see the page. Folio mutations still land in a bare `<p data-testid="folio-message">` (**E3** partial).

This spec locks **nine work packages** in reviewer order. Shared primitives land first (`VisuallyHidden` rate cells, live `property.name` subtitles, `ConfirmDialog` on `.app-modal`). Screen sweeps follow: night audit + print CSS + void confirm; hide four unread Booking settings keys; checkout remaining-nights **warning only** (no `sold` release — **L6 / R0.14** owns inventory); `classifiedUserMessage` + `Alert` everywhere listed; desk polish (HK label, FAIL_CLOSED disables, roster nav, permission toast, badges, back copy). **Tests land with each package**; characterization must not encode today’s bugs as expected.

---

## Locked product call

### Reviewer locks (normative — do not bounce)

| Lock | Decision |
|---|---|
| **I1 RateCell** | Matrix cell `Field` label via ui-kit `VisuallyHidden` (same pattern as `GuestsDirectoryScreen.tsx:158`). Visible cell shows numbers only. |
| **I2 I4 I5 Page chrome** | Sidebar brand is `<p className="app-sidebar-title">`, not `<h1>` (`AppShell.tsx:283`). Each route’s **single** `<h1>` is `PageHeader`. Board modes: **Arrivals** / **Departures** / **In house** — not all “Front Desk”. Every `PageHeader` subtitle that names the hotel uses live `property.name` from `getProperty`; delete hardcoded “The Meridian Seattle”. |
| **I3 One Dialog** | One overlay: `.app-modal` (see `LogoutModal.tsx`). Migrate **in this vertical:** `RatesScreen` archive `Card role=dialog`, `GuestProfileScreen` erase overlay, `ExceptionsScreen` native `<dialog>`. Focus first control; Escape closes; body scroll lock. **Do not** add a fourth overlay primitive. `window.confirm` on folio / staff / roster **may** migrate to `ConfirmDialog` in the same vertical but **after** the three broken overlays; void invoice / void payment **must** use `ConfirmDialog` with `intent=destructive` (**U6**). |
| **U4 U5 U6 Night audit + print + void** | `NightAuditScreen`: mutation success/failure → `Alert`; when Run disabled because `businessDate >= today` (or halted / running / no TZ), show **why** adjacent to the button. Print CSS: `@media print` hides everything except `.reg-card` (today hides sidebar but **not** folio/check-in body). Registration card never prints `reservation.roomId` UUID — room **code** only. Confirm before Void (invoice + folio payment void). |
| **U7 / L12 Booking settings** | Hide Settings controls for keys pms-core never reads: `pms.booking.same_day_bookings`, `pms.booking.same_day_cutoff`, `pms.booking.require_prepayment`, `pms.booking.booking_date_change`. **Do not wire them.** Wiring is R1.20 / booking remainder — hide until then. |
| **U17 Checkout warning** | If `departureDate > businessDate` at checkout attempt: show `Alert` (informational): “Checkout does not release remaining nights — shorten the stay first.” Proceed with checkout if clerk confirms (existing balance/invoice gates unchanged). **Do not** change `departure_date` or release `sold` in the SPA (**L6 / R0.14**). |
| **classifiedUserMessage + Alerts** | Replace `JSON.stringify(err.classified.body)`, `` `Request failed (${c.class})` ``, and bare mutation `<p>` with `classifiedUserMessage` + ui-kit `Alert` on: CityLedger, Staff, Inventory, Folio (`folio-message`), Shift close + load (**Q18**), BoardGroup empty/error (**Q18**), Room Plan fail-closed (**Q4**). Statement / exceptions detail: structured fields, not raw JSON (**Q19**). Tenders card → `DataTable`. Directory loading → `Skeleton`; empty lists → `EmptyState`. All Void actions → `intent=destructive`. |
| **U9–U16 / I10–I15 polish** | HK Assign field helper: “Assignment only — use Status for clean/dirty.” Book: when any prerequisite query is `fail_closed`, disable Hold / Quote / Confirm with `Alert` reason. Night audit step column: human `STEP_LABELS` map; halt copy: review failed step → Retry → Resume. Guest list cells: display name only (id in `title` / `data-testid`). Book guest search: “Searching…” / “No guests match”. Exceptions: query error ≠ filter-empty copy. Permission miss: toast “You don’t have access to that page.” — not silent redirect. **Roster:** nav + route gate on `roster:read`; mutations still require `roster:write`. Search fields: explicit `aria-label`. One visually-hidden class: **`ui-visually-hidden`** via `VisuallyHidden` — retire ad-hoc `.visually-hidden` where touched. Unwrap redundant `.ui-table-scroll` around `DataTable` when double-scrolling. VIP / DND → `Badge` on reg card + front-office editor. Back links: drop `←` prefix; folio back context-aware (not always “In house”). Distinct roster nav icon (not same glyph as Staff if ambiguous). Checkbox disabled opacity: align to button disabled token when touching checkbox styles (**I9** bundle). |
| **I13 Sign-in MFA** | Keep sign-in marketing column. Drop sentence “Use the demo user.” (`SignInScreen.tsx:125`). Do **not** copy sign-in shadows into `AppShell`. |
| **Out** | Restyle `tokens.css` / global visual rewrite; Playwright; occupancy chart colors; extract housekeeping kit; new routes/commands; catalog/schema pin changes; release `sold` on checkout; wire unread Booking keys. |
| **Pins** | Frozen at **89** / **144** / **34** / **9** / **8**. |
| **Tests** | RateCell no visible “Rate for {code}”; print CSS hides non-`.reg-card`; `front-office-editor` + `registration-card` with this vertical (**G11**). |

---

## 1. Problem / evidence

### 1.1 I1 — Rate matrix labels paint in every cell (medium)

```157:186:apps/web-pms/src/screens/RatesScreen.tsx
    <Field
      label={`Rate for ${props.code}`}
      control={
        <Input
          value={raw}
          ...
        />
      }
    />
```

ui-kit `Field` always renders a visible `<label>`. The rates matrix becomes unreadable body text per cell. `GuestsDirectoryScreen` already wraps search label in `VisuallyHidden` — same fix here.

### 1.2 I2 / I4 / I5 — Two h1 landmarks and hardcoded hotel (medium)

```281:284:apps/web-pms/src/shell/AppShell.tsx
            <div className="app-sidebar-brand">
              <span className="app-sidebar-mark">✦</span>
              <h1 className="app-sidebar-title">HospAI <span>PMS</span></h1>
```

```610:615:apps/web-pms/src/screens/BoardScreen.tsx
      <PageHeader
        title="Front Desk"
        subtitle={
          headerDate
            ? `${formatLongDate(headerDate, timeZone ?? 'UTC')} · arrivals and departures for the business date`
```

Board combined view uses “Front Desk” for all three routes; per-mode titles already exist inside section cards (`Arrivals` / `Departures` / `In House`) but **page** `<h1>` does not match route (**I5**). Hardcoded subtitles: `StaffScreen.tsx:293`, `RosterScreen.tsx:134`, `ExceptionsScreen.tsx:306`, `GuestsDirectoryScreen.tsx:153`.

### 1.3 I3 — Three overlay patterns (medium)

| Location | Pattern today |
|---|---|
| `RatesScreen.tsx:1153` | `<Card role="dialog" aria-modal="true">` |
| `GuestProfileScreen.tsx:378` | `<div role="dialog" aria-modal="true">` (no backdrop CSS) |
| `ExceptionsScreen.tsx:692` | `<dialog open>` (zero theme CSS) |
| `LogoutModal.tsx` | `.app-modal` + portal + Escape (reference) |

Adding a ui-kit `Dialog` component is **out of scope** — standardize on existing `.app-modal` CSS in `styles.css:1683+`.

### 1.4 U4 — Night audit silent disabled Run (medium)

```122:127:apps/web-pms/src/screens/NightAuditScreen.tsx
  const runDisabled =
    !status ||
    status.halted ||
    anyRunning ||
    today == null ||
    status.businessDate >= today;
```

Button renders `disabled={runDisabled}` with no operator-facing reason. Step column shows wire ids (`POST_ROOM_CHARGES`) not clerk labels.

### 1.5 U5 / I6 — Print CSS leaks folio chrome (medium)

```825:844:apps/web-pms/src/styles.css
@media print {
  aside,
  .app-sidebar,
  ...
  { display: none !important; }

  .reg-card {
    position: static;
    ...
  }
}
```

Sidebar hides; **main folio / check-in content still prints**. `RegistrationCard` falls back to `reservation?.roomId` when `roomLabel` omitted (`registration-card.tsx:20`).

### 1.6 U7 / L12 — Inert Booking settings (medium)

```734:754:apps/web-pms/src/screens/SettingsScreen.tsx
                  configKey="pms.booking.same_day_bookings"
                  ...
                  configKey="pms.booking.require_prepayment"
                  ...
                  configKey="pms.booking.booking_date_change"
```

Keys persist via Settings but pms-core booking path does not read them (**AGENTS.md** Settings honesty rule).

### 1.7 U17 — Checkout vs remaining nights (high UX / inventory boundary)

`tryCheckOut` does **not** release `sold` for nights after early departure (**ARCHITECTURE.md** §7.1; audit **L6**). SPA checkout (`FolioScreen.tsx:712–745`) has no warning when `departureDate > businessDate`. Clerks may assume inventory freed.

### 1.8 E3 / Q4 / Q18 / Q19 — Error channel gaps (mixed)

| ID | Evidence |
|---|---|
| **E3** | `FolioScreen.tsx:1642` — `{message ? <p data-testid="folio-message">…` |
| **Q4** | `TapeChartScreen.tsx:297` — `<div className="error">` not ui-kit `Alert` |
| **Q18** | `ShiftScreen.tsx:181` load error bare `<p>`; `BoardScreen.tsx:306,349,357` section empty/error `<p className="muted">` |
| **Q19** | `CityLedgerScreen.tsx:147,173,196,224` — `JSON.stringify(err.classified.body)`; `ExceptionsScreen.tsx:604` — `<pre>{JSON.stringify(detail.exception.payload)}` |
| **Staff/Inventory** | Local helpers return `` `Request failed (${c.class})` `` (`StaffScreen.tsx:103`, `InventoryScreen.tsx:109`) |

### 1.9 U16 — Roster nav over-gated (medium)

```25:25:apps/web-pms/src/shell/nav.ts
  { id: 'roster', label: 'Roster', path: '/roster', order: 120, permission: 'roster:write', tone: 'quiet' },
```

```64:64:apps/web-pms/src/App.tsx
            <Route path="roster" element={<PermissionRoute permission="roster:write" />}>
```

Read-only roster staff (`roster:read` without `roster:write`) cannot see schedule — contradicts property-scoped read model.

### 1.10 I13 — Demo MFA copy (low)

```125:125:apps/web-pms/src/screens/SignInScreen.tsx
        setError('This account needs a second step. Use the demo user.');
```

Test `SignInScreen.test.tsx:178` encodes this string today — update in same commit.

---

## 2. Design

### 2.1 Shared primitives (land first)

#### 2.1.1 `ConfirmDialog`

Extract from `LogoutModal` pattern into `apps/web-pms/src/shell/ConfirmDialog.tsx`:

- Props: `title`, `description`, `confirmLabel`, `cancelLabel`, `intent?: 'destructive' | 'primary'`, `onConfirm`, `onCancel`.
- Renders `.app-modal` via `createPortal`; `useEffect` body scroll lock; Escape → cancel; autofocus first focusable (cancel button default).
- **Not** a ui-kit export — stays web-pms shell.

#### 2.1.2 `usePropertySubtitle`

Small hook in `apps/web-pms/src/shell/use-property-subtitle.ts`:

- `useQuery(['property', propertyId], () => api.getProperty(propertyId), { staleTime: 60_000 })`.
- Returns `{ name: string | null, failClosed: boolean }`.
- Screens use `` subtitle={`Guest directory${name ? ` · ${name}` : ''}`} `` — omit name segment when `failClosed` (wordmark-only per `AppShell.me.test.tsx` contract).

#### 2.1.3 Night audit `STEP_LABELS`

Add `apps/web-pms/src/copy/night-audit-step-labels.ts` mirroring server `NIGHT_AUDIT_STEPS` order (read-only; **do not** import from pms-core):

| Wire step | Label |
|---|---|
| `PRE_CHECK` | Pre-check |
| `AUTO_NO_SHOW` | Auto no-show |
| `POST_ROOM_CHARGES` | Post room charges |
| `AUTO_TRANSFER` | Auto transfer |
| `CLOSE_FOLIOS` | Close folios |
| `SHIFT_RECONCILE` | Shift reconcile |
| `GENERATE_REPORTS` | Generate reports |
| `ROLL_BUSINESS_DATE` | Roll business date |

Halt helper copy (static `Alert` when `status.halted`): “Night audit stopped on a failed step. Review the error below, use **Retry** on that step, then **Resume** when ready.”

#### 2.1.4 Print CSS contract

Extend `@media print` in `apps/web-pms/src/styles.css`:

```css
@media print {
  body * {
    visibility: hidden;
  }
  .reg-card,
  .reg-card * {
    visibility: visible;
  }
  .reg-card {
    position: absolute;
    inset: 0;
    /* existing unclip rules */
  }
}
```

Alternative acceptable if equivalent: `display:none` on `.app-main > *:not(.reg-card-print-root)` — but **only** `.reg-card` content may appear on paper.

`RegistrationCard`: require `roomLabel` for print-enabled paths; when only UUID known, print button stays disabled and card omits room line (never UUID).

### 2.2 Work packages (implementation order)

| Pkg | IDs | Summary |
|---|---|---|
| **P1** | I1 | `RateCell`: `label={<VisuallyHidden>{`Rate for ${code} on ${stayDate}`}</VisuallyHidden>}`. |
| **P2** | I2, I4, I5 | Sidebar `<p>`; Board `PageHeader` title from `board-mode.ts`; live property subtitles on Staff, Roster, Exceptions, Guests, Board (property name in subtitle where hotel named). |
| **P3** | I3, U6 (partial) | `ConfirmDialog`; migrate Rates archive, Guest erase, Exceptions confirm; void invoice + void payment confirm. |
| **P4** | U4, U5, I6, U6 | Night audit Alerts + disabled reason; print CSS; reg-card room code; void destructive intent. |
| **P5** | U7, L12 | Remove four Booking settings field groups from `SettingsScreen` (not `EXCLUDED` — simply unrender). Update `SettingsScreen.test.tsx` if it asserted those keys visible. |
| **P6** | U17 | Folio checkout: if `res.departureDate > businessDate`, render persistent informational `Alert` above Check out; optional second `ConfirmDialog` acknowledging remaining nights before proceeding (copy must include locked warning sentence). **No** API payload change. |
| **P7** | U11, E3, Q4, Q18, Q19, I7, I8, I9 | Error/copy sweep (§2.3). |
| **P8** | U9–U16, I10–I15 | Desk polish (§2.4). |
| **P9** | I13 | Sign-in MFA string. |

### 2.3 P7 — Error, Alert, and data presentation

**Replace local error helpers** on `StaffScreen` and `InventoryScreen` with `classifiedUserMessage(c, { fallback })` — delete `staffErrorMessage` / inventory equivalent.

**CityLedgerScreen:** all mutation `onError` paths use `classifiedUserMessage`; statement preview renders table of known snapshot keys (reuse `REPORT_KEY_LABELS` pattern from night audit) — remove `statementJson` `<pre>` state.

**FolioScreen:**

- `{message ? <Alert data-testid="folio-message">…</Alert> : null}`.
- Tenders `<ul>` → `DataTable` with columns: Method, Amount, Status, Actions (capture/refund/void controls in last column).
- Void payment button: `intent="destructive"` + `ConfirmDialog`.

**TapeChartScreen:** replace `<div className="error">` with `<Alert>`; use `classifiedUserMessage` for `ClassifiedError`.

**ShiftScreen / ShiftStrip:** load and close errors → `Alert` (close mutation message already uses `setMessage` — render as `Alert`).

**BoardScreen `SectionCard` / `BoardGroup`:** error → `Alert`; empty section → `EmptyState` (“None due out”) not bare `<p className="muted">`.

**ExceptionsScreen:** exception payload → key/value `DataTable` or definition list; redact binary blobs; never `<pre>{JSON.stringify(…)}`.

**Directories** (Guests, Reservations, Inventory lists where touched): loading `Skeleton`; zero rows `EmptyState` with screen-specific copy.

### 2.4 P8 — Desk polish detail

**U9 — Housekeeping** (`modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`): append muted helper under Assignment filter: “Assignment only — use Status for clean/dirty.”

**U10 — Booking** (`BookingScreen.tsx`): derive `bookFailClosed` from any of `listRoomTypes`, `getAvailability`, `listRatePlans` queries with `classified.class === 'fail_closed'`. When true: disable Hold, Quote, Confirm; show `Alert` “Booking unavailable — property unreachable.” Update test `FAIL_CLOSED room-types still lists ids and does not block Confirm` → **must expect Confirm disabled** (characterization fix).

**U12 — Night audit:** use `STEP_LABELS` in step column; keep wire id in `title` attribute for support.

**U13 — Guest list:** board / directory name cells show `guestLabel` only; guest ref on `data-testid={`guest-row-${guestRef}`}` or link `title={guestRef}`.

**U14 — Book search:** when `guests-search` query pending → “Searching…”; success + empty → “No guests match”.

**U15 — Permission toast:** extend `PermissionRoute` (or thin wrapper) to call ui-kit toast / inline flash: on deny, toast “You don’t have access to that page.” then `Navigate` to fallback. Add test in `PermissionRoute.test.tsx`.

**U16 — Roster nav:** `nav.ts` permission → `roster:read`; `App.tsx` route → `<PermissionRoute permission="roster:read" />`; write actions inside `RosterScreen` stay gated on `hasPropertyPermission(me, 'roster:write')`.

**I10 — Search aria-label:** AppShell reservation search already unlabeled placeholder — add `aria-label="Search reservations"`. Book guest find field: `aria-label="Find guest"`.

**I11 — Visually hidden:** replace `.visually-hidden` divs with `VisuallyHidden` / `ui-visually-hidden` in files touched (TapeChart live region, Booking quote version, Exceptions select header).

**I12 — Table scroll:** remove wrapper `<div className="ui-table-scroll">` when parent `CardContent flush` already scrolls (`FolioScreen`, `TapeChartScreen`) — one scroll container.

**I14 — VIP / DND:** `RegistrationCard` and `front-office-editor.tsx` show `Badge rung="attention"` for VIP, `Badge rung="neutral"` for DND instead of plain `<p>`.

**I15 — Back copy + icons:** PageHeader `back={<Link to="…">Guests</Link>}` (no arrow). Folio back: link to `/departures` when status `checked_in` and business date matches departure context, else `/in-house` — spec locks **minimum**: not always “In house”; use `Referrer` or reservation status heuristic. Add `RosterIcon` distinct from `UserIcon` in `icons.tsx` if calendar icon too close to reservations — **locked:** roster uses dedicated icon (e.g. calendar-with-users glyph); staff keeps `UserIcon`.

### 2.5 ConfirmDialog migration scope (I3 follow-through)

| Current | Target |
|---|---|
| `FolioScreen` balance override `window.confirm` | `ConfirmDialog` (non-destructive) |
| `FolioScreen` void invoice / close window | `ConfirmDialog` destructive where irreversible |
| `StaffScreen` demote/remove confirms | `ConfirmDialog` |
| `RosterScreen` exit confirm | `ConfirmDialog` |
| `CityLedgerScreen` archive confirm | `ConfirmDialog` destructive |

Native `window.confirm` must not remain on void paths after P3.

---

## 3. Implementation notes

### 3.1 Dependency order

```
P1 (RateCell) ─┐
P2 (chrome)  ─┼─► P3 (ConfirmDialog) ─► P4 (night audit + print)
P9 (sign-in)  │         │
              └─────────┴─► P5 (settings hide) ─► P6 (checkout warn)
                                    │
                                    └─► P7 (errors) ─► P8 (polish)
```

P2 and P1 parallel OK. P3 blocks void confirm in P4. P7 may start after P2 (needs `Alert` patterns only).

### 3.2 Pins / gates

| Pin | This vertical |
|---|---|
| `COMMAND_CATALOG` | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | **8**; `[3] === 'AUTO_TRANSFER'` |

Full gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` (8 shards; never `--` before `--shard`). Also `pnpm check:spa-page-chrome` when `PageHeader` / board titles change.

### 3.3 Roadmap tick

Tick **R0.11** only when P1–P9 acceptance criteria pass and full gate green. Do **not** tick R2.2–R2.4 separately — those Track 2 items overlap; R0.11 is the audit closure.

---

## 4. Test matrix

| # | File | Setup | Action / assert | Expect (fixed code) |
|---|---|---|---|---|
| T1 | `RatesScreen.test.tsx` | Render matrix tab with room types | Inspect rate cells | No visible text matching `/Rate for /`; `VisuallyHidden` label in a11y tree |
| T2 | `RatesScreen.test.tsx` | Existing matrix edit test | Blur cell after edit | `putRateDay` still called (regression) |
| T3 | `AppShell.me.test.tsx` | fail_closed property | Boot shell | Sidebar brand is `<p>`, not `<h1>` |
| T4 | `BoardScreen.test.tsx` | `/arrivals`, `/departures`, `/in-house` routes | Read `PageHeader` h1 | Titles **Arrivals** / **Departures** / **In house** respectively |
| T5 | `StaffScreen.test.tsx` | Mock property name | Render | Subtitle contains live name; not “Meridian Seattle” |
| T6 | `RosterScreen.test.tsx` | same | same | same |
| T7 | `GuestsDirectoryScreen.test.tsx` | same | same | same |
| T8 | `ExceptionsScreen.test.tsx` | same | same | same |
| T9 | `registration-card.test.tsx` **new** | Render card with UUID-only room | Print CSS class audit | DOM includes no UUID string in `.reg-card`; print stylesheet hides non-reg-card (stylesheet snapshot or JSDOM `@media` rule grep) |
| T10 | `registration-card.test.tsx` | roomLabel=`101` | Text content | Shows `Room 101` |
| T11 | `CheckInScreen.test.tsx` / `FolioScreen.test.tsx` | Extend existing print tests | `window.print` mock | Only `.reg-card` visible content in print fixture (extend existing tests 12–14) |
| T12 | `NightAuditScreen.test.tsx` | `businessDate >= today` | Render | Disabled Run + visible reason string |
| T13 | `NightAuditScreen.test.tsx` | Mock run mutation error | Click Run | `Alert` with classified copy |
| T14 | `NightAuditScreen.test.tsx` | Status with steps | Step column | Clerk label “Post room charges”, not bare wire id |
| T15 | `FolioScreen.test.tsx` | `departureDate` future vs business date | Render checkout | Warning `Alert` with locked sentence |
| T16 | `FolioScreen.test.tsx` | Void invoice flow | Click void | `ConfirmDialog` destructive; no `window.confirm` |
| T17 | `FolioScreen.test.tsx` | Mutation error | Post charge fail | `folio-message` is `Alert`, not `<p>` |
| T18 | `FolioScreen.test.tsx` | Tenders populated | Render | `DataTable` rows, not `<ul>` |
| T19 | `SettingsScreen.test.tsx` | Load booking section | Query DOM | Four L12 keys **absent** |
| T20 | `BookingScreen.test.tsx` | FAIL_CLOSED availability | Render actions | Hold/Quote/Confirm disabled + `Alert` |
| T21 | `TapeChartScreen.test.tsx` | FAIL_CLOSED tape | Render | ui-kit `Alert`, not `.error` |
| T22 | `ShiftScreen.test.tsx` | Load error | Render | `Alert` without ``Request failed`` token |
| T23 | `BoardScreen.test.tsx` | Empty departures section | Render | `EmptyState` or non-muted empty copy per Q18 |
| T24 | `CityLedgerScreen.test.tsx` | Create failure with body | Assert message | No `JSON.stringify`; uses classified copy |
| T25 | `ExceptionsScreen.test.tsx` | Open detail | Payload region | No raw JSON `<pre>` |
| T26 | `PermissionRoute.test.tsx` | `roster:read` only | Navigate `/roster` | Route renders; toast fired on deny for `/staff` without perm |
| T27 | `me.test.ts` | `roster:read` without write | `filterNavEntries` | Roster nav visible |
| T28 | `SignInScreen.test.tsx` | MFA error path | Trigger | Copy lacks “demo user” |
| T29 | `front-office-editor.test.tsx` **new** | VIP + DND true | Render | Two `Badge` components |
| T30 | `HousekeepingApp.test.tsx` | Default render | Assignment section | Helper text present |
| T31 | `InventoryScreen.test.tsx` | List error | Render | No ``Request failed (${class})`` |

Tests **T1, T4, T5–T8, T12, T15, T19, T20, T26–T28** should **fail on current `main`** before implementation.

---

## 5. Verify commands

Package-focused:

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/RatesScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/NightAuditScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/SettingsScreen.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/ShiftScreen.test.tsx \
  src/screens/CityLedgerScreen.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/SignInScreen.test.tsx \
  src/auth/PermissionRoute.test.tsx \
  src/auth/me.test.ts \
  src/screens/registration-card.test.tsx \
  src/screens/front-office-editor.test.tsx
```

Module:

```bash
pnpm --filter @hospai/pms-housekeeping exec vitest run \
  src/ui/HousekeepingApp.test.tsx
```

Full gate after all packages:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
pnpm check:spa-page-chrome
```

---

## 6. Files in scope

| File | Change |
|---|---|
| `apps/web-pms/src/shell/ConfirmDialog.tsx` | **New** — shared `.app-modal` confirm |
| `apps/web-pms/src/shell/use-property-subtitle.ts` | **New** — live hotel name |
| `apps/web-pms/src/copy/night-audit-step-labels.ts` | **New** — clerk step labels |
| `apps/web-pms/src/shell/AppShell.tsx` | I2 sidebar brand `<p>` |
| `apps/web-pms/src/shell/icons.tsx` | I15 distinct roster icon |
| `apps/web-pms/src/shell/nav.ts` | U16 roster `roster:read` |
| `apps/web-pms/src/auth/PermissionRoute.tsx` | U15 toast on deny |
| `apps/web-pms/src/App.tsx` | U16 roster route permission |
| `apps/web-pms/src/styles.css` | U5 print CSS; I11 visually-hidden cleanup |
| `apps/web-pms/src/screens/RatesScreen.tsx` | I1, I3 archive dialog |
| `apps/web-pms/src/screens/BoardScreen.tsx` | I5 titles, Q18 EmptyState/Alert |
| `apps/web-pms/src/screens/StaffScreen.tsx` | I4 subtitle, I7 errors, I3 confirm |
| `apps/web-pms/src/screens/RosterScreen.tsx` | I4 subtitle, I3 confirm |
| `apps/web-pms/src/screens/ExceptionsScreen.tsx` | I4 subtitle, I3/I7, Q19 payload |
| `apps/web-pms/src/screens/GuestsDirectoryScreen.tsx` | I4 subtitle |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | I3 erase dialog |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | U4, U12 labels + halt copy |
| `apps/web-pms/src/screens/registration-card.tsx` | U5/I6 room code, I14 badges |
| `apps/web-pms/src/screens/FolioScreen.tsx` | U6, U17, E3, tenders table, back copy |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | U5 print path, I15 back copy |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | U7/L12 hide four keys |
| `apps/web-pms/src/screens/BookingScreen.tsx` | U10 FAIL_CLOSED, U14 search copy |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | Q4 Alert, I12 scroll |
| `apps/web-pms/src/screens/CityLedgerScreen.tsx` | U11/Q19 errors + statement |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | U11 errors, EmptyState/Skeleton |
| `apps/web-pms/src/screens/ShiftScreen.tsx` | Q18 Alert |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | Q18 Alert (if bare `<p>` remains) |
| `apps/web-pms/src/screens/front-office-editor.tsx` | I14 badges, E3 Alert on save fail |
| `apps/web-pms/src/screens/SignInScreen.tsx` | I13 MFA copy |
| `apps/web-pms/src/screens/guest-row.tsx` | U13 name-only display |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | U9 assign helper |
| `apps/web-pms/src/screens/RatesScreen.test.tsx` | T1–T2 |
| `apps/web-pms/src/screens/BoardScreen.test.tsx` | T4, T23 |
| `apps/web-pms/src/screens/registration-card.test.tsx` | **New** T9–T11 |
| `apps/web-pms/src/screens/front-office-editor.test.tsx` | **New** T29 |
| `apps/web-pms/src/screens/NightAuditScreen.test.tsx` | T12–T14 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | T15–T18 |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | T19 |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | T20 |
| `apps/web-pms/src/screens/TapeChartScreen.test.tsx` | T21 |
| `apps/web-pms/src/screens/ShiftScreen.test.tsx` | T22 |
| `apps/web-pms/src/screens/CityLedgerScreen.test.tsx` | T24 |
| `apps/web-pms/src/screens/ExceptionsScreen.test.tsx` | T25 |
| `apps/web-pms/src/auth/PermissionRoute.test.tsx` | T26 |
| `apps/web-pms/src/auth/me.test.ts` | T27 |
| `apps/web-pms/src/screens/SignInScreen.test.tsx` | T28 |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx` | T30 |
| `apps/web-pms/src/screens/StaffScreen.test.tsx` | T5 |
| `apps/web-pms/src/screens/RosterScreen.test.tsx` | T6 |
| `apps/web-pms/src/screens/GuestsDirectoryScreen.test.tsx` | T7 |
| `apps/web-pms/src/screens/InventoryScreen.test.tsx` | T31 |
| `docs/roadmap.md` | Tick **R0.11** when done (implementation PR) |

**Not in scope:** `apps/pms-core`; `packages/contracts` pins; Playwright / smoke script; `tokens.css` restyle; R0.14 early-departure command; wiring hidden Booking keys; ui-kit `Dialog` export.

---

## 7. Pin freeze

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last id `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new catalog commands. No schema migrations. No HTTP route additions.

---

## 8. Out of scope

- **L6 / R0.14 / R3.4** — early-departure command + `releaseSoldNightsSync` (U17 is **warning only** until then).
- **R1.20** — consume `same_day_*` / `require_prepayment` / `booking_date_change` in pms-core.
- **R2.1–R2.6** Track 2 prototype parity (nav IA, registration card field parity beyond print safety) — may overlap cosmetically; R0.11 is the audit closure slice.
- Playwright-first e2e; occupancy dashboard colors; PropertyDO extraction; housekeeping kit extraction.
- Global stylesheet rewrite; sign-in marketing column rebuild; copying sign-in shadows into AppShell.
- New ui-kit overlay component (use `.app-modal` only).

---

## 9. Success criteria

1. Rate matrix cells show **numbers only**; labels accessible via `VisuallyHidden` (**I1**).
2. Exactly **one** `<h1>` per route (`PageHeader`); sidebar brand is not a heading (**I2**). Board titles match route (**I5**). No hardcoded “The Meridian Seattle” (**I4**).
3. Guest erase, Exceptions confirm, and Rates archive use **`.app-modal`**; void paths use destructive confirm (**I3**, **U6**).
4. Night audit Run disabled states show **reason**; mutations use **Alert** (**U4**). Steps show clerk labels (**U12**).
5. Print outputs **only** `.reg-card`; room line never UUID (**U5**, **I6**).
6. Four unread Booking settings keys **hidden** (**U7**, **L12**).
7. Checkout shows **remaining-nights warning** when departure future; **no** client-side inventory release (**U17**).
8. Listed screens use **`classifiedUserMessage` + `Alert`**; no raw JSON error/statement surfaces (**E3**, **Q4**, **Q18**, **Q19**, **U11**). Tenders in **DataTable**.
9. Roster visible on **`roster:read`**; permission deny **toast** (**U16**, **U15**). Book FAIL_CLOSED disables actions (**U10**).
10. Sign-in MFA copy omits “demo user” (**I13**). Pins unchanged; `pnpm test:local` + `check:spa-page-chrome` green.

---

## 10. Relationship to prior specs

- [2026-08-16-spa-page-shell-consistency-design.md](./2026-08-16-spa-page-shell-consistency-design.md) — `PageHeader` / Card anatomy; **this spec** fixes remaining title/subtitle bugs (**I4**, **I5**) and board h1 mode mismatch.
- [2026-08-13-ui-system-convergence-design.md](./2026-08-13-ui-system-convergence-design.md) — ui-kit components; **no new kit overlay**; use existing `Alert`, `Badge`, `DataTable`, `VisuallyHidden`.
- [2026-08-15-audit-phase-e-user-facing-design.md](./2026-08-15-audit-phase-e-user-facing-design.md) — **E1/E2/E4/E5** landed; **E3** folio `<Alert>` remainder closes here.
- [2026-09-05-desk-freshness-tape-cache-design.md](./2026-09-05-desk-freshness-tape-cache-design.md) — optional I5 in BoardScreen; **required** in R0.11.
- [2026-09-05-http-error-contracts-design.md](./2026-09-05-http-error-contracts-design.md) — server errors stable; SPA copy sweep is **R0.11**, not R0.10.
- [2026-08-11-booking-wizard-design.md](./2026-08-11-booking-wizard-design.md) — Hold=`PENDING`; FAIL_CLOSED disable aligns with wizard spec.
- [2026-08-06-rule3-config-surface-design.md](./2026-08-06-rule3-config-surface-design.md) — Settings honesty; **L12** hides until R1.20 wires reads.

---

## 11. Operator copy reference

| Situation | Copy / component |
|---|---|
| Rate cell label (sr-only) | `Rate for {code} on {stayDate}` via `VisuallyHidden` |
| Checkout remaining nights | `Checkout does not release remaining nights — shorten the stay first.` |
| Night audit Run disabled (date) | `Business date is already current — nothing to roll.` |
| Night audit Run disabled (halted) | `Night audit is halted — resolve the failed step first.` |
| Night audit Run disabled (running) | `Night audit is already running.` |
| Permission deny | `You don't have access to that page.` (toast) |
| Book FAIL_CLOSED | `Booking unavailable — property unreachable.` |
| Guest search empty | `No guests match` |
| Guest search loading | `Searching…` |
| HK assignment helper | `Assignment only — use Status for clean/dirty.` |
| MFA step | `This account needs a second step.` (no demo-user sentence) |
| Void confirm | Title `Void this invoice?` / `Void this payment?`; body states irreversibility; **destructive** confirm |

Domain failures continue to use **`classifiedUserMessage`** with screen **`fallback`**; success paths may keep concise string messages inside **`Alert intent="informational"`** where already shipped (check-in, shift strip).
