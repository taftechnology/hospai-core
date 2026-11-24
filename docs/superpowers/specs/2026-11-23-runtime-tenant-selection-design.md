# Runtime tenant selection and the property switcher (R4.4)

**Date:** 2026-11-23
**Status:** Accepted for build. Two calls in §1 differ from the roadmap wording; the user may overrule them.
**Roadmap:** [R4.4](../../roadmap.md) (Track G, before hotel 2).
**Sources:**
- `apps/web-pms/src/config/tenant.ts`, `apps/web-pms/src/client.ts:16`: the tenant is read once, at build time, from `VITE_ORG_ID` and `VITE_PROPERTY_ID`.
- [Property `/me` permissions](2026-08-09-property-me-permissions-design.md): `/me` stays property-scoped; no entitlements in `/me`; leftover #5 (tenant picker and org listing).
- [Membership management](2026-08-10-membership-management-design.md): `property_member` is an independent grant; a property-only member gets 404 on every org route; leftover #6 (refresh `me` for all properties after an org role change).
- [Sign-in with Clerk](2026-08-13-sign-in-clerk-design.md): no Clerk Organizations, no custom claims.
- [Prototype chrome](2026-08-13-prototype-chrome-skin-design.md) §235: the property name in the top bar was "not a property switcher" while there was one demo tenant. This spec replaces that line.
- AGENTS.md §1 (tenancy, property-scoped data), §4 (cache keys), §5 (two-property tests).

---

## 1. Decisions

1. **Which hotels a user sees.** The roadmap says "the properties where this user has a `property_member` row". That would hide hotels from org members: `getEffectiveRole` (`apps/pms-core/src/org-do.ts`) already lets an org `member` (owner, admin, staff) open **every** property in the org, and `property_member` is only an override or a standalone grant. **Decision:** the list is exactly the properties where `getEffectiveRole(userId, propertyId)` is non-null, the same test every property route applies. A property-only member sees only their granted hotels; an org member sees every active hotel in the org. Nothing a user cannot open is ever listed.
2. **Where the list comes from.** The roadmap says "a new org route". A property-only member gets 404 on every org route, so an org route cannot serve them, and nothing today maps a user to their orgs. **Decision:** one new **user-scope** route, `GET /v1/me/tenants`, backed by a discovery index in platform D1 (§2). The index only says *where to look*; every org it names is re-checked against that org's OrgDO before anything is returned.
3. `/me` (`get_property_me`) is unchanged and stays property-scoped. No entitlements are added to it.
4. Isolation stays structural: one PropertyDO per hotel, no query across properties, and every property route keeps its existing gate. Switching hotels changes which URLs the SPA calls, nothing else.
5. A user in more than one org picks one org. There is no cross-org view and no group view (R7.4).

## 2. Server

### 2.1 Discovery index (platform D1, migration `0008_user_org.sql`)

```sql
CREATE TABLE IF NOT EXISTS user_org (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS user_org_org_idx ON user_org (org_id);
```

- Generated from `packages/do-runtime/src/platform-migrations.ts` like the other platform tables (`pnpm generate:ddl`, `check:ddl`), and added to `PLATFORM_ALL_STATEMENTS` so `ensurePlatformSchema` creates it.
- It holds Clerk user ids and org ids only: no name, email or role. It is **never** used to authorize anything.
- **Writes (best effort, after the OrgDO write commits, never inside `transactionSync`):**
  - upsert `(userId, orgId)` when an org member or a property member is created or updated (`create_org_member`, `update_org_member`, the property-member routes, `ensureMember` in `POST /v1/orgs` and provisioning);
  - on a member or property-member delete, delete the row **only if** the OrgDO reports the user has no remaining membership in that org;
  - upsert on every successful `get_property_me` (this back-fills users who existed before the table did; a stale or missing row is harmless because of §2.2's re-check).
  - A D1 failure on any of these logs `logWarn` `user_org.index_write_failed` (user id, org id only) and does not fail the request.
- **Purge:** org purge deletes every `user_org` row for the org. Add the table to the purge contract so `check:purge` sees it.

### 2.2 `GET /v1/me/tenants` (`get_me_tenants`)

- New route scope `'user'` in `V1RouteDef` (`{ scope: 'bootstrap' | 'dev' | 'user' }`): authenticated, no tenant in the URL, no permission, no entitlement, not kill-switched (like `/me`, it must never brick the shell). Registered in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`; `scripts/permissions-check.mjs` must accept the new scope explicitly, not by loosening the org/property permission requirement.
- `dispatchV1` stays the only choke point. A missing or invalid actor is 401 as today.
- **Response** `200 { tenants: TenantOrg[] }`, `Cache-Control: private, no-store`:
  ```ts
  type TenantOrg = {
    orgId: string;
    name: string | null;          // platform D1 org row
    multiProperty: boolean;       // org entitlement pms.multi_property
    properties: Array<{ propertyId: string; name: string; timeZone: string | null }>;
  };
  ```
- **Steps:** read `user_org` for the user (cap 20 orgs; over the cap → the 20 most recently updated). For each org, in parallel with per-org catch: skip unless the D1 org status is `active` or `suspended`; call a new OrgDO RPC `listAccessiblePropertiesFor(userId)` which returns the active `property_ref` rows where `getEffectiveRole` is non-null (one SQL pass: all refs if a `member` row exists, else the user's `property_member` rows joined to `property_ref`); drop the org if that list is empty; read `pms.multi_property` from the org's entitlement snapshot (a read failure means `false`). An org whose OrgDO is unreachable is omitted and logged (`me_tenants.org_unreachable`, org id only), not a 503 for the whole list.
- Orgs are sorted by name, properties by name. Property ids and names are only those the user can open.

### 2.3 Pins

`V1_HTTP_ROUTE_AUDIT` grows by one, with `get_me_tenants` as the last id; update the pin in `packages/contracts/src/register.test.ts` and the AGENTS.md table in the same commit. No command, no DO migration, no `COMMAND_CATALOG` change. The R7.1 roadmap entry's route pin (written before this slice) is bumped by one in the same commit.

## 3. Operator SPA

### 3.1 Selection

- A new `TenantProvider` (in `apps/web-pms/src/shell/`) loads `get_me_tenants` once after sign-in (key `['me-tenants']`, `staleTime` 60 s, `retry: false`) and chooses the active `{ orgId, propertyId }`:
  1. the per-browser saved choice (`localStorage` key `hospai.tenant`, JSON `{ orgId, propertyId }`, wrapped in try/catch like `hospai.theme`) if it is still in the list;
  2. else `VITE_ORG_ID` / `VITE_PROPERTY_ID` if they are set and in the list (local demo default);
  3. else the first property of the first org.
- An empty list shows the existing no-access shell ("You don't have access to any hotel"), using `EmptyState`, not a crash.
- `VITE_ORG_ID` / `VITE_PROPERTY_ID` become optional. `readTenantConfig` no longer throws when they are missing; it returns them as an optional default.
- While the list is loading the shell shows its existing boot `Skeleton`.

### 3.2 Reading the tenant

- Keep the `tenant` export from `client.ts` so the ~190 `tenant.orgId` / `tenant.propertyId` call sites do not change. It becomes a live object whose `orgId` and `propertyId` read the current selection (getters over a module-level store with `setTenant`). Until `TenantProvider` selects, the store holds the env default when one is set (so local dev and tests that import the real module keep working); reading with no selection and no default throws a named error (`tenant_not_selected`). The entitlement loader in `client.ts` reads it at call time, as it already does.
- **Switching** (`setTenant`) does, in order: save the choice; reset the client-core entitlement store and any other tenant-bound singleton in `client.ts`; `queryClient.clear()`; navigate to the home path; remount everything under `AppShell` with `key={orgId + ':' + propertyId}`. The remount is what makes every component, `FrontOfficeLive` included, read the new tenant and reconnect; no screen needs its own switch logic. This also covers membership leftover #6: after a switch, no `me` from another property survives.
- Bare-prefix invalidations such as `['board']` stay correct, because after `clear()` only the current property's queries exist.

### 3.3 The switcher

- In `TopBar`, the property name becomes a `NativeSelect` (ui-kit, `VisuallyHidden` label "Hotel") **only when** the current org has `multiProperty === true` **and** more than one property. Otherwise it stays the plain name.
- A user in more than one org gets an org `NativeSelect` beside it (label "Organisation"); choosing an org selects its first property.
- Choosing a hotel calls `setTenant`. There is no confirmation dialog; the open shift, business date, permissions and nav follow because they are all property-keyed queries refetched after the remount.
- Copy uses the live names from `get_me_tenants`. No hardcoded hotel names.

## 4. Tests

**pms-core (`apps/pms-core/test/me-tenants.spec.ts`):**
1. One org, properties A and B. A user with a `property_member` row on A only: `get_me_tenants` lists only A; `GET /v1/properties/B/me` and one B data route are 404 `not_found`.
2. An org `member` (staff) in the same org lists both A and B.
3. A user in two orgs lists both orgs, each with only its accessible properties; an org with no accessible property is omitted.
4. A stale index row (user removed in OrgDO, row left in D1) lists nothing for that org.
5. Membership writes keep the index: create → row present; delete of the last membership → row gone; delete of one of two property grants → row stays.
6. `get_property_me` back-fills a missing row.
7. `multiProperty` follows the org entitlement (Growth false, Group true).
8. Org purge removes the org's `user_org` rows.
9. The route has no tenant gate and is reachable while the org's kill-switch is on; no actor → 401.

**web-pms:**
1. Selection order: saved choice, then the env default, then first property; a saved choice no longer in the list is ignored.
2. Switching clears the query cache, writes the choice, remounts, and `FrontOfficeLive` opens a socket for the new property (assert the URL contains the new property id).
3. After switching from A to B, the board's query key carries B (`['board', mode, 'prop_b', …]`) and no A data renders.
4. The switcher is hidden with one property or with `multiProperty` false, shown otherwise.
5. Empty list shows the no-access state.

Existing tests keep mocking `../client.js` with a `tenant` literal; they need no change.

## 5. AGENTS §6 checklist

- [x] Tenant: the new route has no tenant in the URL; every org it reports is re-checked in that org's OrgDO; no org data for orgs the user is not in.
- [x] Authz: user-scope route, self only; property routes unchanged; kill-switch does not apply (read-only, like `/me`).
- [x] No command. Route in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`; `permissions-check` accepts the `user` scope explicitly.
- [x] Idempotency: not applicable (GET). Index writes are upserts.
- [x] Arrays: orgs capped at 20; properties bounded by the org's property limit.
- [x] No money or inventory change.
- [x] Errors: 401 without actor; per-org failure omits that org.
- [x] SPA: keys unchanged and property-keyed; switch clears the cache; ui-kit only; live names.
- [x] Tests: two-property same-org case (test 1).
- [x] Pins: route audit +1 (`get_me_tenants` last); platform migration 0008.
- [x] No Settings control.

## 6. Scope out

Group or head-office views (R7.4); org-wide CRM; Clerk Organizations; a cross-org view; switching inside a print view or a deep link to another hotel's record (a switch always lands on the home path).
