# HospAI Core

Cloudflare-native multi-tenant PMS platform. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 0

Schema-freeze, tenancy spine, §10.1 idempotency × outbox, **`pms.inventory`** (room types + 365-day horizon seed), the **[night audit spine + horizon extension](docs/superpowers/specs/2026-07-27-night-audit-horizon-design.md)**, and **`reservations.create` + `availability.book`** (ledger `sold` increment in the same txn as reservation insert) — are done.

### Next (blocks bookable product)

First booking against the ledger is proven; a sellable product still needs:

- **Rates** — materialized nightly rates before meaningful quotes
- **`reservations.cancel` / modify** — release sold back to the ledger
- **Restriction evaluation** (`restriction_day` in the book txn)
- Queues `EVENTS_QUEUE` consumer path (in-DO flush works today)
- Real night-audit step bodies, clear-halt, guest/folio domain

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm check:ddl
```

### Local-only unsafe flags

Copy [`apps/pms-core/.dev.vars.example`](apps/pms-core/.dev.vars.example) to `apps/pms-core/.dev.vars` (gitignored).

| Var | Purpose |
|-----|---------|
| `HOSPAI_UNSAFE_LOCAL=1` | Required marker before any dangerous flag is honored |
| `HOSPAI_JURISDICTION_MODE=simulate` | workerd lacks DO jurisdiction; prefixes `eu::prop_…` |
| `HOSPAI_ALLOW_DEV_ACTOR=1` | Allow `X-Dev-Actor` header for `/v1/*` |

**These must never appear in top-level `wrangler.jsonc` `vars`.** A deploy that sets simulate or ALLOW_DEV_ACTOR without `HOSPAI_UNSAFE_LOCAL=1` gets HTTP 500 on every request.

Dev actor auth is a stand-in until Clerk. All `/v1/*` routes (including reads) require the actor header when the flags are enabled.

Example:

```bash
curl -X POST http://localhost:8787/v1/orgs/org_1/properties \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_dev' \
  -d '{"propertyId":"prop_1","name":"Demo","jurisdiction":null,"timeZone":"America/New_York"}'
```

## Packages

| Package | Role |
|---------|------|
| `@hospai/contracts` | Config register, command catalog, tenancy types |
| `@hospai/kernel` | Config write validation |
| `@hospai/do-runtime` | SQL migrate runner + Property/Org/Platform D1 migrations |
| `@hospai/tenant-router` | Only caller of `idFromName` / `getByName` |
| `@hospai/pms-core` | PropertyDO, OrgDO, Platform D1 registry, provision HTTP |
