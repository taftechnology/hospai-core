# HospAI operations platform — design

**Date:** 2026-11-22
**Status:** Accepted for build: §1–§10 (R7.1) and §11 (R7.5). §12 (R7.3) is direction only and gets its own spec before it is built. **Amended 2026-11-24 (§15):** the console is the **HospAI Ops Console**, a separate Vite + React app in this monorepo that signs in with its **own Clerk instance**, not Cloudflare Access. §15 overrides D2, D3's "no secret" line, D4's email match and the Access tests in §10.
**Roadmap:** Track G. **R7.1** and **R7.5** in Part B (before hotel 2), **R7.3** in Part C.
**Sources:**
- [`ARCHITECTURE.md` §4.9](../../../ARCHITECTURE.md#49-admin--support-access) (admin and support access), §6.1–§6.4 (entitlements, kill-switch), §11 (`apps/web-admin`).
- [Cross-tenant provision](./2026-09-04-cross-tenant-provision-design.md): `validateTenantId`, first writer wins, 409 with no foreign row.
- [Entitlement catalog (R3.10)](./2026-11-18-entitlement-catalog-design.md): plans, add-ons, the hard `pms.properties.limit` slot in OrgEntitlementDO.
- [Entitlements and kill-switch](./2026-07-28-entitlements-killswitch-design.md), [observability](./2026-07-28-observability-design.md).
- [Platform operations research](../../research/reports/Hotel%20PMS%20platform%20operations.md), gaps 7, 13–16.

```
Slice: R7.1 (this spec §1–§10), R7.5 (§11)
Depends on: R3.10 (done). R7.5 depends on R7.1.
Prototype: none — internal tool, no BluePMS or prototype surface.
Live: apps/web-admin (new Worker + SPA) + apps/pms-core (OpsEntrypoint, registry, tenant gate) + apps/web-pms (one read-only table, suspended band)
Locked call: one staff-only app, behind Cloudflare Access, where HospAI creates customers and hotels, changes plans and add-ons, suspends and reinstates, and sees each hotel's health. Every change is a recorded command with an operator actor that the hotel can see. No standing access to guest or folio data.
Scope out: §9
Pins: COMMAND_CATALOG 151 → 161 (R7.1), 162 (R7.5) · last route get_org_operator_actions (261; R4.4 took 260) · PROPERTY_SCHEMA_HEAD unchanged · ORG_SCHEMA_HEAD unchanged · NIGHT_AUDIT_STEPS unchanged
Tests: §10, fail-first for tenancy (cross-org provision, foreign rows) and the suspended gate
Verify: pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

---

## 1. Why

Today a hotel exists because someone ran `POST /v1/orgs` and `POST /v1/orgs/:orgId/properties` as a signed-in user, and a plan changes because someone wrote SQL against Platform D1. `seedSubscription` and `trySetOrgStatus` in `apps/pms-core/src/registry.ts` are test helpers. Nothing records who changed a customer's plan, or why. The hotel cannot see it either.

One owner will bring about ten hotels, one at a time. Hotel 2 cannot be added on Growth (`limit_exceeded`), so the first real plan change happens before hotel 2. That change, and every one after it, should go through a recorded path.

## 2. Two kinds of "all hotels"

| | HospAI operations platform (this spec) | Owner's head-office view (R7.4) |
|---|---|---|
| Who | HospAI employees | The group owner and their managers |
| Sees | Every customer: plan, status, health | Only their own hotels: today's counts, revenue, night audit |
| Lives in | `apps/web-admin`, its own Worker | `apps/web-pms`, an org route |
| Auth | Cloudflare Access + operator registry | Clerk + org permission |
| Guest data | Never | Never (summaries only) |

They are not the same screen and never share a route.

## 3. Shape

| # | Decision |
|---|---|
| D1 | **`apps/web-admin` is a new Worker with static assets** (Workers `assets`, not Pages): a React SPA plus its own `/api/*` handler. It runs on its own hostname, which the operator chooses (open question Q1). No hotel-facing hostname routes to it. |
| D2 | **Cloudflare Access in front of the whole hostname.** The Access policy allows only named emails and requires a hardware key (`auth_method` `hwk`). The user sets the policy in the Cloudflare dashboard. On every request the Worker verifies the `Cf-Access-Jwt-Assertion` JWT signature against the team's JWKS, the `aud` against `ACCESS_AUD`, and expiry. A missing or invalid token returns 401. The plain `Cf-Access-Authenticated-User-Email` header is never trusted on its own. An empty `ACCESS_AUD` or team domain **fails closed** (every request 401), the same rule as `CLERK_AUTHORIZED_PARTIES`. |
| D3 | **One binding.** `web-admin` binds a service binding `PMS_OPS` to a named entrypoint `OpsEntrypoint` (a `WorkerEntrypoint` class) exported by `pms-core`, and its own static assets. It has **no** D1, DO, KV, R2, queue or secret bindings, and holds no tenant secrets. `pms-core`'s `fetch` never reaches `OpsEntrypoint`; only a Worker with the binding can call it. DO resolution stays in `packages/tenant-router` (`idFromName` lint rule). A unit test reads `apps/web-admin/wrangler.jsonc` and fails on any other binding. |
| D4 | **Operator registry in Platform D1.** New table `operator (operator_id TEXT PK, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, role TEXT CHECK IN ('ops_admin','ops_viewer'), status TEXT CHECK IN ('active','disabled'), created_at INTEGER)`. Rows are retained; disable instead of delete (trigger, like `org`). The verified Access email must match an `active` row, or the request is 403 `not_an_operator`. **Bootstrap:** while the table is empty, an Access-verified email listed in the `OPS_BOOTSTRAP_EMAILS` var becomes the first `ops_admin`, recorded as action `operator.bootstrap`. Once any row exists the var is ignored. |
| D5 | **New actor kind `operator`**: `OperatorActor = { kind: 'operator'; operatorId: string }`, added to `ActorContext`. Not `staff`: in this codebase "staff" means hotel employees (roster, report columns). Audit rows show `operator:<operatorId>`. No `/v1` HTTP path ever produces an operator actor, and `gatePermission` never accepts one for a tenant permission. `OpsEntrypoint` checks the operator's role instead: `ops_viewer` reads, `ops_admin` reads and writes. |
| D6 | **Every write is a command.** Each `OpsEntrypoint` write is in `COMMAND_CATALOG` under the `ops.*` namespace with lane `INTERACTIVE` (they are single D1 batches). Each takes a required `reason` (1–500 characters) and an optional `ticketRef`. Idempotency: the key is `operator:<operatorId>:<clientKey>` and the fingerprint is `{ commandId, payload }`, the same object that is executed. Records live in Platform D1 table `operator_action` (§6). |
| D7 | **The record and the change commit together.** Each D1 write and its `operator_action` row go in one `db.batch()`, which D1 runs as one transaction. Where a command also calls a DO (provisioning, membership), the D1 batch runs first and the DO calls are idempotent replays of `syncOrgAndPropertyDo`, as `provisionProperty` already does. |
| D8 | **No raw SQL path.** The console never sends SQL, and `OpsEntrypoint` has no method that takes SQL or a table name. Break-glass SQL (§4.9 rule 1) stays outside this platform. |
| D9 | **Kill-switch.** A new key `kill:ops.write` (KV, 10-second cache, §6.4) refuses every operator write with `503 ops_writes_disabled`. Reads continue. It is for a suspected operator-credential compromise (§4.9 rule 4). It does not change the tenant kill-switch: org cancel and purge stay tenant routes and stay blocked by it. |
| D10 | **Same kit, same headers.** The SPA uses `@hospai/ui-kit` and `tokens.css` only, under the same lint rules as `web-pms` (`no-raw-controls`, `no-inline-styles`, `no-fetch-in-components`; the plan extends the rule globs to `apps/web-admin`). Every response goes through the shared security-header helper. The plan moves `apps/pms-core/src/security-headers.ts` into a package if needed; there is no second copy. Mutating `/api/*` requests require a same-origin `Origin` header. Desktop only. |

## 4. Stage 1 screens (R7.1)

1. **Customers.** One row per org from the registry: name, org id, status, plan, add-ons, properties used / limit, created. Search by name or id, 50 per page. No DO calls.
2. **Customer detail.** The org's properties (name, id, time zone, jurisdiction, currency, status), plan and add-ons with change buttons, owners (user id and role only), and that org's operator actions.
3. **Hotel detail.** One call, `OpsEntrypoint.getPropertyHealth(propertyId)`, which reads **one** PropertyDO: business date, last night audit (date, status, exception count), oldest outbox row age, room and room-type counts, active member count, schema version. Counts and dates only, with no guest names, amounts or folio rows. The customer list never calls this, so the list never fans out to every DO. Fleet-wide health columns come in R7.3.
4. **Create customer** and **Add hotel** forms (§5).
5. **Operator log.** Every `operator_action` row, filterable by org and operator.
6. **Operators.** List, add, disable (`ops_admin` only).

## 5. Commands (R7.1)

Ten commands, `ops.*`:

| Command | Does | Refuses |
|---|---|---|
| `ops.create_org` | Creates the org row (status `active`) and its subscription on the chosen plan. `orgId` is client-chosen and checked with `validateTenantId`. | Existing org id: 409 `org_exists`, with no fields of the existing org. |
| `ops.add_property` | Calls `provisionProperty` with the operator actor: same id, time zone, currency and jurisdiction validation, the same OrgEntitlementDO slot, and the same cross-tenant rules. | `property_exists` (409, no foreign row), `jurisdiction_conflict`, `limit_exceeded` (422), `tenant_not_active`. |
| `ops.add_org_owner` | Looks up a Clerk user by email (pms-core already holds the Clerk secret) and writes the same owner membership that the bootstrap actor gets today. Stores the user id, not the email. | No such Clerk user: 404 `user_not_found`. The console tells the operator to have the person sign up first. HospAI sends no email in v1. |
| `ops.set_plan` | Updates `subscription.plan_code`. The existing trigger forces an `entitlement_version` bump. | Unknown plan. A downgrade below current use (properties used > new limit): 422 `plan_below_usage`. |
| `ops.set_addon` | Sets `subscription_addon.quantity`; 0 deletes the row. The R3.10 trigger bumps the version. | Unknown add-on. Removing a `+1 property` add-on below current use: 422 `plan_below_usage`. |
| `ops.suspend_org` | Org status `active` → `suspended` (§7). | Any status but `active`. |
| `ops.reinstate_org` | `suspended` → `active`. | Any status but `suspended`. |
| `ops.add_operator` | Inserts an `operator` row. | Existing email: 409 `operator_exists`. |
| `ops.set_operator_status` | `active` ↔ `disabled`. | Disabling the last active `ops_admin`: 409 `last_ops_admin`. |
| `ops.set_operator_role` | `ops_admin` ↔ `ops_viewer`. | Demoting the last active `ops_admin`: 409 `last_ops_admin`. |

**`provisionProperty` change.** Its input takes an `actor` instead of a bare `actorUserId`. For a `user` actor nothing changes: that user becomes an owner, as the bootstrap contract requires. For an `operator` actor, `syncOrgAndPropertyDo` skips `ensureMember`, because an operator is never a member of a tenant. The hotel gets its owner from `ops.add_org_owner`.

**Plan changes are not overrides.** `entitlement_override` (§6.1) stays unbuilt. Every concession the group needs is a plan or an add-on (the pilot's `pos.enabled` and `ai_ops.enabled` are add-on grants). The roadmap line that said R7.1 writes `entitlement_override` is corrected with this spec.

## 6. The record, and the hotel's view of it

New Platform D1 table, append-only (an update or delete trigger aborts):

```
operator_action (
  action_id     TEXT PRIMARY KEY,
  operator_id   TEXT NOT NULL REFERENCES operator(operator_id),
  command_id    TEXT NOT NULL,          -- e.g. ops.set_plan
  org_id        TEXT NULL,              -- NULL only for operator-registry commands
  property_id   TEXT NULL,
  reason        TEXT NOT NULL,
  ticket_ref    TEXT NULL,
  before_json   TEXT NULL,              -- e.g. {"planCode":"growth"}
  after_json    TEXT NULL,              -- e.g. {"planCode":"group"}
  created_at    INTEGER NOT NULL
)
```

`before_json` and `after_json` hold plan codes, add-on codes and quantities, statuses and ids. They hold no emails and no names other than the hotel name the operator typed.

**The hotel sees it.** New org route `get_org_operator_actions`, `GET /v1/orgs/:orgId/operator-actions`, permission `org:read`, no entitlement, kill-switch not applicable (read). It returns that org's rows only, filtered by the **URL** org, newest first, 50 per page. Each row shows the operator's `display_name` ("HospAI support: Sam"), never their email. `web-pms` shows it as a read-only table titled **HospAI account changes** wherever org settings live; the plan names the page. A property-level action (such as R7.5's copy) also lands in that PropertyDO's own audit log through the commands it runs, with the `operator:` actor.

## 7. Suspended

`suspended` is new on `org.status`. The org status trigger gains `active → suspended`, `suspended → active` and `suspended → closing`. A suspended hotel is **read-only, not blacked out** (§6.2 delinquency rule):

- Reads on property and org routes work, so the hotel can still print invoices, export data and see its audit log.
- Every mutating `/v1` route returns **403 `tenant_suspended`**, added once to `commandErrorHttpStatus`. `web-pms` shows a band on every page: "This account is suspended. Contact HospAI." through `classifiedUserMessage`.
- Org cancel stays allowed: a customer can always leave.
- Queued commands replayed while suspended go to the exception queue as `tenant_suspended`, and are not dropped.
- System work continues: night audit, outbox, auth-hold lapse. Stopping the business date with guests in-house would break the stay records.

`assertTenantActive` takes the route's read or write intent from the route definition (method). Read intent passes `active` and `suspended`. Write intent passes `active` only, except `post_org_cancel`, which also passes `suspended`. Property status is unchanged (`active`, `purging`, `purged`); suspension is per org.

## 8. Authorization summary

| Check | Where |
|---|---|
| Access JWT (signature, `aud`, expiry) | `web-admin` Worker, every request |
| Email → active operator, role | `web-admin`, then re-checked in `OpsEntrypoint` from the `operatorId` it is passed, against D1 |
| `ops_admin` for writes | `OpsEntrypoint` |
| `kill:ops.write` | `OpsEntrypoint`, every write |
| Tenant rules (`validateTenantId`, first writer wins, org match, slot) | Inside the commands, the same code the `/v1` routes use |

The console's role check is for the screens only. `OpsEntrypoint` decides.

## 9. Scope out (v1)

- Self-serve sign-up, prices, billing and invoices to hotels (R5.6).
- `entitlement_override` and trial grants.
- Any read of guest, folio, payment or document data, and the §4.9 support grants (R7.3).
- Org cancel and purge from the console (they stay tenant actions).
- Editing a hotel's configuration from the console, other than R7.5's copy into an empty hotel.
- Sending email or Clerk invitations.
- Fleet-wide health columns, alert state, deploy and migration status (R7.3).
- Mobile layouts.

## 10. Tests (R7.1)

Fail-first where marked.

- **Access (fail-first):** no JWT → 401; a JWT with the wrong `aud` → 401; an expired one → 401; a valid JWT for an email with no operator row → 403; empty `ACCESS_AUD` → 401 on every request; the email header without a JWT → 401.
- **Bootstrap:** an empty table plus a listed email creates one `ops_admin` and one `operator.bootstrap` action; a second request after that ignores the var.
- **Roles:** `ops_viewer` calling any write → 403; disabling or demoting the last `ops_admin` → 409.
- **Bindings:** `apps/web-admin/wrangler.jsonc` declares only `PMS_OPS` and assets.
- **Cross-tenant (fail-first):** `ops.add_property` with a property id that exists in another org → 409 `property_exists`, and the body has no other org's id, name or jurisdiction; no membership is written. `ops.create_org` on an existing id → 409 with no fields of that org.
- **Plan:** a Growth org with one property: `ops.add_property` → 422 `limit_exceeded`; `ops.set_plan group` → the retry succeeds; `entitlement_version` went up by one. A Group org with three properties: `ops.set_plan growth` → 422 `plan_below_usage`, plan unchanged.
- **Reason:** every write without `reason` → 422; with it, exactly one `operator_action` row in the same batch; a forced D1 failure leaves neither the change nor the row.
- **Idempotency:** the same key and payload twice → one change and one row; the same key with a different payload → 409.
- **Operator actor:** `ops.add_property` writes no membership for the operator; `ops.add_org_owner` writes the owner, and that user's `/me` works on the new hotel.
- **Hotel's view (fail-first):** org A's `get_org_operator_actions` never returns org B's rows; a user without `org:read` → 403; rows show `display_name` and no email.
- **Suspended (fail-first):** after `ops.suspend_org`, a property GET succeeds, a check-in returns 403 `tenant_suspended`, org cancel succeeds, a queued command replays into the exception queue, and the night audit still runs; after `ops.reinstate_org` the check-in succeeds.
- **Health:** `getPropertyHealth` returns no field that holds a guest name, amount or document number (assert on the key set).
- **Kill-switch:** with `kill:ops.write` set, every write → 503 and reads work.
- **Pins:** `COMMAND_CATALOG` 161; `V1_HTTP_ROUTE_AUDIT` 261 with last id `get_org_operator_actions`; `permissions-check` matches `V1_ROUTES`; `AUDIT_WRITER_COMMAND_IDS` unchanged at 117, because `ops.*` are not PropertyDO commands.

## 11. R7.5 Copy setup from another hotel

Hotels 2–10 have the same owner and mostly the same setup. Re-typing room types, rate plans, packages, charge codes and tax rules per hotel costs days and invites mistakes.

| # | Decision |
|---|---|
| C1 | **One command, `ops.copy_setup`** `{ sourcePropertyId, targetPropertyId, kinds[], reason }`, lane `BACKGROUND`, run as a Workflow with a step per kind. It is the 162nd catalog entry. |
| C2 | **Same org only.** Source and target must share the org in the registry; otherwise 409 `org_mismatch` with no field of either property. |
| C3 | **Empty target only.** The target must have no reservation ever and no rows of any kind being copied; otherwise 409 `target_not_empty`. This makes the copy part of provisioning and not a support write into a live hotel, so §4.9 dual control does not apply. |
| C4 | **Kinds:** room types (definitions only, not rooms, so physical counts stay 0 until the hotel adds its rooms), rate plans and their room-type rates, packages, charge codes, tax rules, product categories and items, and DOMAIN config keys from an explicit allowlist. |
| C5 | **Never copied:** rooms, users, any `SECRET` key, GSTIN and legal name, invoice and receipt series or counters, e-invoicing and POS credentials, bank details, the business date and night-audit schedule. The console shows these as a checklist the operator completes by hand. |
| C6 | **Through the existing commands.** The workflow reads the source through existing read RPCs and replays each item on the target as the command a hotel admin would use: `inventory.add_room_type`, `rates.create_plan`, `rates.update_room_type_rate`, `rates.create_package`, `folio.create_charge_code`, `folio.create_tax_rule`, `products.create_category`, `products.create_item`, `config.put_domain`. The actor is the operator. New ids on the target, with a source-to-target id map so a copied rate plan points at the copied room type. Per-item idempotency key `operator:<operatorId>:copy:<copyId>:<kind>:<sourceId>`, so a failed copy re-runs to completion without duplicates. |
| C7 | **Result.** The console shows counts per kind and each skipped item with its reason. One `operator_action` row for the copy; each replayed command also writes its own audit row in the target PropertyDO. |

**Tests:** cross-org → 409 with no foreign field (fail-first); a target with one reservation → 409; a run killed half-way and re-run ends with exactly one copy of each item; a copied rate plan references the target's room type id; no `SECRET` key, GSTIN or invoice series appears on the target; the target's audit log shows each command with the `operator:` actor.

## 12. R7.3 Operations platform v2 — direction only

Written up as its own spec before it is built:

- **Support access grants** exactly as §4.9: READ self-serve with reason and ticket, up to 60 minutes; WRITE with a second operator's approval, up to 15 minutes, through domain commands only; the tenant sees each grant in its audit log; the kill-switch voids every grant.
- **The solo-operator gap.** WRITE needs a second person. Until HospAI has a second operator, support inside a hotel uses the go-live interim rule: the hotel adds a named HospAI member and removes them when done. §4.9 is not weakened for a solo phase.
- **Fleet health** columns in the customer list from the R7.4 projection and R7.2 alert state, never by calling every DO.
- Deployed version and DO schema version per property (migration orchestrator).
- The weekly access review (§4.9 rule 5).

## 13. AGENTS §6 checklist

- [x] Tenant: `ops.add_property` and `ops.copy_setup` check every body id against the registry; another org's property → 409 with no foreign row. `get_org_operator_actions` filters by the URL org.
- [x] Authz: `OpsEntrypoint` role check; `get_org_operator_actions` has `permission: 'org:read'`; kill-switch: `kill:ops.write` for operator writes, the tenant kill-switch unchanged (§3 D9).
- [x] Catalog: ten `ops.*` commands, lane `INTERACTIVE`; `ops.copy_setup` lane `BACKGROUND` on a real Workflow. One new route in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency: `{ commandId, payload }` fingerprint, key prefixed `operator:<operatorId>`, same object hashed and executed.
- [x] Arrays capped: `kinds[]` at the number of kinds (7) in HTTP and RPC; list pages at 50; JSON through the parse helper.
- [x] `resolvePropertyContext(..., ctx.tenantProperty)`: not applicable; the new route is org-scoped.
- [x] Money: none moved. Inventory: R7.5 creates room types through `inventory.add_room_type`, which owns its ledger writes.
- [x] Errors: new codes `org_exists`, `user_not_found`, `plan_below_usage`, `operator_exists`, `last_ops_admin`, `not_an_operator`, `ops_writes_disabled`, `tenant_suspended`, `org_mismatch`, `target_not_empty`, each added once to the existing status table.
- [x] SPA: `web-pms` adds one read-only table (query key `['org-operator-actions', orgId, page]`) and the suspended band; `web-admin` uses ui-kit only.
- [x] Tests: §10 and §11, fail-first for tenancy and the suspended gate.
- [x] Pins: the slice block at the top.
- [x] No new Settings control.
- [x] Existing specs searched: cross-tenant provision, entitlement catalog, kill-switch, observability. No second design for any of them.

## 14. Open questions

- **Q1 Hostname** for the console (for example `ops.` on the HospAI domain). The user creates the Access application and policy.
- **Q2 Second operator.** Who it is and when. It decides when R7.3's WRITE grants can be used.
- **Q3 Owner invitation.** v1 needs the hotel's admin to sign up first. If that is too awkward for hotels 2–10, a Clerk invitation from `ops.add_org_owner` is a small follow-up.

## 15. Amendment 2026-11-24 — Ops Console with its own Clerk instance

The user decided (2026-11-24): the console is a **separate Vite + React app in the monorepo** with a **separate Clerk instance**. This replaces Cloudflare Access as the sign-in layer. Everything else in §1–§14 stands.

| # | Replaces | Decision |
|---|---|---|
| A1 | D1 name | The app stays at `apps/web-admin` (the name `ARCHITECTURE.md` §11 already uses); its product name is **HospAI Ops Console**. It is a Worker with static assets (Vite build) plus its own `/api/*` handler, as D1 says. |
| A2 | D2 | **Sign-in is a dedicated Clerk instance** ("HospAI Ops"), never the hotel instance. The SPA uses `@clerk/react` with the ops publishable key and sends the session token as `Authorization: Bearer`. On every `/api/*` request the Worker verifies it with `@clerk/backend` `authenticateRequest` against the **ops** instance (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, optional `CLERK_JWT_KEY`) with `authorizedParties` from `CLERK_AUTHORIZED_PARTIES`. An empty `CLERK_AUTHORIZED_PARTIES` or missing Clerk config **fails closed** (401 on every request), the same rule as pms-core. A hotel-instance token fails verification because the keys differ. |
| A3 | D2 hardware key | **Second factor required.** The Worker reads the session token's `fva` claim (factor verification age) and refuses a session whose second factor was never verified (`fva[1] < 0` or missing) with 401 `mfa_required`. The user enables MFA (passkey or authenticator) and restricts sign-up to an allowlist in the ops Clerk dashboard. Cloudflare Access in front of the hostname remains an optional extra layer; nothing depends on it. |
| A4 | D3 | Bindings in `wrangler.jsonc` are still only `PMS_OPS` (service binding to `OpsEntrypoint`) and `assets`, and the bindings test still holds. The Worker now holds **one class of secret: the ops Clerk instance's keys**. It holds no tenant secret and no hotel-instance key. |
| A5 | D4 | `operator` gains `clerk_user_id TEXT UNIQUE NULL`. A request resolves the operator by `clerk_user_id`. When no row has that id, the Worker fetches the Clerk user once (ops Backend API) and passes its **verified** primary email to `OpsEntrypoint.resolveOperator`, which links an `active` row with that email and a null `clerk_user_id` (action `operator.link`). An unverified email never links. Bootstrap works as D4 says, keyed by the same verified email, and stores the `clerk_user_id` on the new row. |
| A6 | D10 | `Origin` check unchanged. The first-party client is Bearer, as in `web-pms`. |
| A7 | local dev | With `HOSPAI_UNSAFE_LOCAL=1` and `OPS_ALLOW_DEV_OPERATOR=1`, an `x-dev-operator: <email>` header stands in for Clerk (the same gate shape as pms-core's `x-dev-actor`). Both flags are absent from the staging and production wrangler envs, and a test asserts that. |

**Tests that replace the Access tests in §10:** no token → 401; a token from another Clerk instance (wrong key) → 401; a token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES` → 401; empty `CLERK_AUTHORIZED_PARTIES` → 401 on every request; no second factor → 401 `mfa_required`; a valid token for a user with no operator row and no matching verified email → 403 `not_an_operator`; an unverified email never links; the dev header is ignored unless both local flags are set.

**What the user sets up:** the ops Clerk instance (application, MFA on, sign-up restricted), its keys as `wrangler secret put` on `web-admin`, `CLERK_AUTHORIZED_PARTIES` and `OPS_BOOTSTRAP_EMAILS` vars, and the hostname (Q1).

**Build notes (R7.1 part 1, 2026-11-24):**
- `OPS_BOOTSTRAP_EMAILS` is a plain var on **pms-core** (read by `OpsEntrypoint.resolveOperator`), not on `web-admin`.
- `kill:ops.write` is read from KV uncached on each write. KV's minimum `cacheTtl` is 30 seconds, so D9's 10-second cache is not possible, and operator writes are rare.
- `operator_action` also stores `idempotency_key` (unique) and `request_fingerprint`, so a replay is one lookup inside the same batch rule (D7).
- §7 "intent from the route method" has one refinement: a non-GET route that only reads declares `readIntent: true` on its route definition (reservation search, guest search, guest batch, the read-only copilot message). A suspended hotel keeps those, so names still resolve on its screens. No route that changes state may set it.
- Customer detail shows no currency: the registry does not store one. `listOperators` is `ops_admin` only, like the Operators screen.
