# HospAI — agent coding contract

This file is the engineering contract for **every** AI agent and human that changes this repo. It applies to **new features** and **edits to existing code**, not only to the 2026-09-04 audit punch list.

If a user instruction conflicts with a product decision, the user wins. If convenience conflicts with this file, **this file wins**. Do not “fix” a rule by documenting the violation.

Normative architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Product queue (prototype parity): [docs/roadmap.md](docs/roadmap.md) — take the first unchecked slice, then the next. Open defects: [docs/audit/2026-09-04-full-codebase-audit.md](docs/audit/2026-09-04-full-codebase-audit.md). SPA chrome: [`.cursor/rules/spa-page-chrome.mdc`](.cursor/rules/spa-page-chrome.mdc).

---

## How to work in this repo

1. Read the locked product call before inventing an alternative. Do not bounce A/B/C when a lock already exists (architecture, a spec under `docs/superpowers/specs/`, the audit brief, or the roadmap slice). **Search specs before writing a new one** — ARI KV, purge, money-ops DAMAGE, booking wizard, tape/board, guest CRM directory, cashiering, and housekeeping already have accepted specs.
2. Prefer a **failing characterization test**, then production code, for tenancy, money, inventory, and authz. Do not encode today’s broken behaviour as `expect(…)`.
3. Do **not** extract folio, payments, or reservations out of `PropertyDO` unless a named architecture trigger lands in `ARCHITECTURE.md`. Housekeeping’s `moduleTxnCtx` is the pattern when extraction is actually decided.
4. Do **not** add Playwright, Cypress, Redis, Storybook, occupancy-pricing UI, Tailwind, shadcn/Radix imports, a second design kit, or a screen-by-screen visual rewrite of `apps/web-pms/src/styles.css`. Appearance changes go through tokens (`tokens.css`) and `packages/ui-kit` styles. Dark mode exists **only** as the token theme under `prefers-color-scheme` (2026-10-29 shadcn re-skin) — no per-screen dark rules. The sidebar-footer theme switch (System / Light / Dark) is a per-browser `localStorage` preference (`hospai.theme`), not a Settings key.
5. Do **not** rename `handle*` / `try*` / route ids / command ids / camelCase JSON. Those tiers already hold.
6. Do **not** relax a `check:*` gate, skip hooks, or add `it.skip` / `it.only`.
7. Verify with `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. Never put `--` before `--shard` (pnpm then treats `--shard` as a file filter). Unsharded `pnpm test` on pms-core is unsafe.
8. If you add a command, HTTP route, or PropertyDO migration, update the pins in the **same commit** (see [Catalog and schema pins](#catalog-and-schema-pins)).
9. Push only when asked. Work on `main` unless a branch was named.

**Reviewer sessions** (`.cursor/rules/reviewer-role.mdc`): do not write product code, specs, or plans in that session. Still **reject** any change that violates this file.

---

## Naming (do not churn)

| Layer | Convention | Example |
|---|---|---|
| Route id | `snake_case`, verb-first | `post_reservation_check_in` |
| URL path | kebab-case under `/v1` | `/check-in`, `/city-ledger` |
| Command id | `namespace.action` | `reservations.check_in` |
| Event type | `entity.past_tense` | `reservation.status_changed` |
| HTTP handler | `handle*` | `handlePostReservations` |
| DO command | `try*` | `tryCheckIn` |
| JSON wire | camelCase | `roomTypeId`, `balanceMinor` |
| Error code | `snake_case`, one field | `no_availability` — no parallel `code` key |
| Money | integer minor units | `balanceMinor` |
| Dates | stay/business calendar types | not naked `Date` across RPC |

---

## 1. Tenancy and authorization

**URL org/property is the tenant. Body ids are data, not ownership.**

When adding or changing any path that accepts a `propertyId` / `orgId` in the **body** while the URL names a different tenant:

- After `getProperty` / `getOrg` (those lookups are **global** primary keys), require `existing.orgId === urlOrgId` (or the equivalent). On mismatch: **409** (or 404 if you are hiding existence) with **no** foreign row in the JSON (`orgId`, `propertyId`, `name`, jurisdiction of the other tenant).
- Never call `ensureMember` / `syncOrgAndPropertyDo` / stub resolution on an org that is not the URL org.
- First-writer-wins on client-chosen ids is the tenancy contract (`validateTenantId`). Do not “fix” that by generating ids unless a spec says so.

**Permission on a property URL means property-scoped data.** OrgDO may store the vault (erasure). List, search, batch, and decrypt behind `guests:read` / `roster:read` on `/v1/properties/:id/…` must filter to stays/staff **at that property**. Org-wide CRM belongs on an **org** route with an org permission (`org:manage` or a new `*:org_read`). Do not document the mismatch away.

**Every new `org` / `property` HTTP route** must declare `permission` on the route def (type-level on `V1RouteDef`) and be added to `V1_HTTP_ROUTE_AUDIT`. `dispatchV1` is the only choke point — do not add a second dispatcher or a handler wired outside `V1_ROUTES`.

**Replay / queues:** if a command was queued as a user, replay **re-checks that user’s permission**. A `system` actor must not skip `gatePermission` for staff-initiated work.

**Kill-switch:** may leave membership mutations up. Must block **org cancel and purge**. Do not fold lifecycle into `pms.core` entitlement just to reuse a helper. New un-entitled mutating routes must say explicitly whether the kill-switch applies.

**Authn:** staging/production must set `CLERK_AUTHORIZED_PARTIES` and pass `authorizedParties` into Clerk. An empty list must **fail closed**, not omit the option (omitting disables `azp`). Mutating `/v1` requires `Authorization: Bearer` **or** a validated `Origin`. Do not accept cookie-only POST as the SPA contract — the first-party client is Bearer.

**Every HTTP and SPA HTML response** goes through one header helper: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, HSTS, CSP `default-src 'self'` (Clerk origins in `connect-src`/`script-src`), and a tight `Permissions-Policy`. New response paths (downloads, WebSocket upgrade failures, error HTML) must use the same helper.

**PII / events:** events carry `guest_ref` / `pii_key_id`, never plaintext names. Do not add name fields to the event bus. Master key material is a **platform** secret; new crypto must HKDF over `orgId` and version keys — never “one hex wraps every org” and never comment it as test-only if it is in wrangler/secrets.

**Idempotency (new writes and fingerprint changes):**

- Fingerprint **must** include `commandId` (or `routeId`) plus payload. Payload-only fingerprints alias distinct commands that share a shape (`{ reservationId }` on cancel vs no-show vs check-in).
- Keys are **per user** at the DO boundary, not only per property.
- The object you fingerprint **is** the object you send to the DO. If you sort an array for the hash, send that same sorted array (virtual room-type `constituentRoomTypeIds`).
- Document per route whether the key is JSON `idempotencyKey` or `x-idempotency-key`. Do not invent a third place. First-party client and public API must match. Representative routes (including `post_reservation_early_depart` → header **`x-idempotency-key`**, same as check-out) are listed in `docs/superpowers/specs/2026-09-05-early-depart-cash-fx-hygiene-design.md` §Q16.

---

## 2. Money, inventory, and night audit

**Money is integers.** Splits, transfers, tax allocation, and FX partials use `allocate` (last-unit remainder). Do not `Math.round` a ratio in a new money path.

**Availability is a ledger.** Book, modify, cancel, no-show, OOO, and oversell adjust `availability_day` in the same `transactionSync` as the reservation. **Never** count overlapping reservations to answer capacity — including a Dashboard occupancy widget. Compose `get_front_desk_summary` / `availability_day` reads that already exist. Import `freeAvailability` from `@hospai/contracts` — do not inline `physical - blocked - held - sold + oversell`. `held` stays 0 until Phase 3; **wizard Hold is `PENDING` (`sold++`)**, not the `held` column. Inquiry does not increment `sold`.

**Checkout** uses the **guest** window balance only. Direct-bill COMPANY balances must not block the guest. COMPANY receivable **must post city-ledger AR** on transfer-into and/or checkout — **not** only on close-at-zero (a receivable window cannot reach zero from the desk if payments hit GUEST).

**Folio transfer / split (new behaviour must preserve):**

- A source line transfers **once**. Reject if a `TRANSFER_REVERSAL` already exists. Destination identity must not allow the same source onto two COMPANY windows.
- Transfer is **windows on the same stay**. Cross-reservation transfer is `transfer_cross_reservation` — do not “fix” that to match the prototype.
- Transfer **copies existing tax amounts** (same as split). Do not reverse TAX and restamp at today’s rules.
- Reopen + more charges + close again must post an **AR delta**, not skip forever on “charge already exists” and not duplicate the original charge.

**Damage deposit** is money-ops, not a new command: `folio.authorize` with `purpose=DAMAGE`; release = `folio.void`; forfeit = post `DAMAGE` then capture. Do not auto-capture DAMAGE on `capture_due`.

**Tenders** are `CARD` \| `CASH` (cashiering spec). Do not add CHECK / VOUCHER / GIFT without amending that spec.

**Do not silently release `sold` inside `tryCheckOut`.** Remaining nights after early departure stay sold until a **named** early-departure / shorten command runs (`ARCHITECTURE.md` §7.1). If you add checkout UX without that command, warn the clerk — do not change inventory.

**Hotel-wide loops** (night audit room charges, bulk posts): catch **per reservation / per row**. One missing rate or validation error must not abort the whole property. Failed rows become exceptions; the step continues unless a spec says halt.

**Wall-clock in a timezone** (alarms, audit time, business-date boundaries): use a **two-pass** offset (see `zonedMidnightMs`). Do not sample TZ offset at `Date.UTC(wall as if UTC)`. Add DST cases when you touch this. Spring-forward gap → next real instant; fall-back overlap → first occurrence.

**Config that the SPA can save must be read by pms-core** or **hidden**. Do not ship Settings toggles (`same_day_cutoff`, `require_prepayment`, …) that persist and change nothing. New DOMAIN keys: register, read inside the DO transaction if they affect inventory/money (`ARCHITECTURE.md` §5.1), and never from KV.

**OOO / restrictions** that extend past the availability horizon must either extend the horizon or reject — do not leave “no row” looking bookable.

**Shift cash / FX:** expected cash and cashier dates use **ledger currency** and **property business date**, not raw txn amount in mixed FX or UTC `date(created_at)`.

**Catalog lane vs runtime:** if `COMMAND_CATALOG` says `BULK` or `BACKGROUND`, the DO must use that lane (`touchBulk` / `bulkDeadline` / background). If the implementation is `touchInteractive()`, **change the catalog** until real chunking exists. Do not leave a lying lane.

---

## 3. HTTP, Durable Objects, and bounded input

**`dispatchV1` already has `ctx.tenantProperty`.** Every new or edited property handler must call `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. Inside the helper, reuse the row in hand for `assertTenantActive` / registry — do not re-`getProperty` the same id. Do **not** skip `assertTenantActive`.

**No `await` inside `transactionSync`.** `runIdempotent` `execute` is `Sync<T>` — async is a compile error. Keep it that way. Never `BEGIN`/`COMMIT` in `sql.exec()`. Never `blockConcurrencyWhile()` on a request path.

**Parse JSON once.** Use the shared helper: malformed body → `400 invalid_json`, not a Worker 500. Blind `as` casts are not validation. Array fields have an HTTP cap **and** the same cap in the `try*` RPC (rates bulk, rooms bulk status, folio split, roster `kinds`, guest batch, and **any new array**). Over cap → `422` with a named code (`limit_exceeded` or existing). Guest batch cap is 50 — SPA clients **chunk** to that cap.

**One `commandErrorHttpStatus` table** for domain errors. Do not add a fifth mapper.

| Error | HTTP | Notes |
|---|---|---|
| `entitlement_required` | **402** | Never 422 or 503 for the same code |
| `not_member` | **404** `not_found` | Never 422 on reservation writes |
| Command failure | `{ ok: false, error }` | Gates may use bare `{ error }` |
| Decrypt miss | per-row `DECRYPT_UNRESOLVED` | Do not 500 a single guest GET if batch already returns Result |

Typed domain errors only in `catch`; unexpected throws → `INTERNAL_ERROR`, never map everything to `forbidden`.

**DO transport / degraded mode:** extend the allowlist against real Cloudflare strings; keep the test sentinel behind `HOSPAI_UNSAFE_LOCAL`. Missing R2/bindings must **not** retry forever — terminal fail or DLQ.

**SQL:** bind user data. Identifiers are module constants or `^[A-Za-z_][A-Za-z0-9_]*$`. No string-built SQL from request input.

---

## 4. Operator SPA and ui-kit

**Mutation you just performed must update the screen without waiting for WebSocket.**

- `invalidateQueries` the **prefix the query actually uses**. Board is `['board', mode, …]`, not `['arrivals']`. Tape is `['front-desk-tape', propertyId, from, to]`, not `['front-desk-tape']`.
- `setQueryData` must use that **full** key. Wrong key = silent no-op.
- WebSocket (`FrontOfficeLive`) is for **other** tabs and users. After check-in, checkout, confirm, assign-room: invalidate `['board']` locally.

**Operator copy:** `classifiedUserMessage` only. Never `JSON.stringify(err.classified.body)` and never `` `Request failed (${c.class})` ``. Mutation success/failure uses `Alert`, not a bare `<p>`. Destructive actions (`Void`) use `intent=destructive` and confirm.

**Disable impossible primary actions** (Check in on `checked_out` / cancelled / already in-house) and say why. Empty vs error vs “no filter matches” are three states — do not reuse one sentence.

**Page chrome:** `PageHeader` is the single `<h1>`. Sidebar brand is not an `<h1>`. Titles match the route (Arrivals / Departures / In house are not all “Front Desk”). Subtitles use live `property.name` — no hardcoded hotel names. Follow `.cursor/rules/spa-page-chrome.mdc`.

**Kit:** `Button` / `Input` / `NativeSelect` / `Field` / `DataTable` / `Alert` / `EmptyState` / `Skeleton` / `Badge` / `Dialog` (`.app-modal`). `hospai/no-raw-controls-in-web-pms` is error. Matrix cells: `VisuallyHidden` on `Field` labels. One dialog language with focus trap; do not add a fourth overlay. Hex only in `tokens.css`, as `--color-*` primitives with a light value and a dark value; `check:web-pms-colors` checks every chrome and status pair in **both** themes. Reservation status uses `StatusBadge`, housekeeping state `RoomStatus` — the word is always shown; colour never stands alone. Print CSS must isolate the card (`.reg-card`); never print a room UUID.

**Nav gating** matches the route permission (`roster:read` to **see** roster; `roster:write` to mutate). Permission miss: toast, not silent redirect.

**Settings / Book:** if a control is not wired in pms-core, do not show it. FAIL_CLOSED on types/availability disables Hold/Quote/Confirm with an Alert.

**Dashboard / occupancy:** today’s counts come from `get_front_desk_summary` (`BoardSummary`). A 7-day occupancy chart is a **warehouse trend** (`ARCHITECTURE.md` §7.8) — do not scan reservations or copy the prototype Recharts outlook into Phase 1.

**Party size** is `adults` / `children` on the stay. Do not add extra `guest_ref` rows for “additional guests.”

**New PMS modules** (`products`, `maintenance`, …) are `modules/pms/<name>` with `src/module.manifest.ts`. Core never imports add-ons. Maintenance **consumes** `room.ooo_changed`; do not invent tickets inside housekeeping. Guest messaging / confirmation email is Phase 3 (Whistle), not a Phase 1 Worker mailer.

**Perf defaults:** React Query `staleTime` 60s, `refetchOnWindowFocus: false` — keep. `lazy()` admin routes; desk routes stay eager. Do not virtualize the default 7-day tape; cap the **UI** range at 14 days if you expose a longer picker. Do not raise the 90-night HTTP availability cap. Do not poll an empty queue every 1s.

**No `fetch` in components** (`hospai/no-fetch-in-components`). No DOM in `client-core`. No inline styles in web-pms.

---

## 5. Tests and CI (so the next feature cannot ship the old bugs)

**When you add a property-scoped list/search of OrgDO PII**, add a **two-property same-org** test: hotel A must not see hotel B’s guests/staff.

**When you add provision / tenant create**, add a cross-org “existing global `propertyId`” test: 409, **no** membership graft, **no** foreign identifiers in the body.

**When you add COMPANY / city-ledger behaviour**, test transfer-then-close (or checkout) with a **non-zero** receivable. Do not only use a helper that nets the window to zero. Keep zero-balance close as a hook unit **beside** the desk path.

**When you change night-audit skip/halt policy**, rewrite the specs in the **same PR**. Do not leave a test that expects “one missing rate fails the hotel” if production now continues.

**When you add SPA cache keys**, assert `invalidateQueries` / `setQueryData` against the **consumer** key (include `propertyId` and range params). Client mocks are fine; untested keys are not.

**When you add Clerk/auth options**, test empty `CLERK_AUTHORIZED_PARTIES` (must not disable `azp` in staging-shaped env) and wrong `azp` → 401.

**When you add a `test` script**, also add `test:coverage` if CI’s `pnpm test:coverage` is how the package is reached. Packages without that script are **invisible** to CI coverage (this bit `@hospai/crypto-shredding`).

Root **`pnpm lint`** runs **`eslint .`** on the full tree. Workspace package **`lint`** scripts are **coordination stubs** for turbo (`echo 'lint via root eslint'`) — they do not run standalone eslint. Confirm **17** `check:*` scripts unchanged (includes `check:resolve-property-prefetch` from R0.12).

**Supply chain:** `pnpm audit --audit-level high` blocking CI is **deferred** until the tree is clean (9 high on 2026-09-05); see ARCHITECTURE.md §11 footnote.

**Do not** set an 80% coverage gate on PropertyDO. **Do not** add Playwright as the first e2e layer — extend `scripts/smoke-staging.mjs` (book → check-in → check-out, plus COMPANY AR once that path exists). Staging deploy must not outrun a green CI SHA.

**Dates in tests:** use `test/date-helpers.ts` (`addCalendarDays`). Do not copy `addDays` into the spec. Do not unscoped-assert on a shared console/outbox log without `property_id`.

**New `modules/pms/*` directory:** include `src/module.manifest.ts` or the manifest check is lying. Do not add empty `domain/` folders as decoration.

---

## 6. Adding a feature — checklist

Copy this into the spec/plan for any new route, command, screen, or DO method:

- [ ] Tenant: URL org/property vs every id in the body; mismatch cannot mutate another org.
- [ ] Authz: `permission` + optional `entitlement`; kill-switch decision recorded; property-scoped reads if the URL is a property.
- [ ] Command in `COMMAND_CATALOG` with a **true** lane; HTTP id in `V1_ROUTES` **and** `V1_HTTP_ROUTE_AUDIT`; `permissions-check` still matches.
- [ ] Idempotency: `{ commandId, payload }` fingerprint; key prefixed with user; same object hashed as executed.
- [ ] Arrays capped at HTTP and RPC; JSON via the parse helper.
- [ ] `resolvePropertyContext(..., ctx.tenantProperty)` on property routes.
- [ ] Money: integer minor units + `allocate`; city-ledger/folio invariants if COMPANY windows exist.
- [ ] Inventory: ledger write in the same `transactionSync`; `freeAvailability` imported.
- [ ] Errors: existing status table; `{ ok: false, error }`; no tenant row on 409 conflicts.
- [ ] SPA: query key includes tenant + params; local invalidate on mutation; `classifiedUserMessage`; ui-kit; live `property.name`.
- [ ] Tests: characterization for isolation/money; two-property case if OrgDO PII; no `it.only`.
- [ ] Pins: catalog length, last audit route id, `PROPERTY_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS` if those lists changed.
- [ ] No new Settings control unless pms-core reads it.
- [ ] Existing spec in `docs/superpowers/specs/` searched; no second design for ARI, purge, DAMAGE, Hold=`PENDING`, or BoardSummary.

---

## Catalog and schema pins

After roadmap R1.6 (booking sources and market segments, 2026-10-28) — update this table when you bump them:

| Pin | Value | Assertion |
|---|---|---|
| `COMMAND_CATALOG` length | **95** | `packages/contracts/src/register.test.ts` |
| `V1_HTTP_ROUTE_AUDIT` | **152** routes, last id **`put_operational_config`** | same file; `scripts/permissions-check.mjs` matches `V1_ROUTES` |
| `PROPERTY_SCHEMA_HEAD` | **36** | `packages/do-runtime` migrate tests |
| `ORG_SCHEMA_HEAD` | **10** | `packages/do-runtime` migrate tests |
| `NIGHT_AUDIT_STEPS` | length 8, `[3] === 'AUTO_TRANSFER'` | night-audit specs |

There are **17** `check:*` scripts in CI (not 16). Local pms-core shards **include** ledger property specs; CI isolates those files in `test-pms-core-ledger-prop`. Do not fold them back into the noisy shards.

---

## Do not “fix” these (they are decisions)

- Authenticated `POST /v1/orgs` bootstrap — keep; isolation is the org-match on provision, plus `azp`.
- 60s permission / entitlement cache — Phase 1 until KV projection (`ARCHITECTURE.md` §4.3).
- `held === 0` — Phase 3. Desk **Hold** = `PENDING`.
- Plan-scoped restriction rows unused — type-wide `*` until a spec says otherwise.
- Occupancy pricing, yield engine, Playwright-first e2e, PropertyDO split for speed, Redis, tape virtualizer on 7 days, 7-day occupancy **trend** on the Hub.
- Sign-in marketing column — keep; do not copy its shadows into the desk.
- `LinkButton` unused in ui-kit — kit cannot depend on the router; `Link` + `ui-link-btn` is the contract.
- **Already shipped — do not rebuild:** `ARI_KV` + book `quoteAriVersion`; `PurgeWorkflow` + certificates; `StaleWatermark`; ShiftStrip in AppShell; money-ops DAMAGE/void/discount/invoice; guest CRM directory + blind-index search (tags/LTV/merge remain deferred in that spec); `get_audit_log` (do not add `audit.append` HTTP).
- Folio transfer to **another reservation** — rejected. Charges move between windows on the same stay.
- `tender_type` `CARD` \| `CASH` only until the cashiering spec is amended.
- Confirmation email / Whistle inbox / concierge tickets — Phase 3, not a Phase 1 Settings Email clone.

---

## Merge-blocking gates (already in CI)

Do not duplicate them in ad-hoc scripts. Do not disable them.

- `eslint-plugin-hospai` (11 rules): `idFromName` only in `packages/tenant-router`; no DOMAIN config from KV; no entitlement/platform imports in `domain/`; bookability must not import reservation modules; pms must not import add-ons; cloneable boundary types; no DOM in client-core; no fetch in components; no inline styles / raw controls in web-pms.
- `check:ddl`, `check:entitlements`, `check:permissions`, `check:degraded`, `check:forbidden-bodies`, `check:do-transport-guards`, `check:module-manifests`, `check:purge`, `check:resolve-property-prefetch`, SPA chrome/colors/class-denylist/ui-kit/me-gating, `check:pms-core-test-dates`.

If a new class of bug is not catchable by review, **add a `check:*` or a characterization spec** in the same change — that is how the 2026-09 defects recurred (green CI, wrong threat model).
