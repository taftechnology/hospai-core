# Folio First-Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Make `/folio/:id` first paint a bill a GM would recognize (guest, dates, room code, balance, lines, post charge, card + cash) and auto-open a cashier shift for the signed-in `folio:post` actor — without new routes, commands, schema, or a prototype rebuild.

**Architecture:** SPA content IA on `FolioScreen.tsx`: required bill facts stay visible; operator chrome moves into one collapsed `<details data-testid="folio-advanced">`. Tenders label from stored `tenderType` exposed on the **existing** `GET …/folio/payments` body (no new audit row). `ShiftStrip` auto-calls existing `folio.open_shift` once when open-shift is null and `canShowShellOpen`. Seed is unchanged.

**Tech Stack:** React SPA (`apps/web-pms`), `@tanstack/react-query`, `@hospai/client-core`, PropertyDO `listPaymentsForReservation`, existing `folio.open_shift` / `get_rooms` / `get_charge_codes`, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-13-folio-first-paint-design.md` (Approved). Spec commit: `84f82a0`.

## Global Constraints

- **No new HTTP routes.** `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` stays last. Do not append. Do not edit `v1-http-routes.ts` or `V1_ROUTES`.
- `COMMAND_CATALOG.length` stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`. Do **not** add `folio.ensure_shift` / `folio.ensure_demo_shift` / last-4 commands.
- **No schema migration.** `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `pnpm generate:ddl` is a no-op diff. No last-4 / brand column.
- No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- Money is integers on the wire. UI still uses `formatMinor` / `parseMajorToMinor`. Balance chrome is server `balanceMinor`, never `fold.liveTotalMinor`.
- Folio is append-only. This chunk does not change payment / charge / shift **writers** (fingerprints, payloads, permissions). Cash still posts without a shift (Q4).
- **Existing `data-testid`s stay** on the same controls (spec §8). Moving a node into Advanced is allowed. Renaming an id is not. New id: **`folio-advanced` only**.
- Happy-path visible text never contains `simulate`, `sim_`, raw `paymentId` as a label, `unattributed until close discloses the count`, or raw `roomId` (`rm_101`) as the room label.
- Last-4 / brand is **P1**. Do not fabricate `•••• 4242`.
- Auto-open is **SPA `ShiftStrip`**, not `demo-seed`, not FolioScreen, not a new command. Once per mount. Opening float default `100.00` → `parseMajorToMinor` = **10000**.
- Visual identity is **P0-3**. No new tokens, no Tailwind, no `ui-kit`, no sidebar. `check:web-pms-colors` stays green; do not add `--status-*`.
- **Rebuild:** after `@hospai/client-core` source change, `pnpm --filter @hospai/client-core build` before web-pms tests. PropertyDO change does not require a contracts rebuild (no route audit edit).
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 6). Do not backfill historical plans.
- No either/or forks. Spec §14 locks stand.
- Scope-out (do not implement): P0-3 chrome + skin, P0-4 Clerk / `/sign-in`, P0-5 script + dry runs, prototype folio rebuild, new Worker routes/commands, new DO tables/schema, real PSP/PCI, P1 last-4, seed folio lines, seed `folio.open_shift`, gate cash on shift, hide strip `shiftId`, status copy “In house”, city ledger / invoices / auto-transfer / recurring / partial refunds, `ui-kit` / Tailwind, virtual types / derived rates / `rooms.delete`.

## File map

| File | Role |
|---|---|
| `apps/pms-core/src/property-do.ts` | `listPaymentsForReservation` SELECT + JSON `tenderType` (Task 1) |
| `apps/pms-core/test/folio-payments.spec.ts` | Card list includes `tenderType: 'CARD'` (Task 1) |
| `apps/pms-core/test/cashiering.spec.ts` | Cash list includes `tenderType: 'CASH'` (Task 1) |
| `packages/client-core/src/api.ts` | `FolioPaymentRow.tenderType?` (Task 1) |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | Auto-open §7 (Task 2) |
| `apps/web-pms/src/shell/ShiftStrip.test.tsx` | Spec §13.12–15 + existing tests vs auto-open (Task 2) |
| `apps/web-pms/src/screens/FolioScreen.tsx` | First paint / Advanced / tenders / copy / room code / charge names (Task 3) |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | Spec §13.4–11 (Task 3) |
| `docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md` | Pointer: P0-2 leftover closed by SPA auto-open (Task 4) |
| `DEMO-READY.md` | Tick P0-2 checkboxes (Task 4) |

## Test file split (spec §13 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 heads / catalog / schema / ddl | Task 5 CI | 5 |
| 3 payments GET `tenderType` | `folio-payments.spec.ts` + `cashiering.spec.ts` | 1 |
| 4–11 FolioScreen first paint / Advanced / tenders / copy | `FolioScreen.test.tsx` | 3 |
| 12–15 ShiftStrip auto-open | `ShiftStrip.test.tsx` | 2 |
| Pointer + DEMO-READY | spec + DEMO-READY.md | 4 |
| Full CI | Task 5 | 5 |

---

### Task 1: Expose `tenderType` on existing folio payments GET (own commit, no SPA)

**Spec:** §4.2, §9, §13.3. Keep `check:permissions` green (do not touch route audit).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `listPaymentsForReservation` (~14780)
- Modify: `packages/client-core/src/api.ts` — `FolioPaymentRow` (~90)
- Modify: `apps/pms-core/test/folio-payments.spec.ts` — HTTP list after card capture (~980)
- Modify: `apps/pms-core/test/cashiering.spec.ts` — after Test 1 cash post, list GET
- Test: `pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts test/cashiering.spec.ts`

**Interfaces:**

```ts
// FolioPaymentRow — add optional field (SPA fallback if omitted)
tenderType?: 'CARD' | 'CASH';

// listPaymentsForReservation payments[] item — add required
tenderType: 'CARD' | 'CASH';
```

**Forbidden this commit:** `v1-http-routes.ts`, `V1_ROUTES`, catalog, migrations, `FolioScreen.tsx`, `ShiftStrip.tsx`, `demo-seed.ts`, `CLASS_DENYLIST`, new `export class`.

- [ ] **Step 1: Write the failing assertions**

In `folio-payments.spec.ts`, the existing HTTP list after authorize→capture (~980) currently:

```ts
expect(listed.payments).toHaveLength(1);
```

Add:

```ts
expect(listed.payments[0]).toMatchObject({ tenderType: 'CARD' });
```

In `cashiering.spec.ts` Test 1 (cash captured, `gatewayReference` null), after the `readPayment` asserts, add an HTTP list (same headers / `worker.fetch` pattern as folio-payments ~980):

```ts
const listPay = await worker.fetch(
  new Request(
    `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/payments`,
    { headers: { 'x-dev-actor': owner } },
  ),
  env,
);
expect(listPay.status).toBe(200);
const listed = (await listPay.json()) as { ok: true; payments: Array<{ tenderType: string; paymentId: string }> };
expect(listed.payments).toEqual(
  expect.arrayContaining([expect.objectContaining({ paymentId, tenderType: 'CASH' })]),
);
```

Reuse the test’s existing `worker` / `env` imports (same file already HTTP-posts cash). If Test 1 has no `worker` in scope, call `stub.listPaymentsForReservation(reservationId)` instead and assert `listed.ok && listed.payments.some(p => p.paymentId === paymentId && p.tenderType === 'CASH')`. Prefer HTTP when `worker` is already in the file.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts test/cashiering.spec.ts
```

Expected: FAIL — `tenderType` undefined on list items.

- [ ] **Step 3: Minimal implementation**

`FolioPaymentRow` in `packages/client-core/src/api.ts`:

```ts
export type FolioPaymentRow = {
  paymentId: string;
  reservationId: string;
  amountMinor: number;
  currency: string;
  status: string;
  purpose?: 'STAY' | 'DAMAGE';
  gatewayReference: string | null;
  capturedAmountMinor: number | null;
  createdAt: number;
  updatedAt: number;
  tenderType?: 'CARD' | 'CASH';
  fxRate?: string | null;
  fxRateAt?: number | null;
  balanceAtRisk?: boolean;
  dispute?: {
    disputeId: string;
    status: 'open' | 'closed';
    reason: string;
    openedAt: number;
  } | null;
};
```

`listPaymentsForReservation` in `property-do.ts`:

1. Add `tenderType: 'CARD' | 'CASH'` to the success `payments` element type (next to `gatewayReference`).
2. Extend the SELECT:

```sql
SELECT payment_id, reservation_id, amount_minor, currency, status, purpose, gateway_reference,
       captured_amount_minor, created_at, updated_at, tender_type
  FROM payment WHERE reservation_id = ?
 ORDER BY created_at ASC
```

3. Map `tenderType: row.tender_type` on each item. Keep `purpose` and `dispute` as today. Do **not** drop fields. Do **not** switch the list onto `mapPaymentRow` if that would omit `purpose` / `dispute`.

No dispatcher change (`handleGetFolioPayments` already `json(result)`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/pms-core exec vitest run test/folio-payments.spec.ts test/cashiering.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-payments.spec.ts \
  apps/pms-core/test/cashiering.spec.ts \
  packages/client-core/src/api.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): include tenderType on folio payments list

EOF
)"
```

---

### Task 2: ShiftStrip auto-opens a cashier shift (own commit, no FolioScreen IA)

**Spec:** §7, §13.12–15. Existing `folio.open_shift` via `api.openShift`.

**Files:**
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Modify: `apps/web-pms/src/shell/ShiftStrip.test.tsx`
- Test: `pnpm --filter @hospai/web-pms exec vitest run src/shell/ShiftStrip.test.tsx`

**Interfaces:**

- Consumes: `canShowShellOpen(authority)`, `api.getOpenShift`, `api.openShift(propertyId, { shiftId, openingFloat })`, `parseMajorToMinor('100.00') === 10000`.
- Produces: one auto `openShift` per mount when query succeeded with `shift == null` and `showOpen`; `autoAttemptedRef` prevents a retry loop if GET still returns null.

**Forbidden this commit:** `FolioScreen.tsx`, `property-do.ts`, `demo-seed.ts`, route audit, catalog, new commands.

Default `renderStrip()` uses `{ kind: 'unknown' }`, which **does** auto-open (spec §7.1 fail-open). Update existing null-shift tests accordingly.

- [ ] **Step 1: Write the failing tests**

Add to `ShiftStrip.test.tsx` (need a live `folio:post` authority). After the existing imports, add:

```ts
const livePost: Authority = {
  kind: 'live',
  me: {
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_owner',
    role: 'owner',
    permissions: ['folio:read', 'folio:post'],
    orgPermissions: ['org:read'],
  },
};
```

New tests (spec §13.12–15):

1. **Auto-open once** — `getOpenShift` → `{ ok: true, shift: null }`; `openShift.mockResolvedValue({ ok: true })`; `renderStrip(livePost)`; `waitFor` `openShift` called **times 1**; `calls[0][1]` matches `{ openingFloat: 10000 }` (shiftId is `shift_*` string). `invalidateSpy` called with `{ queryKey: ['open-shift', 'prop_demo'] }`.
2. **Already-open** — `getOpenShift` → `{ ok: true, shift: { shiftId: 'shift_1', businessDate: '2099-01-01', openingFloat: 10_000, attributedCashCount: 0, status: 'OPEN' } }`; `renderStrip(livePost)`; `waitFor` open-shift-badge; `expect(openShift).not.toHaveBeenCalled()`.
3. **Fail-closed GET** — `getOpenShift.mockRejectedValue(new ClassifiedError({ class: 'fail_closed', status: 503, body: { degraded: 'FAIL_CLOSED' }, retryAfterMs: null }))`; `renderStrip(livePost)`; `waitFor` `/Shift unavailable — property unreachable/`; `expect(openShift).not.toHaveBeenCalled()`.
4. **Auto-open error leaves manual form** — `openShift.mockRejectedValue(new ClassifiedError({ class: 'client_error', status: 422, body: { error: 'money_invalid' }, retryAfterMs: null }))`; `getOpenShift` null; `renderStrip(livePost)`; `waitFor` `openShift` times 1; `getByRole('button', { name: /open shift/i })` still present; `getByText(/Open shift failed/i)`.

Update existing tests:

- **`withholds Open when authority pending`:** after render pending, `expect(openShift).not.toHaveBeenCalled()`.
- **`hides Open when live me lacks folio:post`:** `expect(openShift).not.toHaveBeenCalled()`.
- **`shows already-open copy`:** default unknown + null shift now auto-fires. Do **not** require a click. `waitFor` `/You already have an open shift/i` after auto-open’s `shift_already_open` rejection. Keep invalidate `open-shift` only. Remove the click (or keep it as a second call — prefer remove click so `toHaveBeenCalledTimes(1)`).
- **`mints open shiftId once across retries`:** auto-open is call 1 (same `money_invalid` mock). Then two clicks. Expect `toHaveBeenCalledTimes(3)` and all three `shiftId`s equal. Form still visible.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/ShiftStrip.test.tsx
```

Expected: FAIL — auto-open tests (`openShift` not called on live+null).

- [ ] **Step 3: Minimal implementation**

In `ShiftStrip.tsx`:

1. Change React import to `import { useEffect, useRef, useState } from 'react';`
2. After `openMut` (and after `showOpen` / `openQ` exist), add:

```tsx
const autoAttemptedRef = useRef(false);

useEffect(() => {
  if (autoAttemptedRef.current) return;
  if (!showOpen) return;
  if (!openQ.isSuccess) return;
  const body = openQ.data as { shift?: unknown } | undefined;
  if (!body || body.shift != null) return;
  autoAttemptedRef.current = true;
  openMut.mutate();
}, [showOpen, openQ.isSuccess, openQ.data, openMut]);
```

If including `openMut` in the dependency array retriggers after error, the **ref** still blocks a second auto. Do not clear the ref on error (spec: once per mount). Do not auto-open when `openQ.isError` (fail-closed returns before this effect’s success path because the component returns early on `openQ.isError` — effect still runs; `openQ.isSuccess` is false → no call).

3. Do **not** change opening-float default (`100.00`). Do **not** hide the manual form. Do **not** hide `shiftId` on the open badge (P0-3).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/ShiftStrip.test.tsx
```

Expected: PASS. If the effect double-invokes under Strict Mode, the ref must still yield **one** `openShift` (React 18 Strict Mode remounts — `useRef` resets on remount, so **two** calls can happen in Strict Mode). If the test file’s render is Strict Mode and you see times 2, assert `toHaveBeenCalled()` and that every call uses the same `openingFloat: 10000`, **or** wrap `renderStrip`’s `QueryClientProvider` without `React.StrictMode` (today’s tests do not wrap StrictMode — expect **1**).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/ShiftStrip.tsx apps/web-pms/src/shell/ShiftStrip.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): auto-open cashier shift for posting actors

EOF
)"
```

---

### Task 3: FolioScreen first paint is a bill + Advanced (own commit)

**Spec:** §3, §4, §5, §6, §8, §13.4–11.

**Files:**
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Test: `pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx`

**Interfaces:**

- Consumes: `api.listRooms` (already typed), `api.listChargeCodes` → `{ ok: true, codes: Array<{ code: string; name: string; status: string; taxGroup: string | null }> }`, `FolioPaymentRow.tenderType?`, existing folio mutations / testids.
- Produces: first-paint bill; `<details data-testid="folio-advanced">` default closed; tender rows without `paymentId` / `sim_` text.

**Forbidden this commit:** new CSS tokens, Tailwind, `ui-kit`, `demo-seed.ts`, route audit, last-4, gating cash, renaming testids.

#### 3.A Test mock wiring (do this first in the test file)

`FolioScreen` will call `api.listRooms` and `api.listChargeCodes`. If they are missing from the `vi.mock('../client.js')` `api` object, queries throw.

Add:

```ts
const listRooms = vi.fn();
const listChargeCodes = vi.fn();
```

Inside `api: { ... }`:

```ts
listRooms: (...args: unknown[]) => listRooms(...args),
listChargeCodes: (...args: unknown[]) => listChargeCodes(...args),
```

In `beforeEach` (after `vi.clearAllMocks()`):

```ts
listRooms.mockResolvedValue({ ok: true, rooms: [] });
listChargeCodes.mockResolvedValue({
  ok: true,
  codes: [{ code: 'MISC', name: 'Misc', status: 'active', taxGroup: null }],
});
```

Keep `getOpenShift.mockResolvedValue({ ok: true, shift: { shiftId: 's1' } })` as the default (happy path has a shift).

#### 3.B New / updated tests (write these so they fail on current FolioScreen)

Helper to read Advanced:

```ts
function advanced() {
  return screen.getByTestId('folio-advanced') as HTMLDetailsElement;
}
```

1. **First paint bill (spec §13.4)** — reservation `roomId: 'rm_101'`, `listRooms` → `{ rooms: [{ roomId: 'rm_101', code: '101', roomTypeId: 'rt', status: 'clean', floor: '1', createdAt: 1, updatedAt: 1, oooRanges: [] }] }`; folio one `miscLine`; guest batch resolved `{ kind: 'resolved', displayName: 'Ada Lovelace' }` (shape must match `GuestRowState`; if tests currently use `name_pending`, add `displayName` only when `kind: 'resolved'`). Assert:
   - `getByTestId('guest-profile-link').textContent` matches `/Ada Lovelace/`
   - text matches `2026-08-08` and `2026-08-10`
   - text matches `/\broom 101\b/` and **not** `/rm_101/`
   - `folio-balance`, `folio-lines` (text includes `Misc` and `50.00` — `formatMinor(5000)`), `add-charge`, `authorize-card`, `record-cash`
   - `advanced().open === false`

2. **Advanced descendants (spec §13.5)** — `getMe` → `ownerMe`; folio with windows so COMPANY controls render. Assert `folio-advanced` exists, `open === false`. `advanced().querySelector('[data-testid="open-company-window"]')` truthy. Same for `split-charge`, `chargeback-form`, `fx-rates-editor`. Queued heading: `advanced().textContent` matches `/Queued this reservation/`.

3. **Tenders hide ids (spec §13.6–7)** — reuse the void/refund payments fixture (`pay_auth` / `pay_cap`) plus a cash captured row `{ paymentId: 'pay_cash', amountMinor: 1500, currency: 'USD', status: 'captured', tenderType: 'CASH', gatewayReference: null, capturedAmountMinor: 1500, … }`. `pay_auth` has `gatewayReference: 'sim_pay_auth'`, `tenderType: 'CARD'`. After render:
   - `getByTestId('void-payment-pay_auth')` exists
   - `document.body.textContent` does **not** match `/pay_auth/` as visible **text** (testid attributes may contain it — assert on the tender `<li>` `textContent`: `voidEl.closest('li')!.textContent` matches `/Card/` and `/50\.00/` and does **not** match `/pay_auth/` or `/sim_/`)
   - cash row `textContent` matches `/Cash/` and `/15\.00/` and not `/pay_cash/`
   - no heading required; must **not** require first-paint headings `Holds` / `Captured` (query those strings on first paint — they may exist inside Advanced if you leave leftover copy; **do not** paint them outside Advanced). Simplest: delete those `<h2>Holds</h2>` / `<h2>Captured</h2>` or move inside Advanced; first paint uses **Tenders** or **Payments**.

4. **Happy-path copy (spec §13.8)** — default open shift. `queryByText(/unattributed until close discloses the count/i)` null. `queryByText(/simulate/i)` null.

5. **No-shift copy (spec §13.9)** — change the existing test `cash with no open shift: warning visible; mutation still fires`: keep `cash-no-shift-warn` + `record-cash` fires; assert `getByTestId('cash-no-shift-warn').textContent` matches `/^No open cashier shift\.?$/` (allow optional period). `queryByText(/unattributed until close discloses the count/i)` null. **Do not show the warn while `getOpenShift` is pending** — this test already resolves `{ shift: null }` immediately.

6. **Existing tests stay on the same testids (spec §13.10)** — do not rewrite `add-charge`, `authorize-card`, `check-out`, `window-chip-*`, `transfer-dest-*`, `void-payment-*`, `post-discount`, `line-fx`, `authorize-currency`, `print-reg-card`, `front-office-save`, `toggle-no-post`. They may sit under collapsed Advanced (`getByTestId` still finds them).

Staff chargeback `queryByTestId('chargeback-form')` remains **null** (not rendered without `folio:adjust`) — Advanced must not invent it.

- [ ] **Step 1: Write the failing tests** (3.A + 3.B)

- [ ] **Step 2: Run FolioScreen tests to verify new ones fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

Expected: FAIL — no `folio-advanced`; body still contains `pay_auth` / `sim_pay_auth` / `rm_101` / unattributed sentence / `MISC` without `Misc`.

- [ ] **Step 3: Implement FolioScreen**

**Queries to add** (next to existing `propertyQ` / `folioQ`):

```tsx
const roomsQ = useQuery({
  queryKey: ['rooms', propertyId],
  queryFn: () => api.listRooms(propertyId),
  enabled: Boolean(propertyId),
});
const chargeCodesQ = useQuery({
  queryKey: ['charge-codes', propertyId],
  queryFn: () => api.listChargeCodes(propertyId, { status: 'all' }),
  enabled: Boolean(propertyId),
});
```

Room code (spec §3.1 #3): if `reservationQ.data?.roomId` is set, look up `roomsQ.data?.rooms.find(r => r.roomId === reservationQ.data.roomId)?.code`. Paint ` · room ${code}` only when `code` is a non-empty string. If rooms GET failed or code missing: **omit** the room clause (do not fall back to `roomId`).

Charge description:

```ts
function chargeDescription(
  chargeCode: string,
  codes: Array<{ code: string; name: string }> | undefined,
): string {
  const hit = codes?.find((c) => c.code === chargeCode);
  return hit?.name ?? chargeCode;
}
```

Pass `(chargeCodesQ.data?.codes ?? []) as Array<{ code: string; name: string }>`.

Tender method (spec §4.2):

```ts
function tenderMethod(p: FolioPaymentRow): 'Card' | 'Cash' {
  if (p.tenderType === 'CASH') return 'Cash';
  if (p.tenderType === 'CARD') return 'Card';
  if (p.status === 'authorized') return 'Card';
  if (p.status === 'captured' && p.gatewayReference == null) return 'Cash';
  return 'Card';
}
```

Never interpolate `p.paymentId` or `p.gatewayReference` into visible text.

**Cash warning (spec §6, §7.2):**

```tsx
{openShiftQ.isSuccess &&
(openShiftQ.data as { shift?: unknown } | undefined)?.shift == null ? (
  <p className="muted" data-testid="cash-no-shift-warn">
    No open cashier shift.
  </p>
) : null}
```

Do **not** show this when `openShiftQ.isPending`.

**Return tree (normative order)** — keep `className="panel"`. Do not restyle.

```
div.panel
  Link ← In house
  h1 Folio
  header p: GuestNameLink · dates · status · room {code?}
  Book for guest (unchanged)
  folio-unread OR folio-balance (+ no-post-chip, balance-at-risk, held-on-card)
  section Tenders | Payments
    authorized + captured rows (method + amount; capture input; void/refund)
    do not print paymentId / gatewayReference
  section Lines  (data-testid=folio-lines)
    description + formatMinor(ledgerAmountMinor)
    nested tax: "Tax" + amount  (no taxRuleId)
    no source, no transfer, no line-fx
  section Post charge  (h2 may be "Post charge"; button still "Add charge")
    charge-code, charge-amount, add-charge
  section Take payment
    cash-no-shift-warn (if applicable)
    cash-amount, record-cash
    auth-amount, authorize-card  (visible label "Charge card" or "Take card"; testid authorize-card)
  check-out (+ checkout-outage-copy)
  folio-message
  details data-testid="folio-advanced"   // NO open attribute
    summary: Advanced
    toggle-no-post
    FrontOfficeEditor
    PrintRegCardControl + RegistrationCard
    Windows + open-company-window + billed party
    capture-due
    for each live root: line-fx (if foreign) + transfer-dest + transfer-line
    Queued this reservation (+ other queued)
    Split charge / split payment
    Discount
    chargeback-form
    fx-adjustment-form
    fx-rates-editor
    cash-currency + authorize-currency
    indicative FX muted copy
```

**Duplicate testid rule:** `transfer-dest-*`, `line-fx`, `open-company-window` must appear **once**. First-paint lines omit them; Advanced owns them.

If `windows.length === 0` and `canAdjust`, the empty-windows Open COMPANY block also lives in Advanced (testid still `open-company-window`).

Button labels:

- Authorize button visible text: **Charge card** (testid `authorize-card`).
- Cash button: **Take cash** or keep **Record cash** (testid `record-cash` — either label is in spec §3.1 #8).

Do not title a first-paint `<h2>Authorize card</h2>`.

Capture-due, FO editor, reg card, no-post **toggle**, split, discount, FX, chargeback, queued dump, currency selects: **only** inside Advanced.

- [ ] **Step 4: Run FolioScreen tests to verify they pass**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

Expected: PASS (including policy C, checkout queued copy, staff void, discount reason, transfer dest, window chips, line-fx, authorize-currency, print-reg-card, front-office-save).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/FolioScreen.tsx apps/web-pms/src/screens/FolioScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): folio first paint is a bill

EOF
)"
```

---

### Task 4: Pointers + DEMO-READY P0-2 ticks (docs commit)

**Spec:** Amends paragraph; §10; §15 last bullets. No product code.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md`
- Modify: `DEMO-READY.md`

- [ ] **Step 1: Demo-seed pointer**

In `2026-08-13-demo-tenant-seed-design.md` §1.3 first bullet, replace the P0-2 leftover sentence with:

```
- **P0-2 folio first-paint / Advanced / shift auto-open.** **Closed 2026-08-13** by [folio first-paint](./2026-08-13-folio-first-paint-design.md) (SPA `ShiftStrip` auto-open; seed still does not open a shift).
```

In §5.7, change `- Cashier shift (P0-2).` to:

```
- Cashier shift — **closed 2026-08-13** by folio first-paint SPA auto-open (seed still does not `folio.open_shift`).
```

In §11 leftover table row 1, change Notes from `Next slice` to:

```
**Closed 2026-08-13** by [folio first-paint](./2026-08-13-folio-first-paint-design.md) (SPA auto-open, not seed).
```

Do **not** add `tryOpenShift` to `demo-seed.ts`.

- [ ] **Step 2: Tick DEMO-READY P0-2**

In `DEMO-READY.md` P0-2, mark all five checkboxes `[x]`. Add one line under the list:

```
Closed 2026-08-13 by [folio first-paint](docs/superpowers/specs/2026-08-13-folio-first-paint-design.md).
```

Do not tick P0-3 / P0-4 / P0-5. Do not rewrite ARCHITECTURE.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md DEMO-READY.md
git commit -m "$(cat <<'EOF'
docs: tick P0-2 folio first-paint and close seed shift leftover

EOF
)"
```

---

### Task 5: CI / checks job

**Spec:** §2, §13.1–2, §13.11.

- [ ] **Step 1: Hygiene pins**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
git diff --exit-code -- migrations/do-property migrations/do-org packages/do-runtime
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
git diff --exit-code -- packages/contracts/src/v1-http-routes.ts packages/contracts/src/commands
```

Expected: empty diffs. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `[127]=post_demo_seed` still last. `CLASS_DENYLIST` untouched.

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

Expected: all exit 0.

- [ ] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 6: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–6 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [ ] **Step 1: Mark checkboxes**
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-folio-first-paint.md
git commit -m "$(cat <<'EOF'
docs: tick folio first-paint plan checkboxes after merge

EOF
)"
```

---

## Spec §16 acceptance / reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state table matches the tree (FolioScreen paints `roomId` / `paymentId` / unattributed sentence / Open COMPANY / queued dump on first load; payments GET omits `tenderType`; seed does not open a shift; catalog **77**, route **127**, property head **25**, org head **7**). *(Pre-implementation; after merge the first-paint bullets are closed.)*
- [ ] Normative invariants include integer money, append-only folio, schema freeze, no new routes/commands/`export class`, testid stability, no simulate/unattributed/`paymentId` on the happy path.
- [ ] **Exactly** what is on first paint (spec §3) vs Advanced (spec §5, including §5.2).
- [ ] Tenders: amount + method; last-4 deferred to P1; no fake PAN; `tenderType` on existing GET.
- [ ] Demo-actor shift: SPA auto-open on `ShiftStrip` via existing `folio.open_shift`; not seed; not a new command; once per mount; Folio warning copy replaced.
- [ ] Scope-out names **P0-3**, **P0-4**, **P0-5**, prototype rebuild, Worker routes/commands, new tables/schema, real PSP/PCI, last-4, seed charges.
- [ ] Folded leftovers spec §11 and deferred leftovers spec §12 both present in the spec; this plan does not implement deferred rows.
- [ ] Acceptance tests spec §13 green.
- [ ] `data-testid`s in spec §8 remain. New id only `folio-advanced`.
- [ ] DEMO-READY P0-2 ticked. Demo-seed leftover row 1 closed by pointer. No ARCHITECTURE rewrite. No `demo-seed` shift.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| `tenderType` on existing payments GET §4.2 / §13.3 | 1 |
| ShiftStrip auto-open §7 / §13.12–15 | 2 |
| First paint §3 (guest, dates, room code, balance, lines, post, card, cash, checkout) | 3 |
| Tenders hide `paymentId` / `sim_*` §4 / §13.6–7 | 3 |
| Advanced collapsed §5 / §13.5 (incl. §5.2 extras) | 3 |
| Copy §6 / §13.8–9 | 3 |
| Testid contract §8 / §13.10 | 3 |
| Room code via `get_rooms`; names via `get_charge_codes` | 3 |
| Demo-seed pointer + DEMO-READY P0-2 ticks | 4 |
| Heads freeze, ddl no-op, full CI, colors | 5 |
| Plan checkboxes | 6 |
| P0-3 / P0-4 / P0-5 / last-4 / seed shift / new routes | all (forbidden) |
