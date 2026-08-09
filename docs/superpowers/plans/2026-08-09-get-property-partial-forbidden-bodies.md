# get_property Partial + Forbidden Bodies + Unguarded GET Guards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partial `get_property` on PropertyDO outage; FAIL_CLOSED on shell GET siblings; enforce 403 `permission` bodies and GET transport guards; then drop the client audit fallback.

**Architecture:** Handler-level try/catch for DO transport (partial marker vs `degradedFailClosedReadResponse`). Two check scripts (forbidden bodies + DO transport guards) scan `v1-dispatch.ts` against `V1_HTTP_ROUTE_AUDIT`. Client reads `body.permission` only.

**Tech Stack:** Workers / Vitest / `scripts/*-check.mjs` / pnpm

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-get-property-partial-forbidden-bodies-design.md`
- Marker is `propertyDo: 'unreachable'` on **200** — never unify into `degraded`
- Null DO fields alone must not mean unreachable
- Forbidden check accepts non-literal `permission` values
- Multi-route literal rule must be proven via `--self-test` synthetic fixture (live tree is vacuous)
- Delete client fallback only after `check:forbidden-bodies` is green
- Intentional deletion of `FOLIO_MUTATION_ROUTES` — not a regression

---

### Task 1: Partial `get_property`

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handleGetProperty` ~412–426)
- Modify: `packages/client-core/src/api.ts` (`PropertyRead`)
- Test: `apps/pms-core/test/degraded-mode.spec.ts` (add cases) or new thin spec beside it
- Test: `packages/client-core/test/api.test.ts` (healthy fixture + unreachable shape)

**Interfaces:**
- Consumes: `isPropertyDoTransportFailure`, `resolvePropertyFromRegistry`
- Produces: 200 + optional `propertyDo: 'unreachable'`; `schemaVersion: null` when unreachable

- [ ] **Step 1: Failing test — transport-blocked GET property**

```ts
it('get_property: PropertyDO blocked returns 200 partial with propertyDo unreachable', async () => {
  const actor = 'user_get_prop_partial';
  const { propertyId, stub } = await provisionHotel(actor);
  await stub.setTransportBlockedForTest(true);
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    property: { timeZone: string };
    propertyDo?: string;
    schemaVersion: unknown;
    recordedJurisdiction: unknown;
  };
  expect(body.property.timeZone).toBeTruthy();
  expect(body.propertyDo).toBe('unreachable');
  expect(body.schemaVersion).toBeNull();
  expect(body.recordedJurisdiction).toBeNull();
});

it('get_property: healthy omits propertyDo', async () => {
  const actor = 'user_get_prop_ok';
  const { propertyId } = await provisionHotel(actor);
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { propertyDo?: string; schemaVersion: number };
  expect(body.propertyDo).toBeUndefined();
  expect(typeof body.schemaVersion).toBe('number');
});
```

- [ ] **Step 2: Run — expect FAIL** (unguarded → non-200 / throw)

- [ ] **Step 3: Implement `handleGetProperty`**

```ts
async function handleGetProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = resolved.property.orgId;

  try {
    const recorded = await resolved.stub.getRecordedJurisdiction();
    const schemaVersion = await resolved.stub.getSchemaVersion();
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: recorded ?? null,
      schemaVersion,
    });
  } catch (e) {
    if (!isPropertyDoTransportFailure(e)) throw e;
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: null,
      schemaVersion: null,
      propertyDo: 'unreachable',
    });
  }
}
```

Update `PropertyRead`:

```ts
export type PropertyRead = {
  property: { propertyId: string; timeZone: string; name: string; [key: string]: unknown };
  locationHint?: string;
  recordedJurisdiction?: unknown;
  schemaVersion?: number | null;
  propertyDo?: 'unreachable';
};
```

Keep existing healthy fixture in `api.test.ts` (`schemaVersion: 18`, no `propertyDo`). Add:

```ts
it('getProperty returns propertyDo unreachable shape', async () => {
  const client = createClient({
    transport: mockTransport(() =>
      new Response(
        JSON.stringify({
          property: {
            propertyId: 'p1',
            orgId: 'o1',
            name: 'Demo',
            jurisdiction: null,
            timeZone: 'America/New_York',
            status: 'active',
            createdAt: 1,
          },
          locationHint: 'x',
          recordedJurisdiction: null,
          schemaVersion: null,
          propertyDo: 'unreachable',
        }),
        { status: 200 },
      ),
    ),
    // …queued / entitlements / keyStore as sibling test…
  });
  const result = await client.getProperty('p1');
  expect(result.property.timeZone).toBe('America/New_York');
  expect(result.propertyDo).toBe('unreachable');
  expect(result.schemaVersion).toBeNull();
});
```

- [ ] **Step 4: Run tests — PASS**

```bash
pnpm --filter pms-core test -- degraded-mode
pnpm --filter @hospai/client-core test -- api
```

---

### Task 2: FAIL_CLOSED on exception GETs + `get_org_properties`

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handleGetOrgProperties`, `handleGetProvisionalExceptions`, `handleGetProvisionalExceptionCount`)
- Modify: `apps/pms-core/src/invoke-property-do.ts` — add `degradedFailClosedOrgReadResponse()` (`org_unreachable`, no `commandId`)
- Modify: `packages/contracts/src/v1-http-routes.ts` (add `degradedRead: 'FAIL_CLOSED'` on both exception rows)
- Modify: `packages/contracts/src/register.test.ts` (flip pin at index 19; add/adjust exceptions list pin)
- Test: `apps/pms-core/test/front-desk-reads.spec.ts` (extend blocked cases; assert error strings)

**Interfaces:**
- Consumes: `isPropertyDoTransportFailure`, `isOrgDoTransportFailure`, `degradedFailClosedReadResponse`
- Produces: Property reads → `property_unreachable`; Org read → `org_unreachable` (no `commandId`); both `degraded: 'FAIL_CLOSED'` + `Retry-After: 30`

- [ ] **Step 1: Failing tests**

```ts
it('PropertyDO blocked: provisional-exception-count returns FAIL_CLOSED 503', async () => {
  const propertyId = 'fd_http_exc_blocked';
  const { stub } = await provisionHttpProperty(propertyId);
  await stub.setTransportBlockedForTest(true);
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exception-count`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({
    error: 'property_unreachable',
    degraded: 'FAIL_CLOSED',
  });
});

it('OrgDO blocked: get_org_properties returns org_unreachable FAIL_CLOSED 503', async () => {
  const propertyId = 'fd_http_org_props_blocked';
  const { orgId } = await provisionHttpProperty(propertyId);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.setTransportBlockedForTest(true);
  const res = await worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
  expect(res.status).toBe(503);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
  expect(body).not.toHaveProperty('commandId');
});
```

(Also cover `…/provisional-exceptions` list — assert `error: 'property_unreachable'`.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Add org read helper + wrap handlers**

In `invoke-property-do.ts` (or a tiny sibling next to `degradedFailClosedReadResponse`):

```ts
export function degradedFailClosedOrgReadResponse(retryAfterSec = DEGRADED_RETRY_AFTER_SEC): Response {
  return json(
    { error: 'org_unreachable', degraded: 'FAIL_CLOSED' },
    503,
    { 'Retry-After': String(retryAfterSec) },
  );
}
```

```ts
async function handleGetOrgProperties(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  try {
    return json({ orgId, properties: await org.listPropertyRefs() });
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleGetProvisionalExceptions(ctx: V1DispatchContext): Promise<Response> {
  // … resolvePropertyContext …
  try {
    const result = await resolvedCtx.resolved.stub.listProvisionalExceptions();
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetProvisionalExceptionCount(ctx: V1DispatchContext): Promise<Response> {
  // … resolvePropertyContext …
  try {
    const exceptionCount = await resolvedCtx.resolved.stub.countProvisionalExceptions();
    return json({ propertyId, exceptionCount }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}
```

Audit rows:

```ts
{
  id: 'get_provisional_exceptions',
  scope: 'property',
  permission: 'property:read',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_provisional_exception_count',
  scope: 'property',
  permission: 'property:read',
  degradedRead: 'FAIL_CLOSED',
},
```

Flip `register.test.ts` pin: `'degradedRead' in …` → `toMatchObject({ degradedRead: 'FAIL_CLOSED' })` for index 19; same for exceptions list id if pinned without it.

- [ ] **Step 4: Run**

```bash
pnpm --filter @hospai/contracts test -- register
pnpm --filter pms-core test -- front-desk-reads
pnpm check:degraded
```

---

### Task 3: Room-type 403s + `check:forbidden-bodies`

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (lines ~493, ~548, ~586)
- Create: `scripts/forbidden-body-check.mjs`
- Modify: `package.json` — `"check:forbidden-bodies": "pnpm --filter @hospai/contracts build && node scripts/forbidden-body-check.mjs"`
- Test: `apps/pms-core/test/rooms-routes.spec.ts` (assert body.permission on staff 403)

**Interfaces:**
- Consumes: contracts dist `V1_HTTP_ROUTE_AUDIT`; dispatch source
- Produces: exit 0; `--self-test` exercises multi-route conflict

- [ ] **Step 1: Assert room-type 403 body**

```ts
expect(create.status).toBe(403);
expect(await create.json()).toEqual({ error: 'forbidden', permission: 'inventory:write' });
```

(Extend to update/delete if not already covered.)

- [ ] **Step 2: Fix three returns**

```ts
return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
```

- [ ] **Step 3: Implement `scripts/forbidden-body-check.mjs`**

Core behaviour:

1. Parse `V1_ROUTES` blocks → `handler` name + index; join with `V1_HTTP_ROUTE_AUDIT[i].permission`.
2. Extract each `async function handleX` / `function handleX` body (brace-balanced scan from `function handleX`).
3. Find `return json({...}, 403)` object literals containing `error: 'forbidden'`.
4. Require `permission:`; if value matches `'…'` literal, must equal every permission registered for that handler; if non-literal identifier/call, accept.
5. Default run: live `v1-dispatch.ts` + contracts audit → exit 1 on failure.
6. `--self-test` fixtures (all required; exit 1 if any expectation wrong):
   - **7a** multi-route: `handleFoo` under `a:read` + `b:write`, body `permission: 'a:read'` → check **fails**
   - **7b** non-literal: `permission: perm` → check **passes**
   - **7c** missing key: `{ error: 'forbidden' }` only → check **fails**
   Live-tree green alone is insufficient.

```bash
node scripts/forbidden-body-check.mjs --self-test
pnpm check:forbidden-bodies
```

- [ ] **Step 4: Confirm green on tree + self-test**

---

### Task 4: `check:do-transport-guards`

**Files:**
- Create: `scripts/do-transport-guards-check.mjs`
- Modify: `package.json` — `"check:do-transport-guards": "node scripts/do-transport-guards-check.mjs"` (no contracts import required unless the script reads audit; if it only scans dispatch source, bare `node` is fine)

**Interfaces:**
- Consumes: `v1-dispatch.ts` GET handlers from `V1_ROUTES` (`method: 'GET'`)
- Produces: exit 0 iff every GET handler that awaits DO work contains a transport guard

- [ ] **Step 1: Implement scanner**

Rules:

1. Collect GET `handler` names from `V1_ROUTES`.
2. For each handler function body:
   - If body matches DO await signals (`\.stub\.`, `resolveOrgStub`, `ORG_DO`, or `listPropertyRefs` / similar) **and** does not match allowlist → require `isPropertyDoTransportFailure` **or** `isOrgDoTransportFailure` appears in that body.
3. Allowlist (document in script header): handlers with no DO await (e.g. `handleGetRegistryProperty` if D1-only). Re-scan when adding GET routes.
4. `--self-test`: synthetic GET handler with `.stub.` await and no guard → fail; same with guard → pass.

```bash
node scripts/do-transport-guards-check.mjs --self-test
pnpm check:do-transport-guards
```

- [ ] **Step 2: Fix any remaining GET handlers the scanner flags** (should be none after Tasks 1–2; if flagged, add the catch — do not expand allowlist without spec leftover).

---

### Task 5: Drop client audit fallback (after Task 3 green)

**Files:**
- Modify: `packages/client-core/src/permission-copy.ts`
- Modify: `packages/client-core/test/permission-copy.test.ts`
- Modify: `apps/web-pms/src/screens/use-folio-action-mutation.ts`
- Modify: `apps/web-pms/src/screens/use-folio-action-mutation.test.ts`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (all `useFolioActionMutation('key', {` → `useFolioActionMutation({`)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` — 403 mock must include `permission` (see Step 3)
- Delete: `apps/web-pms/src/screens/folio-mutation-routes.ts`
- Delete: `apps/web-pms/src/screens/folio-mutation-routes.test.ts`

**Interfaces:**
- Produces: `permissionForForbidden(body: unknown): string | null`

- [ ] **Step 1: Body-only helper**

```ts
export function permissionForForbidden(body: unknown): string | null {
  if (body !== null && typeof body === 'object') {
    const p = (body as Record<string, unknown>).permission;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return null;
}
```

Tests: prefers body.permission; omit → null (delete audit-fallback case).

- [ ] **Step 2: Folio helpers without routeKey**

```ts
export function messageForFolioMutationError(err: unknown, fallback: string): string {
  const c = asClassified(err);
  if (c.class === 'forbidden') {
    const perm = permissionForForbidden(c.body);
    return perm
      ? `Requires permission ${perm}. Ask a manager.`
      : 'Forbidden — insufficient permission.';
  }
  // … unchanged branches …
}

export function useFolioActionMutation<TData, TVariables = void>(opts: {
  fallback: string;
  setMessage: (message: string | null) => void;
  onLocalError?: (err: unknown) => boolean;
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: UseMutationOptions<TData, unknown, TVariables>['onSuccess'];
}): UseMutationResult<TData, unknown, TVariables> {
  // onError → messageForFolioMutationError(err, fallback) — no routeKey
}
```

Update `FolioScreen` call sites; delete `folio-mutation-routes*`.

- [ ] **Step 3: Replace tests that depended on audit fallback / routeKey**

**`FolioScreen.test.tsx`** — `403 on add-charge names folio:post not folio:adjust` currently mocks `{ error: 'forbidden' }` (no permission) and passes **only** via audit fallback. After deletion it would assert generic copy and fail. Change the mock to what the server always sends and rename the intent:

```ts
it('403 on add-charge renders server-supplied permission', async () => {
  // …
  body: { error: 'forbidden', permission: 'folio:post' },
  // …
  expect(msg).toMatch(/folio:post/);
});
```

Property under test: client renders the permission the server supplied — not “client guesses from the audit.”

**`use-folio-action-mutation.test.ts`** — delete routeId / exactly-once `useFolioActionMutation('key'` canaries (routeKey gone). Replace the cash≠split naming case with body-driven cases:

```ts
it('forbidden message renders body.permission', () => {
  const err = new ClassifiedError({
    class: 'forbidden',
    status: 403,
    body: { error: 'forbidden', permission: 'folio:post' },
    retryAfterMs: null,
  });
  expect(messageForFolioMutationError(err, 'Cash failed')).toMatch(/folio:post/);
});

it('forbidden message is generic when body omits permission', () => {
  const err = new ClassifiedError({
    class: 'forbidden',
    status: 403,
    body: { error: 'forbidden' },
    retryAfterMs: null,
  });
  expect(messageForFolioMutationError(err, 'Cash failed')).toBe(
    'Forbidden — insufficient permission.',
  );
});
```

- [ ] **Step 4: Run**

```bash
pnpm check:forbidden-bodies
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
```

---

### Task 6: CI wiring + leftover notes + acceptance sweep

**Files:**
- Modify: `.github/workflows/ci.yml` — add three `- run:` lines after the existing five checks
- Modify: `docs/superpowers/specs/2026-08-07-web-pms-status-tokens-design.md` — mark `get_property` FAIL_CLOSED leftover retired → point at 2026-08-09 spec
- Modify: `docs/superpowers/specs/2026-08-08-folio-front-desk-design.md` — mark #3 and #10 retired
- Modify: design spec status → Approved (after this lands)

- [ ] **Step 1: Wire CI** (no aggregator — discrete steps; colors was in `package.json` only)

```yaml
- run: pnpm check:ddl
- run: pnpm check:entitlements
- run: pnpm check:permissions
- run: pnpm check:degraded
- run: pnpm check:class-denylist
- run: pnpm check:forbidden-bodies
- run: pnpm check:do-transport-guards
- run: pnpm check:web-pms-colors
```

- [ ] **Step 2: One-line retire notes on source specs** (incl. leftover #3 boot-test honesty already in design §5)

- [ ] **Step 3: Full sweep**

```bash
pnpm check:forbidden-bodies
node scripts/forbidden-body-check.mjs --self-test
pnpm check:do-transport-guards
node scripts/do-transport-guards-check.mjs --self-test
pnpm check:web-pms-colors
pnpm check:permissions
pnpm check:degraded
pnpm --filter pms-core test -- degraded-mode
pnpm --filter pms-core test -- front-desk-reads
pnpm --filter pms-core test -- rooms-routes
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
```

Walk design §6 checklist; tick items.
