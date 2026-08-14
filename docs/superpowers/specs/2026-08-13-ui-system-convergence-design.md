# UI system convergence — control repair + `ui-kit`

**Date:** 2026-08-13
**Status:** Approved (reviewer, 2026-08-13) — rev 3, no-Tailwind branch
**Sources:** [ARCHITECTURE.md](../../../ARCHITECTURE.md) §11 package layout (`packages/ui-kit` — "design system") and §16.4 Visual identity; [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md) §1.3 / invariant 15 / §15 locks 2 and 10; [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md); [DEMO-READY.md](../../../DEMO-READY.md) P2 and out-of-scope; `apps/web-pms/src/styles.css`; `apps/web-pms/src/styles/tokens.css`; `scripts/web-pms-colors-check.mjs`; `tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.ts`; `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`; web-interface guidelines

**Closes:** ARCHITECTURE §16.4 "**When**" — the convergence slice and all three decisions it owns (palette source; whether Tailwind enters the platform; whether `ui-kit` becomes a package). DEMO-READY P2 rows "Extracting `packages/ui-kit` (§16.4)" and "Recording the P0-3 palette adoption in §16.4".

**Amends:** [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md) invariant 15 (`ui-kit`) and §15 locks 2 / 10. That chunk's Tailwind ban is **upheld, not amended** — this rev decides Tailwind stays out permanently (§3). ARCHITECTURE §16.4 **is** rewritten by this chunk (§14 row 3). Bidirectional pointer: one sentence in the chrome spec when this lands.

**Rev 2 changes from rev 1:** Tailwind and shadcn/ui are **out** (§3, reviewer's call after rev 1). Consequences: the shadcn variable-alias layer is deleted (§4 — the existing token layer needs no bridge); the `.tsx` colour-scanning gate extension is deleted (colour stays in `.css`, where the gate already reads it); the Tailwind build wiring and its `@source` hazard are deleted. A new **batch 0** folds in the control-repair work that makes the current UI cohere (§9), promoted ahead of everything else because it is demo-relevant and carries no test risk.

**Rev 3 changes from rev 2:** four adoption mechanisms folded in, drawn from how mature systems (Polaris, Atlassian, Primer) actually hold a design system together — enforcement, not documentation. New §7.3 closes the component API (`className` is not accepted; variants are closed unions). New `check:ui-kit-adoption` ratchet (§9 batch 1, §13) makes adoption a CI-visible number that can only go down. New dev-only `/dev/ui` gallery (§9 batch 1) as the cheap stand-in for Storybook, which stays deferred (§15 row 10).

---

## 1. Context & Motivation

§16.4 says visual convergence is "a Phase 1 slice of its own, sequenced after the front-desk verticals are built." That is still true, but rev 1 mis-stated the *problem*. The UI is not merely unstyled and awaiting a system. **It is visibly broken**, and the causes are specific, small, and mostly not architectural.

P0-3 skinned the chrome — sidebar, ops rail, nav, chips, status rungs — and never reached inside it. The frame looks designed; its contents render as browser defaults. That mismatch reads as broken far more strongly than either state would alone. §1.2 is the evidence.

The corollary matters for scoping: **most of what looks broken is repairable in CSS**, without a component layer, without new dependencies, and without touching a single `.tsx`. The component layer is what stops it recurring on screen 30. Both are in scope here, in that order.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| SPA size | `apps/web-pms/src`: **38** non-test `.tsx`, **9,053** LOC; **44** test files, **7,141** LOC. 29 files in `screens/`. |
| Module UI | `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` — **479** LOC. Built with plain `tsc -p` (no bundler, no CSS pipeline). Peer-deps `react`, `react-dom`, `@tanstack/react-query`; deps `@hospai/contracts` only. |
| Raw controls (web-pms) | `<input>` **100**, `<label>` **89**, `<button>` **89**, `<option>` **35**, `<select>` **21**, `<form>` **18**, `<table>` **16**, `<details>` **5**, `<textarea>` **4**, `<fieldset>` **2**, `<dialog>` **1** (`ExceptionsScreen.tsx:620`). Housekeeping adds 2 buttons, 4 inputs, 6 selects, 1 table. |
| Input types | `type="button"` 71, `submit` 18, `number` **13**, `date` **13**, `checkbox` 10, `search` 3, `radio` 3, `email` 3 — plus bare text. |
| Links | **43** `<Link>` elements. |
| Class usage | **261** `className` sites, **55** distinct strings. Top: `muted` (72), `error` (32), `stack` (18), `panel` (16), `tabular-nums` (14), `stack-row` (13). |
| Cross-boundary leak | `HousekeepingApp.tsx` uses `className="error"` **twice** — a class defined in `apps/web-pms/src/styles.css`, from a package that does not depend on `web-pms`. Implicit contract, no gate. |
| Stylesheet | `apps/web-pms/src/styles.css` — **545** lines: chrome, tape-chart grid, status rungs, nine utilities, bare-element rules, `@media print`. |
| Tokens | `apps/web-pms/src/styles/tokens.css` — sage `#4A5D4E`, tan `#C18C5D`, cream `#F1EFE9`, `--color-bg #F9F8F4`, `--color-ink #2D2926`, `--color-muted #575245`, `--color-line #E8E4D8`, four status rungs, action intents, `--radius: 8px`, `color-scheme: light`. **P0-3 already landed the prototype palette.** |
| Colour gate | `scripts/web-pms-colors-check.mjs`. Walks every `.css` under `apps/web-pms`. Rule 1: colour literals only on `--color-*`. Rule 2: every `--status-*-fg` ≥ 4.5:1 vs paired `-surface` **and** `--color-surface-base`. `resolveToHex` handles hex + `var()` chains. Merge-blocking. |
| Lint precedent | `tooling/eslint-plugin-hospai` — 10 rules, all `error` in `configs.recommended`. `no-inline-styles-in-web-pms` forbids inline styles in `apps/web-pms/**/*.tsx` except CSS custom properties (the 8 survivors are all `--tape-*` in `TapeChartScreen.tsx`). |
| Domain boundary | `no-platform-import-in-domain` fires only on `/domain/` paths and bans `cloudflare:*` / `@hospai/do-runtime` / `@hospai/tenant-router`. The module's UI is at `src/ui/`, a sibling of `src/domain/`. **A `ui/` → `@hospai/ui-kit` import is not a boundary violation.** |
| `ui-kit` | Does **not** exist. §11 reserves `ui-kit/ — design system`. `packages/*` is already globbed by `pnpm-workspace.yaml`. |
| Stack | React **19.1**, Vite **6.3**, Vitest **3.0**, jsdom **30**. No Tailwind, no Radix, no `lucide-react`, no `motion`, no `recharts`. |
| Testids | **109** distinct `data-testid` values across non-test sources. |

**Heads (this chunk does not move them):** `COMMAND_CATALOG` **77** (`register.test.ts:627`); `AUDIT_WRITER_COMMAND_IDS.size` **52** (`register.test.ts:268`); `V1_HTTP_ROUTE_AUDIT[127] = post_demo_seed`; `PLATFORM_GAPS` `[]`; `PROPERTY_SCHEMA_HEAD` **25**; `ORG_SCHEMA_HEAD` **7**; `NIGHT_AUDIT_STEPS` **7**; `CLASS_DENYLIST` unchanged (ui-kit components are **functions**).

### 1.2 What is broken today (verified — this is the motivation)

| # | Defect | Evidence | Symptom |
|---|---|---|---|
| 1 | **Form controls do not inherit the page font.** `button { font: inherit }` exists; there is no equivalent for `input` / `select` / `textarea`. The only input rule in 545 lines is `.reservation-search input` (line 452). | `styles.css` | Every field outside the rail renders in the UA font at UA metrics while the page is IBM Plex. |
| 2 | **Five input types with different intrinsic sizes, none normalised.** `date` (13), `number` (13), `search` (3), `email` (3), text. | §1.1 | "Text fields are not the same size everywhere" — they cannot be until height is set explicitly. |
| 3 | **Buttons keep the UA appearance.** Only `font` / `padding` / `cursor` are set — no background, border, radius, or colour. | `styles.css:339` | Native grey bevel inside a sage/tan app. |
| 4 | **Links have no affordance.** `a { color: inherit; text-decoration: none }` is global, over **43** `<Link>`s, many of them primary actions. | `styles.css:13` | Actions that are buttons render as plain text. |
| 5 | **No `:focus-visible` rule and no `:disabled` rule anywhere.** Zero occurrences in the whole stylesheet. | `styles.css` | Keyboard focus falls back to UA rings that wash out on cream; a pending-mutation disabled button is indistinguishable from an enabled one. **Functional defect, not cosmetic.** |
| 6 | **Four classes are referenced with no rule at all:** `stack` (**18** sites), `board-title` (**6**), `staff-roster` (**2**), `exceptions-workbench` (**1**). `.stack-row` is defined; `.stack` never was. | class census | The main vertical-layout primitive is a no-op — forms and panels have no row spacing. |
| 7 | **`.panel` has no `border-radius`**, while `details.side-panel`, `.chip`, `.board-summary` items, nav links and `.reservation-search input` all use `var(--radius)`. | `styles.css:198` | Square cards in a rounded UI. |
| 8 | **The page title sits inside the container on 7 screens and outside it on 8.** Inside: Booking, CheckIn, Exceptions, Folio, NightAudit, Roster, Staff. Outside: Board, GuestProfile, GuestsDirectory, Inventory, Rates, ReservationsDirectory, Settings, TapeChart. `ShiftScreen` has no container at all (root is `<div className="stack">`, itself a no-op per #6). | per-screen census | "Some pages have a container, some don't" — two page architectures across 15 screens. |
| 9 | **No table has a sticky header, a horizontal scroll container, or a max-height.** The only `overflow: auto` rules are `.exceptions-drawer` and `.tape-scroller`. With `table { width: 100% }`, wide tables squeeze columns until text wraps; long ones scroll the page with the header gone. | `styles.css:251,264` | 17 tables, none of them comfortable. |

**Constraint on the fix for #9:** `.ops-rail` is `position: sticky; top: 0; height: 4rem; z-index: 30`. A page-level sticky `thead` must sit at `top: 4rem` with a z-index below 30, or it slides underneath the rail.

**Not defects (checked, do not "fix"):** route wrappers render `<Outlet/>` and correctly own no container; `GuestProfileScreen`'s three panels are two sections plus a modal; `SettingsScreen`'s two are a section plus a modal; the 8 inline `style={{}}` sites are all `--tape-*` custom properties and are permitted by `no-inline-styles-in-web-pms`.

### 1.3 Scope in

1. **Batch 0 — control repair** (§9): defects 1–7 in CSS only, plus the two structural passes for 8 and 9. Demo-relevant; ships first.
2. **Decision record** (§3, §4, §7): Tailwind stays out permanently; `ui-kit` becomes a package; the palette is unchanged. ARCHITECTURE §16.4 rewritten to record all three.
3. **`packages/ui-kit`** (§7): a hand-authored component layer, consumed by both `apps/web-pms` and the housekeeping module. The `className="error"` leak closes.
4. **Tier A adoption across every screen** (§6.1, §9): ~350 raw controls become components.
5. **Tier B behavioural primitives** (§6.2): opt-in, per screen, each paying its own test cost.
6. **Colour-gate extension** (§5): cover `packages/ui-kit` CSS and prove the chrome/action pairs, not just `--status-*`.
7. **A closed component API** (§7.3): no `className`, no `style`, variants as closed unions — the constraint that stops the system leaking one nudge at a time.
8. **`hospai/no-raw-controls-in-web-pms`** (§8) and **`check:ui-kit-adoption`** (§9 batch 1): the two gates that keep it consistent after this chunk ships.
9. **A dev-only `/dev/ui` gallery** (§9 batch 1): every component in every variant on one page, so drift is visible in an afternoon rather than in a Storybook config.

### 1.4 Scope out (normative — name them so a later pass does not "fix" them here)

- **Tailwind, in any package.** Permanently, per §3. Do not add it "just for ui-kit."
- **shadcn/ui as a dependency or CLI target.** Without Tailwind it is not installable. §6 borrows its *component vocabulary*; the code is ours (§3.2).
- **Any palette change.** P0-3 landed sage/tan. No new hex (invariant 3).
- **Dark theme / `prefers-color-scheme`.** `color-scheme: light` stays.
- **Re-styling the tape-chart grid.** `.tape-*` stays hand-written; the CSS-var grid is load-bearing.
- **Layout or IA change of any screen.** Controls and containers change; screen flow, nav, and folio first-paint do not.
- **`lucide-react`, `motion`, `recharts`.** `icons.tsx` stays.
- **`packages/ui-shell`** (§11 nav registry / slot system). `module-ui-registry.ts` stays in the app.
- **New Worker routes, commands, schema, seed changes.** SPA + packaging only.
- **P0-4 / P0-5.** See §2.0.
- **react-hook-form + zod, toast libraries, chart libraries, Storybook.** §6.3, §15.

---

## 2. Invariants (normative)

### 2.0 Sequencing (normative, non-technical)

DEMO-READY says work P0 in order, and P0 is **not** complete — **P0-4** (Clerk / real `/sign-in`) and **P0-5** (8-minute script + dry runs) are open, 12 unticked boxes.

- **Batch 0 may run before the demo.** It is CSS plus two mechanical markup passes, no new dependencies, and it addresses what a viewer actually sees on a screen share. It is the exception to §16.4's "sequenced after" because it is repair, not convergence.
- **Batches 1–7 run after P0-4 and P0-5**, unless the reviewer explicitly re-sequences the demo.

### 2.1 Technical invariants

Implementation that violates these is out of spec.

1. **Colour literals live only on `--color-*` properties.** Unchanged. Because no Tailwind lands, colour stays in `.css` where the existing gate already reads it — the gate needs widening, not redesign (§5).
2. **Every declared foreground/surface pair passes 4.5:1**, including the chrome and action pairs added in §5.2. `pnpm check:web-pms-colors` stays merge-blocking. Do not weaken the script to win a component style.
3. **No new hex.** Every value used by batch 0 and by ui-kit already exists in `tokens.css`.
4. **Five status rungs unchanged** (`settled` / `neutral` / `informational` / `attention` / `exception`). `status-neutral` stays an empty rule. `apps/web-pms/src/status/*` mappers are not rewritten.
5. **Accent tan `#C18C5D` is fill-only** — never a text colour, never a focus ring. 2.93:1 on white.
6. **Tier A components preserve tag and ARIA role.** A Tier A swap that changes either is out of spec — that is what makes Tier A cheap.
7. **All 109 `data-testid` values stay on the same control with the same string.** Wrapping is allowed; renaming is not.
8. **The registration-card print path keeps working.** `.reg-card` clipped on screen, visible in print; chrome hidden in print (§11).
9. **No new `export class`.** ui-kit components are functions. `CLASS_DENYLIST` unchanged.
10. **Heads frozen** per §1.1. `pnpm generate:ddl` is a no-op diff.
11. **`@hospai/ui-kit` may be imported from `modules/**/src/ui/**` only** — never from `domain/` or `application/`.
12. **`@hospai/ui-kit` declares React as a peer dependency** and pulls no `@hospai` runtime package, no router, and no query client.
13. **ui-kit contains no data fetching.** `no-fetch-in-components` already covers it.
14. **ui-kit builds with `tsc`.** No bundler is introduced. It therefore ships **plain global CSS**, not CSS Modules (§7.2).
15. **No dark-mode tokens; no shadow/pulse/ping ornament.** P0-3's restraint holds.
16. **Batch 0 changes no `.tsx` except the two structural passes named in §9**, and those touch container roots and table wrappers only.
17. **ui-kit components accept neither `className` nor `style`** (§7.3). This is the invariant that keeps the other sixteen enforceable: an open class prop makes every rule above advisory.
18. **`/dev/ui` is dev-only and never in nav.** Guarded by `import.meta.env.DEV`, absent from the production bundle, absent from `NAV_ENTRIES` and `ALL_NAV`, and never on the demo happy path.

---

## 3. Decision 1 — Tailwind stays out (normative)

§16.4 decision: *"whether Tailwind enters the platform at all."* **Locked: no. Permanently, not "not yet."**

### 3.1 Why

Three properties of this repo, none of them present in a typical Tailwind adoption:

1. **The colour gate reads `.css`.** Tailwind moves colour decisions into `.tsx` class strings the gate never opens. Keeping CSS in CSS means `scripts/web-pms-colors-check.mjs` keeps working with a one-line change to its walk root, instead of needing a whole second scanner for arbitrary-value utilities. The gate is the reason the palette is trustworthy; the styling system should not be the thing that blinds it.
2. **`modules/pms/housekeeping` builds with `tsc` and has no bundler.** A Tailwind adoption would make that package's rendering depend on the *app's* content scanner reaching into it via `@source` directives — with the failure mode that it renders correctly in a dev server and unstyled in a production build.
3. **The palette is already landed and gated.** Tailwind's main draw here would have been its theme layer, and P0-3 built that in plain custom properties, contrast-proved.

### 3.2 What that costs, stated plainly

**shadcn/ui cannot be used.** It is Tailwind-expressed source; without Tailwind there is nothing to copy in. This chunk borrows shadcn's *component vocabulary and API shapes* — `Button` with intent variants, `Card` with `Header`/`Content`/`Footer`, `Table` with subcomponents, `asChild`-style composition where it earns itself — and writes the implementations here. Anyone reading this later should be clear: **`npx shadcn add` will not work in this repo, by design.** Do not file that as a gap.

What is genuinely lost: the CLI, upstream component diffs, and the ecosystem's accumulated edge-case handling. What is kept: the component boundary, the variant model, and the consistency — which is the actual requirement.

### 3.3 Wiring

| Concern | Decision |
|---|---|
| ui-kit build | `tsc -p tsconfig.json`, matching every other package |
| ui-kit styling | One plain `ui-kit.css` with global, prefixed class names (`.ui-btn`, `.ui-btn--primary`, `.ui-field`). No CSS Modules — `tsc` does not process them (invariant 14). |
| App wiring | `apps/web-pms/src/styles.css` gains `@import '@hospai/ui-kit/styles.css';` **after** `tokens.css` so ui-kit rules resolve `var(--...)` against tokens already declared. |
| Class composition | `clsx` for conditional joining. `class-variance-authority` is **optional** — it works with plain class names, but a small variant→class map is usually clearer here. Plan author's call; do not add both. |
| Tokens consumed | ui-kit CSS reads the existing semantic aliases (`--ink`, `--panel`, `--line`, `--primary`, `--muted`, `--radius`, `--action-*`, `--status-*`). It declares **no** colour of its own. |
| Deps added | `packages/ui-kit`: `clsx` (+ `@radix-ui/*` only per §6.2 admission). `apps/web-pms`: `@hospai/ui-kit`. Nothing else. |

**Radix remains available.** Radix primitives are headless behaviour with no styling opinion and no Tailwind dependency — dropping Tailwind does not drop Radix. §6.2 governs their admission on behavioural grounds alone.

---

## 4. Decision 2 — the token layer is already right (normative)

§16.4 decision: *"whether to adopt the prototype palette or re-skin existing token values."* **Locked: neither — P0-3 already did it.**

Rev 1 proposed a shadcn-shaped alias layer (`--background`, `--foreground`, `--primary-foreground`, …) over the existing primitives. **Deleted.** Without Tailwind there is nothing that needs those names, and a second alias layer over `--ink` / `--panel` / `--line` / `--primary` would be pure ceremony — one more indirection between a component and the hex it resolves to.

`tokens.css` is unchanged by this chunk. The layering stays:

```
--color-*     primitives, the ONLY place literals live
  ↓ var()
--ink, --panel, --line, --primary, --muted,
--radius, --action-*, --status-*                    semantic aliases
  ↓ var()
ui-kit.css + styles.css                             components and chrome
```

What this chunk adds is **proof**, not names. These pairs are used by batch 0 and ui-kit and are currently unproved by the gate (rule 2 covers `--status-*` only):

| Foreground | Surface | Contrast |
|---|---|---|
| `--ink` `#2D2926` | `--bg` `#F9F8F4` | 13.57:1 |
| `--ink` `#2D2926` | `--panel` `#ffffff` | 14.42:1 |
| `--muted` `#575245` | `--bg` `#F9F8F4` | 7.32:1 |
| `--muted` `#575245` | `--panel` `#ffffff` | 7.78:1 |
| `--muted` `#575245` | `--selected` `#F1EFE9` | 6.77:1 |
| `--primary` `#4A5D4E` | `--selected` `#F1EFE9` | 6.16:1 |
| `--primary` `#4A5D4E` | `--bg` `#F9F8F4` | 6.66:1 |
| `--action-primary-fg` `#ffffff` | `--action-primary-surface` `#4A5D4E` | 7.08:1 |
| `--action-destructive-fg` `#ffffff` | `--action-destructive-surface` `#9b1c1c` | 8.15:1 |

All clear AA; most clear AAA. Tan `#C18C5D` on white is **2.93:1** — fill-only, invariant 5.

---

## 5. Colour-gate extension (normative)

Much smaller than rev 1, because colour never leaves `.css`.

### 5.1 Widen the walk

The gate walks `apps/web-pms/**/*.css`. Add `packages/ui-kit/**/*.css`. Rule 1 then covers ui-kit for free: any literal there must sit on a `--color-*` property, and ui-kit declares no colours (§3.3), so in practice the rule proves ui-kit stays token-driven.

### 5.2 Prove the chrome and action pairs

Rule 2 checks `--status-*-fg` / `-surface` only. Add an explicit pair table for the nine rows in §4, each ≥ 4.5:1. This is the rule that stops a future "just make the muted text a bit lighter" from shipping.

### 5.3 Optional hardening

`FUNC_RE` recognises `rgb|rgba|hsl|hsla` but not `oklch|oklab|lab|lch|color-mix`, so a literal in a modern colour space would pass rule 1 unseen. Nothing in the tree emits one today and nothing in this chunk will. Fix it if it is free; it is not a batch-0 blocker. (Rev 1 rated this urgent because Tailwind would have introduced `oklch` defaults. It no longer applies.)

**Deleted from rev 1:** `.tsx` scanning for arbitrary-value colour utilities. There are no utilities.

---

## 6. Component tiers (normative)

Tier is decided by one question: **does adopting it change the DOM the tests query?**

### 6.1 Tier A — presentational, DOM-preserving (adopt everywhere)

| Component | Replaces | Sites | Note |
|---|---|---|---|
| `Button` | `<button>` | 91 | Intents `default` / `primary` / `destructive` / `ghost`, sizes `sm` / `md`, mapped onto `--action-*`. Renders `<button>`. |
| `LinkButton` | `<Link>` acting as an action | ≤43 | Fixes defect 4. Renders `<a>` with button appearance. Navigational links get an affordance rule instead — not every link becomes a button. |
| `Field` | `<label>` + `<input>` pair | ~89 | **The fix for defects 1, 2, 5.** Owns label, control, hint, and error slots so spacing and sizing cannot drift per screen. |
| `Input` | `<input>` | 104 | Explicit `block-size`; normalises `date` / `number` / `search` / `email` against text. |
| `NativeSelect` | `<select>` + `<option>` | 27 / 49 | Styled native `<select>`, matching `Input` metrics. Not Radix — see §6.2. |
| `Checkbox` | `<input type="checkbox">` | 10 | Styled native input. Not Radix. |
| `Textarea` | `<textarea>` | 4 | |
| `Card` (+ `Header`/`Title`/`Content`/`Footer`) | `.panel` | 16 | **The fix for defects 7, 8** — one definition of where the title sits. |
| `DataTable` (+ `Head`/`Body`/`Row`/`Cell`/`HeaderCell`) | `<table>` … | 17 | **The fix for defect 9** — owns the scroll container, sticky header, and `top: 4rem` offset so no screen has to remember it. |
| `Badge` | `.badge`, `.chip` | ~7 | Must keep emitting `status-*`; `src/status/` stays authoritative for severity. |
| `Alert` | `.error` | 32 | Keeps `role="alert"`. Closes the module leak (§7.3). |
| `Stack` | `.stack` | 18 | Or keep `.stack` as a CSS class — reviewer's call (§17.7). Either way it stops being a no-op. |
| `Separator`, `Skeleton` | — | new | Skeleton for query-pending states that currently render bare text. |

### 6.2 Tier B — behavioural Radix (opt-in, per screen, each with its own test budget)

Radix changes the DOM. `Select` renders a trigger with `role="combobox"` and portals its listbox: `userEvent.selectOptions` stops working, and jsdom needs `ResizeObserver`, `scrollIntoView`, and pointer-capture polyfills before Radix will mount.

**Default: do not adopt.** A native `<select>` is better for a front-desk tool — real keyboard behaviour, real mobile pickers, prints correctly. Each admission is a named row in the implementation plan with its jsdom setup and test migration attached.

| Candidate | Verdict |
|---|---|
| `Dialog` | Consider for `ExceptionsScreen.tsx:620` (native `<dialog open>`) and the two `role="dialog"` panels in GuestProfile / Settings. Weigh against §11 — portals escape the print rules. |
| `Popover` / `Command` | Consider for the rail's `ReservationSearch`. Testids `reservation-search` and `reservation-search-results` must survive. |
| `Select`, `Checkbox`, `RadioGroup`, `Switch` | **Rejected.** Tier A native equivalents. |
| `DropdownMenu`, `Tooltip`, `Sheet`, `Tabs` | Not admitted. No screen needs them today. |

### 6.3 Never adopt

`Form` (react-hook-form + zod — a state-management change wearing a component's clothes), toast libraries (queued-commands and exceptions panels are the established feedback surface), chart libraries (out of scope), `Calendar`/react-day-picker (dates are native inputs; `temporal-utils` owns date semantics).

---

## 7. Decision 3 — `packages/ui-kit` becomes a package (normative)

§16.4 decision: *"whether `ui-kit` becomes a package or stays inside `apps/web-pms` until a second consumer exists."* **Locked: package.** The second consumer already exists.

### 7.1 Why now

`modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` is 479 lines of React that renders inside web-pms, declares no dependency on it, and reaches into its global stylesheet for `className="error"`. That is the second consumer, held together by a class name nothing checks. Keeping components app-local leaves that module as the one screen that does not match — the outcome this slice exists to prevent.

### 7.2 Shape

| | |
|---|---|
| Name | `@hospai/ui-kit`, `private: true`, `packages/ui-kit` (already in the §11 layout) |
| Build | `tsc -p tsconfig.json` |
| Exports | `.` → Tier A components; `./styles.css` → the stylesheet |
| Deps | `clsx` (+ `@radix-ui/*` per admitted primitive) |
| Peer deps | `react ^19`, `react-dom ^19` — mirrors the housekeeping module |
| Ships | `.js`, `.d.ts`, and one plain `ui-kit.css`. Global prefixed class names (invariant 14). |
| Tests | Vitest + jsdom, colocated |

**Honest limitation:** because the CSS is global and imported once by the app, the module still depends on the app having imported it. That is strictly better than today — the dependency is an explicit package export with a versioned name rather than a class string that happens to match a rule in another package — but it is not full encapsulation. Full encapsulation needs a bundler in ui-kit, which invariant 14 declines. Revisit only if a second *app* appears.

### 7.3 Component API constraints (normative)

Mature systems hold the line with enforcement, not documentation — Atlassian ships an eslint plugin that bans raw values, Shopify ships `stylelint-polaris`. The cheapest enforcement is an API that cannot express the wrong thing. Four rules, in leverage order:

**1. No `className`. No `style`.** Not on any ui-kit component, not "just for layout." This is invariant 17 and it is the one that matters: an open class prop means someone needs a 4px nudge, passes a class, and there are two systems again inside a month. shadcn and Radix expose `className` because they are distributed to strangers who must adapt them; ui-kit has two known consumers in one repo and does not have that problem.

**The escape hatch is a variant, not a class.** If a screen needs something the component cannot express, that is a signal to add a variant to the component — a change the system owner reviews once — rather than a local override nobody sees. If a genuine one-off is unavoidable, the wrapper element around the component is the screen's own, and layout classes belong there.

**2. Variants are closed union types.** `intent: 'default' | 'primary' | 'destructive'`, `size: 'sm' | 'md'`. Not `string`, not an open record. TypeScript then refuses the invalid state at the call site, which is faster feedback than lint and far faster than review. No component takes more than two variant axes; a third is a signal that two components are hiding inside one.

**3. Composition over configuration where a slot is the honest answer.** `Card` takes `Header` / `Content` / `Footer` children rather than a `title` string plus fifteen booleans. `Field` takes label, hint, and error as props because those have exactly one correct arrangement and the point is that screens cannot rearrange them.

**4. Pass-through is explicit and narrow.** Components forward `data-testid`, `aria-*`, `id`, `name`, `disabled`, `ref`, and the relevant native handlers — enumerated, not a blanket `...rest` spread. A blanket spread re-opens `className` through the back door.

**Why this is not over-restriction:** the entire failure mode this chunk exists to prevent is 29 screens each improvising. §1.2 defect 8 — the page title inside the container on 7 screens and outside on 8 — is what "everyone can override the container" produces over a year. The constraint is the deliverable.

### 7.4 The leak closes

`HousekeepingApp.tsx` imports `Alert` from `@hospai/ui-kit` and drops both `className="error"` sites.

---

## 8. Enforcement — `hospai/no-raw-controls-in-web-pms` (normative)

Batches 0–6 produce consistency once. This is what keeps it. The repo already governs itself this way: 12 `check:*` scripts and 10 merge-blocking lint rules. `no-inline-styles-in-web-pms` is the exact precedent — same file-path predicate, same message shape, same registration.

| | |
|---|---|
| Fires on | `apps/web-pms/src/**/*.tsx` and `modules/**/src/ui/**/*.tsx` |
| Forbids | JSX intrinsic `button`, `input`, `select`, `textarea`, `table`, `th`, `td`, `tr`, `thead`, `tbody` |
| Allows | Anything inside `packages/ui-kit/` (where the primitives are defined) |
| Allows | `<option>` in a `NativeSelect` child position; `<form>`, `<fieldset>`, `<details>`, `<summary>`, `<dialog>` — structural, not styled controls |
| Message | ``Use <Button> from @hospai/ui-kit, not a raw <button>.`` |
| Rollout | `warn` in batch 1, `error` in batch 7. **It must not merge as `warn` permanently.** |

Add the rule to the `rules` map, to `configs.recommended`, and give it a test file, per the existing 10.

---

## 9. Migration order (normative — one PR per batch)

| # | Batch | Contents | Risk |
|---|---|---|---|
| **0a** | **Control repair (CSS only)** | Defects 1–7: font inheritance + explicit `block-size` on `input`/`select`/`textarea`/`button`; button appearance + primary variant; link affordance; `:focus-visible`; `:disabled`; define `stack`, `board-title`, `staff-roster`, `exceptions-workbench`; `border-radius: var(--radius)` on `.panel`. | **No `.tsx` touched. No test can break.** Gate green — all values are existing `var(--…)`. |
| **0b** | **Container + table passes (markup)** | Defect 8: pick the rule — title **inside** the Card — and apply to the 8 screens that place it outside, plus `ShiftScreen` which has no container. Defect 9: wrap each `<table>` in a scroll container **inside** the panel; sticky `thead` at `top: 4rem`, z-index < 30. | Roots and table wrappers only. Snapshot-free tests unaffected; verify the 44 test files still pass unmodified. |
| 1 | Foundation | `packages/ui-kit` + Tier A components (§7.3 API) + §5 gate extension + §8 rule at `warn` + `check:ui-kit-adoption` ratchet (§9.1) + dev-only `/dev/ui` gallery (§9.2) | No screen changes. Gates green on an unchanged UI. |
| 2 | Shell | `AppShell`, `ShiftStrip`, `QueuedCommandsPanel`, `ExceptionsPanel`, `StaleWatermark`, `FrontOfficeLive` | Highest blast radius, smallest surface — stabilise early. |
| 3 | Read screens | Board, Tape chart, Reservations directory, Guests directory, Guest profile, board-summary, guest-row | Mostly `DataTable` / `Badge` / `Card`. |
| 4 | Form screens | Booking, Check-in, Settings, Inventory, Rates, Staff, Roster, front-office-editor | The bulk of 104 inputs / 27 selects — `Field` does the work. |
| 5 | Folio | `FolioScreen.tsx` alone | 1,414 LOC source / 1,123 LOC tests. Its own PR or it swallows another batch. |
| 6 | Operator screens | Night audit, Exceptions (incl. the `<dialog>` decision), Shift | |
| 7 | Module + cleanup | `HousekeepingApp.tsx`; delete superseded rules from `styles.css`; §8 rule → `error`; ARCHITECTURE §16.4 rewrite; DEMO-READY P2 rows ticked | |

Batch 0 is independently valuable and independently shippable: if batches 1–7 never run, the UI still coheres. Batches 3–6 are independently revertable — if the slice stops early, it stops at a batch boundary with a coherent UI, not mid-screen.

**Batch 0 supersedes itself.** The CSS written in 0a for bare `input` / `button` / `table` selectors is deliberately throwaway — batch 1 re-homes it into ui-kit, and batch 7 deletes the originals. Write it as element selectors, not as a parallel class system, so the deletion is mechanical.

### 9.1 `check:ui-kit-adoption` — the ratchet (normative)

A seven-batch migration has one predictable failure: batches 2–6 convert screens while new work adds raw controls behind them, and the finish line moves. Mature systems track adoption as a number; this repo already has 12 `check:*` scripts, so the number belongs in CI rather than in a dashboard nobody opens.

| | |
|---|---|
| Counts | Raw JSX intrinsics in scope for §8 (`button`, `input`, `select`, `textarea`, `table`, `th`, `td`, `tr`, `thead`, `tbody`) across `apps/web-pms/src/**/*.tsx` and `modules/**/src/ui/**/*.tsx`, excluding tests and `packages/ui-kit` |
| Baseline | Committed to a checked-in file at batch 1 from the §1.1 census |
| Fails when | The count **goes up** |
| Passes when | The count stays equal or falls; a fall requires updating the baseline in the same PR |
| Retires | Batch 7, when §8 flips to `error` and the count reaches its floor (structural `<option>` / `<form>` sites remain legal) |

This is what lets batches 2–6 land incrementally instead of big-bang, and it works from batch 1 — well before the lint rule can be an error. The lint rule says "don't write this"; the ratchet says "and the total may not grow while we migrate."

### 9.2 `/dev/ui` — the gallery (normative)

Every component, every variant, every state (default / hover-equivalent / focus / disabled / error), on one page. It costs an afternoon, needs no new tooling, and catches "these two buttons don't match" immediately — which is the failure this whole chunk is about.

- **Dev-only.** Guarded by `import.meta.env.DEV`; absent from the production bundle (invariant 18).
- **Outside `AppShell`.** Mounted as a sibling route, not a child, so the gallery renders with no `/me` authority and no PropertyDO dependency. It must work when the API is down.
- **Not in nav.** Absent from `NAV_ENTRIES` and `ALL_NAV` — P0-3's nav-order test asserts that list exactly, and DEMO-READY forbids stray routes on the happy path.
- **Not a docs site.** No prose, no props tables, no MDX. A visual index only.

Storybook remains deferred (§15 row 10). Revisit when the component count or the number of consumers makes a per-component workshop worth its configuration cost; at ~12 components it is not.

---

## 10. DOM and `data-testid` contract (normative)

1. All **109** existing `data-testid` values stay on the same control, same string.
2. Tier A components forward `data-testid`, `aria-*`, `id`, `name`, `disabled`, and `ref` to the underlying element. A component that swallows `data-testid` is a defect.
3. Tier A does not change tag or role (invariant 6).
4. `Badge` keeps emitting the `status-*` class for its rung.
5. Any Tier B adoption lists, in its PR, every testid whose host node changes and every test that moves with it.
6. Batch 0b may move a title *into* a container — that changes nesting, not roles, and `getByRole('heading')` is unaffected.

---

## 11. Print path (normative)

`styles.css` ends with an `@media print` block hiding `aside`, `.app-sidebar`, `.ops-rail`, `.top-bar`, `.shift-strip`, `.side-panels`, `.nav`, and un-clipping `.reg-card`. Two hazards:

1. **Portals escape it.** Radix Dialog/Popover portal to `document.body`, outside `#root` and outside any class-based hide rule. Any Tier B adoption must extend the print block to cover its portal container, and must not be adopted on the check-in → registration-card path at all.
2. **Sticky headers must not print.** Batch 0b's `position: sticky` on `thead` needs a `position: static` override inside `@media print`, or long tables print with the header floating over rows.

`print-reg-card` / `reg-card` behaviour is demo-path critical (P0-3 §9) and is an acceptance test in §16.

---

## 12. Command / HTTP decision (normative)

**None.** SPA and packaging only. No new route, catalog id, permission, DO table, seed change, or `pms-core` change. `V1_HTTP_ROUTE_AUDIT[127]` does not move.

**Rejected:** a `ui-shell` package, tenant theming endpoints, a `/theme` config surface — anything that would put visual identity into the classified config register.

---

## 13. File map (implementation will touch; not a plan)

| Area | Touch | Batch |
|---|---|---|
| `apps/web-pms/src/styles.css` | 0a rules; 0b sticky/scroll + print override; `@import '@hospai/ui-kit/styles.css'` in batch 1; deletions in batch 7 | 0a, 0b, 1, 7 |
| `apps/web-pms/src/screens/*.tsx` | Container roots + table wrappers | 0b |
| `packages/ui-kit/**` | **New package.** §7.2 shape, Tier A components, `ui-kit.css`, tests | 1 |
| `apps/web-pms/package.json` | `@hospai/ui-kit` | 1 |
| `apps/web-pms/src/**/*.tsx` | Tier A swaps | 2–6 |
| `apps/web-pms/src/**/*.test.tsx` | Only where a Tier B adoption moves DOM | 2–6 |
| `modules/pms/housekeeping/package.json` | `@hospai/ui-kit` | 7 |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | Tier A swaps; drop both `className="error"` | 7 |
| `scripts/web-pms-colors-check.mjs` | §5.1 walk root, §5.2 pair table, self-test fixtures | 1 |
| `scripts/ui-kit-adoption-check.mjs` + baseline file | **New ratchet** (§9.1) + `check:ui-kit-adoption` in root `package.json` scripts | 1, ratchets 2–7 |
| `apps/web-pms/src/dev/UiGallery.tsx` + route in `App.tsx` | **New** dev-only gallery (§9.2), outside `AppShell`, `import.meta.env.DEV` guarded | 1 |
| `tooling/eslint-plugin-hospai/src/no-raw-controls-in-web-pms.ts` | **New rule** + test + `rules` map + `configs.recommended` | 1, 7 |
| `ARCHITECTURE.md` §16.4 | Rewrite (§14 row 3) | 7 |
| `DEMO-READY.md` | Tick both P2 rows in the **implementation** PR | 7 |
| Pointer | One sentence in the chrome + skin spec when this lands | 7 |

**`apps/web-pms/src/styles/tokens.css` is not touched.** No `v1-http-routes.ts`, no `COMMAND_CATALOG`, no migration, no `demo-seed.ts`, no `pms-core`, no `vite.config.ts`.

---

## 14. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | §16.4 decision "whether Tailwind enters the platform at all" — answered **no**, with reasons (§3) | ARCHITECTURE §16.4 |
| 2 | §16.4 decision "whether `ui-kit` becomes a package" — answered **yes** | §16.4; DEMO-READY P2 |
| 3 | §16.4 rewrite — record palette adoption; the comparison table is **stale** (still describes cool greys and `#1a4a6e`, which P0-3 replaced) and "visual divergence is expected" is no longer true | DEMO-READY P2; P0-3 §15 lock 10 |
| 4 | `packages/ui-kit` extraction | DEMO-READY P2 |
| 5 | Housekeeping module's `className="error"` cross-boundary leak | Found by this spec |
| 6 | Defects 1–9 (§1.2) | Found by this spec |

## 15. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **P0-4** Clerk / real `/sign-in` | Blocks batches 1–7 by sequencing (§2.0) |
| 2 | **P0-5** script, dry runs, kill list | Same |
| 3 | **P1** guest CRM depth; card last-4 / brand; one hotel voice; lab-copy scan | Unchanged |
| 4 | `packages/ui-shell` (§11) | `module-ui-registry.ts` stays in the app |
| 5 | Dark theme | Invariant 15 |
| 6 | Tape-chart visual rebuild; prototype popups, billing app, Dashboard Hub, recharts | DEMO-READY out of scope |
| 7 | `lucide-react`, `motion` | `icons.tsx` stays |
| 8 | Tenant/brand theming, second theme, theme switcher | Single visual system |
| 9 | react-hook-form + zod | §6.3 |
| 10 | Storybook / visual regression (Chromatic, Percy) | `/dev/ui` (§9.2) is the interim at a fraction of the cost. Revisit when component count or consumer count justifies per-component stories. |
| 10a | Token generation (Style Dictionary) and Figma variable sync | Hand-written CSS is correct at one target platform. Revisit at a second platform or when Figma becomes a source of truth rather than a reference (§16.4). |
| 10b | Component maturity labels (alpha/beta/stable), codemods for breaking changes | Both are artifacts of many external consumers. Two in-repo consumers do not need them. |
| 11 | A bundler for ui-kit / CSS Modules encapsulation | Invariant 14; revisit on a second app (§7.2) |
| 12 | Any palette change | Invariant 3 |

---

## 16. Tests (acceptance-shaped)

**Pins**

1. `COMMAND_CATALOG` **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`.
2. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `pnpm generate:ddl` no-op. `CLASS_DENYLIST` unchanged.
3. **Batch 0a changes no `.tsx`** — assert by diff review, and all 44 web-pms test files pass unmodified.
4. Batches 0b–4 pass every existing test unmodified, except tests attached to a Tier B adoption named in that batch's PR.

**Batch 0 (defect closure)**

5. Every class referenced in a `className` across `apps/web-pms/src` and `modules/**/src/ui` resolves to a rule in `styles.css`, `tokens.css`, or `ui-kit.css`. Assert as a script, not by eye — this is the regression test for defect 6 and it stays useful forever.
6. `input`, `select`, `textarea`, and `button` all declare `font` and an explicit block size.
7. A `:focus-visible` rule and a `:disabled` rule exist.
8. `.panel` declares `border-radius`.
9. Every `<table>` in `apps/web-pms/src` has a scrolling ancestor; `thead th` is sticky at `top: 4rem` with z-index < 30; `@media print` resets it to `static`.
10. Every screen root renders its `<h1>` inside the container (defect 8), `ShiftScreen` included.

**Gate (§5)**

11. `pnpm check:web-pms-colors` green with `packages/ui-kit` in the walk.
12. All nine §4 pairs ≥ 4.5:1, asserted by the script.
13. No `.css` under `apps/web-pms` or `packages/ui-kit` introduces a hex not already in `tokens.css`.
14. Self-test: a literal on a non-`--color-*` property in `ui-kit.css` fails.

**Lint (§8)**

15. Reports on a raw `<button>` in `apps/web-pms/src/screens/*.tsx`.
16. Does **not** report inside `packages/ui-kit/`.
17. Reports in `modules/pms/housekeeping/src/ui/`.
18. `error` in `configs.recommended` after batch 7; `pnpm lint` green.

**ui-kit (§7)**

19. `Button` forwards `data-testid`, `disabled`, `aria-*`, `ref` to the `<button>`; renders `<button>`.
20. `NativeSelect` renders `<select>`; `userEvent.selectOptions` works; `getByRole('combobox')` resolves to the `<select>`.
21. `Checkbox` renders `<input type="checkbox">`; `getByRole('checkbox')` is an input, not a button.
22. `Field` associates label and control (`getByLabelText` resolves) and renders one consistent height across `text`, `date`, `number`, and `select`.
23. `DataTable` renders `<table>`; header is sticky; the scroll container is inside the card.
24. `Badge` with rung `exception` emits `status-exception`. `Alert` keeps `role="alert"`.
25. ui-kit imports no `@hospai/*` runtime package, no router, no query client; ships no colour literal.

**API constraints (§7.3)**

26. **No exported ui-kit component accepts `className` or `style`** — assert against the public type surface, so it fails at build time rather than on inspection. This is the test that keeps invariant 17 real.
27. No component spreads `...rest` onto its rendered element; forwarding is the enumerated list in §7.3 rule 4.
28. Every variant prop is a closed union — passing an unlisted value is a type error.
29. No component takes more than two variant axes.

**Ratchet and gallery (§9.1, §9.2)**

30. `pnpm check:ui-kit-adoption` passes at the committed baseline.
31. Self-test: adding one raw `<button>` to a screen fixture **fails** the ratchet.
32. Self-test: removing one raw control without updating the baseline **fails** (the baseline is a ratchet, not a ceiling).
33. The ratchet excludes tests and `packages/ui-kit`.
34. `/dev/ui` renders every exported component with no `/me` query and no PropertyDO fetch — assert it mounts with all network mocks rejecting.
35. `/dev/ui` is absent from `NAV_ENTRIES` and `ALL_NAV`; P0-3's nav-order assertion is unchanged.
36. A production build contains no `UiGallery` chunk.

**Screens**

37. All **109** `data-testid` values still resolve, on the same control, after batch 7. Assert as a list.
38. `AppShell` boot: nav mounts on PropertyDO `fail_closed`; `exceptions-panel` present; `me-no-access` intact.
39. Search: `reservation-search` + `reservation-search-results` intact; Enter-on-one-hit → `/folio/:id`.
40. Folio: `folio-advanced`, `folio-balance`, tenders, P0-2 first-paint assertions unchanged.
41. Check-in: `check-in`, `override-cleanliness`, `print-reg-card`, `reg-card` intact; `reg-card` still clipped on screen (§11).
42. Night audit: step wire names `PRE_CHECK` … `ARCHIVE`; `report-table` still formats money.
43. Housekeeping module tests green with ui-kit imports; no `className="error"` remains in the tree.

**Forbidden**

44. No `tailwindcss`, `@tailwindcss/*`, or `shadcn` dependency in any `package.json` in the repo.
45. No `.dark` block and no `prefers-color-scheme: dark` in any scanned CSS.
46. No `lucide-react`, `motion`, `recharts`, `react-hook-form`, or `zod` in any `package.json` touched by this chunk.
47. No Storybook dependency (`@storybook/*`) — deferred, §15 row 10.

---

## 17. Open questions (locked unless noted)

1. **Does Tailwind enter the platform?** **Locked: no, permanently** (§3). Consequence recorded honestly: shadcn/ui is not installable here (§3.2).
2. **Palette source?** **Locked: unchanged.** P0-3 landed it. No new hex.
3. **A shadcn-shaped alias layer over the tokens?** **Locked: no** — deleted from rev 1 as ceremony (§4).
4. **`ui-kit` package or app-local?** **Locked: package.** Second consumer exists (§7.1).
5. **Radix `Select` / `Checkbox`?** **Locked: no.** Native, styled (§6.1).
6. **Title inside or outside the container?** **Locked: inside** (§9 batch 0b). Chosen because it is the majority of the screens that already have a coherent answer and it makes `Card` own the page header.
7. **`Stack` as a component or `.stack` as a CSS class?** **Open — reviewer's call.** Batch 0a defines the class either way; batch 1 decides whether it also becomes a component. Note the interaction with §7.3: if `Stack` is a component it takes a closed `gap` union, not arbitrary spacing.
8. **`cva` or a plain variant map?** **Open — plan author's call.** Do not add both (§3.3). Either satisfies §7.3 rule 2 as long as the variant type stays a closed union.
8a. **Does ui-kit expose `className`?** **Locked: no** (§7.3 rule 1, invariant 17). The escape hatch is adding a variant. This is the highest-leverage constraint in the chunk and the one most likely to be argued down during implementation — if it is relaxed, §8's lint rule and §9.1's ratchet both degrade to advisory.
8b. **Adoption ratchet in CI?** **Locked: yes, batch 1** (§9.1). It works before the lint rule can be `error`, which is what makes an incremental seven-batch migration safe.
8c. **Storybook now?** **Locked: no** — `/dev/ui` instead (§9.2), Storybook deferred (§15 row 10). At ~12 components a gallery route buys most of the value for an afternoon of work.
8d. **Where does `/dev/ui` mount?** **Locked: outside `AppShell`, dev-only, not in nav** (§9.2, invariant 18). Inside the shell it would need `/me` authority and would break when the API is down — precisely when a component gallery is most useful.
9. **`Dialog` for `ExceptionsScreen` / the two `role="dialog"` panels?** **Open — plan author decides**, against §11. Native works today; burden of proof is on changing it.
10. **`Command`/`Popover` for the rail search?** **Open — plan author decides.** Testids must survive.
11. **Tan `#C18C5D` as anything but a fill?** **Locked: no.** 2.93:1 (invariant 5).
12. **Dark theme?** **Locked: out.**
13. **Does batch 0 ship before the demo?** **Locked: yes** (§2.0). Batches 1–7 wait for P0-4 / P0-5.
14. **ARCHITECTURE §16.4 rewrite?** **Locked: in this chunk**, batch 7.
15. **Worker / schema / seed?** **Locked: unchanged heads** (§12).

---

## 18. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Batch 0a lands with **zero** `.tsx` diffs and all 44 test files green, unmodified.
- [ ] Batch 0b applies one container rule to all 15 screens with a title, `ShiftScreen` included, and wraps all 17 tables. Print override for sticky headers verified (§11).
- [ ] Batch 1 lands ui-kit + gate + lint rule at `warn` + ratchet + `/dev/ui` with **zero** screen diffs.
- [ ] The §7.3 API is enforced by the type surface, not by convention — no `className`, no `style`, no blanket `...rest`, closed variant unions (§16.26–29).
- [ ] `check:ui-kit-adoption` baseline committed in batch 1; every batch 2–7 PR lowers it and updates it in the same commit.
- [ ] `/dev/ui` mounts with all network mocks rejecting and is absent from the production bundle.
- [ ] §4's nine pairs proved by the script, not by hand. No hex outside `tokens.css`.
- [ ] Tier A only in batches 2–6. Each Tier B admission is its own named row with jsdom setup and test migration attached.
- [ ] All 109 testids asserted as a list after batch 7.
- [ ] The class-resolution test (§16.5) lands in batch 0a and stays.
- [ ] Batch 7: module migrated, dead CSS deleted, rule → `error`, §16.4 rewritten, DEMO-READY P2 ticked.
- [ ] Heads §1.1 unchanged throughout.
- [ ] Stop. Do not start P0-4 / P0-5. Do not add Tailwind, shadcn, `ui-shell`, dark theme, or a chart library. Do not commit in the spec-authoring turn.

---

## 19. Reviewer checklist

- [ ] Verified-current-state §1.1 matches the tree (38 non-test `.tsx` / 9,053 LOC; 44 test files / 7,141 LOC; 89 `<button>` / 100 `<input>` / 21 `<select>` / 16 `<table>` / 1 `<dialog>`; 43 `<Link>`; 479-LOC housekeeping UI with two `className="error"`; 109 testids; 545-line `styles.css`; no `packages/ui-kit`; catalog **77**, route **127**, heads **25** / **7**).
- [ ] **Defect table §1.2 is reproducible** — each row names a file, a line, or a census. Spot-check defect 6 (`.stack` undefined, 18 sites), defect 7 (`.panel` has no radius), defect 8 (7 titles inside / 8 outside / ShiftScreen none).
- [ ] Batch 0 is genuinely test-safe: 0a touches no `.tsx`; 0b touches roots and table wrappers only.
- [ ] The `top: 4rem` sticky-header constraint against `.ops-rail` (`top: 0`, `z-index: 30`) is stated, and the print override is required.
- [ ] All three §16.4 decisions explicitly locked; §3.2 states plainly that shadcn/ui becomes uninstallable, so nobody files it as a gap later.
- [ ] Rev-1 deletions are justified, not merely dropped: the shadcn alias layer (§4), the `.tsx` colour scanner (§5.3), and the Tailwind build wiring.
- [ ] Tier A / Tier B split justified by DOM preservation; Radix `Select` and `Checkbox` rejected with reasons; Radix confirmed still available despite no Tailwind (§3.3).
- [ ] `packages/ui-kit` justified by an existing second consumer; the `ui/` → ui-kit import confirmed not to trip `no-platform-import-in-domain`; the global-CSS limitation stated honestly (§7.2).
- [ ] Enforcement rule §8 modelled on `no-inline-styles-in-web-pms`, with a `warn` → `error` schedule that ends at `error`.
- [ ] **§7.3 is present and closed**: no `className`, no `style`, no blanket `...rest`, closed variant unions, ≤2 variant axes — and the escape hatch is named as "add a variant," not "pass a class." Confirm invariant 17 states why relaxing it degrades §8 and §9.1 to advisory.
- [ ] `check:ui-kit-adoption` (§9.1) fails on an **increase**, has a committed baseline, excludes tests and ui-kit, and retires at batch 7. Confirm it works before §8 can be `error` — that is its whole purpose.
- [ ] `/dev/ui` (§9.2) is dev-only, outside `AppShell`, not in `NAV_ENTRIES`/`ALL_NAV`, not a docs site, and renders with the API down. Storybook and visual regression deferred with a stated revisit trigger (§15 row 10).
- [ ] §15 rows 10a / 10b record the mature-system machinery deliberately **not** adopted (token generation / Figma sync; maturity labels / codemods) with the scale reason, so a later reader sees a decision rather than an oversight.
- [ ] Migration batches independently revertable; batch 0 independently valuable; Folio alone in its batch.
- [ ] Scope-out names Tailwind, shadcn, P0-4, P0-5, P1, `ui-shell`, dark theme, palette change, lucide/motion/recharts, react-hook-form, Storybook, tenant theming, Worker/schema/seed.
- [ ] Folded §14 and deferred §15 leftovers both present; acceptance tests §16 and this checklist present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn.
