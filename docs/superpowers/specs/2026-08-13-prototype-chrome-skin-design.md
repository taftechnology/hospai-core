# Prototype chrome + contrast-safe skin

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P0-3 / 8-minute path / out-of-scope / definition of done item 3; prototype `hospai-pms-prototype/src/App.tsx` shell + `src/index.css` `@theme` + `src/components/Icons.tsx`; [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md); [folio first-paint](./2026-08-13-folio-first-paint-design.md) leftover rows 1 / 12 / 13 / 15; [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) leftover “property-name rail”; [booking wizard](./2026-08-11-booking-wizard-design.md) leftover “Rates in booking”; ARCHITECTURE.md §16.4; `apps/web-pms/src/shell/AppShell.tsx`; `apps/web-pms/src/styles/tokens.css`; `apps/web-pms/src/styles.css`; `scripts/web-pms-colors-check.mjs`; web-interface guidelines

**Closes:** DEMO-READY P0-3 (investors recognize the prototype: left sidebar, sage/tan warmth, icons, top search rail; WCAG AA; not a pixel-faithful rebuild). Folio-first-paint leftovers “P0-3 chrome + skin”, “shift-strip hide raw `shiftId`”, “status copy In house vs `checked_in`”, “`ui-kit` / Tailwind / prototype palette.” Demo-tenant-seed leftover “P0-3 will put **name** on the rail.”

**Amends:** [folio first-paint](./2026-08-13-folio-first-paint-design.md) §12 rows 1 / 12 / 13 / 15 (this chunk **closes** those leftovers). [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) P0-3 rail leftover. Bidirectional pointer: one sentence in those specs when this chunk lands. DEMO-READY P0-3 checkboxes tick in the **implementation** PR. Do **not** rewrite ARCHITECTURE §16.4 in this chunk (P2 owns that recording).

---

## 1. Context & Motivation

The 8-minute investor path already runs on live APIs with a named hotel (P0-1) and a folio that paints as a bill (P0-2). `apps/web-pms` still looks like a lab: a horizontal top-bar of text links, cool greys, institutional blue primary `#1a4a6e`, no icons, no property name, no business-date chip. The prototype (`hospai-pms-prototype`) is the product investors have seen: left sidebar, sage mark, cream selected row, search rail.

This chunk is **chrome + skin on live screens**. Routes, permissions, commands, and seed stay. It is not a pixel-faithful rebuild of prototype layouts (tape popups, billing app, Dashboard Hub, recharts). Hand-written CSS + existing tokens — no Tailwind, no `packages/ui-kit`. The contrast gate outranks the palette.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Shell | `apps/web-pms/src/shell/AppShell.tsx`. Grid `.app-shell`: top-bar (wordmark **HospAI** + horizontal `<nav aria-label="Front desk">` + `ReservationSearch`) → `ShiftStrip` → `FrontOfficeLive` → `<main class="main"><Outlet/></main>` → `.side-panels` (`QueuedCommandsPanel` always open; `ExceptionsPanel` always open). No `<aside>`. No role footer. No property name. No business-date chip. |
| Nav registry | `apps/web-pms/src/shell/nav.ts` `NAV_ENTRIES` + housekeeping from `modules/pms/housekeeping/src/ui.manifest.ts` (`order: 25`). `ALL_NAV` sorts by `order`. Current ids: `board` (label **Board**), `arrivals` (**Arrivals**), `in-house`, `departures`, `housekeeping`, `reservations`, `guests`, `book` (**Book**), `inventory`, `rates`, `staff`, `roster`, `night-audit` (**Night audit**), `exceptions`, `settings`. Folio is not a nav item (drill-in). `/in-house` and `/departures` are equal sidebar siblings of Arrivals. |
| Permission filter | `filterNavEntries` in `apps/web-pms/src/auth/me.ts`. Pending → empty; unknown → fail-open full list; live → hide entries whose `permission` is missing. **Does not** grey out unpermitted rows (unlike the prototype). `/me` returns `role: 'owner' \| 'admin' \| 'staff'` — unused in chrome today. |
| Search | `ReservationSearch` in AppShell. `data-testid="reservation-search"`. Placeholder **“Reservation id or guest name”**. Results: `GuestNameLink` then a button whose text is `reservationId` + dates + status. Enter with one hit → `/folio/:id`. Permission `reservations:read`. |
| Shift strip | `ShiftStrip.tsx` under the top-bar. Auto-open (P0-2). Open badge `data-testid="open-shift-badge"` paints raw **`shiftId`**. |
| Queued / exceptions | `QueuedCommandsPanel`: always a `<section class="panel">`; empty copy “None this session”. `ExceptionsPanel`: `data-testid="exceptions-panel"`; always visible; badge count 0 still shown. |
| Property read | `PropertyTimeZoneProvider` already `GET`s `api.getProperty` (`['property', propertyId]`). Body `property.name` / `timeZone`. Seeded name **The Meridian Seattle**. **Not** painted on the rail. No `businessDate` on this GET. |
| Business date | `__meta.business_date` is night-audit state. `GET /night-audit` is `night_audit:run` (`get_night_audit` [86]) — too narrow for the rail. SPA “today” is `propertyLocalToday(timeZone)` (wall-clock). Tape / boards already use that. |
| Tokens | `apps/web-pms/src/styles/tokens.css`. Cool greys (`--color-ink: #1a1f24`, `--color-bg: #f3f5f7`, `--color-line: #d5dbe1`). Primary action `#1a4a6e`. Informational `#1a4a6e` / `#e8f1f8` (institutional blue). Settled `#0d5c2e` / `#e8f5ee`. Attention `#8a5a00` / `#fff6e5`. Exception `#9b1c1c` / `#fff5f5`. Font stack `"IBM Plex Sans", "Segoe UI", sans-serif` — **no font file / `<link>`** in `index.html`. No `--radius`. `color-scheme: light`. |
| Colour gate | `pnpm check:web-pms-colors` (`scripts/web-pms-colors-check.mjs`). Literals only on `--color-*`. Every `--status-*-fg` ≥ 4.5:1 vs its `--status-*-surface` **and** `--color-surface-base`. Merge-blocking in CI. |
| Prototype chrome | `hospai-pms-prototype/src/App.tsx`: `<aside class="w-64 … sticky top-0 h-screen">` sage mark ✦ + “Hospai PMS”, selected `bg-[#F1EFE9] text-[#4A5D4E]`, footer role, top rail search + property **select** + business-date chip + Whistle + role-swap + “Simulation Active”, training-disclaimer footer. Icons from `src/components/Icons.tsx` (inline SVG, `currentColor`). |
| Prototype palette | `src/index.css` `@theme`: `#F9F8F4` / `#F1EFE9` / `#E8E4D8` / `#2D2926` / `#4A5D4E` / `#C18C5D`. Unconstrained contrast. Accent `#C18C5D` on white = **2.93:1** (fail). Sage `#4A5D4E` on cream `#F1EFE9` = **6.16:1** (pass). White on sage = **7.08:1** (pass). |
| Tape | `TapeChartScreen.tsx` `<h1 class="board-title">Board</h1>`. Room **codes** already. Stay blocks: `GuestNameLink` + `statusClass`. `BoardSummary` chips are plain links (no cream/sage). |
| Book | `BookingScreen.tsx`: muted **“Type-only stay — no rate quote in this screen.”**; `data-testid="quote-version"` **“Quote ariVersion {n}”**. Context guest paints `({contextGuestRef})`. Confirm still requires `quoteAriVersion` on the **wire**. `listRateDays` exists (`get_rate_days`, `rates:read` — staff has it). `formatMinor` is major `toFixed(2)` with **no** currency sign. |
| Check-in | `CheckInScreen.tsx`: free-text `placeholder="room id"` bound to `roomId`. No `listRooms`. `PrintRegCardControl` + `RegistrationCard` (`data-testid="print-reg-card"` / `reg-card`). Screen CSS clips `.reg-card` except print. |
| Folio | First-paint / Advanced **closed P0-2**. Header still `status` wire value; room **code** already. Skin is this chunk. |
| Night audit | `NightAuditScreen.tsx`: step **wire names** in a table + `statusClass`; reports listed by raw `reportId` (test clicks `name: 'revenue'`); `report-table` keys are wire field names; `JSON.stringify` helper exists for object cells (objects are already filtered out of the table). |
| Board / directory / guest stays | `BoardScreen`: column 1 = `reservationId`; guest name in column 2; **no room code**. `ReservationsDirectoryScreen.roomLabel`: code map, else truncated `roomId`. `GuestProfileScreen` stays table paints raw `row.roomId`. |
| Icons / motion | No `lucide-react`, no `motion`, no `recharts` in `apps/web-pms`. |
| Catalog / routes / schema | `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT` last **`[127] = post_demo_seed`**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS = []`. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS` length **7**. |

**Heads (do not insert before — this chunk does not move them):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** (no new row) |
| `COMMAND_CATALOG` | length **77** | **77** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **25** | **25** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. `AppShell` becomes the prototype **frame**: left sidebar (~16rem, sticky) + main column; sage mark + **HospAI PMS**; selected row cream / sage / icon (§3).
2. Sidebar footer shows the signed-in **role** from `/me`. No role-swap dropdown (§3.4).
3. Top operations rail: global search (guest name first), property **name**, business-date chip (§4).
4. Shift strip stays under the rail. Queued-commands and exceptions stay available but **collapsed when empty** (§5).
5. Small local SVG set copied from prototype `Icons.tsx` into `apps/web-pms`. No `lucide-react`, no `motion` (§6).
6. Primary + secondary nav order and labels in §3.2. Folio stays a drill-in. `/in-house` and `/departures` stay as routes, not equal sidebar items.
7. Token re-derivation in §7. Contrast gate stays merge-blocking. IBM Plex / Segoe. `--radius` ~8px. No dark theme, no prototype `shadow-sm` / `animate-pulse`.
8. Light markup on the screens in §8 (guest names / room codes; tape title; Book quote; check-in picker; folio **skin only**; night-audit job chrome).
9. Existing `data-testid`s stay. Tests change only where shell DOM or copy actually moves (§9).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **P0-2 folio first-paint / Advanced / shift auto-open.** **Closed 2026-08-13.** This chunk does not reopen IA. Folio **skin only** (headers, buttons, chips).
- **P0-4 sign-in / Clerk.** `VITE_USE_DEV_ACTOR` / `X-Dev-Actor` / `/sign-in` paragraph stay. Role footer reads whoever `/me` is.
- **P0-5 script + dry runs.** No speaker notes, kill list, or timed rehearsal.
- **Pixel-faithful rebuild of prototype screen layouts.** No tape scheduler popups, no folio-as-billing-app, no Dashboard Hub, no Yield Analytics, no recharts, no booking-engine preview.
- **Adding Tailwind v4** to `web-pms`.
- **Extracting `packages/ui-kit`.** Token + shell restyle inside `apps/web-pms` only.
- **New Worker routes or commands.** No new `V1_HTTP_ROUTE_AUDIT` row. No new catalog id. No widening GET property with `__meta.business_date`.
- **New DO tables or schema changes.** `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`.
- **Changing the demo seed.**
- **Copying from the prototype chrome:** Whistle button, “Simulation Active”, role impersonation / role-swap `<select>`, training-disclaimer footer, property **switcher** (single demo tenant).
- **Exact prototype hex that fails `check:web-pms-colors`.** Re-derive (§7). Accent `#C18C5D` is not a text colour.
- **Dark theme** / `prefers-color-scheme: dark` tokens.
- **Prototype `shadow-sm` / `animate-pulse` / `animate-ping`.**
- **Recording palette adoption in ARCHITECTURE §16.4.** DEMO-READY lists that under **P2**.
- **P1** guest CRM depth, card last-4 / brand, “one hotel voice”, leftover lab-copy sweep beyond the screens in §8.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers on the wire.** Book’s dollar quote is `formatMinor` of summed `amountMinor` from existing `listRateDays`. This chunk does not post rates or change `quoteAriVersion` on `reservations.create`.
2. **The folio is append-only.** Unchanged. Folio skin does not move lines, tenders, or Advanced.
3. **Domain code has zero platform imports.** Unchanged. No new domain package. Icons live in `apps/web-pms`.
4. **No new catalog commands.** `COMMAND_CATALOG` length stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
5. **No new HTTP routes.** `[127] = post_demo_seed` does not move. Compose from existing GETs: `get_property`, `get_property_me`, `get_rate_days`, `get_rooms`, reservation search (already used).
6. **Schema freeze.** `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` is a no-op diff.
7. **No new `export class`.** Icon components are functions. Do not add to `CLASS_DENYLIST`.
8. **`NIGHT_AUDIT_STEPS` stays seven.** Step **wire names** stay on the night-audit table.
9. **Colour literals only on `--color-*`.** Semantic aliases (`--ink`, `--bg`, `--action-primary-*`, `--status-*`) stay `var(...)` so screens inherit without a markup sweep of every status class.
10. **Every `--status-*-fg` passes 4.5:1** against its paired surface **and** `--color-surface-base`. `pnpm check:web-pms-colors` green. Do not weaken the script.
11. **Five status rungs unchanged** (`settled` / `neutral` / `informational` / `attention` / `exception`). Do not add a sixth. `status-neutral` stays an empty rule. Mapper files in `apps/web-pms/src/status/` are not rewritten except if a class name were to change (it must not).
12. **`data-testid`s on existing controls stay** (same string, same control). Tests may change **copy** and **where** a node lives (nav into `<aside>`; quote copy; room picker). They must not be rewritten to new ids for search, folio, check-in, exceptions-panel, open-shift-badge, quote-version, board-summary, etc. (§9).
13. **Happy-path chrome never contains** `prop_demo` as a label, `Simulation Active`, `Whistle`, a role `<select>`, or a training-disclaimer footer.
14. **Guest names never live in PropertyDO.** Compose stays `GuestNameLink` / `postGuestsBatch`.
15. **No Tailwind, no `packages/ui-kit`, no `lucide-react`, no `motion`.**
16. **Nothing on the shell boot path may depend on PropertyDO for first paint of chrome.** Nav + mark render from `/me` authority (already). Property **name** and business-date chip may wait on the existing non-blocking `getProperty` (timezone already works this way). If that GET fails, omit name/chip — do not block the shell, do not paint `propertyId`.
17. **Fixture-date discipline** unchanged. SPA tests stay mocked.

---

## 3. Shell — sidebar (normative)

`AppShell` layout becomes:

```
.app-shell          /* display: flex; min-height: 100vh; */
  aside.app-sidebar /* 16rem, sticky, h-screen, column, border-right */
    brand
    nav (primary then quiet)
    footer (role)
  .app-main         /* flex: 1; min-width: 0; column */
    header.ops-rail
    ShiftStrip
    FrontOfficeLive
    main.main (Outlet)
    .side-panels    /* collapsed when empty — §5 */
```

No-access / unauthorized outcomes stay as today (no-access copy + `data-testid="me-no-access"`; unauthorized → `/sign-in`). They do not need the full prototype frame.

Landing remains `/board` (tape). **No Dashboard Hub.**

### 3.1 Brand block

| Fact | Value |
|---|---|
| Mark | 2rem × 2rem square; `background: var(--action-primary-surface)`; `color: var(--action-primary-fg)`; `border-radius: var(--radius)`; glyph **✦** (text, not an icon file). **No** box-shadow. |
| Title | **HospAI PMS** — “HospAI” weight 700, “PMS” weight 400, uppercase tracking. Not “HospAI” alone. Not prototype “Hospai”. |
| Subtitle | **Omit.** Do not copy “Property SaaS v1.0”. |
| `index.html` `<title>` | **HospAI PMS** (today “HospAI Front Desk”). |

### 3.2 Nav — order, labels, routes, icons, tone

`NavEntry` gains optional `tone?: 'primary' | 'quiet'` (default `'primary'`). `filterNavEntries` **ignores** tone (permissions only). `ALL_NAV` still sorts by `order`. AppShell renders two groups in one `<nav>`: `tone !== 'quiet'` then `tone === 'quiet'` (visually quieter: muted colour, not a second sidebar).

**Primary (this order — locked):**

| `order` | `id` | Sidebar label | Route | Icon export (§6) | Permission (unchanged) |
|---|---|---|---|---|---|
| 10 | `board` | Room Plan | `/board` | `RoomPlanIcon` | `reservations:read` |
| 20 | `arrivals` | Front Desk | `/arrivals` | `CheckIcon` | `reservations:read` |
| 30 | `reservations` | Reservations | `/reservations` | `CalendarIcon` | `reservations:read` |
| 40 | `book` | New Booking | `/book` | `PlusIcon` | `reservations:write` |
| 50 | `housekeeping` | Housekeeping | `/housekeeping` | `BedIcon` | `housekeeping:read` (module manifest) |
| 60 | `guests` | Guests | `/guests` | `UserIcon` | `guests:read` |
| 70 | `rates` | Rates | `/rates` | `CreditCardIcon` | `rates:write` |
| 80 | `night-audit` | Night Audit | `/night-audit` | `NightAuditIcon` | `night_audit:run` |
| 90 | `settings` | Settings | `/settings` | `SettingsIcon` | `settings:configure` |

**Secondary (`tone: 'quiet'` — visually quieter, still permission-filtered):**

| `order` | `id` | Sidebar label | Route | Icon export | Permission |
|---|---|---|---|---|---|
| 100 | `inventory` | Inventory | `/inventory` | `PropertyIcon` | `inventory:write` |
| 110 | `staff` | Staff | `/staff` | `UserIcon` | `staff:read` |
| 120 | `roster` | Roster | `/roster` | `CalendarIcon` | `roster:write` |
| 130 | `exceptions` | Exceptions | `/exceptions` | `WarningIcon` | `property:read` |

**Removed from the sidebar (routes stay):**

| `id` | Route | Why |
|---|---|---|
| `in-house` | `/in-house` | DEMO-READY: in-house / departures linked from Front Desk / summary chips, not three equal items. `BoardSummary` already links `/in-house`. |
| `departures` | `/departures` | Same. `BoardSummary` already links `/departures?date=`. |

Do **not** delete `App.tsx` routes for `/in-house` or `/departures`. Do **not** add Folio, Dashboard Hub, Yield, Whistle, or billing to the nav.

Housekeeping `order` in `modules/pms/housekeeping/src/ui.manifest.ts` becomes **50**. Icon mapping lives in `apps/web-pms` keyed by `entry.id` (the module manifest must not import SPA SVGs).

`<nav aria-label="HospAI PMS">` (today “Front desk”). Selected row: `NavLink` `aria-current="page"` → cream fill `--color-selected`, sage `--color-primary`, icon currentColor, font-weight 600. Unselected: `--muted`, icon muted. Hover: cream at reduced mix (`color-mix` toward `--color-selected`). Nav label `font-size: 0.75rem` (12px). Row `border-radius: var(--radius)`; padding ~0.5rem 0.75rem; icon 14px. **No** underline-as-selected (today’s `border-bottom: 2px solid`).

Unpermitted entries stay **omitted** (existing filter). Do not copy prototype disabled-opacity rows.

### 3.3 Selected-row contract

| State | Surface | Text / icon |
|---|---|---|
| Selected | `--color-selected` (`#F1EFE9`) | `--color-primary` (`#4A5D4E`) |
| Idle | transparent | `--muted` |
| Hover (not selected) | `color-mix(in srgb, var(--color-selected) 60%, transparent)` | `--ink` |

### 3.4 Footer — signed-in role

Sticky bottom of `<aside>`, border-top `--line`, chip surface `--color-selected`.

| Fact | Value |
|---|---|
| Source | `authority.kind === 'live'` → `authority.me.role` |
| Labels | `owner` → **Owner**; `admin` → **Admin**; `staff` → **Staff** |
| Pending / unknown | Omit the role word (keep the footer chrome empty or “Signed in”). Do not invent Admin. |
| Forbidden | Role `<select>`, “Personnel Status:” lab label, `userId`, `user_owner` as visible text |

`data-testid="shell-role"` on the role word (new — only new testid required on the shell besides rail chips if needed).

---

## 4. Top operations rail (normative)

`header.ops-rail`: sticky, `z-index` above tape sticky room column (tape room is `z-index: 1`; rail ≥ 30), height ~4rem, `background: var(--panel)`, border-bottom `--line`. **No** box-shadow.

### 4.1 Global search (guest name first)

Existing `ReservationSearch` moves into the rail (left). `data-testid="reservation-search"` and `data-testid="reservation-search-results"` **stay**.

| Today | This chunk |
|---|---|
| Placeholder “Reservation id or guest name” | **Guest name or reservation** |
| Results: name (optional) then button labeled `reservationId` | Guest **name** is the primary label of each hit. Dates / status may follow. Do not lead with `reservationId`. The button may still `navigate` to `/folio/:reservationId`. |
| Input unstyled | `--radius`; cream/page fill; search icon (`SearchIcon`) inside the field, non-interactive |

Fail-closed copy stays. Enter-to-folio-when-one-hit stays. Permission gate stays (`reservations:read`).

### 4.2 Property name

Reuse the existing `['property', propertyId]` query (do not add a second GET).

| State | Paint |
|---|---|
| Success with `property.name` | That **name** (seeded: The Meridian Seattle). Never `prop_demo` / `propertyId`. |
| Pending | Omit |
| Error / unreachable | Omit. Do not fall back to the id. |

Not a `<select>`. Not a property switcher. `data-testid="property-name"` on the name text.

### 4.3 Business-date chip

**Locked source:** `propertyLocalToday(timeZone)` from `usePropertyTimeZone()` — the same calendar-today the tape already uses.

| State | Paint |
|---|---|
| Timezone known | Chip: `CalendarIcon` + **Business date:** `{ISO date}`. Fill `--color-selected`, border `--line`, text `--color-primary`, `border-radius: var(--radius)`, font-size 0.75rem. |
| Timezone pending / missing | Omit the chip. Do not assume UTC. |

**Do not** call `getNightAudit` for this chip (`night_audit:run` would hide it from staff). **Do not** widen `GET /properties/:id`. If `__meta.business_date` and calendar today diverge after an audit roll, the chip follows **calendar today** until a later slice (named leftover §12).

`data-testid="business-date-chip"`.

---

## 5. Shift strip, queued commands, exceptions (normative)

### 5.1 Shift strip

Stays **directly under** the ops rail (not in the sidebar, not in the page). Existing auto-open and testids stay.

**Hide raw `shiftId` on the badge** (P0-2 leftover). `data-testid="open-shift-badge"` text becomes **Open shift · float {formatMinor} · cash posts {n}** — no `shiftId` in the text node. Close link `/shift` stays. Force-close callout may still link `/shift/:shiftId` (the id is in the URL, not a label).

### 5.2 Collapsed when empty

Queued-commands and exceptions **remain in the shell** (boot-path honesty: they must still mount when PropertyDO is down).

| Panel | Empty | Non-empty |
|---|---|---|
| Queued commands | `<details>` **not** `open`. Summary: **Queued commands**. No “None this session” occupying a two-column footer. | `open` (or equivalent visible list) when `queuedCommands` has ≥ 1 entry. |
| Exceptions | `<details>` **not** `open` when `exceptionCount === 0` and the count GET succeeded. | `open` when count > 0. Fail-closed error: keep the panel **available** (visible error copy) — that is not “empty.” |

`data-testid="exceptions-panel"` stays on the exceptions region. Session-scoped queued footnote may live inside the open details.

Do not delete the session log. Do not move exceptions to a toast. Do not auto-open because a watermark is stale.

---

## 6. Local SVG set (normative)

Copy the **named** inline SVGs from `hospai-pms-prototype/src/components/Icons.tsx` into `apps/web-pms/src/shell/icons.tsx` (functions, `currentColor`, `size` default 14 for nav / 12 for the chip).

**Copy (exactly these exports):**

`RoomPlanIcon`, `CheckIcon`, `CalendarIcon`, `PlusIcon`, `BedIcon`, `UserIcon`, `CreditCardIcon`, `NightAuditIcon`, `SettingsIcon`, `PropertyIcon`, `WarningIcon`, `SearchIcon`

**Do not copy:** `WhistleIcon`, `DashboardIcon`, `ReportsIcon`, `FolioIcon`, `ChannelIcon`, `BellIcon`, and the rest of the prototype file. No `lucide-react`. No `motion`. No PNG/SVG asset pipeline.

Sage mark ✦ is text in the brand block, not an icon export.

---

## 7. Tokens (normative)

All colour literals stay on `--color-*` in `apps/web-pms/src/styles/tokens.css`. Alias names stay so existing `statusClass` / `.panel` / `.error` inherit.

### 7.1 Chrome primitives (locked hex)

| Token | Hex | Role |
|---|---|---|
| `--color-bg` | `#F9F8F4` | Page background (`body`, `--bg`) |
| `--color-surface-base` | `#ffffff` | Sidebar, rail, `.panel` (`--panel`) |
| `--color-selected` | `#F1EFE9` | Selected nav, search fill, date chip, quiet chips |
| `--color-line` | `#E8E4D8` | Borders (`--line`) |
| `--color-ink` | `#2D2926` | Body text (`--ink`) |
| `--color-muted` | `#575245` | Secondary text (`--muted`). Prototype `#6B6658` also passes 4.5:1 on white (5.73); **lock `#575245`** (7.78) so chip-sized type stays comfortable. Do **not** use prototype `#9A9483` for text (3.03:1 on white). |
| `--color-primary` | `#4A5D4E` | Sage mark fill (via action primary), selected text, chip text, primary buttons |
| `--color-accent` | `#C18C5D` | **Fill only.** 2.93:1 as text on white — **forbidden as `--status-*-fg` or body/chrome foreground.** Ink on this fill is 4.93:1 (pass) if a tan well is ever needed. This chunk does not require an accent-fg control; do not paint “Simulation Active.” |
| `--color-action-primary-fg` | `#ffffff` | Label on sage (7.08:1) |
| `--color-action-primary-surface` | `#4A5D4E` | Same sage as `--color-primary` |
| `--color-action-destructive-fg` | `#ffffff` | Unchanged pairing |
| `--color-action-destructive-surface` | `#9b1c1c` | Unchanged |
| `--color-badge-fg-on-exception` | `#ffffff` | Unchanged |

`--radius: 8px` (not a colour; allowed off `--color-*`). Apply to nav rows, search input, chips, sage mark.

### 7.2 Status rungs (locked hex)

Rung names unchanged. Informational **drops institutional blue**. Settled stays a **distinct green**, not `#4A5D4E`. Attention / exception stay amber / red, surfaces warmed toward the new neutrals.

| Rung | `--color-status-*-fg` | `--color-status-*-surface` | vs surface | vs `#ffffff` (`--color-surface-base`) |
|---|---|---|---|---|
| `settled` | `#0d5c2e` | `#E8F2EA` | 7.08 | 8.12 |
| `informational` | `#3A4F40` | `#EEF1EC` | 7.77 | 8.85 |
| `attention` | `#8a5a00` | `#FBF4E8` | 5.42 | 5.93 |
| `exception` | `#9b1c1c` | `#FBF3F0` | 7.44 | 8.15 |
| `neutral` | *(no fg/surface)* | empty `.status-neutral` rule stays | — | — |

Borders stay `color-mix` of fg 35% toward `--color-surface-base` (existing alias pattern).

If implementation nudges a hex and the gate goes red, **darken the fg** (not the gate). Do not ship prototype accent as informational.

### 7.3 Typography / motion / theme

- Keep `font-family: "IBM Plex Sans", "Segoe UI", sans-serif`. **Load** IBM Plex Sans 400/600 in `apps/web-pms/index.html` (Google Fonts `<link>` or self-hosted `@font-face` under `apps/web-pms/public`). No new display font.
- Nav labels `0.75rem`. Rail search / chips `0.75rem`.
- `color-scheme: light` stays. **No** dark tokens.
- **No** `box-shadow` on sidebar, rail, mark, or chips (prototype `shadow-sm` / `shadow-xs` out).
- **No** `animate-pulse` / `animate-ping`. Existing `prefers-reduced-motion` tape rule stays.

---

## 8. Screens — light markup only (normative)

Do not rebuild layouts. Housekeeping, inventory, rates, staff, roster, settings, guests directory **inherit** via `.panel` / `.badge` / `status-*` / buttons. Touch them only if a stay is shown with a raw `roomId` / `guestRef` as the **primary** label (§8.1).

### 8.1 Guest names and room codes (everywhere a stay is shown)

Primary label of a **resolved** stay is the guest **name** (existing `GuestNameLink`). Primary room label is the **code** (`101`), never `rm_101`. If the rooms GET fails or the code is missing: **omit** the room clause — do not fall back to `roomId` on the happy path.

| Surface | Today | This chunk |
|---|---|---|
| Tape | Name + code already | Keep. Title §8.2. |
| Front Desk / in-house / departures (`BoardScreen`) | Col 1 = `reservationId` | Guest name leads. Room **code** via `listRooms` when `row.roomId` is set. `reservationId` may remain as a folio link, not the lead cell. |
| Reservations directory | Code map; else truncated `roomId` | Code or omit. No truncated id. |
| Guest profile stays | `row.roomId` | Code or omit (`listRooms`). |
| Folio header | Code already (P0-2) | Skin only. |
| Check-in | Free-text `roomId` | §8.4 picker by code. |
| Global search | Name then id button | §4.1 name first. |
| `guestLabel` pending/erased | `{guestRef} (name pending)` | **Keep** — that is pending honesty, not a resolved stay. |

`name_pending` / `erased` / `not_found` suffixes in `guest-row.tsx` are unchanged.

### 8.2 Tape — Room Plan

- Page title **Room Plan** (replace `Board`). `class="board-title"` may stay.
- Tape / Available view links stay.
- `BoardSummary` chips: cream fill / sage text / `--radius` (classes, not a new widget). Overstay chip keeps `statusClass('exception')`.
- Stay blocks keep `statusClass` / `boardRowSeverity`. Do not restyle blocks with prototype tape colours.

### 8.3 Book — dollar quote

| Remove from the visible page | Keep on the wire / in tests |
|---|---|
| Paragraph **“Type-only stay — no rate quote in this screen.”** | — |
| Visible **“Quote ariVersion {n}”** | `reservations.create` still sends `quoteAriVersion`. Confirm still gated on a successful availability read. `data-testid="quote-version"` stays on a **visually hidden** node (or `data-ari-version` attribute) so existing Confirm-gate tests do not lose the hook. |
| `({contextGuestRef})` next to the context name | `data-testid="context-guest"` stays; text is **Booking for {displayName}** only. |

**Dollar quote (locked):** when dates + `roomTypeId` are set, `GET` `listRateDays` for that type, `ratePlanId: 'BAR'`, `fromDate = arrival`, `toDate = last night` (departure exclusive, same half-open stay as availability). Sum integer `amountMinor`. Visible `data-testid="stay-quote"`: **`$` + `formatMinor(sum)`** (demo tenant is USD). If the GET fails, any night is missing, or the sum cannot be formed: omit the quote line (do not show `$0.00`). Do not block Confirm on rates (TOCTOU gate remains `quoteAriVersion`). No plan picker. No new route.

### 8.4 Check-in — room picker by code

Replace the free-text `placeholder="room id"` with a `<select data-testid="check-in-room">` (new testid on the **same** assign control surface). Options: rooms from existing `api.listRooms` (`get_rooms`, `housekeeping:read` — staff has it). **Label = code**, **value = `roomId`** (mutations unchanged). Prefer rooms whose `roomTypeId` matches the reservation when that is known. Empty option **Select room**. Preassigned `reservation.roomId` selects that option.

If `listRooms` fails: omit the select rather than restoring a raw-id text field on the happy path. Assign / Check-in buttons and `data-testid="check-in"` stay.

Registration card: keep `print-reg-card` / `reg-card`. It remains a **print** control (existing `@media screen` clip). Pass **code** as `roomLabel` when known. Do not make the blob a permanent on-screen document. Do not change print contents beyond room code vs id.

### 8.5 Folio — skin only

Headers, buttons, chips, Advanced `<details>` pick up new tokens / `--radius` / primary sage. **Do not** move first-paint vs Advanced. **Do not** rename testids. Optional: header status copy `checked_in` → **In house** (and the map in §8.7) — that is copy, so Folio tests that `getByText(/checked_in/i)` update.

### 8.6 Night audit — operator job chrome

Not a JSON dump. Keep:

- Title **Night audit** (or **Night Audit** — either; tests use `/run night audit/i`).
- Banner `data-testid="audit-banner"` + `statusClass`.
- **Step wire names** in the table (`PRE_CHECK`, …) — DEMO-READY: step names stay.
- Run / Resume / Retry.
- `data-testid="report-table"`; money via `formatMinor`.

Change:

- Do not present leftover object fields via `JSON.stringify` on this page.
- Report picker: humanize `revenue` → **Revenue** (title-case `reportId`). Tests that `getByRole('button', { name: 'revenue' })` update to `/revenue/i`.
- Table header cells: human labels for known keys (`roomNet` → Room net, `taxTotal` → Tax, `businessDate` → Business date). Unknown keys may stay as-is rather than dumping JSON.

### 8.7 Reservation status copy (locked map)

On board tables, directory, folio header (not tape blocks, which are colour-only):

| Wire | Visible |
|---|---|
| `pending` | Pending |
| `confirmed` | Confirmed |
| `checked_in` | In house |
| `checked_out` | Departed |
| `no_show` | No-show |
| `cancelled` | Cancelled |

Unrecognized wire → existing informational severity; do not invent a label. Tests that match wire strings on those surfaces update (copy moved).

---

## 9. `data-testid` contract (normative)

Every id below **must remain** on the same control. Moving a node into `<aside>` / `<details>` / the rail is allowed. Renaming the id is not.

| `data-testid` | Notes |
|---|---|
| `reservation-search` | Rail search input |
| `reservation-search-results` | Result list |
| `me-no-access` | Unchanged |
| `exceptions-panel` | May wrap `<details>` |
| `open-shift-badge` | Text without `shiftId` |
| `force-close-callout` | Unchanged |
| `board-summary` / `board-summary-overstay` | Unchanged |
| `tape-from` / `tape-to` / `tape-unassigned` | Unchanged |
| `quote-version` | Visually hidden; Confirm-gate hook |
| `context-guest` | Name only; no `guestRef` text |
| `confirm-book` / `guest-find` / `guest-name` / booking screen ids | Unchanged |
| `check-in` / `override-cleanliness` / `print-reg-card` / `reg-card` | Unchanged |
| `folio-*` (P0-2 table) | Unchanged |
| `night-audit-screen` / `audit-banner` / `report-table` | Unchanged |
| `guest-profile-link` / `guest-book` | Unchanged |

**New (allowed):**

| `data-testid` | On |
|---|---|
| `shell-role` | Sidebar role word |
| `property-name` | Rail property name |
| `business-date-chip` | Rail date chip |
| `stay-quote` | Book dollar quote |
| `check-in-room` | Check-in `<select>` |

Print CSS: hide `aside`, `.ops-rail`, `.shift-strip`, `.side-panels` (extend today’s hide list). Keep `.reg-card` print behaviour.

---

## 10. Command / HTTP decision (normative)

Existing reads suffice. SPA-only.

| Need | Existing | Decision |
|---|---|---|
| Role footer | `GET …/me` (`get_property_me`) | **Reuse.** |
| Property name + TZ | `GET …/properties/:id` (`get_property`) already in `PropertyTimeZoneProvider` | **Reuse.** No second fetch if the query cache hits. |
| Business date chip | `propertyLocalToday(timeZone)` | **Reuse helper.** Not night-audit GET. |
| Dollar quote | `get_rate_days` / `listRateDays` (`rates:read`) | **Reuse.** BAR + type + stay nights. |
| Check-in / board / profile room codes | `get_rooms` / `listRooms` (`housekeeping:read`) | **Reuse.** Folio / directory already do. |
| Search | existing reservation search | **Reuse.** |

**Rejected:** `GET …/business-date`, widening `get_property` with `__meta.business_date`, `quoteStay` HTTP, `lucide-react`, Tailwind, `packages/ui-kit`, Dashboard Hub route, property switcher.

---

## 11. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `apps/web-pms/src/styles/tokens.css` | §7 primitives + status hex + `--radius` |
| `apps/web-pms/src/styles.css` | Sidebar / rail / selected / chips / collapse / print; drop horizontal `.nav` underline rule |
| `apps/web-pms/index.html` | Title; IBM Plex `<link>` or equivalent |
| `apps/web-pms/src/shell/AppShell.tsx` | Frame §3–§5; search placeholder; role footer |
| `apps/web-pms/src/shell/nav.ts` | Labels, paths unchanged except labels; orders; drop `in-house` / `departures`; `tone` |
| `modules/pms/housekeeping/src/ui.manifest.ts` | `order: 50` |
| `apps/web-pms/src/shell/icons.tsx` | **New.** §6 subset |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | Collapse when empty |
| `apps/web-pms/src/screens/ExceptionsPanel.tsx` | Collapse when empty |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | Hide `shiftId` on badge |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | Title Room Plan |
| `apps/web-pms/src/screens/board-summary.tsx` | Chip classes |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Quote / context name |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Room `<select>` + `roomLabel` |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Name leads; room code; status copy |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | Room code or omit; status copy |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | Stay room code |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Skin + optional status copy |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | Job chrome labels |
| `apps/web-pms/src/screens/registration-card.tsx` | Receives code (caller) |
| Tests in §13 | Shell DOM / copy movers only |
| Pointers | one sentence in folio-first-paint + demo-tenant-seed when this lands |
| DEMO-READY.md | tick P0-3 in the **implementation** PR, not this spec turn |

No `v1-http-routes.ts`. No catalog. No migration. No `demo-seed.ts`. No `ARCHITECTURE.md` §16.4 rewrite. No `packages/ui-kit`. No Tailwind config.

---

## 12. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Sidebar + sage mark + HospAI PMS + selected cream/sage/icon | DEMO-READY P0-3 shell |
| 2 | Role footer from `/me`; no role-swap | P0-3 |
| 3 | Ops rail: search (name first), property name, business-date chip | P0-3; seed leftover |
| 4 | Shift strip under rail; queued + exceptions collapsed when empty | P0-3 |
| 5 | Local SVG subset; no lucide / motion | P0-3 |
| 6 | Primary / secondary nav order; drop in-house & departures from sidebar | P0-3 |
| 7 | AA palette + status re-derivation + `--radius` + IBM Plex load | P0-3 |
| 8 | Light screen markup §8 | P0-3 |
| 9 | Hide `shiftId` on open-shift badge | P0-2 leftover |
| 10 | Status copy In house / Departed / … on stay tables | P0-2 leftover |
| 11 | Folio headers/buttons/chips skin | P0-2 leftover “folio skin” |

---

## 13. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **P0-4** Clerk / real `/sign-in` / hide `X-Dev-Actor` | Role footer uses `/me` whoever it is |
| 2 | **P0-5** 8-minute script, dry runs, kill list | Kill list will still say Settings / Folio Advanced / Exceptions / Staff |
| 3 | **P1** guest CRM depth; card last-4 / brand; one hotel voice; leftover lab-copy scan (`ariVersion` hidden here; `fail_closed` strings / `idempotencyKey` / `user_owner` elsewhere stay until P1) | |
| 4 | **P2** ARCHITECTURE §16.4 palette-adoption note; `packages/ui-kit` extraction | DEMO-READY P2. Tailwind still out. |
| 5 | Pixel-faithful prototype screens (tape popups, billing app, Dashboard Hub, recharts, Whistle) | DEMO-READY out of scope |
| 6 | Tailwind v4 | Forbidden |
| 7 | New Worker routes / commands / schema / seed changes | Forbidden |
| 8 | Widening `GET /properties/:id` with `__meta.business_date` so the chip follows night-audit roll | Calendar-today is locked for this chunk |
| 9 | Property switcher / second property | Single demo tenant; P0-5 optional moat |
| 10 | Dark theme; prototype shadows / pulse | Forbidden |
| 11 | Plan picker / `quoteStay` HTTP / blocking Confirm on missing rates | Dollar quote is compose-only |
| 12 | City ledger / invoices / auto-transfer / virtual room types | Phase 1 |
| 13 | Making `/in-house` and `/departures` disappear as routes | Routes stay; BoardSummary links stay |

---

## 14. Tests (acceptance-shaped)

**Pins (must stay green; this chunk does not move heads)**

1. `COMMAND_CATALOG` length **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. No new audit row.
2. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `pnpm generate:ddl` no-op. `CLASS_DENYLIST` unchanged.
3. `pnpm check:web-pms-colors` green. Informational fg is not `#1a4a6e`. Every `--status-*-fg` ≥ 4.5:1 vs its surface and `--color-surface-base`.

**Nav / shell**

4. `ALL_NAV` ids in order: `board`, `arrivals`, `reservations`, `book`, `housekeeping`, `guests`, `rates`, `night-audit`, `settings`, `inventory`, `staff`, `roster`, `exceptions`. **Not** `in-house` / `departures`.
5. Labels: Room Plan, Front Desk, Reservations, New Booking, Housekeeping, Guests, Rates, Night Audit, Settings; quiet: Inventory, Staff, Roster, Exceptions.
6. Live `reservations:read` only: Room Plan + Front Desk + Reservations (plus any other `reservations:read` leftovers — not Book / Settings). Housekeeping still requires `housekeeping:read`.
7. `filterNavEntries` pending empty / unknown fail-open (now without in-house/departures entries) / permission hiding **unchanged in spirit**. Update order assertions (`guests` is no longer between reservations and book; exceptions `order === 130`, after Settings).
8. AppShell: `<aside>` present; `getByText(/HospAI PMS/i)`; `getByRole('navigation', { name: /hospai pms/i })`; selected `/board` has cream/sage (class or computed assertion optional — presence of `aria-current` is enough). Boot test: nav still mounts on PropertyDO fail_closed; `exceptions-panel` still in the document; queued summary still in the document (may be collapsed).
9. Live `/me` `role: 'owner'` → `shell-role` text **Owner**. No `<select>` for role. No “Simulation Active”.
10. `getProperty` name **The Meridian Seattle** (or mock `Demo`) → `property-name`. Mock unreachable → `queryByTestId('property-name')` null; shell still up.
11. Timezone mock UTC + fake timers date → `business-date-chip` matches `propertyLocalToday`. No night-audit GET from AppShell.
12. Search placeholder matches `/guest name/i`. Results: visible text includes displayName; does **not** lead with `res_` as the only label. `reservation-search` testid stays. Enter-one-hit → folio (existing).
13. Queued empty: wrapping `<details>` not `open`. Exceptions count 0 + success: not `open`. Count 1: open (or list visible). Fail-closed exceptions: error copy visible.

**Shift**

14. `open-shift-badge` matches float + cash posts; does **not** match `shift_1` when that is the mocked id.

**Screens**

15. Tape: `getByRole('heading', { name: /room plan/i })`. Stay block still has `statusClass` (existing guest/folio tests).
16. Book: `queryByText(/Type-only stay/i)` null. Visible tree does not match `/ariVersion/i`. `stay-quote` shows `$` + major when `listRateDays` returns two nights × `15000` → `$300.00` (or `300.00` with a leading `$`). `quote-version` still present (hidden). `context-guest` matches `/Maria/` and **not** `g_ctx`. Confirm still sends `quoteAriVersion`.
17. Check-in: no `placeholder=/room id/i`. `check-in-room` options labeled by **code**; selecting fires assign/check-in with `roomId`. `check-in` testid stays. `reg-card` still clipped on screen; print control stays.
18. Board: guest name is the lead label; room code when `listRooms` maps; `queryByText('checked_in')` null if the row status is shown as **In house**.
19. Guest profile stays: code not `rm_101` when rooms map `{ roomId: 'rm_101', code: '101' }`.
20. Night audit: step names still `PRE_CHECK` … `ARCHIVE`. Report button `/revenue/i`. `report-table` still formats money. No raw `{` JSON blob in the screen text on the happy path.
21. Folio: existing first-paint / Advanced tests stay green aside from optional `checked_in` → In house copy matcher. Skin must not drop `folio-advanced` / `folio-balance` / tenders.

**Forbidden chrome**

22. `queryByText(/Simulation Active/i)` null. `queryByText(/Whistle/i)` null. No property `<select>`. No training-disclaimer sentence.

---

## 15. Open questions (locked)

1. **Chrome vs pixel-faithful vs skin-only.** **Locked: chrome + skin** (DEMO-READY decided).
2. **Tailwind / ui-kit.** **Locked: neither.** Hand-written CSS + tokens.
3. **Accent `#C18C5D` as text.** **Locked: no.** Fill-only primitive. Darken if a later chip needs tan **text** (`#7A4E24` passes 7.14:1 on white) — not required this chunk.
4. **Business date source.** **Locked: property-local calendar today.** Not `getNightAudit`. Not a new GET.
5. **In-house / Departures.** **Locked: drop from sidebar; keep routes + BoardSummary links.**
6. **Folio in nav.** **Locked: no** (drill-in).
7. **Dollar quote.** **Locked: sum BAR `listRateDays` `amountMinor`; `$` + `formatMinor`.** Missing nights → omit. Confirm not gated on rates.
8. **`quoteAriVersion`.** **Locked: hidden, still sent, testid stays.**
9. **Check-in picker.** **Locked: `<select>` by code, value `roomId`, existing `listRooms`.**
10. **Architecture §16.4 rewrite.** **Locked: out (P2).**
11. **Worker / schema / seed.** **Locked: unchanged heads.**

---

## 16. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Shell frame §3–§5; icons §6; tokens §7; `check:web-pms-colors` green.
- [ ] Nav order/labels/tone §3.2; in-house/departures not in `ALL_NAV`; folio not in nav.
- [ ] Rail: search name-first, property name, business-date chip; no switcher / Whistle / Simulation / role-swap.
- [ ] Screens §8; testids §9; tests §14.
- [ ] Heads §1.1 unchanged. Pointers in folio-first-paint + demo-tenant-seed + DEMO-READY P0-3 ticks in the **implementation** PR.
- [ ] Stop. Do not start P0-4 / P0-5. Do not add Tailwind / ui-kit / Worker routes. Do not commit in the spec-authoring turn.

---

## 17. Reviewer checklist

- [ ] Verified-current-state table matches the tree (horizontal HospAI top-bar; Board / Arrivals / In-house / Departures equal nav; cool grey tokens + blue informational; Book type-only + visible ariVersion; check-in `placeholder="room id"`; queued + exceptions always open; no property name / date chip; catalog **77**, route **127**, property head **25**, org head **7**).
- [ ] Normative invariants include schema freeze, no new routes/commands/`export class`, colour-literal rule, 4.5:1 status gate, testid stability, no Tailwind/ui-kit/lucide/motion.
- [ ] **Exact** palette hex table §7 (including accent fill-only and informational sage `#3A4F40` / `#EEF1EC`).
- [ ] **Exact** nav order/labels/routes/icons/tone §3.2; in-house/departures deferred from sidebar; folio drill-in.
- [ ] **Exact** tokens to add/change §7; **exact** screens to touch §8 / file map §11.
- [ ] Scope-out names **P0-2** (done), **P0-4**, **P0-5**, **P1**, **P2** §16.4, pixel-faithful rebuild, Tailwind, ui-kit, Worker routes/commands, schema, seed, Whistle / Simulation / role-swap / disclaimer / property switcher.
- [ ] Folded leftovers §12 and deferred leftovers §13 both present.
- [ ] Acceptance tests §14 and this reviewer checklist present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn.
