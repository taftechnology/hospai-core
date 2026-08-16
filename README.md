# HospAI Core

Multi-tenant property management on Cloudflare: one **Durable Object per property** holds inventory, reservations, and folio state; Platform D1 holds the tenant registry and entitlement plane; domain logic lives in typed packages and `modules/pms/*` barrels consumed by the **`apps/pms-core`** Worker. The full model is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Status:** Phase 0 complete ([ARCHITECTURE.md §14](ARCHITECTURE.md#14-build-order)); Phase 1 (sellable PMS) in progress.

## Get productive

```bash
pnpm install
pnpm test:local    # primary loop
```

`pnpm test:local` runs `vitest-pool-workers` with **shared** DO/D1 storage across each package (`isolatedStorage: false`), so tests must scope assertions to fixtures they create rather than to global state; it shards `pms-core` 8 ways (unsharded `pnpm test` segfaults workerd locally).

Integration behaviour is proven in `apps/pms-core/test/`. For a local HTTP + browser loop, see **[Run locally](#run-locally)** below.

**CI runs these in order** (run them before pushing):

| Command | What it guards |
|---|---|
| `pnpm build` | TypeScript compile across the monorepo |
| `pnpm check:ddl` | Generated PropertyDO migrations match `packages/do-runtime` (edit source, then `pnpm generate:ddl`) |
| `pnpm check:entitlements` | Catalog + D1 seed feature keys stay inside the closed `FEATURE_KEYS` union |
| `pnpm check:class-denylist` | Every `export class` in the repo is listed for boundary lint |
| `pnpm check:module-manifests` | Module registry membership, ui/server `moduleId` pairing, write-set ⊇ actual |
| `pnpm typecheck` | Project references / types |
| `pnpm test:local` | Behaviour (~800+ tests across packages; pms-core sharded 8 ways locally) |
| `pnpm lint` | ESLint including `eslint-plugin-hospai` |

`pnpm test` unsharded segfaults workerd locally; `test:local` shards pms-core 8 ways to match CI. The sold-ledger property spec runs in a separate CI job but is included in local shards.

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

## Run locally

Two processes: the **Worker** (`pms-core` on `:8787`) and the **SPA** (`web-pms` Vite on `:5173`, which proxies `/v1` → `8787`).

### 1 — Env files (once)

```bash
cp apps/pms-core/.dev.vars.example apps/pms-core/.dev.vars
cp apps/web-pms/.env.example apps/web-pms/.env
```

| File | Purpose |
|------|---------|
| [`apps/pms-core/.dev.vars`](apps/pms-core/.dev.vars.example) | Local-only Worker flags + `HOSPAI_ORG_MASTER_KEY` (required for guest create / booking) |
| [`apps/web-pms/.env`](apps/web-pms/.env.example) | `VITE_ORG_ID` / `VITE_PROPERTY_ID` and `VITE_USE_DEV_ACTOR=1` with `VITE_DEV_ACTOR=user_owner` |

| Worker var | Purpose |
|------------|---------|
| `HOSPAI_UNSAFE_LOCAL=1` | Required marker before any dangerous flag is honored |
| `HOSPAI_JURISDICTION_MODE=simulate` | workerd lacks DO jurisdiction; prefixes `eu::prop_…` |
| `HOSPAI_ALLOW_DEV_ACTOR=1` | Allow `X-Dev-Actor` for `/v1/*` in local dev |
| `HOSPAI_ORG_MASTER_KEY` | 64-char hex (32 bytes); wraps guest PII data keys in OrgDO |

**Never put these in top-level `wrangler.jsonc` `vars`.** Without `HOSPAI_UNSAFE_LOCAL=1`, simulate or `ALLOW_DEV_ACTOR` yields HTTP 500 on every request.

Production auth uses **Clerk** (`Authorization: Bearer …`). With the flags above, local dev accepts **`X-Dev-Actor: user_…`** instead. Org membership is always enforced in OrgDO — not Clerk Organizations. Match the SPA actor (`user_owner` in `.env.example`) on curls below.

**Engineer path (unchanged):** keep `VITE_USE_DEV_ACTOR=1` in `apps/web-pms/.env`; `/sign-in` auto-redirects to `/board`.

**Demo path (P0-4):** unset `VITE_USE_DEV_ACTOR`, set `VITE_CLERK_PUBLISHABLE_KEY` in the SPA, and set Worker `CLERK_*` in `apps/pms-core/.dev.vars`. The SPA uses a custom `/sign-in` (not Clerk's hosted pages). See `docs/superpowers/specs/2026-08-13-sign-in-clerk-design.md`.

Identity mapping is OrgDO, not Clerk roles. After seed (still `user_owner`) **and** after the Clerk user exists, P0-5 runs:

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/members \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"email":"<the Clerk user email>","role":"owner"}'
```

Order is load-bearing: seed first, then this POST, then sign-in. Signing in before mapping is `me-no-access` (correct, not a SPA bug). Password-gate fallback needs no mapping.

### 2 — Start servers

```bash
# terminal A — API + Durable Objects (keep on 8787; Vite proxies there)
pnpm --filter @hospai/pms-core dev

# terminal B — front desk UI
pnpm --filter @hospai/web-pms dev
```

Open **http://127.0.0.1:5173/**. Optionally build the SPA and hit **http://127.0.0.1:8787/** alone (`pnpm --filter @hospai/web-pms build`; Worker serves `apps/web-pms/dist`).

### 3 — Seed the demo hotel (once per local DO/D1 store)

Worker must already be running (step 2, terminal A).

```bash
pnpm demo:seed
```

This provisions **Harborlight Hospitality** / **The Meridian Seattle** (`org_demo` / `prop_demo` — same ids as `apps/web-pms/.env.example`): ~20 rooms, BAR rates, and today’s board (8 in-house, 4 arrivals, 3 due out). Re-run is safe (idempotent).

Meeting script: [`docs/demo/8-minute-script.md`](docs/demo/8-minute-script.md)

If a dry run left the hotel dirty, wipe local persist and seed again:

1. Stop `pnpm --filter @hospai/pms-core dev`
2. Delete `apps/pms-core/.wrangler/state`
3. Start the Worker again
4. `pnpm demo:seed`

Do not run org purge for this.

#### Developer bootstrap (empty hotel)

Engineers who want a blank property can still curl org → property → one room type. A prior curl plus `pnpm demo:seed` heals `rt_king` to **King Deluxe** and PATCHes the property name. A messy mix of leftover types is a wipe (above).

```bash
# 1 — org (insert-only; 409 if orgId already exists)
curl -sS -X POST http://127.0.0.1:8787/v1/orgs \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"orgId":"org_demo","name":"Demo Org"}'

# 2 — property (404 if org missing; 400 without currency)
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/properties \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"propertyId":"prop_demo","name":"Demo Hotel","timeZone":"UTC","currency":"USD"}'

# 3 — inventory (required before booking)
curl -sS -X POST http://127.0.0.1:8787/v1/properties/prop_demo/room-types \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"roomTypeId":"rt_king","code":"KNG","name":"King","roomCount":10,"maxOccupancy":2,"maxAdults":2,"idempotencyKey":"idem-rt-king-demo"}'
```

Org/property create should return **201** (or **409** / property already present on re-runs). Room-type create should return **201** with `fromDate`/`toDate`. Then use **Book** in the UI to create a reservation.

If booking fails with `HOSPAI_ORG_MASTER_KEY unset`, your `.dev.vars` is missing that key — copy from `.dev.vars.example` and restart `pms-core` `dev`.
