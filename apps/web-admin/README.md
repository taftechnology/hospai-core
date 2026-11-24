# HospAI Ops Console (`apps/web-admin`)

Staff-only app where HospAI creates customers and hotels, changes plans and add-ons, suspends and
reinstates, and reads each hotel's health. It is **not** the hotel app (`apps/web-pms`).

Spec: `docs/superpowers/specs/2026-11-22-ops-platform-design.md` (§15 for sign-in).

- A **Worker with static assets** (not Pages): the Vite build in `dist/` plus its own `/api/*` JSON handler.
- Bindings: only `PMS_OPS` (service binding to pms-core's `OpsEntrypoint`) and the assets.
  No D1, DO, KV, R2 or queue. `src/worker/wrangler-bindings.test.ts` enforces it in every env.
- Sign-in: its **own Clerk instance** (never the hotel instance), second factor required (`fva`),
  `authorizedParties` enforced, empty config fails closed.
- Every response goes through `@hospai/http-security` (the one header helper, shared with pms-core).

## Run it locally (dev operator header, no Clerk)

Prerequisites: `pnpm install`, and `pnpm --filter @hospai/web-pms build` (pms-core serves that
directory as assets and refuses to start without it).

1. One-time files (both are gitignored):

   ```sh
   cp apps/web-admin/.dev.vars.example apps/web-admin/.dev.vars
   echo 'OPS_BOOTSTRAP_EMAILS=dev-operator@example.test' >> apps/pms-core/.dev.vars
   ```

   `OPS_BOOTSTRAP_EMAILS` is read by **pms-core** (not web-admin). The first sign-in whose verified
   email is listed there becomes the first `ops_admin`, only while the operator table is empty.
   `.dev.vars` in `apps/web-admin` carries the two local-only flags
   (`HOSPAI_UNSAFE_LOCAL=1`, `OPS_ALLOW_DEV_OPERATOR=1`); they are never in `wrangler.jsonc`.

2. Terminal 1: the Worker plus pms-core, with the service binding wired locally:

   ```sh
   cd apps/web-admin
   pnpm build            # builds ./dist, the assets directory
   pnpm exec wrangler dev -c wrangler.jsonc -c ../pms-core/wrangler.jsonc --port 8788
   ```

   This serves `/api` and the built bundle on 8788. The bundle you just built has no dev-operator
   flag, so use step 3 to open the console.

3. Terminal 2, variant A (recommended: hot reload, proxies `/api` to 8788):

   ```sh
   cd apps/web-admin
   VITE_USE_DEV_OPERATOR=1 VITE_DEV_OPERATOR_EMAIL=dev-operator@example.test pnpm exec vite --port 5174
   ```

   Open <http://localhost:5174>. The SPA sends `x-dev-operator: dev-operator@example.test`.

   Variant B (the built bundle served by the Worker on 8788): build with the same two variables,
   `VITE_USE_DEV_OPERATOR=1 VITE_DEV_OPERATOR_EMAIL=... pnpm build`, then open <http://localhost:8788>.

The Worker honours `x-dev-operator` only when **both** `HOSPAI_UNSAFE_LOCAL=1` and
`OPS_ALLOW_DEV_OPERATOR=1` are set, so a deployed Worker ignores the header.

To try real Clerk sign-in locally instead, put the ops instance's `CLERK_SECRET_KEY`,
`CLERK_PUBLISHABLE_KEY` and `CLERK_AUTHORIZED_PARTIES=http://localhost:5174` in `.dev.vars`, set
`VITE_CLERK_PUBLISHABLE_KEY` in `apps/web-admin/.env.local`, and leave `VITE_USE_DEV_OPERATOR` unset.

## Tests

```sh
pnpm --filter @hospai/web-admin test            # worker (auth, headers, bindings) + SPA screens
pnpm --filter @hospai/web-admin test:coverage
```

## What you set up before the first deploy (nothing here is done for you)

1. **The ops Clerk instance** ("HospAI Ops", separate from the hotel instance):
   - Turn **multi-factor authentication on** (authenticator app or passkey) and require it for every user.
   - **Restrict sign-up** to an allowlist (invitation or allowlist only). Anyone able to sign up
     can reach the operator check, though they cannot pass it.
2. **Secrets** on the Worker, per env (`-e staging`, `-e production`). Never commit values:

   ```sh
   cd apps/web-admin
   pnpm exec wrangler secret put CLERK_SECRET_KEY -e staging
   pnpm exec wrangler secret put CLERK_JWT_KEY -e staging     # optional, the instance PEM public key
   ```

3. **Vars** in `wrangler.jsonc` (per env; they ship empty, which fails closed):
   - `CLERK_PUBLISHABLE_KEY`: the ops instance's publishable key.
   - `CLERK_AUTHORIZED_PARTIES`: the console's own origin(s), comma separated, for example
     `https://<console hostname>`. Without it every request is 401.
4. **`VITE_CLERK_PUBLISHABLE_KEY`** at build time (the same publishable key), then
   `pnpm --filter @hospai/web-admin build`.
5. **`OPS_BOOTSTRAP_EMAILS`** on **pms-core** (a var there): the email of the first operator.
6. **The hostname** (open question Q1). No `routes` or custom domain is configured yet.
7. Optional extra layer: Cloudflare Access in front of the hostname. Nothing depends on it.

## Layout

- `src/worker/`: `index.ts` (assets + `/api`, one header helper), `auth.ts` (Clerk verify, `fva`,
  operator resolution, dev header), `api.ts` (the thin routes), `env.ts` (typed `PMS_OPS` binding).
- `src/api/`: the one module that calls `/api` (`client.ts`), query keys (`keys.ts`), hooks.
- `src/screens/`, `src/components/`: Customers, Customer detail, Hotel health, Create customer,
  Operator log, Operators. Write forms need a Reason (1 to 500) and send one `clientKey` per submit.
- `src/styles.css` imports the hotel app's `tokens.css` and ui-kit styles; colour lives in tokens only.
