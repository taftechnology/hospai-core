# Full codebase audit — remediation brief

**Date:** 2026-09-04
**HEAD:** `461d391` (`main`)
**Scope:** whole monorepo — ~123k lines of TS/TSX. Two monoliths: `apps/pms-core/src/property-do.ts` (~20,545 lines) and `apps/pms-core/src/v1-dispatch.ts` (~8,960 lines).
**Method:** eight review passes on this HEAD (correctness verification of the Sept 3 audit, then quality, security, business logic, UX, UI, performance, CI/test net). Line numbers below are as of `461d391`. Re-read the cited site before editing; do not treat a drifted line as a reason to skip the finding.

**Predecessors**

- [`2026-08-15-full-codebase-audit.md`](2026-08-15-full-codebase-audit.md) — original 32 items; most money/authz/copy items are **fixed**. Do not reopen them.
- [`2026-09-03-full-codebase-audit.md`](2026-09-03-full-codebase-audit.md) — N1–N14. Ten confirmed, four partial, none refuted as a whole. This brief **supersedes the suggested order** in that file because later passes found a cross-tenant critical (S1) and an AR-never-posts critical (L1).

This document is the implementer contract. Take **one vertical at a time**. Do not cherry-pick Low items from a later vertical while Criticals in earlier ones are open.

---

## How an implementing agent should work

### Ground rules

1. **One vertical per change-set.** Finish, test, and commit the vertical before starting the next. A vertical may be several commits if the plan splits tasks; do not mix Vertical 1 files with Vertical 11 files in one PR.
2. **Locked decisions are not optional.** If this brief says “post AR on COMPANY receivable” or “never `ensureMember` on another org”, do that. Do not bounce A/B/C back to the human. Do not “document the bug away” when a code fix is specified.
3. **Characterization tests first** on Verticals 1 and 3. Write the test that fails on `461d391`, then change production code until it passes. Do not invert the test to match today’s broken behaviour.
4. **Do not extract folio/payments/reservations from `PropertyDO`.** Housekeeping already shows `moduleTxnCtx`. Extraction is an architecture decision with a named trigger, not a fix for any item here.
5. **Do not add Playwright, Cypress, Redis, Storybook, occupancy pricing UI, dark mode, or a second design kit.** Smoke stays the existing `smoke-staging.mjs` Worker contract.
6. **Do not restyle `apps/web-pms/src/styles.css` as a product fix.** Adopt ui-kit primitives. Tokens, IBM Plex, sage primary stay. Sign-in may keep its marketing column; do not copy its shadows into `AppShell`.
7. **Do not rename** `handle*` / `try*` / route ids / command ids / camelCase JSON. Those tiers already hold.
8. **Do not relax a `check:*` gate.** If a gate fails, the change is wrong or the pin in this brief must be updated in the same commit (catalog length, schema head, night-audit steps). There are **15** `check:*` scripts in CI, not 17 (the Sept 3 write-up drifted).
9. **Do not add husky / a pre-commit hook** until Verticals 1 and 3 characterization tests exist. A hook will not catch S1.
10. **Work in-place on `main`** unless the human named a branch. Push only when asked.

### Catalog heads (must stay true unless the vertical intentionally changes them)

| Pin | Value at `461d391` | Where it is asserted |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | `packages/contracts/src/register.test.ts:751` |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) | `register.test.ts:748` + `scripts/permissions-check.mjs` |
| `PROPERTY_SCHEMA_HEAD` | **34** | `packages/do-runtime/src/migrate.test.ts:637` |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'`; no `AUTO_EXTEND` | `apps/pms-core/test/night-audit-auto-extend.spec.ts:288` |
| `check:*` scripts in CI | **15** (each with `--self-test`) | `.github/workflows/ci.yml` `checks` job |

If a vertical adds a command, route, or migration, update the pin **in the same commit** and extend `V1_HTTP_ROUTE_AUDIT` / `COMMAND_CATALOG` / a new `PROPERTY_MIGRATIONS` version. `permissions-check.mjs` requires `V1_ROUTES` ids to match the audit list.

### Local verification (every vertical)

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm test:local
# pms-core shards: 8, matching CI. Do NOT put `--` before --shard.
# pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
```

`pnpm test` unsharded on pms-core is unsafe (workerd / shared queue). Prefer `pnpm test:local`. After a focused vertical, also run the specs named in that vertical’s **Verify** section.

### Spec / plan (if this repo’s reviewer workflow is in force)

Write a spec under `docs/superpowers/specs/` only if the human (or reviewer) started a vertical that way. The spec must paste the **Locked product call** from this brief verbatim. Plan tasks must name the failing test file first for Verticals 1 and 3.

---

## What is already good (do not “fix”)

- **Authorization choke point.** `dispatchV1` is the single gate. `permission` is type-required on org/property routes. 141/144 routes scoped; 3 unscoped (`post_orgs` bootstrap + 2 `dev` behind `HOSPAI_UNSAFE_LOCAL`) are correct.
- **SQL injection.** Identifiers are constants or regex-gated; user data is bound.
- **DO atomicity.** Zero `await` inside `transactionSync`. `runIdempotent` `Sync<T>` makes async `execute` a compile error.
- **Crypto primitive.** Envelope AES-GCM, per-subject data keys, shred + blind-index delete on guest erasure. The defect is **one platform master key** (N6), not the algorithm.
- **Availability is a ledger.** Book/modify/cancel/no-show adjust `availability_day` in one `transactionSync`. Do not change that to a reservation scan.
- **held vs sold.** `held` is always 0 (Phase 3). Pending and confirmed increment `sold`. Inquiry does not.
- **B1 checkout.** `tryCheckOut` uses guest-window balance only. Direct-bill COMPANY charges must not block the guest. The AR hole is **L1**, not a regression of B1.
- **B2 / B4.** Modify honors `ratePlanId`. Bad cancel policy throws `InvalidCancelPolicyError`.
- **Payments algebra.** Capture requires authorized; refund capped; amounts integer. Do not loosen.
- **E1 / E2 / E4 / E5 copy.** `classifiedUserMessage` honours fallback; domain codes have desk copy; credit override only if `balanceMinor > 0`; queued-command labels exist.
- **XSS today.** Guest names/comments are React text. No `innerHTML`. CSP (N5) is defence-in-depth, not a current XSS incident.
- **Dev routes on staging.** No `UNSAFE_LOCAL` / `ALLOW_DEV_ACTOR` in staging vars.

### August 2026 items — still fixed, do not reopen

| ID | Status |
|---|---|
| B1, B2, B4 | Fixed |
| B3 | **Partial** — DO has `applyNoPostIfPresentSync`; HTTP PATCH still omits `noPost`. SPA uses front-office. If you touch guest PATCH, add `noPost`; do not invent a second path. |
| C1 | Replay logs `provisional.actor.userId` on all five paths. The remaining hole is **X2** (replay still skips permission). |
| C2, C3 | Socket cap 50; handshake echoes literal `front-office` subprotocol. |
| D1 | Closed `CommandError` union. |
| E1, E2, E4, E5 | Fixed. E3 still partial (Folio `<p>`). |
| F3 | `staleTime` 60s, `refetchOnWindowFocus` false. Keep. |
| G1 (Aug) | Typed `V1_ROUTES` + single `dispatchV1`. |
| H1, H2 | Staging deploy exists; `test:coverage` exists (but see G5). |

### Rejected — not defects

| Candidate | Why |
|---|---|
| Open org bootstrap `POST /v1/orgs` | Spec’d as authenticated create. Dangerous **because of S1 + N4**, not by itself. Keep bootstrap; fix S1 and restore azp. |
| Client-chosen property IDs | `validateTenantId` is the tenancy contract. First-writer-wins is inherent. S1 is the missing **org match**, not ID format. |
| 60s permission / entitlement cache | Documented Phase-1 tradeoff until KV projection. Leave it. |
| `held === 0` | Architecture Phase 3. |
| Plan-scoped restriction rows unused | Locked unused in the rate-plans spec. |
| Occupancy pricing | Not a product. Rates are flat per night. |
| Authenticated bootstrap as “authz hole” | See S1/N4. |
| Extracting PropertyDO for quality or speed | Explicitly out of scope for every vertical. |
| Virtualizing the 7-day tape | `content-visibility` is enough. Cap UI window at 14 before a virtualizer. |
| Playwright as first e2e | Use existing smoke. |
| 80% coverage gate on PropertyDO | Suite is sharded because workerd dies, not because coverage is the goal. |
| Promoting unused `LinkButton` | Kit cannot depend on the router. `Link` + `ui-link-btn` is the contract. |
| `toHaveLength(144)` extra pin | `permissions-check.mjs` already matches dispatch to the audit list. |
| `confirmBy` / `expiresAt` per-reservation override | Lifecycle spec allows it. Config max applies only when the client omits the field. SPA does not send `confirmBy`. Not a cap bypass. |
| Invoice required when `gen_mode` is Automatically | Working as configured. Surprising default, not a defect. |
| Demo seed using production commands | Intentional. Do not add a parallel seed API. |
| `HOSPAI_UNSAFE_LOCAL=1` alone | Does not 500; does not expose `execSqlForTest` over HTTP. Fail-closed on that flag is hardening, not an incident. |
| AUTO_TRANSFER skipping ambiguous COMPANY windows | Night-audit halt policy: all-or-nothing **per step**. Ambiguous windows are skipped on purpose. The AR hole is L1 (desk never posts), not this skip. |

---

## Global sequence (do in this order)

| # | Vertical | IDs | Why this slot |
|---|---|---|---|
| 1 | Cross-tenant provision | S1, S3, G1 | Critical isolation break. Any other work is unsafe to ship while this is open. |
| 2 | Clerk azp + security headers | N4, N5, G12, S5, N12 | Absent controls. N4 amplifies S1. Small diffs. |
| 3 | Direct-bill city ledger | L1, L2, L3, L4, U8, G2, G10 | Critical money. Guest checks out; AR never posts. |
| 4 | Guest / roster property scope | S2, S7 | Property-scoped `guests:read` decrypts the org guest book. |
| 5 | Per-org master key | N6 | Platform blast radius. Comment lie first if the HKDF work slips a day. |
| 6 | Desk freshness + tape cache | U1, U2, U3, Q5, G6, P2, P4, G9 | Clerk cannot trust Arrivals after check-in. Same SPA query-key contract. |
| 7 | Night audit clock + room charges | N1, L5, L7, L8, G3, P6 | DST fires audit early; one missing rate fails the hotel. |
| 8 | Bounded bulk + idempotency | N3, X1, P5, N10, Q11, N2, S6, Q3 | Uncapped INTERACTIVE arrays (rates, rooms, folio.split, roster `kinds`); payload-only fingerprints. |
| 9 | Kill-switch, replay, degraded, R2 | S4, X2, N7, X3 | Remaining authz / availability of the safety apparatus. |
| 10 | HTTP error contracts | Q1, Q2, Q6, Q7, Q8, Q9, Q10 | Same meaning, three status codes. Do this before adding routes. |
| 11 | Operator SPA (UX + UI) | U4–U17, I1–I15, E3, Q4, Q18, Q19, L12 | After money and isolation. Overlapping IDs: do each pixel once. |
| 12 | Request cost | P1, N8, P3, P7, P9, P10, P12 (P8/P11 keep; P13 cap-14 if touching tape) | Prefetch is mechanical; do not skip `assertTenantActive`. |
| 13 | CI / coverage / lint baseline | G4, G5, G7, G8, G11, N9 | After characterization tests exist. |
| 14 | Hygiene, cash/FX, architecture write-down | N11, N13, N14, Q12–Q22, L6, L9–L11, L13 | Named early-departure is a **new command**, not a silent checkout change. |

---

## Vertical 1 — Cross-tenant provision (S1, S3, G1)

**Severity:** S1 critical · S3 medium · G1 high (test gap)

### Locked product call

If `getProperty(input.propertyId)` returns a row whose `orgId !== input.orgId` → **409** with **no property row in the body**. Never call `syncOrgAndPropertyDo` / `ensureMember` on another org. Same-org idempotent re-provision (jurisdiction matches) may still sync. Jurisdiction mismatch on the **same** org may keep `jurisdiction_conflict` but **must not** return `existing` (S3). Prefer error `property_exists` or keep `jurisdiction_conflict` with a body that has **no** `orgId`, `propertyId`, `name`.

### Evidence

`apps/pms-core/src/provision.ts:58–88`:

1. `getProperty` is **global** (not scoped to URL `orgId`).
2. If found and jurisdiction matches, `syncOrgAndPropertyDo(existing)` uses `existing.orgId` (victim).
3. `ensureMember(actorUserId, 'owner')` on that OrgDO (`INSERT`, `ON CONFLICT DO NOTHING`). No rank check.

`apps/pms-core/src/v1-dispatch.ts:1331–1332` returns `existing` on `jurisdiction_conflict`.

Attack: admin with `property:provision` on org A posts `propertyId` of a victim property and a matching jurisdiction → becomes owner of org B.

### Files

- `apps/pms-core/src/provision.ts` — org match before sync.
- `apps/pms-core/src/v1-dispatch.ts` — HTTP 409 body: no identifiers.
- `apps/pms-core/test/tenancy.spec.ts` — today asserts `second.existing?.jurisdiction` (encodes S3). Change that assertion in this vertical.
- `apps/pms-core/test/auth.spec.ts` — org-create takeover only; **not** this threat model.

### Implementation

1. After `const existing = await getProperty(...)`, if `existing && existing.orgId !== input.orgId`, return `{ ok: false, error: 'property_exists' }` (or equivalent named code). Do **not** include `existing`.
2. Only then handle same-org jurisdiction conflict / idempotent sync.
3. Strip `existing` from every HTTP mapping of these errors.

### Tests (write these so they fail on main, then fix)

| Case | Expect |
|---|---|
| Org A actor, `property:provision`, body `propertyId` = org B’s property, matching jurisdiction | 409; victim OrgDO membership unchanged (actor is **not** owner/member of B). |
| Same, mismatching jurisdiction | 409; body has no `orgId` / `propertyId` / `name`. |
| Same org + same `propertyId` + same jurisdiction (today’s happy re-provision) | 200, unchanged. |
| `tenancy.spec.ts` library path | Stop asserting `existing.jurisdiction` on the leaky payload. |

### Verify

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tenancy.spec.ts test/auth.spec.ts
```

Graft PR must not stay green. `setupCompanyWindowAtZeroBalance` is unrelated — do not touch it here.

### Out of scope

Guest list SQL (S2). Clerk azp (N4). City ledger.

---

## Vertical 2 — Clerk azp, headers, CSRF, smoke JWT (N4, N5, G12, S5, N12)

**Severity:** N4/N5 high · S5 medium · N12 low · G12 medium (test gap)

### Locked product calls

- Restore `CLERK_AUTHORIZED_PARTIES` in `apps/pms-core/wrangler.jsonc` `env.staging.vars` to the live staging origin. Do **not** allowlist `*`.
- Give smoke a token that carries `azp`, or run smoke against an origin that is on the list. Reopen **Lock 4** in the staging-deploy-smoke design doc if it is still checked while the var is absent.
- When `CLERK_AUTHORIZED_PARTIES` is empty, **do not omit** `authorizedParties` from Clerk options in a way that disables azp. Fail closed in staging/production (refuse to authenticate) rather than skip the check. Tests/local may keep an explicit unsafe path behind `HOSPAI_UNSAFE_LOCAL` only.
- One header helper on `/v1` **and** the SPA HTML: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `Strict-Transport-Security`, CSP `default-src 'self'` with Clerk origins in `connect-src`/`script-src`. Include `Permissions-Policy` (at least `camera=()`, `microphone=()`, `geolocation=()`) — Sept 3 grepped it and found zero hits. Report-only CSP first is acceptable if Clerk origins are uncertain; ship enforce in the same vertical once the set is known.
- Mutating `/v1`: require `Authorization: Bearer` **or** validate `Origin` against the authorized parties. SPA already sends Bearer (`packages/client-core` transport). Cookie-only POST is the CSRF hole (S5).
- Smoke JWT: `echo "::add-mask::$JWT"` before `GITHUB_OUTPUT`. Move secret expansions to `env:` (N12).

### Evidence

- `apps/pms-core/src/auth.ts` — empty parties → omit `authorizedParties`; Clerk skips azp. Removed in `9a40338`.
- `apps/pms-core/src/index.ts:107–115` — HTML `cache-control` only. Zero CSP/HSTS/XFO/nosniff in repo at audit time.
- `auth.ts:88` — cookie session accepted with no Origin check.

### Tests

- Staging-shaped env with empty `CLERK_AUTHORIZED_PARTIES` must **not** authenticate a token as if azp were off (G12). `auth.spec.ts:189` today never sets/asserts parties.
- Token with wrong `azp` → 401; SPA origin token → 200.
- API 200 and SPA `index.html` both carry the header set.

### Out of scope

Per-org HKDF (N6). Provision graft (Vertical 1 must already be done).

---

## Vertical 3 — Direct-bill city ledger (L1, L2, L3, L4, U8, G2, G10)

**Severity:** L1 critical · L2/L3/L4 high · U8 high (desk lie) · G2 high (test encodes the unreachable path)

### Locked product calls

1. **Close-at-zero cannot be the AR gate for a COMPANY receivable window.** Post city-ledger charge when the COMPANY window is **transferred into** and/or when the stay **checks out**, for the current posted receivable. Pick one primary trigger and use the other as catch-up; do not require `balance === 0` before the first AR post.
2. Keep a stable charge id for the **first** post of that window.
3. **L3:** reopen must not leave AR stuck at the first close amount. Add a **delta / adjustment** city-ledger entry on later close, not a second identical charge and not a silent `alreadyPosted` skip that drops new charges.
4. **L2:** reject transfer if the source line already has a `TRANSFER_REVERSAL` (already transferred). Destination id must not allow the same source onto two COMPANY windows.
5. **L4:** on transfer, **copy existing tax amounts** (same as split `allocate`). Do **not** reverse TAX and `stampTaxForChargeSync` at today’s rules.
6. **U8:** until AR actually posts, toast must not imply city ledger was updated. After the post path exists: “Charge transferred” is honest only if the post ran; otherwise “Moved to company folio”.
7. **Keep** `setupCompanyWindowAtZeroBalance` as a **hook unit** (close-when-zero). **Add** the desk path beside it: transfer ROOM to COMPANY, then close or checkout, then `readCityLedgerAccount` shows the charge.
8. **G10:** after the named post path exists, extend `smoke-staging.mjs` with **one** COMPANY transfer + close (or checkout) assertion. Keep the rest short (orgs → property → book → check-in → check-out). Do not add night audit or tape batch to smoke. Wire this in the same vertical or immediately after; deploy (G4) still does not grow Playwright.

### Evidence

- `property-do.ts:14614` — any window `balance !== 0` → `WINDOW_BALANCE_DUE` **before** `postCityLedgerChargeSync`. COMPANY receivable cannot be zeroed from the desk: payments / `tryAddFolioLine` hit GUEST.
- `postCityLedgerChargeSync` (`:19453`) — night-audit catch-up only considers already-CLOSED windows.
- Transfer dest id includes destination window (`:15537`) — no “already transferred” guard.
- `:19469–19478` — any existing charge short-circuits forever.

### Tests (fail on main today)

| Case | Expect |
|---|---|
| COMPANY window with ROOM only (non-zero), transfer-then-close **or** checkout | City-ledger charge row + account total = receivable. Not 422 `WINDOW_BALANCE_DUE` unless you name a transitional code in the spec — **do not** ship 422 as the product. Locked: post AR. |
| Same source line transferred to two COMPANY windows | Second transfer 422 named code; one AR debit. |
| Close $X, reopen, add charges, close | AR moves by the delta, not stuck at $X. |
| Transfer after tax-rule change | Folio tax still ties (copied amounts). |
| `folio-transfer-split.spec.ts` | Assert `readCityLedgerAccount` / charge rows, not only folio lines. |

Do **not** “fix” `city-ledger.spec.ts:36–85` by making the zero-balance helper the only close path.

### SPA

Folio transfer success copy in `FolioScreen` (U8). No board work here (Vertical 6).

### Verify

```bash
pnpm --filter @hospai/pms-core exec vitest run test/city-ledger.spec.ts test/folio-transfer-split.spec.ts test/folio-windows.spec.ts test/reservations-check-out-direct-bill.spec.ts
```

B1 tests must stay green (guest window still gates checkout). Direct-bill checkout must **also** require CL posting now.

### Out of scope

Named early-departure (L6). Night-audit `RateMissingError` (L5).

---

## Vertical 4 — Guest and roster property scope (S2, S7)

**Severity:** S2 high · S7 medium

### Locked product call

OrgDO as the PII vault is correct (erasure). **Listing and search behind `guests:read` on a property URL must only return guests with a stay at that property.** Org-wide CRM belongs on an **org** route with `org:manage` (or a new `guests:org_read`). Do not document S2 away as “chain CRM” while the URL is `/v1/properties/:id/guests`.

Roster: same pattern — property-gated `roster:read` must not decrypt org-wide staff, **or** move org-wide roster behind `org:manage` and stop advertising it as a property route. Do not leave the URL saying property and the SQL saying org.

### Evidence

`apps/pms-core/src/org-do.ts:2248–2276, 2320–2338` — `propertyId` used for `gatePermission` only; SQL has no stay/property filter.

Reservation search is already property-scoped. Guest CRM search uses blind index **without** property filter.

### Tests

Two properties, same org. Guest stayed only at hotel B. `GET /v1/properties/{hotelA}/guests` and guests-search with `guests:read` on A → guest **absent** (and not decryptable in the payload). Hotel B list includes them.

`guests-routes.spec.ts` is single-property happy path today — add the isolation case.

### Perf note

Do **not** “fix” S2 by decrypting the whole org faster (P11). Filter first, then decrypt the page.

---

## Vertical 5 — Per-org master key (N6)

**Severity:** high (supersedes Aug C5)

### Locked product call

1. **Today:** correct `apps/pms-core/src/env.ts` comment — `HOSPAI_ORG_MASTER_KEY` is the **platform** master key, present in production/staging, not Vitest-only.
2. **This vertical:** HKDF the platform key over `orgId` for both envelope wrap (`org-do.ts:282–296`) and blind-index HMAC. Add `key_version` on `data_key` (existing rows version 0). Rotation path can be follow-up; the column must exist.
3. Two orgs, same plaintext → different ciphertext **and** different blind-index hashes. Shred org A; org B still decrypts.

Optional same vertical: AES-GCM `additionalData: piiKeyId` (N14 AAD). Free; do it if you touch `PiiVault.encrypt`.

`packages/crypto-shredding` has `vitest` but **no** `test:coverage` script — CI `test:coverage` skips it (G5). Add `test:coverage` in Vertical 13; still run `pnpm --filter @hospai/crypto-shredding test` in this vertical.

---

## Vertical 6 — Desk freshness and tape cache (U1, U2, U3, Q5, G6, P2, P4, G9)

**Severity:** UX high · perf high for P2/P4

### Locked product calls

- Check-in, checkout, confirm-pending, assign-room: `invalidateQueries` with prefix `['board']` in `onSuccess`. **Do not** depend on WebSocket for the screen the clerk just changed. WS remains for other tabs/users.
- Confirm-pending: stop invalidating `['arrivals']`. Board queries are `['board', mode, …]` (`BoardScreen.tsx:408–431` vs `:131`).
- Check-in primary button: disable for `TERMINAL_STATUSES` **and** already in-house; say why. Today only the comment editor is disabled (`CheckInScreen.tsx:164–226`).
- `FrontOfficeLive.tsx:135`: `setQueryData` must use the **same** key as `TapeChartScreen` (`['front-desk-tape', propertyId, from, to]`). Then **do not** invalidate tape on every delta; invalidate `['board']` only from live (P2).
- Chunk `postGuestsBatch` at 50 in the client (Tape/Board/Directory), same as HTTP search. API already 400s at 51 (`v1-dispatch.ts:3479`). Unchunked tape → “Name pending” for everyone (P4).

### Tests (fail on main)

- `CheckInScreen.test.tsx` — spy `invalidateQueries`; expect `['board']`.
- `BoardScreen.test.tsx` — confirm-pending invalidates `['board']`, not `['arrivals']`.
- `FolioScreen` checkout — invalidate `['board']` as well as reservation.
- `FrontOfficeLive.test.tsx` — `setQueryData` key equals tape query key (today it locks invalidate-all).
- TapeChart: posts refs in chunks of 50.

SPA tests mock `../client.js` — that is enough for cache-key contracts. Do not start Playwright.

### Related

Q5 is the same bug as U1 confirm path. I5 (board titles) waits for Vertical 11 unless you are already in `BoardScreen.tsx` — then you may fix I5 in the same file: Arrivals/Departures/In house titles must match the route, not all say “Front Desk” with subtitle “arrivals and departures”.

---

## Vertical 7 — Night audit clock and room charges (N1, L5, L7, L8, G3, P6)

### Locked product calls

**N1.** Replace `zonedWallTimeToEpochMs` (`property-do.ts:1542`) with the two-pass fixed point already used by `zonedMidnightMs` (`:1049`). Delete one of the two. Ambiguity: spring-forward gap → round **forward** to the next real instant; fall-back overlap → pick the **first** occurrence.

**L5 / P6.** `postRoomChargesSync` must **catch per reservation**. One `RateMissingError` must not abort the hotel’s ROOM posts. Hoist `assertChargeCodeSync` out of the per-row loop if it is invariant for the night. Failed reservations become step exceptions / queue — hotel continues.

**G3.** `night-audit-room-charges.spec.ts` case 17 (`:115–132`) **expects FAILED + zero lines** and `:134–136` expects `ROLL_BUSINESS_DATE` still COMPLETED. **Rewrite case 17 in this PR**, not before. A skip-and-continue policy will fail CI until that test matches the new invariant.

**L7.** When `auto_no_show === false`, do **not** post ROOM for confirmed-not-arrived. `processNoShowsSync` returning early is not enough; `postRoomChargesSync` still selects `confirmed` with `arrival <= businessDate`.

**L8.** Expire pending on `confirm_by` (or null+arrival). Night audit must not expire pending solely because `arrival_date <= businessDate` while `confirmBy` is still future.

### N1 verify table (no DST tests exist today)

| Zone | Date | Requested | Policy |
|---|---|---|---|
| `America/New_York` | 2026-11-01 | 02:00 | First occurrence (fall back) |
| `America/New_York` | 2026-03-08 | 02:00 | Next real instant after the gap |
| `Europe/Berlin` | 2026-03-29 / 2026-10-25 | 02:00 | Same policies |
| `Pacific/Chatham` | 2026-09-27 | 02:00 | Next real instant after DST start (audit reproduced 01:00) |
| `Australia/Lord_Howe` | 2026-10-04 | 02:00 | 30-min DST |
| `America/New_York` | 2026-07-01 | 02:00 | Exact |

Default `auditTime` is `02:00` — worst wall-clock for these transitions.

### U4 (if touching NightAuditScreen)

Alert on error/success. When Run is disabled because `businessDate >= today`, show why. Full U4 is Vertical 11; do not leave a silent button if you are already in that file.

---

## Vertical 8 — Bounded bulk, JSON parse, idempotency (N3, X1, P5, N10, Q11, N2, S6, Q3)

### Locked product calls

- HTTP **and** DO: cap `rates.bulk_update` `updates.length`, `rooms.bulk_update_status` `updates.length`, and `folio.split` array. Also cap roster `kinds` on create/patch (`v1-dispatch.ts:2102`, `:2155`) — Sept 3 N3 called out these as the other uncapped `Array.isArray` bodies. Return `422 limit_exceeded` (or existing named code) above the cap. Pick a documented number (rates: 90-day × room-type bound, low thousands; rooms status: same order as a house count; split: small, e.g. 20; `kinds`: small enum-sized, e.g. 16). Re-assert inside `tryBulkUpdateRates` / `tryBulkUpdateRoomStatus` / split RPC.
- Catalog vs runtime (Q11): `rates.bulk_update` and `rooms.bulk_update_status` are **BULK** in catalog, `touchInteractive()` at runtime. **`night_audit.run` is BACKGROUND** in catalog and also `touchInteractive()`. `bulkDeadline()` is **never** called in production. **Either** honour the catalog lane **or** change the catalog to INTERACTIVE until chunking exists. Do not leave the lie. Prefer **cap + INTERACTIVE** for bulk arrays in this vertical unless you implement real bulk chunking. Night audit staying INTERACTIVE is acceptable if you update the catalog to match; do not pretend it is BACKGROUND.
- Wrap `request.json()` once → `400 invalid_json` on parse failure (`index.ts` currently rethrows as bodiless 500). 82 handlers blind-cast; helper first, zod-per-route later.
- Idempotency fingerprint = `SHA-256(canonicalJson({ commandId, payload }))` at the single construction site (`packages/contracts` `commandEnvelope` already has `commandId`). Alias surface is **six** routes, not four: cancel, confirm (no `ratePlanId`), no-show, cancel-check-in, **plus check-in/out when optionals omitted**.
- Prefix idempotency keys with `userId` at the DO boundary (S6) so operator B cannot replay A’s cached 200.
- **Q3:** fingerprint the **exact** object sent to the DO. Sort `constituentRoomTypeIds` once and reuse that array in `tryCreateRoomType` / `tryUpdateRoomType`. Same key + different array order must not fork state.

### Tests

- `updates` length `cap+1` → 422 on HTTP and on stub RPC.
- Same `Idempotency-Key`, `/cancel` then `/no-show` → `409 idempotency_key_reused`, not 200 echoing cancel.
- `POST /v1/orgs` body `{` → 400, not 500.
- Virtual room type: key reused with swapped constituent order → replay or 409, not a second semantic write.

SPA is safe (`stableKeyForOperation`). Public API is the exposure.

---

## Vertical 9 — Kill-switch, provisional replay, degraded mode, R2 (S4, X2, N7, X3)

### Locked product calls

- **S4:** `checkKillSwitch` runs only when `entitlementForRoute` is set. Membership mutations may stay up during a kill-switch (so you can add staff). **`post_org_cancel` and `post_org_purge` must not.** Add an explicit kill-switch check. Do not fold cancel/purge into `pms.core` entitlement just to reuse the helper.
- **X2:** Replay actor is `system`, which `gatePermission` short-circuits. Re-check the **original** actor’s permission at replay. C1 only threaded `userId` into logs. Revoked staff must not execute queued check-in / folio post.
- **N7:** Extend `PROPERTY_DO_TRANSPORT_ALLOWLIST` (and the org twin) against Cloudflare DO errors: overload, eviction, storage internal, cannot-resolve. The two files are not byte-identical (naming only) — deduplicate into one module. Move the test sentinel behind `assertUnsafeLocal`. Table-driven test per string.
- **X3:** Missing `EVENT_LOG_R2` must not retry forever. DLQ / fail the consumer with a terminal error. Distinct from N13 (test DLQ noise **with** R2 present).

---

## Vertical 10 — HTTP error contracts (Q1, Q2, Q6, Q7, Q8, Q9, Q10)

### Locked product calls

- **One** `commandErrorHttpStatus` table. `entitlement_required` → **402** everywhere (today 422 / 503 / 402). `not_member` → **404** `not_found` everywhere (reservation writes today 422).
- Domain failures always `{ ok: false, error }`. Gates keep bare `{ error }`. Do not invent a third envelope. Auth `message` stays on the auth gate only.
- `readGuest` returns `DECRYPT_UNRESOLVED` like the batch path — not a thrown 500.
- Membership `catch { return forbidden }` (`org-do.ts:981, 1065, 1247, 1314`): catch **typed** errors only; otherwise `INTERNAL_ERROR`. Storage bugs must not become 403.
- Extract `finishPropertyDoInvoke` for the 72 copied epilogues (`kind === 'response'`, FORBIDDEN → 403, not_member → 404). Reservation family forgot the last two — that is how Q2 exists.

Do this **before** adding new routes so they cannot copy the wrong mapper.

---

## Vertical 11 — Operator SPA: UX + UI (U4–U17, I1–I15, E3, Q4, Q18, Q19, L12)

Do overlapping IDs **once**. U5 = I6. U11 ⊂ Q4/Q19/I7. U7 = L12.

### Locked product calls (order inside this vertical)

1. **I1** — `RateCell`: `Field` label via `VisuallyHidden` (Guests search already does this). Matrix is numbers again. `RatesScreen.tsx:157–186`.
2. **I2 I4 I5** — Sidebar brand is `<p>`, not `<h1>` (`AppShell.tsx:283`). Board `h1` matches route (Arrivals / Departures / In house). Every PageHeader subtitle uses live `property.name`. Delete hardcoded “The Meridian Seattle” on Staff/Roster/Exceptions/Guests.
3. **I3** — One Dialog from `.app-modal`. Migrate `Card role=dialog`, Guest erase, Exceptions native `<dialog>` (zero CSS today). Focus first control; Escape closes. Do **not** add a fourth overlay. `window.confirm` on folio/staff/roster waits for Dialog.
4. **U4 U5/I6 U6** — Night-audit Alert + disabled reason. Print CSS: **only** `.reg-card` (today hides chrome but not folio/check-in). Never print `reservation.roomId` UUID. Confirm before Void.
5. **U7 / L12** — Hide Booking settings keys that pms-core never reads: `same_day_bookings`, `same_day_cutoff`, `require_prepayment`, `booking_date_change`. Do not leave inert toggles. Wiring them is a **different** product spec — hide until wired.
6. **U17** — If departure is still future at checkout: warn “Checkout does not release remaining nights — shorten the stay first.” **Do not** silently change `departure_date` here (that is L6, Vertical 14).
7. **U11 E3 Q4 Q18 Q19 I7 I8 I9** — CityLedger / Staff / Inventory through `classifiedUserMessage` (no `JSON.stringify(err.classified.body)`, no `` `Request failed (${c.class})` ``). Folio mutation message → `Alert`. **Also** Shift close and BoardGroup: still bare `<p>` (Q18). Room Plan fail-closed → `Alert` (not `div.error`). Statement / exceptions payload → not raw JSON. Tenders → `DataTable`. `EmptyState` + `Skeleton` on directories. Void `intent=destructive`.
8. **U9 U10 U12–U16 I10–I15** — HK Assign label: “Assignment only — use Status for clean/dirty.” Book types FAIL_CLOSED: disable Hold/Quote/Confirm. Night-audit `STEP_LABELS` (halt copy: review failed step, Retry, then Resume). Guest list: name only (id in title/`data-testid`). Book search: “Searching…” / “No guests match”. Exceptions error ≠ filter empty. Permission miss: toast “You don’t have access to that page,” not silent redirect to Arrivals. **Roster:** nav and `PermissionRoute` require `roster:write` (`nav.ts:25`, `App.tsx:64`), so `roster:read`-only staff never see the page — gate nav on `roster:read` (write still required for mutations). Search `aria-label`. One visually-hidden class (`ui-visually-hidden`). Unwrap nested `.ui-table-scroll` around `DataTable`. VIP/DND `Badge`. Back copy without `←`. Distinct roster icon. Folio back: not always “← In house”.
9. **I13 MFA copy** — Keep sign-in marketing column. Drop the sentence “Use the demo user.” (`SignInScreen.tsx:125`). Do not copy sign-in shadows into AppShell.

### Do not

Restyle the 1,943-line stylesheet. Rebuild sign-in. Add occupancy colors. Extract housekeeping kit (it already imports this one). Checkbox opacity 0.55: one-line follow to button disabled token, bundle with I9.

### Tests

`HousekeepingScreen.tsx` is a thin host — module tests exist. Add `registration-card` print/CSS test and `front-office-editor` with this vertical (G11). RateCell test: no visible “Rate for {code}” in the cell.

---

## Vertical 12 — Request cost (P1, N8, P3, P7–P13)

### Locked product calls

- **P1 / N8:** `resolvePropertyContext(ctx, id, ctx.tenantProperty)` on **every** property handler. Inside the helper, pass the row already fetched (`property`) into `assertTenantActive` / `resolvePropertyFromRegistry`, not `validatedPrefetch` (usually undefined). Do **not** skip `assertTenantActive`. Do not add Redis. `/me` is already correct (`v1-dispatch.ts:3431`); copy that third argument everywhere.
- **P3:** Reservation name search must not load 200 reservations then decrypt guests in 50s. Use `guest_blind_index` or drop name-mode and keep exact reservation id. Debounce is not a cap.
- **P7:** Folio mount: keep folio/reservation/payments/me. Defer rooms, charge-codes, fx, city-ledger, domain-config until the matching card is used. `ledgerRows` `useMemo`: derive `tenderPayments` / `chargeCodes` **inside** the memo (today they are new every render). `invoice` `gcTime: Infinity` is a sentinel, not a leak — leave it.
- **P8:** Arrivals fetching departures+in-house is the combined Front Desk page — **keep**. Do not copy that trio onto Tape.
- **P9:** `lazy()` admin cluster only: Settings, Rates, Inventory, Staff, Roster, Exceptions, Night audit. Desk routes stay eager.
- **P10:** `QueuedCommandsPanel` `refetchInterval` 1000 only while `entries.length > 0` (or subscribe).
- **P11:** `listGuests` sequential decrypt of the **page** is expected. Keep the LIMIT. Do not parallelize across the org (that is S2). Profiler-only if you touch OrgDO decrypt.
- **P12:** Self-host IBM Plex woff2 in `apps/web-pms/public`. Tokens stay IBM Plex.
- **P13:** Tape DOM is rooms × days. `content-visibility:auto` is already on rows. Default window is 7 days. If you touch the tape range picker, **cap the UI window at 14** before adding a virtualizer. 90-day HTTP max is the API, not the chart.

### Tests

Ratchet: property handlers pass the third argument to `resolvePropertyContext` (G8). `dispatch-registry-dedup.spec.ts` today measures **GET /me** only — extend to one mutating route or a grep gate.

Do not raise the 90-night availability cap. Do not parallelize org-wide decrypt.

---

## Vertical 13 — CI safety net (G4, G5, G7, G8, G11, N9)

Characterization tests from Verticals 1, 3, 6 must already exist.

### Locked product calls

- **G4:** `staging-deploy.yml` must require a **green CI run on that SHA** (`workflow_run` on success, or an explicit test job). `smoke:staging` **on by default**; input still overridable. No Playwright. No husky until G1/G2 exist.
- **G5:** `test:coverage` include web-pms `src/**/*.tsx` (today `*.ts` only — screens invisible). Add `"test:coverage": "vitest run --coverage"` (or equivalent) to `@hospai/crypto-shredding` so CI actually runs those tests. **No** coverage threshold on `@hospai/pms-core` until shards report JSON.
- **G7 / N9:** Turn on `eslint:recommended` + `no-floating-promises` at error. **Do not add** `hospai/no-id-from-name-outside-tenant-router` — it **already exists** (11 custom rules, not 6). Delete dead `PiiVault.preparePiiRecord` `scope`/`subjectId` or use them. Ten packages `"lint": "echo ok"` — at least stop claiming typed lint where there is none.
- **G8:** Prefetch third-arg ratchet (if not done in Vertical 12).
- **G10:** money-path smoke lives in Vertical 3 once L1 has a named post. This vertical only ensures deploy cannot skip CI.
- **G11:** registration-card + front-office-editor tests belong with Vertical 11; `guest-row.tsx` is covered via board tests — do not start Playwright to close this. `HousekeepingScreen.tsx` is a thin host; module tests exist.
- **Shard topology:** local `scripts/test-pms-core-shards.mjs` is 8 shards and **includes** ledger property specs. CI `test-pms-core` excludes them into `test-pms-core-ledger-prop`. Do not drop the isolated ledger job or un-exclude those files into the noisy shards.

`@hospai/observability` `"test": "echo ok"` is Low — do not promote.

---

## Vertical 14 — Remaining hygiene, cash/FX, named early-departure, architecture

### L6 — unused nights after check-in (high product gap, not a silent bugfix)

**Locked:** Keep ARCHITECTURE §7.1 (`sold` includes covering `checked_out` nights). **Do not** release inventory inside `tryCheckOut`. Add an **explicit early-departure command**: set `departure_date` to `businessDate` (or +1 per hotel rule), `releaseSoldNightsSync` remaining nights, then check out. Until that ships, U17 warning is the clerk contract.

This is a **new command** — bump `COMMAND_CATALOG` + HTTP audit in the same commit.

### B3 — `noPost` on HTTP PATCH (partial from August)

DO `applyNoPostIfPresentSync` exists. HTTP guest PATCH still omits `noPost`. SPA uses front-office, so this is latent for the public API. If this vertical (or any guest PATCH touch) lands, add `noPost` to the HTTP body; do not invent a second path.

### L9–L11, L13 (medium)

- Shift expected cash in **ledger** currency, not txn amount ignoring FX.
- Unattributed cash date in **property timezone** / `businessDate`, not `date(created_at/1000,'unixepoch')` UTC.
- Partial FX refunds use `allocate` LAST, not `Math.round` ratio.
- Far-future OOO: reject or extend horizon so type-level book sees **blocked**, not “no row”.

### Q12–Q22, N11, N13, N14

- Import `freeAvailability` from `@hospai/contracts` in `event-consumer.ts` **and** `handleGetAvailability` fallback (`v1-dispatch.ts:8838`). Delete inlined copies.
- Wire `@hospai/temporal-utils` or delete the package. Stop a third date library. Test specs: one `addCalendarDays` (`test/date-helpers.ts`); `check:pms-core-test-dates` does not ban helper duplication today.
- One ARI projection module; one `FRONT_DESK_LIST_SELECT` used by arrivals/departures/in-house (`frontDeskSelect` at `property-do.ts:10581` is unused by those lists).
- Document idempotency: body vs `x-idempotency-key` per route (Q16). First-party client matches; public API will not guess.
- Amend ARCHITECTURE §11: no `apps/edge/`; domain **may** import `@hospai/contracts`; index-only is a lie until a lint rule exists. Record PropertyDO-as-module **or** extract-on-trigger. Make `module-manifests-check.mjs` enumerate `modules/pms/*` and fail on missing manifest.
- Outbox/idempotency sweep (N11) when §10.1 lands — both tables, index `outbox(acked, seq)`.
- N13: DLQ depth assertion on a suite that should drain, or per-file queues. Do not ignore 684 DLQ moves as “green”.
- N14: three property routes skip tenant-active (`get_property`, `get_registry_property`, `get_property_availability`) — decide and comment. 1,943-line `styles.css` is a **watch item** (no-Tailwind, class-denylist already exists), not a restyle project.
- Q21 comments: `fingerprintPayload` “never call from a DO” vs three calls in `property-do.ts`; `property-migrations.ts` header still says Phase 0 freeze-gate at v34.
- Q22 dead export surface: `mapCommandEntitlement`, `mergeContext`, `killKvKey`, `generatePiiKeyId`; `preparePiiRecord` unused `scope`/`subjectId` (also N9). SPA `.stack` vs `.ui-stack` — pick one. `@hospai/observability` `"test": "echo ok"` stays Low.
- A1 leftover: `lane-guard.spec.ts:45` unscoped `outbox.deferred`.
- N14 supply-chain: `pnpm audit --audit-level high` on the `checks` job. CodeQL / dependency-review / secret scanning are optional follow-ups, same Low bucket.

### X4 (low)

Org invite distinguishable 422s (`no_such_user` vs `email_ambiguous` vs 201) enumerate Clerk emails. Collapse to one code for `org:manage` if you touch invites.

---

## Finding index

Use this to jump. **Primary vertical** is where the work lands; duplicates are the same defect.

| ID | Sev | Title | Vertical |
|---|---|---|---|
| S1 | critical | Re-provision grafts caller as owner of another org | 1 |
| S3 | medium | `jurisdiction_conflict` leaks `existing` / `orgId` | 1 |
| G1 | high | No cross-org graft test; 409 test encodes leak | 1 |
| N4 | high | Staging Clerk azp disabled | 2 |
| N5 | high | No CSP/HSTS/XFO/nosniff | 2 |
| S5 | medium | Cookie session, no Origin on POST | 2 |
| G12 | medium | No empty-`authorizedParties` test | 2 |
| N12 | low | Smoke JWT unmasked in `GITHUB_OUTPUT` | 2 |
| L1 | critical | Direct-bill AR never posts | 3 |
| L2 | high | Same line → two COMPANY windows | 3 |
| L3 | high | One CL charge per window forever | 3 |
| L4 | high | Transfer restamps tax | 3 |
| U8 | high | Transfer toast implies AR posted | 3 |
| G2 | high | Zero-balance helper masks desk path | 3 |
| G10 | medium | Smoke has no COMPANY transfer/close | 3 |
| S2 | high | `guests:read` lists org-wide PII | 4 |
| S7 | medium | `roster:read` org-wide staff PII | 4 |
| N6 | high | One platform master key; comment says Vitest-only | 5 |
| U1 | high | Check-in does not invalidate `['board']` | 6 |
| U2 | high | Checkout does not invalidate `['board']` | 6 |
| U3 | high | Check in enabled for terminal stays | 6 |
| Q5 | high | Confirm invalidates `['arrivals']` | 6 |
| P2 | high | WS `setQueryData` wrong tape key | 6 |
| P4 | high | Tape guest batch unchunked (cap 50) | 6 |
| G6 G9 | med | SPA tests would not catch U1/P2/P4 | 6 |
| N1 | medium | Night audit DST wall-clock one-pass | 7 |
| L5 | high | One missing rate fails whole hotel | 7 |
| L7 | medium | `auto_no_show=false` still posts ROOM | 7 |
| L8 | medium | Audit expires pending on arrival vs `confirmBy` | 7 |
| G3 | high | Case 17 locks fail-whole-hotel | 7 |
| P6 | high | POST_ROOM_CHARGES O(in-house) one txn | 7 |
| N3 | medium | `rates.bulk_update` uncapped INTERACTIVE | 8 |
| X1 | medium | `rooms.bulk_update_status` same | 8 |
| P5 | high | Also `folio.split` uncapped; roster `kinds` uncapped | 8 |
| Q11 | medium | Catalog BULK/BACKGROUND vs `touchInteractive()`; `night_audit.run` included | 8 |
| N10 | medium | 82 unvalidated `request.json()` → 500 | 8 |
| N2 | medium | Idempotency not command-scoped (6 routes) | 8 |
| S6 | medium | Idempotency key per-property not per-user | 8 |
| Q3 | high | Virtual type fingerprint sorts; command does not | 8 |
| S4 | medium | Kill-switch skipped on cancel/purge | 9 |
| X2 | medium | Provisional replay skips permission | 9 |
| N7 | medium | Degraded allowlist six substrings | 9 |
| X3 | medium | Missing EVENT_LOG_R2 retries forever | 9 |
| Q1 | high | `entitlement_required` is 402/422/503 | 10 |
| Q2 | high | `not_member` 404 vs 422 | 10 |
| Q6 | high | Guest decrypt GET 500 vs batch Result | 10 |
| Q7 | high | Membership catch-all → forbidden | 10 |
| Q8 Q9 Q10 | med | Four mappers, 72 epilogues, two envelopes | 10 |
| U4–U17, I1–I15, E3, Q4, Q18, Q19, L12 | mixed | Desk pixels and copy; U16 roster nav write-gate; I13 drop “demo user” MFA copy | 11 |
| P1 N8 | high/med | Prefetch unused (1/144 routes) | 12 |
| P3 | high | Name search decrypts up to 200 guests | 12 |
| P7 P9 P10 P12 | med | Folio fan-out, eager screens, poll, fonts | 12 |
| P8 | — | Keep combined Front Desk fetch | 12 (no change) |
| P11 | — | Keep page-scoped sequential decrypt | 12 (no change) |
| P13 | — | Cap tape UI at 14 if touching range; do not virtualize 7-day | 12 |
| G4 G5 G7 G8 G11 N9 | mixed | Deploy vs CI, coverage, lint | 13 |
| L6 | high | No early-departure command | 14 |
| B3 | medium | HTTP PATCH omits `noPost` (DO has it) | 14 |
| L9–L11 L13 | med | Shift cash FX, cash date TZ, refund allocate, OOO horizon | 14 |
| Q12–Q22 N11 N13 N14 X4 | low–med | Dates, ARI, comments, sweep, DLQ, AAD, invite enum | 14 |

Sept 3 **N8** is the same defect as **P1** (prefetch). **N9** idFromName sub-claim is **refuted** — rule exists; remaining N9 is eslint recommended (Vertical 13). **N3** catalog-says-INTERACTIVE was wrong; runtime INTERACTIVE + uncapped still holds.

---

## Test-gap cheat sheet (what CI will not catch today)

Write these **in the vertical that fixes the product**, not as a standalone “more tests” PR except G1/G2 which may land as failing tests at the start of Verticals 1 and 3.

| Defect | Would tests catch a regression? | Why |
|---|---|---|
| S1 graft | **No** | `auth.spec.ts` / `tenancy.spec.ts` never use victim `propertyId` under attacker org |
| S3 leak | **Partial** | Test **asserts** `existing.jurisdiction` |
| N4 azp | **No** | Clerk path mocked; no `authorizedParties` |
| S2 guests | **No** | Single-property list |
| L1 AR | **No** | Helper nets COMPANY to 0 before close |
| L2/L3 transfer→CL | **No** | Folio lines only |
| L5 rate-missing | **Inverted** | Case 17 expects hotel-level FAILED |
| U1/U2/Q5 board | **No** | Client mocked; no `invalidateQueries` spy |
| P2 tape key | **No** | Tests invalidation prefixes, not `setQueryData` key |
| P4 chunking | **Partial** | HTTP 51 → 400; SPA unchunked untested |
| P1 prefetch | **Partial** | `/me` only |
| G10 smoke AR | **No** | Book → check-in → check-out only |

Well-tested (do not weaken): availability ledger, idempotency replay, FAIL_CLOSED / `degraded-mode.spec.ts`, B1 guest-window checkout.

HTTP routes with weak/absent spec coverage (Low): `get_provisional_exceptions`, `get_housekeeping_assignments` GET, `get_shift`, `put_shift_close`. Not a reason to delay Vertical 1.

---

## Architecture note (not a code defect)

~90% of PMS domain lives in `PropertyDO` (216 async methods). `modules/pms/*` except housekeeping are predicates only. `module-manifests-check.mjs` enumerates directories that **already** have a manifest, so four modules are invisible.

**Locked write-down (Vertical 14):** either “PropertyDO is the reservations/folio/rates module until a **named** extraction trigger” or “fail CI on `modules/pms/*` without a manifest.” Current silence is the problem. Do not extract in these remediations.

---

## Appendix — verification commands

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm test:local

# After Vertical 1
grep -n "ensureMember" apps/pms-core/src/provision.ts
# Cross-org existing property must not reach ensureMember

# After Vertical 2
grep -n "CLERK_AUTHORIZED_PARTIES" apps/pms-core/wrangler.jsonc
grep -n "Content-Security-Policy\|X-Frame-Options\|Strict-Transport-Security" apps/pms-core/src/index.ts

# After Vertical 12
# Expect call sites to pass third arg:
# grep -c "resolvePropertyContext(ctx, propertyId)" apps/pms-core/src/v1-dispatch.ts
# should trend toward 0 in favour of tenantProperty prefetch

node scripts/module-manifests-check.mjs --self-test
```

---

## Completeness vs source reviews (2026-09-04 re-check)

Cross-checked against: Sept 3 N1–N14, Sept 4 verification canvas (X1–X4 + corrections), quality Q1–Q22, security S1–S7, business L1–L13, UX U1–U17, UI I1–I15, performance P1–P13, CI G1–G12, and still-open August items (C5/F1/H4 absorbed; B3 partial; A1 leftover; E3 partial).

**IDs with a vertical:** N1–N14, X1–X4, S1–S7, L1–L13, Q1–Q22, U1–U17, I1–I15, P1–P13, G1–G12, E3, B3, A1 leftover.

**Absorbed (do not treat as extra work):** August C5 → N6; F1 → N8/P1; H4 → N14; August G1 (typed routes) is **fixed** and must not be confused with CI G1 (S1 test gap).

**This re-check added to the brief** (were in canvases, missing or underspecified in the first draft):

| Gap | Where it now lives |
|---|---|
| G10 smoke has no AR path | Vertical 3 |
| Roster `kinds` uncapped (`v1-dispatch.ts:2102`, `:2155`) | Vertical 8 (N3 sibling) |
| `night_audit.run` catalog BACKGROUND vs `touchInteractive()` | Vertical 8 (Q11) |
| U16 roster nav gated on `roster:write` | Vertical 11 |
| I13 MFA “Use the demo user.” | Vertical 11 |
| Q18 Shift close + BoardGroup still `<p>` | Vertical 11 |
| P8 / P11 keep; P13 cap-14 | Vertical 12 |
| `Permissions-Policy` on the header helper | Vertical 2 |
| N1 Chatham DST row | Vertical 7 table |
| `check:*` is 15 not 17; no husky until G1/G2; CI ledger shard isolation | Ground rules + Vertical 13 |
| Q22 named dead exports; N14 CSS watch + CodeQL Low | Vertical 14 |
| B3 HTTP `noPost` | Vertical 14 |
| Rejected: `confirmBy` override, invoice `gen_mode`, demo seed, `UNSAFE_LOCAL`, AUTO_TRANSFER skip | Rejected table |

**Intentionally not promoted** (hunters filed, reviewer rejected): Playwright/Cypress; 80% DO coverage; tape virtualizer as High; unused `LinkButton` / skip-link; extra `toHaveLength(144)` pin; extracting PropertyDO; Redis; Storybook; occupancy UI; restyle tokens.

---

## Document control

- **Audience:** implementing agent (and reviewer). Product owner reads the global sequence and locked calls.
- **Source canvases** (session artefacts, not committed): quality, security, business logic, UX, UI, performance, CI, Sept 4 verification of N1–N14.
- **This file does not implement anything.** It is the queue. Start at Vertical 1.
