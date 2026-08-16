# SPA page-shell consistency (PageHeader + Card anatomy)

**Tree verified 2026-08-16:** `COMMAND_CATALOG` length **89** (`packages/contracts/dist/commands/catalog.js`), `AUDIT_WRITER_COMMAND_IDS.size === 63` (`packages/contracts/src/register.test.ts:269`), `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement` (`packages/contracts/dist/v1-http-routes.js`), `PROPERTY_SCHEMA_HEAD === 34` (`packages/do-runtime/dist/schema-head.js`), `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'` (`apps/pms-core/test/night-audit-room-charges.spec.ts:309–310`).

**Date:** 2026-08-16  
**Status:** Approved (reviewer, 2026-08-16)  
**Sources:** commit `2c4379e` (`feat(ui-kit,web-pms): layout, type and density scales`); `packages/ui-kit/src/PageHeader.tsx`, `Layout.tsx`, `Card.tsx`, `styles.css`; `apps/web-pms/src/screens/TapeChartScreen.tsx`, `BoardScreen.tsx`, `BookingScreen.tsx`, `board-summary.tsx`; `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`; `apps/web-pms/src/shell/nav.ts`; `apps/web-pms/src/styles.css`; `docs/design-prototype/arrivals.html`, `docs/design-prototype/AUDIT.md` findings **4**, **8**, **10**; [UI system convergence](./2026-08-13-ui-system-convergence-design.md) §9 (layout primitives); `scripts/ui-kit-adoption-check.mjs`; `ARCHITECTURE.md` §16.4.

**Closes:** Adoption gap left by `2c4379e` — ui-kit layout primitives (`PageHeader`, `Tabs`, `Toolbar`, `Metrics`/`Metric`, `RowActions`, `.ui-choice-row`) exist but **zero** operational screens import them (grep `PageHeader|Tabs|Toolbar|Metrics` under `apps/web-pms/src` → empty). Prototype audit findings **4** (row actions run-on), **8** (lowercase wire titles), **10** (tabs as plain text). Tape scroller grows unbounded (page scrolls instead of grid). **Does not** advance catalog, HTTP routes, schema, night-audit steps, or idempotency constants.

**Amends:** `ARCHITECTURE.md` §16.4 Enforcement — one paragraph append (Lock 10). Bidirectional pointer in [UI system convergence](./2026-08-13-ui-system-convergence-design.md) when this lands (implementation PR, not this spec turn).

---

## Executive summary

Operational SPA screens share ui-kit **components** but not ui-kit **page anatomy**. Commit `2c4379e` added `PageHeader`, `Tabs`, `Toolbar`, `Metrics`, `RowActions`, and choice-row CSS to `packages/ui-kit`, yet every screen still improvises titles, tabs, KPIs, toolbars, and card padding. Room Plan titles sit flush on card edges; Front Desk paints `arrivals` from `mode.replace`; row actions read as one sentence; the tape grid scrolls the whole page; Housekeeping has no Card at all.

This vertical **adopts one locked anatomy** on every operational screen: `PageHeader` (page `<h1>`) as a **sibling above** `Card`, optional `Tabs` / `Metrics` / `Toolbar`, section titles in `CardTitle` (`<h2>`). It fixes Room Plan tabs + KPI metrics + bounded tape scroll + sticky date header row; Front Desk titles + `RowActions`; Housekeeping Card/Toolbar; Book choice rows + back link. Remaining screens get a mechanical title lift only. Enforcement: merge-blocking `pnpm check:spa-page-chrome`, Cursor rule `.cursor/rules/spa-page-chrome.mdc`, TDD tests listed below. **No frozen heads move.**

---

## 1. Context & motivation

### 1.1 Root cause (verified)

| Layer | Shipped (`2c4379e`) | Live screens today |
|---|---|---|
| Page chrome | `PageHeader`, `Tabs`, `Toolbar`, `Metrics`/`Metric`, `RowActions` in `packages/ui-kit` | **0 imports** under `apps/web-pms/src` |
| Card padding | `.ui-card` has **no padding**; only `.ui-card__header` / `.ui-card__content` pad (`packages/ui-kit/src/styles.css:287–309`) | Room Plan puts `<h1>` inside bare `<Card>` with no `CardHeader` → title flush on edge |
| Field width | `.ui-field { inline-size: 100%; max-inline-size: var(--field-md) }` — **20rem** (`styles.css:126–131`, `--field-md: 20rem` line 33) | Tape / board date fields default size eat a flex row |
| Link affordance | Global `a { color: inherit; text-decoration: none }` + `.main a:not([class])` (`apps/web-pms/src/styles.css:393–397`) | Tape / Available `<Link>` with **no className** look like body text |
| Tape scroll | `.tape-scroller { overflow: auto; overscroll-behavior: contain }` — **no max-block-size** (`styles.css:309–313`) | Grid grows with rows; **page** scrolls; wheel over grid is useless |
| Contrast pattern | `.ui-table-scroll { max-block-size: 70vh; … }` (`packages/ui-kit/src/styles.css:455–458`) | Tape scroller lacks equivalent bound |
| Section heading | `CardTitle` → `<h1>` (`Card.tsx:30–31`) | Competes with page titles; breaks one-`<h1>` rule once `PageHeader` lands |

### 1.2 Evidence by screen (line-verified)

**1 — Room Plan** (`TapeChartScreen.tsx:414–459`)

```414:459:apps/web-pms/src/screens/TapeChartScreen.tsx
  return (
    <div>
      <div className="visually-hidden" aria-live="polite" />
      <Card>
        <header className="board-header">
          <h1 className="board-title">Room Plan</h1>
          <Link to={...}>Tape</Link>
          <Link to={...}>Available</Link>
          <BoardSummary date={today} />
          <Field label="From" ... />
          <Field label="To" ... />
        </header>
        {body}
      </Card>
    </div>
  );
```

- No `CardHeader` → no card padding on the title row.
- Tape / Available links: no `className`.
- `BoardSummary` + two default `Field`s in `.board-header` (`display:flex; gap:1rem; align-items:center` — `styles.css:463–467`).
- `.board-summary { flex-wrap: wrap }` (`styles.css:550–555`) stacks KPIs vertically after date fields consume width.

**2 — Tape scroll** (`TapeChartScreen.tsx:307`, `styles.css:309–313`, `354–359`)

- `.tape-scroller` wraps the grid; no max height.
- `.tape-header-cell` has padding/borders but **not** `position: sticky`.
- `.tape-room` is `position: sticky; left: 0` only (`styles.css:321–331`) — corner header cell does not stick on vertical scroll.

**3 — Front Desk** (`BoardScreen.tsx:305–326`, `nav.ts:15`)

- Has `Card` + `CardHeader` (spacing OK).
- `<CardTitle>{mode.replace('-', ' ')}</CardTitle>` paints **`arrivals`** for `/arrivals`.
- Row actions: bare links + `{ ' ' }` (`BoardScreen.tsx:142–147`) — audit finding **4**.
- Sidebar label for `/arrivals` is already **Front Desk** (`nav.ts:15`).

**4 — Housekeeping** (`HousekeepingApp.tsx:265–278`, `HousekeepingScreen.tsx:41–50`)

- `<h1>Housekeeping</h1>` then a column of `Field`s — no `Card`, no `PageHeader`, no `Toolbar`.
- Host is a thin wrapper; module UI has no CSS pipeline; host already imports `@hospai/ui-kit/styles.css`.

**5 — Book** (`BookingScreen.tsx:501–505`, `605–628`)

- `Card` exists; back link `← Arrivals` is unclassed (`503`).
- Room-type radios: `<ul><li><label><Input type="radio"/>` — radios in a separate visual column; `.ui-choice-row` / `.ui-choice` exist in ui-kit (`styles.css:269–277`) but unused.

### 1.3 Normative visual reference

`docs/design-prototype/` (on disk; gitignored): **`arrivals.html`** (`:104–135`) shows the target stack — `ui-page-header` (Front Desk + subtitle) → `ui-metrics` → `ui-card` with `ui-card__title` (**Arrivals**, `<h2>`) and flush table body.

`docs/design-prototype/AUDIT.md` findings in scope:

| # | Finding | This vertical |
|---|---|---|
| **4** | Row actions run together | `BoardScreen` `RowActions` (Front Desk task — Lock 2) |
| **8** | Lowercase wire page title | Lock 2 Title Case + `PageHeader` |
| **10** | Tabs are plain text links | Lock 3 Room Plan: `Tabs` + `ui-tab` |

Prototype audit **deliberately left `--tape-*` grid math out of scope** (`AUDIT.md` “Deliberately not changed”). **This vertical in-scopes tape header chrome + bounded scroll only** — not column template / stay-block geometry.

### 1.4 Heads (frozen — this vertical moves **none**)

| Head | Current | This vertical |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**, tail `get_city_ledger_statement` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

---

## 2. Locked decisions (verbatim — do not deviate)

### Lock 1 — One page anatomy on every operational screen

```
<main class="main">          /* already padded --space-5; flex column gap --space-4 */
  <PageHeader title subtitle? back? actions? />
  <Tabs>?                    /* view switchers: Tape/Available, rates tabs, etc. */
  <Metrics>?                 /* board KPIs */
  <Card>
    <Toolbar>?               /* filters / date range, flush to card top */
    <CardHeader>?            /* section title only — not the page <h1> */
    <CardContent> … </CardContent>
  </Card>
</main>
```

- `PageHeader` is a **sibling above** the Card, not stuffed into `CardHeader`. Matches prototype (`arrivals.html`) and fixes flush-title padding.
- **Title Case** display strings. Never `mode.replace` / route keys as visible titles.
- `SignInScreen` is **not** exempt: it already has `Card`; give it `PageHeader title="Sign in"` (`CardTitle` becomes section heading or is removed so there is one page title). Sign-in renders **outside** `AppShell` / `.main` (`App.tsx:83`) — anatomy still applies inside the screen root.
- `HousekeepingApp` must use the same anatomy (import `PageHeader`, `Card`, `Toolbar`, `Field` from `@hospai/ui-kit`). Module UI has no CSS pipeline; host already imports `@hospai/ui-kit/styles.css`. **Do not** add `PageHeader` / `Card` in `HousekeepingScreen.tsx` — that host stays a thin `<HousekeepingBoard />` delegate; double-wrapping is forbidden.

### Lock 2 — Front Desk titles

- `PageHeader` title is **Front Desk** for modes `arrivals` | `departures` | `in-house` (matches sidebar `nav.ts:15`).
- Closed map for the card/section title (and tests):

| `mode` | `CardTitle` text |
|---|---|
| `arrivals` | **Arrivals** |
| `departures` | **Due out** |
| `in-house` | **In-house** |

- `Metrics` (`BoardSummary` wrapped) remain navigation between the three routes (existing hrefs in `board-summary.tsx:21–28`).

### Lock 3 — Room Plan chrome + tape scroll

- `PageHeader title="Room Plan"`.
- Tape / Available: `Tabs label="Room Plan views"` wrapping router `<Link className="ui-tab" aria-current="page">` on the active view (existing ui-kit Tabs contract — no `<Tab>` component; ui-kit does not depend on the router — `Layout.tsx:21–26`).
- KPIs: `BoardSummary` wraps in `Metrics`. Navigable counts are `<Link className="ui-metric">` (same caller-className contract as tabs). Occupancy stays `<span className="ui-metric">` (or `Metric`). Overstay stays `Badge rung="exception"`. Drop `.board-summary` / `.chip` for these four.
- Date fields: `Toolbar` inside the Card; `Field size="xs"`. Add CSS `.ui-toolbar .ui-field { inline-size: auto; }` so `inline-size: 100%` cannot eat the row.
- `.tape-scroller`: keep `overflow: auto` + `overscroll-behavior: contain`; **add** `max-block-size: min(70vh, calc(100dvh - 18rem))` (token-free calc OK; do not invent new colour tokens). Sticky first row: `.tape-header-cell` and the header `.tape-room` (`TapeChartScreen.tsx:309` — empty corner cell) `position: sticky; top: 0; background: var(--panel); z-index` above body cells. Do **not** change `--tape-cols` / `--tape-col` / grid template math.
- Card content for the tape grid: flush (`CardContent` with no extra padding). `.ui-card__content--flush` exists (`styles.css:311–313`); `CardContent` currently always emits `.ui-card__content` only (`Card.tsx:38–39`). **Allowed ui-kit API extension:** optional `flush?: boolean` on `CardContent` (closed union, not `className` on `CardContent`). Prefer `flush` prop over a wrapper div with manual class.

### Lock 4 — Clickable affordance without new hex

- `.ui-metric` gets `border: 1px solid var(--line)` so KPI chips read as controls. Existing `a.ui-metric:hover` stays (`styles.css:449–451`).
- Tabs already have underline + `aria-current` (`styles.css:407–408`). Do not invent a second tab skin.
- `PageHeader` back slot already styles `.ui-page-header__back` (`styles.css:339–350`). Booking/Check-in `← Arrivals` moves into `PageHeader back={...}`.
- No new colour literals. `pnpm check:web-pms-colors` stays green. No Tailwind.

### Lock 5 — Housekeeping

Wrap the whole board in `PageHeader title="Housekeeping"` + `Card` + `Toolbar` containing the filter `Field`s at `size="xs"` in a wrapping row (not a long left column). Room table stays `DataTable`. OOO block can be a second `Card` or a `Card` section — not loose on `--bg`. **`HousekeepingScreen.tsx` must not duplicate this chrome** — chrome check scans `HousekeepingApp.tsx` only.

### Lock 6 — Book radios

Room-type list uses `.ui-choice-row` / `.ui-choice` (CSS already in ui-kit). Each option is a `<label className="ui-choice">` with the radio + name on one baseline. `PageHeader title="Book"`, back `← Arrivals`. Do not restyle the rest of the wizard.

### Lock 7 — CardTitle is the section heading (`h2`)

`CardTitle` currently renders `<h1 className="ui-card__title">` (`Card.tsx:30–31`). Change to **`<h2>`**. `PageHeader` owns the page `<h1>` (`PageHeader.tsx:30`). Update ui-kit tests if they assume heading level. Guest profile keeps the guest name as `PageHeader` title — existing test `getByRole('heading', { level: 1 })` for Ada Lovelace (`GuestProfileScreen.test.tsx:105`) still passes.

### Lock 8 — Mechanical chrome on remaining operational screens

Every file below must render `PageHeader` + at least one `Card`. This is a **title lift**, not a visual redesign of folio/rates/settings/inventory internals:

| File | `PageHeader` title (Title Case) |
|---|---|
| `TapeChartScreen.tsx` | Room Plan (Lock 3) |
| `BoardScreen.tsx` | Front Desk (Lock 2) |
| `ReservationsDirectoryScreen.tsx` | Reservations |
| `BookingScreen.tsx` | Book (Lock 6) |
| `CheckInScreen.tsx` | Check in {guest name} (keep existing pattern) |
| `FolioScreen.tsx` | Folio |
| `ShiftScreen.tsx` | Close shift / Shift receipt (per route state — keep existing copy) |
| `StaffScreen.tsx` | Staff |
| `RosterScreen.tsx` | Roster |
| `NightAuditScreen.tsx` | Night audit |
| `ExceptionsScreen.tsx` | Exceptions |
| `GuestsDirectoryScreen.tsx` | Guests |
| `GuestProfileScreen.tsx` | Guest display name (`heading` variable — `GuestProfileScreen.tsx:174–179`) |
| `HousekeepingScreen.tsx` | *(excluded from chrome scan — thin host only; chrome in `HousekeepingApp.tsx`, Lock 5)* |
| `InventoryScreen.tsx` | Inventory |
| `RatesScreen.tsx` | Rates |
| `SettingsScreen.tsx` | Settings |
| `CityLedgerScreen.tsx` | City ledger |
| `SignInScreen.tsx` | Sign in |

Replace inner `<h1>…</h1>` / `CardTitle` used as page title with `PageHeader` **above** the Card. Keep existing `data-testid`s. Do not redesign those screens' bodies.

Screens with existing `Card` + `CardHeader` + `CardTitle` as page title (`GuestsDirectoryScreen`, `GuestProfileScreen`, `ReservationsDirectoryScreen`): move title to `PageHeader`; retain `CardTitle` only when a **section** title is needed inside the card.

### Lock 9 — Catch drift in CI + Cursor

New merge-blocking check, same shape as `scripts/ui-kit-adoption-check.mjs`:

| Item | Value |
|---|---|
| Path | `scripts/spa-page-chrome-check.mjs` |
| Root script | `"check:spa-page-chrome": "node scripts/spa-page-chrome-check.mjs"` (add in task 1) |
| CI — task 1 | Add **`node scripts/spa-page-chrome-check.mjs --self-test`** only (next to ui-kit-adoption self-test, `.github/workflows/ci.yml:30–41`). Self-test does not require screens to pass. |
| CI — task 6 | When live scan is green, add **`pnpm check:spa-page-chrome`** (live scan) next to the self-test step. **Do not** add live scan to CI before task 6 — working in-place on `main`, a failing merge-blocking step cannot land mid-vertical. |
| Scan roots | `apps/web-pms/src/screens/*Screen.tsx` **except** `HousekeepingScreen.tsx`; `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` |
| Exclude | **`HousekeepingScreen.tsx`** — thin host only renders `<HousekeepingBoard />`; chrome lives in `HousekeepingApp.tsx`. Do not double-wrap in the host. |
| Per file fail | Missing `<PageHeader` or missing `<Card` (on each scanned file) |
| Global fail | Any scanned file contains `mode.replace('-', ' ')` |
| Tape fail | In `TapeChartScreen.tsx`, every `<Link …>Tape</Link>` and `<Link …>Available</Link>` (Available as the **view tab**, not other words) must include `ui-tab` on **that opening tag** before `>`. Pass: `className="ui-tab"`, `className={'ui-tab'}`, or `clsx('ui-tab', …)` on the same `<Link` opener. Fail: `<Link to="…">Tape</Link>` or `<Link to="…">Available</Link>` with no `ui-tab` in the opener. |
| CSS fail | `apps/web-pms/src/styles.css` `.tape-scroller` block lacks `max-block-size` |
| `--self-test` | Covers regexes on fixture strings (copy ui-kit-adoption self-test style), including Tape/Available pass/fail fixtures below |
| Ratchet | **No baseline ratchet** — this is a **floor**, not a count. Missing chrome is always a fail (once live scan is in CI). |

**Tape/Available `--self-test` fixtures (locked):**

| Fixture | Expect |
|---|---|
| `<Link to="/board">Tape</Link>` | **FAIL** |
| `<Link className="ui-tab" to="/board">Tape</Link>` | **PASS** |
| `<Link to="/board?view=available">Available</Link>` | **FAIL** |
| `<Link className="ui-tab" to="/board?view=available" aria-current="page">Available</Link>` | **PASS** |

**Cursor rule:** `.cursor/rules/spa-page-chrome.mdc`

```yaml
---
description: Operational SPA screens use PageHeader + Card anatomy; Title Case; ui-tab/ui-metric caller classNames; tape scroller max-block-size.
globs: apps/web-pms/src/screens/**/*.tsx, modules/pms/housekeeping/src/ui/**/*.tsx
alwaysApply: false
---
```

Content: Lock 1 anatomy, Title Case, Tabs/Metrics caller classNames, tape scroller `max-block-size`, sticky header row, “do not invent a third card padding scheme”. Follow `.cursor/skills-cursor/create-rule/SKILL.md` frontmatter shape.

Do **not** add Playwright visual CI in this vertical (flake, cost). Screen unit tests below are enough.

### Lock 10 — ARCHITECTURE §16.4 one-paragraph amendment

Append to `ARCHITECTURE.md` §16.4 Enforcement (after line ~2139):

> **Page shell (2026-08-16).** Every operational SPA screen renders `PageHeader` (page `<h1>`) and at least one `Card` from `@hospai/ui-kit`; section titles use `CardTitle` (`<h2>`). Merge-blocking gate: `pnpm check:spa-page-chrome`. Does not reopen palette, Tailwind, or ui-kit package decisions.

Do not rewrite the rest of §16.4.

---

## 3. Scope in

1. ui-kit: `CardTitle` → `<h2>`; `CardContent flush?: boolean`; `.ui-toolbar .ui-field` shrink; `.ui-metric` border; (no other closed-API leaks).
2. web-pms CSS: `.tape-scroller` max-block-size; sticky `.tape-header-cell` + header `.tape-room`.
3. Room Plan: `PageHeader`, `Tabs`, `Metrics`, `Toolbar`, flush tape `CardContent` (`TapeChartScreen`, `board-summary`).
4. Front Desk: `PageHeader`, section titles, `RowActions` (`BoardScreen`).
5. Housekeeping: `PageHeader` + `Card` + `Toolbar` (`HousekeepingApp`).
6. Book: `PageHeader` + choice rows (`BookingScreen`).
7. Mechanical `PageHeader` lift on all Lock 8 screens.
8. `scripts/spa-page-chrome-check.mjs` + root script + CI (`--self-test` task 1; live scan task 6) + Cursor rule.
9. `ARCHITECTURE.md` §16.4 sentence.
10. TDD tests (§8).

---

## 4. Scope out (normative — name so nobody “fixes” them here)

- No catalog / HTTP route / schema / night-audit step / idempotency constant changes
- No Tailwind, no new hex, no Storybook
- No restyle of `--tape-*` grid column math, stay-block geometry, or tape occupancy CSS beyond scroller max-height + sticky header row
- No production/staging deploy, no git push
- No Playwright screenshot CI
- No pixel-faithful rebuild of folio / rates matrix / settings / night audit / exceptions workbench internals (chrome wrap only)
- No making local wrangler `:8787` API-only (separate DX leftover)
- Do not add `className`/`style` to closed ui-kit components except the existing `Card` leak (do not expand it). **Allowed:** `CardContent flush?: boolean`. Caller `className="ui-tab"` / `ui-metric` / `ui-choice` on **host** `<Link>` / `<label>` / `<span>` is the existing Tabs contract.
- Folio ledger tables, rates matrix cell labels, night-audit step wire names, settings save-button width — out (other verticals / already-specified)
- Removing `.board-header` / `.board-summary` **CSS** entirely — optional cleanup only if unused after migration; not required for acceptance

---

## 5. Invariants (normative)

1. **One `<h1>` per operational screen** — owned by `PageHeader`. Section titles are `<h2>` via `CardTitle`.
2. **Title Case** for operator-visible page and section titles. No route-key / wire-value titles on chrome.
3. **Frozen heads** (§1.4) unchanged.
4. **No new hex** — `pnpm check:web-pms-colors` green.
5. **No Tailwind** — hand-written CSS + ui-kit tokens only.
6. **Closed ui-kit API** — no new `className`/`style` props except `CardContent flush?: boolean`.
7. **Existing `data-testid`s stay** (`tape-from`, `tape-to`, `board-date`, `board-summary`, `hk-business-date`, `booking-screen`, `room-type-list`, etc.).
8. **Tape grid math frozen** — only scroller bound + sticky header row change.
9. **`pnpm check:spa-page-chrome`** is merge-blocking **from task 6 onward** (live scan in CI). Until then, only `--self-test` runs in CI. Missing `PageHeader` or `Card` on any **scanned** file fails the live scan. `HousekeepingScreen.tsx` is **not** scanned; `HousekeepingApp.tsx` is.
10. **Sidebar nav labels unchanged** — “Front Desk” on `/arrivals` already correct; page title aligns with nav, section title aligns with mode.

---

## 6. File / target list

| Area | Files |
|---|---|
| ui-kit API | `packages/ui-kit/src/Card.tsx`, `packages/ui-kit/src/styles.css`, `packages/ui-kit/src/components.test.tsx`, `packages/ui-kit/src/layout.test.tsx` |
| Room Plan | `apps/web-pms/src/screens/TapeChartScreen.tsx`, `board-summary.tsx`, `TapeChartScreen.test.tsx`, `board-summary.test.tsx` |
| Front Desk | `apps/web-pms/src/screens/BoardScreen.tsx`, `BoardScreen.test.tsx` |
| Housekeeping | `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`, `HousekeepingApp.test.tsx` |
| Book | `apps/web-pms/src/screens/BookingScreen.tsx`, `BookingScreen.test.tsx` |
| Mechanical lift | Remaining `*Screen.tsx` in Lock 8 table |
| Tape CSS | `apps/web-pms/src/styles.css` (`.tape-scroller`, sticky header rules) |
| Enforcement | `scripts/spa-page-chrome-check.mjs`, `package.json`, `.github/workflows/ci.yml`, `.cursor/rules/spa-page-chrome.mdc` |
| Architecture | `ARCHITECTURE.md` §16.4 append |

**Not touched:** `packages/contracts/**`, `apps/pms-core/**`, `migrations/**`, catalog, routes, schema, `demo-seed.ts`.

---

## 7. Enforcement

### 7.1 `scripts/spa-page-chrome-check.mjs`

Implement as a **floor check** (not a ratchet):

```javascript
// Pseudocode — implementer fills in walk + regexes
const SCAN = [
  'apps/web-pms/src/screens/*Screen.tsx', // EXCLUDE HousekeepingScreen.tsx
  'modules/pms/housekeeping/src/ui/HousekeepingApp.tsx',
];
for (const file of SCAN) {
  if (!/<PageHeader[\s>]/.test(src)) fail(file, 'missing PageHeader');
  if (!/<Card[\s>]/.test(src)) fail(file, 'missing Card');
  if (/mode\.replace\('-',\s*' '\)/.test(src)) fail(file, 'mode.replace title');
}
// TapeChartScreen only: every <Link…>Tape</Link> and view-tab <Link…>Available</Link>
// must have ui-tab in the opening tag (className="ui-tab", className={'ui-tab'}, or clsx('ui-tab'))
// styles.css: .tape-scroller block must match /max-block-size/
```

`--self-test`: fixture strings proving each regex (pass + fail cases), mirroring `ui-kit-adoption-check.mjs:100–139`. Include Lock 9 Tape/Available fixture table.

### 7.2 CI placement

**Task 1** — after existing ui-kit adoption steps in `.github/workflows/ci.yml`:

```yaml
- run: node scripts/spa-page-chrome-check.mjs --self-test
```

**Task 6** — when live scan is green, add merge-blocking live scan beside self-test:

```yaml
- run: pnpm check:spa-page-chrome
- run: node scripts/spa-page-chrome-check.mjs --self-test
```

### 7.3 Cursor rule

`.cursor/rules/spa-page-chrome.mdc` — globs per Lock 9; `alwaysApply: false`.

---

## 8. Tests (TDD — write / update before or with implementation)

### 8.1 ui-kit

| Test file | Assertion |
|---|---|
| `packages/ui-kit/src/components.test.tsx` | `CardTitle` renders heading **level 2** (`getByRole('heading', { level: 2 })`) |
| `packages/ui-kit/src/components.test.tsx` or new | `CardContent flush` applies `.ui-card__content--flush` |

### 8.2 Room Plan

| Test file | Assertion |
|---|---|
| `TapeChartScreen.test.tsx` | `getByRole('heading', { name: /room plan/i })` |
| `TapeChartScreen.test.tsx` | Tape and Available links have class `ui-tab`; active view has `aria-current="page"` |
| `TapeChartScreen.test.tsx` | `data-testid="board-summary"` still present; `tape-from` / `tape-to` still work |
| `TapeChartScreen.test.tsx` | When rooms render, `document.querySelector('.tape-scroller')` exists |
| `board-summary.test.tsx` | Links still hit `/arrivals?date=`, `/departures?date=`, `/in-house`; class `ui-metric` not `chip` |

### 8.3 Front Desk

| Test file | Assertion |
|---|---|
| `BoardScreen.test.tsx` | Heading **Front Desk**; visible **Arrivals** not `arrivals`; no `mode.replace` title in DOM |
| `BoardScreen.test.tsx` | Row actions: "Check in Folio Book for guest" is **not** one text node — query `.ui-row-actions` or separate links |

### 8.4 Housekeeping

| Test file | Assertion |
|---|---|
| `HousekeepingApp.test.tsx` | Heading **Housekeeping**; `.ui-card` in tree |

### 8.5 Book

| Test file | Assertion |
|---|---|
| `BookingScreen.test.tsx` | Heading **Book**; room-type radios still selectable; labels use `ui-choice` |

### 8.6 Guest profile (regression)

| Test file | Assertion |
|---|---|
| `GuestProfileScreen.test.tsx` | `getByRole('heading', { level: 1 })` text **Ada Lovelace** (now on `PageHeader`) |

### 8.7 Chrome check script

| Command | Assertion |
|---|---|
| `node scripts/spa-page-chrome-check.mjs --self-test` | Exit 0 |
| Fixture screen without `PageHeader` | Script exits non-zero |
| `--self-test` Tape/Available fixtures | Lock 9 pass/fail table (four cases) |

### 8.8 Frozen-head pins (must stay green)

- `COMMAND_CATALOG` length **89**; `AUDIT_WRITER_COMMAND_IDS.size === 63`; `V1_HTTP_ROUTE_AUDIT` length **144**; `PROPERTY_SCHEMA_HEAD === 34`; `NIGHT_AUDIT_STEPS.length === 8`, `[3] === 'AUTO_TRANSFER'`.

---

## 9. Suggested implementation task split (for plan author)

1. **Foundation:** `CardTitle` h2, `CardContent flush`, toolbar field shrink + metric border + tape-scroller max-block-size + sticky header CSS; create `scripts/spa-page-chrome-check.mjs` (live scan + `--self-test`); add root `"check:spa-page-chrome"` script; add **`--self-test` only** to CI; cursor rule; ARCHITECTURE sentence. Live scan may fail until task 6 — that is expected.
2. **Room Plan:** `TapeChartScreen` + `BoardSummary` + tests.
3. **Front Desk:** `BoardScreen` titles + `RowActions` + tests.
4. **Housekeeping:** `HousekeepingApp` Card/PageHeader/Toolbar + tests (`HousekeepingScreen.tsx` unchanged — no double-wrap).
5. **Book:** PageHeader + choice-row + tests.
6. **Mechanical lift:** remaining Lock 8 screens until `pnpm check:spa-page-chrome` (live scan) is green; then add **`pnpm check:spa-page-chrome`** to CI next to `--self-test`.

---

## 10. Leftovers (explicitly deferred)

| # | Item | Notes |
|---|---|---|
| 1 | Folio ledger / money table redesign | Audit finding **5** — separate vertical |
| 2 | Rates matrix cell label hiding | Audit finding **3** — separate vertical |
| 3 | Settings full-width save buttons | Audit finding **1** — field/button layout vertical |
| 4 | `--tape-*` grid column math / stay-block styling | Prototype audit out of scope |
| 5 | Playwright visual regression CI | Lock 9 forbids |
| 6 | Sign-in outside `.main` padding | Accept; PageHeader still applies inside screen |
| 7 | City ledger account drill-in inner layout | Chrome wrap only here |
| 8 | Removing dead `.board-summary` / `.chip` CSS after migration | Optional cleanup |
| 9 | Rates / Settings / Inventory tab strips (`RatesScreen`, `SettingsScreen`, `InventoryScreen` raw `<Link>` view switchers) | Same “tabs look like text” pattern as audit finding **10**; Lock 8 is title lift only; chrome check special-cases Tape/Available only. Later pass: `Tabs` + `ui-tab`; optionally extend `spa-page-chrome-check`. |

---

## 11. Self-review checklist (spec writer)

- [x] Tree-verified heads table matches dist/tests (89 / 63 / 144 / 34 / 8).
- [x] Root cause verified: `2c4379e` primitives exist; grep shows zero screen imports.
- [x] Line citations for Room Plan, Front Desk, Housekeeping, Book, tape scroller, Card padding, nav label.
- [x] All 10 locks copied verbatim; no A/B/C alternatives.
- [x] Scope-out names folio internals, tape grid math, Tailwind, hex, Playwright CI, catalog/schema.
- [x] Invariants, file map, enforcement script shape, CI placement (self-test task 1 / live scan task 6), Cursor rule globs, `HousekeepingScreen.tsx` excluded from scan.
- [x] TDD test table covers all required assertions + frozen-head pins.
- [x] Implementation task split for plan author (§9).
- [x] Prototype reference: `arrivals.html` anatomy + AUDIT findings 4/8/10.
- [x] Spec only — no plan, no code, no commit in this turn.

---

## 12. Tree conflicts with prompt

**None.** All prompt claims verified against current `main`:

- Grep `PageHeader|Tabs|Toolbar|Metrics` under `apps/web-pms/src` → empty.
- Frozen head counts match dist / tests.
- `nav.ts:15` label **Front Desk** for `/arrivals`.
- `.ui-card__content--flush` exists; `CardContent` component does not expose it yet (spec allows `flush` prop).
- `TapeChartScreen` title is already **Room Plan** (not pre-chrome “Board”) — spec preserves that string.
