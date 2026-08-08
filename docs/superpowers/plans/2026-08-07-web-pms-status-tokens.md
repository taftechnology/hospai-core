# web-pms Status Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a five-rung status + action-intent token system to `web-pms`, pure total severity mappers with canaries, apply them on the front-desk board, and enforce colour literals + WCAG AA contrast via `check:web-pms-colors` plus `no-inline-styles-in-web-pms`.

**Architecture:** Primitives (`--color-*`) and semantic aliases live in `apps/web-pms/src/styles/tokens.css`. Domain→severity mappers live in `apps/web-pms/src/status/` (not `client-core`). `RESERVATION_STATUSES` lands in `@hospai/contracts` with a CHECK sync test in do-runtime. Property timezone for overstay comes from non-blocking `getProperty` in client-core; shell boot never awaits PropertyDO.

**Tech Stack:** TypeScript, React 19, TanStack Query 5, vitest (+ jsdom/RTL for one shell render test), `eslint-plugin-hospai`, Node colour-check script.

**Spec:** [`docs/superpowers/specs/2026-08-07-web-pms-status-tokens-design.md`](../specs/2026-08-07-web-pms-status-tokens-design.md)

## Global Constraints

- **Mappers in `web-pms` only** — never `@hospai/client-core`.
- **Colour literals** only on CSS custom properties whose name starts with `--color-`.
- **Borders** via `color-mix(…, var(--status-*-fg), var(--color-surface-base))` — never named `white`.
- **FG contrast** ≥ 4.5:1 vs paired `-surface` and vs panel surface (`--color-surface-base`).
- **Neutral CSS** sets nothing (not `transparent`) — preserves `td` separator borders.
- **Emit `status-${severity}` always**, including `status-neutral` — do not “complete the set” with chrome.
- **No silent status default** — exhaustive over `RESERVATION_STATUSES`.
- **Departures + `confirmed` → `attention`** (PROCESS_NO_SHOWS stub).
- **Departed on board → `neutral`** — never fake `settled`.
- **Boot path ⊀ PropertyDO** — timezone fetch non-blocking; overstay omitted until TZ arrives.
- **Destructive / settled-on-board / folio aliases** — defined or paper-only; unexercised as claimed.
- **TDD** for mappers, colour check, CHECK sync, ESLint rule; commit after each task.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Hex/`white` on `--status-*` or `--ink` | `check:web-pms-colors` |
| Lighten `--status-attention-fg` below 4.5:1 | contrast arm of same check |
| Add `transparent` border on `.status-neutral` | visual/separator + spec review (no canary) |
| Silent `default: 'neutral'` in board mapper | compile + totality vitest |
| Omit departures+`confirmed` | totality vitest / exhaustiveness |
| Map departed → `settled` | mapper canary |
| Await `getProperty` before shell mount | boot-path render test |
| Put severity mapper in client-core | package review / this plan |
| Inline `style={{ margin: … }}` in web-pms TSX | `no-inline-styles-in-web-pms` |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/reservation-status.ts` | Closed `RESERVATION_STATUSES` + type |
| `packages/contracts/package.json` | Export `./reservation-status` |
| `packages/do-runtime/src/reservation-status-sync.test.ts` | CHECK ↔ union sync |
| `scripts/web-pms-colors-check.mjs` | Literal allowlist + WCAG AA |
| `apps/web-pms/src/styles/tokens.css` | Primitives + status/action semantics |
| `apps/web-pms/src/styles.css` | Layout; import tokens; status utilities; chrome aliases |
| `tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.ts` | Ban non-custom-property inline styles |
| `apps/web-pms/src/status/types.ts` | `StatusSeverity`, `ActionIntent` |
| `apps/web-pms/src/status/guest-severity.ts` | `guestSeverity` |
| `apps/web-pms/src/status/board-row-severity.ts` | `boardRowSeverity` |
| `apps/web-pms/src/status/exception-badge-severity.ts` | `exceptionBadgeSeverity` |
| `apps/web-pms/src/status/property-local-today.ts` | `propertyLocalToday(timeZone)` |
| `apps/web-pms/src/status/status-class.ts` | `statusClass(severity)` → `status-${severity}` |
| `packages/client-core/src/api.ts` | `getProperty`; typed `FrontDeskItem` |
| `apps/web-pms/src/shell/PropertyTimeZone.tsx` | Non-blocking TZ query + context |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Row/cell classes; departures groups; overstay |
| `apps/web-pms/src/screens/ExceptionsPanel.tsx` | Badge severity class |
| `apps/web-pms/src/shell/AppShell.boot.test.tsx` | Boot-path render test |

---

### Task 1: `RESERVATION_STATUSES` + CHECK sync

**Files:**
- Create: `packages/contracts/src/reservation-status.ts`
- Modify: `packages/contracts/src/index.ts` (re-export)
- Modify: `packages/contracts/package.json` (subpath export)
- Modify: `packages/contracts/src/subpath-exports.test.ts`
- Create: `packages/do-runtime/src/reservation-status-sync.test.ts`

**Interfaces:**
- Produces: `RESERVATION_STATUSES`, `ReservationStatus` from `@hospai/contracts/reservation-status`

- [ ] **Step 1: Write the failing sync test**

```ts
// packages/do-runtime/src/reservation-status-sync.test.ts
import { describe, expect, it } from 'vitest';
import { RESERVATION_STATUSES } from '@hospai/contracts/reservation-status';
import { RESERVATION_V8_SQL } from './property-migrations.js';

describe('RESERVATION_STATUSES ↔ SQL CHECK', () => {
  it('every status appears in the v8 CHECK and the set is exact', () => {
    const match = RESERVATION_V8_SQL.match(
      /CHECK \(status IN \(([^)]+)\)\)/,
    );
    expect(match).toBeTruthy();
    const fromSql = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(fromSql).toEqual([...RESERVATION_STATUSES].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hospai/do-runtime test src/reservation-status-sync.test.ts`
Expected: FAIL (module / export missing)

- [ ] **Step 3: Implement contracts module + export**

```ts
// packages/contracts/src/reservation-status.ts
/** Closed reservation status machine — keep in sync with PropertyDO CHECK (v8+). */
export const RESERVATION_STATUSES = [
  'confirmed',
  'cancelled',
  'checked_in',
  'checked_out',
  'no_show',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
```

Add to `package.json` exports:

```json
"./reservation-status": {
  "types": "./dist/reservation-status.d.ts",
  "import": "./dist/reservation-status.js"
}
```

Re-export from `packages/contracts/src/index.ts`. Extend `subpath-exports.test.ts` to assert the new export and that the source has no `zod` / `config/register`.

- [ ] **Step 4: Build contracts and pass sync test**

Run: `pnpm --filter @hospai/contracts build && pnpm --filter @hospai/contracts test && pnpm --filter @hospai/do-runtime test src/reservation-status-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/do-runtime/src/reservation-status-sync.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): closed RESERVATION_STATUSES with CHECK sync

Gives board severity mappers a total union pinned to the PropertyDO
status machine.
EOF
)"
```

---

### Task 2: Colour check script + tokens

**Files:**
- Create: `scripts/web-pms-colors-check.mjs`
- Modify: `package.json` (root) — add `check:web-pms-colors`
- Create: `apps/web-pms/src/styles/tokens.css`
- Modify: `apps/web-pms/src/styles.css` — `@import './styles/tokens.css';`, remove raw hex from chrome, add status utilities, refactor `.error` / `.badge`

**Interfaces:**
- Produces: primitives + `--status-*` / `--action-*` aliases; green `pnpm check:web-pms-colors`

- [ ] **Step 1: Write the check script (fail on current CSS)**

`scripts/web-pms-colors-check.mjs` must:

1. Read all `apps/web-pms/**/*.css`.
2. Find colour literals: `#hex`, `rgb(…)`/`rgba(…)`, `hsl(…)`/`hsla(…)`, and a fixed named-colour list including at least `white`, `black`, `red`, `transparent` is **not** a colour literal for this check (it is still forbidden on `.status-neutral` by convention, not this script).
3. **Allowlist predicate:** a literal is OK only if it appears as the value of a declaration whose property name matches `/^--color-/`.
4. Parse `:root` custom properties; resolve one level of `var(--…)` for contrast.
5. For every property matching `/^--status-.+-fg$/`, compute relative luminance contrast against:
   - the sibling `--status-<rung>-surface`
   - `--color-surface-base` (panel)
   Assert ratio ≥ 4.5.
6. `process.exit(1)` on any failure; print OK summary on success.

Core helpers (include in the script):

```js
function relativeLuminance(hex) {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a, b) {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
```

Wire root script:

```json
"check:web-pms-colors": "node scripts/web-pms-colors-check.mjs"
```

- [ ] **Step 2: Run check against current styles — expect FAIL**

Run: `pnpm check:web-pms-colors`
Expected: FAIL on `#fff5f5` / `#fff` / chrome hexes not on `--color-*` props (and/or missing status fgs).

- [ ] **Step 3: Add `tokens.css` with primitives + semantics**

Use these starting values (adjust only if contrast check demands darker fg):

```css
/* apps/web-pms/src/styles/tokens.css */
:root {
  /* --- primitives (literals allowed only on --color-*) --- */
  --color-ink: #1a1f24;
  --color-muted: #5c6670;
  --color-line: #d5dbe1;
  --color-bg: #f3f5f7;
  --color-surface-base: #ffffff;

  --color-status-settled-fg: #0d5c2e;
  --color-status-settled-surface: #e8f5ee;
  --color-status-informational-fg: #1a4a6e;
  --color-status-informational-surface: #e8f1f8;
  --color-status-attention-fg: #8a5a00;
  --color-status-attention-surface: #fff6e5;
  --color-status-exception-fg: #9b1c1c;
  --color-status-exception-surface: #fff5f5;

  --color-action-primary-fg: #ffffff;
  --color-action-primary-surface: #1a4a6e;
  --color-action-destructive-fg: #ffffff;
  --color-action-destructive-surface: #9b1c1c;

  /* --- chrome aliases (no literals) --- */
  --ink: var(--color-ink);
  --muted: var(--color-muted);
  --line: var(--color-line);
  --bg: var(--color-bg);
  --panel: var(--color-surface-base);
  --danger: var(--color-status-exception-fg);
  --warn: var(--color-status-attention-fg);

  /* --- status semantics --- */
  --status-settled-fg: var(--color-status-settled-fg);
  --status-settled-surface: var(--color-status-settled-surface);
  --status-settled-border: color-mix(
    in srgb,
    var(--status-settled-fg) 35%,
    var(--color-surface-base)
  );
  --status-informational-fg: var(--color-status-informational-fg);
  --status-informational-surface: var(--color-status-informational-surface);
  --status-informational-border: color-mix(
    in srgb,
    var(--status-informational-fg) 35%,
    var(--color-surface-base)
  );
  --status-attention-fg: var(--color-status-attention-fg);
  --status-attention-surface: var(--color-status-attention-surface);
  --status-attention-border: color-mix(
    in srgb,
    var(--status-attention-fg) 35%,
    var(--color-surface-base)
  );
  --status-exception-fg: var(--color-status-exception-fg);
  --status-exception-surface: var(--color-status-exception-surface);
  --status-exception-border: color-mix(
    in srgb,
    var(--status-exception-fg) 35%,
    var(--color-surface-base)
  );

  /* --- action intent (destructive unexercised this slice) --- */
  --action-default-fg: var(--color-ink);
  --action-default-surface: var(--color-surface-base);
  --action-primary-fg: var(--color-action-primary-fg);
  --action-primary-surface: var(--color-action-primary-surface);
  --action-destructive-fg: var(--color-action-destructive-fg);
  --action-destructive-surface: var(--color-action-destructive-surface);
}
```

In `styles.css`:

- `@import './styles/tokens.css';` at top; delete old `:root` hex block (keep `color-scheme` / `font-family` either in tokens or styles).
- `.error` uses exception tokens (no `#fff5f5`):

```css
.error {
  color: var(--status-exception-fg);
  border: 1px solid var(--status-exception-border);
  background: var(--status-exception-surface);
  padding: 0.75rem 1rem;
}
```

- Status utilities — **no `.status-neutral` chrome**:

```css
.status-settled {
  color: var(--status-settled-fg);
  background: var(--status-settled-surface);
  border-color: var(--status-settled-border);
}
.status-informational { /* same pattern */ }
.status-attention { /* same pattern */ }
.status-exception { /* same pattern */ }

/* Intentionally empty — do not add transparent borders (erases td separators). */
.status-neutral {
}
```

- Badge: default muted for count 0; `.badge.status-exception` uses exception surface/fg (text colour from exception fg on surface — ensure contrast; if badge needs light-on-dark, add `--color-badge-on-exception` as a `--color-*` primitive, do not use bare `#fff` on `.badge`).

Suggested badge primitives:

```css
--color-badge-fg-on-exception: #ffffff;
```

```css
.badge {
  display: inline-block;
  min-width: 1.25rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--color-line);
  color: var(--color-ink);
  font-size: 0.8rem;
}
.badge.status-exception {
  background: var(--status-exception-fg);
  color: var(--color-badge-fg-on-exception);
}
```

(If contrast check only covers `--status-*-fg`, still keep badge fg as a `--color-*` literal.)

- [ ] **Step 4: Run colour check — expect PASS**

Run: `pnpm check:web-pms-colors`
Expected: `OK web-pms-colors: …`

Plant mutation: temporarily put `color: white` on `.error` or `#ccc` on `--ink` — check must fail; revert.

- [ ] **Step 5: Commit**

```bash
git add scripts/web-pms-colors-check.mjs package.json apps/web-pms/src/styles.css apps/web-pms/src/styles/tokens.css
git commit -m "$(cat <<'EOF'
feat(web-pms): status tokens with colour and contrast check

Primitives-only literals and WCAG AA fg checks make visual
consistency fail the build instead of drifting by taste.
EOF
)"
```

---

### Task 3: ESLint `no-inline-styles-in-web-pms` + convert inlines

**Files:**
- Create: `tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.ts`
- Create: `tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.test.ts`
- Modify: `tooling/eslint-plugin-hospai/src/index.ts` + `index.test.ts` (10th rule)
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Modify: `apps/web-pms/src/screens/ExceptionsPanel.tsx`
- Modify: `apps/web-pms/src/styles.css` (layout classes for former inlines)

**Interfaces:**
- Produces: merge-blocking rule; zero forbidden inlines in web-pms TSX

- [ ] **Step 1: Write failing rule tests**

Mirror `no-fetch-in-components.test.ts` pattern. Cases:

1. `style={{ margin: 0 }}` in `/apps/web-pms/…/*.tsx` → report
2. `style={{ ['--x' as string]: '1rem' }}` or `style={{ ['--gap']: '1rem' }}` → allow (custom property keys starting with `--`)
3. File outside web-pms → ignore

- [ ] **Step 2: Implement rule**

```ts
// tooling/eslint-plugin-hospai/src/no-inline-styles-in-web-pms.ts
function isWebPmsTsx(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  return f.includes('/apps/web-pms/') && f.endsWith('.tsx');
}

function isCssVarKey(keyNode: { type: string; name?: string; value?: string; expression?: { type: string; value?: string } }): boolean {
  // Identifier name, Literal value, or ['--x'] computed literal — must start with --
  // Reject margin/display/color/etc.
}
```

Flag `JSXAttribute` name `style` whose value is a `JSXExpressionContainer` → `ObjectExpression` with any property whose key is not a custom-property name.

Register in `rules` + `configs.recommended`. Extend `RULE_IDS` in `index.test.ts`.

- [ ] **Step 3: Build plugin; run plugin tests**

Run: `pnpm --filter eslint-plugin-hospai test`
Expected: PASS for new rule; RULE_IDS length 10.

- [ ] **Step 4: Convert the four inlines to classes**

Add to `styles.css`:

```css
.board-header {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
}
.board-title {
  margin: 0;
  text-transform: capitalize;
}
.stack-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}
.exceptions-json {
  white-space: pre-wrap;
  font-size: 0.85rem;
}
```

Replace TSX `style={{…}}` with these classes (CheckInScreen header/row similarly — read file and convert every remaining inline).

- [ ] **Step 5: Lint green**

Run: `pnpm --filter eslint-plugin-hospai build && pnpm lint`
Expected: no `no-inline-styles-in-web-pms` findings under `apps/web-pms`.

- [ ] **Step 6: Commit**

```bash
git add tooling/eslint-plugin-hospai apps/web-pms/src
git commit -m "$(cat <<'EOF'
feat(eslint): ban inline styles in web-pms TSX

Forces layout and colour onto classes/tokens so the colour check
and status utilities remain the single source of visual truth.
EOF
)"
```

---

### Task 4: Severity mappers + property-local today

**Files:**
- Create: `apps/web-pms/src/status/types.ts`
- Create: `apps/web-pms/src/status/status-class.ts`
- Create: `apps/web-pms/src/status/guest-severity.ts`
- Create: `apps/web-pms/src/status/guest-severity.test.ts`
- Create: `apps/web-pms/src/status/board-row-severity.ts`
- Create: `apps/web-pms/src/status/board-row-severity.test.ts`
- Create: `apps/web-pms/src/status/exception-badge-severity.ts`
- Create: `apps/web-pms/src/status/exception-badge-severity.test.ts`
- Create: `apps/web-pms/src/status/property-local-today.ts`
- Create: `apps/web-pms/src/status/property-local-today.test.ts`

**Interfaces:**
- Produces:
  - `type StatusSeverity = 'settled' | 'neutral' | 'informational' | 'attention' | 'exception'`
  - `type ActionIntent = 'default' | 'primary' | 'destructive'`
  - `guestSeverity(state: GuestRowState): StatusSeverity`
  - `boardRowSeverity(input: { mode; status; overstay: boolean }): StatusSeverity`
  - `exceptionBadgeSeverity(count: number): StatusSeverity`
  - `statusClass(s: StatusSeverity): \`status-${StatusSeverity}\``
  - `propertyLocalToday(timeZone: string, now?: Date): string` // YYYY-MM-DD

- [ ] **Step 1: Write failing mapper tests**

`guest-severity.test.ts` — one case per `GuestRowState` kind (table from spec §3.3).

`board-row-severity.test.ts` — table including:

| mode | status | overstay | expected |
|---|---|---|---|
| in-house | checked_in | true | exception |
| departures | checked_in | false | attention |
| departures | checked_out | false | neutral |
| departures | cancelled | false | informational |
| departures | no_show | false | attention |
| departures | confirmed | false | attention |
| arrivals | confirmed | false | neutral |
| in-house | checked_in | false | neutral |

Also: for every `ReservationStatus`, at least one `boardRowSeverity` call exists (loop `RESERVATION_STATUSES`).

`exception-badge-severity.test.ts`: `0 → neutral`, `1 → exception`, `3 → exception`.

`property-local-today.test.ts`: fixed `Date` + `America/Los_Angeles` / `Pacific/Kiritimati` (or UTC±) so the calendar day differs from UTC when relevant — assert `YYYY-MM-DD` from `Intl.DateTimeFormat`.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @hospai/web-pms test`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement mappers**

```ts
// apps/web-pms/src/status/types.ts
export type StatusSeverity =
  | 'settled'
  | 'neutral'
  | 'informational'
  | 'attention'
  | 'exception';

export type ActionIntent = 'default' | 'primary' | 'destructive';
```

```ts
// apps/web-pms/src/status/status-class.ts
import type { StatusSeverity } from './types.js';
export function statusClass(severity: StatusSeverity): `status-${StatusSeverity}` {
  return `status-${severity}`;
}
```

```ts
// apps/web-pms/src/status/guest-severity.ts
import type { GuestRowState } from '@hospai/client-core';
import type { StatusSeverity } from './types.js';

export function guestSeverity(state: GuestRowState): StatusSeverity {
  switch (state.kind) {
    case 'resolved':
    case 'name_pending':
      return 'neutral';
    case 'erased':
      return 'informational';
    case 'not_found':
    case 'decrypt_unresolved':
      return 'exception';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
```

```ts
// apps/web-pms/src/status/board-row-severity.ts
import type { ReservationStatus } from '@hospai/contracts/reservation-status';
import type { StatusSeverity } from './types.js';
import type { BoardMode } from '../screens/BoardScreen.js';

export function boardRowSeverity(input: {
  mode: BoardMode;
  status: ReservationStatus;
  overstay: boolean;
}): StatusSeverity {
  const { mode, status, overstay } = input;
  if (mode === 'in-house' && overstay) return 'exception';
  if (mode === 'departures') {
    switch (status) {
      case 'checked_in':
        return 'attention';
      case 'checked_out':
        return 'neutral';
      case 'cancelled':
        return 'informational';
      case 'no_show':
      case 'confirmed':
        return 'attention';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }
  // arrivals + in-house (not overstay): status still exhaustiveness-checked where relevant
  if (mode === 'arrivals') {
    switch (status) {
      case 'confirmed':
        return 'neutral';
      case 'cancelled':
      case 'checked_in':
      case 'checked_out':
      case 'no_show':
        // Unexpected on arrivals filter, but must not silent-default if wire drifts
        return 'informational';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }
  // in-house, not overstay
  switch (status) {
    case 'checked_in':
      return 'neutral';
    case 'confirmed':
    case 'cancelled':
    case 'checked_out':
    case 'no_show':
      return 'informational';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
```

```ts
// apps/web-pms/src/status/exception-badge-severity.ts
import type { StatusSeverity } from './types.js';
export function exceptionBadgeSeverity(count: number): StatusSeverity {
  return count > 0 ? 'exception' : 'neutral';
}
```

```ts
// apps/web-pms/src/status/property-local-today.ts
export function propertyLocalToday(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}
```

Avoid circular import: move `BoardMode` to `apps/web-pms/src/screens/board-mode.ts` (or `status/board-mode.ts`) if `board-row-severity` importing `BoardScreen` creates a cycle — prefer `apps/web-pms/src/status/board-mode.ts` exporting the type and importing it from `BoardScreen`.

- [ ] **Step 4: Pass tests**

Run: `pnpm --filter @hospai/web-pms test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/status
git commit -m "$(cat <<'EOF'
feat(web-pms): total severity mappers for board and guests

Pure functions over closed enums so status chrome cannot silently
default when the reservation machine grows.
EOF
)"
```

---

### Task 5: `getProperty` + typed front-desk rows

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Create or modify: `packages/client-core/test/api.test.ts` (add getProperty case)
- Modify: `packages/client-core/src/index.ts` if new types exported

**Interfaces:**
- Produces:
  - `FrontDeskItem` with `status: ReservationStatus` (or `string` narrowed at boundary) + `departureDate?: string` + existing fields
  - `getProperty(propertyId): Promise<{ property: { timeZone: string; propertyId: string; … } }>`

- [ ] **Step 1: Write failing client-core test**

```ts
it('getProperty returns property.timeZone', async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        property: { propertyId: 'p1', orgId: 'o1', name: 'N', jurisdiction: null, timeZone: 'America/New_York', status: 'active', createdAt: 1 },
        locationHint: 'x',
        recordedJurisdiction: null,
        schemaVersion: 18,
      }),
      { status: 200 },
    );
  // wire createClient with that transport — assert timeZone
});
```

- [ ] **Step 2: Implement**

```ts
import type { ReservationStatus } from '@hospai/contracts/reservation-status';

export type FrontDeskItem = {
  reservationId: string;
  guestRef: string;
  status: ReservationStatus;
  departureDate: string;
  arrivalDate?: string;
  roomId?: string | null;
  [key: string]: unknown;
};

// inside createClient return:
async getProperty(propertyId: string) {
  const { body } = await getJson(`/v1/properties/${enc(propertyId)}`);
  return body as {
    property: { propertyId: string; timeZone: string; name: string };
    locationHint?: string;
    recordedJurisdiction?: unknown;
    schemaVersion?: number;
  };
},
```

Ensure `@hospai/contracts` dependency already present on client-core; import only the browser-safe subpath.

- [ ] **Step 3: Pass client-core tests**

Run: `pnpm --filter @hospai/client-core test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/client-core
git commit -m "$(cat <<'EOF'
feat(client-core): getProperty and typed front-desk status fields

Timezone for property-local overstay without putting severity
vocabulary in client-core.
EOF
)"
```

---

### Task 6: Apply tokens on board, badge, shell timezone

**Files:**
- Create: `apps/web-pms/src/shell/PropertyTimeZone.tsx`
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx`
- Modify: `apps/web-pms/src/screens/guest-row.tsx` (optional cell helper)
- Modify: `apps/web-pms/src/screens/ExceptionsPanel.tsx`

**Interfaces:**
- Consumes: mappers, `statusClass`, `api.getProperty`, `propertyLocalToday`
- Produces: row/cell classes; departures groups; overstay only when TZ loaded; badge class from count

- [ ] **Step 1: Non-blocking PropertyTimeZone provider**

```tsx
// apps/web-pms/src/shell/PropertyTimeZone.tsx
import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, tenant } from '../client.js';

const Ctx = createContext<string | null>(null);

export function PropertyTimeZoneProvider({ children }: { children: React.ReactNode }) {
  const q = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
    // never block siblings — shell children always mount
  });
  const timeZone = q.data?.property?.timeZone ?? null;
  return <Ctx.Provider value={timeZone}>{children}</Ctx.Provider>;
}

export function usePropertyTimeZone(): string | null {
  return useContext(Ctx);
}
```

Wrap `<Outlet />` / shell children in `AppShell` with the provider. **Do not** gate rendering of nav, `QueuedCommandsPanel`, or `ExceptionsPanel` on this query.

- [ ] **Step 2: Board apply + departures groups**

In `BoardScreen`:

1. `const timeZone = usePropertyTimeZone()`.
2. For each row, `overstay = mode === 'in-house' && timeZone != null && typeof row.departureDate === 'string' && row.departureDate < propertyLocalToday(timeZone)`.
3. `const rowSev = boardRowSeverity({ mode, status: row.status as ReservationStatus, overstay })` — prefer narrowing via `RESERVATION_STATUSES.includes`.
4. `<tr className={statusClass(rowSev)}>` — row-level reservation severity.
5. Guest cell: `<td className={statusClass(guestSeverity(states[row.guestRef] ?? { kind: 'name_pending' }))}>{guestLabel(...)}</td>`.
6. Departures: partition items into **due-out** (`checked_in`), **departed** (`checked_out`), **other** (`cancelled` | `no_show` | `confirmed`). Render three labeled sections (or three `tbody` with captions). Empty sections omit or show muted “None”.
7. Optional overstay marker text in reservation cell when `overstay` (additive to colour).

- [ ] **Step 3: Badge severity**

```tsx
const sev = exceptionBadgeSeverity(count);
<span className={`badge ${statusClass(sev)}`}>{count}</span>
```

- [ ] **Step 4: Manual smoke (optional local)**

`pnpm --filter @hospai/web-pms build` succeeds; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src
git commit -m "$(cat <<'EOF'
feat(web-pms): apply status severity on board and exception badge

Row/cell chrome follows pure mappers; departures group stuck
confirmed rows as attention while PROCESS_NO_SHOWS remains a stub.
EOF
)"
```

---

### Task 7: Boot-path render test

**Files:**
- Modify: `apps/web-pms/package.json` — add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (devDependencies)
- Modify: `apps/web-pms/vitest.config.ts` — environment jsdom for `*.boot.test.tsx` or all `*.test.tsx`
- Create: `apps/web-pms/src/shell/AppShell.boot.test.tsx`
- Possibly extract a testable shell that accepts injected `api` / QueryClient — **prefer** wrapping with `QueryClientProvider` + vi.mock of `../client.js`

**Interfaces:**
- Produces: non-canary render test — PropertyDO-backed calls fail; shell still mounts with nav + queued log + exceptions panel

- [ ] **Step 1: Add test deps and vitest jsdom**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/**/*.boot.test.tsx', 'jsdom']],
  },
});
```

- [ ] **Step 2: Write the boot test**

```tsx
// apps/web-pms/src/shell/AppShell.boot.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../client.js', () => {
  const fail = () => Promise.reject(Object.assign(new Error('property_unreachable'), { /* or ClassifiedError */ }));
  return {
    tenant: { orgId: 'o', propertyId: 'p' },
    api: {
      getProperty: fail,
      getShift: fail,
      getProvisionalExceptionCount: fail,
      getProvisionalExceptions: fail,
      getArrivals: fail,
      getDepartures: fail,
      getInHouse: fail,
    },
    queuedCommands: { list: () => [] },
    asClassified: () => ({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
  };
});

import { AppShell } from './AppShell.js';

describe('AppShell boot path', () => {
  it('mounts nav, queued log, and exceptions when PropertyDO calls fail', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/arrivals']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/arrivals" element={<div>board-outlet</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: /front desk/i })).toBeTruthy();
    expect(screen.getByText(/HospAI/i)).toBeTruthy();
    // QueuedCommandsPanel + ExceptionsPanel headings / roles — match actual copy
    expect(screen.getByText(/queued/i)).toBeTruthy();
    expect(screen.getByText(/replay exceptions/i)).toBeTruthy();
  });
});
```

Adjust selectors to match `QueuedCommandsPanel` / `ExceptionsPanel` real headings. Use `ClassifiedError` from client-core if panels branch on it.

- [ ] **Step 3: Run boot test — expect PASS**

Run: `pnpm --filter @hospai/web-pms test src/shell/AppShell.boot.test.tsx`
Expected: PASS. If shell currently blocks on shift — fix shift strip to show degraded UI without unmounting shell (fail-soft), without awaiting PropertyDO for first paint.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/package.json apps/web-pms/vitest.config.ts apps/web-pms/src/shell/AppShell.boot.test.tsx pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
test(web-pms): assert shell boots when PropertyDO transport fails

Locks the boot-path principle as a render test so outage UX cannot
regress to a blank shell.
EOF
)"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run the suite**

```bash
pnpm --filter @hospai/contracts build && pnpm --filter @hospai/contracts test
pnpm --filter @hospai/do-runtime test src/reservation-status-sync.test.ts
pnpm --filter @hospai/client-core test
pnpm --filter @hospai/web-pms test
pnpm --filter eslint-plugin-hospai test
pnpm check:web-pms-colors
pnpm lint
pnpm --filter @hospai/web-pms build
```

Expected: all green.

- [ ] **Step 2: Spec acceptance checklist**

Walk §7 of the design spec; tick each item. Confirm leftovers remain leftovers (`PROCESS_NO_SHOWS`, `get_property` FAIL_CLOSED, folio settled, spacing scale).

- [ ] **Step 3: Commit only if verification fixed stragglers; otherwise done**

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Five-rung scale + action intent tokens | 2 |
| Borders mix toward surface primitive | 2 |
| Literals only on `--color-*` + contrast check | 2 |
| `no-inline-styles-in-web-pms` | 3 |
| `RESERVATION_STATUSES` + CHECK sync | 1 |
| guest / board / badge mappers + totality | 4 |
| Departures + `confirmed` → attention | 4, 6 |
| Departures three groups incl. confirmed in other | 6 |
| Overstay property-local, non-blocking TZ | 4, 5, 6 |
| Apply row/cell; badge; `.error` reuses exception | 2, 6 |
| `status-neutral` emitted, CSS empty | 2, 4, 6 |
| Boot-path render test | 7 |
| Destructive / settled / folio unexercised | 2 (tokens exist; no board settled; no folio aliases) |
| Mapper not in client-core | 4 vs 5 |

No TBD placeholders. Types align: `ReservationStatus` from contracts → board mapper → `FrontDeskItem.status`.
