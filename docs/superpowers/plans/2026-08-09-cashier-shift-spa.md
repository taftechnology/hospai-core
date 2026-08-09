# Cashier Shift SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPA open/close shift chrome, force-closed visibility via `get_front_desk_recent_shifts`, folio cash warning, classified shift 422s, money formatting, and `shiftSeverity` tokens.

**Architecture:** Append one FAIL_CLOSED front-desk read (self-scoped recent closed/force-closed). Wire existing shift mutations/reads. Client classifies `shift_not_open` / `shift_already_open`; stable idempotency on `shiftId`; strip/`/shift` use `shiftSeverity` + `formatMinor`.

**Tech Stack:** Workers / Vitest / React Query / client-core classify + idempotency / web-pms status tokens

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-cashier-shift-spa-design.md`
- Append audit + `V1_ROUTES` at **index 68** only
- Recent: limit 5, exclude `OPEN`, omit `unattributedCashCount`
- Force-close strip callout: `FORCE_CLOSED` **and** `propertyLocalToday != null` **and** `businessDate` ∈ {today, yesterday}; **suppress if date null**
- Money: wire minor; UI major; variance short/over/even; `attributedCashCount` is a count
- `shiftSeverity({ …, propertyLocalToday: string | null })` pure; OPEN+null date → `neutral`; no ad-hoc colours
- Open visible without `folio:post` (folio §2.3 authority-unknown → attempt)
- Invalidate: open → open only; close → open + recent; cash → neither
- Idempotency: `stableKeyForOperation('shift:open|close:'+shiftId)` — safe because `MONEY_INVALID` is validated **before** `runIdempotent`
- Final sweep: **typecheck + lint + full sharded pms-core**, not only targeted files
- `check:web-pms-colors` in sweep

---

### Task 1: Classify `shift_not_open` / `shift_already_open`

**Files:**
- Modify: `packages/client-core/src/classify.ts`
- Test: `packages/client-core/test/classify.test.ts`

**Interfaces:**
- Produces: `'shift_not_open' | 'shift_already_open'` on `ClientResultClass`

- [ ] **Step 1: Failing tests** — 422 + those errors → dedicated classes; other 422 → `client_error`.

- [ ] **Step 2: Implement** before generic 4xx branch in `classifyResponse`.

- [ ] **Step 3: Run** `pnpm --filter @hospai/client-core test -- classify`

---

### Task 2: DO `readRecentShiftsForActor` + HTTP route

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts` (append index 68)
- Modify: `packages/contracts/src/register.test.ts`
- Test: `apps/pms-core/test/cashiering.spec.ts` and/or `front-desk-reads.spec.ts`

**Interfaces:**
- `readRecentShiftsForActor(actor, { limit?: 5 }) → { ok: true, shifts }`
- `GET …/front-desk/shifts/recent` — FAIL_CLOSED transport guard

- [ ] **Step 1: Failing tests** — own CLOSED+FORCE_CLOSED; no OPEN; no unattributed field; non-user `[]`; transport 503.

- [ ] **Step 2: DO + handler + audit/`V1_ROUTES` append last.**

- [ ] **Step 3: Run** `check:permissions`, `check:degraded`, `check:do-transport-guards`, contracts register tests, targeted pms-core files (full suite in Task 8).

---

### Task 3: Client API rename + open/close/recent/by-id

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: all `getShift` → `getOpenShift` call sites (incl. `AppShell.boot.test.tsx` rename only — recent/open mocks land in Task 4)
- Test: client-core api/idempotency tests

**Interfaces:**
- `getOpenShift`, `getShiftById`, `getRecentShifts`, `openShift`, `closeShift`
- Keys: `shift:open:${shiftId}`, `shift:close:${shiftId}` via `stableKeyForOperation`

- [ ] **Step 1: Implement methods + rename.**

- [ ] **Step 2: Test** close key reuse; rebuild client-core before any web-pms run.

---

### Task 4: `shiftSeverity` + money helpers

**Files:**
- Create: `apps/web-pms/src/status/shift-severity.ts`
- Create: `apps/web-pms/src/status/shift-severity.test.ts`
- Create or share: `formatMinor` / `parseMajorToMinor` / `formatVarianceMinor` (extract from FolioScreen if needed)

**Interfaces:**
- `shiftSeverity({ status, variance, businessDate, propertyLocalToday: string | null }): StatusSeverity`
- `formatVarianceMinor(v: number): string` → short/over/even in major units

- [ ] **Step 1: Failing totality tests** for every row in §2.9, **including** `OPEN` + `propertyLocalToday: null` → `neutral`.

- [ ] **Step 2: Implement mapper + formatters.**

- [ ] **Step 3: Run** web-pms status tests; `pnpm check:web-pms-colors` after screens use tokens.

---

### Task 5: Shift strip open + bounded force-close callout

**Files:**
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Modify: `apps/web-pms/src/shell/AppShell.boot.test.tsx` — mock **`getOpenShift`, `getRecentShifts`, `openShift`** (recent/open omission fails silently as fail_closed)
- Test: strip / boot tests

**Interfaces:**
- Consumes: Task 3 APIs + Task 4 severity/formatters
- Open invalidates open-shift query **only**
- Callout: `recent[0]?.status === 'FORCE_CLOSED'` **and** `businessDate` is today or yesterday vs `propertyLocalToday`

- [ ] **Step 1: UI** — major-unit open input → minor submit; formatted float; “cash posts N”; Close link; bounded callout.

- [ ] **Step 2: Boot mock** includes `getRecentShifts` (resolve `{ ok: true, shifts: [] }` or failClosed deliberately) and `openShift`.

- [ ] **Step 3: Tests** — already-open copy; callout hidden for old FORCE_CLOSED; boot still mounts under fail_closed **with** recent mocked.

---

### Task 6: `/shift` close screen + receipt

**Files:**
- Create: `apps/web-pms/src/screens/ShiftScreen.tsx` (+ test)
- Modify: router / shell routes
- Error copy for `shift_not_open` / `shift_already_open`

**Interfaces:**
- Blind close → major input → minor; stable close key
- Success or `shift_not_open` → `/shift/:shiftId` receipt via `getShiftById`
- Close invalidates open + recent
- Receipt: formatted money; signed variance; `shiftSeverity`; FORCE_CLOSED null variance

- [ ] **Step 1–3: Implement + tests** (refresh-safe receipt; force-close race; invalidation asymmetry).

---

### Task 7: Folio cash warning

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Test: `FolioScreen.test.tsx`

- [ ] **Step 1: Warn when no open shift; do not disable; assert mutation still fires.**

- [ ] **Step 2: Run** web-pms tests after client-core build.

---

### Task 8: Leftovers + full acceptance sweep

**Files:**
- Modify: folio front-desk spec — retire unattributed-until-UI leftover
- Design spec status → Approved after land

- [ ] **Step 1: Mark folio leftover retired**

- [ ] **Step 2: Full sweep (not targeted-only)**

```bash
pnpm typecheck
pnpm lint
pnpm check:permissions
pnpm check:degraded
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
pnpm --filter @hospai/pms-core test
```

Walk design §7 checklist. Targeted vitest files are fine mid-loop; **this step is the gate.**
