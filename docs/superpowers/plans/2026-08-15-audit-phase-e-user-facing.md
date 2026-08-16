# Audit Phase E — user-facing behaviour (E1–E5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit Phase **E** items **E1**–**E5** in `apps/web-pms` — honour caller fallbacks in `classifiedUserMessage`, add a domain-code copy map for desk mutations, replace three bare status `<p>` tags with accessible `<Alert>`, align checkout confirm with server semantics (`balanceMinor > 0`) plus credit-balance guidance, and humanize degraded-mode queue rows. **No frozen heads move.**

**Architecture:** Copy-helper-first TDD in `classified-user-message.ts` (**E1 → E2** dependency); screen/shell UI commits are independent after E1 (**E3**, **E4**, **E5** parallel-safe). Red-first unit/screen tests per audit ground rules §6; one commit per task; final task runs full `pnpm test:local` because copy touches `@hospai/client-core` consumers.

**Tech Stack:** React 19 + vitest + `@testing-library/react` (`apps/web-pms`), `@hospai/ui-kit` (`Alert`), `@hospai/client-core` (classified responses, queued entries), root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-e-user-facing-design.md` (Locks 1–5 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |
| `idempotency.ts` `export const` count | **158** | **158** — unchanged |

Tree verified 2026-08-15. **No DDL** this phase — `pnpm generate:ddl && pnpm check:ddl` is confirm-only in final verify.

---

## Sequencing gate (read before starting)

Phases **A**, **B**, **C**, and **D** **must** be landed — typed error channel and local suite are trustworthy.

| After this plan | Do not start |
|---|---|
| Lock 1 (E1) — `context.fallback` after class map | Refactoring `BookingScreen.tsx` local 25-code handlers |
| Lock 2 (E2) — `DOMAIN_CODE_MESSAGES` before class map | Server `balanceMinor` on `balance_due` HTTP bodies |
| Lock 3 (E3) — three `<Alert>` replacements | Touching nine screens already using `<Alert>` |
| Lock 4 (E4) — `balanceMinor > 0` confirm + credit notice | Phase **F/G/H** audit items |
| Lock 5 (E5) — queue label map + reservation suffix | `packages/client-core/src/queued-commands.ts` shape changes |
| All §Verification commands green | DO / schema / catalog / route edits; push |

**TDD order:** Task 1 (E1) → Task 2 (E2) → Tasks 3–5 (E3/E4/E5, any order) → Task 6 (full verification).

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: E1 honour caller fallbacks (spec §2 Lock 1)

**Locked:** Rename `_context` → `context` in `classifiedUserMessage`. Resolution order (after E2 lands, implement E1 with step 4 ready; E2 inserts domain map at step 2):

1. **`forbidden`** — existing `permissionForForbidden` branch (unchanged).
2. **Domain code map** — E2; keyed off `bodyErrorCode(classified.body)`.
3. **`CLASS_MESSAGES[classified.class]`** — existing class map (unchanged entries).
4. **`context.fallback ?? UNKNOWN_MESSAGE`** — never return raw class tokens or wire codes.

**Locked:** `knownCode` is honoured only via step 4 fallback chain — no separate equality branch. Do **not** echo `knownCode` or `body.error` to the user.

**Test updates (required):**

| Test | Change |
|---|---|
| `unknown class does not paint the raw token` | Assert **`"Open shift failed"`** (fallback), not `Something went wrong`; still no `client_error` substring |
| `fail_closed does not paint the class token` | Class message **still beats** fallback — unchanged expectation (`Property unreachable.`) |

**Side effect:** `ShiftStrip.test.tsx` line ~148 (`leaves the manual form when auto-open errors`) must expect **`Open shift failed`**, not `Something went wrong` — update in Task 1 when fallback surfaces.

### D2 — Lock 2: E2 domain-code map (spec §2 Lock 2)

**Locked:** Add helpers to `classified-user-message.ts` (mirror `BookingScreen.tsx:21–27,49–55` shape — **do not** change BookingScreen):

```ts
function bodyErrorCode(body: unknown): string | null { /* same shape as BookingScreen */ }
function bodyNumberField(body: unknown, key: string): number | undefined { /* typeof number only */ }
function bodyStringField(body: unknown, key: string): string | undefined { /* typeof string only — for no_availability date */ }
```

Import `formatMinor` from `apps/web-pms/src/money.js`.

**Lookup:**

```ts
const code = bodyErrorCode(classified.body);
const domainMsg = code ? DOMAIN_CODE_MESSAGES[code]?.(classified.body) : undefined;
if (domainMsg) return domainMsg;
// … then class map, then fallback (Lock 1)
```

**Locked copy (`DOMAIN_CODE_MESSAGES` — 10 codes):** Every message **must not** contain `try again` (case-insensitive). Wire codes **must not** appear in returned strings.

| Wire code | Message (locked) |
|---|---|
| `balance_due` | `Guest owes ${formatMinor(n)} — settle on the folio before checkout.` when `body.balanceMinor` is a number; else `Guest balance is due — settle on the folio before checkout.` |
| `folio_balance_due` | Same amount pattern; ending `… before generating the invoice.` / amount-less: `Folio balance is due — settle before generating the invoice.` |
| `room_already_assigned` | `That room is already assigned — pick another room.` |
| `room_out_of_order` | `Room is out of order — pick another room.` |
| `room_type_mismatch` | `That room does not match the booked room type — pick another room.` |
| `hold_expired` | `This hold has expired — create a new booking.` |
| `inquiry_expired` | `This inquiry has expired — create a new booking.` |
| `invoice_required` | `Generate an invoice before checkout.` |
| `not_modifiable` | `This reservation cannot be changed in its current status.` |
| `no_availability` | `No availability on ${date} — pick another room type or date.` when `body.date` string present; else `No availability — pick another room type or date.` |

**Not in central map:** `room_not_ready` — stays screen-local in `CheckInScreen.tsx:99–101`.

**Payload tolerance:** Client uses `body.balanceMinor` when present; amount-less template otherwise. **No server change** this phase.

### D3 — Lock 3: E3 accessible async feedback (spec §2 Lock 3)

**Locked:** Replace bare `<p>` with `<Alert>` from `@hospai/ui-kit` (`packages/ui-kit/src/Badge.tsx:23–28` — `role="alert"`).

| File | Before | After |
|---|---|---|
| `CheckInScreen.tsx` ~205 | `{message ? <p>{message}</p> : null}` | `{message ? <Alert data-testid="check-in-message">{message}</Alert> : null}` |
| `ShiftStrip.tsx` ~146 | `{message ? <p className="muted">{message}</p> : null}` | `{message ? <Alert data-testid="shift-strip-message">{message}</Alert> : null}` |
| `ShiftStrip.tsx` ~165 | same | same `data-testid` |

**Locked:** Drop `className="muted"`. Do **not** add wrapper `aria-live`. Do **not** change nine screens already using `<Alert>`.

### D4 — Lock 4: E4 checkout confirm vs credit balance (spec §2 Lock 4)

**Locked guard:**

```diff
-const overrideBalance = typeof balanceMinor === 'number' && balanceMinor !== 0;
+const overrideBalance = typeof balanceMinor === 'number' && balanceMinor > 0;
```

**Positive balance:** keep confirm verbatim:

```ts
`Depart with open balance ${formatMinor(balanceMinor)}? This posts checkout with a balance override.`
```

**Negative balance:** no `window.confirm`; checkout proceeds without `overrideBalance: true`.

**Credit notice** when `typeof balanceMinor === 'number' && balanceMinor < 0` — render in checkout `<section>`, above the Check out button:

```tsx
<Alert data-testid="folio-credit-notice">
  Guest credit {formatMinor(Math.abs(balanceMinor))} — issue a refund after departure if needed.
</Alert>
```

**Locked:** credit copy **must not** contain `balance override`, `override`, or `open balance`.

### D5 — Lock 5: E5 queued-command human labels (spec §2 Lock 5)

**Line shape:**

```ts
// `{label} · {date}[ · #{reservationSuffix}]`
// date = entry.businessDate ?? entry.issuedAt.slice(0, 10)
// reservationSuffix = entry.reservationId.slice(-8) when reservationId present
```

Unknown `commandId` → **`Queued action`**.

**Locked `COMMAND_ID_LABELS` (14 ids):**

| `commandId` | Label |
|---|---|
| `reservations.check_in` | Check-in |
| `reservations.check_out` | Checkout |
| `reservations.assign_room` | Room assignment |
| `reservations.update_status` | Reservation update |
| `reservations.cancel_check_in` | Cancel check-in |
| `folio.add_item` | Folio charge |
| `folio.add_line` | Folio charge |
| `post_folio_charge` | Folio charge |
| `folio.record_cash_payment` | Cash payment |
| `folio.open_shift` | Open shift |
| `folio.close_shift` | Close shift |
| `rooms.update_status` | Room status update |
| `rooms.bulk_update_status` | Bulk room status |
| `housekeeping.assign` | Housekeeping assignment |

Do **not** embed raw `commandId`, `idempotencyKey`, or full `reservationId`.

### D6 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local`. Per-file web-pms: `pnpm --filter @hospai/web-pms test`. **No DDL** this phase.

### D7 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 6 only** at implementation time. No push.

---

## Global constraints

- **Heads table above — none move.**
- **`apps/web-pms` + copy/unit/screen tests only** — optional local helpers in `classified-user-message.ts`; do **not** extract to `packages/client-core` unless a test proves shared need (spec prefers local).
- **TDD:** red-first tests per task before production edits.
- **Booking wizard** local copy block stays untouched.

### Scope out (forbidden across all tasks)

- DO / schema / catalog / HTTP route changes
- Server error payload changes (no `balanceMinor` on `balance_due` HTTP bodies)
- Phase **F/G/H** audit items
- Refactor/remove `BookingScreen.tsx` local error handlers
- Route-guard fail-open on `authority.kind === 'unknown'`
- Code splitting, edge rate limiting, `gatePermission` / auth semantics
- Push

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/web-pms/src/copy/classified-user-message.ts` | E1 context + fallback; E2 helpers + `DOMAIN_CODE_MESSAGES` | 1–2 |
| `apps/web-pms/src/copy/classified-user-message.test.ts` | E1 fallback assertions; E2 per-code tests | 1–2 |
| `apps/web-pms/src/shell/ShiftStrip.test.tsx` | E1 fallback copy expectation; E3 `getByRole('alert')` | 1, 3 |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | E3 `<Alert>` ~205 | 3 |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | E3 `<Alert>` ~146, ~165 | 3 |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | E3 `getByRole('alert')` | 3 |
| `apps/web-pms/src/screens/FolioScreen.tsx` | E4 `> 0` guard ~654; credit `<Alert>` | 4 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | E4 negative-balance no-confirm; E5 queued label expectations ~1301 | 4, 5 |
| `apps/web-pms/src/copy/queued-command-line.ts` | E5 label map + reservation suffix | 5 |
| `apps/web-pms/src/copy/queued-command-line.test.ts` | E5 distinct-line + suffix assertions | 5 |
| `docs/superpowers/specs/2026-08-15-audit-phase-e-user-facing-design.md` | Tick §8 checklist | 6 |
| `docs/superpowers/plans/2026-08-15-audit-phase-e-user-facing.md` | Task 6 checkboxes (this file) | 6 |

**Not touched:** `apps/pms-core/**`, `packages/contracts/**`, `COMMAND_CATALOG`, routes, schema, `BookingScreen.tsx` local handlers, `packages/client-core/src/queued-commands.ts`.

---

## Spec §1.5 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 1 (E1) — honour fallbacks + two test updates | 1 |
| Lock 2 (E2) — domain map before class map + per-code tests | 2 |
| Lock 3 (E3) — three `<Alert>` + a11y tests | 3 |
| Lock 4 (E4) — checkout confirm + credit notice | 4 |
| Lock 5 (E5) — queue labels + reservation suffix | 5 |
| §5 test plan / §5.6 gates | 1–6 |
| §1.6 scope out | forbidden all |
| §8 checklist | 6 |

---

### Task 1: E1 — honour caller fallbacks in `classifiedUserMessage`

**Spec:** Lock 1, §5.1.

**Files:**
- Modify: `apps/web-pms/src/copy/classified-user-message.ts`
- Modify: `apps/web-pms/src/copy/classified-user-message.test.ts`
- Modify: `apps/web-pms/src/shell/ShiftStrip.test.tsx` (fallback copy expectation)

**Interfaces:**
- Produces: `context` param used; step-4 `context.fallback ?? UNKNOWN_MESSAGE` after class map
- Frozen heads: unchanged

**Forbidden this commit:** `DOMAIN_CODE_MESSAGES`; screen/UI edits; server changes.

- [ ] **Step 1: Write failing E1 tests (red)**

Update `classified-user-message.test.ts`:

```typescript
  it('unknown class does not paint the raw token', () => {
    const msg = classifiedUserMessage(classified({ class: 'client_error' }), {
      fallback: 'Open shift failed',
    });
    expect(msg).not.toMatch(/client_error/);
    expect(msg).toBe('Open shift failed');
  });
```

Confirm `fail_closed` test still expects `Property unreachable.` (class beats fallback).

Update `ShiftStrip.test.tsx` (`leaves the manual form when auto-open errors`):

```typescript
    expect(screen.getByText(/Open shift failed/i)).toBeTruthy();
```

Run red:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/copy/classified-user-message.test.ts src/shell/ShiftStrip.test.tsx -t "unknown class|leaves the manual form"
```

Expected: **FAIL** — still returns `Something went wrong` / old copy.

- [ ] **Step 2: Implement Lock 1**

```diff
 export function classifiedUserMessage(
   classified: ClassifiedResponse,
-  _context: { fallback?: string; knownCode?: string | null },
+  context: { fallback?: string; knownCode?: string | null },
 ): string {
   // forbidden branch unchanged …
   const mapped = CLASS_MESSAGES[classified.class];
   if (mapped) return mapped;
-  return UNKNOWN_MESSAGE;
+  return context.fallback ?? UNKNOWN_MESSAGE;
 }
```

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms test
```

Expected: **PASS** (full web-pms suite).

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/copy/classified-user-message.ts \
  apps/web-pms/src/copy/classified-user-message.test.ts \
  apps/web-pms/src/shell/ShiftStrip.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): honour caller fallbacks in classifiedUserMessage

Restore screen-specific error copy when no class map applies; update
ShiftStrip test to expect surfaced fallback instead of generic message.
EOF
)"
```

---

### Task 2: E2 — domain-code map in `classifiedUserMessage`

**Spec:** Lock 2, §5.2.

**Files:**
- Modify: `apps/web-pms/src/copy/classified-user-message.ts`
- Modify: `apps/web-pms/src/copy/classified-user-message.test.ts`

**Interfaces:**
- Produces: `bodyErrorCode`, `bodyNumberField`, `bodyStringField`, `DOMAIN_CODE_MESSAGES` (10 codes); lookup before `CLASS_MESSAGES`
- Frozen heads: unchanged

**Forbidden this commit:** `BookingScreen.tsx` edits; screen UI; server changes.

- [ ] **Step 1: Write failing domain-code tests (red)**

Add table-driven cases in `classified-user-message.test.ts` (one `it.each` row per locked code). Minimum assertions per spec §5.2:

```typescript
function classifiedWithCode(code: string, bodyExtra: Record<string, unknown> = {}) {
  return classified({
    class: 'client_error',
    status: 422,
    body: { error: code, ...bodyExtra },
  });
}

describe('domain code messages', () => {
  it.each([
    ['balance_due', { balanceMinor: 2500 }, /Guest owes 25\.00 — settle on the folio before checkout/],
    ['balance_due', {}, /Guest balance is due — settle on the folio before checkout/],
    ['folio_balance_due', { balanceMinor: 100 }, /before generating the invoice/],
    ['room_already_assigned', {}, /already assigned — pick another room/],
    ['room_out_of_order', {}, /out of order — pick another room/],
    ['room_type_mismatch', {}, /does not match the booked room type/],
    ['hold_expired', {}, /hold has expired/],
    ['inquiry_expired', {}, /inquiry has expired/],
    ['invoice_required', {}, /Generate an invoice before checkout/],
    ['not_modifiable', {}, /cannot be changed in its current status/],
    ['no_availability', { date: '2026-08-11' }, /No availability on 2026-08-11/],
    ['no_availability', {}, /No availability — pick another room type or date/],
  ] as const)('%s', (code, extra, pattern) => {
    const msg = classifiedUserMessage(classifiedWithCode(code, extra), { fallback: 'X' });
    expect(msg).toMatch(pattern);
    expect(msg).not.toMatch(/try again/i);
    expect(msg).not.toMatch(new RegExp(code, 'i'));
  });

  it('domain message beats class-mapped client_error fallback', () => {
    const msg = classifiedUserMessage(classifiedWithCode('balance_due'), { fallback: 'Checkout failed' });
    expect(msg).toMatch(/balance is due|Guest owes/);
    expect(msg).not.toBe('Checkout failed');
  });
});
```

Run red:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/copy/classified-user-message.test.ts -t "domain code"
```

Expected: **FAIL** — domain codes fall through to fallback or generic copy.

- [ ] **Step 2: Implement Lock 2**

1. Add helpers (`bodyErrorCode`, `bodyNumberField`, `bodyStringField`).
2. Import `formatMinor` from `../money.js`.
3. Add `DOMAIN_CODE_MESSAGES` record with function values per Lock 2b locked copy.
4. Insert lookup **after** forbidden branch, **before** `CLASS_MESSAGES`:

```typescript
  const code = bodyErrorCode(classified.body);
  const domainMsg = code ? DOMAIN_CODE_MESSAGES[code]?.(classified.body) : undefined;
  if (domainMsg) return domainMsg;
```

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/copy/classified-user-message.test.ts
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/copy/classified-user-message.ts \
  apps/web-pms/src/copy/classified-user-message.test.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): add domain-code user messages for desk mutations

Map permanent reservation and folio error codes before generic class copy
so check-in, assign, checkout, and folio paths show actionable guidance.
EOF
)"
```

---

### Task 3: E3 — accessible async feedback (`<Alert>`)

**Spec:** Lock 3, §5.3.

**Files:**
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`
- Modify: `apps/web-pms/src/shell/ShiftStrip.test.tsx`

**Interfaces:**
- Produces: three `<Alert role="alert">` sites with `data-testid`
- Frozen heads: unchanged

**Forbidden this commit:** copy-helper changes; FolioScreen; queued-command-line.

- [ ] **Step 1: Write failing a11y tests (red)**

Add to `CheckInScreen.test.tsx` (extend existing check-in error path or add focused case):

```typescript
  it('surfaces check-in feedback in an alert region', async () => {
    checkIn.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'room_out_of_order' },
        retryAfterMs: null,
      }),
    );
    renderCheckIn();
    await waitFor(() => expect(screen.getByTestId('check-in-room')).toBeTruthy());
    fireEvent.change(screen.getByTestId('check-in-room'), { target: { value: 'rm_1' } });
    fireEvent.click(screen.getByTestId('check-in'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/out of order/i);
  });
```

Add to `ShiftStrip.test.tsx` (`leaves the manual form when auto-open errors`):

```typescript
    expect(screen.getByRole('alert').textContent).toMatch(/Open shift failed/i);
```

Run red:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx src/shell/ShiftStrip.test.tsx -t "alert|leaves the manual form"
```

Expected: **FAIL** — no `role="alert"`.

- [ ] **Step 2: Implement Lock 3**

1. `CheckInScreen.tsx` — import `Alert` from `@hospai/ui-kit`; replace message `<p>` (~205).
2. `ShiftStrip.tsx` — import `Alert`; replace both message `<p className="muted">` (~146, ~165) with `<Alert data-testid="shift-strip-message">`.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx src/shell/ShiftStrip.test.tsx
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/shell/ShiftStrip.tsx \
  apps/web-pms/src/screens/CheckInScreen.test.tsx \
  apps/web-pms/src/shell/ShiftStrip.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): use Alert for check-in and shift-strip async feedback

Replace bare status paragraphs with ui-kit Alert so screen readers
announce check-in and open-shift success and failure messages.
EOF
)"
```

---

### Task 4: E4 — checkout confirm guard and credit-balance notice

**Spec:** Lock 4, §5.4.

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`

**Interfaces:**
- Produces: `overrideBalance` only when `balanceMinor > 0`; credit `<Alert data-testid="folio-credit-notice">` when `balanceMinor < 0`
- Frozen heads: unchanged

**Forbidden this commit:** server changes; queued-command-line; classified-user-message.

- [ ] **Step 1: Write failing E4 tests (red)**

Add to `FolioScreen.test.tsx`:

```typescript
  it('negative balance skips confirm and checks out without overrideBalance', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: -5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });
    checkOut.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });

    const confirm = vi.spyOn(window, 'confirm');
    renderFolio();
    await waitFor(() => expect(screen.getByTestId('check-out')).toBeTruthy());
    screen.getByTestId('check-out').click();
    await waitFor(() => expect(checkOut).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(checkOut.mock.calls[0]![3]).toBeUndefined();
    confirm.mockRestore();
  });

  it('shows credit notice without override wording when balance is negative', async () => {
    getFolio.mockResolvedValue({
      ok: true,
      window: { folioWindowId: 'res_1:GUEST', kind: 'GUEST', status: 'OPEN' },
      balanceMinor: -5000,
      lines: [],
    });
    getReservation.mockResolvedValue(liveReservation);
    getFolioPayments.mockResolvedValue({ ok: true, payments: [] });

    renderFolio();
    await waitFor(() => expect(screen.getByTestId('folio-credit-notice')).toBeTruthy());
    const notice = screen.getByTestId('folio-credit-notice').textContent ?? '';
    expect(notice).toMatch(/Guest credit 50\.00/);
    expect(notice).not.toMatch(/override/i);
    expect(notice).not.toMatch(/open balance/i);
  });
```

Run red:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "negative balance|credit notice"
```

Expected: **FAIL** — confirm called or no credit notice.

- [ ] **Step 2: Implement Lock 4**

1. Change `overrideBalance` guard (~654) to `balanceMinor > 0`.
2. In checkout `<section>` (~1282), above `<Button data-testid="check-out">`, when `typeof balanceMinor === 'number' && balanceMinor < 0`, render credit `<Alert>` with locked copy.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "54:|negative balance|credit notice"
```

Expected: **PASS** — existing test `54: confirm dialog yes…` unchanged for `balanceMinor: 5000`.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
fix(web-pms): align checkout confirm with positive balance only

Skip override confirm for guest credit balances and show informational
refund guidance instead of alarming open-balance override copy.
EOF
)"
```

---

### Task 5: E5 — queued-command human labels

**Spec:** Lock 5, §5.5.

**Files:**
- Modify: `apps/web-pms/src/copy/queued-command-line.ts`
- Modify: `apps/web-pms/src/copy/queued-command-line.test.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` (~1301 queued-section expectations)

**Interfaces:**
- Produces: `COMMAND_ID_LABELS` (14 ids); line shape `{label} · {date}[ · #{suffix}]`
- Frozen heads: unchanged

**Forbidden this commit:** `packages/client-core`; screen UI beyond test expectations.

- [ ] **Step 1: Write failing queue label tests (red)**

Replace/update `queued-command-line.test.ts`:

```typescript
  it('distinct commandIds on the same date produce different labels', () => {
    const date = '2026-08-14';
    const checkIn = queuedCommandLine({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: `${date}T12:00:00Z`,
      businessDate: date,
    });
    const charge = queuedCommandLine({
      commandId: 'folio.add_item',
      idempotencyKey: 'k2',
      issuedAt: `${date}T12:00:00Z`,
      businessDate: date,
    });
    expect(checkIn).toBe('Check-in · 2026-08-14');
    expect(charge).toBe('Folio charge · 2026-08-14');
    expect(checkIn).not.toBe(charge);
  });

  it('appends reservation suffix when reservationId is present', () => {
    const line = queuedCommandLine({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: '2026-08-14T12:00:00Z',
      businessDate: '2026-08-14',
      reservationId: 'res_abc12def',
    });
    expect(line).toBe('Check-in · 2026-08-14 · #abc12def');
    expect(line).not.toMatch(/res_abc12def/);
  });
```

Update first test expectation from `Queued action · …` to `Folio charge · …` for `post_folio_charge`.

Update `FolioScreen.test.tsx` queued assertions (~1301):

```typescript
    expect(advanced().textContent).toMatch(/Folio charge · 2026-08-14/);
    expect(advanced().textContent).toMatch(/Folio charge · 2026-08-13/);
```

Run red:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/copy/queued-command-line.test.ts src/screens/FolioScreen.test.tsx -t "humanizes|distinct|Folio charge|company folio"
```

Expected: **FAIL**.

- [ ] **Step 2: Implement Lock 5**

```typescript
const COMMAND_ID_LABELS: Record<string, string> = {
  'reservations.check_in': 'Check-in',
  // … all 14 locked ids …
};

export function queuedCommandLine(entry: QueuedCommandEntry): string {
  const date = entry.businessDate ?? entry.issuedAt.slice(0, 10);
  const label = COMMAND_ID_LABELS[entry.commandId] ?? 'Queued action';
  const suffix =
    entry.reservationId != null && entry.reservationId !== ''
      ? ` · #${entry.reservationId.slice(-8)}`
      : '';
  return `${label} · ${date}${suffix}`;
}
```

- [ ] **Step 3: Verify — must be green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/copy/queued-command-line.test.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "company folio|Queued|Folio charge"
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/copy/queued-command-line.ts \
  apps/web-pms/src/copy/queued-command-line.test.ts \
  apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): humanize degraded-mode queued command rows

Label queue entries by command intent and optional reservation suffix
instead of identical generic Queued action lines on the same date.
EOF
)"
```

---

### Task 6: Final verification + checklist

**Spec:** §1.4, §5.6, §8 checklist.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-e-user-facing-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-e-user-facing.md` — Task 6 checkboxes only

**Forbidden this commit:** new features; scope-out items.

**Commit history note (E4/E5 split):** Task 4 production landed in `486aaf2`; its two FolioScreen E4 tests landed in Task 5 commit `a7b8a59` due to parallel-implementer staging collision. Functionally correct — tests and production both on `main`.

- [x] **Step 1: web-pms test suite**

```bash
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**.

- [x] **Step 2: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [x] **Step 3: All 14 `check:*` gates**

```bash
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
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
```

Expected: all **PASS** (`check:ddl` confirm-only — no migration).

- [x] **Step 4: Full local test loop — long pole**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [x] **Step 5: Pin frozen heads — must be unchanged**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 158
```

Expect: catalog **89**; writers **63**; routes **144**, tail `get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 34`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`; idempotency consts **158**.

- [x] **Step 6: Scope-out grep — must be clean**

```bash
! rg "DOMAIN_CODE_MESSAGES|bodyErrorCode" apps/web-pms/src/screens/BookingScreen.tsx
! rg "balanceMinor !== 0" apps/web-pms/src/screens/FolioScreen.tsx
```

Expected: no matches (BookingScreen stays local-first; Folio uses `> 0`).

- [x] **Step 7: Tick spec §8 reviewer checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-e-user-facing-design.md` §8.

- [x] **Step 8: Tick Task 6 checkboxes in this plan only**

Do **not** retroactively tick Tasks 1–5 unless already done during implementation.

- [x] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-15-audit-phase-e-user-facing-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-e-user-facing.md
git commit -m "$(cat <<'EOF'
chore(docs): finalize audit Phase E verification checklist

Confirm web-pms user-facing fixes green across full gate suite and
frozen heads unchanged after E1–E5 implementation.
EOF
)"
```

**Stop.** Audit **E1–E5** closed. Phase **F** may proceed.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/web-pms exec vitest run src/copy/classified-user-message.test.ts` | E1 fallback + E2 domain codes | 1–2, 6 |
| 2 | `pnpm --filter @hospai/web-pms exec vitest run src/screens/CheckInScreen.test.tsx src/shell/ShiftStrip.test.tsx` | `getByRole('alert')` | 3, 6 |
| 3 | `pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "54:|negative balance|credit"` | E4 confirm + credit notice | 4, 6 |
| 4 | `pnpm --filter @hospai/web-pms exec vitest run src/copy/queued-command-line.test.ts` | E5 labels + suffix | 5, 6 |
| 5 | `pnpm --filter @hospai/web-pms test` | Full web-pms green | 1–6 |
| 6 | `pnpm test:local` | **Long pole** — 8 shards green | 6 |
| 7 | All 14 `check:*` gates | Green | 6 |
| 8 | `pnpm typecheck` / `pnpm build` / `pnpm lint` | Green | 6 |
| 9 | Frozen heads pin | catalog **89**, writers **63**, routes **144**, schema **34**, steps **8**, consts **158** | 6 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. No DDL this phase.

---

## Spec §8 reviewer checklist (Task 6 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Lock 1 (E1): `context` used; fallback after class map; two tests updated | 1 |
| Lock 2 (E2): `DOMAIN_CODE_MESSAGES` before `CLASS_MESSAGES`; no "try again"; per-code tests | 2 |
| Lock 3 (E3): three `<Alert>` replacements; `getByRole('alert')` tests green | 3 |
| Lock 4 (E4): `balanceMinor > 0` confirm only; credit notice without "override" wording | 4 |
| Lock 5 (E5): command label map; reservation suffix; distinct-line tests | 5 |
| No frozen head moves (§1.4) | 6 |
| Scope-out respected — no server/DO/schema/catalog/route edits | 6 |
| `pnpm --filter @hospai/web-pms test` green | 1–6 |
| All **14** `check:*` gates green | 6 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in | 1–6 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–5 | 1–5 |
| §3 file map | 1–6 |
| §4 / §5 test plan | 1–6 |
| §8 checklist | 6 |
| Frozen heads §1.4 / §9 | none move |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §9). **No heads move.**

---

## Approximate line numbers — read actual code first

Spec citations are tree-verified 2026-08-15 but **will drift**. Implementers **must grep / read** before editing:

| Area | Spec cites | Plan note |
|---|---|---|
| `classifiedUserMessage` | `classified-user-message.ts:22` | Task 1 — rename `_context`, add fallback return |
| E2 domain lookup insert point | after forbidden, before class map | Task 2 |
| `CheckInScreen` message | ~205 | Task 3 — import `Alert` |
| `ShiftStrip` messages | ~146, ~165 | Task 3 — drop `muted` |
| Folio checkout guard | ~654 | Task 4 — `> 0` |
| Folio checkout section | ~1282–1298 | Task 4 — credit notice above button |
| Folio queued test | ~1301 | Task 5 — label expectations |
| `queuedCommandLine` | `queued-command-line.ts:3–6` | Task 5 |
| `ShiftStrip.test` auto-open error | ~148 | Task 1 copy + Task 3 alert |
| `BookingScreen` body helpers | ~21–55 | Mirror shape only — do not edit |

---

## Plan writer interpretations (flagged for reviewer)

1. **`bodyStringField` helper:** spec Lock 2 cites `bodyNumberField` only; plan adds `bodyStringField` for `no_availability` `date` (BookingScreen uses coercing `bodyField` — E2 should use **string-only** per spec "when `body.date` string present").
2. **`$25.00` vs `25.00`:** spec §5.2 says "Contains `$25.00`"; Lock 2b templates use `formatMinor` **without** `$` (matches existing folio/checkout copy). Tests assert **`25.00`** via `formatMinor(2500)` — not `$25.00`.
3. **E1 + E2 commit split:** Task 1 ships fallback without domain map (E2 tests red until Task 2). Task 1 verify runs full `pnpm --filter @hospai/web-pms test` — acceptable because E2 tests do not exist until Task 2 Step 1.
4. **Check-in E3 test uses `room_out_of_order`:** exercises E2 domain copy **and** E3 alert in one assertion after Tasks 2+3 land; Task 3 red test may use any message path that sets `message` (including mock generic error) if E3 is implemented before E2 — prefer domain-code path when Task 3 follows Task 2.
5. **Folio E5 test fixture:** both queued rows use `folio.add_line` — labels become identical `"Folio charge"` with **different dates** and `#suffix` (not distinct commandIds). Spec FolioScreen expectation is date-level label change from `Queued action` → `Folio charge`; distinct-commandId test lives in `queued-command-line.test.ts`.
6. **`use-folio-action-mutation.test.ts`:** not in spec file map — no planned edits; domain messages flow through `classifiedUserMessage` automatically after Task 2. Add tests only if Task 2 breaks existing expectations.
7. **Credit notice visibility:** shown whenever `balanceMinor < 0` and checkout section renders (`policy.canCheckout`) — informational only, does not gate the button.
