# Staging live deploy + HTTP smoke test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-16)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Turn the Phase H **staging scaffold** into a **live Clerk-authenticated staging Worker** on Cloudflare account `9c3a73acfa30fd1c244bf519f7c7bce9`, apply D1 migrations remotely, deploy, and run a **10-step HTTP smoke** (provision → book → check-in → check-out). Add committed smoke script + root alias + **`workflow_dispatch`-only** CI deploy workflow. **No frozen head counts move.**

**Architecture:** One-time local Cloudflare resource creation (KV×3, R2, queues×4, D1) → commit real IDs + Clerk public vars in `wrangler.jsonc` → owner sets secrets via stdin → build SPA assets → remote D1 migrate → deploy → fix `CLERK_AUTHORIZED_PARTIES` → smoke with Clerk session JWT. CI workflow reuses committed config; does **not** create resources.

**Tech Stack:** Wrangler (`apps/pms-core/wrangler.jsonc`), Node 22 `fetch` (`scripts/smoke-staging.mjs`), Clerk test instance (`caring-drake-8317.clerk.accounts.dev`), GitHub Actions (`.github/workflows/staging-deploy.yml`), root `pnpm build` / `pnpm smoke:staging`.

**Spec:** `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` (Locks 1–7 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — applies existing D1 migrations only |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `idempotency.ts` `export const` count | **158** | **158** — unchanged |

Tree verified 2026-08-16. Phase **H** must be landed (staging scaffold + dry-run in CI). **No product code, schema, catalog, or route edits.**

---

## Agent vs owner responsibilities

| Marker | Who | Examples |
|---|---|---|
| **[AGENT]** | Composer 2.5 Fast implementer (or orchestrator shell when noted) | wrangler resource create, edit committed files, build, migrate, deploy, run smoke |
| **[OWNER]** | Human product owner | Provide `CLERK_JWT_KEY` PEM out-of-band; `wrangler secret put` stdin; create Clerk test user; paste session JWT at run time; add GitHub repo secrets |

**Subagent limitation:** Tasks that require **network** (wrangler create/deploy) or **interactive stdin** (secret put) may fail in isolated subagent sandboxes. When that happens, the **orchestrator or owner shell** runs those commands; the implementer still edits files and commits committable artifacts.

---

## Sequencing gate (read before starting)

| Order | Task | Parallel-safe? | Blocker |
|---|---|---|---|
| **1** | Task 1 — CF resources + `wrangler.jsonc` | **No** — must land first | Wrangler OAuth + network; owner PEM for `CLERK_JWT_KEY` |
| **2** | Task 2 — smoke script + root script | **Yes** after Task 1 wrangler.jsonc committed (or same PR) | None — no secrets |
| **2** | Task 3 — `staging-deploy.yml` | **Yes** with Task 2 | None — no secrets in file |
| **3** | Task 4 — build, secrets, deploy, smoke | **No** — after Tasks 1–3 | Owner secrets + Clerk test user JWT |
| **4** | Task 5 — final verification + §8 checklist | **No** — after Task 4 smoke green | Live staging URL |

**Locked execution order:**

```
Task 1  →  (Task 2 ∥ Task 3)  →  Task 4  →  Task 5
```

Tasks 2 and 3 may run in parallel on separate working trees; on a single tree, run Task 1 → Task 2 → Task 3 → Task 4 → Task 5.

**Committable vs runtime-only:**

| Artifact | Committed? |
|---|---|
| `apps/pms-core/wrangler.jsonc` real IDs + Clerk **public** vars | **Yes** |
| `scripts/smoke-staging.mjs`, root `smoke:staging` | **Yes** |
| `.github/workflows/staging-deploy.yml` | **Yes** |
| `CLERK_SECRET_KEY`, `HOSPAI_ORG_MASTER_KEY` | **No** — wrangler secrets / GitHub secrets only |
| `CLERK_SESSION_JWT` | **No** — env at smoke run time |
| Deployed Worker state, D1 remote data | **No** |

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: Full staging deploy (spec §2 Lock 1)

**Locked:** Create **real** resources on account `9c3a73acfa30fd1c244bf519f7c7bce9`. Replace **all** placeholder IDs. Remote D1 migrate. Deploy Worker + SPA assets. Smoke against `*.workers.dev` URL.

### D2 — Lock 2: Clerk auth (spec §2 Lock 2)

| Binding / secret | Staging value | How set |
|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | `pk_test_Y2FyaW5nLWRyYWtlLTgzMTcuY2xlcmsuYWNjb3VudHMuZGV2JA` | `vars` in `env.staging` **[AGENT]** |
| `CLERK_JWT_KEY` | PEM public key | `vars` in `env.staging` — **[OWNER]** delivers PEM; **[AGENT]** embeds with `\n` escapes |
| `CLERK_AUTHORIZED_PARTIES` | Exact deployed origin (no trailing slash) | `vars` — placeholder first deploy; update after URL known **[AGENT]** |
| `CLERK_SECRET_KEY` | Clerk test secret | **`wrangler secret put CLERK_SECRET_KEY --env staging`** **[OWNER]** stdin |
| `HOSPAI_ORG_MASTER_KEY` | 64-char hex | **`printf '%s' "$KEY" \| wrangler secret put HOSPAI_ORG_MASTER_KEY --env staging`** **[OWNER]** |

**Explicitly absent on staging:** `HOSPAI_UNSAFE_LOCAL`, `HOSPAI_ALLOW_DEV_ACTOR`, `HOSPAI_JURISDICTION_MODE=simulate`, `HOSPAI_PSP_MODE=simulate`.

**Smoke user:** **[OWNER]** creates Clerk test user (Users → Add user). **[AGENT]** runs smoke with owner-provided session JWT.

### D3 — Lock 3: D1 database name (spec §2 Lock 3)

**Locked:** `database_name`: **`hospai-platform-staging`**; `database_id` from `wrangler d1 create hospai-platform-staging`.

### D4 — Lock 4: Deploy sequence (spec §2 Lock 4)

Eight-step order preserved in Task 4. `CLERK_AUTHORIZED_PARTIES` may require **second deploy** after first URL capture.

### D5 — Lock 5: Smoke script (spec §2 Lock 5)

**Locked:** `scripts/smoke-staging.mjs`; env `BASE` + `CLERK_SESSION_JWT`; root `"smoke:staging": "node scripts/smoke-staging.mjs"`; non-zero exit on first failure; Bearer auth on every request; unique IDs per run.

### D6 — Lock 6: CI workflow (spec §2 Lock 6)

**Locked:** `.github/workflows/staging-deploy.yml`; **`workflow_dispatch` only**; four GitHub secrets; optional `clerk_session_jwt` input; CI does **not** create Cloudflare resources.

### D7 — Lock 7: Rollback (spec §2 Lock 7)

Documented in §Rollback below; not executed unless owner requests teardown.

### D8 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. No push.

---

## Global constraints

- **Head counts unchanged** — only infra config, smoke script, workflow.
- **No product code** — `apps/pms-core/src/**`, `packages/**`, `migrations/**` untouched.
- **No prod deploy**, custom domain, or auto-deploy on push/PR.
- **Secrets never committed** — grep must stay clean post-merge.
- **Existing `ci.yml` unchanged** — staging deploy is separate workflow only.

### Scope out (forbidden across all tasks)

- Production deploy or production resources
- Custom domain / DNS / TLS
- Product code, schema, catalog, HTTP route, idempotency constant changes
- Secrets or PEM private keys in repo, chat, or committed files
- Dev-actor flags on staging
- Coverage threshold changes
- Auto-deploy on `main` or PR
- Git push
- `apps/web-pms` code edits

---

## File map

| File | Change | Task | Committable |
|---|---|---|---|
| `apps/pms-core/wrangler.jsonc` | Real IDs, `database_name`, `account_id`, `vars`, comment | 1, 4 | **Yes** (public vars only) |
| `scripts/smoke-staging.mjs` | **New** — 10-step HTTP smoke | 2 | **Yes** |
| `package.json` (root) | Add `smoke:staging` script | 2 | **Yes** |
| `.github/workflows/staging-deploy.yml` | **New** — manual deploy + optional smoke | 3 | **Yes** |

**Not touched:** `apps/pms-core/src/**`, `packages/**`, `migrations/**`, `ARCHITECTURE.md`, `.github/workflows/ci.yml`, catalog, routes, schema.

---

## Spec §1.5 / §5 / §10 → task map

| Spec item | Task |
|---|---|
| Lock 1 — real resources + deploy | 1, 4 |
| Lock 2 — Clerk vars + secrets | 1, 4 |
| Lock 3 — D1 name | 1 |
| Lock 4 — deploy sequence | 4 |
| Lock 5 — smoke script | 2, 4 |
| Lock 6 — CI workflow | 3, 5 |
| Lock 7 — rollback doc | plan §Rollback; Task 5 confirms doc |
| §7 verification + §10 checklist | 5 |

---

### Task 1 [AGENT]: Create staging Cloudflare resources + update `wrangler.jsonc`

**Spec:** Locks 1–3, §3 resource commands, §6 file map.

**Prerequisites:**
- Wrangler OAuth session on account `9c3a73acfa30fd1c244bf519f7c7bce9` (local owner/orchestrator shell)
- **[OWNER]** provides `CLERK_JWT_KEY` PEM public key out-of-band (not via commit)

**Subagent note:** If the implementer environment blocks network or wrangler OAuth, **orchestrator/owner shell runs Step 1 commands** and pastes captured IDs into the task; implementer completes Step 2 file edit + commit.

**Files:**
- Modify: `apps/pms-core/wrangler.jsonc` (`env.staging` block `:117–233`)

**Forbidden this commit:** secrets in file; dev-actor vars; product code.

- [ ] **Step 1 [AGENT — network required]: Create account-level resources**

From repo root:

```bash
cd apps/pms-core
```

Run **without** `--env staging` (account-level create):

```bash
wrangler kv namespace create "hospai-entitlement-kv-staging"
wrangler kv namespace create "hospai-event-dedupe-kv-staging"
wrangler kv namespace create "hospai-ari-kv-staging"
wrangler r2 bucket create hospai-event-log-staging
wrangler queues create hospai-events-dlq-staging
wrangler queues create hospai-pending-commands-dlq-staging
wrangler queues create hospai-events-staging
wrangler queues create hospai-pending-commands-staging
wrangler d1 create hospai-platform-staging
```

Capture from JSON output:

| Resource | wrangler.jsonc field | Capture |
|---|---|---|
| Entitlement KV | `kv_namespaces[ENTITLEMENT_KV].id` | `id` |
| Event dedupe KV | `kv_namespaces[EVENT_DEDUPE_KV].id` | `id` |
| ARI KV | `kv_namespaces[ARI_KV].id` | `id` |
| Platform D1 | `d1_databases[0].database_id` | `uuid` |

Expected: all commands **exit 0**. R2/queue names already match scaffold — no ID fields.

**Collision risk:** Re-running create on existing names fails — teardown first (§Rollback) if recreating.

- [ ] **Step 2 [AGENT]: Edit `env.staging` in wrangler.jsonc**

1. Replace scaffold comment (`:115–116`) with:

```jsonc
// Staging env — live deploy (Audit H1 follow-up). Resource IDs + Clerk vars committed;
// CLERK_SECRET_KEY + HOSPAI_ORG_MASTER_KEY via wrangler secrets only.
```

2. Add under `env.staging`:

```jsonc
"account_id": "9c3a73acfa30fd1c244bf519f7c7bce9",
```

3. Replace KV placeholder IDs `…012`, `…013`, `…014` with captured IDs.
4. Update `d1_databases[0]`:
   - `database_name`: **`hospai-platform-staging`**
   - `database_id`: captured UUID (not `…010`)
5. Add `vars` block (after bindings, before closing `staging`):

```jsonc
"vars": {
  "CLERK_PUBLISHABLE_KEY": "pk_test_Y2FyaW5nLWRyYWtlLTgzMTcuY2xlcmsuYWNjb3VudHMuZGV2JA",
  "CLERK_JWT_KEY": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "CLERK_AUTHORIZED_PARTIES": "https://hospai-pms-core-staging.placeholder.workers.dev"
}
```

- **[OWNER]** supplies PEM; **[AGENT]** embed with `\n` escapes (single-line JSON string) or JSONC-safe multiline.
- `CLERK_AUTHORIZED_PARTIES`: use obvious placeholder until Task 4 first deploy reveals real subdomain.

6. Confirm **absent:** `HOSPAI_UNSAFE_LOCAL`, `HOSPAI_ALLOW_DEV_ACTOR`, simulate flags.

- [ ] **Step 3 [AGENT]: Verify config parses (local, no deploy yet)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run --env staging
```

Expected: **exit 0**; no placeholder IDs `00000000-0000-0000-0000-0000000000` remain in staging KV/D1 bindings.

Reviewer grep:

```bash
rg "00000000-0000-0000-0000-00000000001[0-4]" apps/pms-core/wrangler.jsonc
! rg "CLERK_SECRET_KEY|HOSPAI_ORG_MASTER_KEY" apps/pms-core/wrangler.jsonc
! rg "HOSPAI_UNSAFE_LOCAL|HOSPAI_ALLOW_DEV_ACTOR" apps/pms-core/wrangler.jsonc
```

Expected: no placeholder IDs in staging block; no secrets or dev-actor vars.

- [ ] **Step 4 [AGENT]: Commit**

```bash
git add apps/pms-core/wrangler.jsonc
git commit -m "$(cat <<'EOF'
chore(pms-core): wire staging env with live Cloudflare IDs

Replace Phase H placeholder bindings with real staging KV and D1 IDs,
add account_id and Clerk public vars for live deploy.
EOF
)"
```

---

### Task 2 [AGENT]: Smoke script + root script alias

**Spec:** Lock 5, §4 HTTP smoke sequence.

**Files:**
- Create: `scripts/smoke-staging.mjs`
- Modify: `package.json` (root)

**Style reference:** `scripts/demo-seed.mjs` — `#!/usr/bin/env node`, `fail()` helper, `readJson()`, no new dependencies.

**Forbidden this commit:** hardcoded secrets; dev-actor header; product code.

- [ ] **Step 1: Add root script**

In root `package.json` `scripts`:

```json
"smoke:staging": "node scripts/smoke-staging.mjs"
```

- [ ] **Step 2: Implement `scripts/smoke-staging.mjs`**

**Env (required):**
- `BASE` — staging origin, no trailing slash (e.g. `https://hospai-pms-core-staging.<subdomain>.workers.dev`)
- `CLERK_SESSION_JWT` — Clerk session token

**Helpers:**
- `fail(step, status, bodySnippet)` → `console.error` + `process.exit(1)`
- `suffix = \`smoke_${Date.now()}\`` (or UUID) for unique IDs
- `addCalendarDays(isoDate, days)` — UTC Y-M-D arithmetic (mirror `apps/pms-core/test/date-helpers.ts:addCalendarDays`)
- `authHeaders` — `{ authorization: \`Bearer ${CLERK_SESSION_JWT}\`, 'content-type': 'application/json' }`

**10 steps + final GET** (pattern refs: `guest-stays-routes.spec.ts`, `rate-plans-routes.spec.ts`, `guests-routes.spec.ts`, `rooms-routes.spec.ts`, `reservations-routes.spec.ts`):

| # | Request | Body / headers | Assert |
|---|---|---|---|
| 1 | `POST /v1/orgs` | `{ orgId: \`org_${suffix}\`, name: 'Smoke Org' }` | **201** |
| 2 | `POST /v1/orgs/{orgId}/properties` | `{ propertyId: \`prop_${suffix}\`, name: 'Smoke Hotel', timeZone: 'UTC', currency: 'USD' }` | **201** |
| 3 | `POST /v1/properties/{propertyId}/room-types` | `{ roomTypeId: \`rt_${suffix}\`, code: 'SMK', name: 'Smoke King', roomCount: 1, maxOccupancy: 2, maxAdults: 2, idempotencyKey: \`idem-rt-${suffix}\` }` | **201**; capture `fromDate` from JSON |
| 4 | `PUT /v1/properties/{propertyId}/rate-days` | `{ roomTypeId, stayDate: fromDate, amountMinor: 10000, currency: 'USD', idempotencyKey: \`idem-rate-${suffix}\` }` (omit `ratePlanId`) | **200** |
| 5 | `POST /v1/properties/{propertyId}/guests` | `{ guestId: \`guest_${suffix}\`, displayName: 'Smoke Guest', idempotencyKey: \`idem-guest-${suffix}\` }` | **200** |
| 6 | `POST /v1/properties/{propertyId}/rooms` | `{ roomId: \`room_${suffix}\`, roomTypeId, code: '101', idempotencyKey: \`idem-room-${suffix}\` }` | **201** |
| 7 | `POST /v1/properties/{propertyId}/reservations` | `{ reservationId: \`res_${suffix}\`, roomTypeId, guestRef: guestId, arrivalDate: fromDate, departureDate: addCalendarDays(fromDate, 1), idempotencyKey: \`idem-res-${suffix}\` }` | **201** |
| 8 | `POST …/reservations/{id}/assign-room` | `{ roomId, idempotencyKey: \`idem-assign-${suffix}\` }` | **200** |
| 9 | `POST …/reservations/{id}/check-in` | header `x-idempotency-key: idem-ci-${suffix}` only | **200** |
| 10 | `POST …/reservations/{id}/check-out` | header `x-idempotency-key: idem-co-${suffix}` only | **200** |
| 11 | `GET …/reservations/{id}` | Bearer only | **200**; `status === 'checked_out'` |

Print `✓ step N: …` on success. Exit **0** only if all pass.

**Idempotency rule (locked):** body-field `idempotencyKey` for steps 3–8; header `x-idempotency-key` for steps 9–10 only.

- [ ] **Step 3: Local syntax check (no live BASE required)**

```bash
node --check scripts/smoke-staging.mjs
```

Expected: no syntax errors.

Optional: run with missing env → script should fail fast with clear message (`BASE` / `CLERK_SESSION_JWT` required).

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-staging.mjs package.json
git commit -m "$(cat <<'EOF'
chore(scripts): add staging HTTP smoke test script

Ten-step provision-to-checkout smoke against live staging Worker;
parameterized via BASE and CLERK_SESSION_JWT env vars.
EOF
)"
```

---

### Task 3 [AGENT]: `workflow_dispatch` staging deploy workflow

**Spec:** Lock 6, §6 file map.

**Files:**
- Create: `.github/workflows/staging-deploy.yml`

**Forbidden this commit:** secrets in YAML; `push` / `pull_request` triggers; changes to `ci.yml`.

- [ ] **Step 1: Create workflow file**

Match existing workflow style (`ci.yml`: `ubuntu-latest`, Node 22, pnpm cache).

```yaml
name: Staging Deploy

on:
  workflow_dispatch:
    inputs:
      clerk_session_jwt:
        description: 'Clerk session JWT for post-deploy smoke (leave empty for deploy-only)'
        required: false
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm build
      - name: Configure wrangler
        working-directory: apps/pms-core
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          printf '%s' "${{ secrets.CLERK_SECRET_KEY }}" | wrangler secret put CLERK_SECRET_KEY --env staging
          printf '%s' "${{ secrets.HOSPAI_ORG_MASTER_KEY }}" | wrangler secret put HOSPAI_ORG_MASTER_KEY --env staging
      - name: Apply D1 migrations (remote)
        working-directory: apps/pms-core
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: wrangler d1 migrations apply hospai-platform-staging --env staging --remote
      - name: Deploy staging Worker
        working-directory: apps/pms-core
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: wrangler deploy --env staging
      - name: Smoke test (optional)
        if: inputs.clerk_session_jwt != ''
        env:
          BASE: https://hospai-pms-core-staging.${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.workers.dev
          CLERK_SESSION_JWT: ${{ inputs.clerk_session_jwt }}
        run: pnpm smoke:staging
```

**Implementer must fix `BASE` in smoke step:** After first local deploy (Task 4), capture the **actual** workers.dev URL from wrangler output and set `BASE` in the workflow to that origin pattern (or derive from deploy output / wrangler stdout parsing). The placeholder above is **wrong** — subdomain is **not** account ID. **Locked approach:** hardcode the exact origin string discovered at first deploy (e.g. `https://hospai-pms-core-staging.iamabdus.workers.dev`) as a workflow env var, or parse `wrangler deploy` stdout for `https://`. Document chosen URL in commit message.

**Required GitHub repository secrets (owner adds — not in repo):**

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers + D1 deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | `9c3a73acfa30fd1c244bf519f7c7bce9` |
| `CLERK_SECRET_KEY` | Clerk test secret |
| `HOSPAI_ORG_MASTER_KEY` | 64-char hex |

- [ ] **Step 2: Verify workflow is dispatch-only**

```bash
rg "on:" .github/workflows/staging-deploy.yml
! rg "push:|pull_request:" .github/workflows/staging-deploy.yml
```

Expected: only `workflow_dispatch` trigger.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/staging-deploy.yml
git commit -m "$(cat <<'EOF'
ci: add manual staging deploy workflow

workflow_dispatch-only deploy with remote D1 migrate and optional
smoke when clerk_session_jwt input is provided.
EOF
)"
```

---

### Task 4 [OWNER + AGENT]: Build, secrets, deploy, smoke

**Spec:** Lock 4 deploy sequence, §7 verification rows 2–7.

**Runtime only — nothing from this task commits** (except possible `CLERK_AUTHORIZED_PARTIES` fix in Task 4 Step 6, which **does** commit if changed).

| Step | Action | Actor |
|---|---|---|
| 4a | `pnpm build` | **[AGENT]** |
| 4b | Set `CLERK_SECRET_KEY` | **[OWNER]** stdin |
| 4c | Generate + set `HOSPAI_ORG_MASTER_KEY` | **[OWNER]** |
| 4d | `wrangler d1 migrations apply … --remote` | **[AGENT]** |
| 4e | `wrangler deploy --env staging` | **[AGENT]** |
| 4f | Update `CLERK_AUTHORIZED_PARTIES` + redeploy if needed | **[AGENT]** |
| 4g | Create Clerk test user + provide session JWT | **[OWNER]** |
| 4h | `pnpm smoke:staging` | **[AGENT]** with owner JWT |

- [ ] **Step 1 [AGENT]: Build SPA assets**

From repo root:

```bash
pnpm build
```

Expected: **exit 0**; `apps/web-pms/dist` exists.

- [ ] **Step 2 [OWNER]: Set wrangler secrets (before deploy)**

From `apps/pms-core`:

```bash
wrangler secret put CLERK_SECRET_KEY --env staging
# Owner pastes Clerk test secret at prompt

KEY="$(openssl rand -hex 32)"
printf '%s' "$KEY" | wrangler secret put HOSPAI_ORG_MASTER_KEY --env staging
# Owner saves KEY in password manager — not in repo
```

Expected: wrangler confirms secret upload for each.

- [ ] **Step 3 [AGENT]: Apply D1 migrations remotely**

```bash
pnpm --filter @hospai/pms-core exec wrangler d1 migrations apply hospai-platform-staging --env staging --remote
```

Expected: applies migrations `0001`–`0005`; **exit 0**.

- [ ] **Step 4 [AGENT]: First deploy**

```bash
pnpm --filter @hospai/pms-core exec wrangler deploy --env staging
```

Expected: prints `https://hospai-pms-core-staging.<subdomain>.workers.dev`; **exit 0**.

Capture exact origin (no trailing slash).

- [ ] **Step 5 [AGENT]: Fix `CLERK_AUTHORIZED_PARTIES` if placeholder ≠ live origin**

If `env.staging.vars.CLERK_AUTHORIZED_PARTIES` does not match deployed origin:

1. Edit `apps/pms-core/wrangler.jsonc` with exact origin.
2. Redeploy:

```bash
pnpm --filter @hospai/pms-core exec wrangler deploy --env staging
```

3. Commit wrangler fix:

```bash
git add apps/pms-core/wrangler.jsonc
git commit -m "$(cat <<'EOF'
chore(pms-core): set staging CLERK_AUTHORIZED_PARTIES to live origin

Match Clerk JWT authorized-parties to deployed workers.dev URL.
EOF
)"
```

- [ ] **Step 6 [AGENT]: Sanity checks before smoke**

```bash
BASE="https://hospai-pms-core-staging.<subdomain>.workers.dev"
curl -s -o /dev/null -w '%{http_code}' "$BASE/"
curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/orgs" -H 'content-type: application/json' -d '{}'
```

Expected: SPA **200**; unauthenticated org create **401** (dev-actor off).

- [ ] **Step 7 [OWNER]: Clerk test user + session JWT**

1. Clerk dashboard → Users → Add user (test instance).
2. Obtain session JWT for smoke (method owner chooses — e.g. sign-in flow, Clerk session token from test client).
3. Provide JWT to implementer **out-of-band** (not committed).

- [ ] **Step 8 [AGENT]: Run smoke**

```bash
BASE="https://hospai-pms-core-staging.<subdomain>.workers.dev" \
CLERK_SESSION_JWT="<owner-provided-jwt>" \
pnpm smoke:staging
```

Expected: **exit 0**; all 10 steps + final GET show `checked_out`.

- [ ] **Step 9 [AGENT]: Update workflow BASE if Task 3 used placeholder**

If Task 3 smoke step hardcodes wrong `BASE`, fix `.github/workflows/staging-deploy.yml` with discovered origin and commit (amend Task 3 commit or small follow-up).

**Task 4 produces no commit** unless Step 5 or Step 9 edits committed files.

---

### Task 5 [AGENT]: Final verification + §8 checklist

**Spec:** §7 verification, §10 checklist.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` — tick §10
- Modify: `docs/superpowers/plans/2026-08-16-staging-deploy-smoke.md` — Task 5 checkboxes only

**Forbidden this commit:** product code; secrets; push.

- [ ] **Step 1: Default-env dry-run still green**

```bash
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run --env staging
```

Expected: both **exit 0**.

- [ ] **Step 2: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 3: All 14 `check:*` gates**

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
```

Expected: all **PASS**.

- [ ] **Step 4: Full local test loop**

```bash
pnpm test:local
```

Expected: green (no product code changed).

- [ ] **Step 5: Pin frozen heads**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG|AUDIT_WRITER"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 158
```

Expected: catalog **89**; writers **63**; routes **144**; schema **34**; idempotency **158**.

- [ ] **Step 6: Scope-out grep**

```bash
! rg "CLERK_SECRET_KEY|HOSPAI_ORG_MASTER_KEY" apps/pms-core/wrangler.jsonc scripts/
! rg "HOSPAI_UNSAFE_LOCAL|HOSPAI_ALLOW_DEV_ACTOR" apps/pms-core/wrangler.jsonc
! rg "push:|pull_request:" .github/workflows/staging-deploy.yml
rg "workflow_dispatch" .github/workflows/staging-deploy.yml
! rg "00000000-0000-0000-0000-00000000001[0-4]" apps/pms-core/wrangler.jsonc
```

Expected: clean.

- [ ] **Step 7: Live staging assertions (from Task 4)**

Confirm recorded:
- Smoke **exit 0**
- Final reservation `status === 'checked_out'`
- SPA curl **200**
- Unauthenticated `POST /v1/orgs` **401**

- [ ] **Step 8 [OWNER optional]: Manual `workflow_dispatch`**

After GitHub secrets configured, run workflow with `clerk_session_jwt` input.

Expected: deploy succeeds; smoke green (JWT must be fresh).

- [ ] **Step 9: Tick spec §10 checklist**

Tick every item in `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` §10.

- [ ] **Step 10: Tick Task 5 checkboxes in this plan only**

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md \
  docs/superpowers/plans/2026-08-16-staging-deploy-smoke.md
git commit -m "$(cat <<'EOF'
chore(docs): finalize staging deploy smoke verification checklist

Confirm live staging deploy, smoke pass, and frozen head counts unchanged.
EOF
)"
```

**Stop.** Staging deploy + smoke vertical closed.

---

## Verification plan

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | Resource create commands (§3) | All exit 0; IDs captured | 1 |
| 2 | `pnpm build` | Exit 0; `apps/web-pms/dist` present | 4, 5 |
| 3 | `wrangler d1 migrations apply hospai-platform-staging --env staging --remote` | Applies `0001`–`0005`; exit 0 | 4 |
| 4 | `wrangler deploy --env staging` | Prints workers.dev URL; exit 0 | 4 |
| 5 | `curl -s -o /dev/null -w '%{http_code}' "$BASE/"` | **200** (SPA) | 4 |
| 6 | Unauthenticated `POST /v1/orgs` | **401** | 4 |
| 7 | `BASE=… CLERK_SESSION_JWT=… pnpm smoke:staging` | Exit 0; 10 steps green; final GET `checked_out` | 4 |
| 8 | `wrangler deploy --dry-run` (default + staging) | Exit 0 | 1, 5 |
| 9 | Manual `workflow_dispatch` with JWT | Deploy + smoke green | 5 |
| 10 | All **14** `check:*` + typecheck + lint + `pnpm test:local` | Green | 5 |

**Smoke pass criterion:** Script exits 0 **and** final reservation GET shows `status === 'checked_out'`.

---

## Rollback / teardown (Lock 7)

To tear down staging (owner/orchestrator shell; **not** part of normal implement flow):

```bash
cd apps/pms-core
pnpm exec wrangler delete hospai-pms-core-staging --env staging
wrangler d1 delete hospai-platform-staging
wrangler kv namespace delete --namespace-id=<ENTITLEMENT_KV_ID>
wrangler kv namespace delete --namespace-id=<EVENT_DEDUPE_KV_ID>
wrangler kv namespace delete --namespace-id=<ARI_KV_ID>
wrangler r2 bucket delete hospai-event-log-staging
wrangler queues delete hospai-events-staging
wrangler queues delete hospai-pending-commands-staging
wrangler queues delete hospai-events-dlq-staging
wrangler queues delete hospai-pending-commands-dlq-staging
```

Revert committed IDs in `wrangler.jsonc` only if fully tearing down the vertical.

---

## Spec §10 reviewer checklist (Task 5 ticks spec file)

| §10 item | Satisfied by |
|---|---|
| Lock 1: Real resources; placeholder IDs replaced | 1 |
| Lock 2: Clerk vars committed; secrets not committed; dev-actor absent | 1, 4, 5 |
| Lock 3: D1 name `hospai-platform-staging`; remote migrations | 1, 4 |
| Lock 4: Deploy sequence; `CLERK_AUTHORIZED_PARTIES` matches origin | 4 |
| Lock 5: `scripts/smoke-staging.mjs`; `pnpm smoke:staging` | 2, 4 |
| Lock 6: `staging-deploy.yml` dispatch-only; four GitHub secrets | 3, 5 |
| Lock 7: Teardown documented | plan §Rollback |
| Smoke: 10-step sequence; body vs header idempotency | 2, 4 |
| Frozen head counts unchanged | 5 |
| Scope-out respected | 1–5 |
| `pnpm test:local` + all **14** `check:*` green | 5 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in | 1–5 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–7 | 1–5 |
| §3 resource commands | 1 |
| §4 smoke sequence | 2, 4 |
| §6 file map | 1–3 |
| §7 verification | 4, 5 |
| §10 checklist | 5 |
| Frozen heads §1.4 | unchanged |

**Gaps:** None — spec scope fully mapped.

---

## Plan writer interpretations (flagged for reviewer)

1. **Task 3 BASE URL:** Spec leaves subdomain TBD — plan requires implementer to hardcode or parse real origin after Task 4 first deploy; initial workflow template must not use account ID as subdomain.
2. **Task 1 PEM:** Owner delivers `CLERK_JWT_KEY` OOB; implementer embeds — not generated in repo.
3. **Task 4 commit split:** `CLERK_AUTHORIZED_PARTIES` fix may be a second wrangler commit after first deploy — acceptable per Lock 4 note.
4. **Tasks 2 ∥ 3:** Parallel-safe after Task 1; single-tree sequential also fine.
5. **CI smoke BASE:** Same origin string as local smoke — single source in workflow env after discovery.

---

## Risks

| Risk | Mitigation |
|---|---|
| Subagent cannot run wrangler create/deploy | Orchestrator/owner shell runs network steps; implementer edits files |
| Wrong `CLERK_AUTHORIZED_PARTIES` → 401 | Capture deploy URL; redeploy; verify unauthenticated 401 vs authenticated 201 |
| Forgot `HOSPAI_ORG_MASTER_KEY` → guest step fails | Task 4 Step 2 before deploy; documented in sequence |
| Placeholder IDs committed without replace | Task 1 grep + reviewer check |
| JWT expiry during CI smoke | Short workflow; fresh JWT via dispatch input |
| Resource name collision on re-run create | Teardown (§Rollback) before recreate |
| Staging SPA Clerk sign-in untested | Smoke uses Bearer JWT; SPA sign-in manual owner check (out of scope) |
| GitHub secrets missing on first dispatch | Task 5 Step 8 optional; document four secrets in Task 3 |

---

## Approximate line numbers — read actual code first

| Area | Location | Plan note |
|---|---|---|
| Staging scaffold | `wrangler.jsonc:117–233` | Task 1 |
| Scaffold comment | `wrangler.jsonc:115–116` | Task 1 replace |
| Demo seed script style | `scripts/demo-seed.mjs` | Task 2 |
| Room-type body | `guest-stays-routes.spec.ts:46–63` | Task 2 step 3 |
| Rate-days body | `rate-plans-routes.spec.ts:361–369` | Task 2 step 4 |
| Check-in headers | `reservations-routes.spec.ts:395–404` | Task 2 steps 9–10 |
| CI workflow style | `.github/workflows/ci.yml` | Task 3 |
| Root scripts | `package.json:9–31` | Task 2 |
