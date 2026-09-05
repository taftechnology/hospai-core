# PMS completion roadmap

**Goal:** HospAI PMS matches [`hospai-pms-prototype`](../../hospai-pms-prototype) as the **functional specification** — same operator surfaces, same clerk flows, every KEEP feature working on live APIs — and the desk **looks like that product** (sage/tan chrome, ui-kit, prototype interaction). Not a Tailwind clone of the prototype repo.

**This file is the queue.** An agent that should “keep going on the PMS” starts here, takes **one open slice**, finishes it, ticks the box in this file in the same change-set, then takes the next. Do not skip ahead. Do not re-derive scope.

| Document | Role |
|---|---|
| [AGENTS.md](../AGENTS.md) | How to write code (tenancy, money, HTTP, SPA, tests). **Mandatory on every slice.** |
| [docs/audit/2026-09-04-full-codebase-audit.md](audit/2026-09-04-full-codebase-audit.md) | Track 0 implementation contract (S1, L1, …). |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Storage, phases, §16 prototype rules. |
| [DEMO-READY.md](../DEMO-READY.md) | Investor 8-minute bar — **already closed**. Do not reopen P0. |
| Prototype | Sibling repo `hospai-pms-prototype` (interaction spec). Copy **what it does**, never its reducer, floats, or Tailwind. |

**HEAD this roadmap was written against:** `461d391`. Re-read catalog pins before each slice (`COMMAND_CATALOG` length, last `V1_HTTP_ROUTE_AUDIT` id, `PROPERTY_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`).

**Revision:** 2026-09-04 code + spec + architecture pass. Do not re-derive a surface that already has an accepted spec in `docs/superpowers/specs/`. Phase 1 must not contradict ARCHITECTURE.md §14–§16.5 or a named leftover in a shipped spec.

---

## How an agent uses this file (every session)

```
1. Open this file. Find the first "- [ ]" in document order (Track 0 before 1, …).
2. If that slice says "see audit Vertical N", implement that audit vertical exactly.
3. Otherwise implement this slice’s Locked call. Do not invent a second product.
4. Follow AGENTS.md. Characterization tests for tenancy/money. pnpm test:local.
5. Tick the checkbox in this file in the same PR/commit the slice names.
6. If the human said “keep going”, start the next open slice immediately.
   Stop only on a Blocked row, a fork this file does not lock, or the human says stop.
```

**Do not** ask “should I continue?” between slices.
**Do not** start Track 1 while **R0.1–R0.6** are open.
**Do not** start Track 2 while **R0.11** is open (kit/chrome). Other Track 0 items may still be in flight.
**Do not** start Track 4 (Phase 2 add-ons) while **Track 1 or Track 2** still have open boxes. R3.2–R3.5 leftovers may remain; **R3.1** must be done. **ARI_KV already ships** — R4.2 consumes it.

### Slice template (when you write a spec/plan)

Paste into the spec. Fill every line.

```
Slice: R?.?
Depends on: (slice ids or "none")
Prototype: hospai-pms-prototype/src/components/…
Live: apps/web-pms/… + apps/pms-core/…
Locked call: (one paragraph from this file)
Scope out: (from this file)
Pins: COMMAND_CATALOG ? · last route ? · SCHEMA_HEAD ? · NIGHT_AUDIT_STEPS ?
Tests: (fail-first if tenancy/money)
Verify: pnpm test:local + named specs
```

Reviewer workflow (if in force): spec → plan → implement per task, `composer-2.5-fast`, work on `main` unless a branch was named. Specs/plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`. Implementers commit per plan task. Push only when asked.

---

## Locked meaning of “done”

### Looks the same

- **Same information architecture** as the prototype sidebar: Dashboard Hub, Room Plan, Front Desk, Reservations (**list + stay card**), New Booking, Housekeeping, Guests, Rates, Folio directory, Night Audit, Settings — plus the quiet ops items we already have (Inventory, Staff, Roster, Exceptions, City ledger, Shift).
- **Same clerk flows:** tape click → stay; walk-in / Open Reservation; book → quote $ → Inquiry/Hold(`PENDING`)/Confirm; stay card modify/cancel/no-show; in-house room move; check-in by room **code**; folio as a bill; HK dirty→clean; night audit as a job; shift open/close. Confirmation email is **Phase 3** (Whistle / R5.2), not Phase 1.
- **Chrome:** existing P0-3 tokens (sage `#4A5D4E`, cream, IBM Plex). `PageHeader` + `Card`. One `<h1>`. Live `property.name`.
- **Not:** Tailwind v4, `lucide-react`, `recharts` as a product, pixel-identical CSS, prototype “Simulation Active”, role impersonation, Opera fake sync, competitor scrape.

### All features functional

- Every prototype **core-PMS** behaviour that ARCHITECTURE §16.5 marked **KEEP** (or shipped) works on PropertyDO/OrgDO/HTTP/SPA.
- **Stub UI is still in scope.** If a clerk would click it in a hotel, implement it for real even when the prototype only `alert()`s, uses React state, or is half-broken. Do not skip a surface because the prototype is fake. Rebuild against live APIs (integers, ledger, OrgDO PII).
- Settings keys the SPA shows are **read** by pms-core (or hidden).
- City-ledger AR actually posts (audit L1). Board updates after check-in without waiting on WebSocket (audit U1).
- Prototype **Phase 2/3** surfaces (channel manager, booking engine, groups, Whistle, yield engine, marketplace, POS) stay on Track 4–5. When those slices run they must be real modules — not a nicer `alert('synced')`. They are not Phase 1.
- **Specs win over a blank-page rebuild.** If `docs/superpowers/specs/*` already designed the command, HTTP, and leftover list, implement that spec (or the named leftover). Do not invent a second product.

### Architecture / spec compliance (do not violate)

| Tempting prototype / earlier roadmap line | Normative lock |
|---|---|
| 7-day occupancy Recharts on Dashboard | **Warehouse** (§7.8). Phase 1 Dashboard is **today’s** OLTP (`get_front_desk_summary`). |
| Guest LTV / merge / passport / ID files | Guest CRM spec deferred. LTV trends = warehouse. Stay history already ships. |
| Additional named guests as extra `guest_ref`s | Holes sweep: party = `adults`/`children` only. No second profiles. |
| Inventory `held` / wizard “hold a room without selling” | `held` unused until Phase 3 (§7.1). Live **Hold** = `PENDING` (`sold++`), via `reservations.hold` / create-as-pending. |
| CHECK / VOUCHER / GIFT tenders | Cashiering spec settled `CARD` \| `CASH` only. Do not widen the CHECK. |
| Transactional email in Phase 1 | Guest engagement is Phase 3 (§14). **R5.2**, not Track 1. |
| Valet / coffee tickets inside HK | §16.1 **maintenance module** = work orders. Concierge tickets = Whistle **tasks** (R5.2). OOO emits `room.ooo_changed`; tickets subscribe (HK leftover 5). |
| HK reports tab | Not in §16.1. Workload counts already on the HK board. |
| Products as a Settings tab stuffed into PropertyDO | §11 **`products` module**. Charge-code registry stays the posting reference. |
| Settings Logs inventing `audit.append` HTTP | Audit-log spec: append is private. `get_audit_log` already exists for read. |
| ARI KV / purge Workflow as greenfield | Specs + code **already shipped**. Do not rebuild. |
| Damage deposit as a new command | Money-ops: `folio.authorize` `purpose=DAMAGE`; release = `folio.void`; forfeit = post `DAMAGE` + capture. |
| Drag-to-move on the tape | Tape spec: empty cell may **navigate** to `/book`; no new assign POST on the tape chunk. Room move is **R1.19** on Front Desk / `assign_room`. |

### Deliberate differences (never “fix” to match the prototype)

| Prototype | Platform (keep) |
|---|---|
| `amount: number` | Integer `*Minor` + `allocate` |
| Availability = count reservations | `availability_day` ledger + `freeAvailability` from `@hospai/contracts` |
| Folio mutates in place | Append-only; reverse + post |
| Guest embedded on reservation | `guest_ref` + OrgDO vault |
| Inquiry → confirmed | `INQUIRY` → `PENDING` → `CONFIRMED` |
| Assign-before-check-in as waiting | Pre-assign allowed; check-in needs a room (or auto-assign) |
| Staff blocks as $0 reservations | `held` unused until Phase 3 |
| 89 `localStorage` keys | Classified config register |
| DND as `room.status` | Stay flag `dnd_flag` only |
| HK budgeting / metrics / mobile | Dropped from Phase 1 (holes sweep). Workload counts on the HK **board** already ship. No Reports tab. |
| HK **inventory** (linens/stock) and **manager priorities** | **KEEP** — §16.1 core HK; not in the drop list |
| Settings **Tickets** (valet SLA, inspections, escalations) | **Maintenance module** (R1.9) for property work orders. Concierge tickets + SLA email = Whistle **R5.2**. |
| Keyless / door-lock | Dropped |
| Room-type photos | Deferred (booking engine Phase 2) |
| Recurring breakfast/parking engine | Deferred (named leftover) |
| Plan-scoped restrictions | Type-wide `*` until channel-manager phase |
| Rate-plan inclusions JSON | Deferred with recurring |
| PAN / CVV / raw card fields | Never in PMS. Guarantee **workflow** is Phase 1 (R1.20); card capture is payments Worker (R5.4) |
| Folio transfer to **another reservation** | Rejected (`transfer_cross_reservation`). Charges move between **windows on the same stay** (GUEST/COMPANY) |
| “Add 5 arrivals”, Simulation Active, Opera fake sync, competitor scrape | Investor theater — never build |
| Dynamic Yield / Forecast tabs that `alert()` a +20% surge | Not Phase 1. **R5.1** must be a real RM module, not that stub |

---

## Already shipped — do not rebuild

Tick these mentally; they are not open work.

- Live routes: Room Plan `/board` (**BoardSummary** occupancy/arrivals/due-out/in-house from `get_front_desk_summary`), Front Desk `/arrivals|departures|in-house` (VIP/DND badges), Reservations **directory**, Book (adults/children, Inquiry / Hold=`PENDING` / Confirm, promo, guest blind-index search, `quoteAriVersion`), Check-in (assign-room + front-office editor + reg card), Folio **drill-in** (split/transfer/void/discount/cash/authorize/invoice), Guests directory + profile + stay history, Inventory (physical + **virtual** types, floors, OOO ranges), Rates (plans including **derived**, matrix bulk, type-wide restrictions), Staff, Roster, Housekeeping **board + assign + workload**, Night audit + snapshot reports, Exceptions, Settings (property / charges **including routing rules** / tax / booking keys UI), City ledger screen, ShiftScreen + **ShiftStrip in AppShell**, Sign-in, demo seed, hold/confirm/cancel/no-show **HTTP** (cancel/no-show/modify/cancel-check-in: wire SPA on R1.15), global search shell.
- Ledgers / platform: availability + **ARI_KV projection** + reject-on-commit on book, restrictions, folio windows, OOO → `blocked` + `room.ooo_changed`, night-audit `BusinessDate` (8 steps, `AUTO_TRANSFER` at [3]), entitlements, RBAC, degraded mode + exception workbench, multi-currency folio, guest shredding + **PurgeWorkflow + certificates**, promo/discount/damage/no-post (money-ops), `dnd_flag` / VIP / front-office comment **domain + Check-in/Folio editor**, `StaleWatermark`, `get_audit_log`.
- Demo-ready P0 chrome + folio first-paint + seed ([DEMO-READY.md](../DEMO-READY.md)).

**Shipped but lying or unfinished** (Track 0 / 1): Booking Settings keys persist unread; COMPANY AR never posts (city-ledger spec shipped, production path does not); check-in does not invalidate `['board']`; Rates matrix paints a label in every cell; Settings is three tabs vs prototype’s twelve sections; no **Dashboard Hub nav item** (summary widgets live on the board); no org-wide folio directory; Reservations directory is a **list** (modify/cancel/no-show/cancel-check-in not on the SPA); HK has no priority / inventory tabs and no **maintenance module**; guest CRM has no tags (directory spec deferred them); products are charge codes only.

**Shipped — do not rebuild, only wire if a hole remains:** folio routing, invoice engine, promo/discount/DAMAGE authorize+void+capture, Hold/Confirm HTTP, ARI_KV, PurgeWorkflow, ShiftStrip, Exceptions, global search, registration-card view, BoardSummary, guest blind-index search.

---

## Completeness re-check (what earlier drafts missed)

Cross-checked against live SPA/routes, ARCHITECTURE.md §7.1/§7.8/§11/§14/§16, and accepted specs (tape/board, booking wizard, guest CRM, money-ops, cashiering, HK/OOO, ARI KV, purge, holes sweep). **UI-stub pass still holds** for clerk flows that have no spec leftover forbidding them — implement against existing commands.

| Gap | Lock |
|---|---|
| Reservations stay card | **R1.15**. HTTP: `reservations.modify` / cancel / no-show / `cancel_check_in` exist. Client-core + SPA mostly missing. Penalty snapshot already on cancel. |
| HK inventory + manager priorities | **KEEP** in **R1.9** (§16.1). Move keys out of `EXCLUDED_PROTOTYPE_KEYS`. Budgeting/metrics/mobile **dropped** (holes sweep). |
| Maintenance work orders | **R1.9 as `pms.maintenance` module** (HK leftover 5). Subscribe to `room.ooo_changed`. Not valet/coffee. Not a TicketsSettings clone. |
| Roster skills / shifts / capacity | **R1.9** on `/roster` (roster leftover 7). |
| Settings → Tickets concierge | **R5.2** Whistle tasks. |
| Settings → Guests | **R1.17**. `pms.guests.settings` exists unread. |
| Settings → Accommodations | **R1.18** = Inventory deep-link. |
| Booking wizard remainder | **R1.4**. Already ships adults, Inquiry/Hold/Confirm, promo, guest search. Remainder: consume booking Settings keys or hide (R0.11); add-ons via **R1.5**; source/segment via **R1.6**; FAIL_CLOSED disable. |
| Billing & Guarantee / PAN modal | **R1.20** = consume `require_prepayment` + existing **simulate** `folio.authorize` (payments-simulate + card-last4 specs). No new PAN fields. No `held` inventory. |
| Open Reservation / walk-in | **R1.3** → `/book` with today. Tape spec allows navigate; not a new assign POST. |
| In-house room move | **R1.19** via existing `reservations.assign_room` on `checked_in`. |
| Post incidental from the board | **R1.3** Dialog → `folio.add_item` (charge codes until R1.5). |
| Special requests | Front-office comment (already on Check-in/Folio). Do **not** add extra guest_refs. |
| Damage deposit SPA | **R1.15** / FolioScreen: authorize `purpose=DAMAGE`; void = release; `DAMAGE` line + capture = forfeit. |
| Dashboard Hub | **R1.1** nav + compose **existing** `get_front_desk_summary` / available-rooms / NA CTA. **No** 7-day trend. |
| Night audit trial balance | **R1.10** operator copy + pre-check counts. Close-out = existing SNAPSHOT_REPORTS. Do not grow steps. |
| Settings Email | **R5.2**, not Phase 1. |
| Tenders check/voucher/gift | **Do not add.** Cashiering spec is `CARD` \| `CASH`. |
| Bulk rates DOW | **R1.7** UI on existing `rates.bulk_update`. |
| Shift strip | **Shipped** in AppShell. R1.16 = R0.14 honesty only. |
| ARI KV + reject-on-commit | **Shipped** (`ARI_KV`, book `quoteAriVersion`). R3.8 ticked as done / gap-fill only for R4.2. |
| Purge Workflow | **Shipped**. R3.7 = do not rebuild. |
| Degraded watermarks | `StaleWatermark` shipped. R3.9 gap-fill. |
| Outbox consumers + Queue workers | **R4.5**, before or with **R4.3**. |
| Usage billing, partner sandbox, §7.6 projections | **R5.6–R5.8**. Switcher-only is **R4.4**. |
| Card-brand matrix / channel routings | Hide until Stripe (**R5.4**) / channels (**R4.3**). Invoice numbering stays **R1.12**. |

---

## Track 0 — Make what we already shipped true

**Source of truth:** [2026-09-04 audit](audit/2026-09-04-full-codebase-audit.md). Execute those verticals **in audit order**. Tick here when that audit vertical is merged and `pnpm test:local` is green.

Do not start Track 1 while R0.1–R0.6 are open (security + AR + desk freshness). R0.7–R0.14 may interleave with Track 1 only if the Track 1 slice does not touch the same files; prefer finishing Track 0.

- [ ] **R0.1** Audit V1 — S1/S3/G1 provision graft. `provision.ts` org match; 409 no foreign row; failing cross-org test first.
- [ ] **R0.2** Audit V2 — N4/N5/S5/G12/N12 azp, headers, Bearer-or-Origin, smoke JWT mask.
- [ ] **R0.3** Audit V3 — L1–L4/U8/G2/G10 city-ledger AR posts on transfer/checkout; honest toast; smoke AR step.
- [ ] **R0.4** Audit V4 — S2/S7 property-scoped guest and roster lists (two-property test).
- [ ] **R0.5** Audit V5 — N6 per-org HKDF master key + comment lie.
- [ ] **R0.6** Audit V6 — U1–U3/Q5/P2/P4 board invalidate, terminal Check-in disabled, tape query key, guest batch chunk 50.
- [ ] **R0.7** Audit V7 — N1 DST two-pass; L5 per-reservation night-audit catch; rewrite case 17 in the same PR.
- [ ] **R0.8** Audit V8 — array caps (rates, rooms, split, roster `kinds`); JSON 400 helper; fingerprint `{ commandId, payload }`.
- [ ] **R0.9** Audit V9 — kill-switch on cancel/purge; replay re-checks actor; degraded allowlist; R2 no infinite retry.
- [ ] **R0.10** Audit V10 — one `commandErrorHttpStatus` (402 / 404 `not_member`).
- [ ] **R0.11** Audit V11 — UX/UI (RateCell `VisuallyHidden`, one h1, Dialog, print CSS, hide unread Booking settings, Alerts, live hotel name).
- [ ] **R0.12** Audit V12 — `resolvePropertyContext(..., ctx.tenantProperty)` everywhere; name search not decrypt-200.
- [ ] **R0.13** Audit V13 — deploy needs green CI SHA; web-pms `*.tsx` coverage; crypto-shredding `test:coverage`; eslint recommended.
- [ ] **R0.14** Audit V14 — named early-departure command (L6); cash/FX/OOO; `freeAvailability` single import; architecture write-down.

When R0.1–R0.6 are `[x]`, the 8-minute demo path is **honest** (AR, board, azp). Then Track 1.

---

## Track 1 — Core PMS feature parity (Phase 1 KEEP)

Each slice is one vertical. Prototype path is relative to `hospai-pms-prototype/src/components/`.

### R1 — Front office surfaces the prototype still has and we do not

- [ ] **R1.1 Dashboard Hub**
  - **Depends:** R0.6 (board keys).
  - **Prototype:** `Dashboard.tsx` (occupancy, arrivals/departures, ADR, available-rooms entry, night-audit CTA). **Not** Yield Analytics charts.
  - **Live:** `BoardSummary` on `/arrivals` etc. (`get_front_desk_summary`). No Hub nav item.
  - **Locked:** Add `/` or `/dashboard` as the first nav item. **Compose existing reads** — occupancy/arrivals/due-out/in-house from `get_front_desk_summary` (tape-chart spec), available-rooms from existing GET, night-audit CTA to `/night-audit`. VIP arrivals = filter existing arrivals by `vipFlag`. Spec: [tape chart + live board](../superpowers/specs/2026-08-13-tape-chart-live-board-design.md).
  - **Out:** 7-day occupancy trend (warehouse §7.8); recharts; competitor scrape; Whistle inbox; “add 5 fake arrivals”; a second occupancy calculator that scans reservations.
  - **Tests:** Hub numbers match `get_front_desk_summary` for a seeded day; available-rooms omit occupied+OOO.

- [ ] **R1.2 Folio directory (prototype Billing nav)**
  - **Depends:** R0.3 (AR honest).
  - **Prototype:** `FoliosBilling.tsx` search → pick stay → ledger.
  - **Live:** only `/folio/:reservationId`. Add `/folios` (or `/billing`) directory: in-house + due-out, search by guest name / reservation id, row → existing FolioScreen.
  - **Locked:** no new money model. Permission `folio:read`.
  - **Tests:** directory lists checked_in; click path uses existing folio GET.

- [ ] **R1.3 Tape / Front Desk interaction leftovers**
  - **Depends:** R0.6, R0.11.
  - **Prototype:** `TapeChart.tsx`, `FrontDesk.tsx`, `AvailableRoomsModal.tsx`.
  - **Live:** `TapeChartScreen.tsx`, `BoardScreen.tsx`.
  - **Locked:** tape empty-cell → **navigate** to `/book` with dates/type query params (tape spec: no new assign POST on the tape). Available-rooms already has a GET — surface it as a modal or Room Plan action that books. **Open Reservation / walk-in** = `/book` with arrival = property today. Board already shows VIP/DND badges — add **VIP-only filter**. **Post incidental** Dialog → existing `folio.add_item`. Assign-room from **arrivals board** may POST `reservations.assign_room` (not drag-on-tape). Cancel check-in: wire existing HTTP on **R1.15**. Dirty-room: keep cleanliness gate. Tape OOO uses existing ranges.
  - **Out:** “Add 5 arrivals”; PAN pre-auth modal; drag-to-move on the tape.

- [ ] **R1.4 Booking wizard remainder**
  - **Depends:** R0.11 (hide or wire Booking settings).
  - **Prototype:** `BookingWizard.tsx`.
  - **Live:** `BookingScreen.tsx` — adults/children, Inquiry / Hold(`PENDING`) / Confirm, promo, guest equality search, `quoteAriVersion`. Spec: [booking wizard](../superpowers/specs/2026-08-11-booking-wizard-design.md).
  - **Locked:** Do **not** rebuild the wizard. Remainder: FAIL_CLOSED disables Hold/Quote/Confirm; **hide or consume** `same_day_*` / `require_prepayment` (R0.11 / R1.20); booking add-ons = **R1.5 products** posted via `folio.add_item`, not recurring (R3.2); source/segment optional fields from **R1.6**. Special requests = existing front-office comment, not a new column. **Hold is `PENDING` / `reservations.hold` — it increments `sold`. Do not use `held`.**
  - **Tests:** occupancy exceeded on submit; FAIL_CLOSED disables Hold/Quote/Confirm. Do not re-test adults/promo/search as if they were new.

### R1 — Inventory / rates / products

- [ ] **R1.5 Products catalog (not only charge codes)**
  - **Depends:** none after R0.1.
  - **Prototype:** `ProductsSettings.tsx` (categories, SKU items, add-ons, tax code).
  - **Live:** Settings → Charges (`charge_code` rows).
  - **Locked:** new **`modules/pms/products`** module (§11), not a Settings-only dump into PropertyDO. Category + item + default `amountMinor` + `chargeCode` + tax group. Folio “post charge” picker uses **products** for incidentals; system codes stay hidden. Charge-code registry spec remains the posting reference. **No** stock/reorder engine.
  - **Pins:** new commands/routes + schema version + `src/module.manifest.ts` in the same commit.
  - **Out:** POS, channel-only pricing (Phase 2).

- [ ] **R1.6 Amenities / sources / market segments / policies (Settings Property subtabs)**
  - **Depends:** R0.11.
  - **Prototype:** `Settings.tsx` Property subtabs `amenities`, `sources`, `policies`, `market_segments`, `split_inventory`, `spaces`.
  - **Live:** Settings property + Inventory rooms/types.
  - **Locked:** Amenities on room types if inventory already has a field — expose in Inventory SPA. Sources + market segments as OPERATIONAL lists used on create-reservation (optional fields). Policies = the Booking keys **once wired** (R1.4). **Spaces** (meeting rooms) and **split inventory** (group allotment UI) → Track 4 / Phase 2; **hide** the tabs until then.
  - **Out:** hardcoded Spaces cards from prototype.

- [ ] **R1.7 Rates tabs the prototype shows that we skip**
  - **Depends:** R0.11 (I1 RateCell).
  - **Prototype:** `RatesAvailability.tsx` tabs: matrix, dynamic, derived, forecasting, ancillary, channels.
  - **Live:** plans (derived exists), matrix, restrictions.
  - **Locked:** **Derived** stays on Plans (already). **Ancillary** = products (R1.5) — link, do not duplicate. **Dynamic / forecasting / channels** = Phase 3 / 2 — do not build occupancy-pricing or OTA rate push here. Remove or never add those tabs until Track 4–5.
  - **This slice:** matrix looks like a grid of numbers; restrictions type-wide only; document the missing tabs as “Channel / Yield — later” in page subtitle, not fake UI. **Bulk update** must accept a date range **and** day-of-week filter (§16.1); live already posts `rates.bulk_update` — add the DOW UI, do not uncap the array (R0.8). **Modifiers** on a plan (percent/amount, not only derived bps) if the domain already has them — expose on Plans; do not invent a second derivation graph.

### R1 — Guests, HK, night audit, settings ops

- [ ] **R1.8 Guest CRM depth**
  - **Depends:** R0.4 (property-scoped list).
  - **Prototype:** `GuestsCRM.tsx` (tags, VIP, spend, stays, passport, address, sort by spend).
  - **Live:** directory + profile + property stay history + blind-index search. Spec: [guest CRM directory](../superpowers/specs/2026-08-13-guest-crm-directory-design.md) — tags / guest VIP / notes / LTV / merge / passport **explicitly deferred**.
  - **Locked:** this slice **is** that deferred CRM remainder: tags + guest-level VIP + notes on OrgDO profile. Stay history already ships. **Do not** add OLTP “lifetime spend” (warehouse §7.8). **Do not** add `guests.merge` or ID documents (named leftovers). Loyalty = tag/VIP, not a points ledger.
  - **Out:** warehouse LTV; merge; passport/R2 files; decrypt-on-list.

- [ ] **R1.9 Housekeeping — KEEP core extras**
  - **Depends:** none after R0.1.
  - **Prototype:** `Housekeeping.tsx` tabs: board, priority, assignments, staff, inventory, budgeting, metrics, reports, maintenance, mobile.
  - **Live:** HK board + assign + workload counts + roster picker. Specs: [housekeeping module](../superpowers/specs/2026-08-11-housekeeping-module-mechanism-design.md), [room-ops HK completion](../superpowers/specs/2026-08-12-room-operations-hk-completion-design.md) leftover 5.
  - **Locked Phase 1:** **priority** (ordered rooms; un-exclude `pms_hk_manager_priorities`); **inventory** (linens/stock OPERATIONAL list; un-exclude `pms_hk_inventory`; not a warehouse); **`pms.maintenance` module** — work-order table, task types, checklists; consume `room.ooo_changed` (do not invent tickets inside HK). **Staff** = `/roster` + shifts/skills/capacity (roster leftover 7).
  - **Drop:** budgeting, metrics charts, HK Reports tab, mobile attendant, valet/coffee tickets (R5.2), SLA email.
  - **Tests:** assign + status; OOO still fail-closed if assigned; inventory round-trip; `room.ooo_changed` opens a maintenance ticket when the module exists.

- [ ] **R1.10 Night audit operator job**
  - **Depends:** R0.7 (L5/N1).
  - **Prototype:** `NightAudit.tsx` stepped wizard (checks → settle → execute).
  - **Live:** `NightAuditScreen.tsx`.
  - **Locked:** Alert on run/fail; STEP_LABELS; halt copy = review, Retry, Resume. Pre-check counts from existing reads (PRE_CHECK leftover). Close-out numbers = existing **SNAPSHOT_REPORTS** (`roomNet` / tax already on the screen). Do **not** grow `NIGHT_AUDIT_STEPS`. Do not print folio/invoice in `DEGRADED`. Do not clone prototype 11%/2% tax theater.

- [ ] **R1.11 Settings: Users / System / Logs**
  - **Depends:** R0.2.
  - **Prototype:** Settings `users`, `system` (preferences, notifications, tags), `logs`.
  - **Live:** Staff + Roster screens; limited property settings.
  - **Locked:** **Users** = Staff screen linked from Settings. **System preferences** = classified keys pms-core reads. **Notifications** = hide until **R5.2**. **Tags** = R1.8. **Logs** = existing `get_audit_log` read UI (folio:read). Do **not** add `audit.append` HTTP ([audit log spec](../superpowers/specs/2026-08-07-audit-log-design.md)).

- [ ] **R1.12 Settings: Finance remainder**
  - **Depends:** R0.3.
  - **Prototype:** `FinanceSettings.tsx` / `FinanceModals.tsx` (gateways, terminals, AVS, invoice numbering).
  - **Live:** tax rules + charge codes; invoice engine exists.
  - **Locked:** Invoice numbering/templates **configuration** on the existing engine (if not already in Settings). Gateway/terminal/AVS: **sandbox-only** copy + existing simulate path; no live Stripe in Phase 1 (Phase 3). **Card-brand matrix** and **channel routings** = hide until R5.4 / R4.3. City ledger is `/city-ledger`, link from Finance. Folio **routing rules** already live under Settings charges — link, do not rebuild. Do not store secrets in the config register.

- [ ] **R1.14 Reports — OLTP only (optional nav)**
  - **Depends:** R1.1.
  - **Prototype:** `ReportsAnalytics.tsx` is **Yield**. That is Track 5.
  - **Locked:** Do **not** add Yield Analytics in Phase 1. Dashboard Hub (R1.1) is the report. If a `/reports` route is needed for IA, make it a redirect to Dashboard until Track 5.

### R1 — Stay workspace, cashiering, Settings leftovers

- [ ] **R1.15 Reservation stay workspace**
  - **Depends:** R0.6. Add-ons need R1.5 products if you post incidentals here.
  - **Prototype:** `Reservations.tsx` (not just the list — the selected-stay card: modify dates/type, confirm pending, inquiry filter, cancel + policy penalty, no-show, cancel check-in, confirmation code, add-ons, damage-deposit checkbox).
  - **Live:** `ReservationsDirectoryScreen.tsx` is a **list**. Folio and Check-in are separate routes. Commands for hold/confirm/cancel/no-show already exist — **wire the stay card**, do not invent new status verbs.
  - **Locked:** Add `/reservations/:id` (or split pane). **Wire existing commands** — do not invent verbs. Modify = `reservations.modify` (client-core method likely missing — add it). Cancel/no-show = existing DO paths + snapshotted penalty ([lifecycle spec](../superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md)). Cancel check-in = `reservations.cancel_check_in`. Confirm pending = existing `confirmReservation`. Damage = FolioScreen `folio.authorize` `purpose=DAMAGE`; void = release; post `DAMAGE` + capture = forfeit ([money-ops](../superpowers/specs/2026-08-12-folio-money-operations-design.md)). Front-office editor already on Check-in/Folio — reuse. Inquiry/pending/confirmed filters on the directory already exist as status query.
  - **Out:** extra named guests; dirty-room force check-in; recurring engine; second folio UI; PAN; new deposit commands.
  - **Tests:** cancel outside window posts one penalty line; modify dates moves availability; cancel-check-in returns confirmed without deleting folio history; DAMAGE void leaves stay capture-due untouched.

- [ ] **R1.16 Cashiering / shift as a first-class desk surface**
  - **Depends:** R0.14 for L9–L10 cash FX and business-date on close. If R0.14 is still open, do not start this slice.
  - **Prototype:** cash drawer on Front Desk.
  - **Live:** `ShiftScreen.tsx`, **ShiftStrip in AppShell** (all desk routes). Spec: [cashier-shift SPA](../superpowers/specs/2026-08-09-cashier-shift-spa-design.md), [cashiering](../superpowers/specs/2026-08-07-cashiering-design.md) (`tender_type` = `CARD` \| `CASH` only).
  - **Locked:** Do **not** rebuild the strip or add CHECK/VOUCHER/GIFT. This slice is **R0.14 SPA honesty** (cash FX / business-date on close) plus characterization around `get_shift` / `put_shift_close`. If R0.14 already covers the SPA, tick this when R0.14 ticks.
  - **Out:** new tender types; PCI card data; Apple Pay / terminals (R5.4).

- [ ] **R1.17 Settings → Guests (profile defaults)**
  - **Depends:** R0.11. Merge UI is R1.8.
  - **Prototype:** `Settings.tsx` `activeSection === 'guests'` (default country/language, require email/phone, require ID at check-in, duplicate matching).
  - **Live:** `pms.guests.settings` OPERATIONAL JSON exists; no Settings section; check-in does not read it.
  - **Locked:** Settings section bound to that key. Every toggle pms-core **reads** (ID-at-check-in must fail check-in when on). Duplicate match rules gate create; merge remains R1.8. Hide Opera-flavoured controls with no consumer.
  - **Out:** a second guest book; decrypt-on-list.

- [ ] **R1.18 Settings → Accommodations**
  - **Prototype:** Property subtab `accommodations`.
  - **Locked:** deep-link / embed the Inventory screens (types, rooms, floors, OOO, amenities). **Do not** build a second editor. Spaces / split-inventory tabs stay hidden until Track 4.

- [ ] **R1.19 In-house room move**
  - **Depends:** R0.6. Type change is R1.15 modify.
  - **Prototype:** Front Desk `showMoveModal` (target room + reason).
  - **Live:** `assignRoom` is used on Check-in only.
  - **Locked:** POST existing `reservations.assign_room` for a `checked_in` stay to another **clean, vacant, same-type** room with a required reason (front-office comment or audit details). Invalidate `['board']`. Different type = **R1.15** `reservations.modify`. Not a $0 reservation. Not drag-on-tape.
  - **Tests:** old room free, new room occupied; dirty/OOO/occupied target rejected.

- [ ] **R1.20 Guarantee + check-in auth workflow (no PAN)**
  - **Depends:** R1.4. Real card capture is R5.4.
  - **Prototype:** Booking wizard step “Billing & Guarantee”; Front Desk pre-auth modal with card number/CVV.
  - **Locked:** Do **not** add `guaranteeMethod` if the folio payment already records the guarantee. Consume `pms.booking.require_prepayment` inside confirm/check-in (hide the toggle until then — R0.11). Card path = existing **simulate** authorize ([payments simulate](../superpowers/specs/2026-08-06-payments-ledger-simulate-design.md), [card last4](../superpowers/specs/2026-08-14-card-last4-brand-design.md)). Check-in shows last4/brand if present — never PAN/CVV. Cash / pay-at-hotel = no authorize required unless the config is on.
  - **Out:** PAN/expiry/CVV; `held` inventory; a second payments Worker.
  - **Tests:** require_prepayment blocks check-in with zero captured/authorized STAY money; simulate authorize unblocks; no card-number input in web-pms.

---

## Track 2 — Look like the prototype (interaction + kit, not Tailwind)

Do after R0.11 at minimum (audit UI). Can run in parallel with Track 1 slices that do not share screens.

- [ ] **R2.1 Nav IA**
  - Sidebar order matches prototype **roles we keep:** Dashboard, Room Plan, Front Desk, Reservations, New Booking, Housekeeping, Guests, Rates, Folios, Night Audit, Settings. Quiet: Inventory, Staff, Roster, Exceptions, City ledger, Shift.
  - **Night Audit stays in the sidebar.** The prototype only CTAs it from Dashboard; live already has a nav item — keep it.
  - **Out:** Whistle button, Simulation Active, role-swap, property-switcher (until **R4.4**).
  - Gate: `check:spa-page-chrome`, `check:web-pms-me-gating`. Roster nav `roster:read` (audit U16).

- [ ] **R2.2 Screen titles and hotel name**
  - Arrivals / Departures / In house titles (audit I5). Drop “The Meridian Seattle”. One h1.

- [ ] **R2.3 Dialog / EmptyState / Alert sweep**
  - Remaining `window.confirm`, JSON `<pre>`, bare `<p>` status (audit I3/I7/I8/Q18). One Dialog.

- [ ] **R2.4 Print + registration card**
  - CSS only `.reg-card`; never UUID room (audit U5/I6). Already a view — make it match prototype card fields (guest, dates, room **code**, rate plan name).

- [ ] **R2.5 Folio / Book / Check-in layout**
  - Interaction parity: tenders as table, quote as money, room picker by code. Do not rebuild as a second billing app. Stay on ui-kit.

- [ ] **R2.6 Role-based nav (not impersonation)**
  - Prototype `App.tsx` has a 4-role switcher and a housekeeping-only fallback. **Lock:** live RBAC + `PermissionRoute` already; send a HK-only actor to Housekeeping as home. **Do not** add role impersonation or a fake four-role toggle.

When Track 1 + Track 2 open boxes are gone, a GM can walk every **Phase 1** prototype screen on live data and it looks like HospAI, not a lab.

---

## Track 3 — Config honesty + leftovers named in architecture

- [ ] **R3.1 Config register vs Settings UI**
  - Every visible Settings control maps to a register key that pms-core **reads**. Hide the rest. `EXCLUDED_PROTOTYPE_KEYS` stay excluded or get a spec to include them.
  - **Prototype:** 89 keys. **Do not** re-derive classification; extend `packages/contracts/src/config/register.ts`.

- [ ] **R3.2 Recurring / fixed charges (named leftover — still Phase 1-adjacent)**
  - Architecture deferred this. **When** you take it: schedule table, post inside existing `POST_ROOM_CHARGES` (no 9th step unless pin updates), snapshot `amountMinor`, honour `no_post`. Until then keep **unchecked** only if product pulls it forward; default is **after Track 1**.

- [ ] **R3.3 Rate-plan inclusions**
  - Deferred with R3.2. Do not add a JSON column nobody posts.

- [ ] **R3.4 Early-departure command**
  - Same as audit L6 / R0.14. If R0.14 is done, tick both.

- [ ] **R3.5 B3 HTTP `noPost` on guest PATCH**
  - Audit Vertical 14. SPA already uses front-office RPC.

- [ ] **R3.6 Launch-country tax model**
  - ARCHITECTURE §7.9 / §14: pick the launch country before Phase 1 **architecture** closes — it constrains folio and tax.
  - **Locked:** record the country in ARCHITECTURE (or a contracts constant the tax engine already reads). Do **not** invent a country. If unnamed, this slice is **Blocked** — tell the human.
  - Fiscalization / `held` remain **R5.5**.

- [x] **R3.7 Cross-store purge Workflow**
  - **Shipped.** Spec: [purge workflow](../superpowers/specs/2026-08-12-purge-workflow-design.md). Code: `PurgeWorkflow`, certificates, `guest.erased` consumer. **Do not rebuild.** Iceberg skip remains honest on the certificate.

- [x] **R3.8 ARI KV + staleness SLA + reject-on-commit**
  - **Shipped.** Spec: [ARI KV projection](../superpowers/specs/2026-07-29-ari-kv-projection-design.md). Binding `ARI_KV`; book uses `quoteAriVersion`. **Do not rebuild.** R4.2 is the public-engine consumer.

- [ ] **R3.9 Degraded SPA watermarks (gap-fill only)**
  - `StaleWatermark` + exception workbench already ship. Walk remaining screens: every `READ_STALE` / `QUEUE_PROVISIONAL` / `FAIL_CLOSED` path the clerk can hit shows a watermark or Alert. Do not add a second banner system.

---

## Track 4 — Phase 2 add-ons (prototype Distribution / Booking Engine / Groups)

Start only when Tracks 0–2 Phase-1 boxes are `[x]` (R3.2–R3.5 leftovers may remain). **R3.1** must be `[x]`. ARI KV is already `[x]` (**R3.8**). Each add-on is a **gated module** (`ARCHITECTURE.md` §14 Phase 2). Core never imports add-ons.

- [ ] **R4.1 Group blocks / allotments**
  - **Prototype:** Settings split inventory + group as reservation flag.
  - **Locked:** own aggregate, not a reservation flag (§7.4). New module + entitlement.

- [ ] **R4.2 Booking engine (direct book + preview)**
  - **Prototype:** `BookingEnginePreview.tsx`, `BookingEngineSettings.tsx`, `OnboardingDashboard.tsx` (first-hotel wizard — may ship as ops, not the public engine).
  - **Locked:** public site Worker + Static Assets; consume existing **ARI_KV** + reject-on-commit; photos from R2 (unlocks deferred type photos). Entitlement `pms.booking_engine` or catalog equivalent. Do not re-derive the ARI spec.

- [ ] **R4.3 Channel manager (2–3 OTAs)**
  - **Prototype:** `ChannelManager.tsx`, `DistributionSettings.tsx`, Rates `channels` tab.
  - **Locked:** gated module, outbox consumers, no special cases in PropertyDO. Plan-scoped restrictions **may** land here (ARCHITECTURE lock).

- [ ] **R4.4 Multi-property switcher (ops, not projections)**
  - Prototype header property dropdown. Until §7.6 projections: switch `propertyId` in the SPA from `/me` property list. Isolation is structural (one DO per property) — do not query across properties.

- [ ] **R4.5 Outbox consumers + Queue workers**
  - ARCHITECTURE Phase 2 mechanism proof. **Locked:** required before or with **R4.3**. No special cases inside PropertyDO. Do not start R4.3 if events have no consumer.

---

## Track 5 — Phase 3 (prototype Yield, Whistle, Marketplace, POS)

- [ ] **R5.1 Yield Analytics / dynamic / forecasting tabs**
  - **Prototype:** `ReportsAnalytics.tsx`, Rates `dynamic` / `forecasting`.
  - **Locked:** revenue-management module. Occupancy forecast OLTP may feed it; **no** competitor scraper theater. The prototype tab that `alert()`s “+20% surge applied” is the spec of *what clerks expect to configure* — implement rules + ledger writes, not that stub.

- [ ] **R5.2 Whistle (guest engagement group)**
  - **Prototype:** `WhistleHub.tsx` + `whistle/*` (inbox, automations, contacts, tasks, upsell, analytics, profile).
  - **Locked:** module **group**, entitlement per sub-module. Events by `guest_ref` only. **This slice owns transactional email** (confirm / cancel / no-show templates + real send) plus inbox, automations, scheduled campaigns, concierge **tasks**. `guest_ref` on events; plaintext only on the mailer path from OrgDO. Guest with no email: skip + audit, do not fail the reservation command.

- [ ] **R5.3 Marketplace + public API**
  - **Prototype:** Settings `marketplace`.
  - **Locked:** OAuth, webhooks, versioned HTTP. Idempotency already command-scoped (R0.8).

- [ ] **R5.4 POS / Stripe self-serve**
  - Finance gateways become real; PCI isolation (`ARCHITECTURE.md` §13).

- [ ] **R5.5 Fiscalization + `held` behaviour**
  - Launch-country fiscal. Staff blocks use `held` (Phase 3). Country itself was **R3.6**.

- [ ] **R5.6 Self-serve plans + usage billing**
  - ARCHITECTURE Phase 3. Stripe billing for plan changes; metered add-on usage. Do not start from Finance sandbox copy (R1.12).

- [ ] **R5.7 Multi-property projections (§7.6)**
  - Distinct from the **R4.4** switcher. Projections are the read model for org-wide views. Do not scan every PropertyDO from the SPA.

- [ ] **R5.8 Partner sandbox**
  - Workers for Platforms or dynamic Worker loader. After **R5.3**.

---

## Prototype → live map (status)

| Prototype section | Prototype file | Live today | Track |
|---|---|---|---|
| Dashboard Hub | `Dashboard.tsx` | summary widgets on board; no Hub nav | R1.1 (compose existing GET) |
| Room Plan Timeline | `TapeChart.tsx` | `/board` | R0.6, R1.3, R2 |
| Front Desk Board | `FrontDesk.tsx` | `/arrivals` etc. + BoardSummary | R0.6, R1.3, R1.19, R1.20, R2.2 |
| Cash drawer / shift | Front Desk cash | `/shift` + AppShell strip | R0.14, R1.16 honesty |
| Reservations **list** | `Reservations.tsx` list | `/reservations` | shipped |
| Reservations **stay card** | `Reservations.tsx` selected stay | missing SPA | **R1.15** (HTTP exists) |
| New Booking | `BookingWizard.tsx` | `/book` (adults, hold, promo, search) | R1.4 remainder, R1.20 |
| Housekeeping Desk | `Housekeeping.tsx` | board + assign + workload | R1.9 (priority, inventory, **maintenance module**, roster skills) |
| Rates & Yield | `RatesAvailability.tsx` | `/rates/*` | R1.7, R5.1 |
| Guest CRM | `GuestsCRM.tsx` | `/guests` | R1.8 (DEMO-READY P1) |
| Folio Ledger | `FoliosBilling.tsx` | `/folio/:id` only | R1.2 |
| Folio extras (promo, damage, no-post, invoice) | stay + billing | money-ops + FolioScreen | shipped; wire on R1.15 if missing |
| Folio routing rules | Front Desk / Settings | Settings charges | shipped — do not rebuild |
| Night Audit | `NightAudit.tsx` | `/night-audit` (keep in nav) | R1.10, R0.7 |
| Exceptions | — (platform) | `/exceptions` | shipped |
| City ledger | — | `/city-ledger` | R0.3 honesty |
| Settings Property | `Settings.tsx` | `/settings/property` | R1.6, R3.1 |
| Settings Accommodations | Property subtab | Inventory screens | R1.18 |
| Settings Guests | `Settings.tsx` guests | key exists, no UI | R1.17 |
| Settings Users | `Settings.tsx` | `/staff` | R1.11 |
| Settings Finance | `FinanceSettings.tsx` | tax + charges | R1.12 |
| Settings Tickets | `TicketsSettings.tsx` | missing | **R1.9** maintenance module; concierge **R5.2** |
| Settings Email | `Settings.tsx` email | missing / session stub | **R5.2** |
| Guarantee / pre-auth | Booking + Front Desk card modal | simulate authorize + last4 | **R1.20** (no PAN) |
| In-house room move | Front Desk move modal | check-in assign only | **R1.19** |
| Products | `ProductsSettings.tsx` | charge codes | R1.5 **module** |
| Booking engine | `BookingEngine*.tsx` | missing | R4.2 (ARI_KV already ships) |
| Distribution / channels | `ChannelManager.tsx` | missing | R4.3 (needs R4.5) |
| Yield Analytics | `ReportsAnalytics.tsx` | missing | R5.1 |
| Whistle | `WhistleHub.tsx` | missing | R5.2 |
| Onboarding | `OnboardingDashboard.tsx` | demo seed only | R4.2 ops |
| Marketplace | Settings tab | missing | R5.3 |
| Property switcher | header dropdown | missing | R4.4 |
| Multi-property projections | — | missing | R5.7 |

---

## Session definition of done (every slice)

A slice is not done until **all** are true:

1. Checkbox in **this file** flipped to `[x]` in the same change-set (or the implementer commit that finished it).
2. `AGENTS.md` checklist for new routes/commands/screens satisfied.
3. `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` green.
4. Catalog/schema/night-audit pins updated if lists changed.
5. Prototype interaction preserved; platform rules (integers, ledger, OrgDO PII) preserved.
6. No new Settings control that pms-core does not read.
7. No Playwright, Redis, PropertyDO extraction, Tailwind, or token restyle.

**Whole PMS (Phase 1 operator)** is done when Tracks 0–2 are all `[x]` and **R3.1** is `[x]`. **Phase 1 architecture** additionally wants **R3.6–R3.9** (tax country may stay Blocked). **Whole prototype product** is done when Tracks 4–5 are `[x]` as well.

---

## Blocked / do not invent

If you hit one of these, **stop and tell the human** — do not pick a silent alternative:

- Need a new entitlement feature key not in `FEATURE_KEYS`.
- Need to grow `NIGHT_AUDIT_STEPS` (forbidden without an architecture amendment).
- Need to scan reservations for availability.
- Need to extract folio from PropertyDO.
- Disagreement between prototype UX and a **KEEP** architecture lock (e.g. pending vs inquiry). Record in ARCHITECTURE §16.3 rule 4; do not silently match the prototype.
- Launch country unnamed (**R3.6**).
- Need to store PAN, CVV, or magstripe in this repo.
- Need to clone `TicketsSettings.tsx` layout or add role impersonation.
- Need to widen `tender_type` beyond `CARD` \| `CASH`, add Phase 1 email, extra stay `guest_ref`s, warehouse trends on the desk, or a second occupancy scan.

---

## Catalog pins (refresh each session)

At roadmap authoring (`461d391`):

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` | length **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes, last `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

After a slice that adds a command/route/migration, **edit this table** in the same PR so the next agent does not use stale heads.

---

## Suggested first coding session

If the human says “work the roadmap”:

1. **R0.1** (provision graft) — audit Vertical 1. Highest severity. Characterization test first.
2. Then **R0.2** → **R0.3** → **R0.6** so staging and the desk are honest.
3. Then **R1.1** Dashboard Hub — first missing prototype **screen**.
4. Continue first `- [ ]` in this file.

Do not start R4/R5 because they are more fun. The prototype “looks complete” only after Track 1 screens exist (including **R1.15** stay card) and Track 0 does not lie.
