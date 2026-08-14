# UI System Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Repair the control layer that P0-3 never reached (spec §1.2, nine verified defects), then replace it with `packages/ui-kit` — a hand-authored component layer with a closed API, enforced by lint and a CI adoption ratchet. No Tailwind, no shadcn/ui.

**Architecture:** Two phases. **Batch 0** (Tasks 1–2) is repair: CSS for defects 1–7, then two mechanical markup passes for defects 8–9. **Batches 1–7** (Tasks 3–10) are convergence: a `tsc`-built workspace package shipping components plus one global `ui-kit.css`, adopted screen-by-screen behind a ratchet, ending with the housekeeping module and `no-raw-controls-in-web-pms` flipped to `error`. Tokens are untouched throughout. No Worker, catalog, schema, or seed changes.

**Tech Stack:** React 19 SPA (`apps/web-pms`), `packages/ui-kit` (new, `tsc`, peer-dep React), hand-written CSS + `tokens.css`, `clsx`, vitest + Testing Library, `pnpm check:web-pms-colors`, `pnpm check:ui-kit-adoption` (new), `eslint-plugin-hospai`.

**Spec:** `docs/superpowers/specs/2026-08-13-ui-system-convergence-design.md` (Approved, rev 3). Spec commit: `5228861`.

---

## Sequencing gate (read before starting)

Spec §2.0 is normative and splits this plan in two:

| Tasks | When |
|---|---|
| **Tasks 1–2** (batch 0) | **May run before the demo.** CSS plus two mechanical markup passes, no new dependencies, no test risk. This is repair, not convergence. |
| **Tasks 3–12** (batches 1–7) | **After P0-4 and P0-5 are ticked**, unless the reviewer explicitly re-sequences the demo. DEMO-READY has 12 unticked boxes. |

Do not start Task 3 because Task 2 went well. The gate is a calendar decision, not a technical one.

---

## Spec deviation requiring reviewer sign-off (one)

**Sticky table header offset.** Spec §9 batch 0b and §16.9 specify `thead th` sticky at `top: 4rem` (clearing `.ops-rail`, which is `top: 0`, `height: 4rem`, `z-index: 30`). That is correct **only** for page-level sticky.

Task 2 wraps tables in a scroll container, and CSS forces `overflow-y` to a non-`visible` value once `overflow-x` is `auto`. The wrapper therefore becomes the scroll container, and `position: sticky` on `thead` resolves against **it**, not the viewport — so `top: 4rem` would push the header 4rem down inside its own box and never pin.

**Resolution implemented here:** `.table-scroll` is a bounded box (`overflow-x: auto`, `max-block-size: 70vh`), and `thead th` is sticky at `top: 0` within it. This is also the better answer to defect 9 — the header pins while the body scrolls, instead of the whole page scrolling the header away.

**Action:** reviewer to approve; spec §9 batch 0b and §16.9 to be amended to "sticky within its scroll container" in the Task 10 docs commit. Do not silently ship against the committed spec text.

---

## Global Constraints

- **No Worker, catalog, schema, or seed changes.** `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` stays last. `COMMAND_CATALOG.length` **77**. `AUDIT_WRITER_COMMAND_IDS.size` **52**. `PLATFORM_GAPS` `[]`. `PROPERTY_SCHEMA_HEAD` **25**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS.length` **7**. `pnpm generate:ddl` no-op.
- **No new `export class`.** `CLASS_DENYLIST` is not edited. ui-kit components are functions.
- **`apps/web-pms/src/styles/tokens.css` is not touched by any task.** No new hex anywhere (spec invariant 3).
- **Colour literals only on `--color-*`.** Every `--status-*-fg` and every spec §4 pair ≥ 4.5:1. Do not weaken `scripts/web-pms-colors-check.mjs`.
- **No Tailwind, no shadcn/ui, no Storybook, no `lucide-react`, no `motion`, no `recharts`, no react-hook-form, no zod.** Spec §1.4 / §16.44–47.
- **No dark theme.** No `.dark` block, no `prefers-color-scheme: dark`.
- **All 109 `data-testid` values stay** on the same control with the same string (spec §10).
- **Tier A preserves tag and ARIA role** (spec invariant 6). Tier B is opt-in per screen with its own jsdom setup and test migration named in the PR.
- **ui-kit accepts no `className` and no `style`** (spec invariant 17, §7.3). No blanket `...rest` spread.
- **`/dev/ui` is dev-only, outside `AppShell`, never in `NAV_ENTRIES`/`ALL_NAV`** (spec invariant 18).
- **Do not reopen P0-2 folio IA or P0-3 nav/IA.** Controls and containers change; screen flow does not.
- **Tape-chart grid CSS (`.tape-*`) stays hand-written** and is not migrated.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`. This chunk is SPA + packages; pms-core shards are a CI pin only.
- Living plan checkboxes: tick `- [x]` on merge only (Task 12). Do not backfill historical plans.
- No either/or forks. Spec §17 locks stand. The two open rows (§17.7 `Stack`, §17.8 `cva`) are decided in Task 3 Step 1 and recorded there.
- **Scope-out (do not implement):** P0-4, P0-5, P1 rows, `packages/ui-shell`, Style Dictionary / Figma sync, component maturity labels, codemods, visual regression, tenant theming, palette changes.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/web-pms/src/styles.css` | 0a control repair; 0b `.table-scroll` + print; `@import` ui-kit; batch-7 deletions | 1, 2, 3, 10 |
| `scripts/class-resolution-check.mjs` | **New.** Every `className` token resolves to a rule (spec §16.5) | 1 |
| `apps/web-pms/src/screens/*.tsx` | 0b container roots + table wrappers | 2 |
| `packages/ui-kit/**` | **New package.** Tier A components, `ui-kit.css`, tests | 3 |
| `scripts/web-pms-colors-check.mjs` | Walk root + §4 pair table + self-tests | 4 |
| `scripts/ui-kit-adoption-check.mjs` + `.ui-kit-adoption-baseline.json` | **New.** Ratchet (spec §9.1) | 4, ratchets 5–10 |
| `tooling/eslint-plugin-hospai/src/no-raw-controls-in-web-pms.ts` | **New rule** + test + `rules` map + `configs.recommended` | 4, 10 |
| `apps/web-pms/src/dev/UiGallery.tsx`, `App.tsx` | **New.** Dev-only gallery (spec §9.2) | 4 |
| `apps/web-pms/src/shell/*.tsx` | Batch 2 shell adoption | 5 |
| `apps/web-pms/src/screens/*` (read) | Batch 3 | 6 |
| `apps/web-pms/src/screens/*` (forms) | Batch 4 | 7 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Batch 5, alone | 8 |
| `apps/web-pms/src/screens/{NightAudit,Exceptions,Shift}*` | Batch 6 | 9 |
| `modules/pms/housekeeping/{package.json,src/ui/HousekeepingApp.tsx}` | Batch 7 | 10 |
| `ARCHITECTURE.md` §16.4, `DEMO-READY.md` P2 | Rewrite + ticks | 10 |
| `docs/superpowers/specs/2026-08-13-prototype-chrome-skin-design.md` | Pointer sentence | 10 |

## Test file split (spec §16 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 heads / ddl | CI job | 11 |
| 3–4 no-`.tsx`-diff / unmodified suites | diff review + full run | 1, 2 |
| 5 class resolution | `scripts/class-resolution-check.mjs` self-test | 1 |
| 6–8 control CSS present | `scripts/class-resolution-check.mjs` companion assertions | 1 |
| 9–10 tables / titles | `scripts/class-resolution-check.mjs` + screen tests | 2 |
| 11–14 colour gate | `scripts/web-pms-colors-check.mjs --self-test` | 4 |
| 15–18 lint rule | `no-raw-controls-in-web-pms.test.ts` | 4, 10 |
| 19–25 ui-kit behaviour | `packages/ui-kit/src/*.test.tsx` | 3 |
| 26–29 API constraints | `packages/ui-kit/src/api-surface.test.ts` (type-level) | 3 |
| 30–33 ratchet | `scripts/ui-kit-adoption-check.mjs --self-test` | 4 |
| 34–36 gallery | `apps/web-pms/src/dev/UiGallery.test.tsx` | 4 |
| 37–43 screens | existing screen test files | 5–10 |
| 44–47 forbidden deps | CI job | 11 |

---

### Task 1: Batch 0a — control repair CSS (own commit, **no `.tsx`**)

**Spec:** §1.2 defects 1–7, §9 batch 0a, §16.3, §16.5–8.

**Files:**
- Modify: `apps/web-pms/src/styles.css`
- Add: `scripts/class-resolution-check.mjs`
- Modify: `package.json` (`check:class-resolution`)
- Test: `pnpm check:web-pms-colors`, `pnpm check:class-resolution`, full web-pms suite unmodified

**Forbidden this commit:** any `.tsx`, `tokens.css`, `packages/`, `tooling/`, Worker, catalog.

- [ ] **Step 1: Add the control baseline to `styles.css`**

Append after the existing bare-element rules. Every value is an existing `var(--…)` — no literals, so `check:web-pms-colors` stays green.

```css
/* --- control baseline (batch 0a; superseded by ui-kit in batch 7) --- */
input:not([type='checkbox']):not([type='radio']),
select,
textarea,
button {
  font: inherit;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

input:not([type='checkbox']):not([type='radio']),
select,
button {
  block-size: 2.25rem;
  padding: 0 0.75rem;
}

textarea {
  block-size: auto;
  padding: 0.5rem 0.75rem;
}

input[type='checkbox'],
input[type='radio'] {
  inline-size: 1rem;
  block-size: 1rem;
  accent-color: var(--primary);
}

.btn-primary {
  background: var(--action-primary-surface);
  color: var(--action-primary-fg);
  border-color: transparent;
}

.btn-destructive {
  background: var(--action-destructive-surface);
  color: var(--action-destructive-fg);
  border-color: transparent;
}

a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
```

The `:not([type='checkbox']):not([type='radio'])` guards are load-bearing — without them a 2.25rem block-size turns every checkbox into a square tile.

- [ ] **Step 2: Restore link affordance without touching chrome**

The global `a { color: inherit; text-decoration: none }` (line 13) **stays** — sidebar nav, board-summary chips, and tape blocks all depend on it. Scope affordance to unclassed content links only:

```css
.main a:not([class]) {
  color: var(--primary);
}

.main a:not([class]):hover {
  text-decoration: underline;
}
```

`:not([class])` is deliberate: it gives guest-name links and folio drill-ins an affordance while leaving every deliberately-styled link (`.board-summary a`, `.tape-block`, `.app-nav-list a`) alone. Chrome lives outside `.main` and is unaffected either way.

- [ ] **Step 3: Define the four orphaned classes**

```css
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.board-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
  font-weight: 600;
}
```

For `.staff-roster` (2 sites, `StaffScreen.tsx`) and `.exceptions-workbench` (1 site, `ExceptionsScreen.tsx:285`, already paired with `panel`): read both call sites first. If the class carries evident layout intent, give it a rule. If it carries none — `.exceptions-workbench` may be a bare hook, since `panel` does the work — **remove the class in Task 2** rather than inventing a rule for it. Record which choice was made in the commit body.

- [ ] **Step 4: Give `.panel` a radius (defect 7)**

Add `border-radius: var(--radius);` to the existing `.panel` rule at line 198. `details.side-panel`, `.chip`, `.reservation-search input`, and the nav links already use it; `.panel` was the outlier.

- [ ] **Step 5: Add `scripts/class-resolution-check.mjs` (spec §16.5)**

Walk `apps/web-pms/src/**/*.tsx` and `modules/**/src/ui/**/*.tsx` (excluding tests), collect every token from `className="…"` string literals, and assert each resolves to a rule in `styles.css` or `tokens.css`. Reuse the walk helpers already in `scripts/web-pms-colors-check.mjs`.

Two things the naive version gets wrong — both cost an hour if discovered later:

1. **Template literals.** `className={\`badge ${statusClass(sev)}\`}` must contribute `badge` but **not** `statusClass`, `sev`, or `badgeSev`. Parse only the static text segments; ignore `${…}` interpolations entirely.
2. **Dynamically-composed status classes.** `statusClass()` returns `status-settled` … `status-exception`. Those are defined but never appear as literals. Seed an allowlist of the five rung classes rather than teaching the script to evaluate functions.

Add companion assertions for spec §16.6–8 in the same script: `input`/`select`/`textarea`/`button` each declare `font` and a block size; a `:focus-visible` rule exists; a `:disabled` rule exists; `.panel` declares `border-radius`.

Include `--self-test` with fixtures, matching the house pattern in `web-pms-colors-check.mjs`.

- [ ] **Step 6: Wire the script and verify**

Add `"check:class-resolution": "node scripts/class-resolution-check.mjs"` to root `package.json` scripts.

```bash
pnpm check:class-resolution && pnpm check:web-pms-colors && pnpm --filter @hospai/web-pms test
```

- [ ] **Step 7: Confirm zero `.tsx` diff, then commit**

```bash
git diff --name-only | grep -E '\.tsx$' && echo "FAIL: batch 0a touched TSX" || echo "ok"
```

```bash
git add apps/web-pms/src/styles.css scripts/class-resolution-check.mjs package.json
git commit -m "$(cat <<'EOF'
fix(web-pms): control baseline, link affordance, orphaned classes

Spec §1.2 defects 1-7. Form controls inherit the page font and share one
block size; buttons get an appearance; :focus-visible and :disabled exist;
.stack and .board-title stop being no-ops; .panel gets the radius every
other surface already had.

Adds check:class-resolution so an undefined class fails CI rather than
shipping. No TSX touched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Batch 0b — container rule + table scroll (markup, roots and wrappers only)

**Spec:** §1.2 defects 8–9, §9 batch 0b, §11, §16.9–10. **Deviation above applies.**

**Files:**
- Modify: `apps/web-pms/src/styles.css` (`.table-scroll`, sticky `thead`, print override)
- Modify: 9 screen files for the container rule; up to 17 for table wrappers
- Test: full web-pms suite **unmodified**

**Forbidden this commit:** any control swap, any ui-kit work, any IA change, any testid change.

- [ ] **Step 1: Add the table scroll CSS**

```css
.table-scroll {
  overflow-x: auto;
  max-block-size: 70vh;
  overscroll-behavior: contain;
}

.table-scroll thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
}

@media print {
  .table-scroll {
    max-block-size: none;
    overflow: visible;
  }

  .table-scroll thead th {
    position: static;
  }
}
```

`top: 0`, not `4rem` — see the deviation section. The print override is required by spec §11 hazard 2; without it long tables print with the header floating over rows.

- [ ] **Step 2: Apply the container rule — title inside the Card (spec §17.6)**

Move the `<h1>` inside the panel on the eight screens that render it outside: `BoardScreen`, `GuestProfileScreen`, `GuestsDirectoryScreen`, `InventoryScreen`, `RatesScreen`, `ReservationsDirectoryScreen`, `SettingsScreen`, `TapeChartScreen`. Give `ShiftScreen` a panel root — both return branches, including the "No open shift" early return at line 98.

Leave alone: the 7 screens already compliant (`BookingScreen`, `CheckInScreen`, `ExceptionsScreen`, `FolioScreen`, `NightAuditScreen`, `RosterScreen`, `StaffScreen`); the 7 route wrappers, which correctly render `<Outlet/>` and own no container; the modal panels in `GuestProfileScreen:321` and `SettingsScreen:756`; the `role="status"` banner at `BoardScreen:313`.

`getByRole('heading')` is unaffected by nesting, so no test should move. If one does, stop and ask — it means the screen was asserting on structure.

- [ ] **Step 3: Wrap the tables**

Wrap each `<table>` in `<div className="table-scroll">`, placed **inside** the panel so it does not fight the panel's 1rem padding. Skip the tape chart entirely — `.tape-*` is a CSS-grid scroller, not a table, and spec §1.4 excludes it.

- [ ] **Step 4: Drop any class Step 3 of Task 1 judged intentless**

If `.exceptions-workbench` (or `.staff-roster`) was found to carry no intent, remove the class from the markup here and drop its placeholder rule from `styles.css`. `check:class-resolution` must stay green either way.

- [ ] **Step 5: Verify no test moved**

```bash
pnpm --filter @hospai/web-pms test && pnpm check:class-resolution && pnpm check:web-pms-colors
git diff --stat -- '*.test.tsx' | tail -1   # expect empty
```

- [ ] **Step 6: Verify print by hand**

Load `/check-in/:reservationId`, trigger `print-reg-card`, and confirm in the print preview: chrome hidden, `.reg-card` visible, no floating table header. Spec §11 makes this demo-path critical and no automated test covers the rendered print view.

- [ ] **Step 7: Commit**

```bash
git add apps/web-pms/src
git commit -m "$(cat <<'EOF'
fix(web-pms): one container rule and bounded table scroll

Spec §1.2 defects 8-9. Page titles now sit inside the panel on all 15
screens that have one (8 moved, ShiftScreen gained a container). Tables
scroll inside a bounded box with a pinned header instead of scrolling the
page and losing it.

Sticky offset is top:0 within .table-scroll, not the spec's top:4rem —
overflow-x:auto forces overflow-y, making the wrapper the scroll container.
Spec §9/§16.9 amended in the Task 10 docs commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

> **Stop here until P0-4 and P0-5 are ticked.** Tasks 3–12 are batches 1–7.

---

### Task 3: Batch 1a — `packages/ui-kit` (own commit, no screen diffs)

**Spec:** §6.1, §7.2, §7.3, §16.19–29.

**Files:**
- Add: `packages/ui-kit/{package.json,tsconfig.json,src/**}`
- Modify: `apps/web-pms/package.json`, `apps/web-pms/src/styles.css` (`@import`)
- Test: `packages/ui-kit/src/*.test.tsx`, `api-surface.test.ts`

**Forbidden this commit:** any screen `.tsx`, Tailwind, shadcn CLI, Storybook, Radix (Tier B is per-screen later).

- [ ] **Step 1: Record the two open spec decisions**

Spec §17.7 (`Stack` component vs `.stack` class) and §17.8 (`cva` vs plain variant map). Decide both here and write the choice into the package README as one sentence each. Defaults if the reviewer has no preference: **`.stack` stays a CSS class** (it has no variants worth typing), and **a plain variant map** (12 components do not need `cva`'s API surface, and spec §3.3 forbids adding both).

- [ ] **Step 2: Scaffold the package**

`private: true`, `main`/`types` → `dist`, exports `.` and `./styles.css`, `build: tsc -p tsconfig.json`, `test: vitest run`, deps `clsx`, peer-deps `react ^19` / `react-dom ^19`. Mirror `modules/pms/housekeeping/package.json` for shape. `packages/*` is already globbed by `pnpm-workspace.yaml` — no workspace edit.

- [ ] **Step 3: Write `ui-kit.css`**

Global, prefixed class names (`.ui-btn`, `.ui-btn--primary`, `.ui-field`, `.ui-card`, `.ui-table`…). Reads existing semantic aliases only — `--ink`, `--panel`, `--line`, `--primary`, `--muted`, `--radius`, `--action-*`, `--status-*`. **Declares no colour of its own** (spec §16.25). It is the batch 0a baseline re-homed, so start by copying those rules and re-scoping them from element selectors to `.ui-*` classes.

- [ ] **Step 4: Implement Tier A against the §7.3 API**

`Button`, `LinkButton`, `Field`, `Input`, `NativeSelect`, `Checkbox`, `Textarea`, `Card` (+`Header`/`Title`/`Content`/`Footer`), `DataTable` (+ subcomponents), `Badge`, `Alert`, `Separator`, `Skeleton`.

Non-negotiable API rules, all four from §7.3:

- No `className` prop. No `style` prop. Not on any component.
- No blanket `...rest`. Forward exactly: `data-testid`, `aria-*`, `id`, `name`, `disabled`, `ref`, and the relevant native handlers.
- Variants are closed unions; **≤ 2 variant axes** per component.
- `Card` and `DataTable` take slot children, not configuration props.

Three components carry most of the weight and deserve care:

- **`Field`** — owns label association, spacing, hint, and error. It is the fix for defects 1, 2, and 5, and the reason screens will not hand-roll a label+input pair. One height across `text`, `date`, `number`, and `select` (spec §16.22).
- **`DataTable`** — owns the scroll container, the bounded height, and the sticky header, so no screen has to remember Task 2's CSS.
- **`Badge`** — must keep emitting the `status-*` class for its rung. `apps/web-pms/src/status/*` stays authoritative for severity; `Badge` renders it, it does not decide it.

- [ ] **Step 5: Tests, including the type-level ones**

Spec §16.19–25 behavioural; §16.26–29 API. The API tests must fail at **build** time, not on inspection — e.g. `@ts-expect-error` on `<Button className="x" />` in `api-surface.test.ts`, so `pnpm typecheck` is the enforcement. A runtime assertion that a class was ignored is not equivalent: it passes even when the prop is accepted.

- [ ] **Step 6: Wire the app and verify no screen changed**

Add `@hospai/ui-kit` to `apps/web-pms`; add `@import '@hospai/ui-kit/styles.css';` to `styles.css` **after** `tokens.css` so `var(--…)` resolves.

```bash
pnpm --filter @hospai/ui-kit build && pnpm --filter @hospai/ui-kit test
pnpm --filter @hospai/web-pms test && pnpm typecheck && pnpm check:web-pms-colors
git diff --name-only | grep 'apps/web-pms/src/screens' && echo "FAIL: screens touched" || echo "ok"
```

- [ ] **Step 7: Commit** — `feat(ui-kit): Tier A component layer with a closed API`

---

### Task 4: Batch 1b — gate, lint rule, ratchet, gallery (own commit, no screen diffs)

**Spec:** §5, §8, §9.1, §9.2, §16.11–18, §16.30–36.

- [ ] **Step 1: Extend `scripts/web-pms-colors-check.mjs`**

Add `packages/ui-kit/**/*.css` to the walk root (§5.1). Add the nine-pair table from spec §4 to rule 2 (§5.2) — `--ink`/`--bg`, `--ink`/`--panel`, `--muted`/`--bg`, `--muted`/`--panel`, `--muted`/`--selected`, `--primary`/`--selected`, `--primary`/`--bg`, `--action-primary-fg`/`--action-primary-surface`, `--action-destructive-fg`/`--action-destructive-surface`. All nine are ≥ 4.5:1 today (spec §4 records the measured values), so this codifies rather than changes. Add the `--self-test` fixture from §16.14. §5.3 `oklch` hardening is optional — take it if free.

- [ ] **Step 2: Add `no-raw-controls-in-web-pms`**

Model on `tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.ts` — same file-path predicate shape, same message shape. Forbid JSX intrinsics `button`, `input`, `select`, `textarea`, `table`, `th`, `td`, `tr`, `thead`, `tbody` in `apps/web-pms/src/**/*.tsx` and `modules/**/src/ui/**/*.tsx`. Allow everything inside `packages/ui-kit/`. Allow `option`, `form`, `fieldset`, `details`, `summary`, `dialog`. Register in `rules` and in `configs.recommended` as **`warn`** (spec §8 rollout). Add the rule test file.

- [ ] **Step 3: Add the adoption ratchet**

`scripts/ui-kit-adoption-check.mjs` + a committed baseline file. Counts the same intrinsics the lint rule forbids, across the same roots, **excluding** tests and `packages/ui-kit`. Fails when the count **rises**. Also fails when the count falls without the baseline being updated in the same commit — spec §16.32 makes it a true ratchet, not a ceiling, so the number cannot drift out of sync.

Seed the baseline from the spec §1.1 census (89 `button`, 100 `input`, 21 `select`, 16 `table` … in web-pms; 2/4/6/1 in housekeeping) — but **generate it, do not transcribe it**. Add `check:ui-kit-adoption` to root `package.json` and a `--self-test`.

- [ ] **Step 4: Add `/dev/ui`**

`apps/web-pms/src/dev/UiGallery.tsx` — every exported component, every variant, every state (default, focus, disabled, error). Route it in `App.tsx` as a **sibling** of the `AppShell` route, not a child, so it needs no `/me` authority and renders with the API down (spec §9.2, §16.34). Guard with `import.meta.env.DEV` so it is absent from the production bundle. Do **not** add it to `NAV_ENTRIES` — P0-3's nav-order test asserts `ALL_NAV` exactly. No prose, no props tables; it is a visual index, not a docs site.

- [ ] **Step 5: Verify and commit**

```bash
pnpm check:web-pms-colors && pnpm check:ui-kit-adoption && pnpm check:class-resolution && pnpm lint
pnpm --filter @hospai/web-pms test
```

Commit: `chore(web-pms): colour-pair gate, raw-control lint, adoption ratchet, /dev/ui`

---

### Tasks 5–9: Batches 2–6 — screen adoption

Same shape for each. One PR per task. Every task ends with the ratchet baseline lowered **in the same commit**.

**Per-task loop:**

- [ ] Swap Tier A components in the named files. Tag and role must not change (spec invariant 6).
- [ ] Keep every `data-testid` on the same control (spec §10).
- [ ] Run the screen's existing tests **unmodified**. A test that needs editing means either a Tier A swap changed DOM — which is out of spec, revert it — or a Tier B primitive was adopted, which requires its own named row in the PR with jsdom setup attached.
- [ ] Regenerate the ratchet baseline; confirm it fell.
- [ ] `pnpm check:ui-kit-adoption && pnpm check:class-resolution && pnpm check:web-pms-colors && pnpm lint`

| Task | Batch | Files | Notes |
|---|---|---|---|
| **5** | 2 — Shell | `AppShell`, `ShiftStrip`, `QueuedCommandsPanel`, `ExceptionsPanel`, `StaleWatermark`, `FrontOfficeLive` | Highest blast radius, smallest surface. `AppShell.boot` / `.me` / `.search` tests must pass unmodified (spec §16.38). Tier B candidate: `Command`/`Popover` for the rail search — testids `reservation-search` and `reservation-search-results` must survive (§16.39). |
| **6** | 3 — Read screens | `BoardScreen`, `TapeChartScreen`, `ReservationsDirectoryScreen`, `GuestsDirectoryScreen`, `GuestProfileScreen`, `board-summary`, `guest-row` | Mostly `DataTable` / `Badge` / `Card`. `DataTable` replaces the Task 2 `.table-scroll` wrappers — delete them as each screen converts. Do not touch `.tape-*`. |
| **7** | 4 — Form screens | `BookingScreen`, `CheckInScreen`, `SettingsScreen`, `InventoryScreen`, `RatesScreen`, `StaffScreen`, `RosterScreen`, `front-office-editor` | The bulk of 104 inputs / 27 selects. `Field` does the work. `check-in-room` stays a native select (spec §17.5). |
| **8** | 5 — Folio | `FolioScreen.tsx` **alone** | 1,414 LOC source / 1,123 LOC tests. Its own PR or it swallows another batch. P0-2 IA is closed — components only. `folio-advanced`, `folio-balance`, tenders unchanged (§16.40). |
| **9** | 6 — Operator | `NightAuditScreen`, `ExceptionsScreen`, `ShiftScreen` | Night-audit step wire names stay `PRE_CHECK` … `ARCHIVE` (§16.42). Tier B decision for `ExceptionsScreen.tsx:620`'s native `<dialog open>` — spec §17.9 leaves it open; §11 says portals escape the print rules, so the burden of proof is on changing it. |

---

### Task 10: Batch 7 — module, cleanup, `error`, docs

**Spec:** §7.4, §8 rollout, §14 row 3, §16.43, §16.18.

- [ ] **Step 1: Migrate the housekeeping module.** Add `@hospai/ui-kit`; swap Tier A in `HousekeepingApp.tsx`; drop **both** `className="error"` sites for `Alert`. The cross-boundary leak closes here. Module tests green (§16.43).
- [ ] **Step 2: Delete superseded CSS.** Remove the batch 0a control baseline and the `.table-scroll` block from `styles.css` — ui-kit owns both now. Keep chrome, `.tape-*`, status rungs, utilities, and the print block. `check:class-resolution` catches anything deleted too eagerly.
- [ ] **Step 3: Flip the lint rule to `error`** in `configs.recommended`. `pnpm lint` green (§16.18). If it is not, the ratchet lied — find out why before overriding.
- [ ] **Step 4: Retire the ratchet** to its floor (structural `option`/`form` sites remain legal), or delete it and let the lint rule carry the invariant. Reviewer's call; record which.
- [ ] **Step 5: Rewrite ARCHITECTURE §16.4.** Record all three decisions as made. The comparison table is stale — it still describes cool greys and `#1a4a6e`, which P0-3 replaced — and "visual divergence is expected" is no longer true. Also amend spec §9 batch 0b and §16.9 for the sticky-offset deviation.
- [ ] **Step 6: Tick DEMO-READY P2** rows (`ui-kit` extraction; §16.4 palette recording). Add the pointer sentence to `2026-08-13-prototype-chrome-skin-design.md`.
- [ ] **Step 7: Commit** — docs and code in separate commits, per house convention.

---

### Task 11: CI / checks job

- [ ] Add `check:class-resolution` and `check:ui-kit-adoption` to the CI check job alongside the existing 12.
- [ ] Pin spec §16.1–2 heads and §16.44–47 forbidden dependencies: no `tailwindcss`, `@tailwindcss/*`, `shadcn`, `@storybook/*`, `lucide-react`, `motion`, `recharts`, `react-hook-form`, `zod` in any `package.json`.
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green with `packages/ui-kit` in the graph. Confirm turbo picks the new package up without a `turbo.json` edit; add one only if it does not.
- [ ] Confirm a production build contains no `UiGallery` chunk (§16.36).

---

### Task 12: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–12 in **this** file. Do not backfill historical plans. Do not mix code fixes.

```bash
git add docs/superpowers/plans/2026-08-13-ui-system-convergence.md
git commit -m "$(cat <<'EOF'
docs: tick UI system convergence plan checkboxes after merge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Spec §19 acceptance / reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state §1.1 matched the tree **before** implementation. Re-verify if P0-4 landed first — a real `/sign-in` adds controls and moves the ratchet baseline.
- [ ] Defect table §1.2 reproducible; spot-check defects 6, 7, 8.
- [ ] Batch 0 test-safe: 0a touched no `.tsx`; 0b touched roots and wrappers only.
- [ ] Sticky-header constraint and print override handled — **with the deviation above approved**.
- [ ] All three §16.4 decisions locked; §3.2 states shadcn/ui is uninstallable by design.
- [ ] Rev-1 deletions justified, not dropped.
- [ ] Tier A / Tier B split justified by DOM preservation; Radix `Select` and `Checkbox` rejected with reasons.
- [ ] `packages/ui-kit` justified by an existing second consumer; `ui/` → ui-kit import does not trip `no-platform-import-in-domain`; global-CSS limitation stated.
- [ ] §7.3 closed: no `className`, no `style`, no blanket `...rest`, closed unions, ≤2 axes; escape hatch is "add a variant".
- [ ] `check:ui-kit-adoption` fails on increase, has a committed baseline, excludes tests and ui-kit, retires at batch 7.
- [ ] `/dev/ui` dev-only, outside `AppShell`, not in nav, renders with the API down.
- [ ] §15 rows 10a / 10b record the machinery deliberately not adopted.
- [ ] Enforcement rule ends at `error`, not `warn`.
- [ ] Batches independently revertable; batch 0 independently valuable; Folio alone.
- [ ] Scope-out honoured throughout.

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 defects 1–7 (controls, links, focus, disabled, orphan classes, radius) | 1 |
| §1.2 defects 8–9 (container rule, table scroll) + §11 print | 2 |
| §16.5 class-resolution test | 1 |
| §6.1 Tier A set; §7.2 package shape; §7.3 closed API | 3 |
| §16.19–29 ui-kit behaviour + type-level API tests | 3 |
| §5.1–5.2 gate walk + pair table; §5.3 optional | 4 |
| §8 lint rule at `warn` | 4 |
| §9.1 ratchet; §9.2 gallery | 4 |
| §9 batches 2–6 screen adoption; §10 testid contract | 5–9 |
| §6.2 Tier B admissions (rail search, exceptions dialog) | 5, 9 |
| §7.4 module leak closes; §8 rule → `error`; §14 row 3 §16.4 rewrite | 10 |
| §16.1–2 heads; §16.44–47 forbidden deps | 11 |
| Plan checkboxes | 12 |
| P0-4 / P0-5 / P1 / `ui-shell` / Tailwind / shadcn / Storybook / Style Dictionary / maturity labels / codemods | all (forbidden) |
