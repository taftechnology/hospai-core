# Cross-tenant provision hardening (R0.1)

**Tree verified 2026-09-04:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main` — **no drift** from HEAD `461d391` values.

**Date:** 2026-09-04  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 1](../../audit/2026-09-04-full-codebase-audit.md) (**S1**, **S3**, **G1**); [Tenancy spine](./2026-07-27-tenancy-spine-design.md) (provision model — this slice **hardens** it, does not replace it); [AGENTS.md §1 tenancy](../../../AGENTS.md) (409, no foreign row, never `ensureMember` on another org); [ARCHITECTURE.md §4.5](../../../ARCHITECTURE.md) (jurisdiction immutability); `apps/pms-core/src/provision.ts`; `apps/pms-core/src/v1-dispatch.ts` (`handlePostOrgProperties`); `packages/contracts/src/tenancy/types.ts`; `apps/pms-core/test/tenancy.spec.ts`; `apps/pms-core/test/auth.spec.ts`.

**Closes:** Audit **S1** (critical cross-org graft), **S3** (leaky `existing` on conflict), **G1** (missing cross-org characterization test). **Roadmap:** **R0.1**. **Requires:** nothing (Track 0 entry). **Does not** advance R0.2 (azp), R0.3 (city ledger), guest-list SQL (S2), or any catalog/schema/route count change.

---

## Executive summary

`provisionProperty` uses a **global** D1 `getProperty(propertyId)` lookup. When a row exists and jurisdiction matches, it calls `syncOrgAndPropertyDo(existing)` — which runs `ensureMember(actorUserId, 'owner')` on **`existing.orgId`**, not the URL/body `input.orgId`. An attacker with `property:provision` on org A can POST org B’s `propertyId` (matching jurisdiction) to `/v1/orgs/{orgA}/properties` and become owner of org B. This spec locks an **org-id match gate** before any sync: cross-org → **`property_exists`** / **409** with **no victim identifiers**; same-org jurisdiction mismatch keeps **`jurisdiction_conflict`** but strips **`existing`** from DO and HTTP bodies; same-org idempotent re-provision is unchanged. **No new route, command, event, or migration.** Characterization tests land **first** and must fail on current `main`.

---

## Locked product call

If `getProperty(input.propertyId)` returns a row whose `orgId !== input.orgId` → **409** with **no property row in the body**. Never call `syncOrgAndPropertyDo` / `ensureMember` on another org. Same-org idempotent re-provision (jurisdiction matches) may still sync. Jurisdiction mismatch on the **same** org may keep `jurisdiction_conflict` but **must not** return `existing` (S3). Prefer error `property_exists` or keep `jurisdiction_conflict` with a body that has **no** `orgId`, `propertyId`, `name`.

---

## 1. Problem / evidence

### 1.1 Root cause (S1)

`apps/pms-core/src/provision.ts` — `provisionProperty`:

```58:65:apps/pms-core/src/provision.ts
  const existing = await getProperty(env, input.propertyId);
  if (existing) {
    if (existing.jurisdiction !== input.jurisdiction) {
      return { ok: false, error: 'jurisdiction_conflict', existing };
    }
    await syncOrgAndPropertyDo(env, existing, locationHint, input.actorUserId, ledgerCurrency);
    return { ok: true, property: existing, locationHint };
  }
```

1. `getProperty` is **global** (primary key on `property_id`, not scoped to `input.orgId`).
2. When found and jurisdiction matches, `syncOrgAndPropertyDo` uses **`property.orgId` from the registry row** (the victim org).
3. `syncOrgAndPropertyDo` → `org.ensureMember(actorUserId, 'owner')` on that OrgDO (`provision.ts:87–88`). `ON CONFLICT DO NOTHING` — no rank check; attacker becomes owner.

**Attack:** Admin with `property:provision` on org A posts `propertyId` of a victim property (org B) and matching jurisdiction → becomes owner of org B.

HTTP entry: `POST /v1/orgs/:orgId/properties` (`post_org_properties`, index **2** in `V1_HTTP_ROUTE_AUDIT`). `dispatchV1` gates `property:provision` on the **URL org** only — it does not validate that the global property row belongs to that org.

### 1.2 Information leak (S3)

Same file returns `{ ok: false, error: 'jurisdiction_conflict', existing }` with the full `PropertyRecord`.

`handlePostOrgProperties` forwards it:

```1330:1332:apps/pms-core/src/v1-dispatch.ts
  if (!result.ok) {
    if (result.error === 'jurisdiction_conflict') {
      return json({ error: result.error, existing: result.existing }, 409);
```

Response exposes victim `orgId`, `propertyId`, `name`, `jurisdiction`, etc.

### 1.3 Test gap (G1)

`apps/pms-core/test/tenancy.spec.ts` — `rejects jurisdiction conflict with 409 semantics` **asserts the leak**:

```75:76:apps/pms-core/test/tenancy.spec.ts
    expect(second.error).toBe('jurisdiction_conflict');
    expect(second.existing?.jurisdiction).toBe('eu');
```

No test covers cross-org graft. `apps/pms-core/test/auth.spec.ts` covers org-create takeover and non-member 404 — **not** this threat model (`cross-org property create denied for non-member` is permission/membership on the URL org, not victim `propertyId` reuse).

---

## 2. Locked behaviour

| Scenario | Condition | DO result | HTTP | Side effects |
|---|---|---|---|---|
| **Cross-org conflict** | `existing && existing.orgId !== input.orgId` (any jurisdiction) | `{ ok: false, error: 'property_exists' }` — **no** `existing` field | **409** `{ error: 'property_exists' }` — no `orgId`, `propertyId`, `name`, `jurisdiction`, `existing` | **Do not** call `syncOrgAndPropertyDo`, `ensureMember`, or stub resolution on victim org |
| **Same-org jurisdiction mismatch** | `existing.orgId === input.orgId && existing.jurisdiction !== input.jurisdiction` | `{ ok: false, error: 'jurisdiction_conflict' }` — **no** `existing` | **409** `{ error: 'jurisdiction_conflict' }` only | Registry row unchanged (trigger + existing path) |
| **Same-org idempotent re-provision** | `existing.orgId === input.orgId && existing.jurisdiction === input.jurisdiction` | `{ ok: true, property: existing, locationHint }` | **201** + success body (as today) | `syncOrgAndPropertyDo` allowed; first-writer-wins client ids unchanged |
| **Fresh provision** | no registry row | `{ ok: true, property, locationHint }` | **201** | insert + sync (unchanged) |

**Evaluation order in `provisionProperty`:** after `getProperty`, **org match first**, then jurisdiction check, then sync.

**Out of scope for this slice:** changing `POST /v1/orgs` bootstrap; generating property ids; 404-vs-409 hiding policy for cross-org (locked at **409** + `property_exists` per AGENTS.md §1).

---

## 3. Error + HTTP contract

| Error code | When | HTTP | Body shape |
|---|---|---|---|
| `property_exists` | Global property row belongs to another org | **409** | `{ error: 'property_exists' }` only |
| `jurisdiction_conflict` | Same org, jurisdiction mismatch | **409** | `{ error: 'jurisdiction_conflict' }` only |
| (success) | Same-org idempotent or fresh insert | **201** | `{ ok: true, property, locationHint }` (unchanged) |
| `tenant_not_active`, `invalid_*` | unchanged validation gates | as today | as today |

**Mapping location:** extend the **`handlePostOrgProperties`** error branches in `v1-dispatch.ts` (provision is **not** a catalog command — do **not** add a fifth global mapper). **Prefer inline handler mapping** to match current pattern.

**Dispatch fallthrough:** today, after the `jurisdiction_conflict` and `tenant_not_active` branches, unhandled provision errors hit `return json({ error: result.error }, 400)` (~1344). **`property_exists` must be mapped to 409 in its own branch before that generic 400 return** — do not let it fall through as 400.

**Contracts:** reshape `ProvisionPropertyResult` in `packages/contracts/src/tenancy/types.ts`:

- Success (unchanged): `{ ok: true; property: PropertyRecord; locationHint: string }`.
- Failure: `{ ok: false; error: 'property_exists' | 'jurisdiction_conflict' | 'invalid_timezone' | 'invalid_currency' | 'invalid_tenant_id' | 'tenant_not_active' | string }` — **delete** `existing?: PropertyRecord` from the failure variant entirely. That field is how S3 leaked; leaving it optional on the type would invite reintroduction.
- Add `'property_exists'` to the error literal union. **No** parallel `code` key.

---

## 4. Implementation steps

**Order: tests first (red on `main`), then production.**

1. **Tests — library (`tenancy.spec.ts`)**
   - Add `cross-org re-provision returns property_exists and does not graft membership`: provision victim property under org B; call `provisionProperty` from org A with same `propertyId` + matching jurisdiction; expect `{ ok: false, error: 'property_exists' }` with no `existing`; victim OrgDO `listMembers()` unchanged (attacker not present).
   - Add `cross-org re-provision with jurisdiction mismatch still returns property_exists`: same setup but attacker sends different jurisdiction; still `property_exists` (org gate runs first), not `jurisdiction_conflict`.
   - **Change** `rejects jurisdiction conflict with 409 semantics`: keep `jurisdiction_conflict`; **remove** `expect(second.existing?.jurisdiction)`; assert `'existing' not in second` (or equivalent).

2. **Tests — HTTP (`apps/pms-core/test/provision-routes.spec.ts`, new)**
   - Follow helpers in `property-details-routes.spec.ts` / `auth.spec.ts` (`postOrg`, `postProperty`, `x-dev-actor`).
   - `POST /v1/orgs/{orgA}/properties` with org B’s `propertyId`, actor member of org A only, matching jurisdiction → **409**, body `{ error: 'property_exists' }`, body must not contain `orgId`, `propertyId`, `name`, `jurisdiction`, `existing`; victim OrgDO membership unchanged.
   - Same HTTP path, mismatching jurisdiction → **409** `property_exists` (not `jurisdiction_conflict`).
   - Same org + same `propertyId` + same jurisdiction → **201** (idempotent re-provision).
   - Optional sanity: fresh property on org A still **201**.

3. **`packages/contracts/src/tenancy/types.ts`**
   - Add `'property_exists'` to the error literal union.
   - **Remove** `existing?: PropertyRecord` from the `{ ok: false; ... }` variant of `ProvisionPropertyResult` — error results are `{ ok: false, error }` only.

4. **`apps/pms-core/src/provision.ts`**
   - After `const existing = await getProperty(...)`:
     ```ts
     if (existing && existing.orgId !== input.orgId) {
       return { ok: false, error: 'property_exists' };
     }
     ```
   - Jurisdiction branch: `return { ok: false, error: 'jurisdiction_conflict' };` — **drop** `existing`.
   - Leave same-org sync path and fresh-insert path unchanged.

5. **`apps/pms-core/src/v1-dispatch.ts`** (`handlePostOrgProperties` only)
   - Add **`property_exists` branch before the generic 400 fallthrough** (~1344): `return json({ error: 'property_exists' }, 409);`
   - On `jurisdiction_conflict`: `return json({ error: 'jurisdiction_conflict' }, 409);` — **remove** `existing` from JSON.
   - Keep branch order: `property_exists` → `jurisdiction_conflict` → `tenant_not_active` → `invalid_*` → generic 400. Unmapped errors still 400; **`property_exists` must not reach the generic return**.
   - No drive-by refactor elsewhere in dispatch.

6. **Verify** (see §6). Do **not** touch `setupCompanyWindowAtZeroBalance`, `auth.spec.ts` org-takeover cases, or demo-seed org-property mismatch handler (already checks `property.orgId !== body.orgId` at `v1-dispatch.ts:1231`).

   **Regression note (no file change):** `scripts/demo-seed.mjs` already treats an unexpected property **409** as fatal. `property_exists` is not a seed success path — leave demo-seed untouched.

---

## 5. Test matrix

| # | Layer | Setup | Action | Expect |
|---|---|---|---|---|
| T1 | library | Property provisioned under org B (`user_b`) | `provisionProperty({ orgId: orgA, propertyId: victim, jurisdiction: match, actorUserId: attacker })` | `ok: false`, `error: 'property_exists'`, no `existing`; org B OrgDO has no `attacker` |
| T2 | library | Same as T1 | Attacker sends **different** jurisdiction | Still `property_exists` (not `jurisdiction_conflict`) |
| T3 | library | Property under org A | Re-provision same org, **different** jurisdiction | `jurisdiction_conflict`, no `existing` key |
| T4 | library | Property under org A | Re-provision same org + jurisdiction | `ok: true` (idempotent) |
| T5 | HTTP | org A + org B each with owner; B has property | `POST /v1/orgs/{orgA}/properties` body `{ propertyId: victim, jurisdiction: match, ... }` as org A member | **409** `{ error: 'property_exists' }`; no identifier fields; org B members unchanged |
| T6 | HTTP | Same as T5 | Mismatching jurisdiction in body | **409** `property_exists`; body clean |
| T7 | HTTP | org A property | Same-org re-provision via HTTP | **201** |
| T8 | regression | — | Existing `tenancy.spec.ts` EU/null-jurisdiction/first-write tests | Still green |
| T9 | regression | — | `auth.spec.ts` org takeover / non-member 404 | Unchanged behaviour |

---

## 6. Verify commands

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tenancy.spec.ts test/provision-routes.spec.ts test/auth.spec.ts
```

Full local gate (after implementation):

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** never put `--` before `--shard` (pnpm treats `--shard` as a file filter).

**Grep sanity (post-fix):**

```bash
grep -n "ensureMember" apps/pms-core/src/provision.ts
# ensureMember must remain only inside syncOrgAndPropertyDo, reachable only after org match
```

Tests **must fail on current `main`** for T1, T2, T5, T6, and the revised T3 assertion before production changes merge.

---

## 7. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/provision.ts` | Org-id gate; strip `existing` from errors |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostOrgProperties` 409 bodies only |
| `packages/contracts/src/tenancy/types.ts` | `'property_exists'` in error union; **delete** `existing` from failure variant |
| `apps/pms-core/test/tenancy.spec.ts` | Cross-org library cases; fix S3 assertion |
| `apps/pms-core/test/provision-routes.spec.ts` | **New** — HTTP cross-org characterization |

**Not in scope:** `auth.spec.ts` (different threat model), `setupCompanyWindowAtZeroBalance`, catalog, `v1-http-routes.ts`, PropertyDO/OrgDO migrations, SPA.

---

## 8. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new HTTP route, catalog command, event type, or schema migration. `post_org_properties` audit row unchanged.

---

## 9. Out of scope

- Guest list SQL / property-scoped OrgDO PII (audit S2 / R0.4)
- Clerk `authorizedParties` / azp / security headers / Bearer-or-Origin (R0.2)
- Direct-bill city ledger / AR (R0.3)
- Kill-switch, replay, degraded mode
- Extracting PropertyDO
- Generating property ids
- New Settings, SPA screens, Playwright
- Changing `POST /v1/orgs` bootstrap
- `setupCompanyWindowAtZeroBalance`

---

## 10. Success criteria

1. Cross-org provision attempt returns **409** / `property_exists` with **no** victim row fields in JSON.
2. Victim OrgDO membership is **unchanged** — attacker is not added as owner/member of org B.
3. Same-org jurisdiction mismatch returns **409** / `jurisdiction_conflict` with **no** `existing` in DO or HTTP body.
4. Same-org idempotent re-provision still returns **201** and may sync OrgDO/PropertyDO.
5. Characterization tests T1–T7 exist and would have **failed** on pre-fix `main`.
6. All catalog/schema/route pins unchanged; `pnpm test:local` green.
7. `grep ensureMember apps/pms-core/src/provision.ts` shows no path to victim org on cross-org input.

---

## 11. Relationship to tenancy spine

[2026-07-27-tenancy-spine-design.md](./2026-07-27-tenancy-spine-design.md) defines first-writer-wins client-chosen ids, jurisdiction immutability, and provision → OrgDO mirror. This slice **does not** alter that model — it closes the missing **org-id match** on global `getProperty` that the spine assumed but did not enforce on re-provision.
