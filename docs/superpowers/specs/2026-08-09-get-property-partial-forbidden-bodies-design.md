# get_property Partial Read + Forbidden Body Enforcement

**Date:** 2026-08-09  
**Status:** Approved — implemented  
**Sources:** [web-pms status tokens](./2026-08-07-web-pms-status-tokens-design.md) (`get_property` leftover); [folio front desk](./2026-08-08-folio-front-desk-design.md) leftovers #3 / #10; [degraded mode server](./2026-08-04-degraded-mode-server-design.md); `PropertyTimeZone.tsx`; `ExceptionsPanel.tsx`; `AppShell.boot.test.tsx`; `requirePermission` in `auth.ts`; `handleGetProperty` / exception GETs / `handleGetOrgProperties` in `v1-dispatch.ts`

---

## 1. Context & Motivation

Three related defects from prior verticals, plus a class the first draft under-scoped:

1. **`get_property` under PropertyDO failure** — unguarded DO reads → unclassified 500. Registry already has `property` (incl. `timeZone`) and `locationHint`; only jurisdiction/schema need the stub. FAIL_CLOSED on the whole read would blank SPA time zone and contradict the shell boot-path principle.

2. **Unguarded shell GET siblings (same class)** — `handleGetProvisionalExceptions` and `handleGetProvisionalExceptionCount` await the stub with no `isPropertyDoTransportFailure` catch. `ExceptionsPanel` is mounted in `AppShell` and calls both; `AppShell.boot.test.tsx` asserts “Replay exceptions” survives PropertyDO failure but mocks the api layer, so it cannot see the server 500. These have **no** registry half to preserve → plain `degradedFailClosedReadResponse()`. `handleGetOrgProperties` is the OrgDO twin (`listPropertyRefs` unguarded).

3. **Bare 403 bodies** — only three handlers still return `{ error: 'forbidden' }` without `permission`: room-type create/update/delete (`inventory:write`). The dispatcher gate already emits correct bodies (§2.2); these are the secondary DO-denial path.

4. **Client audit fallback** — papers over (3). Once (3) is enforced, the fallback is declared-but-unenforced defence-in-depth.

### Scope in

1. Partial `get_property` 200 on PropertyDO transport failure with `propertyDo: 'unreachable'`.
2. FAIL_CLOSED transport guards on exception list, exception count, and `get_org_properties`; set `degradedRead: 'FAIL_CLOSED'` on the two exception audit rows (update index pins).
3. Three room-type 403 bodies gain `permission: 'inventory:write'`.
4. **`check:forbidden-bodies`** — semantic 403 permission check (+ synthetic fixtures for multi-route fail and non-literal accept). Script prefix: `pnpm --filter @hospai/contracts build &&` (same as permissions/entitlements/degraded — imports `V1_HTTP_ROUTE_AUDIT` from `contracts/dist`; omit and it can go green against a stale audit).
5. **`check:do-transport-guards`** — every GET handler that awaits a PropertyDO/OrgDO stub must contain a transport guard (`isPropertyDoTransportFailure` / `isOrgDoTransportFailure`). `get_property` counts as guarded when it contains the transport check (partial path). Allowlist only pure non-DO GETs (e.g. registry/D1-only). Synthetic `--self-test` must prove fail-when-unguarded.
6. **CI wiring (merge-blocking):** add discrete steps in `.github/workflows/ci.yml` for `pnpm check:forbidden-bodies`, `pnpm check:do-transport-guards`, and **`pnpm check:web-pms-colors`** (already in `package.json`, absent from CI today — live precedent for “script exists, never blocks merge”). There is no aggregator; each check is its own `- run:` line beside the existing five.
7. After forbidden-bodies is green: delete client audit fallback, `FOLIO_MUTATION_ROUTES`, `routeKey` plumbing; retire leftovers.

### Scope out

- Splitting `get_property` into registry-only + diagnostic routes (leftover C).
- Setting `degradedRead` on `get_property` (stays unset — partial 200, not FAIL_CLOSED).
- ESLint-only “`permission` key present” rule.
- New `/me` or permissions endpoint.
- Fixing every unguarded **write** (writes use `invokePropertyDo` / command degraded path — not this class).
- SPA UI for jurisdiction/schema unavailability.

---

## 2. Design Decisions

### 2.1 Q1 — `get_property` under PropertyDO failure → **B (partial + marker)**

**Lock B.** After a successful registry resolve, both DO reads run in **one** try:

```ts
try {
  recorded = await stub.getRecordedJurisdiction();
  schemaVersion = await stub.getSchemaVersion();
} catch (e) {
  if (!isPropertyDoTransportFailure(e)) throw e;
  // partial path
}
```

On transport failure:

| Field | Value |
|---|---|
| HTTP status | **200** |
| `property`, `locationHint` | From registry |
| `recordedJurisdiction` | `null` |
| `schemaVersion` | `null` |
| `propertyDo` | `'unreachable'` (**required marker**) |

On success: today’s shape; **`propertyDo` omitted**. Any transport failure in the try → both DO fields null + marker (no half-hydration).

**Marker vs null:** `recordedJurisdiction` already returns `null` legitimately (`recorded ?? null`). Unavailability must be out-of-band.

**Vocabulary:** `propertyDo: 'unreachable'` is intentionally **not** `degraded: 'FAIL_CLOSED'|'READ_STALE'` or `cache: 'stale'`. Those mark degraded **failures** (typically 503 / stale projection). This is a **200** with a partial payload; unifying into `degraded` would teach clients to treat success as outage. Keep the distinct key.

Non-transport errors rethrow. Registry miss stays 404. `degradedRead` stays unset.

**Leftover C:** registry-only `get_property` + diagnostic route for jurisdiction/schema.

### 2.1b — Boot-path siblings → FAIL_CLOSED + guard check

**Lock: widen.** Same boot-path principle that justifies B also requires fixing the easy half of the class:

| Handler | Failure response |
|---|---|
| `handleGetProvisionalExceptions` | `degradedFailClosedReadResponse()` |
| `handleGetProvisionalExceptionCount` | `degradedFailClosedReadResponse()` |
| `handleGetOrgProperties` | `degradedFailClosedOrgReadResponse()` (or inline equivalent) via `isOrgDoTransportFailure` → `org_unreachable` (§3.3) |

Audit: add `degradedRead: 'FAIL_CLOSED'` to `get_provisional_exceptions` and `get_provisional_exception_count` (today unset; `register.test` pin that expects absence must flip). `get_org_properties` stays without `degradedRead` if org-scope check:degraded rules treat it as non-property (match existing org entitlements pattern) — still must catch OrgDO transport in the handler.

**Enforcement:** `check:do-transport-guards` scans GET handlers in `v1-dispatch.ts` for direct stub/OrgDO awaits; each must contain a transport-failure branch (string presence of `isPropertyDoTransportFailure` or `isOrgDoTransportFailure` in that function body). Allowlist handlers with no DO await (documented in the script). This is Q2’s reasoning applied to the worse failure mode (unguarded 500 vs bare permission toast).

### 2.2 Q2 — what stops 403 bodies regressing → **B (semantic check)**

**Lock B.** Fix three room-type sites:

```ts
return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
```

**Canonical path already correct.** `requirePermission` in `auth.ts` returns `{ error: 'forbidden', permission }` with `permission` from `route.permission`. Most client-visible 403s never needed the audit fallback. Handler-level 403s are the **secondary** path: PropertyDO `gatePermission` re-checks after the dispatcher gate already passed (same permission via role grants / cache). Reachable under role race, cache skew, or a DO check that disagrees with the route — not the steady-state staff path. The check still governs that secondary path; the three bare bodies were the only production load-bearing gap for the client fallback.

**Algorithm (`check:forbidden-bodies`):**

1. Parse `V1_ROUTES` → `handlerName` → set of audit permissions.
2. In each handler, find `return json({…}, 403)` with `error: 'forbidden'` in the response body literal.
3. Require `permission:`.
4. String literal → must equal every associated route’s audit permission (multi-route differing permissions → fail). **Today vacuous** on the live tree (68 handlers ↔ 68 rows, no conflicts) — still ship the branch.
5. Non-literal (`perm`, calls) → accept.

**Fixtures required (not “green on tree” alone):** `--self-test` (or equivalent) must include (a) multi-route conflict → check **fails**, (b) non-literal `permission: perm` → check **passes**, (c) missing `permission` key → check **fails**. Running against the live tree only proves today’s snapshot, not that the script fails when it should.

### 2.3 Q3 — drop client audit fallback → **A (after Q2 green)**

**Lock A, after forbidden-bodies green.** Safer than first draft: the gate already stamps `permission` on the primary path; the fallback was load-bearing mainly for the three room-type DO-denial bodies.

**Intentional deletion of working code:**

| Delete / simplify | Notes |
|---|---|
| `permissionForForbidden(body, routeId)` → `permissionForForbidden(body)` | Body-only; drop audit import |
| `FOLIO_MUTATION_ROUTES` + file + canary | Gone |
| `routeKey` / `routeIdForFolioAction` | `useFolioActionMutation(opts)` |
| Exactly-once routeKey canary | Dissolves with leftover #10 |
| Audit-fallback tests | “null when body omits `permission`” |

**Retire:** folio #3, folio #10, status-tokens `get_property` FAIL_CLOSED leftover (superseded by partial B + sibling FAIL_CLOSED).

---

## 3. Wire / type surface

### 3.1 `get_property` success — no `propertyDo`

```json
{
  "property": { "propertyId": "…", "timeZone": "…", "…": "…" },
  "locationHint": "…",
  "recordedJurisdiction": null,
  "schemaVersion": 18
}
```

### 3.2 `get_property` PropertyDO transport failure

```json
{
  "property": { "…": "…" },
  "locationHint": "…",
  "recordedJurisdiction": null,
  "schemaVersion": null,
  "propertyDo": "unreachable"
}
```

```ts
export type PropertyRead = {
  property: { propertyId: string; timeZone: string; name: string; [key: string]: unknown };
  locationHint?: string;
  recordedJurisdiction?: unknown;
  schemaVersion?: number | null;
  propertyDo?: 'unreachable';
};
```

### 3.3 Exception / org-properties transport failure

**PropertyDO reads** (exception list/count): reuse `degradedFailClosedReadResponse()` → `503` + `{ error: 'property_unreachable', degraded: 'FAIL_CLOSED' }` + `Retry-After: 30`.

**OrgDO reads** (`get_org_properties`): do **not** use the property helper. Repo convention at four write sites (`v1-dispatch.ts` ~633 / ~749 / ~803 / ~849) is already:

```json
{ "error": "org_unreachable", "degraded": "FAIL_CLOSED", "commandId": "…" }
```

For this **read**, emit the same error string without `commandId`:

```json
{ "error": "org_unreachable", "degraded": "FAIL_CLOSED" }
```

with `Retry-After: 30`. Prefer extracting `degradedFailClosedOrgReadResponse()` next to the property helper (the four writes stay as-is this slice unless a one-line shared helper is trivial). Client classifies on `degraded === 'FAIL_CLOSED'` only (`classify.ts`) — wire/observability correctness, not SPA behaviour. Tests **must** assert `error: 'org_unreachable'` (degraded alone would green-wash a `property_unreachable` mistake).

### 3.4 Forbidden body

```json
{ "error": "forbidden", "permission": "<Permission>" }
```

---

## 4. Test matrix

| # | Case | Assert |
|---|---|---|
| 1 | `get_property` transport-blocked | 200; `timeZone` present; `propertyDo === 'unreachable'`; `schemaVersion === null` |
| 2 | `get_property` healthy | 200; no `propertyDo`; numeric `schemaVersion` |
| 3 | Exception count/list transport-blocked | 503 FAIL_CLOSED (server); client classifies `fail_closed` |
| 4 | `get_org_properties` OrgDO transport-blocked | 503; `error: 'org_unreachable'`; `degraded: 'FAIL_CLOSED'`; no `commandId` |
| 5 | Room-type 403s | `permission: 'inventory:write'` |
| 6 | `check:forbidden-bodies` on tree | green (contracts build prefix) |
| 7a | Forbidden-bodies synthetic: multi-route mismatch | check **fails** |
| 7b | Forbidden-bodies synthetic: non-literal `perm` | check **passes** |
| 7c | Forbidden-bodies synthetic: missing `permission` | check **fails** |
| 8a | `check:do-transport-guards` on tree | green |
| 8b | Transport-guards synthetic: GET stub await, no catch | check **fails** |
| 9 | `permissionForForbidden` | body only; omit → null |
| 10 | Folio mutation copy | body-supplied permission renders; omitted → generic copy; no `routeKey` |
| 11 | `packages/client-core/test/api.test.ts` | healthy `getProperty` fixture still valid under widened `PropertyRead`; add case for `propertyDo: 'unreachable'` + `schemaVersion: null` (client returns the shape; does not throw) |
| 12 | `FolioScreen.test.tsx` 403 add-charge | mock body includes `permission: 'folio:post'`; asserts client renders server-supplied permission (not audit guess) |

---

## 5. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Split `get_property` (option C) | Registry-only boot; diagnostic for DO fields |
| 2 | Degraded-mode table wording | Older row said generic 503 for `get_property` — now partial 200 |
| 3 | `AppShell.boot.test.tsx` is not server coverage | Mocks the api layer; asserts shell chrome mounts when *client* calls fail. It never saw the pre-fix unclassified 500 from unguarded exception GETs, and after this slice it still does not prove worker transport guards. Server proof is pms-core transport-blocked tests (§4 rows 1–4) + `check:do-transport-guards`. Do not read the boot test as boot-path PropertyDO protection. |

**Retired this slice:** status-tokens `get_property` FAIL_CLOSED leftover; folio #3; folio #10.

---

## 6. Acceptance checklist

- [ ] `get_property` transport failure → 200 + `propertyDo: 'unreachable'` + registry half intact
- [ ] Exception GETs → `property_unreachable` FAIL_CLOSED 503; `get_org_properties` → `org_unreachable` FAIL_CLOSED 503 (assert error strings); audit `degradedRead` on exception rows
- [ ] Three room-type 403s carry `inventory:write`
- [ ] `check:forbidden-bodies` green on tree + synthetic 7a/7b/7c; `package.json` uses contracts build prefix
- [ ] `check:do-transport-guards` green on tree + synthetic 8b
- [ ] `.github/workflows/ci.yml` runs `check:forbidden-bodies`, `check:do-transport-guards`, and `check:web-pms-colors` (fix the colors omission)
- [ ] `api.test.ts` updated for `PropertyRead` (healthy + unreachable shape)
- [ ] Client fallback / `FOLIO_MUTATION_ROUTES` / `routeKey` removed
- [ ] Leftovers recorded (incl. boot-test honesty); source specs marked retired
- [ ] `pms-core` / `client-core` / `web-pms` tests + `check:degraded` / `check:permissions` green

---

## 7. Open questions

None. Scope decision: **widen** (siblings + guard check), not reword-and-shrink.
