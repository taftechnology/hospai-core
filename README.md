# HospAI Core

Cloudflare-native multi-tenant PMS platform. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 0 schema-freeze (current)

Monorepo scaffold with frozen PropertyDO schemas, DOMAIN config register, and command catalog.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Packages

| Package | Role |
|---------|------|
| `@hospai/contracts` | Config register + command catalog |
| `@hospai/kernel` | `defineConfig` / config write validation |
| `@hospai/do-runtime` | SQL migrate runner + freeze migrations |
| `@hospai/tenant-router` | Only caller of `idFromName` |
| `@hospai/pms-core` | PropertyDO skeleton |
