# Design system re-skin (shadcn neutral) — design

**Roadmap:** R1.7a (inserted before R1.8 at the user's request) · **Status:** superseded 2026-11-01 by [House Colour](2026-11-01-house-colour-design-system-design.md); its layout rules (§10) stay in force · **Date:** 2026-10-29

**Source of truth:** the *PMS Design System* artifact (claude.ai/artifact/K3iBHP3BLUV3XBivCLWVrM): `project/tokens.json`, `project/README.md` and the component guidelines. It is a shadcn/ui neutral system built from the Shadcnblocks hotel dashboards.

**User decisions (2026-10-29):**
- **Scope:** re-skin plus new patterns, not full shadcn with Tailwind.
- **Themes:** ship both the light and the dark theme.

## 1. What this reverses, and what it keeps

The user's call overrides three locks. Each is amended in the **same commit**, so the docs never describe the old system.

| Lock | Today | After |
|---|---|---|
| ARCHITECTURE §16.4 *Palette* | Sage `#4A5D4E`, tan `#C18C5D`, cream; "no new hex" | **shadcn neutral** palette from the design system (§2). New hex lives only in `tokens.css` as `--color-*` literals. The colour gate stays merge-blocking. |
| AGENTS.md *How to work* #4 | "Do not add … dark mode, … a visual rewrite of `styles.css`" | Dark mode is allowed **only as a token theme** (§2.3). There is still no Playwright, Cypress, Redis or Storybook, and no second design kit. A screen-by-screen visual rewrite of `styles.css` is still banned: the re-skin is tokens plus `ui-kit` styles. |
| Font | IBM Plex Sans | **Inter** (400 / 500 / 600), plus **IBM Plex Mono** 600 for the one `action-label` style. |

**Kept unchanged:**
- **No Tailwind.** It stays a permanent ban (§16.4). The colour gate needs colour in `.css`, and `modules/*` has no bundler.
- **`packages/ui-kit` keeps its closed API**: no `className`, no `style`, no blanket `...rest`. shadcn components are **not** imported. The design system's components are rebuilt as `ui-kit` components or CSS contracts in its own grammar, as its README tells a non-shadcn codebase to do ("build each from the matching primitive and copy the sizes and tokens").
- **Desktop only.** No width breakpoints (§16.4 *Viewport*), whatever the design system says about small screens.
- `PageHeader` stays the single `<h1>` per page, and every page keeps its `Card` shell (`check:spa-page-chrome`).
- Hex appears only in `tokens.css`, and every `check:*` gate stays.

## 2. Tokens

### 2.1 Palette mapping (light)

These are the design system's oklch values, converted to sRGB hex because the gate parses hex. The existing token names stay, so `styles.css` and `ui-kit` keep compiling against the same variables.

| Existing primitive | Design token | Light hex |
|---|---|---|
| `--color-bg` | `background` | `#ffffff` |
| `--color-surface-base` (`--panel`) | `card` | `#ffffff` |
| `--color-ink` | `foreground` | `#0a0a0a` |
| `--color-muted` | `muted-foreground` | **`#6b6b6b`** (see §2.2) |
| `--color-line` | `border` / `input` | `#e5e5e5` |
| `--color-selected` | `muted` / `accent` / `sidebar-accent` | `#f5f5f5` |
| `--color-primary` / `--color-action-primary-surface` | `primary` | `#171717` |
| `--color-action-primary-fg` | `primary-foreground` | `#fafafa` |
| `--color-action-destructive-surface` | `destructive` | `#e7000b` |
| `--color-action-destructive-fg` | `destructive-foreground` | `#fafafa` |
| `--color-accent` (tan, 5 uses in `styles.css`) | `ring` / `focus` | becomes **`--color-focus` `#0a0a0a`** (focus outline). The five tan uses are restated against `--line` / `--primary`; the radial-gradient decoration on the sign-in page is dropped. |
| `--color-status-settled-*` | `status-confirmed`, `-bg` | `#007a55` / `#d0fae5` |
| `--color-status-informational-*` | `status-inhouse`, `-bg` | `#0069a8` / `#dff2fe` |
| `--color-status-attention-*` | `status-pending`, `-bg` | `#bb4d00` / `#fef3c6` |
| `--color-status-exception-*` | `status-noshow`, `-bg` | `#c10007` / `#ffe2e2` |

New primitives:
- **`--color-sidebar`** `#fafafa`
- **`--color-status-vip-*`** `#7008e7` / `#ede9fe`
- **`--color-status-cancelled-fg`** `#525252` (on `--color-selected`)
- **`--color-room-clean`** `#009966`, **`-dirty`** `#e17100`, **`-inspected`** `#0084d1`, **`-ooo`** `#e7000b`

The design system's chart, booking-series, avail-* and delta tokens are **not** added: nothing in Phase 1 draws those charts (§4).

### 2.2 One deliberate deviation

In light mode the design system's `muted-foreground` (`#737373`) measures **4.34:1** on `muted`. The gate's `--muted` on `--selected` pair needs **4.5:1**. The gate outranks the palette (§16.4), so light `--color-muted` is **`#6b6b6b`**: 4.9:1 on `muted` and 5.3:1 on white. The design system's own README already flags this pair. I'll suggest the same change in the artifact after this lands.

### 2.3 Dark theme

- The dark values come from the design system's `dark` column.
- Its alpha values (`border`, `input` and the status backgrounds at 40%) are pre-composited over `card` (`#171717`) into opaque hex, so the gate can measure them. For example, dark `border` is `#2e2e2e`.
- The theme switches on `@media (prefers-color-scheme: dark)` in `tokens.css`, which redefines only `--color-*` primitives.
- `:root` gets `color-scheme: light dark`.
- ~~There is no in-app theme toggle.~~ **Amended by §9.1:** the user asked for a light / dark switch.
- Print CSS forces the light primitives (the registration card stays black on white).
- **Gate extension (strengthened, not relaxed):** `check:web-pms-colors` learns to read the dark block. It runs every `CHROME_PAIRS` entry and every `--status-*-fg` / `-surface` pair in **both** themes, and adds a self-test case for a failing dark pair.

### 2.4 Type, radius, spacing, size, shadow

- **Font.** `--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif` and `--font-mono: "IBM Plex Mono", ui-monospace, monospace`.
  - Inter 400/500/600 (latin) and Plex Mono 600 are self-hosted woff2 under `apps/web-pms/public/fonts/`, copied from the OFL `@fontsource` packages. CSP stays `default-src 'self'`, with no Google Fonts.
  - The IBM Plex Sans files and `@font-face` rules are removed.
- **Text scale** (existing `--text-*` names):
  - `xs` 11px (`caption` / `table-head`)
  - `sm` 12px (`small`)
  - `base` 14px (`body`)
  - `md` 16px (`card-title`)
  - `lg` 18px (`panel-title` / `kpi-value`)
  - `xl` 26px (`page-title`, used for the `PageHeader` h1)
  - New: `--text-metric` 36px and `--text-eyebrow` 10px.
  - Numbers use `font-variant-numeric: tabular-nums` in tables, metrics and money.
- **Radius.**
  - `--radius` becomes 6px (`radius-md`: buttons, inputs, nav items).
  - New: `--radius-sm` 4, `--radius-lg` 8, `--radius-xl` 12 (cards, the app frame), `--radius-full` 9999px (badges, dots, avatars).
- **Spacing.** The design system is a 4px step. `--space-5` becomes 20px (from 24) and `--space-6` becomes 24px (from 32). `--space-1`…`--space-4` are unchanged.
- **Sizes.**
  - `--control-h` becomes 32px (`h-control`) and `--control-h-sm` 28px.
  - New: `--input-h` 36px (search, selects and the tabs track), `--badge-h` 20px, `--table-head-h` 36px and `--table-row-h` 48px.
  - The sidebar stays **16rem**. The design system's 240px is a 16px difference, and §16.4 fixes 16rem.
- **Shadow.** Borders, not shadows.
  - There is one `--shadow-xs` (`0 1px 3px 0 rgb(0 0 0 / 0.05)`), used on outline buttons, selects and the active tab.
  - **Dialogs keep one overlay elevation**, `--shadow-overlay`, because a modal needs it above the scrim. It replaces today's ad-hoc shadows at `styles.css:875`, `:1078` and `:1772`.
  - Focus rings move from tinted `box-shadow` to a **2px solid `--focus` outline with a 2px offset**, as the design system's States section specifies.
- **Motion.** Colour transitions only, at 150ms.

## 3. Existing ui-kit components, restyled (same API)

| Component | Change |
|---|---|
| `Button` | `default` intent becomes shadcn **outline** (background, 1px border, `shadow-xs`). `primary` becomes the near-black fill, `ghost` gets an `accent` hover, and `destructive` the red fill. Height 32px, `radius-md`, 12px label at 500. |
| `Input`, `NativeSelect`, `Textarea` | 36px, 1px `input` border, `radius-md`, `shadow-xs` on selects, focus outline. |
| `Card` / `CardHeader` / `CardTitle` | `card` fill, 1px border, `radius-xl`, no shadow, padding `space-5 × space-6`. `CardTitle` uses `card-title` (16px / 500). |
| `DataTable` | `muted` header band at 40% with 36px header and 11px / 500 muted labels; 48px rows split by hairlines; row hover `muted` at 20%. |
| `Badge` | Pill: 20px, `radius-full`, 11px / 500, tinted fill. Existing `rung` values map to the new status pairs (§2.1). |
| `Alert` | Same four intents on the new status pairs, 1px border, `radius-lg`. |
| `Tabs` (`.ui-tabs`) | shadcn tabs: `muted` track 36px with a 3px inset; the active trigger sits on `background` with `shadow-xs`. |
| `PageHeader` | h1 at `page-title` (26px / 500, −0.65px tracking); subtitle `muted-foreground` 14px. |
| `Metric` / `Metrics` | Become the design system's **KpiCard**: `card` with a 1px ring, 14px muted label, 18px / 600 tabular value; three to four in a row. **No delta**: no read returns a trend, and trends are warehouse (§7.8). |
| AppShell sidebar (web-pms CSS) | Background `sidebar`, hairline edge. Nav items are 32px, `radius-md`, with `sidebar-accent` hover and an active state at weight 500. Group labels use `nav-group` (12px / 500 at 70%). Existing icons are kept at 16px. The property mark is the property's initial on a `primary` tile. **Nav labels and order are unchanged.** |

## 4. New patterns (ui-kit additions)

Each pattern below is added under the closed API, gets tests in `components.test.tsx` and an entry on `/dev/ui`, and is adopted on the screens named:

1. **`StatusBadge`** — `{ status: ReservationStatus; vip?: boolean }`.
   - Renders the fixed word for the reservation life cycle: Inquiry, Pending, Confirmed, In house, Checked out, Cancelled, No-show.
   - Tones: `pending` → attention, `confirmed` → settled, `checked_in` → informational (in-house blue), `no_show` → exception, `cancelled` / `checked_out` → `cancelled` grey, `inquiry` → neutral.
   - A separate `VIP` pill uses `status-vip`. Colour never stands alone.
   - Adopted wherever a reservation status is shown today: Reservations directory, Board rows, Folio header, Guest profile stay history.
2. **`RoomStatus`** — `{ status: 'clean' | 'dirty' | 'inspected' | 'out_of_order' }`.
   - An 8px dot in `--color-room-*`, then the fixed word (Clean, Dirty, Inspected, Out of order) at 12px.
   - Adopted in the housekeeping board, the assign-room dialog and Inventory rooms.
   - The tape chart adopts it only if its room column already shows the HK state.
3. **`Eyebrow`** on `CardHeader` — an optional `eyebrow` prop: an uppercase `muted-foreground` path line above the title at 10px / 600 with 1.6px tracking. Adopted on the Dashboard's lead card ("Front office / Today").
4. **Quick action** — a CSS contract, `ui-quick-action`, used on a router `Link`, like `ui-link-btn`. The kit cannot depend on the router (AGENTS *Do not fix*).
   - A 92px card on `background` with a hairline and `radius-lg`: a 20px icon top-left, an `arrow-up-right` top-right in muted, and the label bottom-left in `action-label` (Plex Mono 10px / 600 uppercase, 0.8px tracking).
   - The Dashboard gets four, each shown only with its route permission: **New booking** `/book`, **Arrivals** `/arrivals`, **Room plan** `/board`, **Night audit** `/night-audit`. The last replaces today's Night audit link.
5. **`StatField`** — `{ label; value }`: a muted 11px label over a 14px / 500 value, for the label/value grids already on the Dashboard and Folio header.

## 5. Not built (design-system components with no Phase 1 home)

- **OccupancyChart, RevenueChart, BookingSourcesChart, AvailabilityCalendar.** These are trends: warehouse (§7.8) and R5.x. There is no Recharts and no reservation scans.
- **BookingsPanel, BookingCard, DateStrip.** A 300px right-hand panel is a new desk layout, not a re-skin. A later slice can propose it against the board.
- **TapeChart rebuild** (mid-column bars, overlap lanes). The tape gets the new tokens only, and its bar geometry is unchanged. A redesign is its own slice.
- **PageHeader greeting bar** ("Hello Dana", search, notifications). It conflicts with `PageHeader` as the page `<h1>` and with the existing top bar and ShiftStrip. The top bar is restyled, not restructured.
- **Lucide as a dependency.** The existing inline SVG icons (`shell/icons.tsx`) already use Lucide geometry (24 viewBox, 2px round stroke). Missing glyphs (for example `arrow-up-right`) are hand-copied into that file.

## 6. Feature checklist (AGENTS §6)

- [x] No route, command, permission, migration or pin change.
- [x] No Settings control (there is no theme toggle).
- [x] Hex only in `tokens.css`; colour gate extended to both themes; WCAG AA on every chrome and status pair in light and dark.
- [x] ui-kit API stays closed; new components and props are typed and tested; `check:ui-kit-adoption`, `check:class-resolution` and `check:spa-page-chrome` pass.
- [x] Desktop only; no breakpoints.
- [x] ARCHITECTURE §16.4, AGENTS.md (#4 and the "Kit" paragraph) and the memory note are amended in the same commit.

## 7. Tests and verification

- **ui-kit:**
  - Unit tests for `StatusBadge` (word per status, VIP pill, tone class), `RoomStatus` (word per state), the `CardHeader` `eyebrow` and `StatField`.
  - `api-surface.test.ts` updated for the new exports, still with no `className` / `style` props.
- **Colour gate:** a self-test for a failing dark pair, plus a real run passing in both themes.
- **web-pms:** existing screen tests updated only where markup changed, such as the status word now coming from `StatusBadge`. The Dashboard shows quick actions per permission.
- **Browser:** every top-level screen, captured in light and in dark (`prefers-color-scheme` emulation): Dashboard, Room plan (`/board`), Arrivals, Reservations, Book, Folio, Rates, Housekeeping, Night audit, Settings, Sign-in.
  - Check focus outlines, table bands, badges and dialogs.
  - Check printing the registration card in dark (it must print light).

## 8. As built (2026-10-29)

- **Sidebar mark** stays the HospAI tile (primary fill); the shell tests keep the wordmark when the property name is missing. The nav has no group-label element, so `nav-group` styling has nothing to apply to. Nav labels and order are unchanged.
- **Quick actions:** New booking needs `reservations:write`; Arrivals and Room plan need `reservations:read` (their nav permission — those routes are not behind `PermissionRoute`); Night audit needs `night_audit:run`. They replace the Dashboard's header links.
- **`StatusBadge`** is the one source of the reservation words (`reservationStatusWord`); ui-kit does not depend on contracts, so its union is pinned to the contracts list by `reservation-status-pin.test.ts`. On the Departures board a guest still checked in reads *In house*.
- **`RoomStatus`** is on the Room Plan room column and Inventory rooms. The assign-room picker is an `<option>`, so it uses the same word (`101 · Clean`). The housekeeping board shows the state only in its editable select (no duplicate dot line).
- **Review fixes:** the dialog scrim is its own `--color-scrim` (it inverted to white in dark when mixed from `--ink`); `DataTableRow` rung fills are a 40% mix over the panel, not the full status surface.
- **Not yet:** the tape stay-block VIP marker is still text; `docs/design-prototype/` keeps the old palette (reference only, not served).

## 9. Review round 2 (user feedback, 2026-10-29)

### 9.1 Theme switch

- The **sidebar footer** gets a **theme switch**, full width above the role and Log out row (moved from the top bar at the user's request). It is a three-way segmented control: **System**, **Light**, **Dark**. Each option is a ui-kit `Button` (ghost, icon only), carrying `aria-pressed` and an `aria-label`.
- **Storage:** the choice is a per-browser display preference, saved in `localStorage` key `hospai.theme` (`system` | `light` | `dark`). Every read and write is wrapped in try/catch, and the default is `system`.
- **Not server config:** it is not a property Settings key and pms-core does not read it. The AGENTS rule about saved Settings controls covers server config, not a per-browser display preference.
- **Applying it:** the switch sets `data-theme="light|dark"` on `<html>` (removed for System).
- **No flash on load:** a tiny external `public/theme-init.js` applies the stored value before first paint. CSP stays `script-src 'self'`, with no inline script.
- **`tokens.css` dark selectors:** the dark primitives apply under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` **and** `:root[data-theme="dark"]`.
- **Colour gate:** it reads both dark blocks, fails if they define different values, and checks contrast as before.

### 9.2 Buttons match the design system's usage

The CSS matched; the usage did not.

- **One height.** The design system has one button height, 32px. `size="sm"` keeps its prop but renders at `--control-h` with 10px padding, so table-row and card buttons match header buttons.
- **Primary at most once per view.** In each rendered view (a page, a tab or a dialog), only the action the view exists for is `primary`. Other submit buttons on the same view become the default outline.
- **Destructive fill only for cancel, void and refund**, and the confirm button of a destructive `ConfirmDialog`.
  - Row triggers for **Archive** / **Remove** become the default outline.
  - Those row triggers must open a `ConfirmDialog` whose confirm button is `destructive`; add one where a trigger archives without confirming.
  - `Void`, `Cancel reservation` and `Refund` keep `intent=destructive` (AGENTS §4).
- **Badges are text pills.** The design system's badges have no leading dot, so the `.ui-badge::before` dot is removed (`RoomStatus` keeps its dot, which is that component's design). Status words in badges are sentence case ("Active", "Archived").

### 9.3 Overstay sits inside the In-house card

- `BoardSummary` rendered the overstay `Badge` as a sibling of the KPI cards. It was a chip beside a chip before the re-skin, but a stray item between cards after it.
- **Fix:** the overstay count moves **inside** the In-house card, under its value, as an exception badge ("8 overstay"). The card still links to `/in-house`, and `data-testid="board-summary-overstay"` stays.
- `Metrics` lays out as an equal-column grid, four cards in a row, so no single item can sit between them.

## 10. Layout and spacing pass (user feedback, 2026-10-29)

An audit of every route turned up recurring layout faults. These rules are now part of the system:

1. **Card anatomy.** A `Card`'s direct children are only `CardHeader`, `CardContent` (`flush` for an edge-to-edge `DataTable`) and `CardFooter`. No raw `<p>`, `<form>`, `<dl>`, `Badge` or link sits directly in a card.
   - Seen on: Shift open/close/receipt.
2. **No card inside a card.** A page wrapper becomes a `ui-page-stack` `div` that keeps its `data-testid`; the inner sections stay `Card`s. (`check:spa-page-chrome` still finds a `Card` in source.)
   - Seen on: `settings-screen`, `inventory-screen`, `staff-screen`, `roster-screen`, `exceptions-workbench`.
3. **Vertical rhythm.** Stacked cards on a page are `--space-6` (24px) apart. Inside `CardContent`, blocks (paragraphs, field rows, tables, the submit row) are `--space-4` (16px) apart through a column `gap`, never ad-hoc margins. Fields that sit side by side use `ui-row` / the existing grid with `--space-3` gaps. A submit button never touches the field above it.
4. **Section titles.**
   - A titled group is its own `Card` with `CardHeader` / `CardTitle`.
   - A subsection inside one card uses ui-kit `SectionLabel`.
   - No unstyled `<h2>` / `<h3>`.
   - Seen on: Folio windows, Split charge, Discount, Chargeback, FX adjustment, Queued; front office and registration card; Rates *Create Rate Plan*, *Promo codes*, *Bulk fill*; Settings *FX Rates*.
5. **Label / value pairs** use `StatField` in a `ui-stat-grid` (auto-fill columns ≥ 10rem, `--space-3` × `--space-6` gaps). No raw `<dl>`.
   - Seen on: Shift receipt, City-ledger account detail, Guest contact.
6. **Empty states** inside a card use `EmptyState`, not a bare muted sentence. The empty, error and no-filter-match states keep their own copy.
7. **Lists.** No browser-default bullets in app chrome. An empty list renders nothing.
   - Seen on: Folio, Rates plans.
8. **Dense row editors** (a field per table cell, as on Inventory rooms) use `VisuallyHidden` labels, like the rate matrix.
9. **Badges never stretch.** In a flex column they keep their content width.
10. **Navigation actions** such as *Back to board* are `ui-link-btn`, not bare text links.
