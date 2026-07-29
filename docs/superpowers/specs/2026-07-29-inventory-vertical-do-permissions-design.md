# Inventory Vertical & DO-Internal Permission Enforcement Design

**Date:** 2026-07-29  
**Status:** Revised  
**Scope:** Complete the remaining HTTP inventory endpoints (`PUT` update room type, `DELETE` archive room type) and enforce DO-internal permission checks with in-DO caching (`PermissionDoCache`) and system-actor support to fulfill ARCHITECTURE §15 Rule 3 ("The edge is an optimization, never the only check").

---

## 1. Context & Motivation

Currently:
1. **HTTP Endpoints**: `POST /v1/properties/:propertyId/room-types` (`inventory.add_room_type`) is live. The routines `tryUpdateRoomType` and `tryDeleteRoomType` exist inside `PropertyDO` but have no exposed HTTP endpoints.
2. **Defense-in-Depth Security**: Permission checks (`inventory:write`, etc.) are currently enforced only at the `v1-dispatch.ts` edge. Internal execution paths hitting `PropertyDO` directly (service bindings, Queue replay, workflows) only check core entitlement (`pms.core`) and bypass permission gates.

This design completes the inventory HTTP endpoints and establishes a cached, RPC-safe, defense-in-depth permission gate inside `PropertyDO`.

---

## 2. Architecture & Design Decisions

### 2.1 Discriminated `ActorContext` Union
To support both authenticated users and non-user automated execution paths (e.g. night audit alarms, workflow sweeps, queue replays), we define a discriminated union for `ActorContext`:

```ts
// packages/contracts/src/permissions.ts
export type UserActor = {
  kind: 'user';
  userId: string;
};

export type SystemActor = {
  kind: 'system';
  reason: 'night_audit' | 'migration_sweep' | 'queue_replay';
};

export type ActorContext = UserActor | SystemActor;
```

- **RPC-Safe & Cloneable**: Complies with `@hospai/no-non-cloneable-boundary-types` lint rule.
- **Auditable**: System actions explicitly declare their operational context (`night_audit`, `queue_replay`) rather than bypassing types.

### 2.2 Cached In-DO Permission Gate (`PermissionDoCache`)
To prevent DO-to-DO network I/O (`OrgDO.assertPermission`) on every hot interactive command, `PropertyDO` maintains an in-memory `PermissionDoCache` (max age: 60 seconds), mirroring the `EntitlementDoCache` pattern.

```ts
// apps/pms-core/src/auth.ts (or inside PropertyDO)
export class PermissionDoCache {
  private cache = new Map<string, { role: OrgRole; cachedAt: number }>();
  static readonly MAX_AGE_MS = 60_000;

  invalidate(): void {
    this.cache.clear();
  }

  async getEffectiveRole(
    env: PmsEnv,
    orgId: string,
    propertyId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    const key = `${userId}:${propertyId}`;
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && now - entry.cachedAt < PermissionDoCache.MAX_AGE_MS) {
      return entry.role;
    }
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const res = await org.assertPermission({ userId, propertyId, permission: 'property:read' });
    // Fetch effective role directly from OrgDO
    const role = await org.getEffectiveRole(userId, propertyId);
    if (role) {
      this.cache.set(key, { role, cachedAt: now });
    }
    return role;
  }
}
```

#### `PropertyDO.gatePermission` Logic:
```ts
private async gatePermission(
  actor: ActorContext,
  permission: Permission,
): Promise<{ ok: false; error: typeof FORBIDDEN | 'not_member' } | null> {
  // 1. System actors short-circuit immediately
  if (actor.kind === 'system') {
    return null;
  }

  // 2. User actors evaluate against cached role & ROLE_GRANTS
  const orgId = this.getOrgIdSync();
  if (!orgId) return { ok: false, error: FORBIDDEN };
  const propertyId = this.getPropertyIdSync();
  if (!propertyId) return { ok: false, error: FORBIDDEN };

  const role = await this.permissionCache.getEffectiveRole(this.env, orgId, propertyId, actor.userId);
  if (!role) return { ok: false, error: 'not_member' };
  if (!ROLE_GRANTS[role].includes(permission)) {
    return { ok: false, error: FORBIDDEN };
  }
  return null;
}
```

- **Availability & Latency**: Cache hits require zero DO-to-DO RPC hops, keeping the DO input gate from dropping during checks.
- **Fault Tolerance**: In the event of temporary `OrgDO` unavailability, cached permissions allow `PropertyDO` interactive writes to proceed smoothly.

---

## 3. HTTP Endpoints & Dispatcher Wiring

Two new routes will be appended to `V1_ROUTES` in `apps/pms-core/src/v1-dispatch.ts` and `V1_HTTP_ROUTE_AUDIT` in `packages/contracts/src/v1-http-routes.ts`:

### 3.1 PUT /v1/properties/:propertyId/room-types/:roomTypeId
- **Route Pattern**: `/^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/` (`match[1]` = `propertyId`, `match[2]` = `roomTypeId`)
- **Command ID**: `inventory.update_room_type`
- **Permission**: `inventory:write`
- **Entitlement**: `pms.core`
- **Handler**: `handlePutRoomType`
  - Body: `{ code?, name?, roomCount?, maxOccupancy?, maxAdults?, idempotencyKey }`
  - Passes `actor = { kind: 'user', userId: ctx.actor.userId }` to `stub.tryUpdateRoomType`.
  - Returns `200 OK` on success, `409` on oversell (`OVERSELL`), `404` on missing room type, `403` on `FORBIDDEN`, `500` on `not_member` (registry/OrgDO state invariant failure).

### 3.2 DELETE /v1/properties/:propertyId/room-types/:roomTypeId
- **Route Pattern**: `/^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/` (`match[1]` = `propertyId`, `match[2]` = `roomTypeId`)
- **Command ID**: `inventory.delete_room_type`
- **Permission**: `inventory:write`
- **Entitlement**: `pms.core`
- **Handler**: `handleDeleteRoomType`
  - Reads `Idempotency-Key` header (standard header for HTTP `DELETE` requests with no request body), falling back to query param `idempotencyKey`.
  - Passes `actor = { kind: 'user', userId: ctx.actor.userId }` to `stub.tryDeleteRoomType`.
  - Returns `200 OK` with JSON `{ ok: true, roomTypeId, ariVersion }` (retaining archive result detail), `409` if blocked by active bookings (`ARCHIVE_BLOCKED`), `404` if missing, `403` on `FORBIDDEN`.

---

## 4. Route Audit Alignment & Drift Check

`V1_HTTP_ROUTE_AUDIT` in `packages/contracts/src/v1-http-routes.ts` will be appended in the **exact same element-wise order** as `V1_ROUTES`:

```ts
  {
    id: 'put_room_type',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'inventory.update_room_type',
  },
  {
    id: 'delete_room_type',
    scope: 'property',
    permission: 'inventory:write',
    commandId: 'inventory.delete_room_type',
  },
```

---

## 5. Test Fixtures & Affected Call Sites

Adding `actor: ActorContext` as the first argument to `tryAddRoomType`, `tryUpdateRoomType`, and `tryDeleteRoomType` affects **45 call sites** across 4 test suites:
- `apps/pms-core/test/inventory.spec.ts`
- `apps/pms-core/test/night-audit.spec.ts`
- `apps/pms-core/test/restrictions-rates.spec.ts`
- `apps/pms-core/test/reservations-ledger.property.spec.ts`

### Fixture Helper Strategy
To ensure test calls bypass permission denials cleanly without boilerplate:
1. Define shared test fixtures in `apps/pms-core/test/fixtures.ts`:
   ```ts
   export const TEST_OWNER_ACTOR: ActorContext = { kind: 'user', userId: 'user_owner' };
   export const TEST_SYSTEM_ACTOR: ActorContext = { kind: 'system', reason: 'night_audit' };
   ```
2. Update provisioning in test helpers to register `user_owner` in `OrgDO` (or use `TEST_SYSTEM_ACTOR` for system sweeps).

### Additional Test Assertions
1. **Mutation Denial State Check**: In `inventory-stack.spec.ts`, explicitly assert that when `gatePermission` returns `FORBIDDEN`, no room-type rows are inserted/updated in SQLite and the DO `outbox` count is unchanged.
2. **Direct Stub Denial**: Assert that direct invocation of `stub.tryAddRoomType({ kind: 'user', userId: 'unauthorized' }, ...)` fails closed with `{ ok: false, error: 'forbidden' }`.

---

## 6. Implementation Checklist
- [ ] Export `ActorContext`, `UserActor`, `SystemActor` in `packages/contracts/src/permissions.ts`.
- [ ] Implement `PermissionDoCache` and integrate `gatePermission` into `PropertyDO`.
- [ ] Update `tryAddRoomType`, `tryUpdateRoomType`, `tryDeleteRoomType` signatures to accept `actor: ActorContext`.
- [ ] Export test actor fixtures in `apps/pms-core/test/fixtures.ts` and update the 45 test call sites across the 4 spec files.
- [ ] Add `handlePutRoomType` and `handleDeleteRoomType` handlers to `apps/pms-core/src/v1-dispatch.ts`.
- [ ] Append routes in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT` in matching order.
- [ ] Add unit and HTTP integration specs (including state-non-mutation assertions on 403/FORBIDDEN) in `inventory-stack.spec.ts`.
- [ ] Run `pnpm build`, `pnpm check:permissions`, `pnpm lint`, `pnpm test`.
