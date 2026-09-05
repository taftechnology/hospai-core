# HTTP error contracts (R0.10)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 10](../../audit/2026-09-04-full-codebase-audit.md) (**Q1**, **Q2**, **Q6**, **Q7**, **Q8**, **Q9**, **Q10**); [AGENTS.md §3 errors](../../../AGENTS.md); `apps/pms-core/src/v1-dispatch.ts` (`mapReservationCommandErrorStatus` ~380, `mapGuestCommandErrorStatus` ~572, `mapConfigErrorStatus` ~780, `mapPaymentCommandErrorStatus` ~972, `commandErrorResponse` ~772, `gateEntitlement` ~1110, `handleGetGuest` ~1972, `guestDirectoryErrorResponse` ~7109); `apps/pms-core/src/invoke-property-do.ts` (`invokePropertyDo`); `apps/pms-core/src/org-do.ts` (`readGuest` ~2286, `readGuestEntry` ~514, membership `catch { return forbidden }` ~1051 / ~1135 / ~1317 / ~1384, `mapOrgCommandError` ~231); `apps/pms-core/test/error-channel-d1.spec.ts` (partial `not_member` coverage).

**Closes:** Audit **Q1** (`entitlement_required` is 402/422/503), **Q2** (`not_member` 404 vs 422 on reservation writes), **Q6** (guest decrypt GET 500 vs batch `DECRYPT_UNRESOLVED`), **Q7** (membership catch-all → forbidden), **Q8**/**Q9**/**Q10** (four mappers, ~72 copied epilogues, two envelopes). **Roadmap:** **R0.10**. **Requires:** R0.8 idempotency / R0.9 replay landed (error mappers must not fight replay dedupe). **Does not** advance R0.11 SPA copy, Playwright, PropertyDO extraction, new wire codes, or catalog/schema pin bumps unless a code already exists in `@hospai/contracts`.

---

## Executive summary

The same domain error code maps to **different HTTP statuses** depending on which handler or mapper runs. `entitlement_required` is **402** on `gateEntitlement` and guest-directory paths, **422** on reservation and person-entity mappers, and entangled with **503** on config reads. `not_member` is **404** `{ error: 'not_found' }` in `commandErrorResponse` and inventory/night-audit epilogues, but **422** when reservation writes fall through `mapReservationCommandErrorStatus` — the reservation family forgot the epilogue that room-type CRUD already has. Guest **GET** throws on decrypt miss and becomes **500**; batch **readGuests** returns per-row `decrypt_unresolved`. OrgDO membership mutations wrap `transactionSync` in `catch { return forbidden }`, so storage bugs masquerade as **403**.

This spec locks **one** `commandErrorHttpStatus` table (replacing four parallel mappers), **one** `finishPropertyDoInvoke` epilogue helper for the ~72 `invokePropertyDo` call sites, **typed** membership catches (reuse `mapOrgCommandError`; else `INTERNAL_ERROR`), and **DECRYPT_UNRESOLVED** on single-guest GET aligned with batch. **Two response envelopes only:** command failures `{ ok: false, error }`; gates bare `{ error }` (auth gate may keep `message`). **Tests land first** and must fail on current `main` for the regression cases below.

---

## Locked product call

1. **Q1 — One status table:** Add `commandErrorHttpStatus(error: CommandError): number` in `apps/pms-core/src/command-error-http.ts` (or colocated module). **Delete** `mapReservationCommandErrorStatus`, `mapGuestCommandErrorStatus`, `mapPersonEntityCommandErrorStatus`, `mapConfigErrorStatus`, `mapConfigConcreteCommandErrorStatus`, `mapPaymentCommandErrorStatus`, and `mapCommandErrorStatus` after migration. **`entitlement_required` → 402** everywhere the table is used. **`entitlement_unavailable` → 503** (unchanged). Never **422** or **503** for `entitlement_required`.
2. **Q2 — `not_member` → 404:** Every command path returns **404** `{ error: 'not_found' }` for `not_member` / `NOT_MEMBER`. Never **422** on reservation writes. Wire body uses gate shape `not_found`, not `{ ok: false, error: 'not_member' }`.
3. **Q8/Q9/Q10 — Envelopes:** Domain command failures stay `{ ok: false, error }` (+ optional structured fields already on specific codes, e.g. `date` on `no_availability`). HTTP gates stay bare `{ error }`. Auth gate may keep `{ error, message? }`. **Do not** invent a third envelope.
4. **Q6 — Decrypt miss:** `readGuest` returns `{ ok: false, error: DECRYPT_UNRESOLVED }` (or propagates `readGuestEntry` Result) — **no throw**. `handleGetGuest` maps via existing guest error path → **422** `{ ok: false, error: 'decrypt_unresolved' }`, not **500**.
5. **Q7 — Membership catch:** Replace blanket `catch { return { ok: false, error: 'forbidden' } }` on `setOrgMember`, `removeOrgMember`, `setPropertyMember`, `removePropertyMember` with: `const mapped = mapOrgCommandError(e); if (mapped) return mapped; return { ok: false, error: INTERNAL_ERROR };`. Storage/SQL bugs must not become **403**.
6. **Q2/Q10 — `finishPropertyDoInvoke`:** Extract shared epilogue for `invokePropertyDo` handlers: early `invoked.kind === 'response'`; then `NOT_MEMBER` → 404 `not_found`; `FORBIDDEN` / `SCOPE_MISMATCH` → 403 `{ error: 'forbidden', permission }`; `ENTITLEMENT_REQUIRED` → 402 `{ error: 'entitlement_required', feature: 'pms.core' }`; default failure → `{ ok: false, error }` + `commandErrorHttpStatus`. Handlers with **existing** structured error branches (e.g. `no_availability` + `date`, `restriction_violated` + `rule`) pass an `onFailure` hook that runs **before** the default mapper. **Reservation family must use this helper** (or equivalent calls) so `not_member` cannot regress to 422.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Single table** | Exactly **one** `commandErrorHttpStatus`. No fifth mapper. Payment/config/guest/reservation domains all call it (PSP **501** for `psp_unavailable` stays in table). |
| **Q1 entitlement** | `ENTITLEMENT_REQUIRED` → **402** in `commandErrorHttpStatus`. `gateEntitlement` unchanged shape: `{ error, feature }` at **402**. DO-sourced entitlement on property routes: `{ error: 'entitlement_required', feature: 'pms.core' }` at **402**. |
| **Q2 not_member** | `NOT_MEMBER` / `'not_member'` → HTTP **404**, body `{ error: 'not_found' }`. Table returns **404** for status lookup but epilogue **must** emit `not_found` wire key (gate convention). |
| **Q6 decrypt** | Single guest GET: **422** `{ ok: false, error: 'decrypt_unresolved' }`. Batch unchanged: per-row `{ ok: false, guestId, error: 'decrypt_unresolved' }` inside `{ ok: true, guests }`. **No 500** for decrypt miss alone. |
| **Q7 membership** | Only typed domain errors from `mapOrgCommandError` or `instanceof` membership control errors map to `forbidden` / `not_member` / `role_escalation` / etc. Everything else → `INTERNAL_ERROR` → HTTP **500** `{ ok: false, error: 'internal_error' }` at dispatch. |
| **finishPropertyDoInvoke** | New helper in `apps/pms-core/src/finish-property-do-invoke.ts` (or `invoke-property-do.ts` export). **72** call sites: replace duplicated `if (invoked.kind === 'response')` + authz epilogue blocks. Keep handler-specific `onFailure` for structured payloads. |
| **Route/command ids** | **No** renames. `handle*` / `try*` / route ids / command ids frozen. |
| **Tests first** | Characterization specs fail on `main` before production edits. Extend `error-channel-d1.spec.ts`; add focused file for entitlement + decrypt + membership. |
| **Pins** | `COMMAND_CATALOG` **89**, routes **144**, `PROPERTY_SCHEMA_HEAD` **34**, `ORG_SCHEMA_HEAD` **9**, `NIGHT_AUDIT_STEPS` **8** — unchanged. **No new wire codes** unless already exported from `@hospai/contracts` (`DECRYPT_UNRESOLVED`, `ENTITLEMENT_REQUIRED`, `NOT_MEMBER`, `INTERNAL_ERROR` exist). |
| **Out** | Playwright; PropertyDO extraction; SPA `classifiedUserMessage` (R0.11); zod-per-route; changing `gatePermission` semantics; replay permission (R0.9 — only inherits consistent status mapping). |

---

## 1. Problem / evidence

### 1.1 Q1 — `entitlement_required` is 402, 422, or 503 (high)

**HTTP pre-gate (402 — correct):**

```1110:1123:apps/pms-core/src/v1-dispatch.ts
async function gateEntitlement(env: PmsEnv, orgId: string, feature: FeatureKey): Promise<Response | null> {
  try {
    const snap = await loadSnapshot(env, orgId);
    require(snap, feature);
  } catch (e) {
    if (e instanceof EntitlementRequiredError) {
      return json({ error: e.code, feature: e.featureKey }, 402);
    }
    if (e instanceof EntitlementResolutionError) {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 503 });
  }
  return null;
}
```

**Guest directory (402 — correct):**

```7109:7120:apps/pms-core/src/v1-dispatch.ts
function guestDirectoryErrorResponse(err: string): Response {
  if (err === 'not_member') return json({ error: 'not_found' }, 404, GUEST_HEADERS);
  // ...
  if (err === ENTITLEMENT_REQUIRED) {
    return json({ error: ENTITLEMENT_REQUIRED, feature: 'pms.core' }, 402, GUEST_HEADERS);
  }
```

**Reservation mapper (422 — wrong for Q1):**

```556:559:apps/pms-core/src/v1-dispatch.ts
    case ENTITLEMENT_REQUIRED:
    case ENTITLEMENT_UNAVAILABLE:
    case LIMIT_EXCEEDED:
      return 422;
```

**Person-entity / guest mapper (422 — wrong):**

```744:755:apps/pms-core/src/v1-dispatch.ts
    case ENTITLEMENT_REQUIRED:
    case ENTITLEMENT_UNAVAILABLE:
    case LIMIT_EXCEEDED:
    // ...
      return 422;
```

**Config mapper (503 for unavailable; required would follow guest path if hit — split table):**

```794:796:apps/pms-core/src/v1-dispatch.ts
    case ENTITLEMENT_REQUIRED:
    case ENTITLEMENT_UNAVAILABLE:
      return 503;
```

**Payment mapper (402 for required — correct in isolation):**

```995:998:apps/pms-core/src/v1-dispatch.ts
    case ENTITLEMENT_REQUIRED:
      return 402;
    case ENTITLEMENT_UNAVAILABLE:
      return 503;
```

A folio or reservation command that returns `entitlement_required` from PropertyDO today can surface **422** while the same org on `GET /guests` surfaces **402** — same meaning, three status codes.

### 1.2 Q2 — `not_member` 404 vs 422 (high)

**Unified guest/org read helper (404 — correct):**

```772:777:apps/pms-core/src/v1-dispatch.ts
function commandErrorResponse(err: CommandError, permission: Permission): Response {
  if (err === NOT_MEMBER) return json({ error: 'not_found' }, 404);
  if (err === FORBIDDEN || err === SCOPE_MISMATCH) {
    return json({ error: 'forbidden', permission }, 403);
  }
  return json({ ok: false, error: err }, mapCommandErrorStatus(err));
}
```

**Reservation mapper maps `NOT_MEMBER` to 422:**

```505:559:apps/pms-core/src/v1-dispatch.ts
    case NOT_MEMBER:
    case SCOPE_MISMATCH:
    // ... many validation codes ...
      return 422;
```

**Cancel reservation — no epilogue; falls through to mapper:**

```2633:2644:apps/pms-core/src/v1-dispatch.ts
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    // ...
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
```

**Check-in — explicit epilogue (404 — correct):**

```2962:2968:apps/pms-core/src/v1-dispatch.ts
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'reservations:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(coerceCommandError(err));
  }
```

Room-type CRUD and night-audit routes already test **404** in `error-channel-d1.spec.ts`; reservation cancel/confirm/hold/modify and most folio/rate paths do not.

### 1.3 Q6 — Guest decrypt GET 500 vs batch Result (high)

**Batch path — per-row Result (correct):**

```2353:2359:apps/pms-core/src/org-do.ts
    const guests: Record<
      string,
      | { ok: true; guestId: string; erased: false; profile: GuestProfile }
      | { ok: true; guestId: string; erased: true; profile: null }
      | { ok: false; guestId: string; error: typeof GUEST_NOT_FOUND }
      | { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
    > = {};
```

**Single-guest read — throws:**

```2313:2320:apps/pms-core/src/org-do.ts
    const entry = await this.readGuestEntry(guestId);
    if (entry.ok === false && entry.error === GUEST_NOT_FOUND) {
      return { ok: false, error: GUEST_NOT_FOUND };
    }
    if (entry.ok === false && entry.error === DECRYPT_UNRESOLVED) {
      throw new Error('guests.read.decrypt_incident');
    }
    return entry;
```

**HTTP handler — catch → 500:**

```1983:2001:apps/pms-core/src/v1-dispatch.ts
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readGuest(actor, propertyId, guestId);
    if (!result.ok) {
      return commandErrorResponse(result.error, 'guests:read');
    }
    return json(result, 200);
  } catch (e) {
    // ...
      return json({ error: 'internal_error' }, 500);
  }
```

`readGuestEntry` already returns `DECRYPT_UNRESOLVED` without throwing (~541–542); only `readGuest` rethrows it.

### 1.4 Q7 — Membership catch-all → forbidden (high)

Four membership mutators swallow **all** errors:

```1050:1053:apps/pms-core/src/org-do.ts
      });
    } catch {
      return { ok: false, error: 'forbidden' };
    }
```

Same pattern at ~1135 (`removeOrgMember`), ~1317 (`setPropertyMember`), ~1384 (`removePropertyMember`). Guest/roster write paths already use `mapOrgCommandError(e)` (~1597, ~1668, …). A thrown SQLite constraint or vault fault on membership write returns **403 forbidden** to HTTP — indistinguishable from rank escalation denial.

### 1.5 Q8 / Q9 / Q10 — Four mappers, ~72 epilogues, two envelopes (medium)

| Mapper | Role today |
|---|---|
| `mapReservationCommandErrorStatus` | Largest switch; **422** for `NOT_MEMBER` + `ENTITLEMENT_REQUIRED` |
| `mapGuestCommandErrorStatus` / `mapPersonEntityCommandErrorStatus` | Guest/roster; **404** `NOT_MEMBER`, **422** entitlement |
| `mapConfigErrorStatus` | Domain config PUT; **503** entitlement unavailable |
| `mapPaymentCommandErrorStatus` | Partial override then delegates to reservation mapper |

**~72** occurrences of `if (invoked.kind === 'response') return invoked.response;` in `v1-dispatch.ts`. Authz epilogues (`not_member`, `forbidden`) are copy-pasted; reservation subset inconsistent (Q2).

**Envelopes today (keep):**

| Context | Shape | Example |
|---|---|---|
| Command failure | `{ ok: false, error: '<wire_code>' }` | Cancel: `{ ok: false, error: 'already_cancelled' }` |
| Gate / existence hide | `{ error: 'not_found' }` | Tenant inactive, `not_member` |
| Gate forbidden | `{ error: 'forbidden', permission }` | Missing `folio:post` |
| Auth gate | `{ error, message? }` | Unauthenticated |

`membershipErrorResponse` correctly uses `{ error: 'not_member' }` at **404** for org membership routes — **distinct** from property command hide (`not_found`). Do not change org membership route bodies in this slice; property-scoped command paths use `not_found` per AGENTS.md.

---

## 2. Design

### 2.1 `commandErrorHttpStatus` — single table

New module `apps/pms-core/src/command-error-http.ts`:

```ts
/** Sole HTTP status map for CommandError wire codes from DO RPC. AGENTS.md §3 — no fifth mapper. */
export function commandErrorHttpStatus(error: CommandError): number {
  switch (error) {
    case ENTITLEMENT_REQUIRED:
      return 402;
    case ENTITLEMENT_UNAVAILABLE:
    case INVOICE_R2_UNBOUND:
    case CITY_LEDGER_R2_UNBOUND:
    case REPORTS_R2_UNBOUND:
      return 503;
    case NOT_MEMBER:
    case NOT_FOUND:
    case GUEST_NOT_FOUND:
    case STAFF_NOT_FOUND:
    case RATE_PLAN_NOT_FOUND:
    // ... existing 404 set from mapReservationConcrete + person entity (merge, dedupe) ...
      return 404;
    case FORBIDDEN:
    case SCOPE_MISMATCH:
      return 403;
    case PSP_UNAVAILABLE:
      return 501;
    // 409, 400 (CONFIG_CLASS_NOT_DOMAIN, undeclared:), 500 (INTERNAL_ERROR, org_id_unset, …)
    // 422 — default bucket for validation / business rule codes (unchanged membership)
    default:
      if (error.startsWith(UNDECLARED_CONFIG_PREFIX)) return 422;
      // exhaustive never on ConcreteCommandError after merge
  }
}
```

**Migration rules:**

1. **Merge** the four existing switches into one exhaustive `switch (error: CommandError)` with `never` default (D1 typing already landed).
2. **Q1 delta only:** move `ENTITLEMENT_REQUIRED` from **422** buckets (reservation + person-entity) into **402**. `ENTITLEMENT_UNAVAILABLE` stays **503**.
3. **Q2 delta only:** move `NOT_MEMBER` from **422** (reservation switch) to **404** in the table — but HTTP epilogues **still** emit `{ error: 'not_found' }`, not `{ ok: false, error: 'not_member' }`.
4. **`mapPaymentCommandErrorStatus` special cases** (`psp_unavailable` → 501, etc.) become rows in the same table; delete the wrapper.
5. **`mapConfigErrorStatus`:** `CONFIG_CLASS_NOT_DOMAIN` and `undeclared:*` → **400** (preserve today). Fold into table or a one-line prefix guard before `commandErrorHttpStatus` — **not** a second mapper.
6. Export **`commandFailureResponse(error, permission, opts?)`** alongside the table:
   - `NOT_MEMBER` → `json({ error: 'not_found' }, 404)`
   - `FORBIDDEN` / `SCOPE_MISMATCH` → `json({ error: 'forbidden', permission }, 403)`
   - `ENTITLEMENT_REQUIRED` → `json({ error: ENTITLEMENT_REQUIRED, feature: opts?.feature ?? 'pms.core' }, 402)`
   - else → `json({ ok: false, error }, commandErrorHttpStatus(error))`
   - Replaces duplicated logic in `commandErrorResponse`, `guestDirectoryErrorResponse`, and epilogue tails.

### 2.2 `finishPropertyDoInvoke` — shared epilogue (Q2 / Q10)

```ts
type FinishPropertyDoOpts<T extends { ok: boolean }> = {
  invoked: { kind: 'response'; response: Response } | { kind: 'ok'; result: T };
  permission: Permission;
  feature?: FeatureKey; // default pms.core for ENTITLEMENT_REQUIRED body
  successStatus?: number; // default 200
  onFailure?: (result: Extract<T, { ok: false }>) => Response | null;
};

export function finishPropertyDoInvoke<T extends { ok: boolean }>(
  opts: FinishPropertyDoOpts<T>,
): Response {
  if (opts.invoked.kind === 'response') return opts.invoked.response;
  const result = opts.invoked.result;
  if (result.ok) return json(result, opts.successStatus ?? 200);
  const custom = opts.onFailure?.(result as Extract<T, { ok: false }>);
  if (custom) return custom;
  const err = (result as { ok: false; error: CommandError }).error;
  return commandFailureResponse(err, opts.permission, { feature: opts.feature });
}
```

**Handler migration pattern** — cancel reservation (today ~20 lines) becomes:

```ts
return finishPropertyDoInvoke({
  invoked,
  permission: 'reservations:write',
  onFailure: (result) => {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === LEDGER_INCONSISTENT) {
      return json({ ok: false, error: result.error, date: result.date }, 409);
    }
    return null;
  },
});
```

**Preserve** all existing structured error bodies (`no_availability` + `date` + `ariVersion`, `restriction_violated` + `rule`, `oversell` + `dates`, …) in `onFailure`; only authz + default mapping move to the helper.

**Routes that already inline authz correctly** (check-in/out, room-type CRUD) → replace with helper for consistency; behaviour must stay byte-identical except Q1/Q2 fixes.

**Exception writers** (`mapExceptionWriterError`, provisional resolve/retry) — use `commandFailureResponse` / table; keep **404** for `not_member` (already tested in `error-channel-d1.spec.ts`).

### 2.3 Q6 — `readGuest` decrypt path

**OrgDO `readGuest` return type** — extend failure union:

```ts
| { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
```

**Implementation:**

```ts
const entry = await this.readGuestEntry(guestId);
if (entry.ok === false) {
  if (entry.error === GUEST_NOT_FOUND) return { ok: false, error: GUEST_NOT_FOUND };
  if (entry.error === DECRYPT_UNRESOLVED) {
    return { ok: false, guestId, error: DECRYPT_UNRESOLVED };
  }
}
return entry;
```

Remove `throw new Error('guests.read.decrypt_incident')`.

**HTTP `handleGetGuest`:**

- Drop the catch branch that maps decrypt throw → **500** (keep transport/degraded catch).
- On `{ ok: false, guestId, error: DECRYPT_UNRESOLVED }`: log `guests.read.decrypt_incident` (same as batch), return **422** `{ ok: false, error: 'decrypt_unresolved' }` via `commandFailureResponse` / table.
- **`guests.spec.ts`** today expects throw on direct DO read — update to Result shape.

### 2.4 Q7 — Membership typed catch

Replace all four blanket catches with:

```ts
} catch (e) {
  const mapped = mapOrgCommandError(e);
  if (mapped) return mapped;
  return { ok: false, error: INTERNAL_ERROR };
}
```

**Do not** map unknown errors to `'forbidden'`. HTTP dispatch for org membership routes already maps `MembershipError` via `membershipErrorResponse` — `INTERNAL_ERROR` from DO should surface **500** at Worker if ever exposed (membership routes today only emit typed `MembershipError`; add regression test that simulates untyped throw → **500**, not **403**).

Optional: introduce small typed errors for rank/last-owner paths thrown inside `transactionSync` if that reduces `mapOrgCommandError` string matching — **only** if already thrown as `isCommandError` messages today.

### 2.5 Entitlement body consistency (Q1 adjunct)

When PropertyDO or OrgDO returns `entitlement_required`, HTTP response body:

```json
{ "error": "entitlement_required", "feature": "pms.core" }
```

Status **402**. Matches `gateEntitlement` and guest directory. Feature key comes from route `entitlement` link when present; default `pms.core` for core PMS commands.

`entitlement_unavailable` → **503** with `{ error: 'entitlement_unavailable' }` (or empty body on pre-gate resolution failure — **do not change** `gateEntitlement` empty **503** in this slice).

### 2.6 Static guard (optional, same PR)

Add `scripts/check-error-mapper-singleton.mjs` (or eslint hospai rule) that fails CI if `mapReservationCommandErrorStatus` or `function map.*CommandErrorStatus` reappears in `v1-dispatch.ts`. **Not required** for spec approval but recommended in implementation plan.

---

## 3. Implementation steps

**Order: failing characterization tests on `main`, then production.**

### 3.1 Tests first (red on `main`)

**Extend `apps/pms-core/test/error-channel-d1.spec.ts`**

| Case | Assert |
|---|---|
| T1 | Mock `post_reservation_cancel` DO → `not_member` → HTTP **404** `{ error: 'not_found' }` (today **422**) |
| T2 | Mock `post_reservation_confirm` → `not_member` → **404** |
| T3 | Mock `post_reservation_hold` → `not_member` → **404** |
| T4 | Mock `post_folio_add_item` → `not_member` → **404** |
| T5 | Mock `post_reservation_cancel` DO → `entitlement_required` → **402** `{ error: 'entitlement_required', feature: 'pms.core' }` (today **422**) |
| T6 | Mock `put_domain_config` → `entitlement_required` → **402** (today **503** or **422** via config mapper) |

**New `apps/pms-core/test/http-error-contracts.spec.ts`**

| Case | Assert |
|---|---|
| T7 | Seed guest; corrupt/shred cipher (existing guests.spec pattern) → `GET …/guests/:id` **422** `{ ok: false, error: 'decrypt_unresolved' }`, not **500** |
| T8 | Same guest → `POST …/guests/batch` still returns per-row `decrypt_unresolved` inside **200** |
| T9 | Direct OrgDO `readGuest` → `{ ok: false, guestId, error: 'decrypt_unresolved' }`, no throw |
| T10 | Membership: force `transactionSync` throw (test hook or mock SQL) on `setOrgMember` → `{ ok: false, error: 'internal_error' }`, not `forbidden` |
| T11 | Table unit: `commandErrorHttpStatus(ENTITLEMENT_REQUIRED) === 402` |
| T12 | Table unit: `commandErrorHttpStatus(NOT_MEMBER) === 404` |

**Keep green:** existing `error-channel-d1` room-type / night-audit / provisional **404** cases; `guests-routes` unentitled **402**; folio unentitled **402**.

### 3.2 Production (green tests)

1. Add `command-error-http.ts` with merged table + `commandFailureResponse`.
2. Add `finish-property-do-invoke.ts`; migrate **one** handler family (reservations) first; run T1–T3.
3. Migrate remaining `invokePropertyDo` call sites (~72) in batches (folio → rates → inventory → night-audit).
4. Replace `commandErrorResponse` / `guestDirectoryErrorResponse` internals with `commandFailureResponse`; delete old mappers.
5. Fix `readGuest` + `handleGetGuest` (Q6).
6. Fix membership catches (Q7).
7. Remove dead imports; run full gate.

### 3.3 Pins / gates

| Pin | This vertical |
|---|---|
| `COMMAND_CATALOG` length | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | **8**; `[3] === 'AUTO_TRANSFER'` |

Full gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` (8 shards; never `--` before `--shard`).

---

## 4. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `error-channel-d1.spec.ts` | Provision property; mock cancel → `not_member` | POST cancel | **404** `not_found` |
| T2 | same | mock confirm → `not_member` | POST confirm | **404** |
| T3 | same | mock hold → `not_member` | POST hold | **404** |
| T4 | same | mock folio add → `not_member` | POST folio line | **404** |
| T5 | same | mock cancel → `entitlement_required` | POST cancel | **402** + feature |
| T6 | same | mock config put → `entitlement_required` | PUT domain config | **402** + feature |
| T7 | `http-error-contracts.spec.ts` | Guest with shredded/missing key material | GET guest | **422** `decrypt_unresolved` |
| T8 | same | same guest | POST guests/batch | **200** per-row decrypt_unresolved |
| T9 | same | DO direct | `readGuest` | Result, no throw |
| T10 | same | Inject storage fault on membership write | `setOrgMember` | `internal_error`, not `forbidden` |
| T11 | same | unit | `commandErrorHttpStatus` | entitlement → **402** |
| T12 | same | unit | `commandErrorHttpStatus` | not_member → **404** |
| T13 | `error-channel-d1.spec.ts` | regression | room-type POST `not_member` | **404** (unchanged) |
| T14 | `guests-routes.spec.ts` | regression | unentitled org list | **402** (unchanged) |

Tests **T1–T7, T10–T12** must **fail on current `main`**.

---

## 5. Verify commands

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/error-channel-d1.spec.ts \
  test/http-error-contracts.spec.ts \
  test/guests-routes.spec.ts \
  test/guests.spec.ts
```

Full gate after implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

---

## 6. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/command-error-http.ts` | **New** — `commandErrorHttpStatus`, `commandFailureResponse` |
| `apps/pms-core/src/finish-property-do-invoke.ts` | **New** — shared `invokePropertyDo` epilogue |
| `apps/pms-core/src/v1-dispatch.ts` | Delete four mappers; migrate handlers to helpers |
| `apps/pms-core/src/org-do.ts` | `readGuest` decrypt Result; membership typed catch |
| `apps/pms-core/test/error-channel-d1.spec.ts` | T1–T6, T13 reservation/entitlement cases |
| `apps/pms-core/test/http-error-contracts.spec.ts` | **New** — T7–T12 |
| `apps/pms-core/test/guests.spec.ts` | Update decrypt GET expectations |
| `scripts/check-error-mapper-singleton.mjs` | **Optional** — forbid revived mappers |

**Not in scope:** `apps/web-pms` (R0.11 `classifiedUserMessage`); new routes; `packages/contracts` wire codes (unless re-export-only); PropertyDO extraction; Playwright.

---

## 7. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new catalog commands. No schema migrations.

---

## 8. Out of scope

- Operator SPA error copy (`classifiedUserMessage`, Alerts) — **R0.11**
- Org membership HTTP body `{ error: 'not_member' }` on `/v1/orgs/.../members` — intentional; distinct from property command hide
- Replay permission re-check (**X2**, R0.9) — only benefits from consistent status mapping on replay failure
- D1 follow-ups beyond status consolidation (new wire constants, registry typing)
- `gatePermission` / auth semantics changes
- Playwright / staging smoke changes
- PropertyDO extraction

---

## 9. Success criteria

1. **`entitlement_required`** → **402** on reservation, folio, config, guest, and payment command paths (**Q1**).
2. **`not_member`** on property command routes → **404** `{ error: 'not_found' }`, including reservation cancel/confirm/hold/modify (**Q2**).
3. Guest **GET** decrypt miss → **422** `{ ok: false, error: 'decrypt_unresolved' }`, not **500** (**Q6**).
4. Membership mutator storage fault → `internal_error`, not **403 forbidden** (**Q7**).
5. Exactly **one** `commandErrorHttpStatus`; no `mapReservationCommandErrorStatus` / sibling mappers in production (**Q8**).
6. Command failures use `{ ok: false, error }`; gates use bare `{ error }` (**Q9**).
7. ~72 `invokePropertyDo` handlers share `finishPropertyDoInvoke` (or call `commandFailureResponse` without duplicating authz) (**Q10**).
8. Pins unchanged; `pnpm test:local` green.

---

## 10. Relationship to prior specs

- [2026-08-15-audit-phase-d-error-channel-design.md](./2026-08-15-audit-phase-d-error-channel-design.md) — closed `CommandError` union and exhaustive switches; **this slice** consolidates HTTP status mapping and fixes Q1/Q2 deltas without new wire codes.
- [2026-09-05-bounded-bulk-idempotency-json-design.md](./2026-09-05-bounded-bulk-idempotency-json-design.md) — references `commandErrorHttpStatus`; **this spec defines it**.
- [2026-09-05-kill-switch-replay-degraded-r2-design.md](./2026-09-05-kill-switch-replay-degraded-r2-design.md) — deferred Vertical 10 sweep; **this spec owns it**.
- [2026-09-05-property-scoped-guest-roster-lists-design.md](./2026-09-05-property-scoped-guest-roster-lists-design.md) §2.8 — defers to HTTP table; **no new wire codes** here.
- [2026-08-06-guests-pii-vertical-design.md](./2026-08-06-guests-pii-vertical-design.md) — batch decrypt Result; **Q6 aligns single GET**.

---

## 11. Error reference

| Condition | HTTP | Body |
|---|---|---|
| `entitlement_required` (command or DO) | **402** | `{ error: 'entitlement_required', feature: 'pms.core' }` (or route feature) |
| `entitlement_unavailable` | **503** | `{ error: 'entitlement_unavailable' }` or empty (pre-gate) |
| `not_member` on property command | **404** | `{ error: 'not_found' }` |
| `not_member` on org membership route | **404** | `{ error: 'not_member' }` (unchanged) |
| `forbidden` / `scope_mismatch` | **403** | `{ error: 'forbidden', permission: '<perm>' }` |
| Command domain failure | per table | `{ ok: false, error: '<wire_code>' }` (+ existing structured fields) |
| Guest decrypt miss (GET) | **422** | `{ ok: false, error: 'decrypt_unresolved' }` |
| Guest decrypt miss (batch) | **200** | `{ ok: true, guests: { [id]: { ok: false, guestId, error: 'decrypt_unresolved' } } }` |
| Membership storage bug | **500** | `{ ok: false, error: 'internal_error' }` at DO; map at HTTP if exposed |
| Gate invalid JSON / body | **400** | `{ error: 'invalid_json' }` / `{ error: 'invalid_body' }` (R0.8) |

Domain failures continue `{ ok: false, error }`; gates continue bare `{ error }` — no third envelope.
