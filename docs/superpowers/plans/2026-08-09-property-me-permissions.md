# Property `/me` Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Property-scoped `/me` read with server-resolved permission arrays, SPA affordance gating (hide nav/shell, disable in-page), fail-open only when authority unknown, and CI that forbids client `ROLE_GRANTS` / `role ===` gating.

**Architecture:** Append `GET /v1/properties/:propertyId/me` (audit index 69, `property:read`, no entitlement, FAIL_CLOSED). OrgDO resolves `ROLE_GRANTS` into scope-split arrays. SPA loads `['me', propertyId]` with withhold-until-settle; 404 → no-access; 401 → sign-in; 403 → invalidate `me`.

**Tech Stack:** Workers / OrgDO / Vitest / React Query / client-core / web-pms shell

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-property-me-permissions-design.md`
- Append audit + `V1_ROUTES` at **index 69** only; pins 19/43/44/61/62/65/66/67/68 unchanged
- **Never** set `entitlement` on this row (kill-switch rides the same gate — do not add `pms.core` later)
- OrgDO transport → `degradedFailClosedOrgReadResponse()` (`org_unreachable`), not property variant
- Handler always `Cache-Control: private, no-store` (200 and FAIL_CLOSED)
- Payload: `orgId`, `propertyId`, `userId`, `role` (display-only), `permissions`, `orgPermissions`
- Never gate UI on `role`; helpers are permission-set membership only
- Hide nav/shell destinations via pure helpers; unit-test with fabricated `me` (no real role lacks those grants today)
- Disable in-page (`folio:adjust`) is the only E2E-reachable deny for current roles
- Fail open **only** when authority unknown (`fail_closed`); **404 → no-access**; **401 → sign-in** (full `location.assign`)
- Affordance helpers take `Authority` (`live` | `unknown` | `pending`) — fail-open/withhold live in pure functions, not JSX bypass
- Permission membership helpers take `PropertyScopedPermission` / `OrgScopedPermission` (type-only contracts import — not `ROLE_GRANTS`)
- Withhold filterable chrome until `/me` settles
- 403 → `invalidateQueries(['me', propertyId])`; `staleTime: 60_000`
- Query key `['me', propertyId]` (no `userId` — no actor-switch flow today)
- Rebuild client-core before web-pms runs
- Final sweep: typecheck, lint, all checks incl. `check:web-pms-me-gating`, **sharded** pms-core (`for s in 1 2 3 4; do … --shard=$s/4; done`) — never unsharded local `pnpm --filter @hospai/pms-core test`

## File map

| Path | Responsibility |
|---|---|
| `packages/contracts/src/v1-http-routes.ts` | Audit row `get_property_me` at index 69 |
| `packages/contracts/src/register.test.ts` | Pin 69 |
| `apps/pms-core/src/org-do.ts` | `readPropertyMe` + `assertRpcAvailable()` |
| `apps/pms-core/src/v1-dispatch.ts` | Handler + `V1_ROUTES` append |
| `apps/pms-core/test/property-me.spec.ts` | DO unit + HTTP (staff/owner, transport, Cache-Control, orgId, gate 404) |
| `packages/client-core/src/api.ts` | `getMe` |
| `apps/web-pms/src/auth/me.ts` | `Authority` + typed permission helpers + pure nav/Open filters |
| `apps/web-pms/src/auth/me.test.ts` | §2.5 table rows (pending / unknown / live hide / live show) |
| `apps/web-pms/src/shell/nav.ts` | `NavEntry.permission` |
| `apps/web-pms/src/shell/AppShell.tsx` | Load me; withhold / no-access / 401 / fail-open; filter nav |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | `canShowShellOpen` |
| `apps/web-pms/src/screens/FolioScreen.tsx` | Disable split when me live without `folio:adjust` |
| Folio mutation error path | 403 → invalidate `me` |
| `scripts/web-pms-me-gating-check.mjs` | Ninth check |
| `package.json` + `.github/workflows/ci.yml` | Wire check |
| Folio design leftover #2 | Mark retired |

---

### Task 1: OrgDO `readPropertyMe` + HTTP route

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Create: `apps/pms-core/test/property-me.spec.ts`

**Interfaces:**
- Produces DO: `readPropertyMe(actor, propertyId) → { ok: true, role, permissions, orgPermissions } | { ok: false, error: 'not_member' }`
- Produces HTTP 200: `{ ok: true, orgId, propertyId, userId, role, permissions, orgPermissions }`
- Audit: `{ id: 'get_property_me', scope: 'property', permission: 'property:read', degradedRead: 'FAIL_CLOSED' }` — **no** `entitlement`, **no** `commandId`

- [ ] **Step 1: Failing pin + route audit append**

Append to `V1_HTTP_ROUTE_AUDIT` (after `get_front_desk_recent_shifts`):

```ts
{
  id: 'get_property_me',
  scope: 'property',
  permission: 'property:read',
  degradedRead: 'FAIL_CLOSED',
},
```

In `register.test.ts` after pin 68:

```ts
expect(V1_HTTP_ROUTE_AUDIT[69]?.id).toBe('get_property_me');
expect(V1_HTTP_ROUTE_AUDIT[69]).toMatchObject({
  scope: 'property',
  permission: 'property:read',
  degradedRead: 'FAIL_CLOSED',
});
expect(V1_HTTP_ROUTE_AUDIT[69]).not.toHaveProperty('entitlement');
expect(V1_HTTP_ROUTE_AUDIT[69]).not.toHaveProperty('commandId');
```

- [ ] **Step 2: Failing DO + HTTP tests** (`property-me.spec.ts`)

Mirror provision patterns from `front-desk-reads.spec.ts` / `property-details-routes.spec.ts`:

```ts
// Direct DO (4a)
it('readPropertyMe: unknown user → not_member', async () => {
  const result = await org.readPropertyMe(
    { kind: 'user', userId: 'user_nobody' },
    propertyId,
  );
  expect(result).toEqual({ ok: false, error: 'not_member' });
});

it('readPropertyMe: staff has folio:post, lacks folio:adjust; orgPermissions has org:read not org:manage', async () => {
  // provision staff membership on property
  const result = await org.readPropertyMe({ kind: 'user', userId: staffId }, propertyId);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.role).toBe('staff');
  expect(result.permissions).toContain('folio:post');
  expect(result.permissions).not.toContain('folio:adjust');
  expect(result.orgPermissions).toContain('org:read');
  expect(result.orgPermissions).not.toContain('org:manage');
  expect(result.permissions).not.toContain('shell:internal');
  expect(result.orgPermissions).not.toContain('shell:internal');
});

// HTTP (gate 404 vs DO not_member are separate)
it('GET /me: member 200 + orgId + Cache-Control private, no-store', async () => {
  const res = await fetchMe(propertyId, owner);
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    orgId,
    propertyId,
    userId: owner,
    role: 'owner',
  });
  expect(Array.isArray(body.permissions)).toBe(true);
  expect(Array.isArray(body.orgPermissions)).toBe(true);
});

it('GET /me: non-member 404 (dispatcher gate)', async () => {
  const res = await fetchMe(propertyId, 'user_stranger');
  expect(res.status).toBe(404);
});

// Proves handler catch + Cache-Control on FAIL_CLOSED — NOT a real OrgDO outage.
// Gate `assertPermission` has no assertRpcAvailable; requirePermission has no try/catch.
// Fault injection is method-selective: gate succeeds while readPropertyMe throws.
// Genuine outage would fail the gate first and bypass this handler path.
// Leftover: "OrgDO gate failures bypass the FAIL_CLOSED read design" (spec §6 #11).
it('GET /me: OrgDO blocked → 503 org_unreachable + Cache-Control + no commandId', async () => {
  await org.setTransportBlockedForTest(true);
  try {
    const res = await fetchMe(propertyId, owner);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
    expect(body).not.toHaveProperty('commandId');
  } finally {
    await org.setTransportBlockedForTest(false);
  }
});
```

Run: `pnpm --filter @hospai/pms-core test -- property-me`  
Expected: FAIL (method/route missing).

- [ ] **Step 3: Implement OrgDO `readPropertyMe`**

Near `assertPermission` / after membership helpers in `org-do.ts`. Imports already include `ROLE_GRANTS`, `isPropertyScopedPermission`, `isOrgScopedPermission`.

```ts
async readPropertyMe(
  actor: ActorContext,
  propertyId: string,
): Promise<
  | {
      ok: true;
      role: OrgRole;
      permissions: PropertyScopedPermission[];
      orgPermissions: OrgScopedPermission[];
    }
  | { ok: false; error: 'not_member' }
> {
  this.assertRpcAvailable();
  if (actor.kind !== 'user') return { ok: false, error: 'not_member' };

  const role = await this.getEffectiveRole(actor.userId, propertyId);
  if (!role) return { ok: false, error: 'not_member' };

  const grants = ROLE_GRANTS[role];
  return {
    ok: true,
    role,
    permissions: grants.filter(isPropertyScopedPermission),
    orgPermissions: grants.filter(isOrgScopedPermission),
  };
}
```

Use exact `PropertyScopedPermission` / `OrgScopedPermission` types from `@hospai/contracts` (import if missing).

- [ ] **Step 4: Implement HTTP handler + append `V1_ROUTES`**

`ME_HEADERS = { 'Cache-Control': 'private, no-store' }` (local const near handler).

```ts
async function handleGetPropertyMe(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    const result = await org.readPropertyMe(actor, propertyId);
    if (!result.ok) {
      // Defensive: HTTP gate normally 404s before handler; keep for direct-style parity
      return json({ error: 'not_found' }, 404, ME_HEADERS);
    }
    return json(
      {
        ok: true,
        orgId: resolvedCtx.property.orgId,
        propertyId,
        userId: ctx.actor.userId,
        role: result.role,
        permissions: result.permissions,
        orgPermissions: result.orgPermissions,
      },
      200,
      ME_HEADERS,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      const degraded = degradedFailClosedOrgReadResponse();
      const headers = new Headers(degraded.headers);
      headers.set('Cache-Control', 'private, no-store');
      return new Response(degraded.body, { status: degraded.status, headers });
    }
    throw e;
  }
}
```

Append **last** to `V1_ROUTES`:

```ts
{
  scope: 'property',
  method: 'GET',
  pattern: /^\/v1\/properties\/([^/]+)\/me$/,
  permission: 'property:read',
  // no entitlement — kill-switch must not brick /me
  handler: handleGetPropertyMe,
},
```

- [ ] **Step 5: Verify**

```bash
pnpm check:permissions
pnpm check:degraded
pnpm check:do-transport-guards
pnpm --filter @hospai/contracts test -- register
pnpm --filter @hospai/pms-core test -- property-me
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/org-do.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/property-me.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): add GET property /me permission snapshot

EOF
)"
```

---

### Task 2: client-core `getMe`

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `packages/client-core/test/api.test.ts` (optional assert path)

**Interfaces:**
- Produces: `getMe(propertyId: string)` → body matching §2.2 (typed as success shape; transport/classify unchanged)

- [ ] **Step 1: Implement** next to `getOpenShift`:

```ts
import type { OrgScopedPermission, PropertyScopedPermission } from '@hospai/contracts';

async getMe(propertyId: string) {
  const { body } = await getJson(`/v1/properties/${enc(propertyId)}/me`);
  return body as {
    ok: true;
    orgId: string;
    propertyId: string;
    userId: string;
    role: 'owner' | 'admin' | 'staff';
    permissions: PropertyScopedPermission[];
    orgPermissions: OrgScopedPermission[];
  };
},
```

- [ ] **Step 2: Build**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(client-core): add getMe for property permission snapshot

EOF
)"
```

---

### Task 3: Pure permission helpers + nav filter (unit)

**Files:**
- Create: `apps/web-pms/src/auth/me.ts`
- Create: `apps/web-pms/src/auth/me.test.ts`
- Modify: `apps/web-pms/src/shell/nav.ts`

**Interfaces:**

Fail-open / withhold must live in pure helpers (same reason as `shiftSeverity`), not in JSX that bypasses them. Components map query → `Authority` and pass it through.

```ts
import type {
  OrgScopedPermission,
  PropertyScopedPermission,
} from '@hospai/contracts';

export type PropertyMe = {
  ok: true;
  orgId: string;
  propertyId: string;
  userId: string;
  role: 'owner' | 'admin' | 'staff';
  permissions: readonly PropertyScopedPermission[];
  orgPermissions: readonly OrgScopedPermission[];
};

/** Spec §2.5 affordance authority — not the same as HTTP status. */
export type Authority =
  | { kind: 'live'; me: PropertyMe }
  | { kind: 'unknown' } // fail_closed / transport after settle → fail open
  | { kind: 'pending' }; // withhold until settle

export function hasPropertyPermission(
  me: PropertyMe,
  p: PropertyScopedPermission,
): boolean {
  return me.permissions.includes(p);
}
export function hasOrgPermission(me: PropertyMe, p: OrgScopedPermission): boolean {
  return me.orgPermissions.includes(p);
}

export function filterNavEntries(entries: NavEntry[], authority: Authority): NavEntry[] {
  switch (authority.kind) {
    case 'pending':
      return [];
    case 'unknown':
      return entries; // fail open
    case 'live':
      return entries.filter(
        (e) => !e.permission || hasPropertyPermission(authority.me, e.permission),
      );
  }
}

export function canShowShellOpen(authority: Authority): boolean {
  switch (authority.kind) {
    case 'pending':
      return false;
    case 'unknown':
      return true; // fail open
    case 'live':
      return hasPropertyPermission(authority.me, 'folio:post');
  }
}
```

`NavEntry`:

```ts
import type { PropertyScopedPermission } from '@hospai/contracts';

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  permission?: PropertyScopedPermission;
};

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals', permission: 'reservations:read' },
  { id: 'in-house', label: 'In-house', path: '/in-house', permission: 'reservations:read' },
  { id: 'departures', label: 'Departures', path: '/departures', permission: 'reservations:read' },
];
```

- [ ] **Step 1: Failing unit tests** — §2.5 table rows (no `role ===` gating):

```ts
const baseMe: PropertyMe = {
  ok: true,
  orgId: 'org_x',
  propertyId: 'prop_x',
  userId: 'user_x',
  role: 'staff',
  permissions: ['folio:read'],
  orgPermissions: ['org:read'],
};

it('filterNavEntries: pending → withhold (empty)', () => {
  expect(filterNavEntries(NAV_ENTRIES, { kind: 'pending' })).toEqual([]);
});

it('filterNavEntries: unknown → fail open (full entries)', () => {
  expect(filterNavEntries(NAV_ENTRIES, { kind: 'unknown' })).toEqual(NAV_ENTRIES);
});

it('filterNavEntries: live without reservations:read → hide all', () => {
  expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me: baseMe })).toEqual([]);
});

it('filterNavEntries: live with reservations:read → show all', () => {
  const me = { ...baseMe, permissions: ['reservations:read' as const, 'folio:read' as const] };
  expect(filterNavEntries(NAV_ENTRIES, { kind: 'live', me })).toEqual(NAV_ENTRIES);
});

it('canShowShellOpen: pending false; unknown true; live needs folio:post', () => {
  expect(canShowShellOpen({ kind: 'pending' })).toBe(false);
  expect(canShowShellOpen({ kind: 'unknown' })).toBe(true);
  expect(canShowShellOpen({ kind: 'live', me: baseMe })).toBe(false);
  expect(
    canShowShellOpen({
      kind: 'live',
      me: { ...baseMe, permissions: ['folio:post'] },
    }),
  ).toBe(true);
});

it('hasPropertyPermission: staff-shaped lacks folio:adjust', () => {
  const me = {
    ...baseMe,
    permissions: ['folio:post', 'folio:read'] as const,
  };
  expect(hasPropertyPermission(me, 'folio:adjust')).toBe(false);
});
```

- [ ] **Step 2: Implement** helpers + nav fields. Type-only contracts imports only — **never** `ROLE_GRANTS` value import.

- [ ] **Step 3: Run** `pnpm --filter web-pms test -- me` — green.

- [ ] **Step 4: Commit** `feat(web-pms): Authority-based me permission helpers and nav filter`

---

### Task 4: `check:web-pms-me-gating`

**Files:**
- Create: `scripts/web-pms-me-gating-check.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Scan `apps/web-pms/src/**/*.{ts,tsx}` excluding `*.test.*` / `*.spec.*`
- Fail if file contains `ROLE_GRANTS` **and** `@hospai/contracts` anywhere (file-scoped grep — false-positive on comments; false-negative on aliased import paths; acceptable for this gate)
- Fail if gating on role via: `/\b(?:me\.)?role\s*===\s*['"](?:owner|admin|staff)['"]|\.role\s*===\s*['"](?:owner|admin|staff)['"]/`
- Type-only `import type { PropertyScopedPermission } from '@hospai/contracts'` must **not** trip (no `ROLE_GRANTS` token)

- [ ] **Step 1: Script** (pattern after `scripts/web-pms-colors-check.mjs` — walk `apps/web-pms/src`, read files, exit 1 with path:line on hit).

Minimal body:

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'apps/web-pms/src');
const ROLE_GRANTS_IMPORT = /ROLE_GRANTS/;
const ROLE_GATE =
  /\b(?:me\.)?role\s*===\s*['"](?:owner|admin|staff)['"]|\.role\s*===\s*['"](?:owner|admin|staff)['"]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(srcRoot)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  if (ROLE_GRANTS_IMPORT.test(text) && /@hospai\/contracts/.test(text)) {
    violations.push(`${rel}: ROLE_GRANTS import from contracts (client oracle forbidden)`);
  }
  for (const [i, line] of text.split('\n').entries()) {
    if (ROLE_GATE.test(line)) {
      violations.push(`${rel}:${i + 1}: role equality gating forbidden — use permission helpers`);
    }
  }
}
if (violations.length) {
  console.error('check:web-pms-me-gating failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('check:web-pms-me-gating: ok');
```

- [ ] **Step 2: Wire**

`package.json`: `"check:web-pms-me-gating": "node scripts/web-pms-me-gating-check.mjs"`  
`ci.yml` after `check:web-pms-colors`: `- run: pnpm check:web-pms-me-gating`

- [ ] **Step 3: Prove red then green (both rules separately)**

Do **not** only verify the passing direction. Plant real violations in a throwaway file under `apps/web-pms/src/` (not a `*.test.*` — those are excluded), confirm non-zero exit **per rule**, restore, then green.

```bash
# (a) ROLE_GRANTS value import — real form that compiles today
cat > apps/web-pms/src/_me_gating_probe.ts <<'EOF'
import { ROLE_GRANTS } from '@hospai/contracts';
void ROLE_GRANTS;
EOF
pnpm check:web-pms-me-gating; echo "exit=$?"
# Expected: non-zero; message mentions ROLE_GRANTS
rm apps/web-pms/src/_me_gating_probe.ts

# (b) role equality gating — separate plant (no ROLE_GRANTS)
cat > apps/web-pms/src/_me_gating_probe.ts <<'EOF'
export function probe(me: { role: string }) {
  return me.role === 'admin';
}
EOF
pnpm check:web-pms-me-gating; echo "exit=$?"
# Expected: non-zero; message mentions role equality
rm apps/web-pms/src/_me_gating_probe.ts

# (c) clean tree
pnpm check:web-pms-me-gating
# Expected: exit 0
```

- [ ] **Step 4: Commit** `chore: add check:web-pms-me-gating CI gate`

---

### Task 5: AppShell — load me, withhold, 404, 401, fail-open

**Files:**
- Modify: `apps/web-pms/src/shell/AppShell.tsx`
- Modify: `apps/web-pms/src/shell/AppShell.boot.test.tsx`
- Create/modify: shell tests for 404 / unauthorized (extend boot test file or `AppShell.me.test.tsx`)

**Interfaces:**
- Query key: `['me', propertyId]`
- `staleTime: 60_000`
- Map query → `Authority` (or no-access / sign-in); pass `Authority` into helpers — **do not** bypass helpers with raw `NAV_ENTRIES` in JSX for fail-open

- [ ] **Step 1: Boot mock** — every mock client includes:

```ts
getMe: async () => {
  throw Object.assign(new Error('fail_closed'), { /* match how createClient classify surfaces */ });
},
```

Prefer the same pattern other boot mocks use for `fail_closed` (inspect existing `getOpenShift` / board mocks — throw or return classified rejection via client stub). **Lock:** boot path must exercise **fail_closed → full chrome**, not 404.

- [ ] **Step 2: Shell wiring**

```tsx
const meQuery = useQuery({
  queryKey: ['me', propertyId],
  queryFn: () => api.getMe(propertyId),
  staleTime: 60_000,
});

// Map to Authority (or dedicated shell states):
// - isPending → { kind: 'pending' }
// - success → { kind: 'live', me }
// - classified fail_closed → { kind: 'unknown' }
// - classified status === 404 → no-access copy "You don't have access to this property."
// - classified unauthorized → window.location.assign('/sign-in')
//
// Nav: filterNavEntries(NAV_ENTRIES, authority)  // never hand-expand NAV_ENTRIES in JSX
```

Use existing `classify` / error shape from client-core the same way Folio/Board do (read `BoardScreen` 401 and `AppShell` shift query for pattern). Pass `authority: Authority` into `ShiftStrip` / context as needed — prefer a small React context or props already used for tenant/api rather than inventing a global store.

- [ ] **Step 3: Tests**
  - fail_closed mock → full nav labels present
  - 404 mock → no-access copy; board nav absent
  - unauthorized → `location.assign` called with `/sign-in` (spy)

- [ ] **Step 4: Commit** `feat(web-pms): wire /me into AppShell affordance states`

---

### Task 6: ShiftStrip Open hide + Folio split disable + 403 invalidate

**Files:**
- Modify: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Modify: `apps/web-pms/src/shell/ShiftStrip.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: folio mutation error path (e.g. `use-folio-action-mutation.ts`)

**Interfaces:**
- Strip: `canShowShellOpen(authority)` only — pending withhold, unknown fail-open, live needs `folio:post`
- Folio: when `authority.kind === 'live'` && !`hasPropertyPermission(me, 'folio:adjust')` → disable split + permission reason copy; when `pending` / `unknown` → today's enablement (fail open / unchanged)
- On `forbidden` / 403 from folio mutations: keep explain copy **and** `queryClient.invalidateQueries({ queryKey: ['me', propertyId] })`

- [ ] **Step 1: Strip tests** — pass `authority={{ kind: 'pending' }}` / `{ kind: 'unknown' }` / live without `folio:post`; assert Open button absence/presence.

- [ ] **Step 2: Folio test** — inject staff-shaped live authority (permissions include post/read, not adjust) → split control disabled with copy mentioning `folio:adjust`.

- [ ] **Step 3: 403 invalidate** — in mutation `onError` / existing forbidden branch:

```ts
if (classified.class === 'forbidden' /* or status === 403 */) {
  void queryClient.invalidateQueries({ queryKey: ['me', propertyId] });
}
```

Assert invalidate called in unit test with mock QueryClient.

- [ ] **Step 4: Commit** `feat(web-pms): gate strip open and folio split from /me`

---

### Task 7: Leftovers + full acceptance sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-folio-front-desk-design.md` — leftover #2 retired
- Confirm: `docs/superpowers/specs/2026-08-09-property-me-permissions-design.md` — Status Approved + leftover #11 recorded

- [ ] **Step 1: Mark folio leftover #2 retired** pointing at property-me spec + plan. Confirm leftover #11 present:

> OrgDO gate failures bypass the FAIL_CLOSED read design — `assertPermission` has no `assertRpcAvailable`; `requirePermission` has no try/catch. Method-selective `setTransportBlockedForTest` proves handler catch only; genuine OrgDO outage fails the gate first. Same for `get_org_properties` / guests-batch. Not this slice.

- [ ] **Step 2: Full sweep** (sharded pms-core — unsharded local run segfaults workerd)

```bash
pnpm typecheck
pnpm lint
pnpm check:permissions
pnpm check:degraded
pnpm check:do-transport-guards
pnpm check:forbidden-bodies
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
for s in 1 2 3 4; do pnpm --filter @hospai/pms-core exec vitest run --shard=$s/4; done
```

- [ ] **Step 3: Commit** docs + any sweep fixes.

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| Route index 69, no entitlement, FAIL_CLOSED | 1 |
| `org_unreachable` + Cache-Control | 1 |
| Payload + orgId + DO not_member | 1 |
| `getMe` | 2 |
| Pure `Authority` filters / hide unexercised E2E | 3 |
| `check:web-pms-me-gating` red+green per rule | 4 |
| Withhold / fail-open / 404 / 401 via Authority | 5 |
| Strip Open / folio disable / 403 invalidate | 6 |
| Folio leftover retired + leftover #11 + sharded sweep | 7 |

**Placeholder scan:** no TBD/TODO steps; Task 5/6 map query → `Authority` then call helpers (no JSX fail-open bypass).

**Type consistency:** `PropertyMe` / `Authority` / typed `PropertyScopedPermission` helpers / `filterNavEntries(entries, authority)` / `canShowShellOpen(authority)` / query key `['me', propertyId]` used uniformly across Tasks 2–6.
