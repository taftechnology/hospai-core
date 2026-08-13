# Rule 3 Cleanup + Config Surface

**Date:** 2026-08-06  
**Status:** Revised (v2 — delete `upsertRestrictionDay`; register-lookup before per-key gate; M3 = review-time mutation; test 7 load-bearing)  
**Sources:** ARCHITECTURE.md §15 Rule 3; [command catalog](../../../packages/contracts/src/commands/catalog.ts); [domain config register](../../../packages/contracts/src/config/register.ts); [tenancy spine](./2026-07-27-tenancy-spine-design.md); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md); [guests / PII vertical](./2026-08-06-guests-pii-vertical-design.md) (§6.3 ungated five; OrgDO hybrid lessons); [folio charges](./2026-08-05-folio-charges-vertical-design.md) (`FAIL_CLOSED` reclassification + entitlement honesty)

---

## 1. Context & Motivation

Guests closed Rule 3 on `tryCreateReservation` and OrgDO guest writes. Five PropertyDO `try*` methods remain ungated:

```
UNGATED  tryModifyReservation   tryCancelReservation   tryNoShow
         tryUpsertRestrictionDay  tryPutDomainConfig
```

The first four already have HTTP routes; `config.put_domain` and `property.update_details` have catalog entries and **no** HTTP surface. `tryPutDomainConfig` also accepts a client-supplied `meta.actor` string that lands in audit rows — routing it without fixing that would create an attribution hole.

This slice is **Rule 3 cleanup + config surface**, not “core done.” Still outstanding afterward: `reservations.update_status`, `reservations.update_extras`, `night_audit.run`, `audit.append`, and five night-audit stubs.

### Scope in

1. Signature pass (`actor` + `gatePermission`) on the five ungated PropertyDO methods.
2. Route `config.put_domain`; add `settings:configure`; narrow `ConfigEntry.permission` to `Permission`; DO gates per key.
3. Remove client-supplied `meta.actor`; derive audit actor from `ActorContext`.
4. Implement + route `property.update_details` (name-only): D1 then OrgDO; `FAIL_CLOSED` + honest entitlement opt-out.
5. OrgDO `setTransportBlockedForTest` (mirror PropertyDO) so the D1-ahead-of-mirror residual is testable.
6. Log `rematerializesRates` as declared-but-unhonored (not fixed).

### Scope out

- Status / jurisdiction / timezone via `update_details` (timezone stays on the config plane).
- Implementing `rematerializesRates` consumer behavior.
- Staff, payments, channel commands.
- Outcome-level per-key permission test (no role holds one of `settings:configure` / `inventory:configure` without the other today).
- **`night_audit.run` HTTP route.** Its permanent entitlement opt-out reads *"background alarm path; gating would strand business-date roll rather than deny a user action."* A user-triggered route makes that rationale false and requires deciding manual trigger semantics when the audit isn’t due or is mid-run — a separate design, not a leftover route.

### Locked decisions

| Topic | Decision |
|---|---|
| Store authority | **C** — name on D1 + OrgDO mirror; clock via `config.put_domain` (inherits ARI invalidation + night-audit reschedule) |
| Config privilege | **A** — `settings:configure` in `PERMISSIONS` + owner/admin; `ConfigEntry.permission: Permission`; DO gates on `entry.permission`; catalog/route = majority `settings:configure` |
| Name write / degraded | **A** — `FAIL_CLOSED`; D1 `UPDATE` then `OrgDO.tryUpdatePropertyDetails`; never reverse |
| Residual dual-write | D1 ok / OrgDO fail → error; D1 ahead of mirror; client retry converges; listings may show old name until retry |
| Entitlement | Opt-out: *"Tenancy metadata, not product data — no feature gate applies."* |
| Status field | Out |
| Audit actor | Derived from `ActorContext`; `meta.actor` removed from caller input |
| Gate wiring proof | Data + helper locked; helper→gate wiring **unguarded until roles diverge** — accepted (same honesty class as OrgDO hybrid pre-probe) |

---

## 2. Design Decisions

### 2.1 Name on D1 + OrgDO; timezone on config plane

Property “details” already live in three places:

| Store | Role |
|---|---|
| Platform D1 `property` | Routing SoR (`name`, `time_zone`, immutable `jurisdiction`, `status`) |
| OrgDO `property_ref` | Mirror only (tenancy spine) |
| PropertyDO `pms.time.time_zone` | Operational clock (DOMAIN) |

`tryPutDomainConfig` already honors `consumers.reschedulesNightAudit` and `consumers.invalidatesAri` in the same transaction as the write. `pms.time.time_zone` declares both. Routing timezone through `property.update_details` would move the business-date boundary **without** those side effects. A/B store-authority alternatives would reimplement them; **C inherits them for free.**

**Resolution:** `property.update_details` = **name only**. Timezone (and all other DOMAIN knobs) stay on `config.put_domain`. Status stays out — D1 `property.status` participates in routing; flipping it via a details CRUD would be a routing change in costume. Jurisdiction remains immutable.

### 2.2 `settings:configure` + per-key DO gate

Eighty-eight of ninety register entries default to `settings:configure` (not in `PERMISSIONS`); two availability knobs override to `inventory:configure`. That split is deliberate: overbooking policy is inventory-scoped; tax/currency/folio/timezone are not. `ConfigEntry.permission` is typed `string`, so nothing typechecks the fiction.

**Resolution:**

1. Add `settings:configure` to `PROPERTY_SCOPED_PERMISSIONS` and grant owner + admin (mirror `inventory:configure`). Same roles, same reachable keys today — structural prize is the type narrow.
2. Narrow `ConfigEntry.permission: string` → `Permission`.
3. Catalog + route audit for `config.put_domain` carry **`settings:configure`** (majority case).
4. DO, after register lookup: `gatePermission(actor, requiredPermissionForKey(key))` where the helper returns `getConfigEntry(key).permission`.

**Edge / DO asymmetry (stated):** for the two availability keys, edge demands `settings:configure` while DO demands `inventory:configure`. Settings-only → pass edge, refuse at DO. Inventory-only → refuse at edge. The edge is therefore stricter or equal, never more permissive (Rule 3). Inventory-only is **unreachable while every role that has one has both** — document so role divergence doesn’t surprise.

**System actors:** `gatePermission` short-circuits all system actors, so `{ kind: 'system', reason: 'provision' }` bypasses the per-key check. Correct for first-write provision (no user yet). **Per-key enforcement protects the HTTP path only**, not every writer.

**Wiring honesty:** S1 locks register data; S2 locks the helper’s return values. Neither proves the gate *calls* the helper — hardcoding `settings:configure` in `tryPutDomainConfig` would leave both green. That wiring is **unguarded and accepted** until a role holds one permission without the other (then an outcome test becomes buildable). Do not claim S1/S2 lock gate selection.

### 2.3 Derive audit actor; delete `meta.actor` input

Today `meta.actor` is a plain string written to `property_config.updated_by`, `property_config_audit.actor`, and outbox `payload.actor`. Adding `ActorContext` for the gate without removing `meta.actor` would leave two actor notions; the natural handler would populate audit from the body — any permitted caller could attribute a timezone/currency/tax change to someone else.

**Resolution:**

```ts
tryPutDomainConfig(
  actor: ActorContext,
  key: string,
  value: unknown,
  meta: { reason: string; effectiveFrom?: string },
  idem: IdempotencyKey,
)
```

```ts
const auditActor = actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;
```

Extend `SystemActor.reason` with `'provision'`. `ensureTimeZoneIfAbsent` / `ensureCurrencyIfAbsent` pass `{ kind: 'system', reason: 'provision' }`. That yields **byte-identical** `'system:provision'` vs today’s string — provision audit rows are behavior-preserving.

Fingerprint becomes `{ key, value, reason }` — drop `actor` (no longer client-controlled). `effectiveFrom` stays excluded.

Delete the thin `putDomainConfig` wrapper (zero callers in `src` or `test`).

Also delete `upsertRestrictionDay` (property-do.ts) — same category: test-only wrapper around `tryUpsertRestrictionDay` that fabricates `key: test-restrict-${crypto.randomUUID()}`, silently disabling idempotency (anti-pattern flagged when DELETE minted keys from `Date.now()`). Three call sites in `property-do.spec.ts` switch to `tryUpsertRestrictionDay(TEST_OWNER_ACTOR, …)` directly.

### 2.4 Name update: `FAIL_CLOSED`, D1 then OrgDO

`QUEUE_PROVISIONAL` assumes the PropertyDO plane. Under C the SoR write is D1. Provisional helpers don’t cover it.

**Ordering (normative — matches provision.ts):**

1. D1 `UPDATE property SET name WHERE property_id = ?` — SoR; last-writer-wins; no idempotency row.
2. `OrgDO.tryUpdatePropertyDetails(actor, propertyId, { name }, idem)` — idempotency row, `property_ref` mirror, `property.updated` on **OrgDO** outbox (`source.do = org`).

**Never the reverse.** If OrgDO owned idempotency and D1 were second, a replay could return a cached success while D1 never updated — invisible lost update. With D1 first, reaching OrgDO implies D1 succeeded, so cached replay is truthful.

**Residual (accepted and stated):** D1 succeeds, OrgDO fails → error response, D1 ahead of mirror, client retry converges (both writes idempotent). Listings may show the old name until retry. Same honesty class as rate-plan orphans / reservation-fingerprint windows.

**Entitlement:** `check:entitlements` requires `FAIL_CLOSED` + non-empty `events` to carry entitlement or opt-out. Name is tenancy metadata (same category as `get_property`, which has no entitlement). Opt-out reason must be true — not *"Phase 1 — not yet gated at a DO boundary"* (OrgDO does gate it):

```ts
{ id: 'property.update_details', reason: 'Tenancy metadata, not product data — no feature gate applies.' }
```

**Kill-switch consequence (stated):** `dispatchV1` only evaluates the kill-switch when `entitlementForRoute(route)` is set. The opt-out therefore makes **`patch_property_details` unkillable** — you cannot shed load on property-name updates via the kill switch. Accepted on tenancy-metadata grounds; record it as a property, not an emergent side effect.

### 2.5 `rematerializesRates` (log only)

Only `invalidatesAri` and `reschedulesNightAudit` are honored in `tryPutDomainConfig`. `pms.time.time_zone` (and others) declare `rematerializesRates: true` with no action. Pre-existing. Under C the config path is the *only* way to change timezone, so the gap is load-bearing — fix in a later slice, not this one.

### 2.6 OrgDO transport fault injection

Test 7 (OrgDO fault after D1) and M3 (ordering inverted) need a constructible fault. OrgDO today has no twin of PropertyDO’s `setTransportBlockedForTest`.

**Resolution:** add OrgDO `setTransportBlockedForTest` + `assertRpcAvailable` on mutating RPCs that the details path calls, mirroring PropertyDO / `property-do-transport.ts` (dedicated `org-do-transport.ts` with allowlist + `isOrgDoTransportFailure`). Handler maps transport failure to `503` / `org_unreachable` with `Retry-After` (same pattern as guest OrgDO handlers after the honesty fix). Do **not** substitute an extracted ordering helper alone — that would leave the accepted dual-write residual unverified on the real path.

---

## 3. Routes / API surface

### 3.1 Route audit

| Audit id | Method / path | Permission | Command | Notes |
|---|---|---|---|---|
| `patch_property_details` | `PATCH /v1/properties/:propertyId` | `config:write` | `property.update_details` | `FAIL_CLOSED`; no entitlement (opt-out); unkillable (§2.4) |
| `put_domain_config` | `PUT /v1/properties/:propertyId/config/domain` | `settings:configure` | `config.put_domain` | Edge majority; DO per-key |

Existing modify / cancel / no_show / restriction-days routes: pass `actor` only — audit rows unchanged.

### 3.2 Bodies

**`PATCH …/properties/:propertyId`**
```ts
{ name: string; idempotencyKey: string }
// 200
{ ok: true; propertyId: string; name: string }
```
OrgDO fingerprint: `{ propertyId, name }`.

**`PUT …/config/domain`**
```ts
// no actor field
{ key: string; value: unknown; reason: string; effectiveFrom?: string; idempotencyKey: string }
// 200
{ ok: true; key: string; version: number; events: string[] }
```
Fingerprint: `{ key, value, reason }`. Unknown body `actor` ignored (dispatcher cast); M2 locks audit authenticity.

### 3.3 Catalog / permissions / register

```ts
// permissions — PROPERTY_SCOPED + ROLE_GRANTS owner/admin
'settings:configure'

// SystemActor.reason
'night_audit' | 'migration_sweep' | 'queue_replay' | 'provision'

// ConfigEntry.permission: Permission

// catalog
property.update_details: degraded: 'FAIL_CLOSED', notes: /* D1+OrgDO; not PropertyDO provisional */, permission: 'config:write'
config.put_domain: permission: 'settings:configure'  // was inventory:configure

// entitlements
ENTITLEMENT_FAIL_CLOSED_OPT_OUT += {
  id: 'property.update_details',
  reason: 'Tenancy metadata, not product data — no feature gate applies.',
}
```

`check:permissions` requires every catalog/route permission ∈ `PERMISSIONS` and granted to ≥1 role — land `settings:configure` in both `PERMISSIONS` and `ROLE_GRANTS` in the same commit as the catalog change.

---

## 4. DO signatures

### 4.1 PropertyDO — five-method pass

```ts
tryModifyReservation(actor: ActorContext, input: {…}, idem)
tryCancelReservation(actor: ActorContext, input: { reservationId }, idem)
tryNoShow(actor: ActorContext, input: { reservationId }, idem)
tryUpsertRestrictionDay(actor: ActorContext, input: {…}, idem)

tryPutDomainConfig(
  actor: ActorContext,
  key: string,
  value: unknown,
  meta: { reason: string; effectiveFrom?: string },
  idem: IdempotencyKey,
)
```

Order (four reservation/restriction methods): `assertRpcAvailable` → lanes → orgId → **gate** → existing entitlement / checks → `runIdempotent`.

**`tryPutDomainConfig` order (normative — register before gate):**

```
assertRpcAvailable → lanes → orgId
  → register lookup (undeclared / non-DOMAIN → return-style error)
  → gatePermission(actor, requiredPermissionForKey(key))   // helper only after lookup succeeded
  → entitlement → runIdempotent
```

Two consequences:

1. **The helper throws; the existing path returns.** Call `requiredPermissionForKey` only after undeclared/class checks have passed — otherwise an unknown key becomes a thrown error / generic 500 and breaks §5.2 test 3.
2. **At the DO, an undeclared-key error is returned before permission is checked.** Reachable only by a caller who already cleared the edge’s `settings:configure`, so exposure is bounded. Ordering property, not an accident — do not “fix” by hoisting the gate above the lookup.

| Method | Gate |
|---|---|
| modify / cancel / no_show | `reservations:write` |
| upsertRestrictionDay | `rates:write` |
| putDomainConfig | `requiredPermissionForKey(key)` **after** register lookup |

Delete `putDomainConfig` and `upsertRestrictionDay` wrappers.

### 4.2 OrgDO — name command + fault hook

```ts
tryUpdatePropertyDetails(
  actor: ActorContext,
  propertyId: string,
  input: { name: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; propertyId: string; name: string }
  | { ok: false; error: /* FORBIDDEN | not_member | scope_mismatch | IDEM_KEY_REUSED | … */ }
>
```

Order: `assertRpcAvailable` → lanes → orgId → `gatePermission(actor, propertyId, 'config:write')` → **no** `gateCoreEntitlement` → `runIdempotent`: upsert `property_ref` name (preserve jurisdiction / time_zone / status) → `property.updated` on OrgDO outbox.

```ts
async setTransportBlockedForTest(blocked: boolean): Promise<void>  // HOSPAI_UNSAFE_LOCAL only
```

### 4.3 `requiredPermissionForKey`

```ts
// packages/contracts — pure; used by DO gate and S2
export function requiredPermissionForKey(key: string): Permission {
  const entry = getConfigEntry(key);
  if (!entry) throw new Error(`undeclared:${key}`);
  return entry.permission;
}
```

---

## 5. Test matrix

### 5.1 `property-details-routes.spec.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | PATCH name | `200`; D1 + OrgDO `property_ref` names match; outbox `property.updated` with **org** source |
| 2 | Replay same idem key | Identical `200`; single outbox event |
| 3 | Fingerprint reuse | `409 idempotency_key_reused` |
| 4 | `staff` | `403` |
| 5 | Non-member | `404` |
| 6 | Unentitled org | `200` — opt-out canary; **also documents unkillable** (no feature → kill-switch never evaluated) |
| 7 | OrgDO transport blocked after D1 | Error / `503 org_unreachable`; D1 has new name; unblock + retry → mirror + event converge |

### 5.2 `domain-config-routes.spec.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | PUT `pms.time.time_zone` | `200`; audit `actor` = auth userId; consumer side effects still fire |
| 2 | PUT overbooking as owner | `200` |
| 3 | Undeclared / non-DOMAIN | existing error mapping |
| 4 | Body spoof `actor` ≠ auth user | Audit + outbox actor = auth userId (M2) |
| 5 | `staff` | `403` at edge |
| 6 | Kill-switch / unentitled | `503` / `402` (`pms.core`) |
| 7 | Replay | Identical response; version unchanged |

### 5.3 Selection locks (not outcome-level M1)

| # | Where | Assertion |
|---|---|---|
| S1 | `register.test.ts` | Exactly `pms.availability.allow_overbooking` + `pms.availability.oversell_allowance` are DOMAIN ∩ `inventory:configure`; every other DOMAIN key is `settings:configure` |
| S2 | contracts test on helper | `requiredPermissionForKey('pms.availability.allow_overbooking') === 'inventory:configure'`; `requiredPermissionForKey('pms.time.time_zone') === 'settings:configure'` |

**Follow-up (not this slice):** outcome test when a role holds one permission without the other.

**Wiring:** unguarded — S1/S2 do not prove the DO calls the helper (§2.2).

### 5.4 Ordering canary (M3)

**Decision:** test 7 is the load-bearing residual proof (OrgDO fault after D1 → error, D1 ahead, retry converges). M3 is a **review-time mutation** — invert handler to OrgDO-then-D1 and confirm a reviewer would catch lost-update-on-replay — not a shipped automated case. Do not leave this as “if injecting order inversion is awkward.”

### 5.5 Fixture churn

| Area | Change |
|---|---|
| All `tryPutDomainConfig` sites | `ActorContext` first; `meta` without `actor`; fingerprints without `actor`; provision → `{ kind: 'system', reason: 'provision' }` |
| modify / cancel / no_show / `tryUpsertRestrictionDay` | Pass actor at every DO + HTTP call site |
| `property-do.spec.ts` (3 sites) | Drop `upsertRestrictionDay` wrapper; call `tryUpsertRestrictionDay(TEST_OWNER_ACTOR, …)` with real idem keys |
| `configIdem` helpers | Drop `actor` from fingerprint |
| Delete | `putDomainConfig` and `upsertRestrictionDay` wrappers |

### 5.6 Capacity

Already landed: Workflows force `isolatedStorage: false`; CI + local `pnpm test` use `1/4`–`4/4`. No further bump in this slice.

---

## 6. Acceptance, files, leftovers

### 6.1 Acceptance

1. PATCH name → D1 + OrgDO mirror + org-sourced `property.updated`; replay safe; D1-ahead residual covered by OrgDO fault injection (test 7).
2. PUT domain config → audit actor derived; spoof body actor ignored (M2); TZ still reschedules night audit / invalidates ARI.
3. S1 locks the 88/2 register split; S2 locks helper return values; **gate↔helper wiring unguarded and accepted** until roles diverge.
4. Five formerly ungated `try*` methods require actor + permission; HTTP handlers pass actor.
5. `settings:configure` in `PERMISSIONS` + `ROLE_GRANTS`; `ConfigEntry.permission: Permission`; catalog/route majority case; checks green.
6. `property.update_details` → `FAIL_CLOSED` + honest opt-out; route unkillable (stated); `putDomainConfig` deleted; provision audit strings byte-identical `'system:provision'`.
7. Suite green on `1/4`–`4/4`.

### 6.2 Files

| Area | Touch |
|---|---|
| `packages/contracts` | `settings:configure`; `SystemActor` + `'provision'`; `ConfigEntry.permission`; `requiredPermissionForKey`; catalog; opt-out; route audit ×2; register.test S1 + helper S2 |
| `apps/pms-core/src/property-do.ts` | Five-method pass; derive audit actor; delete `putDomainConfig` + `upsertRestrictionDay`; gate via helper after register lookup |
| `apps/pms-core/src/org-do.ts` | `tryUpdatePropertyDetails`; `setTransportBlockedForTest` + `assertRpcAvailable` |
| `apps/pms-core/src/org-do-transport.ts` | New — mirror property-do-transport |
| `apps/pms-core/src/registry.ts` | D1 name update helper |
| `apps/pms-core/src/v1-dispatch.ts` | Two handlers; actor on four existing handlers; OrgDO transport mapping on details |
| Tests | New route specs; fixture churn; M2; test 7 |
| This spec | Include in final commit |

No `REPLAY_DISPATCH` / `pending-commands` changes.

### 6.3 Leftovers (logged)

```
STILL OUT  reservations.update_status   reservations.update_extras
           night_audit.run              audit.append
           (+ five night-audit stubs)

DEAD FLAG  rematerializesRates — declared on TZ (and others); not acted on in tryPutDomainConfig
           GET /v1/properties/:pid/config/domain added by [property setup SPA](./2026-08-13-property-setup-spa-design.md) so DOMAIN PUT can round-trip. rematerializesRates remains a dead flag.

UNGUARDED  helper→gatePermission wiring for per-key config (accepted until roles diverge)

WRAPPERS   createFolioWindow / addFolioLine — same test-only / minted-idem-key shape as the
           deleted putDomainConfig + upsertRestrictionDay; leave for a later cleanup pass
```

### 6.4 Open questions

None. Settled: store authority C; settings:configure + type narrow; D1→OrgDO FAIL_CLOSED; audit actor derivation; OrgDO fault hook; S1/S2 vs wiring honesty; night_audit.run exclusion; unkillable name route.

---

## 7. Implementation checklist

- [ ] `settings:configure` in `PERMISSIONS` + owner/admin `ROLE_GRANTS`; `SystemActor.reason` += `'provision'`.
- [ ] `ConfigEntry.permission: Permission`; `requiredPermissionForKey`; S1 + S2.
- [ ] Catalog: `property.update_details` → `FAIL_CLOSED` + notes + opt-out; `config.put_domain` → `settings:configure`.
- [ ] Route audit ×2; handlers; actor on modify/cancel/no_show/restriction.
- [ ] PropertyDO five-method signature pass; `tryPutDomainConfig` register-lookup → then per-key gate → derive audit actor; delete `putDomainConfig` + `upsertRestrictionDay`.
- [ ] OrgDO `tryUpdatePropertyDetails` + transport fault hook; D1 name helper; handler order D1→OrgDO.
- [ ] Fixture churn for `tryPutDomainConfig` / reservation DO calls / three restriction spec sites; provision byte-identical `'system:provision'`.
- [ ] Route specs + M2 + test 7; `check:*` green; suite `1/4`–`4/4`.
