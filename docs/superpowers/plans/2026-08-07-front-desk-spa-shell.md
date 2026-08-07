# Front-Desk SPA Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@hospai/client-core` (canaryable SPA logic) and `apps/web-pms` (thin React shell + three-mode board + check-in), served same-origin from `pms-core` with Worker-first assets and full env-gate coverage.

**Architecture:** DOM-free `@hospai/client-core` owns transport, total degraded classification, queued-command log, compose, opaque paging, idempotency keys, and entitlement snapshot refetch-on-402. `apps/web-pms` renders over TanStack Query with retry delegated to client-core. `pms-core` serves `web-pms/dist` via `ASSETS` + `run_worker_first: true`.

**Tech Stack:** TypeScript, Vite, React 19, React Router 7, TanStack Query 5, plain vitest (`client-core`), `@cloudflare/vitest-pool-workers` (`pms-core`), `eslint-plugin-hospai`, `@hospai/contracts` browser-safe subpaths.

**Spec:** [`docs/superpowers/specs/2026-08-07-front-desk-spa-shell-design.md`](../specs/2026-08-07-front-desk-spa-shell-design.md)

## Global Constraints

- **Verification:** plant-one-mutation → **no silent mutation** (named canary fails; extra failures OK).
- **`client-core` deps:** no React, DOM types, TanStack Query, or Clerk.
- **Lint:** `no-dom-in-client-core` (globals) + `no-fetch-in-components` (web-pms components).
- **Query:** `retry: false` by default; per-query `retry`/`retryDelay` call client-core predicates.
- **Classification is total:** every HTTP status → one class; default 4xx/`client_error` never retry; default 5xx/`server_error` never retry.
- **402:** refetch snapshot once; **do not** replay original.
- **Cursors:** opaque strings; client does not encode/decode payloads.
- **Check-in:** no `room_id` required; outage → assign refuses, check-in still queues.
- **Tenant:** orgId/propertyId from **configuration**, not discovery API.
- **Shift strip:** read-only; non-null via fixtures only.
- **Serving:** `run_worker_first: true`; success logs `/v1/*` only; error logs global; stub `ASSETS` in vitest; turbo task edge `pms-core#build` depends on `@hospai/web-pms#build`.
- **Contracts:** browser-safe subpath exports — do not ship config register/zod via SPA import graph.
- **TDD** for client-core canaries; commit after each task.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Put React/Query in `client-core` package.json | typecheck / install |
| Use `document`/`window` in client-core | `no-dom-in-client-core` |
| `fetch(` inside a web-pms component | `no-fetch-in-components` |
| Query default retries left on | FAIL_CLOSED canary / manual review of QueryClient |
| Regenerate idempotency key per attempt | Canary #9 |
| Import `@hospai/contracts` root from client-core | Bundle check / eslint or package export discipline |
| Skip turbo edge web-pms → pms-core | Stale/missing assets on build |
| Assets-first (no `run_worker_first`) | Spec acceptance / wrangler config review |
| Omit exception badge/panel | Spec acceptance # checklist |
| Treat empty board same as FAIL_CLOSED | Board render / client-core list error surfacing |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/package.json` | Subpath exports: `./v1-http-routes`, `./entitlements`, `./provisional-command`, `./idempotency` (add as needed) |
| `tooling/eslint-plugin-hospai/src/no-dom-in-client-core.ts` | Lint bare DOM globals in client-core |
| `tooling/eslint-plugin-hospai/src/no-fetch-in-components.ts` | Lint `fetch` in web-pms UI files |
| `tooling/eslint-plugin-hospai/src/index.ts` | Register both rules in recommended |
| `packages/client-core/package.json` | Package `@hospai/client-core` |
| `packages/client-core/src/classify.ts` | Total response classification + `shouldRetry` / `retryDelay` |
| `packages/client-core/src/queued-commands.ts` | Session queued-command log |
| `packages/client-core/src/transport.ts` | Injected fetch + credential provider |
| `packages/client-core/src/entitlements.ts` | Snapshot hold + refetch-on-402 |
| `packages/client-core/src/compose.ts` | List + batch compose |
| `packages/client-core/src/paging.ts` | Opaque cursor accumulation |
| `packages/client-core/src/idempotency.ts` | Stable key per logical op |
| `packages/client-core/src/api.ts` | Typed front-desk / guests / exceptions / shift / check-in / assign-room calls |
| `packages/client-core/src/index.ts` | Public exports |
| `packages/client-core/test/*.test.ts` | Canaries §4.1 |
| `apps/web-pms/**` | Vite React SPA |
| `apps/pms-core/wrangler.jsonc` | Assets binding + `run_worker_first` |
| `apps/pms-core/src/index.ts` | API branch + ASSETS fall-through + error logging |
| `apps/pms-core/src/env.ts` | `ASSETS` on `PmsEnv` |
| `apps/pms-core/test/spa-assets.spec.ts` | SPA fallback + stub ASSETS |
| `turbo.json` | Explicit `pms-core#build` → `@hospai/web-pms#build` |

---

### Task 1: Contracts — browser-safe subpath exports

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/src/index.ts` (leave root as-is for server)
- Test: add a small Node script or vitest that imports subpaths only

**Interfaces:**
- Produces: `@hospai/contracts/v1-http-routes`, `@hospai/contracts/entitlements`, `@hospai/contracts/provisional-command` (and `./idempotency` if client needs `fingerprintPayload` — prefer generating keys client-side without pulling zod)

- [ ] **Step 1: Add exports map**

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./v1-http-routes": {
    "types": "./dist/v1-http-routes.d.ts",
    "import": "./dist/v1-http-routes.js"
  },
  "./entitlements": {
    "types": "./dist/entitlements.d.ts",
    "import": "./dist/entitlements.js"
  },
  "./provisional-command": {
    "types": "./dist/provisional-command.d.ts",
    "import": "./dist/provisional-command.js"
  }
}
```

- [ ] **Step 2: Build and verify subpath import does not load config register**

Run from a throwaway file or test:

```ts
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts/v1-http-routes';
import { createRequire } from 'node:module';
// Assert audit length >= 68 and that requiring the subpath module graph
// does not evaluate config/register (no zod schema side effects needed).
expect(V1_HTTP_ROUTE_AUDIT.some((r) => r.id === 'get_front_desk_arrivals')).toBe(true);
```

Run: `pnpm --filter @hospai/contracts build && pnpm --filter @hospai/contracts test`

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/package.json packages/contracts/src
git commit -m "feat(contracts): browser-safe subpath exports for SPA client"
```

---

### Task 2: ESLint — `no-dom-in-client-core` + `no-fetch-in-components`

**Files:**
- Create: `tooling/eslint-plugin-hospai/src/no-dom-in-client-core.ts`
- Create: `tooling/eslint-plugin-hospai/src/no-fetch-in-components.ts`
- Modify: `tooling/eslint-plugin-hospai/src/index.ts`
- Modify: `tooling/eslint-plugin-hospai/src/index.test.ts` (or sibling tests)

**Interfaces:**
- Produces: rules `hospai/no-dom-in-client-core`, `hospai/no-fetch-in-components` in recommended

- [ ] **Step 1: Failing rule tests (RED)**

```ts
// Fixture path packages/client-core/src/x.ts containing `window.localStorage` must error.
// Fixture path apps/web-pms/src/screens/Board.tsx containing `fetch('/v1')` must error.
// packages/client-core importing react must NOT be this rule's job (deps catch it).
```

- [ ] **Step 2: Implement `no-dom-in-client-core`**

Match filename `/packages/client-core/`. Report on Identifier `window` / `document` / `localStorage` / `navigator` (same lightweight AST style as existing rules — no typescript-eslint utils).

- [ ] **Step 3: Implement `no-fetch-in-components`**

Match `/apps/web-pms/` and `(components|screens|pages|shell)/` (or any `.tsx` under `src/` except `src/lib/` / `src/providers/` if those are allowed adapters — **prefer: all `.tsx` under web-pms forbid `fetch` CallExpression**; providers that need network go through client-core only).

- [ ] **Step 4: Register in `rules` + `configs.recommended`**

- [ ] **Step 5: Run plugin tests + root lint**

Run: `pnpm --filter eslint-plugin-hospai test && pnpm --filter eslint-plugin-hospai build`

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(eslint): no-dom-in-client-core and no-fetch-in-components"
```

---

### Task 3: Scaffold `@hospai/client-core`

**Files:**
- Create: `packages/client-core/package.json`
- Create: `packages/client-core/tsconfig.json`
- Create: `packages/client-core/vitest.config.ts`
- Create: `packages/client-core/src/index.ts` (empty re-exports for now)

```json
{
  "name": "@hospai/client-core",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "echo 'lint via root eslint'"
  },
  "dependencies": {
    "@hospai/contracts": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  }
}
```

**Do not** add `react`, `@types/react`, `@tanstack/react-query`, or `@clerk/*`.

- [ ] **Step 1: Create package + `pnpm install` from repo root**
- [ ] **Step 2: `pnpm --filter @hospai/client-core typecheck` passes empty package**
- [ ] **Step 3: Commit**

```bash
git commit -m "chore(client-core): scaffold DOM-free package"
```

---

### Task 4: Classification + retry predicates (canaries 2, 4, 5, 11, 13)

**Files:**
- Create: `packages/client-core/src/classify.ts`
- Create: `packages/client-core/test/classify.test.ts`

**Interfaces:**
- Produces:

```ts
export type ClientResultClass =
  | 'live'
  | 'provisional'
  | 'fail_closed'
  | 'read_stale'
  | 'queue_unavailable'
  | 'entitlement_required'
  | 'unauthorized'
  | 'client_error'
  | 'server_error';

export type ClassifiedResponse = {
  class: ClientResultClass;
  status: number;
  body: unknown;
  retryAfterMs: number | null;
};

export function classifyResponse(res: { status: number; headers: Headers; body: unknown }): ClassifiedResponse;
export function shouldRetry(c: ClassifiedResponse): boolean;
export function retryDelay(c: ClassifiedResponse, attempt: number): number;
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { classifyResponse, shouldRetry, retryDelay } from '../src/classify.js';

function hdr(init?: Record<string, string>) {
  return new Headers(init);
}

it('FAIL_CLOSED never retries', () => {
  const c = classifyResponse({
    status: 503,
    headers: hdr(),
    body: { degraded: 'FAIL_CLOSED' },
  });
  expect(c.class).toBe('fail_closed');
  expect(shouldRetry(c)).toBe(false);
});

it('queue_unavailable never retries', () => {
  const c = classifyResponse({
    status: 503,
    headers: hdr(),
    body: { error: 'queue_unavailable' },
  });
  expect(c.class).toBe('queue_unavailable');
  expect(shouldRetry(c)).toBe(false);
});

it('READ_STALE delay from Retry-After', () => {
  const c = classifyResponse({
    status: 503,
    headers: hdr({ 'Retry-After': '7' }),
    body: { degraded: 'READ_STALE' },
  });
  expect(c.class).toBe('read_stale');
  expect(shouldRetry(c)).toBe(true);
  expect(retryDelay(c, 0)).toBe(7000);
});

it('401 unauthorized never retries', () => {
  const c = classifyResponse({ status: 401, headers: hdr(), body: { error: 'unauthorized' } });
  expect(c.class).toBe('unauthorized');
  expect(shouldRetry(c)).toBe(false);
});

it('422 is client_error never retry; 500 is server_error never retry', () => {
  const a = classifyResponse({ status: 422, headers: hdr(), body: { error: 'invalid' } });
  const b = classifyResponse({ status: 500, headers: hdr(), body: { error: 'boom' } });
  expect(a.class).toBe('client_error');
  expect(shouldRetry(a)).toBe(false);
  expect(b.class).toBe('server_error');
  expect(shouldRetry(b)).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @hospai/client-core test -- classify.test.ts`

- [ ] **Step 3: Implement `classify.ts` (total)**

Precedence for 503: parse JSON body — `error === 'queue_unavailable'` → that class; else `degraded === 'FAIL_CLOSED'|'READ_STALE'`; else `server_error`. 402 → `entitlement_required`. 401 → `unauthorized`. 202 with provisional → `provisional`. 2xx → `live`. Other 4xx → `client_error`. Other 5xx → `server_error`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(client-core): total response classification and retry predicates"
```

---

### Task 5: Queued-command log (canary 1)

**Files:**
- Create: `packages/client-core/src/queued-commands.ts`
- Create: `packages/client-core/test/queued-commands.test.ts`

**Interfaces:**

```ts
export type QueuedCommandEntry = {
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  businessDate?: string;
};

export function createQueuedCommandLog(): {
  entries: () => readonly QueuedCommandEntry[];
  recordFromProvisionalBody: (body: unknown) => void;
};
```

- [ ] **Step 1: Failing test — 202 body appends; non-202 ignored**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Pass + commit**

```bash
git commit -m "feat(client-core): session queued-command log from 202 bodies"
```

---

### Task 6: Transport + credential providers (canary 12)

**Files:**
- Create: `packages/client-core/src/transport.ts`
- Create: `packages/client-core/test/transport.test.ts`

**Interfaces:**

```ts
export type CredentialHeaders = Record<string, string>;

export type CredentialProvider = {
  getCredentialHeaders: () => CredentialHeaders | Promise<CredentialHeaders>;
};

export type Transport = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
};

export function createTransport(opts: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  credentials: CredentialProvider;
}): Transport;
```

- [ ] **Step 1: Failing test with two stub providers**

```ts
it('attaches exactly what the provider supplies', async () => {
  const calls: RequestInit[] = [];
  const fetchImpl = async (_u: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response('{}', { status: 200 });
  };
  const t1 = createTransport({
    baseUrl: 'http://x',
    fetchImpl: fetchImpl as typeof fetch,
    credentials: { getCredentialHeaders: () => ({ 'x-dev-actor': 'user_a' }) },
  });
  await t1.fetch('/v1/orgs/o/entitlements');
  expect((calls[0]!.headers as Record<string, string>)['x-dev-actor']).toBe('user_a');

  const t2 = createTransport({
    baseUrl: 'http://x',
    fetchImpl: fetchImpl as typeof fetch,
    credentials: { getCredentialHeaders: () => ({ cookie: 'session=abc' }) },
  });
  await t2.fetch('/v1/orgs/o/entitlements');
  expect((calls[1]!.headers as Record<string, string>).cookie).toBe('session=abc');
});
```

- [ ] **Step 2: Implement — merge provider headers; never hardcode credentials**
- [ ] **Step 3: Pass + commit**

```bash
git commit -m "feat(client-core): injected transport and credential provider"
```

---

### Task 7: Entitlement snapshot + refetch-on-402 (canary 6)

**Files:**
- Create: `packages/client-core/src/entitlements-state.ts`
- Create: `packages/client-core/test/entitlements-state.test.ts`
- Wire into a higher-level `requestJson` helper in `packages/client-core/src/request.ts`

**Interfaces:**

```ts
export function createEntitlementStore(opts: {
  loadSnapshot: () => Promise<EntitlementSnapshot>;
}): {
  get: () => EntitlementSnapshot | null;
  set: (s: EntitlementSnapshot) => void;
  onEntitlementRequired: () => Promise<void>; // refetch once; no replay of original
};
```

- [ ] **Step 1: Failing test**

```ts
it('402 refetches snapshot once and does not replay original', async () => {
  let loads = 0;
  let originals = 0;
  const store = createEntitlementStore({
    loadSnapshot: async () => {
      loads += 1;
      return { orgId: 'o', version: loads, features: {}, limits: {}, computedAt: new Date().toISOString() };
    },
  });
  // simulate: original call counted separately; onEntitlementRequired only bumps loads
  originals += 1;
  await store.onEntitlementRequired();
  expect(loads).toBe(1);
  expect(originals).toBe(1); // not re-invoked
});
```

- [ ] **Step 2: Implement `requestJson` that on classified `entitlement_required` calls `onEntitlementRequired` then returns the classified error (no second original fetch)**
- [ ] **Step 3: Pass + commit**

```bash
git commit -m "feat(client-core): entitlement snapshot refetch-on-402 without replay"
```

---

### Task 8: Compose + paging + idempotency (canaries 7–10)

**Files:**
- Create: `packages/client-core/src/compose.ts`
- Create: `packages/client-core/src/paging.ts`
- Create: `packages/client-core/src/idempotency.ts`
- Create: `packages/client-core/test/compose.test.ts`
- Create: `packages/client-core/test/paging.test.ts`
- Create: `packages/client-core/test/idempotency.test.ts`

**Interfaces:**

```ts
export type GuestRowState =
  | { kind: 'resolved'; displayName: string }
  | { kind: 'erased' }
  | { kind: 'not_found' }
  | { kind: 'decrypt_unresolved' }
  | { kind: 'name_pending' };

export function composeGuestStates(
  refs: string[],
  batch:
    | { ok: true; guests: Record<string, unknown> }
    | { ok: false; wholesaleFailure: true },
): Record<string, GuestRowState>;

export function accumulatePage<T extends { id: string }>(
  prev: T[],
  page: { items: T[]; nextCursor: string | null },
  idOf: (t: T) => string,
): { items: T[]; nextCursor: string | null };

export function createIdempotencyKey(): string;
export function stableKeyForOperation(opId: string, store: Map<string, string>): string;
```

- [ ] **Step 1: Tests**

```ts
// compose: erased + decrypt_unresolved distinguishable; wholesale 503 → all name_pending
// paging: pass opaque cursor through; null nextCursor exhausted; no duplicate ids when accumulating
// idempotency: two stableKeyForOperation calls with same opId → same key; different opId → different
```

- [ ] **Step 2: Implement**
- [ ] **Step 3: Pass + commit**

```bash
git commit -m "feat(client-core): compose, opaque paging, stable idempotency keys"
```

---

### Task 9: Typed API surface (front-desk + writes + exceptions)

**Files:**
- Create: `packages/client-core/src/api.ts`
- Create: `packages/client-core/test/api.test.ts` (mock transport)
- Modify: `packages/client-core/src/index.ts` — export public API

**Interfaces:**

```ts
export function createClient(opts: {
  transport: Transport;
  queued: ReturnType<typeof createQueuedCommandLog>;
  entitlements: ReturnType<typeof createEntitlementStore>;
  keyStore: Map<string, string>;
}): {
  getArrivals: (propertyId: string, date: string, cursor?: string | null) => Promise<…>;
  getDepartures: …;
  getInHouse: …;
  postGuestsBatch: (propertyId: string, refs: string[]) => Promise<…>;
  getShift: (propertyId: string) => Promise<…>;
  getProvisionalExceptionCount: (propertyId: string) => Promise<…>;
  getProvisionalExceptions: (propertyId: string) => Promise<…>;
  assignRoom: (propertyId: string, reservationId: string, roomId: string, opId: string) => Promise<…>;
  checkIn: (propertyId: string, reservationId: string, opId: string) => Promise<…>;
  getOrgEntitlements: (orgId: string) => Promise<…>;
};
```

On provisional (202): call `queued.recordFromProvisionalBody`. On `queue_unavailable`: do **not** record. Use `stableKeyForOperation` for writes. Paths must match audit (`/front-desk/arrivals`, `/guests/batch`, `/provisional-exception-count`, `/provisional-exceptions`, `/front-desk/shift`, check-in + assign-room routes from `V1_HTTP_ROUTE_AUDIT`).

- [ ] **Step 1: Mock-transport tests covering provisional log append + queue_unavailable no-append + assign-room fail_closed**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Export from index; full canary suite green**

Run: `pnpm --filter @hospai/client-core test`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(client-core): typed front-desk API with degraded write paths"
```

---

### Task 10: Scaffold `apps/web-pms`

**Files:**
- Create: `apps/web-pms/package.json` (`name`: `@hospai/web-pms`)
- Create: Vite + React + TS config, `index.html`, `src/main.tsx`, `src/App.tsx`
- Dependencies: `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `@hospai/client-core`, `@clerk/clerk-react` (prod provider adapter only)

Scripts: `build` → `vite build` outDir `dist`; `test` → vitest (minimal); `typecheck`; `lint`.

Tenant config module:

```ts
// apps/web-pms/src/config/tenant.ts
export type TenantConfig = { orgId: string; propertyId: string };
export function readTenantConfig(env: ImportMetaEnv): TenantConfig {
  const orgId = env.VITE_ORG_ID;
  const propertyId = env.VITE_PROPERTY_ID;
  if (!orgId || !propertyId) throw new Error('tenant_config_missing');
  return { orgId, propertyId };
}
```

- [ ] **Step 1: Scaffold + `pnpm install`**
- [ ] **Step 2: `pnpm --filter @hospai/web-pms build` produces `dist/`**
- [ ] **Step 3: Commit**

```bash
git commit -m "chore(web-pms): scaffold Vite React SPA with tenant config"
```

---

### Task 11: Shell wiring — providers, QueryClient, nav/route tables

**Files:**
- Create: `apps/web-pms/src/providers/dev-actor-credentials.ts`
- Create: `apps/web-pms/src/providers/clerk-credentials.ts`
- Create: `apps/web-pms/src/shell/nav.ts` — data array
- Create: `apps/web-pms/src/shell/routes.tsx` — table mapped to `<Route>`
- Create: `apps/web-pms/src/shell/AppShell.tsx`
- Create: `apps/web-pms/src/client.ts` — constructs transport + client-core client once

```ts
// QueryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => shouldRetry(asClassified(err)),
      retryDelay: (count, err) => retryDelay(asClassified(err), count),
    },
    mutations: { retry: false },
  },
});
```

Default must effectively never retry unclassified errors — classify thrown errors in the client so Query receives classified failures.

Nav entries (data): Arrivals, Departures, In-house — **no** entitlement filter.

On classified unauthorized in a top-level effect/boundary → `window.location` / router navigate to sign-in (non-canary).

- [ ] **Step 1: Wire AppShell with shift strip placeholder + queued log panel placeholder + exception badge placeholder**
- [ ] **Step 2: typecheck web-pms**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web-pms): shell providers, QueryClient retry delegation, nav data"
```

---

### Task 12: Board + compose UI

**Files:**
- Create: `apps/web-pms/src/screens/BoardScreen.tsx` — mode prop: `arrivals|departures|in-house`
- Create: `apps/web-pms/src/screens/guest-row.tsx` — maps `GuestRowState` to copy

Behaviour:
- Two Query calls: list + batch; batch failure → `name_pending` rows, list still shown.
- List `fail_closed` → error panel **"Property unreachable"** — **not** an empty table.
- Paging control passes opaque `cursor` from prior page.

- [ ] **Step 1: Implement BoardScreen + routes `/arrivals` `/departures` `/in-house`**
- [ ] **Step 2: Manual smoke against local wrangler once Task 14 lands; until then unit-test compose mapping in client-core only**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web-pms): three-mode front-desk board with guest compose"
```

---

### Task 13: Check-in + assign-room + exception panel + shift strip

**Files:**
- Create: `apps/web-pms/src/screens/CheckInScreen.tsx`
- Create: `apps/web-pms/src/screens/ExceptionsPanel.tsx`
- Create: `apps/web-pms/src/shell/ShiftStrip.tsx`
- Create: `apps/web-pms/src/shell/QueuedCommandsPanel.tsx`

Check-in UX (order is not a dependency):
1. Optional assign-room mutation → on `fail_closed` show hard refusal.
2. Check-in mutation **allowed without room** → on provisional show log entry; on `queue_unavailable` distinct error.

Exceptions: badge from count query; panel lists exceptions. Place next to queued-command log.

Shift strip: render `shift: null` or fixture-populated fields; no open form.

- [ ] **Step 1: Implement screens**
- [ ] **Step 2: typecheck**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web-pms): check-in, assign-room, exceptions panel, shift strip"
```

---

### Task 14: `pms-core` same-origin assets + SPA fallback test

**Files:**
- Modify: `apps/pms-core/wrangler.jsonc` — assets block
- Modify: `apps/pms-core/src/env.ts` — `ASSETS: Fetcher`
- Modify: `apps/pms-core/src/index.ts` — fetch order
- Modify: `apps/pms-core/package.json` — ensure build/deploy story documents web-pms first
- Modify: `turbo.json` — task edge
- Modify: vitest / cloudflare test config — stub `ASSETS`
- Create: `apps/pms-core/test/spa-assets.spec.ts`
- Set Cache-Control in Worker when serving HTML vs hashed assets (or document binding headers after empirical check)

**wrangler.jsonc additions:**

```jsonc
"assets": {
  "binding": "ASSETS",
  "directory": "../web-pms/dist",
  "html_handling": "auto-trailing-slash",
  "not_found_handling": "single-page-application",
  "run_worker_first": true
}
```

**index.ts fetch (normative):**

```ts
const misconfigured = assertEnvSafeForRequest(env);
if (misconfigured) return misconfigured;

const url = new URL(request.url);
const { pathname } = url;

if (pathname === '/v1' || pathname.startsWith('/v1/')) {
  // existing handleV1 + success logHttpRequest
}

try {
  if (!env.ASSETS) {
    logError(/* global */, { msg: 'assets.missing' });
    return json({ error: 'not_found' }, 404);
  }
  const assetRes = await env.ASSETS.fetch(request);
  // Optional: if empirical check shows SPA fallback missing, rewrite to /index.html once
  return assetRes;
} catch (e) {
  logError(/* global */, { msg: 'assets.fetch_failed', error: String(e) });
  throw e;
}
```

Remove the `'hospai-pms-core'` `GET /` banner branch (assets serve `/`).

**turbo.json:**

```json
"tasks": {
  "build": {
    "dependsOn": ["^build"],
    "outputs": ["dist/**"]
  },
  "@hospai/pms-core#build": {
    "dependsOn": ["^build", "@hospai/web-pms#build"],
    "outputs": ["dist/**"]
  }
}
```

- [ ] **Step 1: Stub ASSETS in vitest pool bindings**

```ts
ASSETS: {
  fetch: async (req: Request) => {
    const u = new URL(typeof req === 'string' ? req : req.url);
    if (u.pathname === '/index.html' || u.pathname === '/' || !u.pathname.includes('.')) {
      return new Response('<!doctype html><title>spa</title>', {
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  },
},
```

Adjust so the Worker’s fall-through (or rewrite) is observable.

- [ ] **Step 2: SPA fallback test**

```ts
it('unmatched non-/v1 path serves SPA shell via ASSETS', async () => {
  const res = await worker.fetch(new Request('http://localhost/arrivals'), env);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text.toLowerCase()).toContain('html'); // or exact stub body
});
```

- [ ] **Step 3: Empirically confirm `not_found_handling` on `ASSETS.fetch`; if not, Worker rewrites to `/index.html`**
- [ ] **Step 4: Existing pms-core shards still green**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pms-core): Worker-first SPA assets with gate coverage and fallback test"
```

---

### Task 15: Final verification

- [ ] **Step 1: Canary suite**

Run: `pnpm --filter @hospai/client-core test`  
Expected: all §4.1 canaries green (1–13).

- [ ] **Step 2: Plant-one-mutation spot checks (at least three)**

1. In `classify.ts`, force `shouldRetry` true for `fail_closed` → canary #2 fails. Restore.
2. In queued log, skip append on provisional → canary #1 fails. Restore.
3. In transport, hardcode a header ignoring provider → canary #12 fails. Restore.

- [ ] **Step 3: Repo checks**

```bash
pnpm typecheck
pnpm lint
pnpm check:permissions
pnpm --filter @hospai/web-pms build
pnpm --filter @hospai/pms-core test:unsharded -- spa-assets.spec.ts
pnpm --filter @hospai/pms-core test  # or sharded CI equivalent
```

- [ ] **Step 4: Acceptance checklist** — walk spec §6; every box must be claimable from commits.
- [ ] **Step 5: Final commit if any fixups**

```bash
git commit -m "test: SPA shell acceptance verification"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Verification / no silent mutation | Global + Task 15 |
| `@hospai/client-core` ownership | Tasks 3–9 |
| Total classification + default 4xx/5xx | Task 4 (+ canary 13) |
| Queued-command log + key session-loss named in spec | Task 5 (behaviour); consequence documented in spec already |
| Credential provider canary #12 | Task 6 |
| Refetch-on-402 no replay | Task 7 |
| Compose per-ref + wholesale 503 | Task 8 |
| Opaque paging + stable keys | Task 8 |
| Typed API + assign/check-in degraded | Task 9 |
| Lint nets | Task 2 |
| Contracts subpath (acceptance) | Task 1 |
| web-pms thin screens / nav data | Tasks 10–13 |
| Exception badge + panel | Task 13 |
| Shift strip read-only | Task 13 |
| Check-in without room / outage story | Task 13 |
| Worker-first, costs, logging, ASSETS stub, SPA test, turbo edge | Task 14 |
| No watermark / no Gate / no ui manifest | Tasks 11–13 (absence) |
| Tenant configuration | Task 10 |

**Leftovers intentionally untasked:** module `ui` manifest, nav filter, watermark, folio/money, `GET /v1/me`, open-shift UI, Approach B CORS, WebSocket push.
