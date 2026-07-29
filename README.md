# HospAI Core

Multi-tenant property management on Cloudflare: one **Durable Object per property** holds inventory, reservations, and folio state; Platform D1 holds the tenant registry and entitlement plane; domain logic lives in typed packages and `modules/pms/*` barrels consumed by the **`apps/pms-core`** Worker. The full model is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** Phase 0 complete ([ARCHITECTURE.md §14](ARCHITECTURE.md#14-build-order)); Phase 1 (sellable PMS) in progress.

## Get productive

```bash
pnpm install
pnpm test          # primary loop
```

`pnpm test` uses `vitest-pool-workers` with **shared** DO/D1 storage across the run (`isolatedStorage: false`), so tests must scope assertions to fixtures they create rather than to global state.

There is no polished local HTTP workflow yet. Integration is proven in the test suite (`apps/pms-core/test/`). To hit the Worker over HTTP locally, copy [`.dev.vars.example`](apps/pms-core/.dev.vars.example) → `apps/pms-core/.dev.vars`, then `pnpm --filter @hospai/pms-core dev` and use the curls below.

**CI runs these in order** (run them before pushing):

| Command | What it guards |
|---|---|
| `pnpm build` | TypeScript compile across the monorepo |
| `pnpm check:ddl` | Generated PropertyDO migrations match `packages/do-runtime` (edit source, then `pnpm generate:ddl`) |
| `pnpm check:entitlements` | Catalog + D1 seed feature keys stay inside the closed `FEATURE_KEYS` union |
| `pnpm check:class-denylist` | Every `export class` in the repo is listed for boundary lint |
| `pnpm typecheck` | Project references / types |
| `pnpm test` | Behaviour (275+ tests) |
| `pnpm lint` | ESLint including `eslint-plugin-hospai` |

## PR invariants (merge-blocking)

These fail in CI with little context unless you know they exist:

- **Seven §11 lint rules** (`tooling/eslint-plugin-hospai`) — tenant-router isolation, no DOMAIN config from KV, no entitlement client in `domain/`, no platform imports in `domain/`, bookability must not import reservation modules, PMS must not import add-ons, boundary types must be serializable on module exports / Workers-RPC-safe on DO signatures. See [ARCHITECTURE.md §11](ARCHITECTURE.md#11-repository-layout).
- **`check:ddl`** — drift between `@hospai/do-runtime` migration source and committed SQL under `migrations/`.
- **`check:entitlements`** — FAIL_CLOSED commands carry an entitlement; `FeatureKey` must not collapse to `| string`.
- **`check:class-denylist`** — new `export class` without updating the plugin denylist.
- **Schema-freeze gate** — four PropertyDO shapes (DOMAIN config register, `availability_day`, `restriction_day`, folio windows) are settled; see [ARCHITECTURE.md §14](ARCHITECTURE.md#phase-0--foundation-the-parts-you-cannot-retrofit).

## Where design lives

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — storage topology, DO boundaries, build phases, lint rules.
- **[docs/superpowers/specs/](docs/superpowers/specs/)** — decision records for each slice (auth, entitlements, queues, LaneGuard, inventory stack seam, cloneability lint, etc.). Read these when the code looks arbitrary; the argument is usually there.

Workspace layout: [`pnpm-workspace.yaml`](pnpm-workspace.yaml) (`apps/*`, `packages/*`, `modules/pms/*`, `tooling/*`).

## Local-only unsafe flags

Copy [`apps/pms-core/.dev.vars.example`](apps/pms-core/.dev.vars.example) to `apps/pms-core/.dev.vars` (gitignored).

| Var | Purpose |
|-----|---------|
| `HOSPAI_UNSAFE_LOCAL=1` | Required marker before any dangerous flag is honored |
| `HOSPAI_JURISDICTION_MODE=simulate` | workerd lacks DO jurisdiction; prefixes `eu::prop_…` |
| `HOSPAI_ALLOW_DEV_ACTOR=1` | Allow `X-Dev-Actor` for `/v1/*` in local dev |

**Never put these in top-level `wrangler.jsonc` `vars`.** Without `HOSPAI_UNSAFE_LOCAL=1`, simulate or `ALLOW_DEV_ACTOR` yields HTTP 500 on every request.

Production auth uses **Clerk** (`Authorization: Bearer …`). With the flags above, local dev accepts **`X-Dev-Actor: user_…`** instead. Org membership is always enforced in OrgDO — not Clerk Organizations.

### HTTP bootstrap (local dev)

Order matters: create the org first, then provision. `currency` is required on provision.

```bash
# 1 — org (insert-only; 409 if orgId already exists)
curl -sS -X POST http://localhost:8787/v1/orgs \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_dev' \
  -d '{"orgId":"org_demo","name":"Demo Org"}'

# 2 — property (404 if org missing; 400 without currency)
curl -sS -X POST http://localhost:8787/v1/orgs/org_demo/properties \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_dev' \
  -d '{"propertyId":"prop_demo","name":"Demo Hotel","timeZone":"America/New_York","currency":"USD"}'
```

Both should return **201** when `.dev.vars` is configured and `wrangler dev` is running.
