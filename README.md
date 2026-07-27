# HospAI Core

Cloudflare-native multi-tenant PMS platform. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 0

Schema-freeze gate is done. Current foundation work: **tenancy spine** (Platform D1 registry + OrgDO + PropertyDO provisioning).

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm check:ddl
```

Local workerd does not implement DO `jurisdiction()`. `wrangler.jsonc` sets
`HOSPAI_JURISDICTION_MODE=simulate` so local/EU provision encodes jurisdiction into the
object name (`eu::prop_…`). **Unset this var in production** — real `namespace.jurisdiction()` must be used.

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
| `@hospai/do-runtime` | SQL migrate runner + Property/Org DO migrations |
| `@hospai/tenant-router` | Only caller of `idFromName` / `getByName` |
| `@hospai/pms-core` | PropertyDO, OrgDO, Platform D1 registry, provision HTTP |
