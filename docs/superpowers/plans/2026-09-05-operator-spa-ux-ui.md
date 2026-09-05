# Operator SPA UX + UI (R0.11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **U4–U17**, **I1–I15**, **E3**, **Q4**, **Q18**, **Q19**, **L12** — one accessible page shell, one `.app-modal` confirm overlay, operator-grade error copy, honest Settings, and clerk-safe checkout messaging — **without** restyling `tokens.css`, adding Playwright, releasing `sold` on checkout, or bumping catalog/schema pins.

**Architecture:** Characterization tests land **first** (Task 1) and must fail on current `main` for RateCell visible labels, dual `<h1>` landmarks, board mode titles, hardcoded hotel subtitles, roster nav over-gate, checkout remaining-nights warning, and hidden Booking settings keys. Task 2 lands shared primitives (`ConfirmDialog`, `usePropertySubtitle`, `VisuallyHidden` RateCell, sidebar brand demotion, board `PageHeader` titles) plus void destructive confirms. Task 3 sweeps night audit, print CSS, Settings hide, checkout warning, `classifiedUserMessage` + `Alert` migration, desk polish, and sign-in MFA copy. Task 4 runs full CI and ticks **R0.11** only. SPA-only — no pms-core routes, commands, or pin changes.

**Tech Stack:** React 19 SPA (`apps/web-pms`), `@hospai/ui-kit`, hand-written CSS (`apps/web-pms/src/styles.css`), vitest + Testing Library, `@hospai/pms-housekeeping` module UI, merge-blocking `pnpm check:spa-page-chrome`.

**Spec:** `docs/superpowers/specs/2026-09-05-operator-spa-ux-ui-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged (no new routes) |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. SPA-only vertical — no catalog, schema, or route audit length change.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **I1 RateCell** | Matrix cell `Field` label via ui-kit `VisuallyHidden`: `` `Rate for ${code} on ${stayDate}` ``. Visible cell shows numbers only. Pattern: `GuestsDirectoryScreen.tsx:158` (`<span className="ui-visually-hidden">`). |
| **I2 I4 I5 Page chrome** | Sidebar brand is `<p className="app-sidebar-title">`, not `<h1>` (`AppShell.tsx:283`). Each route's **single** `<h1>` is `PageHeader`. Board modes: **Arrivals** / **Departures** / **In house** — not all "Front Desk" (`BoardScreen.tsx:610–615`). Subtitles use live `property.name` from `getProperty`; delete hardcoded "The Meridian Seattle" on Staff, Roster, Exceptions, Guests (`StaffScreen.tsx:293`, `RosterScreen.tsx:134`, `ExceptionsScreen.tsx:306`, `GuestsDirectoryScreen.tsx:153`). |
| **I3 One Dialog** | One overlay: `.app-modal` (`LogoutModal.tsx:17–43`). Migrate **in this vertical:** `RatesScreen.tsx:1153` archive `Card role=dialog`, `GuestProfileScreen.tsx:378` erase overlay, `ExceptionsScreen.tsx:692` native `<dialog>`. **ConfirmDialog is** the `.app-modal` wrapper — **not** a fourth overlay. Focus first control; Escape closes; body scroll lock. Void invoice / void payment **must** use `ConfirmDialog` with `intent=destructive` (**U6**). |
| **U4 U5 U6 Night audit + print + void** | `NightAuditScreen`: mutation success/failure → `Alert`; when Run disabled (`runDisabled` at `NightAuditScreen.tsx:122–127`), show **why** adjacent to button. Print CSS: `@media print` hides everything except `.reg-card` (today `styles.css:825–844` hides sidebar but **not** folio body). Registration card never prints `reservation.roomId` UUID — room **code** only (`registration-card.tsx:20`). |
| **U7 / L12 Booking settings** | Hide Settings controls for keys pms-core never reads: `pms.booking.same_day_bookings`, `pms.booking.same_day_cutoff`, `pms.booking.require_prepayment`, `pms.booking.booking_date_change` (`SettingsScreen.tsx:732–756`). **Do not wire them.** |
| **U17 Checkout warning** | If `departureDate > businessDate` at checkout: show `Alert` (informational): `Checkout does not release remaining nights — shorten the stay first.` Proceed with checkout if clerk confirms (existing balance/invoice gates unchanged). **Do not** change `departure_date`, release `sold`, or PATCH departure in the SPA (**L6 / R0.14**). |
| **classifiedUserMessage + Alerts** | Replace `JSON.stringify(err.classified.body)` (`CityLedgerScreen.tsx:147,173,196,224`), `` `Request failed (${c.class})` `` (`StaffScreen.tsx:103`, `InventoryScreen.tsx:109`), bare mutation `<p data-testid="folio-message">` (`FolioScreen.tsx:1642`), and raw JSON exception payload (`ExceptionsScreen.tsx:604`) with `classifiedUserMessage` + ui-kit `Alert`. Never `JSON.stringify` classified body to operators. |
| **U16 Roster nav** | `nav.ts:25` permission → `roster:read`; `App.tsx:64` route → `<PermissionRoute permission="roster:read" />`. Mutations inside `RosterScreen` stay gated on `roster:write`. |
| **U15 Permission toast** | On deny, toast `You don't have access to that page.` then `Navigate` to fallback — not silent redirect (`PermissionRoute.tsx:48–49` today). No ui-kit toast exists; add minimal shell toast (aria-live region, see Task 3). |
| **U10 Book FAIL_CLOSED** | When any prerequisite query is `fail_closed`, disable Hold / Quote / Confirm with `Alert` `Booking unavailable — property unreachable.` Fix test `FAIL_CLOSED room-types still lists ids and does not block Confirm` (`BookingScreen.test.tsx:847`) → **must expect Confirm disabled**. |
| **I13 Sign-in MFA** | Drop sentence "Use the demo user." (`SignInScreen.tsx:125`). Keep marketing column; do not copy sign-in shadows into `AppShell`. |
| **Out** | Restyle `tokens.css` / global visual rewrite; Playwright; occupancy chart colors; new HTTP routes/commands; catalog/schema pin changes; release `sold` on checkout; wire hidden Booking keys; ui-kit `Dialog` export. |
| **TDD** | Task 1 tests must **fail on current `main`** for the listed assertions. Do **not** invert tests to encode today's bugs. |
| **Verify** | `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. **Never put `--` before `--shard`**. Also `pnpm check:spa-page-chrome` when `PageHeader` / board titles change. |
| **Pins / roadmap** | No pin bump in Tasks 1–3. Tick **R0.11** only in Task 4. |

---

## Sequencing gate

```
Task 1 (red tests: RateCell, chrome h1, roster:read nav, checkout warning copy, booking keys hidden)
→ Task 2 (chrome + RateCell + ConfirmDialog migrations I1–I3, U6 voids)
→ Task 3 (night audit Alerts, print CSS, hide Booking keys, checkout warning U17, classifiedUserMessage/Alerts sweep, polish U9–U16, I13)
→ Task 4 (full CI + tick R0.11)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1, T3–T8, T12, T15, T19, T26–T28 scope). Task 2 makes chrome + RateCell + ConfirmDialog + void confirms green. Task 3 makes night audit, print, settings hide, checkout warning, error sweep, polish, and sign-in green. Task 4 runs full CI + ticks roadmap **R0.11** only.

---

## File map (spec §6 — implementers touch these)

| File | Task | Change |
|---|---|---|
| `apps/web-pms/src/shell/ConfirmDialog.tsx` | 2 | **New** — shared `.app-modal` confirm |
| `apps/web-pms/src/shell/use-property-subtitle.ts` | 2 | **New** — live hotel name hook |
| `apps/web-pms/src/copy/night-audit-step-labels.ts` | 3 | **New** — clerk step labels |
| `apps/web-pms/src/shell/PermissionDenyFlash.tsx` | 3 | **New** — aria-live toast for U15 |
| `apps/web-pms/src/status/board-page-title.ts` | 2 | **New** — mode → PageHeader title map |
| `apps/web-pms/src/shell/AppShell.tsx` | 2 | I2 sidebar brand `<p>` |
| `apps/web-pms/src/shell/icons.tsx` | 3 | I15 distinct roster icon |
| `apps/web-pms/src/shell/nav.ts` | 1+2 | U16 roster `roster:read` (test Task 1; impl Task 2) |
| `apps/web-pms/src/auth/PermissionRoute.tsx` | 3 | U15 toast on deny |
| `apps/web-pms/src/App.tsx` | 2 | U16 roster route permission |
| `apps/web-pms/src/styles.css` | 3 | U5 print CSS |
| `apps/web-pms/src/screens/RatesScreen.tsx` | 2 | I1 VisuallyHidden, I3 archive dialog |
| `apps/web-pms/src/screens/BoardScreen.tsx` | 2+3 | I5 titles, Q18 EmptyState/Alert |
| `apps/web-pms/src/screens/StaffScreen.tsx` | 2+3 | I4 subtitle, I7 errors, I3 confirm |
| `apps/web-pms/src/screens/RosterScreen.tsx` | 2+3 | I4 subtitle, I3 confirm |
| `apps/web-pms/src/screens/ExceptionsScreen.tsx` | 2+3 | I4 subtitle, I3/I7, Q19 payload |
| `apps/web-pms/src/screens/GuestsDirectoryScreen.tsx` | 2 | I4 subtitle |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | 2 | I3 erase dialog |
| `apps/web-pms/src/screens/NightAuditScreen.tsx` | 3 | U4, U12 labels + halt copy |
| `apps/web-pms/src/screens/registration-card.tsx` | 3 | U5/I6 room code, I14 badges |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 2+3 | U6 voids, U17 warning, E3, tenders table |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | 3 | U5 print path, I15 back copy |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | 3 | U7/L12 hide four keys |
| `apps/web-pms/src/screens/BookingScreen.tsx` | 3 | U10 FAIL_CLOSED, U14 search copy |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | 3 | Q4 Alert, I12 scroll |
| `apps/web-pms/src/screens/CityLedgerScreen.tsx` | 2+3 | U11/Q19 errors + statement |
| `apps/web-pms/src/screens/InventoryScreen.tsx` | 3 | U11 errors, EmptyState/Skeleton |
| `apps/web-pms/src/screens/ShiftScreen.tsx` | 3 | Q18 Alert |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | 3 | Q18 Alert if bare `<p>` remains |
| `apps/web-pms/src/screens/front-office-editor.tsx` | 3 | I14 badges |
| `apps/web-pms/src/screens/SignInScreen.tsx` | 3 | I13 MFA copy |
| `apps/web-pms/src/screens/guest-row.tsx` | 3 | U13 name-only display |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | 3 | U9 assign helper |
| `docs/roadmap.md` | 4 | Tick **R0.11** only |
| Test files per spec §4 | 1–3 | T1–T31 |

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Modify: `apps/web-pms/src/screens/RatesScreen.test.tsx`
- Modify: `apps/web-pms/src/shell/AppShell.me.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/StaffScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/RosterScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/GuestsDirectoryScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/ExceptionsScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/SettingsScreen.test.tsx`
- Modify: `apps/web-pms/src/auth/PermissionRoute.test.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts`

**Interfaces:** none (tests only). New modules (`ConfirmDialog`, `usePropertySubtitle`) do not exist until Task 2 — tests assert DOM/copy behaviour only.

These tests **must fail on current `main`** before Task 2 lands.

### Step 1 — T1 RateCell: no visible "Rate for" text

Add to `RatesScreen.test.tsx`:

```tsx
it('T1: rate matrix cells have no visible Rate for label text', async () => {
  renderRates('/rates/matrix?from=2026-08-13&to=2026-08-26');
  await screen.findAllByLabelText(/Rate for KNG on/i);
  expect(screen.queryByText(/^Rate for KNG$/)).toBeNull();
  expect(document.querySelector('.ui-visually-hidden, .ui-visually-hidden *')).toBeTruthy();
});
```

Keep existing `findAllByLabelText('Rate for KNG')` blur test — update label matcher to `/Rate for KNG on/i` once Task 2 lands sr-only date segment.

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx -t "T1:"
```

Expected: **FAIL** — visible label text or missing sr-only wrapper.

### Step 2 — T3 sidebar brand is not h1

Add to `AppShell.me.test.tsx`:

```tsx
it('T3: sidebar brand is p not h1', async () => {
  getMe.mockResolvedValue(liveOwner);
  renderShell('/arrivals');
  await waitFor(() => expect(screen.getByText('board-outlet')).toBeTruthy());
  expect(document.querySelector('.app-sidebar-brand h1')).toBeNull();
  expect(document.querySelector('.app-sidebar-brand p.app-sidebar-title')).toBeTruthy();
});
```

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/shell/AppShell.me.test.tsx -t "T3:"
```

Expected: **FAIL** — `AppShell.tsx:283` still renders `<h1 className="app-sidebar-title">`.

### Step 3 — T4 board PageHeader titles match route mode

Replace or extend `BoardScreen.test.tsx` test `'shows Front Desk page title…'`:

```tsx
it.each([
  ['/arrivals', 'Arrivals'],
  ['/departures', 'Departures'],
  ['/in-house', 'In house'],
] as const)('T4: %s PageHeader h1 is %s', async (path, title) => {
  renderBoard(path);
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy(),
  );
  expect(screen.queryByRole('heading', { level: 1, name: 'Front Desk' })).toBeNull();
});
```

Expected: **FAIL** — all three routes show h1 "Front Desk" today.

### Step 4 — T5–T8 live property name subtitles (not Meridian Seattle)

Add parallel tests (pattern identical; one example):

```tsx
// StaffScreen.test.tsx
it('T5: subtitle uses live property name not hardcoded Meridian', async () => {
  getProperty.mockResolvedValue({
    property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
  });
  renderStaff();
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Staff' })).toBeTruthy(),
  );
  expect(screen.getByText(/Harbor Inn/)).toBeTruthy();
  expect(screen.queryByText(/Meridian Seattle/)).toBeNull();
});
```

Repeat for `RosterScreen.test.tsx` (T6), `GuestsDirectoryScreen.test.tsx` (T7), `ExceptionsScreen.test.tsx` (T8).

Expected: **FAIL** — hardcoded "The Meridian Seattle" in PageHeader subtitles.

### Step 5 — T15 checkout remaining-nights warning

Add to `FolioScreen.test.tsx`:

```tsx
it('T15: shows remaining-nights warning when departure after business date', async () => {
  reservationMock({
    status: 'checked_in',
    arrivalDate: '2026-08-10',
    departureDate: '2026-08-15',
  });
  businessDateMock('2026-08-12');
  renderFolio();
  await waitFor(() =>
    expect(
      screen.getByText(/Checkout does not release remaining nights — shorten the stay first/i),
    ).toBeTruthy(),
  );
});
```

Use existing folio test helpers for reservation + business date mocks.

Expected: **FAIL** — no warning Alert today (`FolioScreen.tsx:712–745` checkout path).

### Step 6 — T19 four L12 Booking settings keys absent

Add to `SettingsScreen.test.tsx`:

```tsx
it('T19: unread booking settings keys are not rendered', async () => {
  renderSettingsProperty();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Booking' })).toBeTruthy());
  for (const key of [
    'pms.booking.same_day_bookings',
    'pms.booking.same_day_cutoff',
    'pms.booking.require_prepayment',
    'pms.booking.booking_date_change',
  ]) {
    expect(document.querySelector(`[data-config-key="${key}"]`)).toBeNull();
  }
  expect(screen.queryByLabelText(/Same-day bookings/i)).toBeNull();
  expect(screen.queryByLabelText(/Require prepayment/i)).toBeNull();
});
```

If `DomainBool` / `DomainText` lack `data-config-key`, assert by label text instead (as above).

Expected: **FAIL** — four controls visible at `SettingsScreen.tsx:732–756`.

### Step 7 — T26–T27 roster:read nav and route gate

Add to `me.test.ts`:

```tsx
it('T27: roster:read without write shows Roster nav', () => {
  const me = {
    ok: true as const,
    permissions: ['roster:read'] as const,
    /* …minimal live me fields… */
  };
  const entries = filterNavEntries(me, 'prop_demo');
  expect(entries.some((e) => e.id === 'roster')).toBe(true);
});
```

Add to `PermissionRoute.test.tsx`:

```tsx
it('T26: roster:read can render /roster outlet', async () => {
  renderPermissionRoute('/roster', {
    permission: 'roster:read',
    mePermissions: ['roster:read'],
  });
  await waitFor(() => expect(screen.getByTestId('roster-outlet')).toBeTruthy());
});
```

Expected: **FAIL** — `nav.ts:25` requires `roster:write`; `App.tsx:64` same.

### Step 8 — Run Task 1 red suite

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/RatesScreen.test.tsx \
  src/shell/AppShell.me.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/StaffScreen.test.tsx \
  src/screens/RosterScreen.test.tsx \
  src/screens/GuestsDirectoryScreen.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/SettingsScreen.test.tsx \
  src/auth/PermissionRoute.test.tsx \
  src/auth/me.test.ts \
  -t "T1:|T3:|T4:|T5:|T6:|T7:|T8:|T15:|T19:|T26:|T27:"
```

Expected: listed tests **FAIL**; unrelated tests in those files stay **green**.

### Step 9 — Commit (tests only)

```bash
git add apps/web-pms/src/screens/RatesScreen.test.tsx \
  apps/web-pms/src/shell/AppShell.me.test.tsx \
  apps/web-pms/src/screens/BoardScreen.test.tsx \
  apps/web-pms/src/screens/StaffScreen.test.tsx \
  apps/web-pms/src/screens/RosterScreen.test.tsx \
  apps/web-pms/src/screens/GuestsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/ExceptionsScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/screens/SettingsScreen.test.tsx \
  apps/web-pms/src/auth/PermissionRoute.test.tsx \
  apps/web-pms/src/auth/me.test.ts
git commit -m "test(web-pms): R0.11 red tests for chrome, RateCell, roster nav, checkout warn, settings hide"
```

---

## Task 2 — Chrome + RateCell + ConfirmDialog (I1–I3, U6 voids)

**Files:**
- Create: `apps/web-pms/src/shell/ConfirmDialog.tsx`
- Create: `apps/web-pms/src/shell/use-property-subtitle.ts`
- Create: `apps/web-pms/src/status/board-page-title.ts`
- Modify: `apps/web-pms/src/shell/AppShell.tsx:281–284`
- Modify: `apps/web-pms/src/screens/RatesScreen.tsx:157–186`, `:1153+`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx:610–616`
- Modify: `apps/web-pms/src/screens/StaffScreen.tsx`, `RosterScreen.tsx`, `ExceptionsScreen.tsx`, `GuestsDirectoryScreen.tsx` (subtitles)
- Modify: `apps/web-pms/src/screens/GuestProfileScreen.tsx:378+`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (void invoice/payment confirms)
- Modify: `apps/web-pms/src/shell/nav.ts:25`
- Modify: `apps/web-pms/src/App.tsx:64`

**Interfaces:**
- **Produces:** `ConfirmDialog(props)` — portal `.app-modal`; props `{ title, description, confirmLabel?, cancelLabel?, intent?: 'destructive' | 'primary', onConfirm, onCancel }`.
- **Produces:** `usePropertySubtitle(prefix: string)` → `{ subtitle: string }` using `useQuery(['property', propertyId], api.getProperty)`; omits name segment when `failClosed`.
- **Produces:** `boardPageTitle(mode: BoardMode): string` → `'Arrivals' | 'Departures' | 'In house'`.

### Step 1 — Create `ConfirmDialog.tsx`

Extract from `LogoutModal.tsx` pattern:

```tsx
import { Button } from '@hospai/ui-kit';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: 'destructive' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  intent = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="app-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="app-modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="app-modal__panel app-modal__panel--compact">
        <header className="app-modal__head">
          <h2 id="confirm-dialog-title">{title}</h2>
        </header>
        <p className="muted">{description}</p>
        <footer className="app-modal__foot app-modal__foot--end">
          <div className="app-modal__actions">
            <Button ref={cancelRef} type="button" intent="default" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              intent={intent === 'destructive' ? 'destructive' : 'primary'}
              data-testid="confirm-dialog-confirm"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
```

### Step 2 — Create `use-property-subtitle.ts`

```tsx
import { useQuery } from '@tanstack/react-query';
import { asClassified, api, tenant } from '../client.js';

export function usePropertySubtitle(prefix: string): { subtitle: string } {
  const propertyId = tenant.propertyId;
  const q = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const failClosed = q.isError && asClassified(q.error).class === 'fail_closed';
  const name =
    !failClosed && q.data && 'property' in q.data ? q.data.property.name : null;
  return { subtitle: name ? `${prefix} · ${name}` : prefix };
}
```

### Step 3 — Create `board-page-title.ts`

```tsx
import type { BoardMode } from './board-mode.js';

const TITLES: Record<BoardMode, string> = {
  arrivals: 'Arrivals',
  departures: 'Departures',
  'in-house': 'In house',
};

export function boardPageTitle(mode: BoardMode): string {
  return TITLES[mode];
}
```

### Step 4 — I2 demote sidebar h1 → p

In `AppShell.tsx:283`:

```tsx
<p className="app-sidebar-title">
  HospAI <span>PMS</span>
</p>
```

### Step 5 — I1 RateCell VisuallyHidden label

In `RatesScreen.tsx`, import `VisuallyHidden` from `@hospai/ui-kit` and change `RateCell`:

```tsx
<Field
  label={
    <VisuallyHidden>{`Rate for ${props.code} on ${props.stayDate}`}</VisuallyHidden>
  }
  control={/* unchanged Input */}
/>
```

Update matrix tests to use `/Rate for ${code} on/i` label matcher.

### Step 6 — I5 Board PageHeader title from mode

In `BoardScreen.tsx`:

```tsx
import { boardPageTitle } from '../status/board-page-title.js';

<PageHeader
  title={boardPageTitle(mode)}
  subtitle={
    headerDate
      ? `${formatLongDate(headerDate, timeZone ?? 'UTC')} · ${boardPageTitle(mode).toLowerCase()} for the business date`
      : undefined
  }
  /* actions unchanged */
/>
```

Optionally append live property name via `usePropertySubtitle` when hotel is named in subtitle (spec I4 on board).

### Step 7 — I4 live subtitles on directory screens

Replace hardcoded subtitles:

```tsx
// StaffScreen.tsx
const { subtitle } = usePropertySubtitle('Team members');
<PageHeader title="Staff" subtitle={subtitle} />
```

Same pattern: Roster `'Scheduled staff'`, Exceptions `'Open operational exceptions'`, Guests `'Guest directory'`.

### Step 8 — I3 migrate three broken overlays to ConfirmDialog

**RatesScreen archive** — replace `<Card role="dialog">` block with state-driven `<ConfirmDialog title="Archive rate plan?" … intent="destructive" />`.

**GuestProfileScreen erase** — replace `<div role="dialog">` with `ConfirmDialog`.

**ExceptionsScreen** — replace `<dialog open>` confirm with `ConfirmDialog`; remove native dialog element.

### Step 9 — U6 void invoice + void payment destructive confirm

In `FolioScreen.tsx`, replace:

```tsx
if (!window.confirm('Void this invoice? This cannot be undone.')) {
```

with `ConfirmDialog` state:

```tsx
const [voidInvoiceOpen, setVoidInvoiceOpen] = useState(false);
// onClick → setVoidInvoiceOpen(true)
// ConfirmDialog title="Void this invoice?" description="This cannot be undone." intent="destructive"
```

Same for void payment path. Add T16 test:

```tsx
it('T16: void invoice uses ConfirmDialog not window.confirm', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm');
  /* render folio with voidable invoice, click void */
  expect(await screen.findByRole('dialog', { name: /Void this invoice/i })).toBeTruthy();
  expect(confirmSpy).not.toHaveBeenCalled();
});
```

### Step 10 — U16 roster:read nav + route

`nav.ts`:

```tsx
{ id: 'roster', label: 'Roster', path: '/roster', order: 120, permission: 'roster:read', tone: 'quiet' },
```

`App.tsx`:

```tsx
<Route path="roster" element={<PermissionRoute permission="roster:read" />}>
```

Keep write mutations gated inside `RosterScreen` on `hasPropertyPermission(me, 'roster:write')`.

### Step 11 — Verify Task 2

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/RatesScreen.test.tsx \
  src/shell/AppShell.me.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/StaffScreen.test.tsx \
  src/screens/RosterScreen.test.tsx \
  src/screens/GuestsDirectoryScreen.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/auth/PermissionRoute.test.tsx \
  src/auth/me.test.ts \
  -t "T1:|T3:|T4:|T5:|T6:|T7:|T8:|T16:|T26:|T27:"
pnpm check:spa-page-chrome
```

Expected: Task 1 reds **green**; spa-page-chrome **green**.

### Step 12 — Commit

```bash
git add apps/web-pms/src/shell/ConfirmDialog.tsx \
  apps/web-pms/src/shell/use-property-subtitle.ts \
  apps/web-pms/src/status/board-page-title.ts \
  apps/web-pms/src/shell/AppShell.tsx \
  apps/web-pms/src/screens/RatesScreen.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx \
  apps/web-pms/src/screens/StaffScreen.tsx \
  apps/web-pms/src/screens/RosterScreen.tsx \
  apps/web-pms/src/screens/ExceptionsScreen.tsx \
  apps/web-pms/src/screens/GuestsDirectoryScreen.tsx \
  apps/web-pms/src/screens/GuestProfileScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/shell/nav.ts \
  apps/web-pms/src/App.tsx
git commit -m "feat(web-pms): R0.11 chrome, RateCell sr-only, ConfirmDialog, roster read nav, void confirms"
```

---

## Task 3 — Night audit, print, settings hide, checkout warn, errors, polish, sign-in

**Files:**
- Create: `apps/web-pms/src/copy/night-audit-step-labels.ts`
- Create: `apps/web-pms/src/shell/PermissionDenyFlash.tsx`
- Create: `apps/web-pms/src/screens/registration-card.test.tsx`
- Create: `apps/web-pms/src/screens/front-office-editor.test.tsx`
- Modify: `apps/web-pms/src/styles.css:825–844`
- Modify: `apps/web-pms/src/screens/NightAuditScreen.tsx`
- Modify: `apps/web-pms/src/screens/registration-card.tsx`
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx:726–759`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (U17 warning, E3 Alert, tenders DataTable, back copy, remaining window.confirm → ConfirmDialog)
- Modify: `apps/web-pms/src/screens/CityLedgerScreen.tsx`, `InventoryScreen.tsx`, `StaffScreen.tsx`
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx`, `ShiftScreen.tsx`, `ShiftStrip.tsx`
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx`, `BookingScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` (SectionCard → Alert/EmptyState)
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx`, `front-office-editor.tsx`, `guest-row.tsx`
- Modify: `apps/web-pms/src/screens/SignInScreen.tsx`, `SignInScreen.test.tsx`
- Modify: `apps/web-pms/src/auth/PermissionRoute.tsx`
- Modify: `apps/web-pms/src/shell/icons.tsx`, `AppShell.tsx` (search aria-label I10)
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`

**Interfaces:**
- **Consumes:** `ConfirmDialog`, `usePropertySubtitle`, `classifiedUserMessage` from `@hospai/client-core` path `../copy/classified-user-message.js`.
- **Produces:** `STEP_LABELS: Record<string, string>` in `night-audit-step-labels.ts`.
- **Produces:** `PermissionDenyFlash` — sets session flash consumed by `AppShell` aria-live region.

### Step 1 — U4 Night audit Alerts + disabled Run reason

Create `night-audit-step-labels.ts`:

```tsx
export const STEP_LABELS: Record<string, string> = {
  PRE_CHECK: 'Pre-check',
  AUTO_NO_SHOW: 'Auto no-show',
  POST_ROOM_CHARGES: 'Post room charges',
  AUTO_TRANSFER: 'Auto transfer',
  CLOSE_FOLIOS: 'Close folios',
  SHIFT_RECONCILE: 'Shift reconcile',
  GENERATE_REPORTS: 'Generate reports',
  ROLL_BUSINESS_DATE: 'Roll business date',
};
```

In `NightAuditScreen.tsx`, add helper:

```tsx
function runDisabledReason(
  status: NightAuditStatus | undefined,
  today: string | null,
  anyRunning: boolean,
): string | null {
  if (!status) return 'Loading night audit status…';
  if (status.halted) return 'Night audit is halted — resolve the failed step first.';
  if (anyRunning) return 'Night audit is already running.';
  if (today == null) return 'Property time zone unavailable.';
  if (status.businessDate >= today) return 'Business date is already current — nothing to roll.';
  return null;
}
```

Render `{runDisabledReason(...) ? <p className="muted">{runDisabledReason(...)}</p> : null}` adjacent to Run button. Wrap mutation messages in `<Alert>`. Step column: `{STEP_LABELS[step.id] ?? step.id}` with `title={step.id}`.

Add tests T12–T14 per spec §4.

### Step 2 — U5 print CSS + I6 registration card room code

Extend `styles.css`:

```css
@media print {
  body * {
    visibility: hidden;
  }
  .reg-card,
  .reg-card * {
    visibility: visible;
  }
  .reg-card {
    position: absolute;
    inset: 0;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
  }
  aside,
  .app-sidebar,
  .ops-rail,
  .top-bar,
  .shift-strip,
  .side-panels,
  .nav {
    display: none !important;
  }
}
```

In `registration-card.tsx`:

```tsx
const roomText = roomLabel ?? null; // never fall back to roomId UUID
// VIP/DND → Badge rung="attention" / "neutral" (I14)
```

Disable print when only UUID known. Create `registration-card.test.tsx` T9–T11.

### Step 3 — U7/L12 hide four Booking settings keys

Remove the four `DomainBool` / `DomainText` blocks from Booking card in `SettingsScreen.tsx:732–756`. Do **not** add to `EXCLUDED` — simply unrender. T19 goes green.

### Step 4 — U17 checkout remaining-nights warning

In `FolioScreen.tsx`, derive:

```tsx
const showRemainingNightsWarn =
  reservation?.departureDate != null &&
  businessDate != null &&
  reservation.departureDate > businessDate;
```

Render persistent informational Alert above Check out when true. Optional second `ConfirmDialog` before checkout mutation with locked copy — **no** API payload change, **no** `sold` release.

T15 goes green.

### Step 5 — E3/Q4/Q18/Q19/U11 error sweep

| Screen | Change |
|---|---|
| `FolioScreen.tsx:1642` | `{message ? <Alert data-testid="folio-message">{message}</Alert> : null}` |
| `FolioScreen.tsx` tenders | `<ul>` → `DataTable` columns Method, Amount, Status, Actions |
| `CityLedgerScreen.tsx` | Delete `JSON.stringify` error paths; use `classifiedUserMessage`; statement → table of known keys |
| `StaffScreen.tsx`, `InventoryScreen.tsx` | Delete local `staffErrorMessage`; use `classifiedUserMessage` |
| `TapeChartScreen.tsx:297` | `<div className="error">` → `<Alert>` |
| `ShiftScreen.tsx:181`, `ShiftStrip.tsx` | load/close errors → `<Alert>` |
| `BoardScreen.tsx` `SectionCard` | error → `<Alert>`; empty → `<EmptyState>` |
| `ExceptionsScreen.tsx:604` | payload → `DataTable` / definition list; no `<pre>{JSON.stringify` |

Add/update tests T17–T18, T20–T25, T31.

### Step 6 — U9–U16 / I10–I15 polish

| ID | File | Change |
|---|---|---|
| U9 | `HousekeepingApp.tsx` | Helper under Assignment: `Assignment only — use Status for clean/dirty.` |
| U10 | `BookingScreen.tsx` | `bookFailClosed` disables Hold/Quote/Confirm + Alert; fix test T20 |
| U12 | `NightAuditScreen.tsx` | (Step 1) STEP_LABELS + halt Alert copy |
| U13 | `guest-row.tsx` | Display name only; ref on `data-testid` / `title` |
| U14 | `BookingScreen.tsx` | Search pending → `Searching…`; empty → `No guests match` |
| U15 | `PermissionRoute.tsx` + `PermissionDenyFlash.tsx` | On deny: set flash + toast text; mount flash reader in `AppShell` |
| I10 | `AppShell.tsx`, `BookingScreen.tsx` | `aria-label="Search reservations"` / `"Find guest"` |
| I11 | files touched | Replace ad-hoc `.visually-hidden` with `VisuallyHidden` |
| I12 | `FolioScreen.tsx`, `TapeChartScreen.tsx` | Remove redundant `.ui-table-scroll` wrapper |
| I14 | `registration-card.tsx`, `front-office-editor.tsx` | VIP/DND → `Badge` |
| I15 | `CheckInScreen.tsx`, `FolioScreen.tsx`, `icons.tsx` | Drop `←` on back links; context-aware folio back; distinct `RosterIcon` |
| I13 | `SignInScreen.tsx:125` | `setError('This account needs a second step.');` — update T28 |

**PermissionDenyFlash** (minimal — no new ui-kit toast):

```tsx
const KEY = 'hospai.permission-deny';

export function setPermissionDenyFlash(): void {
  sessionStorage.setItem(KEY, '1');
}

export function consumePermissionDenyFlash(): boolean {
  if (sessionStorage.getItem(KEY) !== '1') return false;
  sessionStorage.removeItem(KEY);
  return true;
}
```

In `PermissionRoute.tsx` before `<Navigate>`:

```tsx
setPermissionDenyFlash();
```

In `AppShell.tsx`:

```tsx
{showPermissionDeny ? (
  <div role="status" className="app-flash" data-testid="permission-deny-toast">
    You don&apos;t have access to that page.
  </div>
) : null}
```

Add CSS for `.app-flash` in `styles.css` (position fixed, auto-dismiss optional — keep simple).

### Step 7 — Migrate remaining window.confirm to ConfirmDialog (non-void)

`StaffScreen.tsx`, `RosterScreen.tsx`, `CityLedgerScreen.tsx` archive, `FolioScreen.tsx` balance override / close window — use `ConfirmDialog` (destructive only where irreversible).

### Step 8 — Verify Task 3

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/NightAuditScreen.test.tsx \
  src/screens/registration-card.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/SettingsScreen.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/ShiftScreen.test.tsx \
  src/screens/CityLedgerScreen.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/SignInScreen.test.tsx \
  src/screens/front-office-editor.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/InventoryScreen.test.tsx \
  src/auth/PermissionRoute.test.tsx
pnpm --filter @hospai/pms-housekeeping exec vitest run src/ui/HousekeepingApp.test.tsx
pnpm check:spa-page-chrome
```

Expected: spec test matrix T1–T31 **green** (except any deferred to Task 4 full gate).

### Step 9 — Commit

```bash
git add apps/web-pms/src/copy/night-audit-step-labels.ts \
  apps/web-pms/src/shell/PermissionDenyFlash.tsx \
  apps/web-pms/src/styles.css \
  apps/web-pms/src/screens/NightAuditScreen.tsx \
  apps/web-pms/src/screens/registration-card.tsx \
  apps/web-pms/src/screens/registration-card.test.tsx \
  apps/web-pms/src/screens/SettingsScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/CityLedgerScreen.tsx \
  apps/web-pms/src/screens/InventoryScreen.tsx \
  apps/web-pms/src/screens/StaffScreen.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx \
  apps/web-pms/src/screens/ShiftScreen.tsx \
  apps/web-pms/src/shell/ShiftStrip.tsx \
  apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx \
  apps/web-pms/src/screens/CheckInScreen.tsx \
  apps/web-pms/src/screens/front-office-editor.tsx \
  apps/web-pms/src/screens/front-office-editor.test.tsx \
  apps/web-pms/src/screens/guest-row.tsx \
  apps/web-pms/src/screens/SignInScreen.tsx \
  apps/web-pms/src/auth/PermissionRoute.tsx \
  apps/web-pms/src/shell/icons.tsx \
  apps/web-pms/src/shell/AppShell.tsx \
  modules/pms/housekeeping/src/ui/HousekeepingApp.tsx \
  apps/web-pms/src/screens/*.test.tsx
git commit -m "feat(web-pms): R0.11 night audit, print, settings hide, checkout warn, Alerts, polish"
```

---

## Task 4 — Full CI + tick R0.11

**Files:**
- Modify: `docs/roadmap.md` (tick **R0.11** only)

**Interfaces:** none (verification + docs tick)

### Step 1 — Focused web-pms regression sweep

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/RatesScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/NightAuditScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/SettingsScreen.test.tsx \
  src/screens/BookingScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/ShiftScreen.test.tsx \
  src/screens/CityLedgerScreen.test.tsx \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/SignInScreen.test.tsx \
  src/auth/PermissionRoute.test.tsx \
  src/auth/me.test.ts \
  src/shell/AppShell.me.test.tsx \
  src/screens/registration-card.test.tsx \
  src/screens/front-office-editor.test.tsx
pnpm --filter @hospai/pms-housekeeping exec vitest run \
  src/ui/HousekeepingApp.test.tsx
```

- [ ] All green

### Step 2 — Full CI `checks` job sequence (copy in order from `.github/workflows/ci.yml`)

```bash
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
pnpm check:error-mapper-singleton
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

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.11 only

In `docs/roadmap.md` line ~187:

```markdown
- [x] **R0.11** Audit V11 — U4–U17, I1–I15, E3, Q4, Q18, Q19, L12. …
```

Do **not** tick R0.12–R0.14 or Track 2 items.

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): tick R0.11 operator SPA UX + UI vertical"
```

---

## Success criteria (spec §9 — Task 4 gate)

1. Rate matrix cells show **numbers only**; labels accessible via `VisuallyHidden` (**I1**).
2. Exactly **one** `<h1>` per route (`PageHeader`); sidebar brand is not a heading (**I2**). Board titles match route (**I5**). No hardcoded "The Meridian Seattle" (**I4**).
3. Guest erase, Exceptions confirm, and Rates archive use **`.app-modal`** via `ConfirmDialog`; void paths use destructive confirm (**I3**, **U6**).
4. Night audit Run disabled states show **reason**; mutations use **Alert** (**U4**). Steps show clerk labels (**U12**).
5. Print outputs **only** `.reg-card`; room line never UUID (**U5**, **I6**).
6. Four unread Booking settings keys **hidden** (**U7**, **L12**).
7. Checkout shows **remaining-nights warning** when departure future; **no** client-side inventory release (**U17**).
8. Listed screens use **`classifiedUserMessage` + `Alert`**; no raw JSON error/statement surfaces (**E3**, **Q4**, **Q18**, **Q19**, **U11**). Tenders in **DataTable**.
9. Roster visible on **`roster:read`**; permission deny **toast** (**U16**, **U15**). Book FAIL_CLOSED disables actions (**U10**).
10. Sign-in MFA copy omits "demo user" (**I13**). Pins unchanged; `pnpm test:local` + `check:spa-page-chrome` green.

---

## Self-review (writing-plans checklist)

| Check | Result |
|---|---|
| Spec coverage P1–P9 | Task 2 = P1–P3 partial; Task 3 = P4–P9 |
| Locked task split | Matches reviewer gate exactly |
| Placeholder scan | No TBD/TODO/similar-to |
| Pin freeze | 89/144/34/9/8 throughout; tick only Task 4 |
| Final CI task | Full `ci.yml` checks + shards + pin confirmation |
| No new routes/commands | Confirmed — SPA-only |
| Checkout warning only | U17 explicit; no sold release |
| ConfirmDialog = `.app-modal` | Step 1 Task 2 |

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-05-operator-spa-ux-ui.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in-session with executing-plans checkpoints.

Which approach?
