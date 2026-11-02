# House Colour design system — design

**Roadmap:** R1.10a (inserted before R1.11 at the user's request) · **Status:** approved 2026-11-01, building · **Date:** 2026-11-01

**Source of truth:** the *HospAI Design System* artifact (claude.ai/artifact/DFaKPMdLQ6p3EguMCMCRSA): `project/tokens.json`, `project/README.md`, `patterns.md`, `screens.md`, `implementation.md` and the component guidelines. Step 1 copies `tokens.json`, `components/bundle.css` and those four documents to `docs/design-system/`, so the repo holds its own reference. This spec decides what gets built, and where the system and the code disagree, this spec says which wins (§9).

**User decisions (2026-11-01):**
- **Direction:** B, House Colour: warm greys, peacock teal, Figtree.
- **UX:** do whatever improves the UX in that direction.
- **Room Plan:** may change as needed to work properly.
- **Sequence:** design system first, then one slice before R1.11 to implement it.

**Why the slice exists:**
- Room Plan shows 3 of 20 rooms on a 1366 × 650 screen.
- Five stay states share blue on the tape, with no status word (`TapeChartScreen.tsx:142`).
- Money is a bare `toFixed(2)`, with a hard-coded `$` at `ShiftStrip.tsx:157` and `BookingScreen.tsx:1098`.
- Dates are hard-coded `en-US`.
- Top-bar search matches an exact reservation id only.
- Seven places hand-write a dialog, and three use `window.confirm`.
- In-app navigation drops unsaved edits silently.

## 1. What this reverses, and what it keeps

Each change lands with the code that makes it true, so the docs never describe a look the app doesn't have.

| Lock | Today | After | Lands in |
|---|---|---|---|
| ARCHITECTURE §16.4 *Palette* | shadcn neutral, Inter | House Colour, Figtree | Step 1 |
| AGENTS.md #4 | "2026-10-29 shadcn re-skin" | House Colour token theme, same dark-mode rule | Step 1 |
| R1.7a spec | Accepted, shipped | Status line: superseded by this spec. Its layout rules (§10) stay in force | Step 1 |
| `StatusBadge` tones | Confirmed is green | Confirmed is the blue outline | Step 1 |
| AGENTS.md *Kit* paragraph | Lists `Dialog (.app-modal)`, which ui-kit doesn't have | True: `Dialog` in ui-kit | Step 3 |
| `.cursor/rules/spa-page-chrome.mdc` | Do not change `--tape-*` grid math; counts above the card | Tape grid may change; counts in `PageHeader` `lead` | Step 5 |
| AGENTS.md pins table | 167 routes, last `get_night_audit_check_log` | 168 routes, last `post_reservation_search` | Step 4 |

**Kept unchanged:**
- No Tailwind, and no shadcn or Radix imports.
- ui-kit keeps its closed API: no `className`, no `style`, no blanket `...rest`.
- Desktop only, with no breakpoints.
- Hex only in `tokens.css`, as `--color-*` primitives with light and dark values.
- `PageHeader` stays the single `<h1>`; every page keeps its `Card`.
- Every `check:*` gate stays. None is relaxed.
- The tape keeps its 14-day cap (F2) and has no drag to move.
- No trends on desk screens, and no new Settings control.

## 2. Build order

Six steps. Each is built, reviewed and verified before the next starts, and each leaves the tree green.

| Step | What | What changes on screen |
|---|---|---|
| 1 | Tokens, fonts, metrics, colour gate | Every screen takes the new look |
| 2 | Money and date formatter | ₹ and DD/MM/YYYY everywhere |
| 3 | `Dialog`, `Tabs`, `EmptyState` kinds, `Skeleton`, `FieldGroup`, class cleanup, unsaved-changes guard | One way to do each thing; edits can't vanish silently |
| 4 | `TopBar`, `Band`, `GlobalSearch`, server search | Top bar is one line; search finds guests and rooms |
| 5 | Room Plan | Bars by state, half-day geometry, 12 rooms on the small screen |
| 6 | Browser check of every screen | None; findings get fixed here |

## 3. Step 1: tokens, fonts, metrics, gate

**Tokens.** `implementation.md` lists every change. Values come from `tokens.json`.
- Values change for the existing `color-*` names, in the light block, both dark blocks and the print block.
- New: `color-hover`, `color-table-head`, `color-field`, `color-primary-hover`, `color-primary-tint`, `color-primary-tint-fg`, `color-action-destructive-hover`, `color-status-cancelled-surface`, all `color-stay-*`.
- `color-chart-*` is **not** added: nothing in this slice draws a chart.

**The stay colour rule.** Green is never a stay, because BluePMS's published image uses green for a free room. A blank cell means free. Check this on the client's real screen at the walkthrough (Q8).

**Colour gate.** `check:web-pms-colors` gains these pairs in both themes:
- `--color-field` and `--color-focus`, at 3:1.
- `--color-primary-hover` and every `--color-stay-*-fg` on its surface, at 4.5:1.
- A self-test fixture that fails for each new class.

The artifact's calculation passes all 104 pairs, lowest 5.90 light and 5.97 dark. The gate must confirm that on the real file.

**Metrics.** The table in `implementation.md`, in `packages/ui-kit/src/styles.css`. In short: controls 36px, rows 44px with a dense 36px size, radius 8px, `--field-xs` 9.5rem so a date field shows its whole year.

**Fonts.**
- Copy Figtree 400, 500, 600 and 700 woff2 from the OFL `@fontsource/figtree` package to `apps/web-pms/public/fonts/figtree/`. Copy both the `latin` and `latin-ext` files, each with its `unicode-range`. **The ₹ sign is only in latin-ext.**
- Delete the Inter and IBM Plex Mono files and rules. CSP stays `default-src 'self'`.
- Set `font-variant-numeric: tabular-nums` on `body`, because Figtree's default digits have different widths.
- `--font-mono` becomes the system stack. `ui-quick-action__label` drops its mono caps.
- Devanagari is not added: no Hindi screen exists yet.

**`StatusBadge`** tones: Confirmed moves to the blue outline, In house to the solid blue and Pending to the dashed amber, the same fills as the tape. The words don't change.

**Wiring.** The new names replace what they were made for: `color-field` on control borders, `color-hover` on row and ghost hovers, `color-table-head` on table headers, the two hover colours on primary and destructive buttons. The sidebar ground and `color-selected` are now the same colour, so the current nav item takes the solid `color-primary`.

**Sidebar rows** keep their own `--nav-item-h` of 30px. They read `--control-h` today and would otherwise grow to 36px and run off a 650px window.

**Removed:** `--color-badge-fg-on-exception`, which nothing reads.

## 4. Step 2: one formatter

**The currency gap.** `PropertyRecord` has no currency, and `get_property` doesn't return one. The ledger currency lives in PropertyDO (`readStoredLedgerCurrencySync`). So `handleGetProperty` adds `ledgerCurrency: string | null`, read from the stub. It is `null` on the `propertyDo: 'unreachable'` branch. The field is additive on an existing route, so no pin changes.

**Module.** `packages/client-core/src/format.ts`, using `Intl` only and no DOM:

| Function | Output | Example |
|---|---|---|
| `formatMoney(minor, fmt, currency?)` | Sign, grouped, two decimals | `₹1,24,500.00`, `−₹5,000.00` |
| `formatDate(iso, fmt)` | DD/MM/YYYY, built from parts | `01/11/2026` |
| `formatDateHeading(iso, fmt)` | Weekday, day, month, year | `Sun 1 Nov 2026` |
| `formatTapeDay(iso, fmt, withMonth)` | Weekday and day, plus month at 7 days | `Sun 1 Nov` |
| `formatDateRange(from, to, fmt)` | Two dates and an en dash | `31/10/2026 – 03/11/2026` |
| `formatTime(ms, fmt)` | 12-hour in the property zone | `2:30 pm` |

**Rules:**
- `fmt` is `{ locale, timeZone, currency }`. Locale is `en-IN` when the ledger currency is INR and `en-GB` otherwise.
- Money divides by 100 and always shows two decimals, exactly as the wire and `parseMajorToMinor` assume today. Zero-decimal currencies stay out of scope, as they are across the system.
- The minus sign is U+2212, placed before the currency.
- A `null` ledger currency prints grouped digits with no sign. Never `$`.
- A line in another currency keeps its own code, as `FolioScreen.tsx:1965` does today.

**Wiring:**
- `shell/PropertyTimeZone.tsx` becomes `shell/PropertyFormat.tsx`, whose `useFormat()` returns the bound functions. `usePropertyTimeZone` stays as a thin read of it.
- Housekeeping gets its formatter as a host prop, the way it receives `Dialog` today.
- `formatMinor` goes away: 60 call sites in 11 files. `formatVarianceMinor` keeps its words and prints the sign (`short ₹5.00`).
- Every local date formatter goes, across the 14 files that call `Intl.DateTimeFormat` or `toLocale*`. `property-local-today.ts` stays, because it computes a date rather than displaying one.
- The default float of 100.00 goes: the opening float starts empty and is required. `ShiftStrip`'s auto-open goes with it, because it had only that default to send. Once the field was empty, it fired as soon as the clerk typed a valid first digit, opening a ₹1 shift on the way to ₹100. This amends the [folio first-paint](2026-08-13-folio-first-paint-design.md) decision: the clerk now opens the shift.

**Known limit.** `<input type="date">` displays in the browser's own locale, and no CSS or attribute changes that. An Indian Chrome shows dd/mm/yyyy, but a browser set to US English shows mm/dd/yyyy. A custom date field would fix it and no slice asks for one, so it stays native. Add browser language to the walkthrough list.

**Hand-off to R1.11.** `pms.ui.date_format` defaults to `MM/DD/YYYY`, and neither the SPA nor pms-core reads it. It is hidden in Settings today, so nothing here breaks. If R1.11 surfaces it, it must feed this formatter and its default must change. Formats are not configurable until then.

## 5. Step 3: one way to do each thing

**`Dialog`, new in ui-kit (closed API).** `{ open, title, onClose, footer, wide?, initialFocus?, children }`.
- It keeps today's `role="dialog"`, portal and scroll lock, and adds a real focus trap, Escape to close, and focus returned to the trigger. Native `<dialog>` is not used, because jsdom can't test `showModal`.
- `ConfirmDialog` and `FormDialog` stay as thin wrappers, so their call sites don't churn. `LogoutModal` becomes a use of `Dialog`.
- These hand-written dialogs move onto it: `SettingsScreen.tsx:348` and `CityLedgerScreen.tsx:381`, `:432`, `:491`.
- All three `window.confirm` calls go: `StaffScreen.tsx:228`, `:240` and `HousekeepingApp.tsx:440`.
- Housekeeping imports `Dialog` from ui-kit, and its `Dialog?` host prop is removed.
- Dialogs never stack. `.app-modal` is removed.

**Unsaved-changes guard.** `use-unsaved-changes.ts` already calls `useBlocker`, but only inside a data router, and `App.tsx` uses `BrowserRouter`, so it never mounts.
- Move to `createBrowserRouter` with `RouterProvider`, keeping the route tree as it is through `createRoutesFromElements`.
- The blocker opens a `Dialog`: "Leave without saving?", with initial focus on Stay.
- Screens using the hook: Exceptions, Settings, Rates, Inventory, Guest profile.

**`Tabs` everywhere.** Replace hand-written `ui-tabs` markup in Rates, Inventory, Settings, Night Audit and `housekeeping-nav.tsx`.

**`EmptyState` kinds.** Add `kind?: 'empty' | 'nomatch' | 'error'`. Replace the muted `<p>` on Booking, Reservations, Guests, the Assign dialog and the tape. The three states keep three different sentences (AGENTS §4).

**`Skeleton`.** Replace the 19 bare "Loading…" paragraphs with `Skeleton` in the shape of what's coming. Tests that assert the words change in the same commit.

**`FieldGroup`, new in ui-kit,** from `.ui-field-group`: the layout that replaces the per-screen form classes.

**Removed**, as listed in `implementation.md`:
- Per-screen form and table classes (`.staff__form`, `.roster__form`, `.inventory__form`, `.settings__form`, `.rates-plans__form`, `.city-ledger__create-form`, `.maintenance-report`, `.folio-forms`, `.guest-edit-form`, and the matching `__table` classes).
- Duplicates (`.visually-hidden`, `.stack`, `.stack-row`).
- Raw kit classes where a component exists.
- Dead CSS.
- `boardRowSeverity` and `tapeBlockSeverity`. `StatusBadge` and the stay state (§7) become the only mappings.

## 6. Step 4: shell and search

**`TopBar`** merges `.ops-rail*` and `.shift-strip*` into one 44px line: search, shift, property, business date.
- Clicking the shift opens the shift page.
- `ShiftStrip`'s behaviour and test ids stay; only its placement and markup change. AGENTS' "already shipped" entry means don't rebuild the logic.
- `StaleWatermark` is not rebuilt and only takes the new tokens.

**`Band`**, new in web-pms: one thin line under the top bar for something app-wide. It replaces `.app-flash` (the permission toast AGENTS asks for) and `.shift-callout` (drawer never counted). One at a time, and the highest intent wins. Both keep their test ids.

**Search needs a new route.** The guest CRM spec locks this (§2.24): name, email and phone travel in a POST body, so access logs and `Referer` never collect them. Adding names to `GET …/reservations-search?q=` would break it.

| | |
|---|---|
| Route id | `post_reservation_search` |
| Path | `POST /v1/properties/:propertyId/reservations-search` |
| Permission | `reservations:read`; `pms.core` entitlement |
| Degraded | `FAIL_CLOSED` |
| Kill-switch | Same as `get_reservation_search` |
| Body | `{ q }`, trimmed, 1–128 characters, through the shared JSON helper. Otherwise `invalid_query` |
| Pins | `V1_HTTP_ROUTE_AUDIT` 168, last id `post_reservation_search`. No command, no migration |

`get_reservation_search` stays exactly as it is, with its tests. The Reservations and Folios directories keep using it for now; they send an exact id and don't take a name.

**Lookup order.** The first branch with a result returns.
1. **Reservation id:** exact, any status.
2. **Room code:** exact and case-insensitive against live rooms (`archived_at IS NULL`). Returns pending, confirmed and in-house stays in that room, in-house first, then by arrival. `reservation_room_idx` covers it.
3. **Guest:** only when `q` is at least 2 characters. Calls `org.searchGuests` (limit 5), which is already scoped to guests linked to this property and drops erased guests. Then a new PropertyDO read fetches those guests' stays **at this property**: active first, then most recent.

Results are capped at 10 rows, and each row adds `roomCode: string | null`. The RPC's guest-ref array is capped at the HTTP layer and in the RPC; over the cap returns `limit_exceeded`.

**A user with `reservations:read` but not `guests:read`** gets id and room matches with `displayName: null`, and no guest branch. Today's handler returns a 503 when `readGuests` refuses; the new one treats `forbidden` as "no names". A transport failure still returns 503 `FAIL_CLOSED`.

**Limit worth knowing.** Guest search is whole-word and exact, because names are encrypted and the blind index holds hashes: "Sharma" finds Aara Sharma, "Shar" doesn't. Partial name search would need a different index and is out of scope.

**`GlobalSearch`** replaces `ReservationSearch` in `AppShell.tsx`.
- Placeholder: "Guest name, room or booking ID".
- Ctrl K or ⌘ K focuses it. Results sit in a `Popover`; arrow keys move between them; Enter opens the selected row, or the only row. Debounce stays 300ms.
- A row reads name, room, status word and dates, and opens the folio, as today.
- Empty: "No stay matches “Shar”. Try a full name, room number or booking ID." Unreachable: the existing fail-closed copy.
- Query key `['reservation-search', propertyId, q]`. It stays a read, so nothing to invalidate.

**`Popover`**, new in ui-kit (closed API): anchored, non-modal, opens on click, Escape or an outside click closes it, and focus returns to the trigger. It holds no form.

## 7. Step 5: Room Plan

**Layout at 1366 × 650**, with one scroll area and nothing above it scrolling:

| Row | Height | Contents |
|---|---|---|
| `TopBar` | 44 | Search, shift, property, date |
| `Band` | 32, when present | One app-wide message |
| `PageHeader` | about 52 | "Room Plan", counts, New booking |
| Control row | about 40 | Tape / Available tabs, legend, date range |
| Tape | the rest | Sticky date row and room column; rows 32; sticky Free row |

**Acceptance: at least 12 of 20 rooms visible at 1366 × 650 with a Band open and the Free row showing.** The built template shows exactly 12, so anything taller in the real page fails this. Measure it in the browser.

`PageHeader` drops its subtitle here, because the top bar now carries the property name and date. `.tape-scroller` keeps a `max-block-size` as `check:spa-page-chrome` requires, now computed from the rows above.

**`CountStrip`**, new in ui-kit. It takes children, not the `items` array in the artifact, because the kit can't depend on the router. Each count is `<Link className="ui-count">` over a `ui-count` CSS contract, like `ui-metric` (§9). `BoardSummary` gains a strip layout, used on Room Plan and the Front Desk boards. The Dashboard keeps its cards. Data stays `get_front_desk_summary`, and `data-testid="board-summary-overstay"` stays. `PageHeader` gains a `lead` slot.

**`DateRange`**, new in ui-kit: earlier and later buttons around the two native date inputs. `tape-from` and `tape-to` keep their test ids, and `clampTapeWindow` keeps its 14-day cap.

**Stay state** is one pure function, `stayState(status, departureDate, today)`:

| Input | State | Bar | Word |
|---|---|---|---|
| `checked_in`, departs after today | `inhouse` | Solid blue | In house |
| `checked_in`, departs today | `due` | Solid blue with a mark | Due out today |
| `checked_in`, departs before today | `overstay` | Solid red with an icon | Overstay |
| `confirmed` | `confirmed` | Blue outline | Confirmed |
| `pending` | `pending` | Dashed amber | Pending |
| OOO row | `blocked` | Hatched | Out of order, or its reason |

`readFrontOfficeTape` returns only pending, confirmed and in-house stays, so the artifact's `departed` bar isn't drawn, and that read doesn't change. `today` stays `propertyLocalToday`, matching what `BoardSummary` already gets.

**Half-day geometry.** Each day becomes two grid tracks. A bar runs from the second half of its arrival day to the first half of its departure day, so a departure and an arrival share a day without overlapping. A stay cut off by the window has a square end on that side. Day cells keep spanning both tracks and stay clickable where no bar covers them.

**`StayBar`**, new in web-pms, replaces `.tape-block`.
- It is a button. Its accessible name states guest, word and dates; colour never stands alone. VIP and DND keep their test ids.
- A bar with one day or less in view leads with the surname: "A. Sharma".
- Guest names come from the existing chunked batch, and a failed name reads "Guest unavailable".

**Bar popover**, using `Popover`:
- Shows guest link, `StatusBadge`, room, dates, nights, balance, Open folio.
- Balance is fetched on open with `get_folio`, and only with `folio:read`. Without that permission it isn't shown; if the read fails it says "Balance unavailable". The tape read doesn't change.

**Unassigned stays** get a row at the top of their room type. Overlapping stays stack in lanes, because one unassigned row can hold more than one stay at once, which today's single row draws on top of itself.

**Free row.** The sum of `free` per day from `get_property_availability`, **only for room types that have rooms on the tape**. Virtual types have no rooms of their own, and summing them would count the same rooms twice. The server's `free` is read as given, never recalculated. It needs `inventory:read`: without it the row is hidden, and if the read fails each cell shows "–" with an accessible "Unavailable". Query key `['front-desk-free', propertyId, from, to]`, invalidated alongside the tape key.

**Keyboard.** The tape is a `role="grid"` with a roving tab stop, so Tab moves past it in one press rather than through up to 280 cells. Arrow keys move between cells, Enter opens the bar's popover or the cell's booking link, Escape closes.

**Blank cells** keep the R1.3 link to `/book` for that night and room type. Booking has no room field, so the link can't pick the room, and its accessible name changes from "Book room 204" to say what it does: "Book Deluxe on 01/11/2026".

**Available tab** shares the header and control row. Its table and `RoomStatus` are unchanged apart from tokens and formats.

`TapeLegend` is new in web-pms: the state shapes with their words, always visible above the tape.

## 8. Not built

- The artifact's other new components (`MoneyInput`, `Stepper`, `MatrixGrid`, `Timeline`, `SidePanel` and the rest). Each is built when its slice arrives.
- Single-key shortcuts (N, W, ?). The artifact says to test keys with desk staff before freezing them; Ctrl K, grid arrows, Enter and Escape are enough for now.
- Drag on the tape, a custom calendar, a tape virtualizer, partial name search, Hindi, per-property format settings.
- A theme, breakpoint or layout for phones.

## 9. Where this spec overrides the artifact

The artifact needs these same corrections once this ships.

| Artifact says | This spec | Why |
|---|---|---|
| Four dialog implementations | Seven hand-written, plus three `window.confirm` | City Ledger has three more |
| Server search change on the existing route | New POST route | The guest CRM lock keeps names out of URLs |
| Bar popover has Post charge | Open folio only | Posting lives on the folio screen, so both links would go to the same place |
| Free count "from the ledger", no detail | Physical types only | Virtual types would double-count |
| `CountStrip` takes `items` | Takes linked children | The kit can't depend on the router |
| `property.currency` implied | `ledgerCurrency` added to `get_property` | The property record has no currency |

## 10. Feature checklist (AGENTS §6)

- [x] **Tenant:** `post_reservation_search` takes no ids in the body. URL property only, through `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.
- [x] **Authz:** `permission` and entitlement declared; property-scoped results; kill-switch same as the GET route.
- [x] **Catalog:** no command. Route in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`; `permissions-check` matches; pins updated in the same commit.
- [x] **Idempotency:** not applicable, it is a read.
- [x] **Bounds:** `q` capped at 128; guest-ref array capped at HTTP and RPC; JSON through the shared helper.
- [x] **Money:** display only. The client computes no tax and allocates nothing. The wire stays integer minor units.
- [x] **Inventory:** read only. No reservation scans; the Free row reads the ledger's `free`.
- [x] **Errors:** existing status table; fail-closed copy kept.
- [x] **SPA:** query keys carry tenant and range; `classifiedUserMessage`; ui-kit only; no inline styles beyond today's `--tape-*` custom properties.
- [x] **Settings:** no new control.
- [x] **Specs searched:** guest CRM directory (§2.24, blind-index search), tape chart board, R1.7a.

## 11. Tests and verification

**pms-core** (`reservations-search-routes` spec or a sibling):
- Id, room and guest branches, including order.
- An archived room's code doesn't match.
- **Two properties in one org: hotel A's search never returns hotel B's guests or stays**, including a guest linked to both, who shows only A's stays.
- Erased guest dropped; 10-row cap; RPC over cap returns `limit_exceeded`; malformed JSON returns `400 invalid_json`.
- `reservations:read` without `guests:read` returns id and room rows with `displayName: null`, not 503.
- OrgDO transport failure returns 503; kill-switch and unentitled match the GET route.
- `get_property` returns `ledgerCurrency`, and `null` when the DO is unreachable.

**client-core:** `format.ts`, covering Indian grouping, the minus sign, two-decimal fixed output, null currency, and dates at a time zone boundary. Use `addCalendarDays` where date maths is needed.

**ui-kit:** `Dialog` (trap, Escape, focus return, initial focus), `Popover`, `CountStrip`, `DateRange`, `FieldGroup`, `EmptyState` kinds. `api-surface.test.ts` stays closed. Every addition goes on `/dev/ui`.

**web-pms:**
- `stayState`, every row of the §7 table.
- Half-day track calculation, including same-day turnover and a stay cut off on each side.
- Unassigned lanes; Free row excludes virtual types; Free row hidden without `inventory:read`.
- Tape keyboard moves.
- `GlobalSearch` keys and copy.
- Blocker dialog in a data router.
- Popover asserts its `get_folio` key; mutation tests assert `invalidateQueries` against the real tape and Free keys.
- Existing tests whose markup changed are rewritten to the new behaviour, never skipped.

**Pins and gates:**
- `register.test.ts` for the route pin.
- 17 `check:*` unchanged in number; none relaxed.
- `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`, with pms-core on 8 shards.

**Browser (step 6, on a property provisioned in INR):** every route, by screenshot, at 1366 × 650 and 1920 × 950, in light and dark:
- Dashboard, Room Plan (Tape and Available), Arrivals, Departures, In house, Reservations, Guests, Guest profile, Check-in, Folio, Folios, Shift, Book.
- Inventory, Rates, Staff, Roster, City Ledger, Night Audit, Exceptions, Settings, Housekeeping, Maintenance, Sign-in.
- Also: printing the registration card in dark, a red-green simulation of Room Plan, ₹ rendering in the real font, and the 12-room measurement.

Desktop only by decision, so the phone-width check in the global browser rule doesn't apply beyond confirming nothing claims to support it.

## 12. As built

**Step 1.** As §3, plus three fixes the browser check called for:
- The sidebar nav now shrinks and scrolls, with 1px row gaps and a tighter footer. Before this, the footer fell off the bottom of a 650px window and its controls couldn't be reached.
- `QuickAction` is a 56px row, as in the design system, not a 92px column.
- The gallery's sample "In house" badge was green, so it now says "Paid".

`check:web-pms-colors` passes on the real file with 110 contrast assertions.

**Step 2.** As §4, plus:
- `formatDateTime` and `formatInstantDate` join the table, for timestamps and created-at dates.
- `minorToMajorInput` prefills editable amounts as plain digits, which `parseMajorToMinor` can read back.
- Invoice lines, tax and totals printed raw minor units, so an invoice read `Charges 10000`. They now print money.
- `no_availability` shows its date as DD/MM/YYYY.
- `pnpm demo:seed --currency INR --time-zone Asia/Kolkata` provisions the demo hotel in rupees. Rates in the seed follow the ledger currency.

**Step 3.** As §5, plus:
- Moving to a data router meant an unknown URL showed React Router's developer error page. Now `NotFoundScreen` answers `*` inside the shell, and `RouteErrorBoundary` catches thrown errors.
- `FieldGroup inline` lets each field share the row up to its width cap, because a kit field is 100% wide on its own.
- Folio charge, cash, authorisation, discount and FX amounts start empty, and so does the shift's blind closing count. Each button stays disabled until its amount parses (`parseAmountToMinor`). The card chargeback fee keeps its 0.00.
- `boardRowSeverity` goes now. `tapeBlockSeverity` goes in step 5, together with the tape bars it colours.

**Step 4.** As §6, plus:
- The no-names case is tested through `setDenyGuestReadForTest` on OrgDO, which only works in unsafe-local mode, because every real role has `guests:read` today.
- The search popover keeps focus in the field (`returnFocus={false}`). Opening a result clears the field and closes the panel, because the panel isn't tied to focus.
- The shift float field's reason sits in a `VisuallyHidden` node that the disabled Open shift button references through `aria-describedby`.
