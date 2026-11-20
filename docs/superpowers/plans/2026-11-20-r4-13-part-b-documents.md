# R4.13 Part B — Proforma + registration card documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Ready for controller execution
>
> **Spec/plan writers do not commit.** This session forbids commits. Every step that would normally commit says **Do NOT commit**. Work on `main`. No push. Do not stash/reset/checkout Part A files.

**Goal:** Ship R4.13 **Part B only** — read-only proforma + registration-card GETs, PRESENTATION document templates, Settings → Documents, printable SPA views — plus small Part A UX fixes (schedule labels + settled Alerts). Do not rewrite Part A schedules/packages.

**Architecture:** Extract one read-only night-charge line builder from `postRoomChargesSync` so night audit and proforma cannot drift. Two FAIL_CLOSED GETs compose PropertyDO stay/folio estimates with OrgDO guest PII for the card. PRESENTATION keys `pms.documents.*` store in `property_config` via a narrow widen of `tryPutDomainConfig` (no new command, no migration). SPA prints only from live route data (`staleTime: 0`).

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts` routes/config, `@hospai/client-core`, React SPA (`apps/web-pms`), vitest (pms-core **8 shards** local via `scripts/test-pms-core-shards.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-19-packages-proforma-documents-design.md` — Part B (B1–B4) + Part B Tests + Pins route deltas. Part A already in working tree (uncommitted).

---

## Global Constraints

- **Part A tree:** Working tree has Part A uncommitted. Build on it. **Never** revert/stash/reset/checkout Part A files to undo them.
- **Pins after Part A (start of this plan):** `COMMAND_CATALOG` **122**, `V1_HTTP_ROUTE_AUDIT` **197** (last `post_reservation_apply_package`), `PROPERTY_SCHEMA_HEAD` **49**, `AUDIT_WRITER_COMMAND_IDS` **88**.
- **Pins after Part B:** routes **199**, last id **`get_reservation_registration_card`**. `COMMAND_CATALOG` stays **122**. `PROPERTY_SCHEMA_HEAD` stays **49**. `AUDIT_WRITER` stays **88**. **NO migration. No new command.** +2 PRESENTATION config keys.
- **Routes:**
  - `get_reservation_proforma`: `GET /v1/properties/:propertyId/reservations/:reservationId/proforma`, `folio:read`, `pms.core`, `degradedRead: 'FAIL_CLOSED'`.
  - `get_reservation_registration_card`: `GET …/registration-card`, `reservations:read`, `pms.core`, `degradedRead: 'FAIL_CLOSED'`.
- **HTTP / DO:** `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. Parse JSON once where needed. Bind SQL. **No `await` in `transactionSync`.**
- **B1 drift helper:** ONE pure/read-only helper builds per-night lines; **both** night-audit posting and proforma call it. Proforma **writes nothing** (use `rateNightAmountSync(..., { persist: false })` / no lazy insert).
- **Registration card:** room **CODE** never ids; guest name/ID from existing OrgDO reads (masked number only).
- **Tenancy:** two-property same-org — hotel A cannot read hotel B’s proforma/card. 409/404 bodies must not leak foreign rows.
- **FAIL_CLOSED:** transport failure → `degradedFailClosedReadResponse()`; SPA Print disabled on pending/error/degraded; never print cached data.
- **SPA / ui-kit:** `classifiedUserMessage`; kit `Alert` for mutation success/failure; tokens only; shared `.print-doc` (keep `.reg-card`); **no room/reservation UUID in printed DOM**.
- **Shards:** Never unsharded pms-core. Single file: `pnpm --filter @hospai/pms-core exec vitest run test/<file>.spec.ts`. End: `node scripts/test-pms-core-shards.mjs` once.
- **Do not:** edit `docs/roadmap.md`; commit; push; stash; reset; checkout.

**Out of scope:** template designer, logos, email proforma, e-invoicing, package remove, Part A schedule/package rewrites (except the named UX fixes).

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **PRESENTATION storage** | Keys stay class **`PRESENTATION`**. Store overrides in PropertyDO `property_config` so `readConfigValueSync` works. Widen `tryPutDomainConfig` class gate to allow `DOMAIN` **or** (`PRESENTATION` && `key.startsWith('pms.documents.')`). Other PRESENTATION keys (e.g. `pms.ui.date_format`) stay rejected. **No new command.** |
| **listDomainConfig** | Include `pms.documents.*` PRESENTATION entries alongside DOMAIN so Settings can load stored/default values (extend the mapped entry list; do not rename the HTTP route). |
| **Unknown template** | Zod enum on the key schema fails → map to **422** (catch ZodError / validation → existing validation → HTTP 422). |
| **Night helper** | New module `apps/pms-core/src/documents/build-night-charge-lines.ts` (or sibling under `apps/pms-core/src/`) exporting a **read-only** builder. `postRoomChargesSync` calls it then inserts; proforma calls it and returns estimates. Do not duplicate inclusion/tax/band-join / `recurringChargeDue` logic. |
| **Proforma statuses** | Works for `pending`, `confirmed`, `checked_in`. Posted GUEST folio lines for checked-in nights + estimates for unposted nights. |
| **Warnings** | no rate; inclusion exceeds rate; inactive charge code; DATES schedule outside stay. |
| **Guest on card** | Handler: PropertyDO stay facts + OrgDO guest batch/document list (masked). Do not put plaintext PII on events. |
| **SPA Print** | Disabled when document query `isPending` \|\| `isError` \|\| classified `degraded: 'FAIL_CLOSED'` \|\| shell authority not live (same “property unreachable” idea as Settings/Check-in). Reason copy shown. |
| **Commits** | **Do NOT commit** (user forbid for this vertical’s agent runs until the human asks). |

---

## Sequencing gate

```
Task 1  Part A UX (schedule labels + settled Alerts)
Task 2  PRESENTATION document keys + put/list widen
Task 3  Shared night-charge line helper (extract; night audit still posts)
Task 4  Routes + pins 199 + client GETs + HTTP stubs returning DO reads
Task 5  Proforma DO + documents.spec drift / posted+estimate / warnings / config
Task 6  Registration card DO + OrgDO guest + two-property + FAIL_CLOSED
Task 7  Settings → Documents tab
Task 8  SPA print views + stay/board/check-in wiring
Task 9  AGENTS pins + inclusions pointer + full CI
```

---

## File map

| File | Task | Change |
|---|---|---|
| `apps/web-pms/src/screens/settings-packages.tsx` | 1 | Schedule labels; Night (1–N); settled `Alert` |
| `apps/web-pms/src/screens/settings-packages.test.tsx` | 1 | Label + Alert assertions |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | 1, 7 | Optional: render packages success via Alert; Documents tab |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | 1, 8 | Confirm Apply package uses settled Alert (already); later wire card route |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 1 | Confirm RecurringChargesCard already uses settled Alert |
| `packages/contracts/src/config/register.ts` | 2 | +2 PRESENTATION keys + zod shapes |
| `packages/contracts/src/register.test.ts` | 2, 4, 9 | Key shape; route pin **199** / last id |
| `apps/pms-core/src/property-do.ts` | 2–6 | Widen put/list; call helper; `readProforma` / `readRegistrationCard` |
| `apps/pms-core/src/documents/build-night-charge-lines.ts` | 3 | **Create** — shared read-only night lines |
| `packages/contracts/src/v1-http-routes.ts` | 4 | Append 2 routes |
| `apps/pms-core/src/v1-dispatch.ts` | 4–6 | Handlers + FAIL_CLOSED + OrgDO enrich |
| `packages/client-core/src/api.ts` | 4 | `getReservationProforma`, `getReservationRegistrationCard` |
| `packages/client-core/test/` (api test) | 4 | URL + method smoke |
| `apps/pms-core/test/documents.spec.ts` | 5, 6 | **Create** — Part B characterization |
| `apps/web-pms/src/screens/settings-documents.tsx` | 7 | **Create** — Documents tab |
| `apps/web-pms/src/screens/settings-documents.test.tsx` | 7 | Save + reason |
| `apps/web-pms/src/App.tsx` | 7, 8 | `/settings/documents`; print routes |
| `apps/web-pms/src/screens/registration-card.tsx` | 8 | Refactor → `RegistrationCardDocument` |
| `apps/web-pms/src/screens/proforma-document.tsx` | 8 | **Create** |
| `apps/web-pms/src/screens/document-print-views.tsx` | 8 | **Create** — route screens + template switcher + Print |
| `apps/web-pms/src/styles.css` | 8 | `.print-doc` shared with `.reg-card` |
| `apps/web-pms/src/screens/ReservationStayScreen.tsx` | 8 | Documents action group |
| `apps/web-pms/src/screens/BoardScreen.tsx` | 8 | In-house Registration card row action |
| `apps/web-pms/src/screens/*.test.tsx` | 8 | Print disable, UUID assert, links, cache keys |
| `AGENTS.md` | 9 | Pins heading + route **199** / last id |
| `docs/superpowers/specs/2026-11-19-rate-plan-inclusions-design.md` | 9 | Flip R4.13 Part B pointer to shipped when B lands |

**Not touched:** Part A package/schedule domain code (except UX labels/Alerts); `docs/roadmap.md`; `COMMAND_CATALOG`; migrations; `PROPERTY_SCHEMA_HEAD`.

---

### Task 1: Part A UX — schedule labels + settled Alerts

**Files:**
- Modify: `apps/web-pms/src/screens/settings-packages.tsx`
- Modify: `apps/web-pms/src/screens/settings-packages.test.tsx`
- Modify (only if needed): `apps/web-pms/src/screens/SettingsScreen.tsx` (render `message` with kit `Alert intent="settled"` instead of bare `<p className="muted">`)
- Audit (read-only unless bare text found): `apps/web-pms/src/screens/CheckInScreen.tsx`, `apps/web-pms/src/screens/FolioScreen.tsx` (`RecurringChargesCard`)

**Interfaces:**
- Consumes: `PACKAGE_COMPONENT_SCHEDULES` values `EVERY_NIGHT` \| `ARRIVAL` \| `SET_NIGHT` \| `LAST_NIGHT` (unchanged)
- Produces: option labels + set-night field label; success via `Alert`

- [ ] **Step 1: Write the failing test**

In `settings-packages.test.tsx`, open create dialog and assert:

```tsx
expect(screen.getByRole('option', { name: 'Every night' })).toBeTruthy();
expect(screen.getByRole('option', { name: 'Arrival night' })).toBeTruthy();
expect(screen.getByRole('option', { name: 'Set night' })).toBeTruthy();
expect(screen.getByRole('option', { name: 'Last night' })).toBeTruthy();
// values still machine enums:
expect((screen.getByRole('option', { name: 'Every night' }) as HTMLOptionElement).value).toBe(
  'EVERY_NIGHT',
);
// After selecting Set night:
expect(screen.getByLabelText(/Night \(1–N\)/i)).toBeTruthy();
```

Add success Alert assertion after save mock resolves:

```tsx
await waitFor(() =>
  expect(screen.getByTestId('packages-success')).toHaveTextContent('Package saved.'),
);
// Must be kit Alert, not only muted <p>
expect(screen.getByTestId('packages-success').className).toMatch(/ui-alert/);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/settings-packages.test.tsx
```

Expected: FAIL — options still show raw enums / no `packages-success` Alert.

- [ ] **Step 3: Write minimal implementation**

```tsx
const SCHEDULE_LABELS: Record<PackageComponentSchedule, string> = {
  EVERY_NIGHT: 'Every night',
  ARRIVAL: 'Arrival night',
  SET_NIGHT: 'Set night',
  LAST_NIGHT: 'Last night',
};
// <option value={s}>{SCHEDULE_LABELS[s]}</option>
// SET_NIGHT Field label: "Night (1–N)"
```

Success path: stop relying on bare `onMessage('Package saved.')` alone — either:

1. Local state + `<Alert intent="settled" data-testid="packages-success">Package saved.</Alert>`, and keep `onMessage` only if Settings still needs a toast, **or**
2. Change SettingsScreen `{message ? <p className="muted">` → `<Alert intent="settled">`.

Prefer (1) for Packages so archive/restore also use settled Alert (`Archived.` / `Restored.`).

**Audit:** Check-in `setSettledNotice('Package applied')` already feeds `Alert intent={messageIntent}` — leave. Folio `RecurringChargesCard` already uses `Alert intent={notice.ok ? 'settled' : 'exception'}` — leave. If any Part A schedule success is still bare `<p>`, convert to Alert.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/settings-packages.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit**

---

### Task 2: PRESENTATION keys `pms.documents.*` + put/list widen

**Files:**
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/register.test.ts` (config describe)
- Modify: `apps/pms-core/src/property-do.ts` (`tryPutDomainConfig` class gate; `listDomainConfig` entry source)
- Test: extend `apps/pms-core/test/domain-config-routes.spec.ts` **or** fold into Task 5 `documents.spec.ts` (prefer a short addition to domain-config-routes for put/list)

**Interfaces:**
- Consumes: existing `entry()`, `validateConfigWrite`, `putDomainConfig` HTTP
- Produces:
  - `pms.documents.registration_card` default `{ template: 'STANDARD', headerText: '', footerText: '', show: { ratePlan: true, inclusions: true, specialRequests: true, idDocument: true, signature: true } }`
  - `pms.documents.proforma` default `{ template: 'STANDARD', headerText: '', footerText: '', show: { perNight: true, taxSummary: true, advances: true, warnings: true } }`
  - `tryPutDomainConfig` accepts these PRESENTATION keys into `property_config`

- [ ] **Step 1: Write the failing register test**

```ts
it('pms.documents.* PRESENTATION keys have locked shapes', () => {
  const card = getConfigEntry('pms.documents.registration_card');
  expect(card?.class).toBe('PRESENTATION');
  expect(card?.permission).toBe('settings:configure');
  expect(card?.default).toEqual({
    template: 'STANDARD',
    headerText: '',
    footerText: '',
    show: {
      ratePlan: true,
      inclusions: true,
      specialRequests: true,
      idDocument: true,
      signature: true,
    },
  });
  expect(card?.schema.safeParse({ ...card!.default, template: 'WIDE' }).success).toBe(false);
  const pro = getConfigEntry('pms.documents.proforma');
  expect(pro?.class).toBe('PRESENTATION');
  expect(pro?.default).toEqual({
    template: 'STANDARD',
    headerText: '',
    footerText: '',
    show: { perNight: true, taxSummary: true, advances: true, warnings: true },
  });
  expect(pro?.schema.safeParse({ ...pro!.default, template: 'FANCY' }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "pms.documents"
```

Expected: FAIL — keys undefined.

- [ ] **Step 3: Register keys**

```ts
const RegistrationCardPresentation = z.object({
  template: z.enum(['STANDARD', 'COMPACT']),
  headerText: z.string().max(200),
  footerText: z.string().max(500),
  show: z.object({
    ratePlan: z.boolean(),
    inclusions: z.boolean(),
    specialRequests: z.boolean(),
    idDocument: z.boolean(),
    signature: z.boolean(),
  }),
});
const ProformaPresentation = z.object({
  template: z.enum(['STANDARD', 'DETAILED']),
  headerText: z.string().max(200),
  footerText: z.string().max(500),
  show: z.object({
    perNight: z.boolean(),
    taxSummary: z.boolean(),
    advances: z.boolean(),
    warnings: z.boolean(),
  }),
});
entry({
  key: 'pms.documents.registration_card',
  prototypeKey: null,
  class: 'PRESENTATION',
  schema: RegistrationCardPresentation,
  default: { template: 'STANDARD', headerText: '', footerText: '', show: { ratePlan: true, inclusions: true, specialRequests: true, idDocument: true, signature: true } },
  audited: false,
});
entry({
  key: 'pms.documents.proforma',
  prototypeKey: null,
  class: 'PRESENTATION',
  schema: ProformaPresentation,
  default: { template: 'STANDARD', headerText: '', footerText: '', show: { perNight: true, taxSummary: true, advances: true, warnings: true } },
  audited: false,
});
```

- [ ] **Step 4: Failing put/list characterization**

```ts
it('documents PRESENTATION keys round-trip via put domain config; unknown template 422', async () => {
  // put pms.documents.proforma with template DETAILED + reason → 200
  // listDomainConfig includes key with stored value
  // put template: 'NOPE' → 422
  // put pms.ui.date_format still → config_class_not_domain
});
```

- [ ] **Step 5: Widen put + list**

In `tryPutDomainConfig`:

```ts
const writablePresentation =
  entry.class === 'PRESENTATION' && entry.key.startsWith('pms.documents.');
if (entry.class !== 'DOMAIN' && !writablePresentation) {
  return { ok: false, error: CONFIG_CLASS_NOT_DOMAIN, gotClass: entry.class };
}
```

Catch Zod / schema failures from `validateConfigWrite` and return a validation error that `commandErrorHttpStatus` maps to **422**.

In `listDomainConfig`, map `domainConfigKeys().concat(CONFIG_REGISTER.filter(e => e.key.startsWith('pms.documents.')))` (dedupe).

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "pms.documents"
pnpm --filter @hospai/pms-core exec vitest run test/domain-config-routes.spec.ts
```

Expected: PASS for new cases; existing PRESENTATION rejection for `pms.ui.date_format` still holds.

- [ ] **Step 7: Do NOT commit**

---

### Task 3: Extract shared night-charge line builder

**Files:**
- Create: `apps/pms-core/src/documents/build-night-charge-lines.ts`
- Modify: `apps/pms-core/src/property-do.ts` (`postRoomChargesSync` ~20471–20783 — call helper for line materialization; keep insert/exception recording in the method)

**Interfaces:**
- Consumes: reservation night context, inclusion rows, recurring due rows, tax prep via callbacks/`prepareChargeTaxSync` inputs, `rateNightAmountSync(..., { persist: false })` for read path
- Produces (sketch — exact field names may match existing folio line shape):

```ts
export type NightChargeLineDraft = {
  folioLineId: string;
  chargeCode: string;
  taxChargeCode: string;
  amountMinor: number;
  bandJoin: boolean;
  source: 'NIGHT_AUDIT' | 'INCLUSION' | 'RECURRING'; // use existing constants
  taxLines: Array<{ taxRuleId: string; componentNo: number; outputChargeCode: string; amountMinor: number }>;
};

export type NightChargeBuildResult =
  | {
      ok: true;
      roomAmountMinor: number;
      lines: NightChargeLineDraft[];
      warnings: Array<'inclusion_exceeds_rate' | 'inclusion_charge_code_inactive' | 'recurring_charge_code_inactive' | 'no_rate' | 'date_outside_stay'>;
    }
  | { ok: false; warning: 'no_rate' | 'inclusion_exceeds_rate' | 'inclusion_charge_code_inactive' };

/** Pure relative to storage: callers pass already-loaded rows + `resolveTax` / `assertChargeCode` functions that MUST NOT write. */
export function buildNightChargeLines(/* explicit args — no PropertyDO this */): NightChargeBuildResult;
```

Also export a thin PropertyDO private wrapper `buildNightChargeLinesSync(reservationId, businessDate, opts: { persistRateNight: boolean })` that loads SQL then calls the pure function — **or** keep all SQL in PropertyDO and pass rows into the pure builder. Prefer: SQL in DO, pure function for math/tax assembly so unit tests can feed fixtures without DO.

**Critical:** Proforma path always `persistRateNight: false`. Night-audit posting path may keep today’s lazy insert behaviour **only inside** `postRoomChargesSync` after the helper returns amounts (do not move INSERT into the helper).

- [ ] **Step 1: Characterization guard (red until Task 5 wires proforma)**

Add a focused unit test file **or** the first `documents.spec.ts` case that imports the pure builder with fixture rows and asserts room amount = rate − included, band-join tax uses two-pass nets, recurring due via `recurringChargeDue`.

```ts
import { buildNightChargeLines } from '../src/documents/build-night-charge-lines.js';

it('INCLUDED breakfast reduces room; SEPARATE tax on each line', () => {
  const result = buildNightChargeLines({
    reservationId: 'res_1',
    stayDate: '2026-11-20',
    rateMinor: 10_000,
    adults: 2,
    children: 0,
    inclusions: [
      {
        inclusionNo: 1,
        chargeCode: 'BFAST',
        amountMinor: 500,
        basis: 'PER_ADULT',
        priceMode: 'INCLUDED',
        inclusionTax: 'SEPARATE',
        bandJoin: false,
      },
    ],
    recurring: [],
    resolveTax: ({ amountMinor }) => ({
      netLedgerMinor: amountMinor,
      lines: [{ taxRuleId: 't1', componentNo: 1, outputChargeCode: 'CGST', amountMinor: Math.floor(amountMinor * 0.05) }],
    }),
    chargeCodeActive: () => true,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.roomAmountMinor).toBe(9_000); // 10000 - 500*2 if PER_ADULT — match inclusionUnits
});
```

Adjust expected numbers to match real `inclusionUnits` semantics.

- [ ] **Step 2: Run to verify fail / missing module**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts -t "INCLUDED breakfast"
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement helper + refactor `postRoomChargesSync`**

Extract the inclusion loop, room amount, inactive-code check, band-join `ownNets` / `bandBase`, and recurring due amount+tax preparation into the helper. `postRoomChargesSync` keeps: reservation scan, `ensureGuestFolioWindowSync`, `insertTaxableChargeSync`, exception recording, failure counters.

Recurring: helper returns drafts for schedules that `recurringChargeDue` says are due; posting loop still skips if folio line exists.

- [ ] **Step 4: Run existing night-audit / package apply specs that post room charges**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts
# plus any Part A package apply / recurring specs already in tree, e.g.:
pnpm --filter @hospai/pms-core exec vitest run test/packages.spec.ts
```

(Use actual Part A spec filenames present in the tree — do not invent skips.)

Expected: PASS — posting behaviour unchanged.

- [ ] **Step 5: Do NOT commit**

---

### Task 4: Routes + pins 199 + client GETs + HTTP handlers

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append after `post_reservation_apply_package`
- Modify: `packages/contracts/src/register.test.ts` — length **199**, `at(-1)?.id === 'get_reservation_registration_card'`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — handlers + `V1_ROUTES` wiring
- Modify: `packages/client-core/src/api.ts`
- Test: `packages/client-core` api test (new or extend)

**Interfaces:**
- Produces route ids exactly:

```ts
{
  id: 'get_reservation_proforma',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_reservation_registration_card',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

Wire patterns:

- `GET` `/v1/properties/:propertyId/reservations/:reservationId/proforma`
- `GET` `/v1/properties/:propertyId/reservations/:reservationId/registration-card`

Client:

```ts
async getReservationProforma(propertyId: string, reservationId: string) {
  const { body } = await getJson(
    `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/proforma`,
  );
  return body;
},
async getReservationRegistrationCard(propertyId: string, reservationId: string) {
  const { body } = await getJson(
    `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/registration-card`,
  );
  return body;
},
```

- [ ] **Step 1: Failing pin test**

```ts
expect(V1_HTTP_ROUTE_AUDIT).toHaveLength(199);
expect(V1_HTTP_ROUTE_AUDIT.at(-1)?.id).toBe('get_reservation_registration_card');
expect(V1_HTTP_ROUTE_AUDIT.at(-2)?.id).toBe('get_reservation_proforma');
expect(COMMAND_CATALOG).toHaveLength(122);
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(88);
```

- [ ] **Step 2: Run pin test — expect FAIL on length 197**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "V1_HTTP_ROUTE_AUDIT"
```

- [ ] **Step 3: Append routes + handlers**

Handlers mirror `handleGetFolio`:

```ts
async function handleGetReservationProforma(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const result = await resolvedCtx.resolved.stub.readReservationProforma(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}
```

Stub methods may throw “not implemented” until Task 5/6 — pin tests only need route defs. Prefer implementing empty DO methods that return `{ ok: false, error: NOT_FOUND }` temporarily so typecheck passes, then fill in Tasks 5–6.

- [ ] **Step 4: Run pins + permissions check**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
pnpm check:degraded
```

Expected: PASS — length 199; permissions-check matches `V1_ROUTES`.

- [ ] **Step 5: Do NOT commit**

---

### Task 5: Proforma DO + `documents.spec.ts` drift guard

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `readReservationProforma(reservationId)`
- Create/extend: `apps/pms-core/test/documents.spec.ts`
- Uses: Task 3 helper; `readConfigValueSync('pms.documents.proforma')`; GUEST folio reads; `recurringChargeDue`; payments for advances

**Interfaces — response sketch (camelCase wire):**

```ts
{
  ok: true;
  reservationId: string;
  status: string;
  currency: string;
  presentation: /* pms.documents.proforma value */;
  posted: Array<{ businessDate: string; lines: Array<{ chargeCode: string; amountMinor: number; taxMinor: number; source: string }> }>;
  estimated: Array<{ stayDate: string; lines: Array<{ chargeCode: string; amountMinor: number; taxMinor: number; source: string }> }>;
  totals: { baseMinor: number; taxMinor: number; estimatedTotalMinor: number; advancePaidMinor: number; balanceMinor: number };
  taxSummary: Array<{ outputChargeCode: string; amountMinor: number }>;
  warnings: Array<{ stayDate?: string; code: string }>;
}
```

Statuses allowed: `pending` | `confirmed` | `checked_in`. Else 422 named code or not_found per existing reservation-read patterns.

- [ ] **Step 1: Write failing drift test (normative)**

```ts
it('proforma estimate equals subsequent night-audit posts (amount + tax per line, every night)', async () => {
  // Fixture: confirmed stay, package with EVERY_NIGHT breakfast + SET_NIGHT dinner (reuse Part A helpers),
  // rate nights present, tax rules active.
  const before = await apiOrStub.getProforma(propertyId, reservationId);
  expect(before.ok).toBe(true);
  // Capture estimated lines keyed by stayDate + chargeCode (+ recurring id if needed)

  // Run night audit POST_ROOM_CHARGES for each stay night (or full audit run per night)
  // Read folio lines; for each estimated line assert amountMinor + tax sum match posted

  // Include package component lines
  // Force warnings path in a sibling test: missing rate_day → warnings include no_rate
});
```

Additional cases in the same file:

```ts
it('checked-in with one posted night combines posted + estimates; advances and balance correct', async () => { /* ... */ });
it('warnings appear for missing rate', async () => { /* ... */ });
it('presentation key appears in proforma response and round-trips after put', async () => { /* ... */ });
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts
```

- [ ] **Step 3: Implement `readReservationProforma`**

Algorithm:

1. Load reservation; gate status.
2. Read presentation via `readConfigValueSync('pms.documents.proforma')`.
3. Enumerate stay nights `[arrival, departure)`.
4. For each night: if room folio line already posted for that night → put under `posted`; else call shared helper with `persistRateNight: false` → `estimated`.
5. Sum taxes from helper tax lines; load GUEST window payments → `advancePaidMinor`; compute balance.
6. Collect warnings from helper + DATES outside stay (schedules with dates not in stay range).
7. **Write nothing** — assert no new `reservation_rate_night` / `folio_line` rows in the drift test after proforma GET.

- [ ] **Step 4: Run documents.spec until green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit**

---

### Task 6: Registration card DO + OrgDO guest + tenancy + FAIL_CLOSED

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `readReservationRegistrationCard`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — enrich with OrgDO guest name + masked ID document
- Extend: `apps/pms-core/test/documents.spec.ts`

**Interfaces — DO stay facts (no guest PII):**

```ts
{
  ok: true;
  reservationId: string; // for API correlation only — SPA must not print full id; confirmation = last 8
  confirmationToken: string; // last 8 of id, or existing short code if present
  arrivalDate: string;
  departureDate: string;
  nights: number;
  adults: number;
  children: number;
  roomTypeName: string;
  roomCode: string | null; // NEVER roomId
  ratePlanName: string | null;
  packageName: string | null;
  inclusionLabels: string[];
  specialRequests: string | null;
  vipFlag: boolean;
  presentation: /* registration_card config */;
  guestRef: string;
}
```

HTTP handler adds:

```ts
guestDisplayName: string | null;
idDocument: { type: string; maskedNumber: string } | null; // from existing list documents
```

- [ ] **Step 1: Failing tests**

```ts
it('registration card returns room CODE not room id', async () => {
  const body = await getCard(...);
  expect(body.roomCode).toBe('101');
  expect(JSON.stringify(body)).not.toContain(roomId);
});

it('hotel A cannot read hotel B proforma or registration card', async () => {
  // two properties same org; token for A; GET B’s reservation → 404/409 without foreign identifiers
});

it('FAIL_CLOSED degraded returns degraded response for both document GETs', async () => {
  // use existing transport-failure test harness / HOSPAI_UNSAFE_LOCAL sentinel
  // expect body.degraded === 'FAIL_CLOSED' and Print-disabling status
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts
```

- [ ] **Step 3: Implement DO + handler enrichment**

Join `room.code` by `room_id`. Names from `room_type` / `rate_plan` / `package` tables. Inclusions: labels from snapshotted inclusion nights or plan. Presentation from `readConfigValueSync('pms.documents.registration_card')`.

Handler: after DO ok, `postGuestsBatch` / existing guest document list for masked ID (R4.15). On OrgDO transport failure → `degradedFailClosedReadResponse()` (card needs guest — fail closed, do not return stay-only printable success).

- [ ] **Step 4: Run documents.spec**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Do NOT commit**

---

### Task 7: Settings → Documents tab

**Files:**
- Create: `apps/web-pms/src/screens/settings-documents.tsx`
- Create: `apps/web-pms/src/screens/settings-documents.test.tsx`
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx` — tab type `'documents'`, Link, render
- Modify: `apps/web-pms/src/App.tsx` — route `settings/documents` under `settings:configure`

**Interfaces:**
- Consumes: `api.listDomainConfig`, `api.putDomainConfig` with **reason** (parent Settings reason field or local reason — match Finance/Property pattern: parent `reason` required)
- Produces: edits both document keys; invalidate `['domain-config', propertyId]`

- [ ] **Step 1: Failing SPA test**

```tsx
it('Settings Documents saves proforma presentation with reason', async () => {
  render settings tab=documents with domain-config mock including pms.documents.proforma
  change template to DETAILED
  enter reason
  await waitFor(() => expect(putDomainConfig).toHaveBeenCalledWith('prop_demo', expect.objectContaining({
    key: 'pms.documents.proforma',
    value: expect.objectContaining({ template: 'DETAILED' }),
    reason: expect.any(String),
  })));
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/settings-documents.test.tsx
```

- [ ] **Step 3: Implement tab**

Use ui-kit `Field` / `NativeSelect` / `Input` / `Alert`. Two sections: Registration card + Proforma. Template selects, header/footer texts, show toggles. Reuse `SettingsDomainManual*` patterns if they fit object values; otherwise local form + `putDomainConfig` on save (reason-required — disable save when reason empty, same copy as Property tab).

Wire:

```tsx
<Link className="ui-tab" to="/settings/documents" aria-current={activeTab === 'documents' ? 'page' : undefined}>
  Documents
</Link>
{activeTab === 'documents' ? <DocumentsSettings reason={reason} propertyId={propertyId} keys={keys} onSaved={...} /> : null}
```

- [ ] **Step 4: Run SPA tests**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/settings-documents.test.tsx src/screens/SettingsScreen.test.tsx
```

Expected: PASS (update SettingsScreen.test if tab list asserted).

- [ ] **Step 5: Do NOT commit**

---

### Task 8: SPA print documents (B4)

**Files:**
- Modify: `apps/web-pms/src/screens/registration-card.tsx` — export `RegistrationCardDocument` (refactor `RegistrationCard` to consume route payload + presentation + local template override)
- Create: `apps/web-pms/src/screens/proforma-document.tsx`
- Create: `apps/web-pms/src/screens/document-print-views.tsx` — pages for `/reservations/:id/proforma` and `/reservations/:id/registration-card`
- Modify: `apps/web-pms/src/styles.css` — `.print-doc` shares print isolation with `.reg-card`
- Modify: `apps/web-pms/src/App.tsx` — routes
- Modify: `apps/web-pms/src/screens/ReservationStayScreen.tsx` — Documents action group
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` — in-house row action
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` — fetch registration-card route (`staleTime: 0`) instead of assembling only from reservation read
- Tests: `registration-card.test.tsx`, new proforma/document tests, `ReservationStayScreen.test.tsx`, `BoardScreen.test.tsx`, `CheckInScreen.test.tsx`

**Interfaces:**
- Query keys: `['reservation-proforma', propertyId, reservationId]`, `['reservation-registration-card', propertyId, reservationId]`
- `staleTime: 0`
- Local template switcher state overrides `presentation.template` for print only

- [ ] **Step 1: Failing SPA tests**

```tsx
it('Print disabled while pending or error; reason shown', async () => {
  getReservationProforma.mockReturnValue(new Promise(() => {})); // pending
  render ProformaPrintView
  expect(screen.getByTestId('print-doc')).toBeDisabled();
});

it('printed DOM has no room UUID or reservation UUID', async () => {
  getReservationRegistrationCard.mockResolvedValue({
    ok: true,
    roomCode: '101',
    confirmationToken: 'abcd1234',
    reservationId: 'res_full_uuid_should_not_appear_in_card',
    roomId: 'room_uuid_should_not_appear',
    // ...
  });
  render RegistrationCardDocument...
  const card = screen.getByTestId('reg-card');
  expect(card.textContent).not.toMatch(/res_full_uuid/);
  expect(card.textContent).not.toMatch(/room_uuid/);
  expect(card.textContent).toMatch(/101/);
});

it('stay card Documents links to proforma and registration-card', async () => { /* Link hrefs */ });
it('in-house BoardScreen offers Registration card row action', async () => { /* ... */ });
it('template switcher changes layout class/testid', async () => { /* STANDARD vs COMPACT/DETAILED */ });
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/registration-card.test.tsx src/screens/document-print-views.test.tsx
```

- [ ] **Step 3: Implement print CSS + components + routes**

```css
/* Extend print isolation */
@media print {
  .print-doc,
  .print-doc *,
  .reg-card,
  .reg-card * {
    visibility: visible;
  }
  .print-doc,
  .reg-card {
    position: absolute;
    inset: 0;
    /* ... same as current .reg-card print block; colors via tokens only */
  }
}
```

Keep `.reg-card` working. Add `print-doc` class on proforma root (`data-testid="proforma-doc"`).

Stay card:

```tsx
<RowActions> {/* or existing action group chrome */}
  <Link to={`/reservations/${id}/proforma`}>Proforma</Link>
  <Link to={`/reservations/${id}/registration-card`}>Registration card</Link>
</RowActions>
```

Board in-house `RowActions`:

```tsx
<Link className="ui-link-btn ui-link-btn--sm" to={`/reservations/${row.reservationId}/registration-card`}>
  Registration card
</Link>
```

Check-in: `useQuery({ queryKey: ['reservation-registration-card', propertyId, reservationId], queryFn: () => api.getReservationRegistrationCard(...), staleTime: 0 })`; render `RegistrationCardDocument` from data; `PrintRegCardControl` disabled when pending/error/degraded.

- [ ] **Step 4: Run web-pms suites for touched screens**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/registration-card.test.tsx \
  src/screens/document-print-views.test.tsx \
  src/screens/ReservationStayScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/CheckInScreen.test.tsx \
  src/screens/settings-documents.test.tsx
```

Expected: PASS. Assert invalidate/`setQueryData` keys only if mutations appear (Documents settings already invalidates domain-config).

- [ ] **Step 5: Do NOT commit**

---

### Task 9: AGENTS pins + inclusions pointer + full CI

**Files:**
- Modify: `AGENTS.md` — pins table heading to “After roadmap R4.13 …” (Part B) and `V1_HTTP_ROUTE_AUDIT` **199**, last id **`get_reservation_registration_card`**; note +2 PRESENTATION keys (no numeric CONFIG_REGISTER pin unless one already exists — assert keys in register.test only)
- Modify: `docs/superpowers/specs/2026-11-19-rate-plan-inclusions-design.md` — change “Showing inclusions on the registration card or proforma is **R4.13 Part B** (still open)” → shipped / Part B pointer
- **Do NOT** edit `docs/roadmap.md`

- [ ] **Step 1: Update AGENTS.md pins**

```markdown
After roadmap R4.13 (packages + documents, 2026-11-20) — update this table when you bump them:

| Pin | Value | Assertion |
|---|---|---|
| `COMMAND_CATALOG` length | **122** | ... |
| `V1_HTTP_ROUTE_AUDIT` | **199** routes, last id **`get_reservation_registration_card`** | ... |
| `AUDIT_WRITER_COMMAND_IDS` | **88** | ... |
| `PROPERTY_SCHEMA_HEAD` | **49** | ... |
```

- [ ] **Step 2: Full verification (ci.yml `checks` order + pms-core documents + shards)**

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
pnpm check:resolve-property-prefetch
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
pnpm exec eslint . --ignore-pattern '.claude/**'
pnpm --filter @hospai/contracts exec vitest run
pnpm --filter @hospai/do-runtime exec vitest run
pnpm --filter @hospai/client-core exec vitest run
pnpm --filter @hospai/money exec vitest run
pnpm --filter @hospai/web-pms exec vitest run
pnpm --filter @hospai/pms-core exec vitest run test/documents.spec.ts
node scripts/test-pms-core-shards.mjs
```

Also run `pnpm test:coverage` if that is how non-pms-core packages are reached in CI (`ci.yml` uses `pnpm test:coverage` then `pnpm lint`). Prefer matching CI: after typecheck, `pnpm test:coverage` and `pnpm lint` **instead of** only the filtered package list — the filtered list above is the minimum package matrix; **do both** if time: `pnpm test:coverage` covers contracts/client-core/money/etc., then explicit `documents.spec.ts`, then shards.

Pin confirmation table:

| Pin | Expected |
|---|---|
| `COMMAND_CATALOG` | **122** |
| `V1_HTTP_ROUTE_AUDIT` | **199**; last `get_reservation_registration_card` |
| `AUDIT_WRITER_COMMAND_IDS` | **88** |
| `PROPERTY_SCHEMA_HEAD` | **49** |
| `check:*` | **17** |

Reviewer greps:

```bash
# helper used from both sites
grep -n "buildNightChargeLines" apps/pms-core/src/property-do.ts apps/pms-core/src/documents/*.ts
# proforma must not insert rate nights
# (asserted in documents.spec — after GET, rate_night row count unchanged)
# no UUID in print tests already green
```

- [ ] **Step 3: Do NOT commit**

---

## Manual verify (owner)

1. Settings → Packages: schedule labels human-readable; Set night shows “Night (1–N)”; save shows settled Alert.
2. Settings → Documents: edit templates with reason; unknown template rejected.
3. Confirmed stay → Proforma print view matches what night audit later posts.
4. In-house → Registration card row action; printed paper shows room code + confirmation short code only.
5. Kill DO / degrade → Print disabled; GET returns FAIL_CLOSED body.

---

## Success criteria

1. Part B routes **199**, last id `get_reservation_registration_card`; catalog **122**; schema **49**; audit writers **88**.
2. Shared night helper; drift test green (amount + tax every night, including package components + warnings).
3. Two-property isolation + FAIL_CLOSED characterized in `documents.spec.ts`.
4. PRESENTATION keys registered, put/list round-trip, unknown template **422**.
5. SPA: Documents action group, print views `staleTime: 0`, Print disabled when bad, no UUID on paper, Check-in uses data route, in-house link present.
6. Part A UX labels + settled Alerts.
7. AGENTS pins updated; inclusions spec Part B pointer updated; **roadmap untouched**.
8. Full CI sequence green; shards via `node scripts/test-pms-core-shards.mjs`.

---

## Self-review (author)

1. **Spec coverage:** B1 helper+proforma → Tasks 3+5; B2 card → Task 6; B3 config+Settings → Tasks 2+7; B4 SPA → Task 8; Part B tests → 5/6/8; Part A UX → Task 1; pins/docs → 4+9. Out-of-scope items excluded.
2. **Placeholder scan:** No TBD/TODO/“similar to Task N” without code; commands and sketches concrete.
3. **Type consistency:** Route ids, config keys, client method names, query keys, helper name `buildNightChargeLines` / `readReservationProforma` / `readReservationRegistrationCard` aligned across tasks.
4. **Final CI task:** Task 9 includes `pnpm build`, wrangler dry-run, all 17 `check:*`, self-tests, typecheck, eslint, package suites, `documents.spec.ts`, and `test-pms-core-shards.mjs`.

Plan saved to `docs/superpowers/plans/2026-11-20-r4-13-part-b-documents.md`. Ready for controller execution.
