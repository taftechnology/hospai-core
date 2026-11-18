# Entitlement catalog, packaging v1 — design

**Slice:** roadmap R3.10. **Date:** 2026-11-18. **Status:** accepted for build.

Lands the authorised feature table in [`ARCHITECTURE.md` §6.7](../../../ARCHITECTURE.md#67-package-composition) as keys, plans, add-ons and seed, and makes the ten-property ceiling a real hard limit. Billing, Stripe, plan self-serve and add-on purchase stay in **R5.6**.

## 1. Decisions (locked)

1. **`FEATURE_KEYS` = every row of §6.7, exactly** — 22 keys, in table order:
   `pms.core`, `pms.properties.limit`, `pms.units.limit`, `pms.multi_property`, `pms.housekeeping`, `payments.enabled`, `booking_engine.enabled`, `booking_engine.custom_domain`, `channel_manager.enabled`, `channel_manager.connections.limit`, `agentic_distribution.enabled`, `revenue_mgmt.enabled`, `ai_ops.enabled`, `ai_ops.messages.limit`, `mcp.enabled`, `mcp.clients.limit`, `pos.enabled`, `banquet.enabled`, `api.public_access`, `sso.saml`, `compliance.fiscalization`, `accounting_export.enabled`.
   `FeatureKey` stays the literal union (never `| string`). `PLATFORM_SEED_FEATURE_KEYS` lists the same 22; `check:entitlements` keeps them equal.

2. **Feature types.** `*.limit` keys are `LIMIT`. `payments.enabled` is `CONFIG` (values below). Every other key is `BOOLEAN`.

3. **Values.**
   - BOOLEAN: `'true'` where §6.7 has ✅. A plan with — has **no row** (absent = not granted).
   - LIMIT: the number as text; **∞ is `'unlimited'`**. `parseFeatureValue('LIMIT', 'unlimited')` returns the string `'unlimited'`; in `EntitlementSnapshot.limits` an unlimited limit is `Number.MAX_SAFE_INTEGER` (JSON-safe, compares correctly). — means no row.
   - `payments.enabled` (CONFIG): Starter `'required'`, Growth and Group `'enabled'`. "Required" means enrolment in payments is a condition of the tier. **Enforcing enrolment is R4.7** (live acquiring): no enrolment record exists before it, so this slice records the value and does not refuse anything on it. R4.7 must read it.
   - `ai_ops.messages.limit` is metered `soft` and add-on only: no plan row.

4. **Plans — three, no Enterprise.** `starter` (tier 1), `growth` (tier 2), `group` (tier 3). `PlanCode` = `'starter' | 'growth' | 'group'`. Plan feature rows follow §6.7 columns exactly, e.g. Starter `pms.properties.limit '1'`, `pms.units.limit '40'`, `channel_manager.connections.limit '3'`, `mcp.clients.limit '1'`; Growth `1 / 400 / 15 / 5`; Group `10 / unlimited / unlimited / unlimited`.

5. **Existing D1 rows move.** Seeds are `INSERT OR IGNORE`, so the old Starter 20 / Growth 100 unit limits would survive on any existing database. A new platform migration (`0006_entitlement_catalog.sql`, plus the same statements in `platform-migrations.ts`) inserts the new features, plans, plan rows and add-ons, and **updates** the two existing unit-limit rows to 40 and 400. Idempotent on re-apply. Existing subscriptions keep their plan.

6. **Add-ons — catalogue, plus the per-org rows the resolver reads.** New D1 tables:
   - `addon (code PK, name, feature_key REFERENCES feature(key), kind CHECK IN ('grant','increment','metered'), amount INTEGER NULL)` — seed one row per add-on cell of §6.7: increments (+1) on `pms.properties.limit`, `channel_manager.connections.limit`, `mcp.clients.limit`; grants on `booking_engine.custom_domain`, `revenue_mgmt.enabled`, `ai_ops.enabled`, `pos.enabled`, `banquet.enabled`, `sso.saml`; metered on `ai_ops.messages.limit`.
   - `subscription_addon (org_id REFERENCES org(org_id), addon_code REFERENCES addon(code), quantity INTEGER NOT NULL CHECK (quantity >= 1), PRIMARY KEY (org_id, addon_code))`.
   Nothing in the product writes `subscription_addon` yet (R5.6 sells add-ons); tests insert rows directly. Changing it must bump `subscription.entitlement_version` (a trigger, like the plan-change invariant) so a cached snapshot cannot outlive it.

7. **Resolution** (`OrgEntitlementDO.resolveEntitlements`): plan rows, then add-ons for the org — a grant sets the boolean `true`; an increment adds `amount × quantity` to a numeric limit (an `'unlimited'` limit stays unlimited; an increment on an absent limit starts from 0); a metered add-on adds the key to `limits` with behavior `soft` and no cap. `snapshot.features` carries **every** resolved key (today it drops all but two). Limits keep behavior `hard` except the metered one.

8. **`pms.properties.limit` is enforced, hard, at the OrgEntitlementDO.**
   - In `provisionProperty`, on the **new property** path only (an existing same-org property id is a replay and does not count), after the org row exists and before `insertProperty`: `OrgEntitlementDO.reservePropertySlot(orgId)`.
   - The DO keeps a **standing** counter (not the monthly `meter_counter` period), initialised on first use from the D1 count of the org's properties. It reads the limit from a **fresh D1 resolve**, never from the KV snapshot, then checks and increments inside one `transactionSync`. Serialising in the org's own DO is what stops two concurrent provisions from both taking the last slot.
   - If `insertProperty` then fails, release the slot (decrement). At the cap: HTTP **422 `limit_exceeded`** (the existing status for that code), body `{ error: 'limit_exceeded', featureKey: 'pms.properties.limit' }`, no registry row, no DO sync.
   - Starter and Growth therefore allow one property; Group ten; each `+1` add-on one more.
   - `pms.units.limit`, connection and client limits are **not** newly enforced here (their consumers are other slices); this slice only makes their values correct.

9. **Default plan unchanged.** A new org is still Starter (`createOrg` / `upsertOrg`). Tests and seeds that create two properties in one org move that org to Group with `seedSubscription(env, orgId, 'group')` — never by loosening the limit.

## 2. Out of scope

Billing, prices, Stripe, plan or add-on purchase UI, plan changes from the SPA (all R5.6); enforcing payments enrolment (R4.7); enforcing units, channel connections, MCP clients, AI messages (their slices); any gate on a feature key other than `pms.core` — the keys exist so those slices can gate.

## 3. Tests (acceptance)

- Contracts: `FEATURE_KEYS` has the 22 keys in order; `FeatureKey` rejects an unknown string at compile time (existing compile-time test pattern); `check:entitlements` passes.
- Seed: each plan resolves to exactly its §6.7 column (one table-driven test per plan); a database seeded with the old 20 / 100 rows reads 40 / 400 after migration.
- Add-ons: Group with no add-on → properties limit 10; with `properties +1 × 2` → 12; Starter with the `revenue_mgmt` grant → `revenue_mgmt.enabled: true`; inserting or changing a `subscription_addon` row bumps `entitlement_version`.
- Ceiling: Starter org — first property 201, second 422 `limit_exceeded` with no registry row and no foreign or internal fields; replaying the first property id still 200/201 (does not count). Group org — ten succeed, the eleventh is refused. Two concurrent creates for the last slot — exactly one succeeds. A failed insert after reservation leaves the count unchanged.
- No regression: every existing spec green; specs that need two properties per org seed Group.
