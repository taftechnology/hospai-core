# HospAI Core

Cloudflare-native multi-tenant PMS platform. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 0

Schema-freeze, tenancy spine, §10.1 idempotency × outbox, **`pms.inventory`** (room types + 365-day horizon seed), and the **[night audit spine + horizon extension](docs/superpowers/specs/2026-07-27-night-audit-horizon-design.md)** — `AlarmScheduler` → `NightAuditWorkflow` (registry-resolved only) → `runAuditStep`, with `ROLL_BUSINESS_DATE` set-reconciling the horizon to `business_date + (HORIZON_DAYS - 1)` and never-dark rescheduling (post-roll, provision, and `pms.night_audit.audit_time` config-matrix hooks) — are done.

### Next (blocks bookable product)

The night-audit *spine* is proven, not a sellable product yet — every step but `ROLL_BUSINESS_DATE` is still a stub (see spec Follow-ons):

- Real `PRE_CHECK` + provisional-command queue drain/halt (§4.6)
- Real `POST_ROOM_CHARGES` / no-show / cashier-shift / report / archive step bodies
- Clear-halt operator command + UI (halt is currently derived-only, never cleared)
- Reservations / booking flow itself — nothing in this repo yet consumes the availability ledger to actually sell a room

Pick up the reservation/booking domain next, or harden a stub audit step, per priority. (Earlier boarding note: [horizon-extension-followon](docs/superpowers/specs/2026-07-27-horizon-extension-followon.md).)

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
