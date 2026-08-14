# Prototype Chrome + Contrast-Safe Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Make `apps/web-pms` look like the prototype for the investor demo — left sidebar, sage/tan warmth, icons, top search rail — with a WCAG AA palette and light screen copy. Not a pixel-faithful rebuild. No Tailwind, no `packages/ui-kit`.

**Architecture:** SPA-only chrome + token restyle. `AppShell` becomes `aside` (16rem sticky) + main column (ops rail → shift strip → live watermark → outlet → collapsible side panels). Colour literals stay on `--color-*`; semantic aliases unchanged so `statusClass` / `.panel` inherit. Compose property name, business-date chip, dollar quote, and room codes from **existing** GETs. No Worker / catalog / schema / seed changes.

**Tech Stack:** React SPA (`apps/web-pms`), `@tanstack/react-query`, `@hospai/client-core` (reuse only), hand-written CSS + `tokens.css`, vitest + Testing Library, `pnpm check:web-pms-colors`.

**Spec:** `docs/superpowers/specs/2026-08-13-prototype-chrome-skin-design.md` (Approved). Spec commit: `4544c60`.

## Global Constraints

- **No new HTTP routes.** `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` stays last. Do not edit `v1-http-routes.ts` or `V1_ROUTES`. Do not widen `GET /properties/:id` with `__meta.business_date`.
- `COMMAND_CATALOG.length` stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
- **No schema migration.** `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` is a no-op diff. **No demo-seed edits.**
- No new `export class`. **`CLASS_DENYLIST` is not edited.** Icon components are functions. `NIGHT_AUDIT_STEPS.length` stays **7**.
- Money is integers on the wire. Book quote is `formatMinor` of summed `amountMinor` from existing `listRateDays`. Do not change `quoteAriVersion` on `reservations.create`. Confirm is **not** gated on rates.
- Folio is append-only. **Do not reopen P0-2 IA** (Advanced, tenders, auto-open). Folio **skin + status copy only**.
- Colour literals **only** on `--color-*`. Every `--status-*-fg` ≥ 4.5:1 vs its surface **and** `--color-surface-base`. Do not weaken `scripts/web-pms-colors-check.mjs`.
- Five rungs unchanged. Do not add `--status-*` pairs. `.status-neutral` stays empty. Do not rewrite `apps/web-pms/src/status/` mappers.
- **Existing `data-testid`s stay** (spec §9). New ids allowed: `shell-role`, `property-name`, `business-date-chip`, `stay-quote`, `check-in-room`.
- **No Tailwind, no `packages/ui-kit`, no `lucide-react`, no `motion`.** No dark theme, no `box-shadow` on chrome, no `animate-pulse`.
- Do **not** copy Whistle, “Simulation Active”, role `<select>`, training-disclaimer footer, property switcher.
- `/in-house` and `/departures` **routes stay** (`App.tsx`, `BoardSummary` links). They leave **sidebar nav only**.
- Business-date chip = `propertyLocalToday(timeZone)`. **Never** `getNightAudit` from AppShell.
- Accent `#C18C5D` is **fill only** — never `--status-*-fg` or body/chrome text.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`. This chunk is SPA; pms-core shards are a CI pin only.
- Living plan checkboxes: tick `- [x]` on merge only (Task 6). Do not backfill historical plans.
- No either/or forks. Spec §15 locks stand.
- Scope-out (do not implement): P0-4 Clerk / `/sign-in`, P0-5 script + dry runs, P1 CRM / last-4 / lab-copy sweep, P2 ARCHITECTURE §16.4 / `ui-kit`, pixel-faithful prototype screens, Tailwind, new Worker routes/commands, schema, seed, Dashboard Hub, Whistle, property switcher, dark theme, plan picker / `quoteStay` HTTP.

## File map

| File | Role |
|---|---|
| `apps/web-pms/src/styles/tokens.css` | Spec §7 primitives + status hex + `--radius` (Task 1) |
| `apps/web-pms/src/styles.css` | Sidebar / rail / selected / chips / collapse / print (Task 1) |
| `apps/web-pms/index.html` | Title **HospAI PMS**; IBM Plex Sans 400/600/700 (Task 1) |
| `apps/web-pms/src/shell/icons.tsx` | **New.** Spec §6 SVG subset (Task 2) |
| `apps/web-pms/src/shell/nav.ts` | Labels, orders, `tone`, drop in-house/departures (Task 2) |
| `modules/pms/housekeeping/src/ui.manifest.ts` | `order: 50` (Task 2) |
| `apps/web-pms/src/shell/AppShell.tsx` | Frame §3–§5 (Task 2) |
| `apps/web-pms/src/shell/QueuedCommandsPanel.tsx` | Collapse when empty (Task 2) |
| `apps/web-pms/src/screens/ExceptionsPanel.tsx` | Collapse when empty (Task 2) |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | Hide `shiftId` on badge (Task 2) |
| `apps/web-pms/src/status/reservation-status-label.ts` | **New.** Spec §8.7 map (Task 3) |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | Title Room Plan (Task 3) |
| `apps/web-pms/src/screens/board-summary.tsx` | Chip classes (Task 3) |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Name leads; room code; status copy (Task 3) |
| `apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx` | Code or omit; status copy (Task 3) |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | Stay room code (Task 3) |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Dollar quote; hide ariVersion / guestRef (Task 3) |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Room `<select>` + `roomLabel` (Task 3) |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Status copy; inherit skin (Task 3) |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | Job chrome labels (Task 3) |
| Tests listed per task | Spec §14 |
| Folio-first-paint + demo-tenant-seed specs | Pointer sentences (Task 4) |
| `DEMO-READY.md` | Tick P0-3 (Task 4) |

## Test file split (spec §14 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 heads / catalog / schema / ddl | Task 5 CI | 5 |
| 3 `check:web-pms-colors` | Task 1 + Task 5 | 1, 5 |
| 4–7 `ALL_NAV` / `filterNavEntries` | `module-ui-registry.test.ts`, `me.test.ts` | 2 |
| 8–13, 22 AppShell chrome / search / collapse / forbidden | `AppShell.boot.test.tsx`, `AppShell.me.test.tsx`, `AppShell.search.test.tsx` | 2 |
| 14 ShiftStrip badge | `ShiftStrip.test.tsx` | 2 |
| 15 Tape title | `TapeChartScreen.test.tsx` | 3 |
| 16 Book quote | `BookingScreen.test.tsx` | 3 |
| 17 Check-in picker | `CheckInScreen.test.tsx` | 3 |
| 18 Board name / code / In house | `BoardScreen.test.tsx` | 3 |
| 19 Guest profile room code | `GuestProfileScreen.test.tsx` | 3 |
| 20 Night audit | `NightAuditScreen.test.tsx` | 3 |
| 21 Folio first-paint still green + In house copy | `FolioScreen.test.tsx` | 3 |
| Pointer + DEMO-READY | spec files + DEMO-READY.md | 4 |
| Full CI | Task 5 | 5 |

---

### Task 1: Tokens, chrome CSS, IBM Plex (own commit, no TSX behaviour)

**Spec:** §7, §3.3, §14.3. Keep `check:permissions` green (do not touch routes).

**Files:**
- Modify: `apps/web-pms/src/styles/tokens.css`
- Modify: `apps/web-pms/src/styles.css`
- Modify: `apps/web-pms/index.html`
- Test: `pnpm check:web-pms-colors`

**Forbidden this commit:** `AppShell.tsx`, `nav.ts`, screens, Worker, catalog, `CLASS_DENYLIST`, Tailwind, `packages/ui-kit`.

- [ ] **Step 1: Replace chrome primitives and status hex in `tokens.css`**

Keep the two-layer structure (primitives on `--color-*`, aliases as `var(...)`). Replace the primitive block with **exactly**:

```css
:root {
  color-scheme: light;

  /* --- primitives (literals allowed only on --color-*) --- */
  --color-ink: #2D2926;
  --color-muted: #575245;
  --color-line: #E8E4D8;
  --color-bg: #F9F8F4;
  --color-surface-base: #ffffff;
  --color-selected: #F1EFE9;
  --color-primary: #4A5D4E;
  --color-accent: #C18C5D;

  --color-status-settled-fg: #0d5c2e;
  --color-status-settled-surface: #E8F2EA;
  --color-status-informational-fg: #3A4F40;
  --color-status-informational-surface: #EEF1EC;
  --color-status-attention-fg: #8a5a00;
  --color-status-attention-surface: #FBF4E8;
  --color-status-exception-fg: #9b1c1c;
  --color-status-exception-surface: #FBF3F0;

  --color-action-primary-fg: #ffffff;
  --color-action-primary-surface: #4A5D4E;
  --color-action-destructive-fg: #ffffff;
  --color-action-destructive-surface: #9b1c1c;

  --color-badge-fg-on-exception: #ffffff;

  /* --- chrome aliases (no literals) --- */
  --ink: var(--color-ink);
  --muted: var(--color-muted);
  --line: var(--color-line);
  --bg: var(--color-bg);
  --panel: var(--color-surface-base);
  --selected: var(--color-selected);
  --primary: var(--color-primary);
  --danger: var(--color-status-exception-fg);
  --warn: var(--color-status-attention-fg);

  --radius: 8px;

  /* --- status semantics: keep existing color-mix border aliases --- */
```

Do **not** put `#C18C5D` on any `--status-*-fg`. Keep existing `--status-*-border` `color-mix` blocks and `--action-*` aliases. Keep `font-family: "IBM Plex Sans", "Segoe UI", sans-serif`.

Informational must **not** remain `#1a4a6e`. Primary action surface must **not** remain `#1a4a6e`.

- [ ] **Step 2: Add chrome layout CSS in `styles.css` (classes only; TSX lands in Task 2)**

Replace `.app-shell` grid with flex frame. Add (names locked):

```css
.app-shell {
  min-height: 100vh;
  display: flex;
}

.app-sidebar {
  width: 16rem;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow: hidden;
}

.app-sidebar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  border-bottom: 1px solid var(--line);
}

.app-sidebar-mark {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--action-primary-surface);
  color: var(--action-primary-fg);
  border-radius: var(--radius);
  font-weight: 700;
}

.app-sidebar-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-sidebar-title span {
  font-weight: 400;
  color: var(--muted);
}

.app-sidebar nav {
  padding: 1rem;
  overflow-y: auto;
}

.app-nav-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.app-nav-quiet {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line);
}

.app-nav-list a {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
}

.app-nav-list a[aria-current='page'] {
  background: var(--selected);
  color: var(--primary);
  font-weight: 600;
  border-bottom: 0;
}

.app-nav-list a:hover:not([aria-current='page']) {
  background: color-mix(in srgb, var(--selected) 60%, transparent);
  color: var(--ink);
}

.app-nav-quiet a {
  color: var(--muted);
  font-weight: 400;
}

.app-sidebar-footer {
  padding: 1rem;
  border-top: 1px solid var(--line);
  background: var(--selected);
  font-size: 0.75rem;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ops-rail {
  height: 4rem;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 1.5rem;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}

.ops-rail-search {
  position: relative;
  width: min(24rem, 100%);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: var(--radius);
  background: var(--selected);
  border: 1px solid var(--line);
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 600;
}
```

Delete / stop using the horizontal `.nav a[aria-current='page'] { border-bottom: 2px solid var(--ink); }` as the selected affordance (the sidebar rule above replaces it). Keep `.top-bar` rules harmless for the no-access mini-header.

`.reservation-search input`: `border-radius: var(--radius)`; background `var(--bg)`; padding-left for the icon.

`.side-panels`: keep; empty collapsed details should not look like a two-column lab footer. `details.side-panel` summary uses `.chip` / muted 0.75rem.

Print `@media print`: hide `aside`, `.ops-rail`, `.shift-strip`, `.side-panels`, `.app-sidebar` (extend today’s hide list). Keep `.reg-card` print behaviour. **No** `box-shadow`. **No** `animate-pulse`.

`.board-summary a` / occupancy span: apply `.chip` (Task 3 will add the class; CSS can target `.board-summary a` now).

- [ ] **Step 3: `index.html`**

`<title>HospAI PMS</title>`. Load IBM Plex Sans 400/600/700 (Google Fonts `<link>` **or** self-hosted `@font-face` under `apps/web-pms/public`). No new display font.

- [ ] **Step 4: Run colour gate**

```bash
pnpm check:web-pms-colors
```

Expected: OK. Informational fg is not `#1a4a6e`. If red, **darken the fg** (not the script).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/styles/tokens.css apps/web-pms/src/styles.css apps/web-pms/index.html
git commit -m "$(cat <<'EOF'
feat(web-pms): sage/tan AA tokens and chrome CSS

EOF
)"
```

---

### Task 2: Icons, nav order, AppShell frame, collapse, shift badge

**Spec:** §3–§6, §5.1, §9, §14.4–14.14, §14.22.

**Files:**
- Create: `apps/web-pms/src/shell/icons.tsx`
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `modules/pms/housekeeping/src/ui.manifest.ts` — `order: 50` only
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Modify: `apps/web-pms/src/shell/QueuedCommandsPanel.tsx`
- Modify: `apps/web-pms/src/screens/ExceptionsPanel.tsx`
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Modify tests: `module-ui-registry.test.ts`, `me.test.ts`, `AppShell.boot.test.tsx`, `AppShell.me.test.tsx`, `AppShell.search.test.tsx`, `ShiftStrip.test.tsx`, `ExceptionsPanel.test.tsx` (if it assumes always-open body)
- Test: `pnpm --filter @hospai/web-pms exec vitest run src/shell src/auth/me.test.ts src/screens/ExceptionsPanel.test.tsx`

**Forbidden this commit:** `v1-http-routes.ts`, catalog, migrations, `demo-seed.ts`, Folio Advanced IA, BookingScreen quote, CheckInScreen picker, Tailwind, `lucide-react`, `WhistleIcon`.

- [ ] **Step 1: Write failing nav / shell assertions**

`module-ui-registry.test.ts` — replace the housekeeping-between-in-house test:

```ts
expect(ALL_NAV.map((e) => e.id)).toEqual([
  'board',
  'arrivals',
  'reservations',
  'book',
  'housekeeping',
  'guests',
  'rates',
  'night-audit',
  'settings',
  'inventory',
  'staff',
  'roster',
  'exceptions',
]);
expect(ALL_NAV.map((e) => e.id)).not.toContain('in-house');
expect(ALL_NAV.map((e) => e.id)).not.toContain('departures');
```

Assert labels: Room Plan, Front Desk, New Booking, Night Audit. Quiet ids `inventory`/`staff`/`roster`/`exceptions` have `tone: 'quiet'` (housekeeping has no tone or `'primary'`).

`me.test.ts`:
- Drop `in-house` / `departures` from the `reservations:read` expected set.
- Guests is **after** book in filtered ids (no longer “between reservations and book”). Remove `order === 36` pin; pin `guests` `order === 60`.
- Exceptions `order === 130`. Remove “exc < settings” (exceptions is quiet, after Settings). Keep “exceptions present when `property:read`”.

`AppShell.boot.test.tsx`:
- `getByRole('navigation', { name: /hospai pms/i })` (not `/front desk/i`).
- `getByText(/HospAI PMS/i)`.
- `document.querySelector('aside')` truthy.
- Queued **summary** still in document (`/Queued commands/i`). `exceptions-panel` still in document.
- Fail-open arrivals link: `getByRole('link', { name: /front desk/i })` (label changed from Arrivals).

`AppShell.me.test.tsx`:
- Live owner: after settle, `getByTestId('shell-role')` text **Owner**. `queryByRole('combobox')` null (no role-swap).
- `queryByText(/Simulation Active/i)` null. `queryByText(/Whistle/i)` null.
- Mock `getProperty` already returns `name: 'Demo'` → `getByTestId('property-name')` text `Demo`.
- Extra case: reject `getProperty` with fail_closed → `queryByTestId('property-name')` null; `queryByTestId('business-date-chip')` null (timezone missing); shell still shows HospAI PMS.
- Timezone mock UTC: `business-date-chip` matches `propertyLocalToday('UTC')` (reuse helper in the test). Chip text includes `Business date`.

`AppShell.search.test.tsx`:
- Placeholder `/guest name/i`.
- After typing Ada: visible **Ada**; do **not** require `/res_hit/` as the clickable label. Click the result button via `/Ada/` (or `getByTestId('reservation-search-results')` + guest-profile-link). Still navigate to `/folio/res_hit`.
- `reservation-search` testid stays. Hidden-without-permission + fail_closed copy stay.

`ShiftStrip.test.tsx` open-badge case (`shiftId: 'shift_1'`):
```ts
expect(screen.getByTestId('open-shift-badge').textContent).toMatch(/100\.00/);
expect(screen.getByTestId('open-shift-badge').textContent).toMatch(/cash posts 3/);
expect(screen.getByTestId('open-shift-badge').textContent).not.toMatch(/shift_1/);
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/module-ui-registry.test.ts src/auth/me.test.ts src/shell/AppShell.boot.test.tsx src/shell/AppShell.me.test.tsx src/shell/AppShell.search.test.tsx src/shell/ShiftStrip.test.tsx
```

Expected: FAIL — old nav ids/labels, no `<aside>`, `/front desk/` aria, badge still contains `shift_1`.

- [ ] **Step 3: Minimal implementation**

**`icons.tsx`:** copy **verbatim** the function bodies of these exports from `/Users/iamabdus/ai-coding-2/hospai-pms-prototype/src/components/Icons.tsx`: `RoomPlanIcon`, `CheckIcon`, `CalendarIcon`, `PlusIcon`, `BedIcon`, `UserIcon`, `CreditCardIcon`, `NightAuditIcon`, `SettingsIcon`, `PropertyIcon`, `WarningIcon`, `SearchIcon`. Default `size = 14`. `currentColor`. Functions, not `export class`. **Do not** copy `WhistleIcon` / `DashboardIcon` / `FolioIcon` / etc.

**`nav.ts`:**

```ts
export type NavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
  tone?: 'primary' | 'quiet';
};

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'board', label: 'Room Plan', path: '/board', order: 10, permission: 'reservations:read' },
  { id: 'arrivals', label: 'Front Desk', path: '/arrivals', order: 20, permission: 'reservations:read' },
  { id: 'reservations', label: 'Reservations', path: '/reservations', order: 30, permission: 'reservations:read' },
  { id: 'book', label: 'New Booking', path: '/book', order: 40, permission: 'reservations:write' },
  { id: 'guests', label: 'Guests', path: '/guests', order: 60, permission: 'guests:read' },
  { id: 'rates', label: 'Rates', path: '/rates', order: 70, permission: 'rates:write' },
  { id: 'night-audit', label: 'Night Audit', path: '/night-audit', order: 80, permission: 'night_audit:run' },
  { id: 'settings', label: 'Settings', path: '/settings', order: 90, permission: 'settings:configure' },
  { id: 'inventory', label: 'Inventory', path: '/inventory', order: 100, permission: 'inventory:write', tone: 'quiet' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 110, permission: 'staff:read', tone: 'quiet' },
  { id: 'roster', label: 'Roster', path: '/roster', order: 120, permission: 'roster:write', tone: 'quiet' },
  { id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 130, permission: 'property:read', tone: 'quiet' },
];
```

Do **not** add `in-house` / `departures`. Do **not** add folio. Do **not** add `tone` to `ModuleUiNavEntry` / `packages/contracts` (housekeeping defaults primary). `filterNavEntries` ignores `tone`.

**Housekeeping manifest:** `order: 50` only.

**AppShell layout** (spec §3 ascii). Icon map keyed by `entry.id` (module must not import SVGs):

```ts
const NAV_ICONS: Record<string, typeof RoomPlanIcon> = {
  board: RoomPlanIcon,
  arrivals: CheckIcon,
  reservations: CalendarIcon,
  book: PlusIcon,
  housekeeping: BedIcon,
  guests: UserIcon,
  rates: CreditCardIcon,
  'night-audit': NightAuditIcon,
  settings: SettingsIcon,
  inventory: PropertyIcon,
  staff: UserIcon,
  roster: CalendarIcon,
  exceptions: WarningIcon,
};
```

`<nav aria-label="HospAI PMS">`. Split `navEntries` into `tone !== 'quiet'` then `tone === 'quiet'` (quiet in `.app-nav-quiet`). `NavLink` + icon `size={14}`. Brand: mark ✦ + **HospAI** + `<span>PMS</span>`. No “Property SaaS v1.0”.

Role footer: live `me.role` → Owner / Admin / Staff on `data-testid="shell-role"`. Pending/unknown: omit the testid (or empty footer). **No** `<select>`.

Ops rail: `ReservationSearch` left; right: `data-testid="property-name"` from `useQuery({ queryKey: ['property', propertyId], queryFn: () => api.getProperty(propertyId), retry: false })` — **same key** as `PropertyTimeZoneProvider` (no second network). Paint `property.name` only; never `propertyId`. Chip `data-testid="business-date-chip"` when `usePropertyTimeZone()` is non-null: `CalendarIcon size={12}` + `Business date: {propertyLocalToday(tz)}`. **Do not** call `api.getNightAudit`.

Search placeholder **Guest name or reservation**. Leading `SearchIcon`. Result primary label = `GuestNameLink` / displayName; button text = dates + status, **not** `reservationId`. Navigate still uses `hit.reservationId`. Testids `reservation-search` / `reservation-search-results` stay.

No-access header may keep a simple **HospAI PMS** wordmark (no sidebar required).

**QueuedCommandsPanel:** wrap in `<details open={entries.length > 0}>`. Summary: **Queued commands**. Session footnote inside the open body. Do not paint “None this session” as a permanent two-column footer.

**ExceptionsPanel:** `data-testid="exceptions-panel"` stays on the region. `<details open={count > 0 || countQ.isError}>`. Fail-closed error copy **visible** (not “empty”). Count 0 + success → not `open`.

**ShiftStrip:** badge text `Open shift · float {formatMinor(openingFloat)} · cash posts {n}` — no `{shift.shiftId}` in the text node. `data-testid="open-shift-badge"` stays. Close `/shift` stays. Force-close URL may still include the id.

Do not add `getNightAudit` to AppShell mocks. If a test fails because the query is missing, you added a forbidden call.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell src/auth/me.test.ts src/screens/ExceptionsPanel.test.tsx
pnpm check:web-pms-colors
pnpm check:module-manifests
```

Expected: PASS. Housekeeping still in `ALL_NAV`. `App.tsx` still has `/in-house` and `/departures` routes (do not delete).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/icons.tsx \
  apps/web-pms/src/shell/nav.ts \
  apps/web-pms/src/shell/AppShell.tsx \
  apps/web-pms/src/shell/QueuedCommandsPanel.tsx \
  apps/web-pms/src/shell/ShiftStrip.tsx \
  apps/web-pms/src/shell/module-ui-registry.test.ts \
  apps/web-pms/src/shell/AppShell.boot.test.tsx \
  apps/web-pms/src/shell/AppShell.me.test.tsx \
  apps/web-pms/src/shell/AppShell.search.test.tsx \
  apps/web-pms/src/shell/ShiftStrip.test.tsx \
  apps/web-pms/src/auth/me.test.ts \
  apps/web-pms/src/screens/ExceptionsPanel.tsx \
  apps/web-pms/src/screens/ExceptionsPanel.test.tsx \
  modules/pms/housekeeping/src/ui.manifest.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): prototype sidebar shell and nav

EOF
)"
```

---

### Task 3: Light screen markup (own commit, no Worker)

**Spec:** §8, §14.15–21. Folio **skin inherits tokens**; do not move Advanced.

**Files:**
- Create: `apps/web-pms/src/status/reservation-status-label.ts` + `reservation-status-label.test.ts`
- Modify: `TapeChartScreen.tsx` / `.test.tsx`
- Modify: `board-summary.tsx` (+ `.test.tsx` if copy/href assertions need chip class only — hrefs stay)
- Modify: `BoardScreen.tsx` / `.test.tsx`
- Modify: `ReservationsDirectoryScreen.tsx` / `.test.tsx`
- Modify: `GuestProfileScreen.tsx` / `.test.tsx`
- Modify: `BookingScreen.tsx` / `.test.tsx`
- Modify: `CheckInScreen.tsx` / `.test.tsx`
- Modify: `FolioScreen.tsx` / `.test.tsx` (status copy matcher only)
- Modify: `NightAuditScreen.tsx` / `.test.tsx`
- Modify: `registration-card.tsx` only if CheckIn passes `roomLabel` (API already has the prop)
- Test: `pnpm --filter @hospai/web-pms exec vitest run src/screens src/status/reservation-status-label.test.ts`

**Forbidden this commit:** AppShell rewrites, Worker, seed, folio Advanced moves, Tailwind, visible `ariVersion`, free-text room id fallback on happy path.

- [ ] **Step 1: Status label helper + failing screen assertions**

```ts
// apps/web-pms/src/status/reservation-status-label.ts
import type { ReservationStatus } from '@hospai/contracts/reservation-status';

const LABELS: Record<ReservationStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'In house',
  checked_out: 'Departed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export function reservationStatusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}
```

Unit test: each wire → locked label. Unknown `'nope'` → `'nope'`.

**Tape:** `getByRole('heading', { name: /room plan/i })`. Replace `<h1 className="board-title">Board</h1>` with **Room Plan**. Existing guest/folio tape tests stay.

**Board:** mock `listRooms` `{ rooms: [{ roomId: 'rm_101', code: '101', ... }] }`. Row with `guestRef` resolved Ada + `roomId: 'rm_101'` + `status: 'checked_in'`: lead label Ada; **101** visible; `queryByText('checked_in')` null; **In house** visible. Folio / Check in / Book for guest links stay.

**Directory:** `roomLabel` returns code or `''` — never truncated `roomId`. Status copy uses the helper.

**Guest profile:** stays cell shows `101` not `rm_101` when rooms map. Add `listRooms` to the test mock.

**Book:** `queryByText(/Type-only stay/i)` null. Visible document `queryByText(/ariVersion/i)` null. `getByTestId('quote-version')` still exists (`.visually-hidden`). Mock `listRateDays` `{ ok: true, days: [{ stayDate: arrival, amountMinor: 15000 }, { stayDate: lastNight, amountMinor: 15000 }] }` → `stay-quote` `$300.00`. Missing night / failed GET → `queryByTestId('stay-quote')` null. `context-guest` `/Maria/` and not `g_ctx`. Confirm body still has `quoteAriVersion`. Mock `listRateDays` default `{ ok: true, days: [] }` in `beforeEach` so existing tests do not hang.

**Check-in:** `queryByPlaceholderText(/room id/i)` null. Mock `listRooms` `{ rooms: [{ roomId: 'rm_1', code: '101', roomTypeId: 'rt', ... }] }`. `check-in-room` option **101**, value `rm_1`. Select it → check-in enabled; mutate still sends `roomId: 'rm_1'`. `check-in` / `print-reg-card` / `reg-card` stay. Pass `roomLabel={code}` into `RegistrationCard`.

**Folio:** change `expect(screen.getByText(/checked_in/i))` to `/in house/i`. All other P0-2 testids stay (`folio-advanced`, `folio-balance`, tenders, …).

**Night audit:** step names still `PRE_CHECK` … `ARCHIVE`. `getByRole('button', { name: /revenue/i })` (not exact `'revenue'`). `report-table` still `/150\.00/` `/12\.00/`. `queryByText(/\{/)` null on the happy path (no JSON blob). Humanize known report keys: `roomNet` → Room net, `taxTotal` → Tax, `businessDate` → Business date. Title-case `reportId` for the button (`revenue` → Revenue). Remove `JSON.stringify` from the visible path (delete helper or stop calling it).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/status/reservation-status-label.test.ts \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/CheckInScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/NightAuditScreen.test.tsx \
  src/screens/GuestProfileScreen.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx
```

Expected: FAIL — missing helper file; heading still Board; placeholder room id; `checked_in` still visible; quote paragraph still present.

- [ ] **Step 3: Minimal implementation**

**Tape title** only + `BoardSummary` children get `className="chip"` (overstay keeps `statusClass('exception')` in addition).

**BoardScreen:** `useQuery` `listRooms`. Guest name first column. Room code column/clause. `reservationStatusLabel` for visible status. `reservationId` may remain on the Folio link, not the lead cell. Same for departures partition tables.

**Directory `roomLabel`:** `roomsById.get(row.roomId) ?? ''`.

**Guest profile:** `listRooms` map; cell = code or empty.

**Book:** delete type-only `<p>`. `quote-version` wrap with `className="visually-hidden"` (keep text or `data-ari-version`). When `roomTypeId` + dates set, `listRateDays(propertyId, { fromDate: arrivalDate, toDate: lastNight, roomTypeId, ratePlanId: 'BAR' })`. Last night = `addCalendarDays(departureDate, -1)`. Inclusive nights `[arrival, lastNight]`. If `days` cover every night, `sum amountMinor` → `<p data-testid="stay-quote">${'$'}${formatMinor(sum)}</p>`. Else omit. Context: `Booking for {contextDisplayName}` only.

**Check-in:** `listRooms`. `<select data-testid="check-in-room" value={roomId} onChange=…>`. Empty option **Select room**. Prefer `room.roomTypeId === reservation.roomTypeId` when known; if that set is empty, show all codes. Fail `listRooms`: omit select (do not restore text `room id`). Assign/Check-in still use `roomId`.

**Folio header:** `reservationStatusLabel(status)` instead of raw wire. No Advanced moves.

**Night audit:** title-case reportId; key labels map; drop stringify on the page.

Do not restyle tape blocks with prototype colours. `statusClass` stays.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/web-pms exec vitest run
pnpm check:web-pms-colors
```

Expected: PASS. Folio first-paint suite green aside from the In house matcher.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/status/reservation-status-label.ts \
  apps/web-pms/src/status/reservation-status-label.test.ts \
  apps/web-pms/src/screens
git commit -m "$(cat <<'EOF'
feat(web-pms): stay labels, book quote, and check-in picker

EOF
)"
```

(Include only the screen/status files actually touched. Do not re-add shell files.)

---

### Task 4: Spec pointers + DEMO-READY P0-3 ticks

**Spec:** §11 pointers, DEMO-READY P0-3. No ARCHITECTURE §16.4 rewrite.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-folio-first-paint-design.md` §12 rows 1 / 12 / 13 / 15
- Modify: `docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md` P0-3 leftover
- Modify: `DEMO-READY.md` P0-3 checkboxes

- [ ] **Step 1: Folio-first-paint leftover rows**

For rows 1 (chrome + skin), 12 (hide `shiftId`), 13 (In house copy), 15 (`ui-kit` / Tailwind / prototype palette), replace the Notes with a closed pointer:

```
**Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md).
```

Do not reopen Advanced. Do not tick P0-4.

- [ ] **Step 2: Demo-tenant-seed P0-3 leftover**

Where it says P0-3 will put **name** on the rail / chrome out of scope, add:

```
**Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md) (property name on the ops rail).
```

- [ ] **Step 3: Tick DEMO-READY P0-3**

Mark every P0-3 checkbox `[x]` (Shell, Tokens, Screens). Under the section add:

```
Closed 2026-08-13 by [prototype chrome + skin](docs/superpowers/specs/2026-08-13-prototype-chrome-skin-design.md).
```

Do **not** tick P0-4 / P0-5 / P1. Do **not** edit ARCHITECTURE.md §16.4.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-folio-first-paint-design.md \
  docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md \
  DEMO-READY.md
git commit -m "$(cat <<'EOF'
docs: tick P0-3 prototype chrome and close leftovers

EOF
)"
```

---

### Task 5: CI / checks job

**Spec:** §2, §14.1–3.

- [ ] **Step 1: Hygiene pins**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
git diff --exit-code -- migrations/do-property migrations/do-org packages/do-runtime
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
git diff --exit-code -- packages/contracts/src/v1-http-routes.ts packages/contracts/src/commands
git diff --exit-code -- apps/pms-core/src/demo-seed.ts apps/pms-core/src/demo-seed-fixture.ts
```

Expected: empty diffs. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `[127]=post_demo_seed` still last. `CLASS_DENYLIST` untouched. No `lucide-react` / `motion` / `tailwind` in `apps/web-pms/package.json`.

- [ ] **Step 2: `checks` job — copy `.github/workflows/ci.yml` in order**

```bash
pnpm install
pnpm build
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
```

Expected: all exit 0. `check:web-pms-colors` reports informational fg ≠ `#1a4a6e`.

- [ ] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0 (this chunk did not change pms-core; pin against accidental edits).

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 6: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–6 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [ ] **Step 1: Mark checkboxes**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-prototype-chrome-skin.md
git commit -m "$(cat <<'EOF'
docs: tick prototype chrome plan checkboxes after merge

EOF
)"
```

---

## Spec §17 acceptance / reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state table matched the tree **before** implementation (horizontal HospAI top-bar; Board / Arrivals / In-house / Departures equal nav; cool grey tokens + blue informational; Book type-only + visible ariVersion; check-in `placeholder="room id"`; queued + exceptions always open; no property name / date chip; catalog **77**, route **127**, property head **25**, org head **7**). After merge those chrome bullets are closed.
- [ ] Normative invariants include schema freeze, no new routes/commands/`export class`, colour-literal rule, 4.5:1 status gate, testid stability, no Tailwind/ui-kit/lucide/motion.
- [ ] **Exact** palette hex table spec §7 (accent fill-only; informational sage `#3A4F40` / `#EEF1EC`).
- [ ] **Exact** nav order/labels/routes/icons/tone spec §3.2; in-house/departures not in sidebar; folio drill-in; `/in-house` `/departures` routes remain.
- [ ] **Exact** tokens spec §7; screens spec §8 / file map spec §11.
- [ ] Scope-out names **P0-2** (done), **P0-4**, **P0-5**, **P1**, **P2** §16.4, pixel-faithful rebuild, Tailwind, ui-kit, Worker routes/commands, schema, seed, Whistle / Simulation / role-swap / disclaimer / property switcher.
- [ ] Folded leftovers spec §12 and deferred leftovers spec §13 both present in the spec; this plan does not implement deferred rows.
- [ ] Acceptance tests spec §14 green.
- [ ] `data-testid`s in spec §9 remain. New ids only `shell-role`, `property-name`, `business-date-chip`, `stay-quote`, `check-in-room`.
- [ ] DEMO-READY P0-3 ticked. Folio-first-paint leftover rows 1/12/13/15 closed by pointer. Demo-seed rail leftover closed. No ARCHITECTURE §16.4 rewrite.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Tokens §7 + `--radius` + IBM Plex + `check:web-pms-colors` §14.3 | 1 |
| Sidebar / mark / HospAI PMS / selected row §3 | 2 |
| Nav order / tone / drop in-house+departures §3.2 / §14.4–7 | 2 |
| Role footer §3.4 / §14.9 | 2 |
| Ops rail search + property name + business-date chip §4 / §14.10–12 | 2 |
| Icons §6 | 2 |
| Queued + exceptions collapsed when empty §5.2 / §14.13 | 2 |
| Hide `shiftId` on badge §5.1 / §14.14 | 2 |
| Forbidden chrome §14.22 | 2 |
| Guest names / room codes / status copy §8.1 / §8.7 / §14.18–19 | 3 |
| Tape Room Plan + summary chips §8.2 / §14.15 | 3 |
| Book dollar quote / hide ariVersion / guestRef §8.3 / §14.16 | 3 |
| Check-in picker by code §8.4 / §14.17 | 3 |
| Folio skin + In house copy §8.5 / §14.21 | 3 |
| Night audit job chrome §8.6 / §14.20 | 3 |
| Pointers + DEMO-READY P0-3 | 4 |
| Heads freeze, ddl no-op, full CI, colors | 5 |
| Plan checkboxes | 6 |
| P0-4 / P0-5 / P1 / P2 §16.4 / Tailwind / ui-kit / Worker / seed | all (forbidden) |
