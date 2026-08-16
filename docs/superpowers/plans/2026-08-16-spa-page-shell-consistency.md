# SPA Page Shell Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-16)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Adopt one locked page anatomy (`PageHeader` + optional `Tabs` / `Metrics` / `Toolbar` + `Card`) on every operational SPA screen, fix Room Plan tape scroll + tab/metric affordances, Front Desk titles + row actions, Housekeeping Card shell, Book choice rows, and enforce with merge-blocking `pnpm check:spa-page-chrome` from Task 6 onward. **No frozen heads move.**

**Architecture:** Extend ui-kit minimally (`CardTitle` → `<h2>`, `CardContent flush?: boolean`, toolbar field shrink, metric border). Add host CSS for bounded tape scroll + sticky header row. Migrate screens in spec §9 order: foundation + enforcement script first (CI self-test only), then Room Plan → Front Desk → Housekeeping → Book, then mechanical `PageHeader` lift on remaining Lock 8 screens, then live chrome check in CI. Caller-owned `className="ui-tab"|"ui-metric"|"ui-choice"` on host `Link`/`label`/`span` — closed ui-kit API otherwise.

**Tech Stack:** React 19 SPA (`apps/web-pms`), `@hospai/ui-kit`, hand-written CSS (`packages/ui-kit/src/styles.css`, `apps/web-pms/src/styles.css`), vitest + Testing Library, Node check scripts (`scripts/spa-page-chrome-check.mjs`), GitHub Actions `checks` job.

**Spec:** `docs/superpowers/specs/2026-08-16-spa-page-shell-consistency-design.md` (Approved reviewer 2026-08-16). **Locks 1–10 are normative — do not re-litigate.**

---

## Frozen heads (none move)

| Head | Current | This vertical |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; tail `get_city_ledger_statement` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-08-16.

---

## Global Constraints

- **No catalog / HTTP route / schema / night-audit step / idempotency constant changes.**
- **No Tailwind, no new hex, no Storybook, no Playwright visual CI.**
- **No restyle of `--tape-*` grid column math, stay-block geometry, or tape occupancy CSS** beyond scroller `max-block-size` + sticky header row.
- **Closed ui-kit API:** only new prop is `CardContent flush?: boolean`. Caller `className="ui-tab"` / `"ui-metric"` / `"ui-choice"` on **host** `Link` / `label` / `span` only.
- **Title Case** for operator-visible page and section titles. Never `mode.replace` / route keys as visible titles.
- **One `<h1>` per screen** — owned by `PageHeader`. Section titles are `<h2>` via `CardTitle`.
- **Keep existing `data-testid`s** (`tape-from`, `tape-to`, `board-date`, `board-summary`, `hk-business-date`, `booking-screen`, `room-type-list`, etc.).
- **`HousekeepingScreen.tsx` must not duplicate chrome** — host stays thin; chrome lives in `HousekeepingApp.tsx` only.
- **`pnpm check:web-pms-colors` stays green.** `pnpm check:spa-page-chrome` live scan is merge-blocking **from Task 6 onward** only; Task 1 adds `--self-test` to CI only.
- **Scope-out:** folio ledger redesign, rates matrix labels, settings save-button width, Rates/Settings/Inventory raw tab strips (Lock 8 title lift only), production deploy, git push.

---

## File map

| Area | Files | Task |
|---|---|---|
| ui-kit API + CSS | `packages/ui-kit/src/Card.tsx`, `styles.css`, `components.test.tsx` | 1 |
| Tape CSS | `apps/web-pms/src/styles.css` (`.tape-scroller`, sticky header) | 1 |
| Chrome check | `scripts/spa-page-chrome-check.mjs`, root `package.json`, `.github/workflows/ci.yml` (self-test Task 1; live Task 6) | 1, 6 |
| Cursor + ARCHITECTURE | `.cursor/rules/spa-page-chrome.mdc`, `ARCHITECTURE.md` §16.4 | 1 |
| Room Plan | `TapeChartScreen.tsx`, `board-summary.tsx`, tests | 2 |
| Front Desk | `BoardScreen.tsx`, test | 3 |
| Housekeeping | `HousekeepingApp.tsx`, test | 4 |
| Book | `BookingScreen.tsx`, test | 5 |
| Mechanical lift | Remaining Lock 8 `*Screen.tsx` (not `HousekeepingScreen.tsx`) | 6 |
| Final CI | full `checks` job verification | 7 |

**Not touched:** `packages/contracts/**`, `apps/pms-core/**`, `migrations/**`, catalog, routes, schema, `demo-seed.ts`.

Reviewer executes subagent-driven (fresh Composer 2.5 Fast per task). Plan writer does not commit.

---

### Task 1: Foundation — ui-kit, tape CSS, chrome check, docs

**Files:**
- Modify: `packages/ui-kit/src/Card.tsx`
- Modify: `packages/ui-kit/src/styles.css` (after `.ui-toolbar` block ~line 424; after `.ui-metric` block ~line 441)
- Modify: `apps/web-pms/src/styles.css` (`.tape-scroller` ~309–313; `.tape-header-cell` ~354–359; `.tape-room` ~321–331)
- Create: `scripts/spa-page-chrome-check.mjs`
- Modify: `package.json` (add `"check:spa-page-chrome"`)
- Modify: `.github/workflows/ci.yml` (after line 41 — **self-test only**)
- Create: `.cursor/rules/spa-page-chrome.mdc`
- Modify: `ARCHITECTURE.md` (append after line 2139)
- Test: `packages/ui-kit/src/components.test.tsx`

**Interfaces:**
- Produces: `CardTitle` renders `<h2>`; `CardContent({ flush?: boolean })` adds `.ui-card__content--flush`; CSS rules `.ui-toolbar .ui-field { inline-size: auto; }`, `.ui-metric { border: 1px solid var(--line); }`; tape scroller bounded; `node scripts/spa-page-chrome-check.mjs --self-test` exit 0.

- [ ] **Step 1: Write the failing ui-kit tests**

Add to `packages/ui-kit/src/components.test.tsx` (after the DataTable test ~line 120):

```tsx
  it('CardTitle renders heading level 2', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Section</CardTitle>
        </CardHeader>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('CardContent flush applies ui-card__content--flush', () => {
    render(
      <Card>
        <CardContent flush>
          <p>Flush body</p>
        </CardContent>
      </Card>,
    );
    const content = screen.getByText('Flush body').parentElement;
    expect(content?.className).toMatch(/ui-card__content--flush/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @hospai/ui-kit test`

Expected: FAIL — `CardTitle` still renders `<h1>` (level 1 found); flush class absent.

- [ ] **Step 3: Implement Card.tsx + ui-kit CSS**

Replace `packages/ui-kit/src/Card.tsx`:

```tsx
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { TestIdProps } from './types.js';

export type CardProps = TestIdProps &
  React.ComponentPropsWithoutRef<'div'> & {
    children?: ReactNode;
  };

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={clsx('ui-card', className)} {...rest}>
      {children}
    </div>
  );
}

export type CardHeaderProps = {
  children?: ReactNode;
};

export function CardHeader({ children }: CardHeaderProps) {
  return <div className="ui-card__header">{children}</div>;
}

export type CardTitleProps = {
  children?: ReactNode;
};

export function CardTitle({ children }: CardTitleProps) {
  return <h2 className="ui-card__title">{children}</h2>;
}

export type CardContentProps = {
  children?: ReactNode;
  flush?: boolean;
};

export function CardContent({ children, flush }: CardContentProps) {
  return (
    <div className={clsx('ui-card__content', flush && 'ui-card__content--flush')}>
      {children}
    </div>
  );
}

export type CardFooterProps = {
  children?: ReactNode;
};

export function CardFooter({ children }: CardFooterProps) {
  return <div className="ui-card__footer">{children}</div>;
}
```

Append to `packages/ui-kit/src/styles.css` inside the toolbar/metrics section:

```css
.ui-toolbar .ui-field {
  inline-size: auto;
}
```

Add to `.ui-metric` block (merge with existing rules at ~432–441):

```css
.ui-metric {
  display: inline-flex;
  align-items: baseline;
  gap: 0.375rem;
  padding: 0.3125rem 0.625rem;
  border-radius: var(--radius);
  background: var(--selected);
  font-size: var(--text-sm);
  color: var(--muted);
  border: 1px solid var(--line);
}
```

- [ ] **Step 4: Run ui-kit tests to verify they pass**

Run: `pnpm --filter @hospai/ui-kit test`

Expected: PASS (all tests including new CardTitle/CardContent cases).

- [ ] **Step 5: Add tape scroller CSS**

In `apps/web-pms/src/styles.css`, replace `.tape-scroller` block (~309–313):

```css
.tape-scroller {
  overflow: auto;
  touch-action: manipulation;
  overscroll-behavior: contain;
  max-block-size: min(70vh, calc(100dvh - 18rem));
}
```

Append sticky rules after `.tape-header-cell` block (~354–359):

```css
.tape-header-cell {
  padding: 0.35rem 0.4rem;
  grid-column: var(--tape-col);
  grid-row: 1;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--panel);
}

/* Header corner cell (empty .tape-room in date row) sticks on vertical scroll too */
.tape-row:first-child .tape-room {
  top: 0;
  z-index: 3;
}
```

Do **not** change `--tape-cols` / `--tape-col` / grid template math.

- [ ] **Step 6: Create `scripts/spa-page-chrome-check.mjs`**

Create the full script:

```javascript
#!/usr/bin/env node
/**
 * SPA page-shell floor check (spec Lock 9):
 * Every scanned operational screen must render PageHeader + Card;
 * no mode.replace titles; TapeChart view tabs need ui-tab; tape-scroller bounded.
 *
 *   node scripts/spa-page-chrome-check.mjs
 *   node scripts/spa-page-chrome-check.mjs --self-test
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS_DIR = join(root, 'apps/web-pms/src/screens');
const HK_APP = join(root, 'modules/pms/housekeeping/src/ui/HousekeepingApp.tsx');
const STYLES = join(root, 'apps/web-pms/src/styles.css');
const EXCLUDE = new Set(['HousekeepingScreen.tsx']);

const PAGE_HEADER_RE = /<PageHeader[\s>]/;
const CARD_RE = /<Card[\s>]/;
const MODE_REPLACE_RE = /mode\.replace\('-',\s*' '\)/;

/** Opening <Link …> for a view tab must include ui-tab before > */
function linkOpenerHasUiTab(opener) {
  if (/className="ui-tab"/.test(opener)) return true;
  if (/className=\{'ui-tab'\}/.test(opener)) return true;
  if (/className=\{[^}]*['"]ui-tab['"]/.test(opener)) return true;
  if (/clsx\([^)]*['"]ui-tab['"]/.test(opener)) return true;
  return false;
}

/** Find Tape / Available view-tab Link openers in TapeChartScreen source */
export function checkTapeViewTabs(src) {
  const errors = [];
  const linkRe = /<Link\b([^>]*)>([\s\S]*?)<\/Link>/g;
  let m;
  while ((m = linkRe.exec(src)) !== null) {
    const opener = m[1];
    const inner = m[2].trim();
    if (inner === 'Tape' || inner === 'Available') {
      if (!linkOpenerHasUiTab(opener)) {
        errors.push(`view tab Link "${inner}" missing ui-tab on opening tag`);
      }
    }
  }
  return errors;
}

export function checkTapeScrollerCss(css) {
  const block = css.match(/\.tape-scroller\s*\{[^}]*\}/s);
  if (!block) return ['.tape-scroller block not found'];
  if (!/max-block-size/.test(block[0])) {
    return ['.tape-scroller block lacks max-block-size'];
  }
  return [];
}

export function checkScreenFile(filePath, src) {
  const errors = [];
  const rel = filePath.replace(root + '/', '');
  if (!PAGE_HEADER_RE.test(src)) errors.push(`${rel}: missing PageHeader`);
  if (!CARD_RE.test(src)) errors.push(`${rel}: missing Card`);
  if (MODE_REPLACE_RE.test(src)) errors.push(`${rel}: mode.replace title`);
  if (rel.endsWith('TapeChartScreen.tsx')) {
    errors.push(...checkTapeViewTabs(src).map((e) => `${rel}: ${e}`));
  }
  return errors;
}

function listScreenFiles() {
  return readdirSync(SCREENS_DIR)
    .filter((name) => name.endsWith('Screen.tsx') && !EXCLUDE.has(name))
    .map((name) => join(SCREENS_DIR, name));
}

export function runLiveCheck() {
  const errors = [];
  for (const file of listScreenFiles()) {
    const src = readFileSync(file, 'utf8');
    errors.push(...checkScreenFile(file, src));
  }
  const hkSrc = readFileSync(HK_APP, 'utf8');
  errors.push(...checkScreenFile(HK_APP, hkSrc));
  const css = readFileSync(STYLES, 'utf8');
  errors.push(...checkTapeScrollerCss(css).map((e) => `apps/web-pms/src/styles.css: ${e}`));
  return errors;
}

function selfTest() {
  let failed = false;
  const fail = (msg) => {
    console.error('self-test FAILED:', msg);
    failed = true;
  };

  if (!PAGE_HEADER_RE.test('<PageHeader title="X" />')) {
    fail('PAGE_HEADER_RE must match PageHeader');
  }
  if (PAGE_HEADER_RE.test('<PageHeaderish')) {
    fail('PAGE_HEADER_RE must not match partial');
  }
  if (!CARD_RE.test('<Card>')) fail('CARD_RE must match <Card>');
  if (!CARD_RE.test('<Card data-testid="x">')) fail('CARD_RE must match <Card prop>');
  if (CARD_RE.test('<CardHeader>')) fail('CARD_RE must not match CardHeader');
  if (CARD_RE.test('<CardTitle>')) fail('CARD_RE must not match CardTitle');
  if (!MODE_REPLACE_RE.test("mode.replace('-', ' ')")) {
    fail('MODE_REPLACE_RE must match mode.replace');
  }

  // Lock 9 Tape/Available fixtures
  const tapeFail = '<Link to="/board">Tape</Link>';
  const tapePass = '<Link className="ui-tab" to="/board">Tape</Link>';
  const availFail = '<Link to="/board?view=available">Available</Link>';
  const availPass =
    '<Link className="ui-tab" to="/board?view=available" aria-current="page">Available</Link>';

  if (checkTapeViewTabs(tapeFail).length === 0) fail('tapeFail fixture should FAIL');
  if (checkTapeViewTabs(tapePass).length !== 0) fail('tapePass fixture should PASS');
  if (checkTapeViewTabs(availFail).length === 0) fail('availFail fixture should FAIL');
  if (checkTapeViewTabs(availPass).length !== 0) fail('availPass fixture should PASS');

  const cssOk = `.tape-scroller {
  overflow: auto;
  max-block-size: min(70vh, calc(100dvh - 18rem));
}`;
  if (checkTapeScrollerCss(cssOk).length !== 0) fail('cssOk fixture should PASS');
  const cssBad = `.tape-scroller { overflow: auto; }`;
  if (checkTapeScrollerCss(cssBad).length === 0) fail('cssBad fixture should FAIL');

  const badScreen = 'export function X() { return <div><Card /></div>; }';
  if (checkScreenFile('apps/web-pms/src/screens/XScreen.tsx', badScreen).length === 0) {
    fail('missing PageHeader fixture should FAIL');
  }
  const goodScreen =
    'export function X() { return <div><PageHeader title="T" /><Card /></div>; }';
  if (checkScreenFile('apps/web-pms/src/screens/XScreen.tsx', goodScreen).length !== 0) {
    fail('PageHeader+Card fixture should PASS');
  }

  if (failed) process.exit(1);
  console.log('check:spa-page-chrome --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const errors = runLiveCheck();
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`spa-page-chrome FAILED (${errors.length} issue(s))`);
    process.exit(1);
  }
  console.log('OK spa-page-chrome: all scanned screens pass floor check');
}
```

- [ ] **Step 7: Add root script + CI self-test**

In root `package.json` `scripts`, add after `check:ui-kit-adoption`:

```json
"check:spa-page-chrome": "node scripts/spa-page-chrome-check.mjs",
```

In `.github/workflows/ci.yml` `checks` job, after line 41 (`node scripts/ui-kit-adoption-check.mjs --self-test`):

```yaml
      - run: node scripts/spa-page-chrome-check.mjs --self-test
```

Do **not** add `pnpm check:spa-page-chrome` live scan until Task 6.

- [ ] **Step 8: Create Cursor rule**

Create `.cursor/rules/spa-page-chrome.mdc`:

```markdown
---
description: Operational SPA screens use PageHeader + Card anatomy; Title Case; ui-tab/ui-metric caller classNames; tape scroller max-block-size.
globs: apps/web-pms/src/screens/**/*.tsx, modules/pms/housekeeping/src/ui/**/*.tsx
alwaysApply: false
---

# SPA page shell (Lock 1)

Every operational screen uses this stack inside its root (sibling order):

1. `PageHeader` — the page's single `<h1>` (Title Case strings; never `mode.replace` or route keys).
2. Optional `Tabs` / `Metrics` / sibling KPI row above the card.
3. `Card` with optional `Toolbar`, `CardHeader` + `CardTitle` (`<h2>` section title only), `CardContent`.

`PageHeader` is a **sibling above** `Card`, not inside `CardHeader`.

## Caller classNames (ui-kit router contract)

- View tabs: host `<Link className="ui-tab" aria-current="page">` on the active tab.
- Navigable KPIs: host `<Link className="ui-metric">`.
- Choice rows: each option is `<li className="ui-choice-row"><label className="ui-choice">` (vertical list; radio beside label on one baseline).

Do not add `className` to closed ui-kit components except `Card`'s existing leak. **Allowed ui-kit extension:** `CardContent flush?: boolean`.

## Tape (Room Plan)

- `.tape-scroller` must include `max-block-size: min(70vh, calc(100dvh - 18rem))`.
- Sticky first date row: `.tape-header-cell` and header `.tape-room` use `top: 0; background: var(--panel)`.
- Do **not** change `--tape-*` grid math.

## Housekeeping host

`HousekeepingScreen.tsx` is a thin host only — **do not** add `PageHeader`/`Card` there. Chrome lives in `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`.

## Enforcement

Merge-blocking: `pnpm check:spa-page-chrome` (live) + `node scripts/spa-page-chrome-check.mjs --self-test`. Do not invent a third card padding scheme — use `CardContent flush` for table/tape bodies.
```

- [ ] **Step 9: Append ARCHITECTURE §16.4 Enforcement paragraph**

Append after line 2139 in `ARCHITECTURE.md` (verbatim from spec Lock 10):

> **Page shell (2026-08-16).** Every operational SPA screen renders `PageHeader` (page `<h1>`) and at least one `Card` from `@hospai/ui-kit`; section titles use `CardTitle` (`<h2>`). Merge-blocking gate: `pnpm check:spa-page-chrome`. Does not reopen palette, Tailwind, or ui-kit package decisions.

- [ ] **Step 10: Verify Task 1 gates**

Run: `pnpm --filter @hospai/ui-kit test`
Expected: PASS

Run: `node scripts/spa-page-chrome-check.mjs --self-test`
Expected: PASS (`check:spa-page-chrome --self-test OK`)

Run: `pnpm check:spa-page-chrome`
Expected: **FAIL** (screens not migrated yet — expected until Task 6)

- [ ] **Step 11: Commit**

```bash
git add packages/ui-kit/src/Card.tsx packages/ui-kit/src/styles.css packages/ui-kit/src/components.test.tsx \
  apps/web-pms/src/styles.css scripts/spa-page-chrome-check.mjs package.json \
  .github/workflows/ci.yml .cursor/rules/spa-page-chrome.mdc ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
feat(ui-kit,web-pms): page-shell foundation and chrome floor check

Establish CardTitle h2, CardContent flush, tape scroller bounds, and merge-blocking self-test for SPA page anatomy enforcement.
EOF
)"
```

---

### Task 2: Room Plan — TapeChartScreen + BoardSummary

**Files:**
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` (return ~414–461; imports ~16)
- Modify: `apps/web-pms/src/screens/board-summary.tsx`
- Modify: `apps/web-pms/src/screens/TapeChartScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/board-summary.test.tsx`

**Interfaces:**
- Consumes: Task 1 `CardContent flush`, `PageHeader`, `Tabs`, `Toolbar`, `Metrics`, `.ui-metric` border CSS.
- Produces: Room Plan anatomy; `board-summary` uses `ui-metric` links; tape tabs use `ui-tab`.

- [ ] **Step 1: Write failing BoardSummary test**

Add to `apps/web-pms/src/screens/board-summary.test.tsx`:

```tsx
  it('nav links use ui-metric not chip', async () => {
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 3,
      departuresDue: 1,
      departed: 0,
      inHouse: 2,
      overstay: 0,
      occupancy: { occupiedRooms: 2, sellableRooms: 3 },
    });
    renderSummary();
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeTruthy());
    const arrivals = screen.getByRole('link', { name: /Arrivals/i });
    expect(arrivals.className).toMatch(/ui-metric/);
    expect(arrivals.className).not.toMatch(/chip/);
    expect(arrivals.getAttribute('href')).toBe('/arrivals?date=2026-08-13');
    expect(screen.getByRole('link', { name: /Due out/i }).className).toMatch(/ui-metric/);
    expect(screen.getByRole('link', { name: /In-house/i }).className).toMatch(/ui-metric/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/board-summary.test.tsx`

Expected: FAIL — links still have `chip` class.

- [ ] **Step 3: Implement board-summary.tsx**

Replace `apps/web-pms/src/screens/board-summary.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { api, asClassified, tenant } from '../client.js';
import { Badge, Metrics } from '@hospai/ui-kit';

export function BoardSummary({ date }: { date: string | null }) {
  const summaryQ = useQuery({
    queryKey: ['front-desk-summary', tenant.propertyId, date],
    queryFn: () => api.getFrontOfficeSummary(tenant.propertyId, date!),
    enabled: date != null,
    retry: (n, err) => n < 2 && shouldRetry(asClassified(err)),
    retryDelay: (n, err) => retryDelay(asClassified(err), n),
  });

  if (!date || !summaryQ.data) return null;
  const s = summaryQ.data;

  return (
    <div data-testid="board-summary" className="tabular-nums">
      <Metrics>
        <Link className="ui-metric" to={`/arrivals?date=${encodeURIComponent(date)}`}>
          Arrivals <span className="ui-metric__value">{s.arrivals}</span>
        </Link>
        <Link className="ui-metric" to={`/departures?date=${encodeURIComponent(date)}`}>
          Due out <span className="ui-metric__value">{s.departuresDue}</span>
        </Link>
        <Link className="ui-metric" to="/in-house">
          In-house <span className="ui-metric__value">{s.inHouse}</span>
        </Link>
        {s.overstay > 0 ? (
          <Badge rung="exception" data-testid="board-summary-overstay">
            Overstay {s.overstay}
          </Badge>
        ) : null}
        <span className="ui-metric">
          Occupancy{' '}
          <span className="ui-metric__value">
            {s.occupancy.occupiedRooms} / {s.occupancy.sellableRooms}
          </span>
        </span>
      </Metrics>
    </div>
  );
}
```

- [ ] **Step 4: Run board-summary test to verify it passes**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/board-summary.test.tsx`

Expected: PASS

- [ ] **Step 5: Write failing TapeChartScreen tests**

Add to `apps/web-pms/src/screens/TapeChartScreen.test.tsx`:

```tsx
  it('renders PageHeader Room Plan and ui-tab view links', async () => {
    // reuse existing tape mock setup from sibling tests
    getFrontOfficeTape.mockResolvedValue({
      ok: true,
      fromDate: '2026-08-13',
      toDate: '2026-08-15',
      asOf: 1,
      rooms: [room],
      blocks: [occupying],
      ooo: [],
    });
    postGuestsBatch.mockResolvedValue({ states: { g1: { kind: 'named', displayName: 'Ada' } } });
    listRoomTypes.mockResolvedValue({ roomTypes: [{ roomTypeId: 'rt_king', name: 'King', code: 'KNG' }] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 1,
      overstay: 0,
      occupancy: { occupiedRooms: 1, sellableRooms: 3 },
    });
    renderTape('/board?from=2026-08-13&to=2026-08-15');
    await waitFor(() => expect(screen.getByRole('heading', { name: /room plan/i })).toBeInTheDocument());
    const tape = screen.getByRole('link', { name: 'Tape' });
    const available = screen.getByRole('link', { name: 'Available' });
    expect(tape.className).toMatch(/ui-tab/);
    expect(available.className).toMatch(/ui-tab/);
    expect(tape).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('board-summary')).toBeTruthy();
    expect(screen.getByTestId('tape-from')).toBeTruthy();
    expect(screen.getByTestId('tape-to')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.tape-scroller')).toBeTruthy());
  });
```

(Adapt `renderTape` helper to match existing test file patterns.)

- [ ] **Step 6: Run TapeChart test to verify it fails**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/TapeChartScreen.test.tsx`

Expected: FAIL — no PageHeader; links lack `ui-tab`.

- [ ] **Step 7: Implement TapeChartScreen return anatomy**

Update imports in `TapeChartScreen.tsx`:

```tsx
import {
  Badge,
  Card,
  CardContent,
  Field,
  Input,
  PageHeader,
  Tabs,
  Toolbar,
  type StatusRung,
} from '@hospai/ui-kit';
```

Replace return block (~414–461):

```tsx
  const tapeHref = from && to ? windowSearch(from, to, 'tape') : '/board';
  const availableHref =
    from && to ? windowSearch(from, to, 'available') : '/board?view=available';

  return (
    <div>
      <div className="visually-hidden" aria-live="polite" />
      <PageHeader title="Room Plan" />
      <Tabs label="Room Plan views">
        <Link
          className="ui-tab"
          to={tapeHref}
          aria-current={view === 'tape' ? 'page' : undefined}
        >
          Tape
        </Link>
        <Link
          className="ui-tab"
          to={availableHref}
          aria-current={view === 'available' ? 'page' : undefined}
        >
          Available
        </Link>
      </Tabs>
      <BoardSummary date={today} />
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="From"
            control={
              <Input
                type="date"
                data-testid="tape-from"
                autoComplete="off"
                value={from ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  if (to) writeWindow(next, to);
                  else setFrom(next);
                }}
              />
            }
          />
          <Field
            size="xs"
            label="To"
            control={
              <Input
                type="date"
                data-testid="tape-to"
                autoComplete="off"
                value={to ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  if (from) writeWindow(from, next);
                  else setTo(next);
                }}
              />
            }
          />
        </Toolbar>
        <CardContent flush>{body}</CardContent>
      </Card>
    </div>
  );
```

- [ ] **Step 8: Run TapeChart + board-summary tests**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/TapeChartScreen.test.tsx apps/web-pms/src/screens/board-summary.test.tsx`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web-pms/src/screens/TapeChartScreen.tsx apps/web-pms/src/screens/board-summary.tsx \
  apps/web-pms/src/screens/TapeChartScreen.test.tsx apps/web-pms/src/screens/board-summary.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): adopt Room Plan page shell anatomy

PageHeader, Tabs, Metrics KPIs, and flush tape CardContent so operators get bounded scroll and clickable view tabs.
EOF
)"
```

---

### Task 3: Front Desk — BoardScreen titles + RowActions

**Files:**
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` (~142–147 row actions; ~297–338 return; imports ~19)
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 `BoardSummary`/`Metrics`; Task 1 `PageHeader`, `RowActions`, `CardTitle` h2.
- Produces: `BOARD_SECTION_TITLE` map; PageHeader **Front Desk**; section `CardTitle` from map.

- [ ] **Step 1: Write failing BoardScreen test**

Add to `BoardScreen.test.tsx`:

```tsx
  it('shows Front Desk page title and Title Case section heading', async () => {
    getArrivals.mockResolvedValue({ ok: true, items: [item], nextCursor: null });
    postGuestsBatch.mockResolvedValue({ states: { g1: { kind: 'named', displayName: 'Ada' } } });
    listRooms.mockResolvedValue({ rooms: [] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 3 },
    });
    renderBoard('arrivals', '/arrivals?date=2026-08-13');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Front Desk' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Arrivals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Arrivals' }).textContent).toBe('Arrivals');
  });

  it('separates row action links with RowActions', async () => {
    getArrivals.mockResolvedValue({
      ok: true,
      items: [{ ...item, status: 'confirmed' }],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({ states: { g1: { kind: 'named', displayName: 'Ada' } } });
    listRooms.mockResolvedValue({ rooms: [{ roomId: 'rm_1', code: '101' }] });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-08-13',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 3 },
    });
    renderBoard('arrivals', '/arrivals?date=2026-08-13');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Check in' })).toBeInTheDocument());
    expect(document.querySelector('.ui-row-actions')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Check in Folio Book for guest' })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/BoardScreen.test.tsx`

Expected: FAIL — heading shows `arrivals`; no `.ui-row-actions`.

- [ ] **Step 3: Implement BoardScreen**

Add imports: `PageHeader`, `RowActions` from `@hospai/ui-kit`.

Add closed map near top of file (after `BoardMode` type):

```tsx
const BOARD_SECTION_TITLE: Record<BoardMode, string> = {
  arrivals: 'Arrivals',
  departures: 'Due out',
  'in-house': 'In-house',
};
```

Replace row action cell (~138–147) — **preserve `ConfirmPendingButton`** for pending arrivals:

```tsx
              <DataTableCell>
                {mode === 'arrivals' && status === 'pending' ? (
                  <>
                    <ConfirmPendingButton reservationId={row.reservationId} />
                    <RowActions>
                      <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>Folio</Link>
                      <Link to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}>
                        Book for guest
                      </Link>
                    </RowActions>
                  </>
                ) : mode === 'arrivals' && status !== 'pending' ? (
                  <RowActions>
                    <Link to={`/check-in/${encodeURIComponent(row.reservationId)}`}>Check in</Link>
                    <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>Folio</Link>
                    <Link to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}>
                      Book for guest
                    </Link>
                  </RowActions>
                ) : (
                  <RowActions>
                    <Link to={`/folio/${encodeURIComponent(row.reservationId)}`}>Folio</Link>
                    <Link to={`/book?guestRef=${encodeURIComponent(row.guestRef)}`}>
                      Book for guest
                    </Link>
                  </RowActions>
                )}
              </DataTableCell>
```

Replace return (~297–338):

```tsx
  const summaryDate = date ?? (timeZone ? propertyLocalToday(timeZone) : null);

  return (
    <div>
      {createdBanner ? (
        <Card role="status" data-testid="created-banner">
          Reservation {createdBanner} created
        </Card>
      ) : null}

      <PageHeader title="Front Desk" />
      <BoardSummary date={summaryDate} />

      <Card>
        <CardHeader>
          <header className="board-header">
            <CardTitle>{BOARD_SECTION_TITLE[mode]}</CardTitle>
            {mode !== 'in-house' ? (
              <Field
                size="xs"
                label="Date"
                control={
                  <Input
                    type="date"
                    data-testid="board-date"
                    value={date ?? ''}
                    onChange={(e) => {
                      setCursor(null);
                      setDate(e.target.value);
                    }}
                  />
                }
              />
            ) : null}
          </header>
        </CardHeader>
        <CardContent>
          {body}
          {listQ.data?.nextCursor ? (
            <Button type="button" onClick={() => setCursor(listQ.data!.nextCursor)}>
              Next page
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
```

- [ ] **Step 4: Run BoardScreen tests**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/BoardScreen.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/BoardScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): Front Desk page shell and row actions

Title Case page and section headings with RowActions so board links no longer read as one run-on sentence.
EOF
)"
```

---

### Task 4: Housekeeping — HousekeepingApp Card shell

**Files:**
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` (return ~265+; imports)
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx`
- **Do not modify:** `apps/web-pms/src/screens/HousekeepingScreen.tsx`

**Interfaces:**
- Consumes: Task 1 `PageHeader`, `Card`, `Toolbar`, `Field size="xs"`.
- Produces: Housekeeping chrome in module UI only.

- [ ] **Step 1: Write failing test**

Add to `HousekeepingApp.test.tsx`:

```tsx
  it('renders PageHeader Housekeeping and ui-card shell', async () => {
    renderApp(stubApi());
    expect(screen.getByRole('heading', { name: 'Housekeeping' })).toBeInTheDocument();
    expect(document.querySelector('.ui-card')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/pms-housekeeping test`

Expected: FAIL — plain `<h1>` at line 267, no `.ui-card`.

- [ ] **Step 3: Implement HousekeepingApp wrap**

Add imports from `@hospai/ui-kit`:

```tsx
import { Card, CardContent, Field, Input, NativeSelect, PageHeader, Toolbar } from '@hospai/ui-kit';
```

Replace return opening (~265–278) — wrap filters in Toolbar, table in CardContent; OOO form in second Card:

```tsx
  return (
    <div>
      <PageHeader title="Housekeeping" />
      <Card>
        <Toolbar>
          <Field
            size="xs"
            label="Business date"
            control={
              <Input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                data-testid="hk-business-date"
              />
            }
          />
          <Field
            size="xs"
            label="Filter status"
            control={
              <NativeSelect
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="clean">Clean</option>
                <option value="dirty">Dirty</option>
                <option value="inspected">Inspected</option>
                <option value="out_of_order">Out of order</option>
              </NativeSelect>
            }
          />
          <Field
            size="xs"
            label="Floor"
            control={
              <NativeSelect
                aria-label="Filter floor"
                value={floorFilter}
                onChange={(e) => setFloorFilter(e.target.value)}
              >
                <option value="">All</option>
                {[...new Set(rooms.map((r) => r.floor).filter((f): f is string => Boolean(f)))].map(
                  (floor) => (
                    <option key={floor} value={floor}>
                      {floor}
                    </option>
                  ),
                )}
              </NativeSelect>
            }
          />
          <Field
            size="xs"
            label="Assignment"
            control={
              <NativeSelect
                aria-label="Filter assignment"
                value={assignedFilter}
                onChange={(e) => setAssignedFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="assigned">assigned</option>
                <option value="unassigned">unassigned</option>
              </NativeSelect>
            }
          />
        </Toolbar>

        <CardContent>
          {(roomsQuery.isError || assignmentsQuery.isError) && (
            <Alert>
              Unable to load housekeeping board
              {roomsClass === 'fail_closed' || assignClass === 'fail_closed'
                ? ' (property unreachable)'
                : ''}
              .
            </Alert>
          )}

          {rosterQuery.isError && <Alert>Unable to load housekeepers</Alert>}

          {emptyRoster && <p>No housekeepers on the roster</p>}

          <div data-testid="hk-workload">{/* existing workload map */}</div>

          {/* existing DataTable — keep as-is */}
          {/* existing showPicker assign UI — keep inside CardContent */}
        </CardContent>
      </Card>

      {canSetOoo ? (
        <Card>
          <CardContent>
            <form data-testid="hk-ooo-form" onSubmit={/* existing handler */}>
              {/* existing OOO fields unchanged */}
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
```

Merge existing body content (DataTable, picker, alerts) into `CardContent` without changing table behaviour. Remove the standalone `<h1>Housekeeping</h1>` at line 267.

- [ ] **Step 4: Run housekeeping tests**

Run: `pnpm --filter @hospai/pms-housekeeping test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/pms/housekeeping/src/ui/HousekeepingApp.tsx modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx
git commit -m "$(cat <<'EOF'
feat(housekeeping): PageHeader and Card page shell

Wrap the module board in ui-kit chrome so housekeeping matches operational SPA anatomy without double-wrapping the host screen.
EOF
)"
```

---

### Task 5: Book — BookingScreen PageHeader + choice rows

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` (~500–628)
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 `PageHeader` back slot styling.
- Produces: `PageHeader title="Book"` with back `← Arrivals`; room types as vertical list with `li.ui-choice-row` + `label.ui-choice`.

- [ ] **Step 1: Write failing test**

Add to `BookingScreen.test.tsx`:

```tsx
  it('renders Book PageHeader and ui-choice room type labels', async () => {
    // use existing booking screen render helper + mocks
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Book' })).toBeInTheDocument());
    expect(screen.getByTestId('booking-screen')).toBeTruthy();
    expect(screen.getByTestId('room-type-list')).toBeTruthy();
    const choice = document.querySelector('li.ui-choice-row label.ui-choice');
    expect(choice).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/BookingScreen.test.tsx`

Expected: FAIL — `<h1>Book</h1>` at line 505; no `.ui-choice`.

- [ ] **Step 3: Implement BookingScreen chrome**

Add `PageHeader` import. Wrap screen root:

```tsx
  return (
    <div>
      <PageHeader
        title="Book"
        back={<Link to="/arrivals">← Arrivals</Link>}
      />
      <Card data-testid="booking-screen">
        {/* remove standalone back <p> and <h1>Book</h1> */}

        <section className="stack">{/* Dates — unchanged */}</section>
        {/* Rate plan, Promo — unchanged */}

        <section className="stack">
          <h2>Room type</h2>
          {/* avail alerts unchanged */}
          <ul data-testid="room-type-list">
            {selectable.map((id) => (
              <li key={id} className="ui-choice-row">
                <label className="ui-choice">
                  <Input
                    type="radio"
                    name="roomType"
                    value={id}
                    checked={roomTypeId === id}
                    onChange={() => setRoomTypeId(id)}
                  />
                  {(() => {
                    const t = typeDir.get(id);
                    if (!t) return 'Room type unavailable';
                    const suffix = t.kind === 'virtual' ? ' · Run of house' : '';
                    return (
                      <>
                        {t.name} (<span translate="no">{t.code}</span>){suffix}
                      </>
                    );
                  })()}
                </label>
              </li>
            ))}
          </ul>
          {/* quote version + rest unchanged */}
        </section>
        {/* remainder of wizard unchanged inside Card */}
      </Card>
    </div>
  );
```

Check-in back link (`CheckInScreen.tsx:151`) may wait for Task 6 if not editing that file here.

- [ ] **Step 4: Run BookingScreen tests**

Run: `pnpm --filter @hospai/web-pms test apps/web-pms/src/screens/BookingScreen.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx apps/web-pms/src/screens/BookingScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): Book page shell and choice-row room types

Move page title to PageHeader with back navigation and align room-type radios to ui-choice-row baseline layout.
EOF
)"
```

---

### Task 6: Mechanical PageHeader lift + live CI

**Files:**
- Modify: each remaining Lock 8 screen (see table below)
- Modify: `.github/workflows/ci.yml` (add live `pnpm check:spa-page-chrome`)

**Pattern for every file:** Add `PageHeader` as sibling **above** existing `Card`(s). Move page title from inner `<h1>` or `CardTitle` used as page title into `PageHeader title=…`. Remove duplicate page-level `<h1>`. Keep section `<h2>` / inner `CardTitle` only when needed. Do not redesign screen bodies.

#### Current title lines (tree-verified 2026-08-16)

| File | Current page title line | `PageHeader` title |
|---|---|---|
| `ReservationsDirectoryScreen.tsx` | `293`: `<CardTitle>Reservations</CardTitle>` | **Reservations** |
| `CheckInScreen.tsx` | `153`: `<h1>Check in {displayName ?? 'guest'}</h1>` | **Check in {displayName ?? 'guest'}** (dynamic) |
| `FolioScreen.tsx` | `1045`: `<h1>Folio</h1>` | **Folio** |
| `ShiftScreen.tsx` | `106`, `121`: `<h1>Close shift</h1>`; `205`: `<h1>Shift receipt</h1>` | **Close shift** / **Shift receipt** per route branch |
| `StaffScreen.tsx` | `284`: `<h1 className="board-title">Staff</h1>` | **Staff** |
| `RosterScreen.tsx` | `130`: `<h1>Roster</h1>` | **Roster** |
| `NightAuditScreen.tsx` | `151`: `<h1>Night audit</h1>` | **Night audit** |
| `ExceptionsScreen.tsx` | `303`: `<h1 className="text-wrap-balance">Exceptions</h1>` | **Exceptions** |
| `GuestsDirectoryScreen.tsx` | `145`: `<CardTitle>Guests</CardTitle>` | **Guests** |
| `GuestProfileScreen.tsx` | `192`: `<CardTitle>{heading}</CardTitle>` | **`{heading}`** variable (Ada Lovelace test) |
| `InventoryScreen.tsx` | `254`: `<h1>Inventory</h1>` | **Inventory** |
| `RatesScreen.tsx` | `359`: `<h1>Rates</h1>` | **Rates** |
| `SettingsScreen.tsx` | `393`: `<h1>Settings</h1>` | **Settings** |
| `CityLedgerScreen.tsx` | `243–246`: detail `<h1><Link>City ledger</Link> · name</h1>`; `452`: `<h1>City ledger</h1>` | **City ledger** (detail: keep account name in subtitle or section, not second h1) |
| `SignInScreen.tsx` | `33`: `<CardTitle>Sign in</CardTitle>` inside `SignInChrome` | **Sign in** — add `<PageHeader title="Sign in" />` sibling above `Card` in `SignInChrome`; remove `CardTitle` page duplicate |

**Already done Tasks 2–5:** `TapeChartScreen`, `BoardScreen`, `BookingScreen`, `HousekeepingApp`.

**Excluded:** `HousekeepingScreen.tsx` (thin host).

#### GuestProfile example (preserve level-1 guest name)

```tsx
  return (
    <div data-testid="guest-profile">
      {unsavedGuard}
      <PageHeader title={heading} />
      {contactFailClosed ? (
        <Alert>Guest profile unavailable — organization unreachable.</Alert>
      ) : guestQ.isLoading ? (
        <p className="muted">Loading…</p>
      ) : guest ? (
        <Card>
          <CardHeader>
            <header className="board-header">
              {canBook ? (
                <Link to={`/book?guestRef=${encodeURIComponent(guestRef)}`} data-testid="guest-book">
                  Book for guest
                </Link>
              ) : null}
            </header>
          </CardHeader>
          <CardContent>{/* body unchanged */}</CardContent>
        </Card>
      ) : null}
    </div>
  );
```

#### CheckIn example

```tsx
      <PageHeader
        title={`Check in ${displayName ?? 'guest'}`}
        back={<Link to="/arrivals">← Arrivals</Link>}
      />
      <Card>
        {/* remove lines 150–153 back link + h1 */}
```

#### SignInChrome example

```tsx
function SignInChrome({ children }: { children?: ReactNode }) {
  return (
    <div className="sign-in" data-testid="sign-in">
      <PageHeader title="Sign in" />
      <Card>
        <CardHeader>
          <div className="app-sidebar-brand">{/* brand unchanged */}</div>
          <p className="muted">Front desk</p>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 1: Write / update GuestProfile regression test (already exists — verify still passes after lift)**

`GuestProfileScreen.test.tsx:105` — `getByRole('heading', { level: 1 })` text **Ada Lovelace** must still pass with title on `PageHeader`.

- [ ] **Step 2: Implement mechanical lift on all 14 files above**

Apply pattern file-by-file. Keep all `data-testid`s.

- [ ] **Step 3: Run live chrome check — must be green**

Run: `pnpm check:spa-page-chrome`
Expected: PASS (`OK spa-page-chrome: all scanned screens pass floor check`)

Run: `node scripts/spa-page-chrome-check.mjs --self-test`
Expected: PASS

- [ ] **Step 4: Add live scan to CI (live-check group)**

In `.github/workflows/ci.yml` `checks` job, add **one** line immediately after `pnpm check:ui-kit-adoption` (line 30). Do **not** move or duplicate the `--self-test` line — Task 1 already places `node scripts/spa-page-chrome-check.mjs --self-test` next to `node scripts/ui-kit-adoption-check.mjs --self-test`.

```yaml
      - run: pnpm check:spa-page-chrome
```

Final live-check block (lines 30–34 after Task 6):

```yaml
      - run: pnpm check:ui-kit-adoption
      - run: pnpm check:spa-page-chrome
      - run: pnpm check:web-pms-me-gating
      - run: pnpm check:pms-core-test-dates
      - run: pnpm check:module-manifests
      - run: pnpm check:purge
```

- [ ] **Step 5: Run targeted screen tests**

Run: `pnpm --filter @hospai/web-pms test`
Expected: PASS (including `GuestProfileScreen.test.tsx`)

- [ ] **Step 6: Commit**

```bash
git add apps/web-pms/src/screens/*.tsx .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(web-pms): mechanical PageHeader lift on remaining screens

Every operational screen now exposes PageHeader plus Card for merge-blocking spa-page-chrome live enforcement.
EOF
)"
```

---

### Task 7: Full CI verification (mandatory last task)

**Files:** none (verification only)

**Purpose:** Confirm the vertical matches the merge bar. The `checks` job is authoritative; pms-core shard jobs exist separately — implementers on a laptop run the subset below before commit, not eight local shards.

#### Local subset (must pass before Task 7 commit)

```bash
pnpm build
pnpm typecheck
pnpm --filter @hospai/ui-kit test
pnpm --filter @hospai/web-pms test
pnpm --filter @hospai/pms-housekeeping test
pnpm check:web-pms-colors
pnpm check:spa-page-chrome
node scripts/spa-page-chrome-check.mjs --self-test
pnpm lint
```

#### Full GHA `checks` job (merge bar — copy exact order from `.github/workflows/ci.yml`)

- [ ] **Step 1: Run full checks job sequence**

```bash
pnpm install
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

Expected: all exit 0.

**Note:** `test-pms-core` (8 shards) and `test-pms-core-ledger-prop` run in separate CI jobs — GHA merge requires them green, but local implementers need not run shards for this CSS/SPA vertical unless touching pms-core.

- [ ] **Step 2: Frozen-head pin sanity (no edits — verify unchanged)**

```bash
node -e "import('./packages/contracts/dist/commands/catalog.js').then(m=>console.log('CATALOG',m.COMMAND_CATALOG.length))"
node -e "import('./packages/contracts/dist/v1-http-routes.js').then(m=>console.log('ROUTES',m.V1_HTTP_ROUTE_AUDIT.length,m.V1_HTTP_ROUTE_AUDIT.at(-1).id))"
node -e "import('./packages/do-runtime/dist/schema-head.js').then(m=>console.log('SCHEMA',m.PROPERTY_SCHEMA_HEAD))"
```

Expected: `CATALOG 89`, `ROUTES 144 get_city_ledger_statement`, `SCHEMA 34`.

- [ ] **Step 3: Commit (only if Task 7 uncovered fix commits — otherwise no empty commit)**

If all green with no code changes since Task 6, **skip commit**. If fixes were needed, commit with why-focused message.

---

## Self-review against spec

| Spec requirement | Task |
|---|---|
| Lock 1 page anatomy | 2–6 |
| Lock 2 Front Desk titles + Metrics | 3 |
| Lock 3 Room Plan tabs/metrics/toolbar/flush tape | 2 |
| Lock 4 clickable affordance (ui-metric border, ui-tab) | 1–2 |
| Lock 5 Housekeeping Card/Toolbar | 4 |
| Lock 6 Book choice rows + PageHeader | 5 |
| Lock 7 CardTitle h2 | 1 |
| Lock 8 mechanical lift (all screens table) | 2–6 |
| Lock 9 chrome check + CI placement + Cursor rule | 1, 6 |
| Lock 10 ARCHITECTURE paragraph | 1 |
| §8 TDD tests (ui-kit, screens, script self-test) | 1–6 |
| §4 scope-out (no catalog/schema/Tailwind/hex/Playwright/tape grid math) | all |
| Frozen heads unchanged | 7 |
| HousekeepingScreen excluded from scan | 1 script EXCLUDE set |
| Existing data-testids preserved | 2–6 |

**Placeholder scan:** No TBD/TODO/similar-to-task gaps in this plan.

**Spec gaps:** None identified — Rates/Settings/Inventory raw tab strips explicitly deferred (spec §10 #9).
