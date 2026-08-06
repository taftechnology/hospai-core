# Rule 3 Cleanup + Config Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Rule 3 on five ungated PropertyDO `try*` methods; route `config.put_domain` with per-key `settings:configure` / `inventory:configure` gates and derived audit actors; implement name-only `property.update_details` as D1→OrgDO `FAIL_CLOSED`.

**Architecture:** Config privilege split is expressed in the register (`ConfigEntry.permission: Permission`) and enforced at the DO after undeclared/class checks via `requiredPermissionForKey`. Name updates write Platform D1 first, then OrgDO (idempotency + mirror + `property.updated`). Capacity already landed (4 shards; Workflows force `isolatedStorage: false`).

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, existing `gatePermission` / `runIdempotent` / `V1_HTTP_ROUTE_AUDIT` / `requirePermission` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-06-rule3-config-surface-design.md`](../specs/2026-08-06-rule3-config-surface-design.md) (v2)

## Global Constraints

- **Register lookup before per-key gate** on `tryPutDomainConfig`. Call `requiredPermissionForKey` only after undeclared / non-DOMAIN return-style checks.
- **Audit actor derived from `ActorContext`** — never from request body. `meta.actor` removed.
- **Provision audit byte-identical:** `{ kind: 'system', reason: 'provision' }` → `'system:provision'`.
- **D1 name then OrgDO** — never reverse. Test 7 (OrgDO transport block) is the load-bearing residual proof; M3 is review-time only.
- **Delete both wrappers:** `putDomainConfig` and `upsertRestrictionDay`. Leave `createFolioWindow` / `addFolioLine` alone (logged leftover).
- **Helper→gate wiring unguarded** — S1/S2 lock data + helper returns only; do not invent branded types or fake roles.
- **`settings:configure` in `PERMISSIONS` + `ROLE_GRANTS` same commit as catalog** (`check:permissions`).
- **Route audit indices 43–44** in order `patch_property_details`, `put_domain_config`. Append `V1_ROUTES` in the **same order** same commit.
- **TDD** where listed; suite via `1/4`–`4/4` (already the package `test` script).

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Gate `tryPutDomainConfig` on command permission instead of helper | Not automated (wiring unguarded) — S1/S2 still green; outcome test is a follow-up when roles diverge |
| Spoof body `actor` into audit | domain-config-routes test 4 (M2) |
| OrgDO then D1 in details handler | Review-time M3; production residual covered by test 7 |
| Drop OrgDO transport allowlist match | test 7 fails to assert `503` / convergence |
| Keep `upsertRestrictionDay` minting UUID keys | Reviewer: three `property-do.spec.ts` sites must use real idem keys |
| Divergent DOMAIN permission defaults | S1 in `register.test.ts` |

### Shared catalog notes (copy onto `property.update_details`)

```ts
const PROPERTY_UPDATE_DETAILS_FAIL_CLOSED_NOTES =
  'FAIL_CLOSED because the authoritative write is Platform D1 + OrgDO mirror, ' +
  'not the PropertyDO provisional plane. Name is tenancy metadata (read-your-write ' +
  'for GET property). Residual: D1 may lead the OrgDO mirror if OrgDO fails after ' +
  'D1 — client retry converges; both writes are idempotent.';
```

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/permissions.ts` | `settings:configure`; `SystemActor.reason` += `'provision'`; admin `ROLE_GRANTS` |
| `packages/contracts/src/config/register.ts` | `ConfigEntry.permission: Permission`; `requiredPermissionForKey` |
| `packages/contracts/src/commands/catalog.ts` | `update_details` FAIL_CLOSED + notes; `put_domain` → `settings:configure` |
| `packages/contracts/src/entitlements.ts` | Opt-out row for `property.update_details` |
| `packages/contracts/src/v1-http-routes.ts` | Audit rows 43–44 |
| `packages/contracts/src/register.test.ts` | S1 + catalog/opt-out guards |
| `packages/contracts/src/config/required-permission.test.ts` (or register.test) | S2 |
| `apps/pms-core/src/property-do-transport.ts` | unchanged (PropertyDO) |
| `apps/pms-core/src/org-do-transport.ts` | **Create** — OrgDO allowlist + `isOrgDoTransportFailure` |
| `apps/pms-core/src/property-do.ts` | Five-method pass; config order; delete wrappers |
| `apps/pms-core/src/org-do.ts` | `tryUpdatePropertyDetails`; transport fault hook |
| `apps/pms-core/src/registry.ts` | `updatePropertyName` |
| `apps/pms-core/src/v1-dispatch.ts` | Two handlers; actor on four existing routes |
| `apps/pms-core/test/property-do.spec.ts` + config callers | Fixture churn |
| `apps/pms-core/test/property-details-routes.spec.ts` | **Create** |
| `apps/pms-core/test/domain-config-routes.spec.ts` | **Create** |
| Spec + plan | Ship with implementation |

---

### Task 1: Contracts — permission, register type, helper, catalog, routes, opt-out

**Files:**
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/config/register.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/entitlements.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `settings:configure` ∈ `PERMISSIONS` / admin grants; owner via `GRANTABLE_PERMISSIONS`
- Produces: `SystemActor.reason` includes `'provision'`
- Produces: `requiredPermissionForKey(key): Permission`
- Produces: audit ids `patch_property_details`, `put_domain_config` at indices 43–44

- [ ] **Step 1: Write failing S1 / S2 / catalog tests (RED)**

```ts
// register.test.ts
it('DOMAIN keys: exactly two inventory:configure; rest settings:configure', () => {
  const domain = domainConfigKeys();
  const inventory = domain.filter((e) => e.permission === 'inventory:configure').map((e) => e.key).sort();
  expect(inventory).toEqual([
    'pms.availability.allow_overbooking',
    'pms.availability.oversell_allowance',
  ]);
  for (const e of domain) {
    if (!inventory.includes(e.key)) {
      expect(e.permission, e.key).toBe('settings:configure');
    }
  }
});

it('requiredPermissionForKey mirrors register for inventory and settings keys', () => {
  expect(requiredPermissionForKey('pms.availability.allow_overbooking')).toBe('inventory:configure');
  expect(requiredPermissionForKey('pms.time.time_zone')).toBe('settings:configure');
});

it('property.update_details is FAIL_CLOSED with tenancy opt-out; config.put_domain uses settings:configure', () => {
  const details = COMMAND_CATALOG.find((c) => c.id === 'property.update_details');
  expect(details?.degraded).toBe('FAIL_CLOSED');
  expect(details?.permission).toBe('config:write');
  expect(details?.entitlement).toBeUndefined();
  expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((r) => r.id === 'property.update_details')).toBe(true);
  const opt = ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((r) => r.id === 'property.update_details');
  expect(opt?.reason).toMatch(/Tenancy metadata/i);
  expect(opt?.reason).not.toMatch(/not yet gated at a DO boundary/i);

  const put = COMMAND_CATALOG.find((c) => c.id === 'config.put_domain');
  expect(put?.permission).toBe('settings:configure');
  expect(put?.degraded).toBe('FAIL_CLOSED');
});

it('route audit 43–44 are patch_property_details then put_domain_config', () => {
  expect(V1_HTTP_ROUTE_AUDIT[43]?.id).toBe('patch_property_details');
  expect(V1_HTTP_ROUTE_AUDIT[44]?.id).toBe('put_domain_config');
  expect(V1_HTTP_ROUTE_AUDIT[43]).toMatchObject({
    scope: 'property',
    permission: 'config:write',
    commandId: 'property.update_details',
  });
  expect(V1_HTTP_ROUTE_AUDIT[44]).toMatchObject({
    scope: 'property',
    permission: 'settings:configure',
    commandId: 'config.put_domain',
  });
});
```

Run: `pnpm --filter @hospai/contracts test`  
Expected: FAIL — `settings:configure` / helper / catalog / audit missing.

- [ ] **Step 2: Implement contracts (GREEN)**

```ts
// permissions.ts — PROPERTY_SCOPED_PERMISSIONS (after inventory:configure)
'inventory:configure',
'settings:configure',
'reservations:read',

// SystemActor
reason: 'night_audit' | 'migration_sweep' | 'queue_replay' | 'provision';

// ROLE_GRANTS.admin — add next to inventory:configure
'inventory:configure',
'settings:configure',

// register.ts
import type { Permission } from '../permissions.js';
// ConfigEntry.permission: Permission
// entry() default stays 'settings:configure' (now a real Permission)

export function requiredPermissionForKey(key: string): Permission {
  const entry = getConfigEntry(key);
  if (!entry) throw new Error(`undeclared:${key}`);
  return entry.permission;
}

// catalog — property.update_details
degraded: 'FAIL_CLOSED',
notes: PROPERTY_UPDATE_DETAILS_FAIL_CLOSED_NOTES,
permission: 'config:write',
// no entitlement

// catalog — config.put_domain
permission: 'settings:configure',

// entitlements.ts
{ id: 'property.update_details', reason: 'Tenancy metadata, not product data — no feature gate applies.' },

// v1-http-routes.ts — append after get_guest
{
  id: 'patch_property_details',
  scope: 'property',
  permission: 'config:write',
  commandId: 'property.update_details',
},
{
  id: 'put_domain_config',
  scope: 'property',
  permission: 'settings:configure',
  commandId: 'config.put_domain',
},
```

Run: `pnpm --filter @hospai/contracts test` && `pnpm check:permissions` && `pnpm check:entitlements` && `pnpm check:degraded`  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts
git commit -m "$(cat <<'EOF'
feat(contracts): settings:configure, per-key helper, config surface catalog

EOF
)"
```

---

### Task 2: PropertyDO — five-method signature pass, config audit derivation, delete wrappers

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: every test/production caller of `tryPutDomainConfig`, `tryModifyReservation`, `tryCancelReservation`, `tryNoShow`, `tryUpsertRestrictionDay`
- Modify: `apps/pms-core/test/property-do.spec.ts` (delete wrapper usage)
- Modify: `apps/pms-core/test/{lane-guard,events-queue,observability,night-audit,reservations}.spec.ts` (`configIdem` fingerprints)

**Interfaces:**
- Consumes: `ActorContext`, `requiredPermissionForKey`, `'provision'` system reason
- Produces: five methods take `actor` first; `tryPutDomainConfig` meta without `actor`

- [ ] **Step 1: Delete wrappers + fix restriction test (RED then GREEN locally)**

Delete from `property-do.ts`:
- `putDomainConfig` (≈1412–1421)
- `upsertRestrictionDay` (≈3754–3783)

Replace `property-do.spec.ts` three sites:

```ts
import { TEST_OWNER_ACTOR } from './fixtures.js';

const body = {
  roomTypeId: 'rt_king',
  ratePlanId: '*', // or TYPE_WIDE constant used elsewhere
  stayDate: '2026-08-01',
  minLos: 2,
  maxLos: null,
  cta: false,
  ctd: false,
  stopSell: false,
};
const r = await stub.tryUpsertRestrictionDay(
  TEST_OWNER_ACTOR,
  body,
  await idemFor('restrict-1', body),
);
expect(r.ok).toBe(true);
// similarly for minLos 5 and 9 with distinct idem keys
```

- [ ] **Step 2: Signature-pass the five methods**

For modify / cancel / no_show / upsertRestrictionDay — mirror `tryCheckIn` ordering:

```ts
async tryCancelReservation(
  actor: ActorContext,
  input: { reservationId: string },
  idem: IdempotencyKey,
): Promise<…> {
  this.assertRpcAvailable();
  this.lanes.touchInteractive();
  const orgId = this.getOrgIdSync();
  if (!orgId) return { ok: false, error: 'org_id_unset' };
  const permDenied = await this.gatePermission(actor, 'reservations:write');
  if (permDenied) return permDenied;
  // … existing entitlement + body
}
```

`tryUpsertRestrictionDay` → `gatePermission(actor, 'rates:write')`.

- [ ] **Step 3: Reshape `tryPutDomainConfig`**

```ts
async tryPutDomainConfig(
  actor: ActorContext,
  key: string,
  value: unknown,
  meta: { reason: string; effectiveFrom?: string },
  idem: IdempotencyKey,
): Promise<…> {
  this.assertRpcAvailable();
  this.lanes.touchInteractive();
  const orgId = this.getOrgIdSync();
  if (!orgId) return { ok: false, error: 'org_id_unset' };

  const entry = getConfigEntry(key);
  if (!entry) return { ok: false, error: `undeclared:${key}` };
  if (entry.class !== 'DOMAIN') {
    return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
  }

  const permDenied = await this.gatePermission(actor, requiredPermissionForKey(key));
  if (permDenied) return permDenied;

  const denied = await this.gateCoreEntitlement(orgId);
  if (denied) return denied;

  const auditActor = actor.kind === 'user' ? actor.userId : `system:${actor.reason}`;
  // runIdempotent: use auditActor for updated_by / property_config_audit / outbox payload.actor
  // meta.reason / meta.effectiveFrom unchanged
}
```

Update doc comment: fingerprint is `fingerprintPayload({ key, value, reason: meta.reason })`.

- [ ] **Step 4: Fix ensure* + all call sites**

```ts
// ensureTimeZoneIfAbsent / ensureCurrencyIfAbsent
const result = await this.tryPutDomainConfig(
  { kind: 'system', reason: 'provision' },
  'pms.time.time_zone', // or currency key
  timeZone,
  { reason: 'provision:first-write-timezone' },
  idem,
);
```

Update every test `configIdem` helper:

```ts
async function configIdem(key: string, value: unknown, reason: string) {
  return {
    key: `cfg-${key}-${crypto.randomUUID()}`, // or existing key scheme
    fingerprint: await fingerprintPayload({ key, value, reason }),
  };
}
```

Pass `TEST_OWNER_ACTOR` (or system actor where appropriate) as first arg. Update reservation/night-audit/events/lane-guard/observability/property-do specs and any HTTP handlers that call the four reservation methods without actor.

- [ ] **Step 5: Run pms-core shards**

```bash
pnpm --filter @hospai/pms-core test
```

Expected: PASS (294+ tests; signature churn complete). Fix any missed call sites the compiler/tests surface.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core
git commit -m "$(cat <<'EOF'
feat(pms-core): Rule 3 signature pass + derived config audit actor

EOF
)"
```

---

### Task 3: OrgDO — `tryUpdatePropertyDetails` + transport fault hook; D1 name helper

**Files:**
- Create: `apps/pms-core/src/org-do-transport.ts`
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `apps/pms-core/src/registry.ts`

**Interfaces:**
- Produces: `tryUpdatePropertyDetails(actor, propertyId, { name }, idem)`
- Produces: `setTransportBlockedForTest` / `isOrgDoTransportFailure`
- Produces: `updatePropertyName(env, propertyId, name): Promise<boolean>`

- [ ] **Step 1: OrgDO transport module (mirror PropertyDO)**

```ts
// org-do-transport.ts
export const ORG_DO_TRANSPORT_BLOCKED_MESSAGE =
  'OrgDO transport blocked for test (degraded-mode fault injection)' as const;

export const ORG_DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
];

export function isOrgDoTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return ORG_DO_TRANSPORT_ALLOWLIST.some((fragment) => error.message.includes(fragment));
}
```

- [ ] **Step 2: OrgDO fault hook + assertRpcAvailable on mutating commands used by details**

```ts
private transportBlockedForTest = false;

private assertRpcAvailable(): void {
  if (this.transportBlockedForTest) {
    throw new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE);
  }
}

async setTransportBlockedForTest(blocked: boolean): Promise<void> {
  this.assertUnsafeLocal('setTransportBlockedForTest');
  this.transportBlockedForTest = blocked;
}
```

Call `assertRpcAvailable()` at the top of `tryUpdatePropertyDetails` (and prefer also on other public mutating RPCs touched by HTTP if cheap — minimum is the details method).

- [ ] **Step 3: `tryUpdatePropertyDetails`**

```ts
async tryUpdatePropertyDetails(
  actor: ActorContext,
  propertyId: string,
  input: { name: string },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; propertyId: string; name: string }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' | 'scope_mismatch' | typeof IDEM_KEY_REUSED }
  | { ok: false; error: string }
> {
  this.assertRpcAvailable();
  this.lanes.touchInteractive();
  const orgId = this.getOrgIdSync();
  if (!orgId) return { ok: false, error: 'org_id_unset' };

  const permDenied = await this.gatePermission(actor, propertyId, 'config:write');
  if (permDenied) return permDenied;
  // no gateCoreEntitlement — tenancy metadata

  try {
    return this.ctx.storage.transactionSync(() =>
      runIdempotent(this.ctx.storage.sql, idem, () => {
        const existing = this.ctx.storage.sql
          .exec(
            `SELECT jurisdiction, time_zone, status FROM property_ref WHERE property_id = ?`,
            propertyId,
          )
          .toArray() as Array<{ jurisdiction: string | null; time_zone: string; status: string }>;
        if (!existing[0]) {
          // Upsert still OK if provision raced — insert with defaults from input only for name
          // Prefer: UPDATE name; if 0 rows, INSERT with jurisdiction/time_zone unknown is wrong.
          // Spec: upsert name preserving other columns — if missing row, return not_found.
          return { ok: false as const, error: 'property_ref_not_found' };
        }
        this.ctx.storage.sql.exec(
          `UPDATE property_ref SET name = ? WHERE property_id = ?`,
          input.name,
          propertyId,
        );
        this.appendOrgOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'property.updated',
          payload: { orgId, propertyId, name: input.name },
        });
        return { ok: true as const, propertyId, name: input.name };
      }),
    );
  } catch (e) {
    if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

If `property_ref` is always present after provision (true today), `property_ref_not_found` → map to 404/422 in handler. Prefer failing closed over inventing jurisdiction/time_zone.

- [ ] **Step 4: D1 helper**

```ts
// registry.ts
export async function updatePropertyName(
  env: PmsEnv,
  propertyId: string,
  name: string,
): Promise<boolean> {
  const result = await env.PLATFORM_DB.prepare(
    `UPDATE property SET name = ? WHERE property_id = ?`,
  )
    .bind(name, propertyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
```

- [ ] **Step 5: Smoke — typecheck**

```bash
pnpm --filter @hospai/pms-core typecheck
```

Expected: PASS (handlers not wired yet — OK).

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/org-do-transport.ts apps/pms-core/src/org-do.ts apps/pms-core/src/registry.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): OrgDO property details + transport fault injection

EOF
)"
```

---

### Task 4: Dispatcher — two new routes + actor on four existing handlers

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`

**Interfaces:**
- Consumes: `updatePropertyName`, `tryUpdatePropertyDetails`, `tryPutDomainConfig`, `isOrgDoTransportFailure`
- Produces: `V1_ROUTES` entries matching audit indices 43–44

- [ ] **Step 1: Wire actor into existing handlers**

`handlePatchReservation`, `handlePostReservationCancel`, `handlePostReservationNoShow` (via status action), `handlePutRestrictionDays`:

```ts
const actor = { kind: 'user' as const, userId: ctx.actor.userId };
const result = await resolvedCtx.resolved.stub.tryModifyReservation(actor, {…}, idem);
// cancel / no_show / upsertRestrictionDay — same
```

For `handlePostReservationStatusAction`, `tryNoShow` currently ignores actor — change the action callback to pass `actor` into `tryNoShow`.

- [ ] **Step 2: `handlePatchPropertyDetails`**

```ts
async function handlePatchPropertyDetails(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { name?: string; idempotencyKey?: string };
  if (!body?.name || !body.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const updated = await updatePropertyName(ctx.env, propertyId, body.name);
  if (!updated) return json({ error: 'not_found' }, 404);

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({ propertyId, name: body.name });

  try {
    const result = await org.tryUpdatePropertyDetails(
      actor,
      propertyId,
      { name: body.name },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      if (result.error === FORBIDDEN || result.error === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'config:write' }, 403);
      }
      return json({ ok: false, error: result.error }, result.error === IDEM_KEY_REUSED ? 409 : 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'property.update_details' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}
```

- [ ] **Step 3: `handlePutDomainConfig`**

```ts
async function handlePutDomainConfig(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as {
    key?: string;
    value?: unknown;
    reason?: string;
    effectiveFrom?: string;
    idempotencyKey?: string;
  };
  if (!body?.key || body.value === undefined || !body.reason || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({
    key: body.key,
    value: body.value,
    reason: body.reason,
  });
  const meta = {
    reason: body.reason,
    ...(body.effectiveFrom !== undefined ? { effectiveFrom: body.effectiveFrom } : {}),
  };

  // Prefer invokePropertyDo if sibling FAIL_CLOSED config-like commands use it;
  // otherwise direct stub call + isPropertyDoTransportFailure like other FAIL_CLOSED routes.
  const result = await resolvedCtx.resolved.stub.tryPutDomainConfig(
    actor,
    body.key,
    body.value,
    meta,
    { key: body.idempotencyKey, fingerprint },
  );
  if (!result.ok) {
    return json({ ok: false, error: result.error }, mapConfigErrorStatus(result.error));
  }
  return json(
    { ok: true, key: result.key, version: result.version, events: result.events },
    200,
  );
}
```

Map `undeclared:*` / class errors → 400; `FORBIDDEN` → 403; `IDEM_KEY_REUSED` → 409; entitlement → existing convention.

- [ ] **Step 4: Append `V1_ROUTES` (same order as audit 43–44)**

```ts
{
  scope: 'property',
  method: 'PATCH',
  pattern: /^\/v1\/properties\/([^/]+)$/,
  permission: 'config:write',
  commandId: 'property.update_details',
  handler: handlePatchPropertyDetails,
},
{
  scope: 'property',
  method: 'PUT',
  pattern: /^\/v1\/properties\/([^/]+)\/config\/domain$/,
  permission: 'settings:configure',
  commandId: 'config.put_domain',
  handler: handlePutDomainConfig,
},
```

**Conflict check:** `PATCH /v1/properties/:id` must not steal guest/reservation patches (those have extra path segments). Confirm `findRoute` first-match order — append is fine if more-specific routes are registered earlier (they are).

- [ ] **Step 5: `pnpm check:permissions` + typecheck**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): HTTP routes for property details and domain config

EOF
)"
```

---

### Task 5: Route specs — details + domain config

**Files:**
- Create: `apps/pms-core/test/property-details-routes.spec.ts`
- Create: `apps/pms-core/test/domain-config-routes.spec.ts`

- [ ] **Step 1: `property-details-routes.spec.ts` (tests 1–7)**

Reuse guests-routes provision helpers pattern (`postOrg` / `postProperty` / `x-dev-actor`).

Critical cases:

```ts
it('7: OrgDO transport blocked after D1 → error; D1 ahead; retry converges', async () => {
  const { orgId, propertyId, owner } = await provisionHotel('user_owner');
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.setTransportBlockedForTest(true);

  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${propertyId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
      body: JSON.stringify({ name: 'After Fault', idempotencyKey: 'idem-fault-1' }),
    }),
    env,
  );
  expect(res.status).toBe(503);
  const d1 = await getProperty(env, propertyId);
  expect(d1?.name).toBe('After Fault');
  const refs = await org.listPropertyRefs(); // or existing list helper
  expect(refs.find((r) => r.propertyId === propertyId)?.name).not.toBe('After Fault');

  await org.setTransportBlockedForTest(false);
  const retry = await worker.fetch(/* same idem key + name */, env);
  expect(retry.status).toBe(200);
  expect((await org.listPropertyRefs()).find((r) => r.propertyId === propertyId)?.name).toBe(
    'After Fault',
  );
});

it('6: unentitled org can still rename (opt-out / unkillable)', async () => {
  // provision without subscription / cancelSubscription — expect 200 on PATCH
});
```

Also: staff → 403; non-member → 404; replay; fingerprint conflict.

- [ ] **Step 2: `domain-config-routes.spec.ts` (tests 1–7 + M2)**

```ts
it('4: spoof body actor does not win audit', async () => {
  const put = await putDomain(propertyId, owner, {
    key: 'pms.time.time_zone',
    value: 'America/Chicago',
    reason: 'ops',
    actor: 'user_imposter', // ignored
    idempotencyKey: 'idem-spoof',
  });
  expect(put.status).toBe(200);
  // read property_config_audit via DO test helper or outbox payload
  const flush = await stub.flushOutbox();
  const row = /* find config.changed */;
  expect(JSON.parse(row.payload).actor).toBe(owner);
  expect(JSON.parse(row.payload).actor).not.toBe('user_imposter');
});
```

Add a small `testReadConfigAuditActorForTest(key)` on PropertyDO **only if** no existing read path — prefer outbox payload assertion to avoid new hooks.

- [ ] **Step 3: Run shards including new files**

```bash
pnpm --filter @hospai/pms-core test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test/property-details-routes.spec.ts apps/pms-core/test/domain-config-routes.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): property details and domain config HTTP matrix

EOF
)"
```

---

### Task 6: Final gates + docs

**Files:**
- `docs/superpowers/specs/2026-08-06-rule3-config-surface-design.md`
- `docs/superpowers/plans/2026-08-06-rule3-config-surface.md`

- [ ] **Step 1: Run all checks**

```bash
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm typecheck
pnpm --filter @hospai/pms-core test
```

Expected: all green.

- [ ] **Step 2: Reviewer M3 (manual note in PR)**

Invert D1↔OrgDO order locally, confirm test 7 or a one-off replay scenario would miss D1 updates — then restore. Do not ship the inversion.

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-08-06-rule3-config-surface-design.md \
  docs/superpowers/plans/2026-08-06-rule3-config-surface.md
git commit -m "$(cat <<'EOF'
docs: Rule 3 + config surface spec and implementation plan

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec item | Task |
|---|---|
| `settings:configure` + type narrow + S1/S2 | Task 1 |
| Catalog FAIL_CLOSED + opt-out + route audit | Task 1 |
| Five-method signature pass | Task 2 |
| `meta.actor` removal + provision byte-identity | Task 2 |
| Delete `putDomainConfig` + `upsertRestrictionDay` | Task 2 |
| Register lookup before gate | Task 2 Step 3 |
| OrgDO details + transport hook | Task 3 |
| D1→OrgDO handler | Task 4 |
| Actor on four existing routes | Task 4 |
| Route matrices + test 7 + M2 | Task 5 |
| Unkillable / wiring honesty / rematerializesRates / folio wrappers | Spec prose only (no code) |
| Capacity / 4 shards | Already on `main` (`5f4f6cc`) |

No TBD placeholders. Types match across tasks (`ActorContext`, `requiredPermissionForKey`, audit indices 43–44).
