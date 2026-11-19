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

**Revision:** 2026-10-31 fork decisions — the user accepted the recommendations on [F1–F4](#fork-decisions) and the R4.22–R4.32 slices. R4.14 gains the three R1.10 reports; R6.2 becomes per foreign national. Prior: 2026-10-31 BluePMS inventory pass — the feature inventories on the module pages were read against all 58 ticks ([comparison](research/2026-10-31-bluepms-inventory-vs-slices.md)): 27 covered, 29 partly, 2 missing. Adds **R4.22–R4.32** to Track P, widens **R4.11**, **R4.13**, **R4.15**, **R4.16**, **R4.18**, **R4.20**, **R4.21**, **R5.5**, corrects **R1.19**, moves **R4.16** after the reports, adds four forks and a live walkthrough to the go-live checklist. Track and queue rules are unchanged. Prior: 2026-10-27 India pilot pass — the pilot client's returned BluePMS checklist ([research](research/2026-10-27-pilot-client-checklist.md)) becomes the scope of a new **Track P** ahead of the Canada launch. **R3.6** decides India first (Canada follows as **R4.19**). Moves **R4.5**, **R4.3**, **R4.12**, **R4.8** out of Track 4, **R4.13** and **R4.11** out of Track 5 and **R5.5** out of Track 6 into Track P; adds **R4.14** (named report set), **R4.15** (guest ID documents + consent), **R4.16** (read-only copilot), **R4.18** (India tenders fork), **R4.19** (Canada readiness), **R6.2** (Form C), **R4.21** (POS connector) with **R4.9** pulled forward from Track 5, and **R4.17** (built-in POS, parked in Track 6). 2026-10-28: **R4.3** becomes a connector to a third-party channel manager (§16.6 *Integrate*) — no channel manager of our own, no direct OTA integration. After the client confirmed every tick is a must-have: **R4.20** (day-wise rate override); guest preferences join R4.15, guest requests join R4.11. **R5.4** loses its POS-lite scope; **R4.11** no longer waits on R4.10. Prior: 2026-09-12 packaging + AI layer pass — adds **R3.10** (entitlement catalog per the revised `ARCHITECTURE.md` §6.7), **R4.6** / **R5.9** (in-product AI), **R5.11** (external MCP surface, `ARCHITECTURE.md` §10.2) and **R5.10** (public agentic distribution), and flags the **R5.7** sequencing question. The three agent surfaces are deliberately separate — see §10.2. Adds **R4.7** (live acquiring pulled forward from R5.4), **R4.8** (migration importers — previously absent), **R4.9** (on-property interface framework) and **R4.10** (mobile app for housekeeping and communication — decided; §9.1 added); records Canada / India / Australia in §7.9 and decides **R3.6**: Canada, starting with Ontario and British Columbia; flags the **R4.2** confirmation-email fork as blocking. Adds **§16.6** (production scope for the BluePMS parity hubs) with **R4.11** (housekeeping depth), **R4.12** (accounting export), **R4.13** (front office depth), **R5.12** (lean banquet) and a POS-lite scope on **R5.4**; the prototype-as-spec rule now covers only surfaces §16.5 / §16.6 place in scope. Sequencing pass: **R4.5** opens Track 4 (R4.3 depends on it); **R1.4** follows **R1.5** and **R1.6**; **R4.8** Stage B moved into **R5.7**; **R5.8** back in numeric order; **R3.6** and **R3.10** added to the Track 4 gate; **R1.5** tax group locked to a §7.9 product class; card-capture references point at **R4.7**. Stage resequencing: Track 4 is the **Canada launch** (R4.5, R4.7, R5.2, R4.2, R4.3, R4.12, R4.10, R4.8, R5.6), Track 5 **upscale properties and groups**, new Track 6 **India and later bets** with **R6.1** (WhatsApp); resolves the **R4.2** email fork and the **R5.7** sequencing flag. Moves `held` behaviour out of R5.5 into new **R5.13** after R5.7, since group central reservations need TTL holds before India. Prior: 2026-09-04 code + spec + architecture pass. Queue hygiene: R0.x id lists match the audit vertical membership (not a summary); **R1.13** is a tombstone, not a hole. Do not re-derive a surface that already has an accepted spec in `docs/superpowers/specs/`. Phase 1 must not contradict ARCHITECTURE.md §14–§16.6 or a named leftover in a shipped spec.

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
**Do not** start Track P (India pilot) while **Tracks 0–2** still have open Phase-1 boxes. **R3.1**, **R3.2**, **R3.3**, **R3.6** (tax model) and **R3.10** (entitlement catalog) must be done — Track P posts money, computes tax, builds packages on recurring charges and reads feature keys that do not exist without them. **ARI_KV already ships** — R4.3 and R4.2 consume it.
**Do not** start Track 4 (Canada launch) while Track P has open boxes, Track 5 while Track 4 does, or Track 6 while Track 5 does. Slice IDs are stable labels, not positions — R4.x, R5.x and R6.x slices live wherever the stage that needs them is.

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
- **Same clerk flows:** tape click → stay; walk-in / Open Reservation; book → quote $ → Inquiry/Hold(`PENDING`)/Confirm; stay card modify/cancel/no-show; in-house room move; check-in by room **code**; folio as a bill; HK dirty→clean; night audit as a job; shift open/close. Confirmation email is **R5.2** in Track 4 (Canada launch), not Phase 1.
- **Chrome:** existing P0-3 tokens (sage `#4A5D4E`, cream, IBM Plex). `PageHeader` + `Card`. One `<h1>`. Live `property.name`.
- **Not:** Tailwind v4, `lucide-react`, `recharts` as a product, pixel-identical CSS, prototype booking-engine “LIVE DIRECT BOOKING INTERFACE SIMULATION” chrome, role impersonation, Opera fake sync, competitor scrape.

### All features functional

- Every prototype **core-PMS** behaviour that ARCHITECTURE §16.5 marked **KEEP** (or shipped) works on PropertyDO/OrgDO/HTTP/SPA. Prototype **add-on hubs** follow **§16.6**: only modules classified *Core* or *Add-on* there are built.
- **Stub UI is still in scope.** If a clerk would click it in a hotel, implement it for real even when the prototype only `alert()`s, uses React state, or is half-broken. Do not skip a surface because the prototype is fake. Rebuild against live APIs (integers, ledger, OrgDO PII). **This covers only surfaces §16.5 or §16.6 place in scope.** A hub §16.6 classifies *Integrate* or *Avoid* — Payroll & HR, Purchase, stores Inventory, F&B costing, full restaurant POS (integrated through **R4.21**), Spa, Transport, Hostel, sales-pipeline CRM — is not built at any fidelity: not a stub, not a screen.
- Settings keys the SPA shows are **read** by pms-core (or hidden).
- City-ledger AR actually posts (audit L1). Board updates after check-in without waiting on WebSocket (audit U1).
- Prototype **Phase 2/3** surfaces (channel manager, booking engine, groups, Whistle, yield engine, marketplace, POS) stay on Track P and Tracks 4–6. When those slices run they must be real modules — not a nicer `alert('synced')`. They are not Phase 1.
- **Specs win over a blank-page rebuild.** If `docs/superpowers/specs/*` already designed the command, HTTP, and leftover list, implement that spec (or the named leftover). Do not invent a second product.

### Architecture / spec compliance (do not violate)

| Tempting prototype / earlier roadmap line | Normative lock |
|---|---|
| 7-day occupancy Recharts on Dashboard | **Warehouse** (§7.8). Phase 1 Dashboard is **today’s** OLTP (`get_front_desk_summary`). |
| Guest LTV / merge / passport / ID files | Guest CRM spec deferred LTV and merge; LTV trends = warehouse. ID documents and consent are **R4.15** (Track P). Stay history already ships. |
| Additional named guests as extra `guest_ref`s | Holes sweep: party = `adults`/`children` only. No second profiles. One exception (**F4**): the **R6.2** Form C person record, which is not a guest profile. |
| Inventory `held` / wizard “hold a room without selling” | `held` unused until **R5.13** (Track 5, §7.1). Live **Hold** = `PENDING` (`sold++`), via `reservations.hold` / create-as-pending. |
| CHECK / VOUCHER / GIFT tenders | Cashiering spec settled `CARD` \| `CASH` only. Do not widen the CHECK. |
| Transactional email in Phase 1 | Guest engagement is **R5.2** in Track 4 (Canada launch), not Track 1. |
| Valet / coffee tickets inside HK | §16.1 **maintenance module** = work orders. Concierge tickets = Whistle **tasks** (R5.2). OOO emits `room.ooo_changed`; tickets subscribe (HK leftover 5). |
| HK reports tab | Not a catalogue tab. The pilot's housekeeping reports are the named **R4.14** set (list per **F3**). Workload counts already on the HK board. |
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
| Staff blocks as $0 reservations | `held` unused until **R5.13** (Track 5) |
| Prototype config keys (`EXPECTED_PROTOTYPE_KEYS` **97** — not the catalog length 89) | Classified config register |
| DND as `room.status` | Stay flag `dnd_flag` only |
| HK budgeting / metrics / mobile | Dropped from Phase 1 (holes sweep). Workload counts on the HK **board** already ship. HK reports only as the **R4.14** set. |
| HK **inventory** (linens/stock) and **manager priorities** | **KEEP** — §16.1 core HK; not in the drop list |
| Settings **Tickets** (valet SLA, inspections, escalations) | **Maintenance module** (R1.9) for property work orders. Concierge tickets + SLA email = Whistle **R5.2**. |
| Keyless / door-lock | Dropped |
| Room-type photos | Deferred (booking engine **R4.2**, Track 4) |
| Recurring breakfast/parking engine | Deferred (named leftover) |
| Plan-scoped restrictions | Type-wide `*` until channel-manager phase |
| Rate-plan inclusions JSON | Deferred with recurring |
| PAN / CVV / raw card fields | Never in PMS. Guarantee **workflow** is Phase 1 (R1.20); card capture is payments Worker (R5.4) |
| Folio transfer to **another reservation** | Rejected (`transfer_cross_reservation`). Charges move between **windows on the same stay** (GUEST/COMPANY). Holds unless client Q17 lifts it under **F1**. |
| “Add 5 Arrivals”, booking-engine simulation chrome, Opera fake sync, competitor scrape | Investor theater — never build |
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
| Settings → Guests | **R1.17** shipped 2026-11-17. Four create-time profile rules. |
| Settings → Accommodations | **R1.18** shipped 2026-11-17: links to Inventory and Housekeeping. |
| Booking wizard remainder | **R1.4**. Already ships adults, Inquiry/Hold/Confirm, promo, guest search. Remainder: consume booking Settings keys or hide (R0.11); add-ons via **R1.5**; source/segment via **R1.6**; FAIL_CLOSED disable. |
| Billing & Guarantee / PAN modal | **Shipped** (R1.20, 2026-11-18). Check-in reads `require_prepayment`; confirm is not gated. Simulate `folio.authorize` + last4. No PAN. No new route, command, or migration. |
| Open Reservation / walk-in | **R1.3** → `/book` with today. Tape spec allows navigate; not a new assign POST. |
| In-house room move | **R1.19** shipped 2026-11-17 via existing `reservations.assign_room` on `checked_in`. |
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
| Card-brand matrix / channel routings | Hide until **R5.4** (card-brand matrix) / **R4.3** (channel routings). Live acquiring is **R4.7**. Invoice numbering stays **R1.12**. |

---

## Track 0 — Make what we already shipped true

**Source of truth:** [2026-09-04 audit](audit/2026-09-04-full-codebase-audit.md). Execute those verticals **in audit order**. Tick here when that audit vertical is merged and `pnpm test:local` is green. Each R0.x line lists **every** audit id in that vertical — implement the vertical body, not the paraphrase.

Do not start Track 1 while R0.1–R0.6 are open (security + AR + desk freshness). R0.7–R0.14 may interleave with Track 1 only if the Track 1 slice does not touch the same files; prefer finishing Track 0.

- [x] **R0.1** Audit V1 — S1/S3/G1 provision graft. `provision.ts` org match; 409 no foreign row; failing cross-org test first.
- [x] **R0.2** Audit V2 — N4, N5, G12, S5, N12. azp, headers, Bearer-or-Origin, smoke JWT mask.
- [x] **R0.3** Audit V3 — L1, L2, L3, L4, U8, G2, G10. city-ledger AR posts on transfer/checkout; honest toast; smoke AR step.
- [x] **R0.4** Audit V4 — S2, S7. property-scoped guest and roster lists (two-property test).
- [x] **R0.5** Audit V5 — N6. per-org HKDF master key + comment lie.
- [x] **R0.6** Audit V6 — U1, U2, U3, Q5, G6, P2, P4, G9. Board invalidate, terminal Check-in disabled, tape query key, guest batch chunk 50. G6/G9 are the SPA tests that would catch U1/P2/P4 — land them in this vertical.
- [x] **R0.7** Audit V7 — N1, L5, L7, L8, G3, P6. DST two-pass; per-reservation ROOM catch + rewrite case 17 in the same PR; `auto_no_show=false` must not post ROOM for confirmed-not-arrived (L7); pending expires on `confirmBy`, not arrival-only (L8).
- [x] **R0.8** Audit V8 — N3, X1, P5, N10, Q11, N2, S6, Q3. array caps (rates, rooms, split, roster `kinds`); JSON 400 helper; fingerprint `{ commandId, payload }`; catalog lane vs `touchInteractive()`; idempotency key prefixed with user; same object hashed as sent (virtual type constituents).
- [x] **R0.9** Audit V9 — S4, X2, N7, X3. kill-switch on cancel/purge; replay re-checks original actor; degraded allowlist + one module; missing R2 terminal-fail/DLQ (not infinite retry).
- [x] **R0.10** Audit V10 — Q1, Q2, Q6, Q7, Q8, Q9, Q10. one `commandErrorHttpStatus` (`entitlement_required` → **402**, `not_member` → **404**); `{ ok: false, error }`; decrypt miss not 500; typed catch not blanket forbidden.
- [x] **R0.11** Audit V11 — U4–U17, I1–I15, E3, Q4, Q18, Q19, L12. RateCell `VisuallyHidden`, one h1, Dialog, print CSS, hide unread Booking settings, Alerts, live hotel name, checkout remaining-nights **warning** (do not release `sold` — that is L6 / R0.14).
- [x] **R0.12** Audit V12 — P1, N8, P3, P7–P13. `resolvePropertyContext(..., ctx.tenantProperty)` everywhere (do not skip `assertTenantActive`); name search not decrypt-200; folio mount deferral; lazy admin routes; queue poll only while non-empty; P8/P11 **keep**; tape UI cap-14 if the picker is touched (P13).
- [x] **R0.13** Audit V13 — G4, G5, G7, G8, G11, N9. deploy needs green CI SHA; web-pms `*.tsx` coverage; crypto-shredding `test:coverage`; eslint recommended; no Playwright; shard topology unchanged. G10 smoke lives in R0.3.
- [x] **R0.14** Audit V14 — L6, L9–L11, L13, N13, N14, Q12–Q22 (B3 `noPost` HTTP). named early-departure command; cash/FX/OOO; `freeAvailability` single import; architecture write-down.

When R0.1–R0.6 are `[x]`, the 8-minute demo path is **honest** (AR, board, azp). Then Track 1.

---

## Track 1 — Core PMS feature parity (Phase 1 KEEP)

Each slice is one vertical. Prototype path is relative to `hospai-pms-prototype/src/components/`.

### R1 — Front office surfaces the prototype still has and we do not

- [x] **R1.1 Dashboard Hub**
  - **Depends:** R0.6 (board keys).
  - **Prototype:** `Dashboard.tsx` (occupancy, arrivals/departures, ADR, available-rooms entry, night-audit CTA). **Not** Yield Analytics charts.
  - **Live:** `BoardSummary` on `/arrivals` etc. (`get_front_desk_summary`). No Hub nav item.
  - **Locked:** Add `/` or `/dashboard` as the first nav item. **Compose existing reads** — occupancy/arrivals/due-out/in-house from `get_front_desk_summary` (tape-chart spec), available-rooms from existing GET, night-audit CTA to `/night-audit`. VIP arrivals = filter existing arrivals by `vipFlag`. Spec: [tape chart + live board](superpowers/specs/2026-08-13-tape-chart-live-board-design.md).
  - **Out:** 7-day occupancy trend (warehouse §7.8); recharts; competitor scrape; Whistle inbox; “add 5 fake arrivals”; a second occupancy calculator that scans reservations.
  - **Tests:** Hub numbers match `get_front_desk_summary` for a seeded day; available-rooms omit occupied+OOO.
  - **Shipped (2026-10-28):** `/dashboard` (`DashboardScreen`), first nav item; the index route redirects there and `/board` keeps the tape. Composes `get_front_desk_summary` (the shared `BoardSummary`), `get_front_desk_available_rooms` for tonight, today's arrivals filtered by `vipFlag`, and a Night audit link shown only with `night_audit:run`. ADR is left out — no existing read returns it, and a client-side calculation would be a second money path. Supersedes the tape spec's *no `/dashboard`* lock (§7.2, open question 5). The occupied+OOO exclusion is the server's ([tape spec](superpowers/specs/2026-08-13-tape-chart-live-board-design.md) test 6); the Hub shows that list's count.

- [x] **R1.2 Folio directory (prototype Billing nav)**
  - **Depends:** R0.3 (AR honest).
  - **Prototype:** `FoliosBilling.tsx` search → pick stay → ledger.
  - **Live:** only `/folio/:reservationId`. Add `/folios` (or `/billing`) directory: in-house + due-out, search by guest name / reservation id, row → existing FolioScreen.
  - **Locked:** no new money model. Permission `folio:read`.
  - **Tests:** directory lists checked_in; click path uses existing folio GET.
  - **Shipped (2026-10-28):** `/folios` (`FoliosDirectoryScreen`), nav *Folios* behind `folio:read`. Lists in-house stays from the existing in-house read (shared `['board', 'in-house', …]` key), marks *Due out today* and *Overstay* against the property business date, and opens the existing `/folio/:reservationId`. Search filters the loaded rows by guest name or reservation id; when nothing in house matches, it falls back to the existing exact `get_reservation_search`, so a departed stay's folio is still reachable by id. **No balances on the list** — showing one per row would need a folio GET per stay; the folio screen keeps the money view.

- [x] **R1.3 Tape / Front Desk interaction leftovers**
  - **Depends:** R0.6, R0.11.
  - **Prototype:** `TapeChart.tsx`, `FrontDesk.tsx`, `AvailableRoomsModal.tsx`.
  - **Live:** `TapeChartScreen.tsx`, `BoardScreen.tsx`.
  - **Locked:** tape empty-cell → **navigate** to `/book` with dates/type query params (tape spec: no new assign POST on the tape). Available-rooms already has a GET — surface it as a modal or Room Plan action that books. **Open Reservation / walk-in** = `/book` with arrival = property today. Board already shows VIP/DND badges — add **VIP-only filter**. **Post incidental** Dialog → existing `folio.add_item`. Assign-room from **arrivals board** may POST `reservations.assign_room` (not drag-on-tape). Cancel check-in: wire existing HTTP on **R1.15**. Dirty-room: keep cleanliness gate. Tape OOO uses existing ranges.
  - **Out:** “Add 5 arrivals”; PAN pre-auth modal; drag-to-move on the tape.
  - **Shipped (2026-10-28):** empty tape cells from the property's today onward link to `/book?arrival=&departure=&roomTypeId=` (past cells stay inert; no assign POST on the tape); Available rows get **Book** with the shown stay and type; `BookingScreen` prefills from those params and ignores a stay whose departure is not after arrival. Front Desk header: **Walk-in** (`/book` for tonight) and a **VIP only** filter (`?vip=1`) across arrivals, departures and in-house, with VIP-specific empty copy. **Assign room** on unassigned arrivals lists free rooms of the booked type for the stay (`get_front_desk_available_rooms`, dirty rooms included — check-in keeps the cleanliness gate) and POSTs `reservations.assign_room`, invalidating `['board']`, tape, available and summary. **Post charge** on in-house rows posts through the existing `folio.add_item` route in minor units, hides archived codes and every do-runtime `SYSTEM_CHARGE_CODES` entry plus `TAX` (a test pins the list), and defaults to `MISC`. Both dialogs are one `FormDialog` in the `.app-modal` language with a focus trap. **Cancel check-in stays on R1.15.**

### R1 — Inventory / rates / products

- [x] **R1.5 Products catalog (not only charge codes)**
  - **Depends:** none after R0.1.
  - **Prototype:** `ProductsSettings.tsx` (categories, SKU items, add-ons, tax code).
  - **Live:** Settings → Charges (`charge_code` rows).
  - **Locked:** new **`modules/pms/products`** module (§11), not a Settings-only dump into PropertyDO. Category + item + default `amountMinor` + `chargeCode` + tax group. Folio “post charge” picker uses **products** for incidentals; system codes stay hidden. Charge-code registry spec remains the posting reference. **No** stock/reorder engine. `tax group` is the §7.9 **product class** key — never a stored rate or percentage; the rate resolves through the **R3.6** tax model, so Ontario and British Columbia can tax the same product differently.
  - **Pins:** new commands/routes + schema version + `src/module.manifest.ts` in the same commit.
  - **Out:** POS (third-party, via the **R4.21** connector), channel-only pricing (**R4.3**).
  - **Amended 2026-10-28 ([spec](superpowers/specs/2026-10-28-products-catalog-design.md) §2.3):** a product's tax group **is its charge code's `tax_group`** — shown read-only, never stored on the product, because tax posting already resolves by charge code and a second carrier would be config pms-core does not read. A product in another product class uses another charge code.
  - **Shipped (2026-10-28):** `modules/pms/products` (`pms.products`, `pms.core`) with migration **v35** (`products_category`, `products_item`, archive-only); commands `products.create_category` / `update_category` / `create_item` / `update_item` (INTERACTIVE, FAIL_CLOSED, audited, `products.changed`); routes `get_products` (`folio:read`) and `post_product_categories`, `patch_product_category`, `post_products`, `patch_product` (`settings:configure`). A product's charge code must be operator-postable — not a `SYSTEM_CHARGE_CODES` entry or a tax-rule output — or `charge_code_not_postable`; caps 200 categories / 2,000 items. Settings → **Products** tab; the Folio and Front Desk *Post charge* pickers list postable products by category and prefill code and price, posting through the unchanged `folio.add_item`; with no products they fall back to operator charge codes. The Folio card's existing charge-code list is unchanged. No `product_id` on folio lines yet (spec §6).

- [x] **R1.6 Amenities / sources / market segments / policies (Settings Property subtabs)**
  - **Depends:** R0.11.
  - **Prototype:** `Settings.tsx` Property subtabs `amenities`, `sources`, `policies`, `market_segments`, `split_inventory`, `spaces`.
  - **Live:** Settings property + Inventory rooms/types.
  - **Locked:** Amenities on room types if inventory already has a field — expose in Inventory SPA. Sources + market segments as OPERATIONAL lists used on create-reservation (optional fields). Policies = the Booking keys **once wired** — ship the tab hidden; R1.4 decided not to wire them (online-booking and guarantee rules), so **R1.20 / R4.2** reveal it. **Spaces** (meeting rooms) and **split inventory** (group allotment UI) → Track 4 / Phase 2; **hide** the tabs until then.
  - **Out:** hardcoded Spaces cards from prototype.
  - **Shipped (2026-10-28, [spec](superpowers/specs/2026-10-28-property-lists-design.md)):** the first slice of the OPERATIONAL config plane in **OrgDO** (v10 `operational_config` + `operational_config_audit`), allowlisted to `pms.property.sources` and `pms.property.market_segments` (typed named lists, ≤ 50 entries, codes archive-only — dropping a stored code is `config_code_removed`); routes `get_operational_config` (`reservations:read`) and `put_operational_config` (`settings:configure`, `config.put_operational`), read FAIL_CLOSED from OrgDO with the KV projection deferred to R4.2 (§5.1 note). Reservations carry `sourceCode` / `marketSegmentCode` (PropertyDO v36), set on create and edited through the front-office update; PropertyDO checks format only, never the list. Settings → **Sources & segments**; optional Source and Segment selects on Book and the stay's front-office editor. **Amenities** stay hidden (room types have no amenities field; no consumer until R4.2); **Policies** stay hidden for R1.4; **Split inventory** (R4.1) and **Spaces** (R5.12) hidden. OrgDO purge verification now uses a literal table inventory, like PropertyDO — the DO authorizer rejected the old dynamic `COUNT(*)` once the new tables existed.

- [x] **R1.4 Booking wizard remainder**
  - **Depends:** R0.11 (hide or wire Booking settings), **R1.5** (booking add-ons are products), **R1.6** (sources and market segments) — sequenced after both for that reason.
  - **Prototype:** `BookingWizard.tsx`.
  - **Live:** `BookingScreen.tsx` — adults/children, Inquiry / Hold(`PENDING`) / Confirm, promo, guest equality search, `quoteAriVersion`. Spec: [booking wizard](superpowers/specs/2026-08-11-booking-wizard-design.md).
  - **Locked:** Do **not** rebuild the wizard. Remainder: FAIL_CLOSED disables Hold/Quote/Confirm; **hide or consume** `same_day_*` / `require_prepayment` (R0.11 / R1.20); booking add-ons = **R1.5 products** posted via `folio.add_item`, not recurring (R3.2); source/segment optional fields from **R1.6**. Special requests = existing front-office comment, not a new column. **Hold is `PENDING` / `reservations.hold` — it increments `sold`. Do not use `held`.**
  - **Tests:** occupancy exceeded on submit; FAIL_CLOSED disables Hold/Quote/Confirm. Do not re-test adults/promo/search as if they were new.
  - **Shipped (2026-10-28, [spec](superpowers/specs/2026-10-28-booking-remainder-design.md)):** FAIL_CLOSED disables, occupancy copy and R1.6 source/segment were already live. Added **Special requests** — `reservations.create` takes an optional `frontOfficeComment` written to the existing column (fingerprinted; > 2,000 → `front_office_comment_too_long`; non-string → 400). Added **Add-ons** from R1.5 products — after Hold or Confirm each line posts once through `folio.add_item` (`unitMinor × quantity`, stable op ids, Retry re-posts only failed lines, the booking stands); Quote is disabled while add-on lines exist. **Booking settings stay hidden**: `same_day_*` belong to online booking (R4.2 — the desk always takes walk-ins), `booking_date_change` to future modify rules. **`require_prepayment` is shown under Settings → Reservations** (R1.20, 2026-11-18) and gates check-in only. The **Policies** tab stays hidden until R4.2 wires a remaining booking key. No new commands, routes or migrations.

- [x] **R1.7 Rates tabs the prototype shows that we skip**
  - **Depends:** R0.11 (I1 RateCell).
  - **Prototype:** `RatesAvailability.tsx` tabs: matrix, dynamic, derived, forecasting, ancillary, channels.
  - **Live:** plans (derived exists), matrix, restrictions.
  - **Locked:** **Derived** stays on Plans (already). **Ancillary** = products (R1.5) — link, do not duplicate. **Dynamic / forecasting** = **R5.1** (Track 5) and **channels** = **R4.3** (Track P, a third-party channel manager connector) — do not build occupancy-pricing or OTA rate push here. Remove or never add those tabs until those slices run.
  - **This slice:** matrix looks like a grid of numbers; restrictions type-wide only; document the missing tabs as “Channel / Yield — later” in page subtitle, not fake UI. **Bulk update** must accept a date range **and** day-of-week filter (§16.1); live already posts `rates.bulk_update` — add the DOW UI, do not uncap the array (R0.8). **Modifiers** on a plan (percent/amount, not only derived bps) if the domain already has them — expose on Plans; do not invent a second derivation graph.
  - **Shipped (2026-10-28, [spec](superpowers/specs/2026-10-28-rates-tabs-design.md)):** Tabs stay Plans / Matrix / Restrictions; the subtitle links **Add-ons: Products** (`/settings/products`) and says *Channel / Yield — later*. The matrix shows rates as text ("—" unset) with click-to-edit through `rates.put_day` and read-only restriction badges. **Bulk fill** has its own date range (≤ 366 days) plus day-of-week and type filters, previews the cell count, and sends sequential chunks of `RATES_BULK_UPDATE_MAX` (cap unchanged); Retry re-sends only failed chunks. Set-only — adjust-by-percent is yield (R5.1). **Plan modifiers:** the domain has only derived `deriveBps`, so nothing new is exposed. Fixed in passing: the Restrictions tab painted empty controls on a cold load (a CTA date looked open) and each save could revert a sibling field from a stale row. No new commands, routes or migrations.

### R1 — Guests, HK, night audit, settings ops

- [x] **R1.7a Design system re-skin (shadcn neutral)**
  - **Inserted 2026-10-29** at the user's request, ahead of R1.8. Spec: [shadcn design system re-skin](superpowers/specs/2026-10-29-shadcn-design-system-design.md); source: the *PMS Design System* artifact.
  - **Locked:** tokens + `ui-kit` styles only — no Tailwind, no shadcn/Radix imports, closed ui-kit API, desktop only. Light and dark token themes; colour gate checks both. New patterns: `StatusBadge`, `RoomStatus`, `CardHeader` eyebrow, `StatField`, `ui-quick-action`. **Not built:** the design system's charts (warehouse, R5.x), bookings side panel, tape-chart rebuild, greeting header.
  - **Shipped (2026-10-29):** shadcn neutral palette in light and dark tokens (colour gate checks both themes and their drift); Inter + IBM Plex Mono self-hosted. Sidebar-footer theme switch (System / Light / Dark, per-browser `hospai.theme`, pre-paint `theme-init.js` under CSP `'self'`). One 32px button height, one primary per view, destructive only for void/refund; badge dot removed. Overstay sits inside the In-house card; Dashboard and Folios nav icons. Layout pass to spec §10 (card anatomy, no card-in-card, `StatField`, `ui-list`, margin resets) on every screen, including the Shift receipt. No new commands, routes or migrations.

- [x] **R1.8 Guest CRM depth**
  - **Depends:** R0.4 (property-scoped list).
  - **Prototype:** `GuestsCRM.tsx` (tags, VIP, spend, stays, passport, address, sort by spend).
  - **Live:** directory + profile + property stay history + blind-index search. Spec: [guest CRM directory](superpowers/specs/2026-08-13-guest-crm-directory-design.md) — tags / guest VIP / notes / LTV / merge / passport **explicitly deferred**.
  - **Locked:** this slice **is** that deferred CRM remainder: tags + guest-level VIP + notes on OrgDO profile. Stay history already ships. **Do not** add OLTP “lifetime spend” (warehouse §7.8). **Do not** add `guests.merge` (named leftover). ID documents and consent are **R4.15** (Track P), not this slice. Loyalty = tag/VIP, not a points ledger.
  - **Out:** warehouse LTV; merge; passport / ID files and consent (**R4.15**); decrypt-on-list.
  - **§16.6:** guest CRM is *Core*. The prototype's sales pipeline — leads, opportunities, quotes, proposals, campaign ROI, customer portal — is *Integrate*; do not build it here or anywhere.
  - **Shipped (2026-10-29, [spec](superpowers/specs/2026-10-29-guest-crm-depth-design.md)):** `tags`, guest-level `vip` and `notes` live inside the encrypted OrgDO guest profile (crypto-shredded on erase; no migration). Normalised once in `@hospai/contracts` (trim, collapse whitespace, case-insensitive dedupe; empty = absent) and capped at 20 tags × 40 chars and 2,000 chars of notes — over cap → 422 `limit_exceeded` at HTTP and inside the OrgDO; the fingerprint hashes the normalised profile it sends. List and search omit notes. Profile shows a VIP badge, Preferences and Notes cards, and an edit form with tag chips, a VIP checkbox and a notes counter; the directory shows a VIP badge. Fixed in passing: profile saves reused one never-cleared idempotency key, so a second edit in a session was rejected — each save now gets its own op id. ui-kit `Input`/`Textarea` forward `maxLength`. Guest VIP is separate from stay VIP; booking prefill, tags on board/HK and tag search stay leftovers. No new commands, routes or migrations.

- [x] **R1.9 Housekeeping — KEEP core extras**
  - **Depends:** none after R0.1.
  - **Prototype:** `Housekeeping.tsx` tabs: board, priority, assignments, staff, inventory, budgeting, metrics, reports, maintenance, mobile.
  - **Live:** HK board + assign + workload counts + roster picker. Specs: [housekeeping module](superpowers/specs/2026-08-11-housekeeping-module-mechanism-design.md), [room-ops HK completion](superpowers/specs/2026-08-12-room-operations-hk-completion-design.md) leftover 5.
  - **Locked Phase 1:** **priority** (ordered rooms; un-exclude `pms_hk_manager_priorities`); **inventory** (linens/stock OPERATIONAL list; un-exclude `pms_hk_inventory`; not a warehouse); **`pms.maintenance` module** — work-order table, task types, checklists; consume `room.ooo_changed` (do not invent tickets inside HK). **Staff** = `/roster` + shifts/skills/capacity (roster leftover 7).
  - **Drop:** budgeting, metrics charts, a catalogue-style HK Reports tab (the pilot's housekeeping reports are the named **R4.14** set), valet/coffee tickets (R5.2), SLA email. *Mobile attendant is superseded — attendant work moves to the **R4.10** mobile app.* Depth extras (lost and found, damage cases, inspections, minibar and amenity posting) are **R4.11** (Track P), not Phase 1.
  - **Tests:** assign + status; OOO still fail-closed if assigned; inventory round-trip; `room.ooo_changed` opens a maintenance ticket when the module exists.
  - **Shipped (2026-10-30, [spec](superpowers/specs/2026-10-30-housekeeping-core-extras-design.md), four commits A–D):** **A Priority** — per-room manager level per business date, score computed on read, Priority tab. **B Inventory** — operational stock list with par levels and a movement log, Inventory tab; no cost or stores. **C Staff ops** — `maintenance` roster kind (OrgDO 11), per-hotel shift, room limit and skill tags via `roster.set_ops`; capacity warns, never blocks. **D Maintenance** — `modules/pms/maintenance`: tickets, task types, snapshotted checklists, `maintenance:read|write`. Manifest `subscribes` is now real: `room.ooo_changed` runs the module handler in the same transaction, one level deep, so taking a room out of order opens a ticket atomically. Resolving a ticket never releases the room by itself; the dialog offers it as a second command. Prototype keys stay excluded because they are data served by module tables. Pins: commands 104, routes 166, property schema 39, org schema 11. Named leftovers (spec §8): auto-assign, report-and-OOO in one form, reopen, SLA and escalation, public-area tickets, guest VIP in the score, issue-to-room stock (R4.11), per-property kinds, property scope on `housekeeping.assign`.

- [x] **R1.10 Night audit operator job**
  - **Depends:** R0.7 (full V7: N1/L5/L7/L8/G3/P6).
  - **Prototype:** `NightAudit.tsx` stepped wizard (checks → settle → execute).
  - **Live:** `NightAuditScreen.tsx`.
  - **Locked:** Alert on run/fail; STEP_LABELS; halt copy = review, Retry, Resume. Pre-check counts come from one server evaluator shared with PRE_CHECK. Close-out numbers = existing **SNAPSHOT_REPORTS** (`roomNet` / tax already on the screen). Do **not** grow `NIGHT_AUDIT_STEPS`. Do not print folio/invoice in `DEGRADED`. Do not clone prototype 11%/2% tax theater.
  - **"Customisable" (pilot checklist Q3), corrected 2026-10-31:** the pilot ticked *Night audit (customisable)*. BluePMS's [Front Office page](https://www.bluepms.com/modules/front-office/) defines it as **configurable checks**: on or off per check, Fail / Warn / Info, a pre-close preview, and a close log. Build that inside PRE_CHECK ([draft spec](superpowers/specs/2026-10-30-night-audit-operator-job-design.md)). Never add, remove or reorder steps (Blocked rule). **Required for the pilot (must-have).** Client answers set the check values and may add later checks; they do not block the build.
  - **Shipped (2026-10-31, [spec](superpowers/specs/2026-10-30-night-audit-operator-job-design.md)):** `/night-audit` is Checks → Run → Close-out; Settle is folded into Checks, whose rows link to the fix. `pms.night_audit.checks` sets Off / Fail / Warn / Info for five checks, default Warn, read by one evaluator shared by the preview and PRE_CHECK; queued commands and open exceptions stay fixed at Fail. Results are kept per attempt in `night_audit_check_result` and shown in a 30-date log (`get_night_audit_check_log`). Property schema 40 adds that table and `reservation.checked_out_business_date`. Also fixed: raw step ids on screen, success styled as failure, and a fixed Retry key that replayed an old failure. Pins: routes 167, property schema 40. Named leftovers (spec §3): open folio, arrival deposits, ID proof, country/state, POS and tax document checks wait for their slices; BluePMS's three night audit reports are R4.14. Client answers (checklist Q3) set the hotel's values in Settings.

- [x] **R1.10a House Colour design system** — shipped 2026-11-02
  - **Inserted 2026-11-01** at the user's request, ahead of R1.11, as R1.7a was. The user chose direction B, House Colour, from the [design directions](https://claude.ai/artifact/928HJzm7iNMDaWzN4WuBT4), and gave Room Plan a new layout. [Spec](superpowers/specs/2026-11-01-house-colour-design-system-design.md); source: the [HospAI Design System](https://claude.ai/artifact/DFaKPMdLQ6p3EguMCMCRSA) artifact.
  - **Scope:** the tokens, Figtree and the colour gate; one money and date formatter (Indian formats, property-driven); one `Dialog`, `Tabs` everywhere, `EmptyState` kinds and `Skeleton`, with the duplicate classes removed; `TopBar`, `Band` and `GlobalSearch`, including the server search by guest and room; Room Plan with `CountStrip`, `TapeChart`, `StayBar` and `Popover`.
  - **Locked:** tokens + `ui-kit` only, closed API, no Tailwind, desktop only, no drag on the tape, 14-day cap (F2), no trends on desk screens. Green is never a stay, because BluePMS uses green for a free room; check that on the client's real screen at the walkthrough (Q8). New components for later slices are built when those slices arrive.
  - **Amends with the code:** ARCHITECTURE §16.4, AGENTS.md (#4, the kit paragraph and the pins, which move to 168 routes for `post_reservation_search`), `.cursor/rules/spa-page-chrome.mdc`, and the R1.7a spec, which this supersedes.

- [x] **R1.11 Settings: Users / System / Logs** — shipped 2026-11-02
  - **Depends:** R0.2.
  - **Prototype:** Settings `users`, `system` (preferences, notifications, tags), `logs`.
  - **Live:** Staff + Roster screens; limited property settings.
  - **Locked:** **Users** = Staff screen linked from Settings. **System preferences** = classified keys pms-core reads. **Notifications** = hide until **R5.2**. **Tags** = R1.8. **Logs** = existing `get_audit_log` read UI (folio:read). Do **not** add `audit.append` HTTP ([audit log spec](superpowers/specs/2026-08-07-audit-log-design.md)).
  - **As-built:** Users links to Staff/Roster by permission; System edits `pms.ops.auto_assign_rooms`, `pms.reservations.allow_dirty_check_in_override`, and `pms.reservations.allow_balance_override` (overrides reclassified DOMAIN so they save); Logs is the folio:read `get_audit_log` viewer; notifications and tags stay hidden.

- [x] **R1.12 Settings: Finance remainder** — shipped 2026-11-02
  - **Depends:** R0.3.
  - **Prototype:** `FinanceSettings.tsx` / `FinanceModals.tsx` (gateways, terminals, AVS, invoice numbering).
  - **Live:** tax rules + charge codes; invoice engine exists.
  - **Locked:** Invoice numbering/templates **configuration** on the existing engine (if not already in Settings). **India (§7.9):** one consecutive series per **financial year (April–March)**, unique per GSTIN, within the length limit — the series resets on the financial year, not the calendar year. **R5.5** depends on this. Gateway/terminal/AVS: **sandbox-only** copy + existing simulate path; no live gateway in Phase 1 — the first real acquirer is **R4.7**. **Card-brand matrix** and **channel routings** = hide until R5.4 / R4.3. City ledger is `/city-ledger`, link from Finance. Folio **routing rules** already live under Settings charges — link, do not rebuild. Do not store secrets in the config register.
  - **As-built:** Finance tab (`/settings/finance`) edits invoice series, prefix, suffix, starting number, generate mode, allow-pending, invoice date, title, footer, and show-tax; financial-year series prints `prefix + YY-YY/ + 5 digits + suffix` (April–March, max 16, charset letters/digits/hyphen/slash) with a per-FY counter, while `continuous` stays `prefix + 6 digits + suffix`; the nine read keys `pms.invoice.prefix|suffix|starting_idx|gen_mode|allow_pending|date_rule|title|footer|show_taxfee` are DOMAIN; card gateway/terminal/AVS is copy only; card-brand matrix and channel routings stay hidden; two properties that share a GSTIN must use different prefixes (no GSTIN field until R4.22).

- **R1.13** — unused number, not a lost slice. Stay workspace is **R1.15**. Do not invent work under this id.

- [x] **R1.14 Reports — OLTP only (optional nav)** — shipped 2026-11-03
  - **Depends:** R1.1.
  - **Prototype:** `ReportsAnalytics.tsx` is **Yield**. That is Track 5.
  - **Locked:** Do **not** add Yield Analytics in Phase 1. Dashboard Hub (R1.1) is the report. If a `/reports` route is needed for IA, make it a redirect to Dashboard until **R4.14** (Track P) gives it the named operational report set.
  - **As-built:** `/reports` redirects to `/dashboard` (replace, so Back skips it); no sidebar item, since a Reports entry that opens the Dashboard would mislead. Night-audit snapshot reports stay on `/night-audit`. R4.14 replaces the redirect with the named set.

### R1 — Stay workspace, cashiering, Settings leftovers

- [x] **R1.15 Reservation stay workspace** — shipped 2026-11-09
  - **Depends:** R0.6. Add-ons need R1.5 products if you post incidentals here.
  - **Prototype:** `Reservations.tsx` (not just the list — the selected-stay card: modify dates/type, confirm pending, inquiry filter, cancel + policy penalty, no-show, cancel check-in, confirmation code, add-ons, damage-deposit checkbox).
  - **Live:** `ReservationsDirectoryScreen.tsx` is a **list**. Folio and Check-in are separate routes. Commands for hold/confirm/cancel/no-show already exist — **wire the stay card**, do not invent new status verbs.
  - **Locked:** Add `/reservations/:id` (or split pane). **Wire existing commands** — do not invent verbs. Modify = `reservations.modify` (client-core method likely missing — add it). Cancel/no-show = existing DO paths + snapshotted penalty ([lifecycle spec](superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md)). Cancel check-in = `reservations.cancel_check_in`. Confirm pending = existing `confirmReservation`. Damage = FolioScreen `folio.authorize` `purpose=DAMAGE`; void = release; post `DAMAGE` + capture = forfeit ([money-ops](superpowers/specs/2026-08-12-folio-money-operations-design.md)). Front-office editor already on Check-in/Folio — reuse. Inquiry/pending/confirmed filters on the directory already exist as status query.
  - **Check-in action:** the stay card links to the existing check-in for a confirmed stay (pilot checklist *Check-in from the reservation screen*).
  - **In-house stays:** `reservations.modify` refuses `checked_in` (`NOT_MODIFIABLE`). The card shows that and links to **R4.24**; do not widen modify here.
  - **Out:** extra named guests; dirty-room force check-in; recurring engine; second folio UI; PAN; new deposit commands.
  - **Tests:** cancel outside window posts one penalty line; modify dates moves availability; cancel-check-in returns confirmed without deleting folio history; DAMAGE void leaves stay capture-due untouched.
  - **As-built:** `/reservations/:reservationId` stay card wires confirm, modify (`PATCH`), cancel, no-show, cancel check-in and the check-in link; impossible actions are disabled with the reason; in-house modify is disabled (R4.24). `GET` reservation gains `cancellation` (snapshotted terms, `freeUntil`, and `cancelNowMinor` / `noShowMinor` from the same `penaltyMinor` the writes use, read-only, null when the policy cannot be priced); dialogs show the charge before tax. `post_folio_authorize` accepts `purpose` (`DAMAGE` joins the fingerprint; `STAY` stays the default and fingerprints as before); Folio gets Release (void) and Forfeit (`DAMAGE` line, then capture, capture-only retry); the stay card shows the hold read-only. No confirmation-code field exists, so the card shows the reservation ID. Directory links to the card and filters Inquiry / Pending / Confirmed / In house. No new command, route or migration.

- [x] **R1.16 Cashiering / shift as a first-class desk surface** — shipped 2026-11-09
  - **Depends:** R0.14 for L9–L10 cash FX and business-date on close. If R0.14 is still open, do not start this slice.
  - **Prototype:** cash drawer on Front Desk.
  - **Live:** `ShiftScreen.tsx`, **ShiftStrip in AppShell** (all desk routes). Spec: [cashier-shift SPA](superpowers/specs/2026-08-09-cashier-shift-spa-design.md), [cashiering](superpowers/specs/2026-08-07-cashiering-design.md) (`tender_type` = `CARD` \| `CASH` only).
  - **Locked:** Do **not** rebuild the strip or add CHECK/VOUCHER/GIFT. This slice is **R0.14 SPA honesty** (cash FX / business-date on close) plus characterization around `get_shift` / `put_shift_close`. If R0.14 already covers the SPA, tick this when R0.14 ticks.
  - **Out:** new tender types; PCI card data; Apple Pay / terminals (R5.4).
  - **As-built:** R0.14 had already fixed the server (expected cash sums `ledger_amount_minor`; no-shift cash is dated by `folio_line.business_date`). The SPA read the variance sign backwards: the wire is expected − counted, so a short drawer is positive, and the receipt said "over". `formatVarianceMinor` now reads positive as short; the tests that encoded the old sign were corrected. Close shift labels the count with the ledger currency and says foreign cash counts at its ledger value as posted on the folio; a load failure is an `Alert`. The receipt shows expected cash (count + variance) only after a counted close, renames the stat to "Cash with no shift", and raises an attention alert naming the business date when any cash was taken with no shift open. `cashiering.spec.ts` pins `get_shift` / `put_shift_close`: open shape, short/over sign, unknown 404, another cashier 404 and still open, same-key replay and changed-count 409, closed → `shift_not_open`, `money_invalid` / `invalid_body` / `invalid_json`. No new command, route or migration.

- [x] **R1.17 Settings → Guests (profile defaults)** — shipped 2026-11-17
  - **Depends:** R0.11. Merge UI is R1.8.
  - **Prototype:** `Settings.tsx` `activeSection === 'guests'` (default country/language, require email/phone, require ID at check-in, duplicate matching).
  - **Live:** Settings → Guests reads `pms.guests.settings` on create. Check-in does not (ID-at-check-in is R4.15).
  - **Locked:** Settings section bound to that key. Every toggle pms-core **reads** (ID-at-check-in must fail check-in when on). Duplicate match rules gate create; merge remains R1.8. Hide Opera-flavoured controls with no consumer.
  - **Out:** a second guest book; decrypt-on-list.
  - **As-built:** Settings → Guests (`/settings/guests`, nav only with `org:manage`) shows four controls — require email, require phone, match on email, match on phone — in “Required on new profiles” and “Duplicate check at this property”. OrgDO `tryCreateGuest` reads all four, and only on new guest profiles; PATCH is unchanged. Duplicate match is property-scoped (blind index → live guest → `guest_property` for the URL property; email before phone). Hidden, with the slice that owns them: require ID at check-in (R4.15), stay preferences and passport/ID match (R4.15), default country and language (no owner yet), auto-suggest merge / allow explicit duplicates / share profiles across properties (no owner yet), VIP and loyalty thresholds (not scheduled). Routes `get_org_guest_settings` and `put_org_guest_settings`; command `config.put_guest_settings` (INTERACTIVE, `pms.core`, kill-switch on). Pins: catalog **105**, audit **170**, last id `put_org_guest_settings`. Spec: [Settings → Guests](superpowers/specs/2026-11-17-settings-guests-design.md).

- [x] **R1.18 Settings → Accommodations** — shipped 2026-11-17
  - **Prototype:** Property subtab `accommodations`.
  - **Locked:** deep-link / embed the Inventory screens (types, rooms, floors, OOO, amenities). **Do not** build a second editor. Spaces / split-inventory tabs stay hidden until Track 4.
  - **As-built:** `/settings/accommodations` (a tab after Property) links out and edits nothing: Room types → `/inventory`, Rooms and floors → `/inventory/rooms` (floor is a field on each room), Out of order → `/housekeeping` (the board sets and releases OOO ranges). Each link shows only with the destination's permissions (`inventory:write`; OOO also needs `housekeeping:read`); otherwise the row says which access is missing. Amenities have no screen or data model yet, so there is no amenities row; spaces and split inventory stay hidden (Track 4). No route, command or migration. Fixed on the way: Settings counted the prefilled property name as an unsaved change, so leaving any Settings tab (Users → Staff, these links) asked "Leave without saving?" with nothing edited; it now compares against the stored name.

- [x] **R1.19 In-house room move** — shipped 2026-11-17
  - **Depends:** R0.6. Type change on an in-house stay is **R4.24**: `reservations.modify` refuses `checked_in`.
  - **Prototype:** Front Desk `showMoveModal` (target room + reason).
  - **Live:** `assignRoom` is used on Check-in only.
  - **Locked:** POST existing `reservations.assign_room` for a `checked_in` stay to another **clean, vacant, same-type** room with a required reason (front-office comment or audit details). Invalidate `['board']`. Different type = **R4.24** (Track P). Not a $0 reservation. Not drag-on-tape.
  - **Tests:** old room free, new room occupied; dirty/OOO/occupied target rejected.
  - **As-built:** An in-house move is the existing `reservations.assign_room` (`post_reservation_assign_room`) on a `checked_in` stay. No new command, route, or migration. (1) Trimmed `reason` is required (`room_move_reason_required`, 422). Pending and confirmed still assign without one, and `reason` joins the fingerprint only when the body sends it. (2) The target equal to the current room is `room_already_assigned`. (3) Overlap and `room_ooo` use the remaining window `from = max(arrival, business date)`, `to = departure`, or the next day when the guest is overstaying. Pending and confirmed still use the whole stay. (4) Any other `checked_in` guest in the target room blocks the move, including an overstay whose departure is already past. (5) The target must be `inspected`, or `clean` when `pms.housekeeping.require_inspection` is not true (`room_not_ready`). No dirty override. (6) Same type only (`room_type_mismatch`). A type change stays R4.24. (7) The previous room is marked dirty the same way checkout does, unless it is out of order. (8) `availability_day` is unchanged. (9) The move audit is `{ roomId, reason, move: true }`. `reservation.room_assigned` is unchanged and carries no reason. The In-house board has Move room: a required reason, clean or inspected candidates, current room excluded. A reason longer than 500 characters is `400 invalid_body`. Fixed on the way: an overstaying guest (in house, booked departure before the business date) was invisible to every room-overlap check, so free-room lists, assignment and check-in could put a second guest in an occupied room. Overlap checks (`listAvailableRooms`, `assertRoomAssignableSync`) now end such a stay no earlier than the day after the business date, and check-in refuses a room another in-house guest is still in (`room_already_assigned`), including a room pre-assigned days earlier. A guest due out today keeps their booked departure, so the room can still be pre-assigned for tonight.

- [x] **R1.20 Guarantee + check-in auth workflow (no PAN)** — shipped 2026-11-18
  - **Depends:** R1.4.
  - **Later, not a dependency:** real card capture is **R4.7** (first acquirer); terminals and further gateways are **R5.4**. This slice uses the simulate path only.
  - **Prototype:** Booking wizard step “Billing & Guarantee”; Front Desk pre-auth modal with card number/CVV.
  - **Locked:** Do **not** add `guaranteeMethod` if the folio payment already records the guarantee. Consume `pms.booking.require_prepayment` inside confirm/check-in (hide the toggle until then — R0.11). Card path = existing **simulate** authorize ([payments simulate](superpowers/specs/2026-08-06-payments-ledger-simulate-design.md), [card last4](superpowers/specs/2026-08-14-card-last4-brand-design.md)). Check-in shows last4/brand if present — never PAN/CVV. Cash / pay-at-hotel = no authorize required unless the config is on.
  - **Out:** PAN/expiry/CVV; `held` inventory; a second payments Worker; the desk's advance collection and numbered receipt (**R4.25**).
  - **Tests:** require_prepayment blocks check-in with zero captured/authorized STAY money; simulate authorize unblocks; no card-number input in web-pms.
  - **As-built:** (1) `pms.booking.require_prepayment` is a DOMAIN bool, default false, `consumersExempt` (command-time read, no ARI side effect). It gates **check-in only**. Confirm is not gated: a reservation has no payments until it exists, so gating confirm would make the booking screen's Confirm unusable. (2) Guaranteed means a `payment` row for the stay with `purpose = 'STAY'` and either `status = 'authorized'`, or `status = 'captured'` with unrefunded minor units (`COALESCE(captured_amount_minor, amount_minor) - COALESCE(refunded_amount_minor, 0) > 0`). CARD and CASH both count. DAMAGE, voided, declined, pending, unknown, and fully refunded do not. One private sync helper, `hasStayGuaranteeSync`, on PropertyDO. (3) `tryCheckIn` reads the key inside the existing transaction, after the status checks and before any room assignment or write. Off or unset: check-in is unchanged. On and not guaranteed: `prepayment_required`, HTTP 422. The refusal is thrown so `runIdempotent` does not store it; the same check-in key succeeds after a later authorize. (4) Settings → Property → Reservations shows "Require a card hold or payment before check-in". The Policies tab stays hidden. (5) Check-in loads folio payments on `['folio-payments', propertyId, reservationId]` and shows brand + last4, cash, or "None on file". While payments are loading and the rule is on, Check in stays disabled. (6) No new command, HTTP route, or migration. No PAN, expiry, or CVV.

---

## Track 2 — Look like the prototype (interaction + kit, not Tailwind)

Do after R0.11 at minimum (audit UI). Can run in parallel with Track 1 slices that do not share screens.

- [x] **R2.1 Nav IA** — shipped 2026-11-18
  - Sidebar order matches prototype **roles we keep:** Dashboard, Room Plan, Front Desk, Reservations, New Booking, Housekeeping, Guests, Rates, Folios, Night Audit, Settings. Quiet: Inventory, Staff, Roster, Exceptions, City ledger, Shift.
  - **Today:** `nav.ts` has no Shift item (`ShiftStrip` links to `/shift` from AppShell). City ledger is in the list but not `tone: 'quiet'`. This slice adds both — not a later surprise.
  - **Night Audit stays in the sidebar.** The prototype only CTAs it from Dashboard; live already has a nav item — keep it.
  - **Out:** Whistle button, booking-engine simulation chrome, role-swap, property-switcher (until **R4.4**).
  - Gate: `check:spa-page-chrome`, `check:web-pms-me-gating`. Roster nav `roster:read` (audit U16).
  - **As-built:** Primary order is Dashboard, Room Plan, Front Desk, Reservations, New Booking, Housekeeping, Maintenance (module, kept beside Housekeeping), Guests, Rates, Folios, Night Audit, Settings. Quiet: Inventory, Staff, Roster, Exceptions, City ledger, Shift. City ledger moved to the quiet group; Shift is a new quiet link to `/shift` gated on `folio:read` (the open-shift and receipt reads), with a wallet icon; the AppShell strip still opens and closes shifts. Roster stays on `roster:read`. The nav registry test pins the order, the quiet set, Night Audit as primary and the Shift gate. No route, command or migration.

- [x] **R2.2 Screen titles and hotel name** — shipped 2026-11-18
  - Arrivals / Departures / In house titles (audit I5). Drop “The Meridian Seattle”. One h1.
  - **As-built:** A browser pass over 29 routes (every nav screen, its sub-tabs, stay card, folio, check-in, guest profile, 404) found exactly one `h1` on each, board titles matching the route (Arrivals / Departures / In house), live `property.name` in subtitles and no hardcoded hotel name — R0.11 had done most of it. The folio back link already follows the stay (In house vs Arrivals). Left over and fixed: the City ledger account and Guest profile back links still started with “←”; they now read “City ledger” and “Guests”. `check:spa-page-chrome` now fails any `PageHeader` back link that starts with an arrow (with self-test fixtures).

- [x] **R2.3 Dialog / EmptyState / Alert sweep** — shipped 2026-11-18
  - Remaining `window.confirm`, JSON `<pre>`, bare `<p>` status (audit I3/I7/I8/Q18). One Dialog.
  - **As-built:** Already clean: no `window.confirm`, no raw `role="dialog"` or `<dialog>`, and the exceptions payload is already a `DataTable`. Fixed: (1) audit-log detail is a Field / Before / After `DataTable` (`audit-detail-table`), with `EmptyState` when both sides are empty; (2) Global Search fail-closed and other errors are `Alert`s; (3) folio lines and payments query failures are `Alert`s via `classifiedUserMessage`; (4) “Products unavailable — posting by charge code.” is `Alert intent="attention"`; (5) city-ledger “No entries yet.” is `EmptyState`; (6) a missing shift is `EmptyState` “Shift not found.” with Back to board, under `PageHeader` “Shift receipt”; (7) the night-audit day-still-open notice is `Alert intent="informational"`; (8) roster `emptyReason` (“Select at least one kind.” / “Pick at least one kind.”) stays muted hint text — it is a disabled-control hint, not an empty directory. Guard: `apps/web-pms/src/no-raw-json.test.ts` fails if a non-test `.tsx` under `apps/web-pms/src` or `modules/pms/*/src/ui` contains `<pre`. No route, command, or migration.

- [x] **R2.4 Print + registration card** — shipped 2026-11-18
  - CSS only `.reg-card`; never UUID room (audit U5/I6). Already a view — make it match prototype card fields (guest, dates, room **code**, rate plan name).
  - **As-built:** The card is a labelled grid (`StatField`): Guest, Confirmation, Arrival, Departure, Nights, Guests (“2 adults · 1 child”), Room type, Room (code or “Not assigned”, never the room id), Rate plan, then VIP/DND badges, special requests and a guest-signature / date line. `useRegCardLabels` reads room type and rate plan names on the shared `['room-types', propertyId, 'active']` and `['rate-plans', propertyId]` keys. Fixed on the way: the Folio’s card never passed the room type and printed “Room type unavailable”. Print CSS is unchanged — only `.reg-card` prints. Prototype templates, uploads and the nightly rate stay out (templates are R4.13).

- [x] **R2.5 Folio / Book / Check-in layout** — shipped 2026-11-18
  - Interaction parity: tenders as table, quote as money, room picker by code. Do not rebuild as a second billing app. Stay on ui-kit.
  - **As-built:** Checked live: the Folio tenders are a `DataTable` (Method / Amount / Status / Actions), Book shows the quote as money (“Quote total ₹4,200.00”), and Check-in, Assign room and Move room pick rooms by code. Left over and fixed: the tenders Status column printed the wire enum (`captured`, `unknown`); `tenderStatusLabel` now says Authorized, Paid, Partly refunded, Refunded, Voided, Declined, Pending or Unconfirmed. Unit tests cover the labels and the brand / last-4 method text.

- [x] **R2.6 Role-based nav (not impersonation)** — shipped 2026-11-18
  - Prototype `App.tsx` has a 4-role switcher and a housekeeping-only fallback. **Lock:** live RBAC + `PermissionRoute` already; send a HK-only actor to Housekeeping as home. **Do not** add role impersonation or a fake four-role toggle.
  - **As-built:** Home follows live permissions, not a role name: `/` renders `HomeRedirect`, which waits for `/me` and sends an actor who can read reservations to the Dashboard (unchanged), one who cannot but can read housekeeping to Housekeeping, and maintenance-only to Maintenance; unknown authority falls open to the Dashboard. `PermissionRoute` with no explicit fallback now sends a denied desk actor to Arrivals as before and anyone else to their own home, so a housekeeping-only member is never bounced to a page that fails again. No role switcher, no impersonation; the sidebar already hides links by permission. No built-in role is housekeeping-only today — this serves per-member grants.

When Track 1 + Track 2 open boxes are gone, a GM can walk every **Phase 1** prototype screen on live data and it looks like HospAI, not a lab.

---

## Track 3 — Config honesty + leftovers named in architecture

- [x] **R3.1 Config register vs Settings UI**
  - Every visible Settings control maps to a register key that pms-core **reads**. Hide the rest. `EXCLUDED_PROTOTYPE_KEYS` stay excluded or get a spec to include them.
  - **Done (2026-11-18):** 36 visible keys checked; four had no pms-core reader and are hidden — `pms.money.payment_alloc`, `pms.money.currencies_list` (not the FX allowlist), `pms.folio.breakfast_rule` and `pms.folio.configs`. The register entries stay; they come back only with a reader. `apps/web-pms/src/settings-keys-read.test.ts` fails if a Settings `configKey` has no reader in pms-core, its modules or do-runtime.
  - **Prototype / register:** `EXPECTED_PROTOTYPE_KEYS` length **97** (`packages/contracts/src/register.test.ts`). Do not confuse with `COMMAND_CATALOG` length **89**. **Do not** re-derive classification; extend `packages/contracts/src/config/register.ts`.

- [x] **R3.2 Recurring / fixed charges (named leftover — still Phase 1-adjacent)**
  - Architecture deferred this. **When** you take it: schedule table, post inside existing `POST_ROOM_CHARGES` (no 9th step unless pin updates), snapshot `amountMinor`, honour `no_post`. Until then keep **unchecked** only if product pulls it forward; default is **after Track 1**.
  - **Done (2026-11-18):** [spec](superpowers/specs/2026-11-18-recurring-charges-design.md). A stay carries up to 20 nightly product schedules (`recurring_charge`, PropertyDO migration 41) with the product's code, name and price snapshotted. `POST_ROOM_CHARGES` posts each covered night on the guest window with tax, `source = 'RECURRING'` (so two schedules on one charge code both post), deterministic line ids, `no_post` and the room-charge population honoured, and a per-row exception for an archived charge code. Folio screen: Recurring charges card (add, cancel with confirm). Only the `NIGHTLY` pattern; arrival, departure, weekends and chosen dates are R4.13. Pins: catalog 107, routes 173 (last `post_reservation_recurring_charge_cancel`), `PROPERTY_SCHEMA_HEAD` 41.

- [x] **R3.3 Rate-plan inclusions**
  - Deferred with R3.2. Do not add a JSON column nobody posts.
  - **Priority raised (2026-09-12):** package reservations are *Core* in ARCHITECTURE §16.6 and are built on this slice and **R3.2** — see **R4.13**. The no-unposted-column rule still holds.
  - **Done (2026-11-19):** [spec](superpowers/specs/2026-11-19-rate-plan-inclusions-design.md). A plan carries up to 8 inclusion rows (product, amount, per room / adult / guest, included in the rate or added on top) plus whether inclusions are taxed on their own code or at the room's tax, and whether they join the room's tax band (forced on when taxed at the room's tax). PropertyDO migration 43. Booked nights snapshot the rows with the rate night; later plan edits do not change them. `POST_ROOM_CHARGES` splits included value out of the room line and posts added lines with `source = 'INCLUSION'`, deterministic line ids, and per-stay exceptions `inclusion_exceeds_rate` and `inclusion_charge_code_inactive`. A joined band is resolved once (no writes) and stored on `folio_line.tax_band_base_minor` so a later discount re-bands that line. Quote and Book add the current plan's added inclusions. Settings → Rates has *What's included* and, new with this slice, **Edit** on every plan (plans could only be created before, so BAR could never get a meal plan). The India demo seeds `CP` Room + Breakfast. Out: package templates (R4.13), per-child amounts, ARI, registration card and proforma, day-wise inclusion overrides (R4.20). Pins: catalog 109, routes 176 (last `put_tax_rule_end`), `PROPERTY_SCHEMA_HEAD` 43.

- [x] **R3.4 Early-departure command**
  - Same as audit L6 / R0.14. If R0.14 is done, tick both.

- [x] **R3.5 B3 HTTP `noPost` on guest PATCH**
  - Audit Vertical 14. SPA already uses front-office RPC.
  - **Done in R0.14 (`24f8dba`, 2026-09-05), ticked 2026-11-18:** `PATCH /v1/properties/:id/reservations/:rid` accepts `noPost` and passes it to `reservations.modify` (it joins the fingerprint only when sent); `POST …/front-office` takes it too. Covered by `reservations-routes.spec.ts` ("PATCH modify with noPost: true sets noPost flag", "POST front-office noPost only does not clobber comment/VIP"). `noPost` is a stay flag, so the guest-profile PATCH (`patch_guest`, OrgDO) correctly has no such field.

- [x] **R3.6 Launch-country tax model**
  - **Decided (2026-10-27): India first — the pilot client's state.** Supersedes the 2026-09-12 Canada-first call; Ontario and British Columbia follow as configuration on the same engine in **R4.19** (Track 4). Recorded in [`ARCHITECTURE.md` §7.9](../ARCHITECTURE.md#79-regulatory--the-hidden-second-product).
  - **Why India first:** the pilot is a real operator switching from BluePMS ([checklist](research/2026-10-27-pilot-client-checklist.md)), and India is the market that shaped the engine — the slab rate, the component split and the fiscal hook all exist because of it.
  - **Locked:** build the eight requirements in §7.9 — jurisdiction *stack* (not a country enum), rate as a **function** of `(jurisdiction, date, taxable base, product class)`, computed **inside the PropertyDO transaction** (§5.1) and **per night at posting**, a levy that can **split into components**, inclusive-vs-exclusive as a **jurisdiction property**, a nullable **fiscal-document hook** on the invoice engine, and **ordered levies** where one can sit inside another's base.
  - **Locked (India):** jurisdiction stack country → state; **GSTIN per property**. Room GST is a **slab keyed to the per-night value of supply**, so a discount or an upgrade can move a night across a boundary — that is why the rate is resolved inside the transaction. Components are `CGST` + `SGST` or `IGST` by **place of supply**. The F&B rate depends on the property's **specified-premises** declaration for the financial year: a dated, property-level DOMAIN key read inside the DO transaction — never from KV.
  - **Decided (2026-11-18, the user): every option is the hotel's, in Settings → Tax** — rates, slab bands, components, order, base, conditions and whether each tax is included in the price or added on top. No country's rules in code; presets fill the form without rates. [Spec](superpowers/specs/2026-11-18-configurable-tax-engine-design.md). The advisor confirms the values the hotel enters before the first rupee posts, not the code before it is built.
  - **Locked:** record tax jurisdiction **per property, not per org**. Keep a **tax-inclusive jurisdiction fixture** in the engine's tests; neither India nor Canada exercises requirement 6.
  - **Verify first:** slab boundaries, the specified-premises tariff test and the e-invoicing threshold with the client's tax advisor before the first rupee posts. **Also ask (2026-10-31):** does a meal plan join the room amount when choosing the slab, and when is a room-and-meal stay a composite supply? BluePMS's Tax & Compliance page makes both configurable, and this engine resolves the slab on the room value alone. The answer may change requirement 2's inputs and R4.13's package lock. R3.3 made both configurable per plan, so the advisor sets the answer in Settings rather than changing code.
  - **Scope out:** Canadian provinces (**R4.19**); Quebec; Australia. Fiscalization is **R5.5** (Track P); `held` behaviour is **R5.13**.
  - **Done (2026-11-18):** [spec](superpowers/specs/2026-11-18-configurable-tax-engine-design.md). Every rule is set in Settings → Tax: included in the price or added on top, slab bands (up to 10) with parts per band (up to 4, e.g. CGST + SGST), order and compound base, a condition on a dated property declaration (e.g. `specified_premises`), whether a discount re-bands, a start date, and *Stop from a date*. One resolver in `@hospai/money` runs inside the posting transaction before the parent line, per night; inclusive prices post net + tax = price; discounts re-band on the source line's stamped rules. Tax location and registrations (GSTIN) are copied onto issued invoices. India GST preset fills the structure without rates. Not built (spec §2.8): IGST / place of supply (R4.22), meal plan in the slab base and composite supply (R3.3 options), per-person levies. The advisor confirms the values entered before the first rupee posts. Pins: catalog 109, routes 176 (last `put_tax_rule_end`), `PROPERTY_SCHEMA_HEAD` 42.

- [x] **R3.7 Cross-store purge Workflow**
  - **Shipped.** Spec: [purge workflow](superpowers/specs/2026-08-12-purge-workflow-design.md). Code: `PurgeWorkflow`, certificates, `guest.erased` consumer. **Do not rebuild.** Iceberg skip remains honest on the certificate.

- [x] **R3.8 ARI KV + staleness SLA + reject-on-commit**
  - **Shipped.** Spec: [ARI KV projection](superpowers/specs/2026-07-29-ari-kv-projection-design.md). Binding `ARI_KV`; book uses `quoteAriVersion`. **Do not rebuild.** R4.2 is the public-engine consumer.

- [x] **R3.9 Degraded SPA watermarks (gap-fill only)**
  - `StaleWatermark` + exception workbench already ship. Walk remaining screens: every `READ_STALE` / `QUEUE_PROVISIONAL` / `FAIL_CLOSED` path the clerk can hit shows a watermark or Alert. Do not add a second banner system.
  - **Done (2026-11-18):** walked every QUEUE_PROVISIONAL command, FAIL_CLOSED read and the one READ_STALE read (`get_property_availability`). A queued (202) write now always shows an `attention` Alert and never a success message: housekeeping status / assign / OOO and priority, front-office editor, folio no-post, booking add-ons, damage forfeit (stops before capture), guest erase; queued Alerts made consistent (CheckIn and Folio were red, Board green). Main-read errors render `classifiedUserMessage` Alerts under the page header instead of "unreachable" for every error (Board, Tape, directories, guest profile, city ledger, CheckIn, Folio, Rates, Night audit, Exceptions); the summary strip no longer vanishes; the tape Free row shows loading instead of 0; search error, loading and no-match are three states. Queued-commands panel subscribes to the log, so the first queued write appears. Shared `isQueuedResult` in `apps/web-pms/src/copy/is-queued-result.ts`; no new banner.

- [x] **R3.10 Entitlement catalog amendment (packaging v1)**
  - **Why now:** every Track 4 add-on is gated on a key that does not exist. `FEATURE_KEYS` holds **two** keys (`pms.core`, `pms.units.limit`); **R4.2** and **R4.3** both name keys outside it, so both are Blocked until this lands.
  - **Locked:** implement the authorised target table in [`ARCHITECTURE.md` §6.7](../ARCHITECTURE.md#67-package-composition) exactly. Extend `FEATURE_KEYS` (`packages/contracts/src/entitlements.ts`) and `PLATFORM_SEED_FEATURE_KEYS` (`packages/do-runtime/src/platform-migrations.ts`); seed three plans — **Starter / Growth / Group** — plus the add-ons. `pnpm check:entitlements` stays green and `FeatureKey` must not collapse to `| string`. There is **no Enterprise plan**; do not seed one.
  - **Also locked:** `pms.properties.limit` is a **`hard`** limit at the OrgEntitlementDO counter (§6.6) — it *is* the ten-property ceiling, and a stale snapshot must never let an eleventh property provision. `payments.enabled` on Starter is `required`, not a boolean grant: a Starter tenant without payments enrolment is a provisioning failure, not a silent free tier.
  - **Scope out:** billing, Stripe, plan self-serve, add-on purchase UI (all **R5.6**). Keys, plans and seed only.
  - **Blocks:** R4.2, R4.3, R4.6.
  - **Done (2026-11-18):** [spec](superpowers/specs/2026-11-18-entitlement-catalog-design.md). `FEATURE_KEYS` holds the 22 §6.7 keys in table order; Starter / Growth / Group seeded cell for cell (∞ stored as `'unlimited'`), no Enterprise; add-on catalogue (`addon`) and per-org `subscription_addon` read by the resolver, whose changes bump `entitlement_version` (nothing sells add-ons until R5.6). D1 migration `0006` moves existing unit caps 20/100 → 40/400. `pms.properties.limit` is enforced hard: `provisionProperty` reserves a slot in the org's OrgEntitlementDO (standing counter, fresh D1 limit, checked and incremented in one transaction) and gets `422 limit_exceeded` at the cap. `payments.enabled` is `'required'` on Starter and `'enabled'` above it; **enforcing payments enrolment is R4.7** (no enrolment record exists before live acquiring). Eleven specs that build two hotels in one org now seed Group.

---

## Track P — India pilot client (switching from BluePMS)

The first paying operator: one Indian hotel replacing BluePMS. Its returned checklist ([`docs/research/2026-10-27-pilot-client-checklist.md`](research/2026-10-27-pilot-client-checklist.md)) is the scope — Front Office, Housekeeping, Point of Sale, Channel Distribution and AI Copilot in full, plus Guest 360, GST e-invoicing and a Tally / Zoho export. This track is what it needs to switch, and nothing it left blank. What each tick contains is in the [page inventories](research/2026-09-12-bluepms-modules.md#module-page-inventories-read-2026-10-31); the gap behind each one is in the [comparison](research/2026-10-31-bluepms-inventory-vs-slices.md).

Start only when Tracks 0–2 Phase-1 boxes are `[x]`, and **R3.1**, **R3.2**, **R3.3**, **R3.6** (India tax model) and **R3.10** (entitlement catalog) are `[x]`. R3.4, R3.5 and R3.9 may remain. Each gated module follows `ARCHITECTURE.md` §14 Phase 2: core never imports add-ons, and **the first gated module to ship proves the mechanism** — if it needs a special case, fix the mechanism, not the module.

**Provisioning:** the pilot tenant is provisioned by ops on **Growth** with the `pos.enabled` and `ai_ops.enabled` add-ons. Growth grants `payments.enabled` rather than requiring it, so no live acquirer (R4.7) and no self-serve billing (R5.6) is needed for the pilot. The pilot left *embedded card payments* blank — deposits are recorded as tenders.

**Every ticked item is a must-have** (client, 2026-10-27) — none may be scoped out, deferred to a later track or replaced by a link to a later slice. Track P is done when every row of the coverage table in the [checklist research](research/2026-10-27-pilot-client-checklist.md#coverage--ticked-item-to-slice) points at a `[x]` slice. Items the client left blank stay out.

### How this track builds what the client actually uses

1. **Ask before building.** The walkthrough and samples ([Q8](research/2026-10-27-pilot-client-checklist.md#open-questions-for-the-client)) and the advisor sign-off run now, alongside Tracks 1–3 (see [go-live](#pilot-go-live--not-coding-slices)). BluePMS's pages are marketing material, not this hotel's configuration.
2. **The tick sets the scope; the page explains it.** Each slice names the page group it draws on. Read that group before writing the spec. A page line beyond the tick's wording is a question for the client, not scope; the client's answer goes into the slice.
3. **Apply the fork decisions.** F1–F3 turn on a client answer, F4 on the advisor's. Where an answer is missing, that part waits and the rest of the slice goes ahead.
4. **The queue stays serial,** in the order below. **R4.22–R4.32 come from the 2026-10-31 comparison,** accepted by the user the same day. They carry no new entitlement key (§6.7).
5. **The parallel run is the test.** The hotel's own Manager Report, bills and night audit are compared with BluePMS's before cut-over.

### Fork decisions

Four findings collided with existing locks. **The user accepted these on 2026-10-31.** Each lock stays exactly as written until the answer named here arrives; when an answer changes a lock, amend it in the same change-set.

| Fork | Collision | Decision | Where it applies |
|---|---|---|---|
| **F1** Line transfer to another room | BluePMS's billing group moves folio lines to another room. AGENTS §2 and the roadmap reject it (`transfer_cross_reservation`, 422). | **The lock holds until Q17 is answered.** If the desk only needs one payer for several rooms, COMPANY windows already do that, and the lock stays. If it really moves lines, lift the lock with one named command: reversal in the source, new line in the destination, tax copied, one source line moved once, a required reason and its own permission. Both stays are in one PropertyDO, so it stays one transaction. Amend AGENTS, the money-ops and split specs together. | R4.29 (that part only) |
| **F2** 26-day grid | BluePMS shows 26 days plus 7, 14, 30 and custom. AGENTS §4 and audit P13 cap the tape UI at 14 (`MAX_TAPE_UI_DAYS`), because the DOM is rooms × days. | **The cap stays 14 until Q18 is answered.** If the desk plans further out, raise it to 30 and measure at this hotel's room count first; add no virtualizer unless the measurement demands it. Amend AGENTS §4 and P13 then. | R4.28 (range only) |
| **F3** R4.14's closed list | The tick ends in "etc.", and BluePMS names many reports R4.14 omits. The R1.10 spec also sends its revenue, daily statistics and end-of-day reports to R4.14. §16.6 says nothing outside the list without a new slice. | **The closed-list rule stays, and the list is rewritten once:** the three R1.10 reports now, then exactly what the client names in Q10. The catalogue and the report builder stay out. Excel or PDF only if Q10 shows they are needed. The Manager Report is its own slice, which the rule allows. | R4.14, R4.32 (output formats) |
| **F4** Party size vs per-person Form C | AGENTS §4 and the holes sweep allow `adults` / `children` and no second profile. R6.2 owes a record for **each** foreign national, so a second foreign national in a room had none. This holds whatever BluePMS does. | **Party size stays for CRM, folio and inventory, with one narrow exception:** a Form C person record per foreign national on the stay, with document data encrypted in OrgDO and covered by purge. It is not a guest profile, has no `guest_ref` on the stay and no CRM row, and sends no event PII. The advisor confirms the legal duty. Wider additional-guest capture waits on Q19. AGENTS §4 and the holes sweep are amended. | R6.2, R4.15 |

### Slices

- [x] **R4.5 Outbox consumers + Queue workers**
  - ARCHITECTURE Phase 2 mechanism proof. **Locked:** required before or with **R4.3**. No special cases inside PropertyDO. Do not start R4.3 if events have no consumer.
  - **Done (2026-11-19):** [spec](superpowers/specs/2026-11-19-outbox-consumers-design.md).
    - Queue consumers are declared with `consumes` on the module manifest (core consumers in pms-core) and run through one registry. `subscribes` stays the in-transaction path.
    - Each consumer is gated by tenant, entitlement and kill-switch, deduped per consumer, and retried on its own queue, `hospai-event-retries`: six tries with backoff from 30 s to 900 s.
    - A consumer that still fails becomes a row in a new **Event delivery** section of the exceptions workbench, with Retry (through the outbox) and Dismiss (with a reason).
    - The ARI projection and the guest-erasure purge start moved onto the registry with no change in behaviour. Guest erasure is exempt from the gate as a legal duty.
    - Adds 2 commands, 3 routes and PropertyDO migration 44.
    - **R4.3 adds a manifest entry and a handler, nothing else.**
    - **Ops:** the staging queues `hospai-event-retries-staging` and `hospai-event-retries-dlq-staging` were created on 2026-11-19. Create the production pair (`hospai-event-retries`, `hospai-event-retries-dlq`) with `wrangler queues create` before the first production deploy.

- [ ] **R4.15 Guest ID documents, preferences + consent**
  - **Depends:** **R1.8** (guest CRM remainder), **R0.5** (per-org HKDF keys — shipped).
  - **Pilot checklist:** *Guest lookup (ID documents)*, *Guest documents*, *Edit reservation and guest preferences*, *Guest 360 (identity, stays, preferences, consent)*.
  - **Preferences:** structured guest preferences (room, bedding, dietary, accessibility) on the OrgDO profile, shown on the stay card and at check-in. R1.8's free-text notes stay notes; do not fold one into the other. `GuestProfile` holds none of these today.
  - **Undefers** two named leftovers of the [guest CRM directory spec](superpowers/specs/2026-08-13-guest-crm-directory-design.md) — ID documents and `guests.update_consent`. Amend that spec's leftover list in the same change-set; do not leave it saying "defer".
  - **Locked:** ID documents live on the **OrgDO profile**, encrypted under the per-org HKDF key; scans in R2 under the same key, **covered by `PurgeWorkflow` and its certificate** (erasure must delete the objects, not orphan them). Events carry `guest_ref` only. Every document read is audited. Fields include passport and visa details for foreign nationals, because **R6.2** Form C reads them. **Aadhaar numbers are stored masked (last four) only** — confirm current UIDAI rules before shipping.
  - **Locked (consent):** per-purpose consent with timestamp, source and notice version, read by whatever sends to the guest (R5.2 later). India's DPDP Act sets the notice and withdrawal rules — confirm with the advisor.
  - **Also locked:** **R1.17**'s *require ID at check-in* reads this — check-in fails closed when it is on and no document is recorded. R4.15 adds the "Require ID at check-in" control to Settings → Guests (R1.17 hid it).
  - **Tests:** two-property same-org — hotel A cannot list or read hotel B's guest documents (AGENTS §5); purge removes R2 objects and the certificate says so.
  - **Guest lookup:** the [Front Office page](https://www.bluepms.com/modules/front-office/) (Command Center And Guest Intake) previews photo and ID when choosing a match. Show them **after a match is selected**, through the audited read. Lists stay free of decrypted documents (no decrypt-on-list). Equality blind-index search stays.
  - **Stay flags (client Q20):** the page's early check-in, late checkout and airport transfer flags belong to the stay, not the profile; add only those the client uses. VIP already ships on the stay.
  - **Guest documents (client Q11):** this tick may mean the printed set (**R4.13**, **R4.25**) rather than ID scans. Build the ID half regardless, because *Guest lookup* and R6.2 need it.
  - **Night audit:** add the R1.10 spec's ID-proof check to the shared evaluator. Country and state wait on how PropertyDO can count them without PII.
  - **Decided F4:** documents here belong to one guest profile. A second foreign national on the stay is an **R6.2** Form C person record, which reuses this slice's encryption, R2 storage, read audit and purge. No second profile.
  - **Scope out:** OCR, document verification services, `guests.merge`.

- [ ] **R4.22 Buyer GST details and tax classification**
  - **Depends:** **R3.6** (India tax model), **R4.15** (encrypted guest fields on OrgDO). City ledger already ships.
  - **Pilot checklist:** *GST / e-invoice QR on invoices*. **Page:** [Tax & Compliance](https://www.bluepms.com/modules/tax-compliance/), Buyer Tax Identity And Source Documents, Tax Master And Classification, Statutory Document Output. **Prototype:** none.
  - **Live:** R5.5 and §7.9 require the buyer's GSTIN on the invoice, but nothing says where it is captured. "GSTIN" is in no code, the `invoice` table has no buyer columns, and `city_ledger_account` holds only name, credit limit and terms. HSN/SAC is nowhere.
  - **Locked:** one buyer record, captured in three places. **Company:** GST details on the city-ledger account. **Individual guest:** on the OrgDO profile, encrypted, property-scoped on read. **At invoice time:** `invoice.generate` takes buyer type (registered or unregistered) and fields prefilled from those two, editable by the clerk. Fields: GSTIN, legal name, trade name, address, city, state, PIN, state code, place of supply. GSTIN is validated for format and checksum; over-long fields → 422.
  - **Locked (the snapshot):** the issued invoice keeps a **buyer snapshot** that later edits never change. The invoice spec keeps plaintext out of its R2 snapshot (`guestRef` and `piiKeyId` only), so the snapshot of an individual's details lives encrypted in OrgDO, keyed by invoice id; a company's may sit with the invoice. §4.8 lets financial records survive erasure pseudonymized, but a tax invoice names its buyer: **the advisor confirms how DPDP erasure treats it**, and the purge certificate says what was kept. Events carry `guest_ref` and invoice id only.
  - **Locked (classification):** HSN/SAC is one attribute of the charge code's product class (§7.9), the same single carrier as the tax group: never a second copy on products. It prints per line on the tax invoice and proforma, with the seller's GSTIN (R3.6) and the tax breakup. **The advisor confirms what a tax invoice must show**, including whether place of supply can differ from the hotel's state for accommodation.
  - **Tests:** editing an account after issue leaves the issued invoice unchanged; hotel A cannot read hotel B's guest GST details (AGENTS §5); an invalid GSTIN is refused; a B2B invoice with no GSTIN cannot reach the R5.5 queue; the fingerprint hashes the object sent.
  - **Scope out (client Q14):** provider GSTIN lookup; GST returns and registers; buyer details on a POS bill (**R4.21**).

- [ ] **R5.5 Fiscalization (India e-invoicing)**
  - **Depends:** **R3.6** (India tax model), **R1.12** (financial-year invoice series), **R4.22** (buyer details and HSN/SAC), **R4.5** (the portal call is outbox-driven).
  - **Moved (2026-10-27):** from Track 6 into the pilot — an Indian hotel above the turnover threshold cannot legally issue a B2B invoice without it.
  - **Locked:** IRN and signed QR from the Invoice Registration Portal for **B2B invoices** (the guest's or company's **GSTIN** on the invoice), through the §7.9 requirement 7 **fiscal-document hook** on the existing invoice engine — not a second invoice path. The portal is called from an outbox consumer, never inside `transactionSync`. A B2B invoice is **not final until its IRN returns**; a portal failure lands in the exception workbench with Retry, and the desk is told plainly — checkout itself is not blocked. Cancellation inside the portal's window, then credit notes. Key `compliance.fiscalization` (every tier, §6.7). Portal credentials are `SECRET` class.
  - **Queue (widened 2026-10-31, [Tax & Compliance](https://www.bluepms.com/modules/tax-compliance/), E-Invoice Queue And Submission):** a view by document, status, IRN, QR and failure, with these actions: inspect the payload; **correct and rebuild** with a preview before replacing it; a dry run where the portal or provider supports one; **manual acknowledgement** requiring the official IRN and QR, for when the portal answered but the callback was lost; cancel a never-submitted item, kept distinct from an IRN cancellation. Every step writes an audit event. Live submission stays outbox-driven.
  - **Printed output:** IRN, acknowledgement number and date, QR image, seller and buyer GST details, HSN/SAC and tax breakup, on the existing invoice document.
  - **Reversal guard:** a settlement or bill reversal (**R4.29**) checks IRN state first; an acknowledged invoice is cancelled at the portal or corrected by credit note, never voided locally.
  - **Night audit:** add the R1.10 spec's tax-document readiness check to the shared evaluator; no new step.
  - **Scope out:** B2C dynamic QR (only above a much larger turnover threshold — confirm the client is below it); Quebec sales-recording; GST return registers unless client Q14 names them.

- [ ] **R6.2 Form C — foreign-national guest registration (India)**
  - **Depends:** **R4.15** (passport and visa fields).
  - **Not ticked by the pilot, but a legal duty in India** (§7.9): an arrival record for each foreign national to the Bureau of Immigration within 24 hours. Ask the client how they file today (checklist Q5) before building beyond the tracker.
  - **Locked:** a Form C person record for **each foreign national on the stay**: the booked guest's from the profile's documents, any other's captured at check-in. Each has a **24-hour deadline** from check-in; an unfiled record past the deadline is an exception on the workbench. Submission is manual on the government portal unless an official API exists — HospAI produces the data and tracks the filed reference; it does not scrape or auto-submit a portal.
  - **Decided F4 (narrow exception to party size):** a person record's document data is encrypted in OrgDO and covered by purge. It is not a guest profile, has no `guest_ref` on the stay and no CRM row, is not in guest search or the directory, and sends no event PII. `adults` / `children` stay the party for folio and inventory. The advisor confirms the duty per person and the retention period (go-live sign-off).
  - **Tests:** two foreign nationals on one stay give two records with separate deadlines; hotel A cannot read hotel B's records (AGENTS §5); purge removes them and the certificate says so; a person record adds no row to the guest directory.
  - **Scope out:** C-form departure updates beyond what the portal requires; other countries' guest registration.

- [ ] **R4.18 Desk tenders for India — fork, Blocked until the client answers**
  - **Pilot checklist Q4:** which tenders the desk records today. Indian desks commonly take **UPI** and **bank transfer** alongside cash and card.
  - **Locked:** `tender_type` stays `CARD` \| `CASH` (cashiering spec, AGENTS §2) **until that spec is amended**. If the client needs more, amend [cashiering](superpowers/specs/2026-08-07-cashiering-design.md) first — tender list, shift-close expected amounts and the R4.12 ledger mapping — then implement. Recording a payment taken on an external terminal or UPI app is a tender, **not** a gateway integration (that is R4.7 / R5.4).
  - **Partial evidence (2026-10-31):** BluePMS's guest-charge payment lists cash, card, UPI, room posting, split and debtor account, with transaction id and notes. That says what the product offers, not what this desk records: still ask.
  - **Scope out:** UPI collect / gateway integration; cheques, vouchers, gift cards unless the amended spec names them.

- [ ] **R4.25 Advance collection and numbered receipts**
  - **Depends:** **R1.20** (the prepayment rule), **R4.18** (tenders), **R1.12** (numbering), **R1.15** (stay card).
  - **Pilot checklist:** *Advance / deposit payments in the booking*; part of *Guest documents*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Advance Collection, Receipts And Deposits. **Prototype:** none.
  - **Live:** `BookingScreen` has no payment step, and R1.20 only gates on `require_prepayment`. `folio.record_cash_payment`, `folio.authorize` and `folio.capture` exist, and the cash path checks only that the reservation exists, so a pre-arrival payment looks possible (read, not run: prove it with a test first).
  - **Locked:** an advance is a **payment on the guest window through the existing commands**. No new deposit command or money model, and nothing on `availability_day`. Take it after Hold or Confirm on Book, on the stay card, at check-in and on the folio: one flow, reused. Several payment rows per capture, each with its own op id, posted like R1.4's add-ons (Retry re-posts only the failed rows; the booking stands). Method, transaction reference and notes per row, as far as the R4.18 amended spec allows.
  - **Locked (receipt):** a numbered, printable receipt with its own series configured on R1.12. Never rendered in `DEGRADED`. A panel shows estimated bill, total advance and pending amount from the existing quote and folio reads, with no second money calculation. A refund or cancelled stay uses the existing `folio.refund` and penalty paths.
  - **Fork — advisor:** must an advance on a future stay carry GST and a statutory receipt voucher? If so, the receipt series and tax lines follow that answer. Do not build the receipt before it comes back.
  - **Night audit:** add the R1.10 spec's arrival-deposit check to the shared evaluator, reading the R1.20 rule.
  - **Tests:** two rows post once each on retry; an advance on a confirmed stay reaches the guest window and survives check-in; checkout balance nets it; receipts number consecutively.
  - **Scope out:** group deposit allocation (**R4.1**); gateway capture (**R4.7**); a standalone advance page unless client Q21 asks for one.

- [ ] **R4.20 Day-wise rate override on a reservation**
  - **Depends:** **R1.4**, **R1.15**, **R3.6**.
  - **Pilot checklist:** *Day-wise rate overrides* in *New reservation*. The rates matrix (shipped) sets a plan's price per day; this is the clerk changing **one booking's** price for chosen nights. Nothing in pms-core supports it today.
  - **Locked:** the override replaces the snapshotted nightly amount on the stay (read the [reservations book](superpowers/specs/2026-07-27-reservations-book-design.md) and [modify](superpowers/specs/2026-07-27-reservations-modify-design.md) specs for where that snapshot lives — do not add a second price column). Integer minor units, a required reason, an audit-log write and its own permission. `POST_ROOM_CHARGES` posts the overridden amount, and **tax resolves per night on the overridden value** — in India that can move a night across a GST slab (§7.9 requirements 2 and 4). Modify keeps overrides on nights that remain.
  - **Page note (2026-10-31):** BluePMS's day rows also cover plan and package amounts and a show/hide rate toggle. Room nights are this slice; plan and package rows join once **R4.13** has them. An override can also be made at check-in, while the night is unposted.
  - **Tests:** an override that crosses a slab boundary posts that night's tax at the new slab; the other nights do not move; a clerk without the permission gets 403.

- [ ] **R4.26 Room number at booking**
  - **Depends:** **R1.4**, **R1.15**.
  - **Pilot checklist:** *New reservation (… room number …)*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Reservations, Rates And Packages. **Prototype:** `BookingWizard.tsx`.
  - **Live:** `tryCreateReservation` takes no `roomId`; assignment happens later from arrivals (R1.3). `tryAssignRoom` already accepts `pending`, `confirmed` and `checked_in`.
  - **Locked:** an optional room picker on Book, listing free rooms of the chosen type and dates from `get_front_desk_available_rooms`. After Hold or Confirm, POST the existing `reservations.assign_room`, as R1.4 posts add-ons: the booking stands if assignment fails, and Retry re-sends it. **No new command and no `roomId` on create.** Inventory stays per room type (§7.1). The tape's empty-cell link passes the room to Book as a prefill. Changing the room lives on the stay card.
  - **Tests:** a picked room is assigned and shows on arrivals; a room taken in between returns `ROOM_ALREADY_ASSIGNED`, and the booking remains; `sold` moves once.
  - **Scope out (client Q16):** a waitlist status; booker and guest-type fields. The status vocabulary stays §7.4's.

- [ ] **R4.24 In-house stay changes**
  - **Depends:** **R1.15**, **R1.19**, **R4.20** (nightly amounts), R0.14 (early depart, shipped).
  - **Pilot checklist:** *Edit reservation and guest preferences*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Check-In, Stay And Checkout (edit check-in). **Prototype:** none.
  - **Live:** `tryModifyReservation` accepts only `inquiry`, `pending` and `confirmed` (`NOT_MODIFIABLE` otherwise), so **no desk command can extend an in-house guest**. `reservations.early_depart` shortens. Auto-extend is a night-audit setting, not a clerk action. R1.19 moves a guest within one type.
  - **Locked:** a **named command** (AGENTS §2), not a wider `reservations.modify`: an in-house stay has posted nights, which must not re-price. It covers later departure, room type or rate plan from the next unposted night onward, and party size. `availability_day` moves in the same `transactionSync`: `sold` +1 on each new night, with `freeAvailability` and `no_availability` on shortage, and a type change moves `sold` for remaining nights only. Shortening stays `reservations.early_depart`. Posted folio lines are never touched; new nights price and tax per night at posting. A required reason, an audit write and its own permission. The assigned room must be free for the new nights, or the clerk moves first (R1.19). Invalidate `['board']`, tape and summary.
  - **Tests:** extending into a sold-out night is refused and changes nothing; `sold` +1 on the new night only; a type change leaves posted nights' lines untouched; auto-extend and a clerk extension on one night do not double-count; a clerk without the permission gets 403.
  - **Scope out (client Q16, Q20):** BluePMS's early-departure penalty options and manager override; correcting a posted night (reversal through the folio); extra named guests (F4 allows only the R6.2 Form C record).

- [ ] **R4.13 Front Office depth — packages, proforma, document templates**
  - **Depends:** **R3.2** (recurring charges) and **R3.3** (rate-plan inclusions) — packages are built on both. **R1.5** for add-on products.
  - **Prototype:** `PackageMaster.tsx`, the Booking Wizard package mode, proforma and registration-card template switchers.
  - **Scope (§16.6 *Core*):** package templates (room type, plan, number of nights, fixed price, included add-ons) with a **posting schedule** — every night, arrival day, a set night, or before departure — executed inside the existing `POST_ROOM_CHARGES` step (do **not** grow `NIGHT_AUDIT_STEPS`); add-on scheduling for full stay, arrival, departure, weekends, single days or **chosen dates**; a proforma invoice from a reservation **or a check-in**, showing base, tax summary, pricing warnings, advance paid and balance; selectable templates and print settings for the proforma and the registration card; a registration card from a reservation or a check-in, reprintable from the in-house list; applying a package at check-in as well as at booking.
  - **Locked:** a package splits into posting lines that each carry their own tax under §7.9 — a bundled price is never taxed as one line. Printable documents never render in `DEGRADED` (§4.6). **Advisor check first (see R3.6):** if India treats a package as a composite supply, or a plan joins the room for the slab, this lock changes before the first package posts. R3.3 made both configurable per plan, so the advisor sets the answer in Settings rather than changing code.
  - **Guest documents (client Q11):** this slice plus the **R4.25** receipt are BluePMS's printed set. Document action buttons sit together on the stay card.
  - **Scope out:** a template *designer*; e-invoicing (**R5.5**); emailing a proforma (client left Communications blank; **R5.2** if ever asked).

- [ ] **R4.23 Open folio (bill on hold)**
  - **Depends:** **R1.10** (shared check evaluator), **R1.15**.
  - **Pilot checklist:** *Front-office billing and open folio*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Bill On Hold / Open Folio. **Prototype:** `FrontDesk.tsx` mentions it; the page is the source.
  - **Live:** a "Depart with open balance" override on checkout (`overrideBalance`), and window reopen. No hold record, approver or follow-up. `tryAddFolioLine` checks only that the reservation exists and the window is `OPEN`, and checkout normally leaves the window open, so **a charge can reach a checked-out stay today with no approval** (read, not run: pin this with a characterization test first).
  - **Locked (the hold):** one hold record on a stay's GUEST window, with reason, notes, follow-up date, close-by date, approver and expected settlement. Named commands to place, release and extend it, each with a required reason, an audit write and an approval permission separate from `folio:post`. Closing uses the existing `folio.close_window`. Holds are never deleted. Checkout with an active hold passes the balance gate by reference to the hold, not through `overrideBalance`, which stays for its existing config. The hold reads the **guest window only**; COMPANY windows and city-ledger AR are untouched (AGENTS §2).
  - **Locked (post-stay charges):** §7.3 rule 3 stands: a **closed** window rejects postings and goes to the exception path, and a hold never reopens one silently. A checked-out stay takes a new charge **only with an active hold**; without one, the posting is refused with a named code. This tightens today's behaviour, so characterize it first. The R4.21 POS lookup still refuses checked-out stays.
  - **Locked (night audit):** the open folio and hold checks in the R1.10 spec's list join the shared evaluator as check ids, counts only: unsettled, past close-by, zero-balance. Auto-open and auto-close at zero are DOMAIN keys the DO reads, run inside an existing step, each row caught separately (AGENTS §2). **`NIGHT_AUDIT_STEPS` does not grow.** No inventory change: remaining-night `sold` rules are unchanged.
  - **Tests:** a charge posts on a held checked-out stay and is refused without a hold; a closed window refuses either way; a past-close-by hold counts in the preview and in PRE_CHECK; a place-hold replay posts once; a clerk without approval gets 403.
  - **Scope out:** source-module bypass controls; a generic document-hold layer; POS bill hold (vendor, R4.21); the open-folio register report (**R4.14**, if the client names it in Q10).
  - **Client Q12:** sets who approves and the default dates. It does not remove the slice: the tick is a must-have.

- [ ] **R4.29 Billing depth — draft bill and reversals**
  - **Depends:** **R4.23**, **R4.13**, **R1.12**. The IRN guard takes effect once **R5.5** lands.
  - **Pilot checklist:** *Front-office billing and open folio*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), FO Billing And Cashiering, Reversals, Cancellations And Audit Controls. **Prototype:** `FoliosBilling.tsx`.
  - **Live:** line split, same-stay window transfer, invoice generate and void, payment void and refund. No draft step and no settlement-cancel path.
  - **Locked (draft):** a read-only draft of the bill from the guest window, with charge review and a tariff check showing posted, unposted and future nights. It takes no invoice number; the existing `invoice.generate` makes it final. Tariff is corrected through the existing posting and reversal paths: nothing edits a line (append-only).
  - **Locked (splits):** equal, source-based and custom splits build on the existing split and transfer contracts with `allocate`, footing exactly. Tax copies, as in split and transfer today.
  - **Locked (reversals):** void a pending bill, then regenerate. Cancel a settlement by reversing payment lines through the existing commands. Both require a reason, a separate high-privilege permission and an audit write. A settled hold returns to active. An acknowledged IRN blocks a local void (**R5.5**). A stay is reopened only if no room conflict exists.
  - **Decided F1:** line transfer to another room stays rejected unless Q17 shows the desk really moves lines; then it is one named command, per [the decision](#fork-decisions). The rest of this slice proceeds.
  - **Tests:** a draft changes nothing; a split foots to the minor unit; a settlement cancel reverses the payment once on replay; a clerk without the privilege gets 403; a transfer to another reservation still returns `transfer_cross_reservation` unless Q17 lifts it under F1.
  - **Scope out:** group master bill (**R4.1**); controlled negative adjustments and facility charge bills unless client Q16 asks.

- [ ] **R4.27 Live room view**
  - **Depends:** **R1.3**, **R1.9**, **R4.29** (the billed state).
  - **Pilot checklist:** *Live room view by status*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Room Operations And Availability. **Prototype:** `RoomOpsLiveView.tsx`.
  - **Live:** `/board` is the tape: stays and OOO ranges with the current status word beside each room. It has no billed state and no grouping by condition. The housekeeping board has no occupancy. §16.6's earlier "covered by `/board`" is corrected.
  - **Locked:** one screen of **rooms for today, not dates**: grouped by room type and by condition (available, reserved, occupied, dirty, maintenance, billed, unavailable), with type and condition filters. It is **not a second grid**. One property-scoped read returns each room's code, type, status, OOO state and today's assigned stay. Summary cards reuse `get_front_desk_summary`; capacity comes from `availability_day`, and nothing counts reservations to answer capacity. Guest names go through the existing property-scoped batch. Actions are links to what exists: Book, Check in, Assign, Folio, Release. The word is always shown (`RoomStatus`, `StatusBadge`). The mutation screens invalidate its key.
  - **Tests:** a checked-in stay shows occupied with its guest; a checked-out room shows dirty; OOO shows maintenance; a bill awaiting settlement shows billed; hotel A sees only hotel A; card counts match `get_front_desk_summary`.
  - **Scope out:** calendar settings; door lock and Wi-Fi actions.

- [ ] **R4.28 Room operations grid depth**
  - **Depends:** **R4.27** (shared room condition).
  - **Pilot checklist:** *Room operations grid / tape*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Room Operations And Availability. **Prototype:** `TapeChart.tsx`.
  - **Live:** `/board`, capped at 14 days (`MAX_TAPE_UI_DAYS`), with OOO ranges and the room's current status word. No occupancy row or per-date state.
  - **Locked:** widen `/board`; **no second grid**. An occupancy row per date from `availability_day` through an existing read, never a reservation scan. Reserved, occupied, dirty-today, billed and maintenance states, colour with the word (`StatusBadge`). Room-type and status filters. `--tape-*` grid math stays; no drag-to-move; no new assign POST on the tape.
  - **Decided F2:** the range stays capped at 14 unless Q18 shows the desk plans further out; then raise it to 30 after measuring at this hotel's room count. The rest proceeds.
  - **Tests:** the occupancy row matches `availability_day`; the query key carries `propertyId` and the range; a filter keeps tape invalidation working.
  - **Scope out:** calendar colour settings; a virtualizer on the default 7 days.

- [ ] **R4.30 Housekeeping tasks and room status history**
  - **Depends:** **R1.9**.
  - **Pilot checklist:** *Task assignment to attendants*; *Room status (… with comments)*; *Maintenance / out-of-order blocks*. **Page:** [Housekeeping](https://www.bluepms.com/modules/housekeeping/), Tasks, Attendants And Maintenance, Room Status, Turnaround And Checkout. **Prototype:** `Housekeeping.tsx` (`hkTasks`).
  - **Live:** `housekeeping_assignment` is one assignee per room per business date, with no type, status or lifecycle. `updateRoomStatus` takes only `roomId` and `status`; `room.status_changed` carries from and to, and nothing reads them back. A full OOO release deletes the `room_ooo` row (the ticket keeps a timestamp). The maintenance module's tickets are work orders and stay separate.
  - **Locked (tasks):** a task record in `pms.housekeeping` through `moduleTxnCtx`: date, type, room, attendant, priority, status, supervisor notes. Search, start, update, complete, review and cancel, with counters for open, pending, in progress, completed and overdue. Types are a property list. How `housekeeping.assign` relates to a day's clean is the spec's call; the assign screen keeps working. **R4.11** stages and requests hang off this record, and **R5.2** reuses it.
  - **Locked (status history):** `rooms.update_status` and bulk status gain an optional reason and comment, written to a status history row in the same transaction, including checkout's automatic dirty as a system actor. Marking dirty requires a reason; clearing takes a comment. Cap applies to bulk as today.
  - **Locked (blocks):** add block type, optional start and end **time**, inspection notes and a required release reason, with a release history that survives a full release. **`availability_day` stays per night:** times are display and audit only, and OOO → `blocked` rules are unchanged. A ticket never releases a room by itself (R1.9 decision) unless client Q22 changes that.
  - **Tests:** a task moves through its lifecycle and an invalid transition is refused; a status change writes one history row, and a retry writes none; a release keeps its history row and frees `blocked` as today; hotel A's list shows no hotel B rows.
  - **Scope out:** auto-assign (R1.9 leftover); SLA and escalation; attendant mobile capture (**R4.10**).

- [ ] **R4.11 Housekeeping depth**
  - **Depends:** **R1.9**, **R4.30** (the task record). **R4.10** is no longer a dependency — the pilot needs this before the mobile app ships.
  - **Prototype:** `Housekeeping.tsx` Tools (BluePMS parity Phase 2).
  - **Scope (§16.6 *Core*):** lost and found custody — found, handed over, claimed or closed, never deleted, with item, location, room and guest; missing and damaged cases with reporter, inspection detail, returned-item status and closure; guest-count audit comparing front-office occupancy with housekeeping counts by room, floor and type, in dated sessions, with count adjustment, a variance reason and saved evidence; scored inspections from checklist templates that can be activated and deactivated (weighted items, required checks, defects, remarks, room score); cleaning stages (started, paused, resumed, inspected, completed, released) on the **R4.30** task; a linen item list and movements for issue, return, laundry, discard and adjustment by room and attendant; minibar pickup **posted through the folio contract**, never inserted, with a reconciliation view of pickup, folio charge and stock.
  - **Amenity delivery (corrected 2026-10-31):** an amenity list with unit, standard quantity and linked stock item; rule templates for expected supply; planned and confirmed dispatches with expected vs actual, a required exception reason and optional supervisor confirmation; a dispatch ledger. An amenity is a **stock movement**: it posts to the folio only if the client charges for it (Q22), and then through the folio contract.
  - **Guest requests against a room (pilot checklist):** a room-scoped request — extra towels, cot, amenity — raised from the desk, with type, responsible department, ownership, search and resolution, assigned to an attendant where the department is housekeeping and closed on the HK board. Moved here from the **R5.2** concierge tasks because the pilot needs it before Whistle; R5.2 reuses this task type rather than adding a second list. Not a maintenance work order (that stays the R1.9 module on `room.ooo_changed`).
  - **Locked:** **desktop capture first** — the supervisor records finds, damage, inspections and minibar pickups on the operator SPA. Attendant capture moves to the **R4.10** mobile app when it ships, on the same commands. No width breakpoints in `web-pms`. Minibar and amenity stock moves against the R1.9 operational list, using its issue-to-room leftover (spec §8 item 7) — **no stores inventory** (§16.6). Linen movements extend R1.9's receive, issue and count to carry a room and attendant. Post minibar straight to the folio; do not create a POS bill to do it.
  - **Scope out:** budgeting and productivity charts (still dropped; the supervisor's operational dashboard is **R4.31**, not this exclusion); stores inventory; productivity pay. Reports are **R4.14**.

- [ ] **R4.31 Housekeeping supervisor dashboard**
  - **Depends:** **R4.11**, **R4.30**, **R4.27**.
  - **Pilot checklist:** *Supervisor dashboard*; *Priority / floor-by-floor workbench*. **Page:** [Housekeeping](https://www.bluepms.com/modules/housekeeping/), Command Center And Room Readiness, Room Status, Turnaround And Checkout. **Prototype:** `Housekeeping.tsx`.
  - **Live:** a status table with filters, a workload strip and the R1.9 priority queue.
  - **Locked:** today's operational reads composed on the HK screen: readiness percentage, dirty rooms, open and overdue tasks, active blocks, open requests, unclaimed items, damage cases, audit variance; expected arrivals and departures by room; readiness by floor; room search with stay context. **One attention queue** across conflicts between occupancy and room status, overdue tasks, blocks, requests and unresolved damage, each row linking to its screen. Room-level reads only: no trend, no warehouse, no capacity from reservations.
  - **Tests:** counts match their source reads for a seeded day; an occupied room marked vacant-clean appears as a conflict; hotel A sees only hotel A.
  - **Scope out:** charts and trends (§7.8); checkout-time alerts unless client Q22 asks, because they need an expected checkout time the stay does not hold today.

- [ ] **R4.3 Channel manager connector — third-party channel manager**
  - **Decided 2026-10-28:** HospAI **does not build a channel manager** and does not connect to OTAs directly. It connects to **one third-party channel manager**, which holds the OTA connections, OTA certification and listing content (§16.6 *Integrate*). All seven ticked distribution features are met by that channel manager plus this connector. Industry practice and the forks below: [channel manager integration research](research/2026-10-28-channel-manager-integration-practice.md).
  - **Depends:** **R4.5** (outbox), **R3.10** (`channel_manager.enabled`), **R1.6** (sources and market segments), **R3.6** (tax on OTA bookings). ARI_KV already ships.
  - **Prototype:** `ChannelManager.tsx`, `DistributionSettings.tsx`, Rates `channels` tab — read for the operator flows only; the sync-log and OTA screens are the channel manager's.
  - **Fork — which channel manager (pilot checklist Q6):** the client may already use one between BluePMS and the OTAs; prefer it, since its OTA mappings carry over. It qualifies only if it reaches the client's OTAs (for example Booking.com, Agoda, Expedia, MakeMyTrip / Goibibo) and meets the requirements below. Indian candidates to evaluate include STAAH, eZee Centrix, AxisRooms, RateGain and SiteMinder — none has been checked against this list.
  - **HospAI builds:**
    - **ARI push** — availability from the `availability_day` ledger (`freeAvailability`, through ARI_KV), rates and restrictions per room type, rate plan and date, driven by `availability.changed` and rate events from the outbox, inside the §4.6 *OTA push freshness* SLA (≤ 2 min). Restrictions push alongside ARI, and again after any mapping change. A **full sync only when a property connects or the operator asks**, deltas after that, and at most one off-peak reconciliation sync per 24 hours — never a timer-driven full push. Changes are batched per property behind a rate limiter, in order (FIFO). Bulk pushes run in the `BULK` lane.
    - **Booking receipt** — new, modified and cancelled bookings from the channel manager map onto the **existing** `reservations.*` commands (book, modify, cancel); no second booking path. Idempotent on the channel manager's booking id plus its revision. **Acknowledge only after the reservation is committed** in the PropertyDO. Push (a Worker endpoint) and pull (a scheduled poll every 2–5 minutes) are both supported, per channel manager. A booking with no availability is accepted as an overbooking (decided below).
    - **Mapping** — room types and rate plans to the channel manager's codes, configured per property and read inside the DO. A booking whose room or rate code has no mapping lands on the **unmapped-booking queue** in the exception workbench; it never silently drops.
    - **Source and commission** — each booking records its channel as the reservation source (R1.6) and the commission the channel manager reports, per booking; a per-channel commission and settlement view reads those rows. HospAI does not compute commission.
    - **Connector status** — last successful push and receipt, and failures, shown to the operator; a failed push retries from the outbox and raises an exception past the SLA.
  - **Locked:** gated module, outbox-driven, **no special cases in PropertyDO**. The channel manager's credential is `SECRET` class, per property, revocable at kill-switch speed. Key `channel_manager.enabled` (**all tiers**, §6.7); `channel_manager.connections.limit` `3 / 15 / ∞` counts OTA channels mapped in the connector. Room nights from OTA bookings follow the ledger — **never** count reservations to answer capacity. Tax on an OTA booking is HospAI's under §7.9, not the OTA's. Plan-scoped restrictions **may** land here (ARCHITECTURE lock). The vendor-specific part sits behind one adapter contract, so a second channel manager is a new adapter, not a change to the core.
  - **Channel manager must support:** a documented PMS interface with two-way ARI (availability, rates and restrictions per room type, plan and date); booking delivery with modify and cancel, a stable booking id and version, and an acknowledge / reject response; commission per booking; the OTAs the client needs; a sandbox and a PMS certification process.
  - **Decided 2026-10-28 — OTA booking with no availability:** accepted, never rejected for inventory (`ARCHITECTURE.md` §7.1 *Channel-delivered bookings*). The booking still commits through the ledger, `free` goes negative on the over-sold nights, each night raises an overbooking exception on the workbench, tonight's over-sold nights are a `PRE_CHECK` exception, and the ARI push clamps at 0. Restriction and stop-sell violations on a delivered booking are handled the same way. Only the connector's credential reaches this path; the booking engine (R4.2), desk, API and agents keep reject-on-commit.
  - **Fork — card data.** OTAs send guest cards or virtual cards inside the reservation; HospAI never stores a card number or CVV. Choose a tokenisation proxy, a channel manager setting that strips card data, or the OTA extranet — with the client's channel manager, alongside **R1.20** and **R4.18**. Prepaid OTA bookings are recorded as a tender or a city-ledger receivable per R4.18 and the cashiering spec; do not add a tender type here.
  - **Fork — per-occupancy prices.** Many OTAs price by number of guests; HospAI's rate plans have no per-occupancy price. This is a price per number of adults, not the banned occupancy-pricing UI. Confirm what the client's channels need; if needed, it is its own rate-plan slice before R4.3.
  - **Tests:** a duplicate booking delivery books once; a modification of an unknown booking lands on the unmapped queue; a booking is acknowledged only after it commits; a delivered booking for a sold-out night books, takes `free` below zero, raises one overbooking exception per night and pushes 0 to the channel; the same request from a desk user or the booking engine is rejected with `no_availability`; a repeated delivery of one revision books once and deducts inventory once; a booking at hotel A pushes ARI for hotel A only; a push past the SLA raises an exception; the chosen channel manager's certification scenarios pass in its sandbox.
  - **Client Q23 — OTA payouts:** the per-channel view reads the commission each booking reports; **nothing matches OTA payouts**. BluePMS's page mentions settlement review and reconciliation but gives no inventory. If the client relies on it, add it here before build.
  - **Scope out:** direct OTA connections; a channel manager of our own; OTA content (photos, descriptions); rate-parity tools; metasearch; a second channel manager in this slice.

- [ ] **R4.12 Accounting export**
  - **Why:** every one-to-ten property owner keeps books in accounting software, and neither BluePMS nor the prototype integrates one. It is also where purchasing, stock and payroll meet the PMS without us building those modules (§16.6).
  - **Locked:** export revenue, tax by jurisdiction component (§7.9), payments, deposits and AR as journal-ready summaries per business date and property, mapped to a tenant-configured chart of accounts. Build from night-audit snapshots — **never** a live read across PropertyDOs (§7.6). Idempotent per business date: a re-export produces the same journal.
  - **First targets:** **Tally and Zoho Books** (India pilot), with GST posted by component (`CGST` / `SGST` / `IGST`) to the configured ledgers. QuickBooks Online and Xero follow in **R4.19** with the Canada launch.
  - **Also locked:** payroll *inputs* — hours from roster and shift (POS clock-in stays in the vendor's system), and tips, service charge and commissions where captured — export as a file for the operator's payroll provider. **We do not calculate pay.**
  - **Also:** outlet revenue from the **R4.21** day-close totals journals as outlet revenue; room-charged checks are already in the folio and must not be counted twice.
  - **Client Q13:** BluePMS publishes no accounting page, so how the hotel gets figures into Tally or Zoho today sets the file format and mapping.
  - **Key:** `accounting_export.enabled` (§6.7, every tier).
  - **Scope out:** purchasing, stores inventory, payroll calculation, a general ledger inside HospAI.

- [ ] **R4.9 On-property interface framework**
  - **Pulled into Track P (2026-10-27):** the pilot runs a third-party restaurant POS (§16.6), so the framework is needed for its connector before anything else in Track 5.
  - **Why it matters beyond the pilot:** a full-service upscale property runs fifteen to thirty on-property interfaces. Each missing one is a manual process the buyer prices into the deal, and this segment is the entry ticket to groups. **Reverses a Phase-1 scope call:** keyless / door-lock was *dropped* in the holes sweep as prototype-parity work — it returns here as a real interface, which is a different thing.
  - **Locked:** build the **framework, not N integrations** — a typed adapter contract, outbox-driven, each adapter a gated module with its own entitlement, none of them special-cased inside PropertyDO. Ship the framework plus **one** adapter end-to-end to prove it — the **R4.21 POS connector**. Door lock and spa follow in Track 5, each as its own slice on this framework.
  - **Scope out:** the POS adapter itself (**R4.21**), building N adapters in this slice, any adapter that needs a core change to work — if it does, fix the framework.

- [ ] **R4.21 POS connector — PMS interface for a third-party restaurant POS**
  - **Depends:** **R4.9** (adapter framework), **R4.5** (outbox), **R3.6** (restaurant GST components), **R3.10** (`pos.enabled`).
  - **§16.6:** restaurant POS is *Integrate* through this connector. All twelve ticked POS features (table board, outlet reservations and waitlist, order entry, KOT, KDS, split checks, settlement with tips, split tender and email, cash movements, staff clock-in / out, menu waste, promotions, outlet demand forecasting, POS reports) are the **vendor's** — the must-have is met by the vendor's product plus this slice.
  - **Fork — vendor (pilot checklist Q2):** the client picks the POS. It qualifies only if it covers all twelve features above **and** meets the vendor requirements below. Indian candidates to evaluate include Petpooja, Restroworks (formerly Posist) and Rista — none has been checked against this list.
  - **HospAI builds:**
    - **Room lookup** — room number (or stay reference) → in-house or not, chargeable or not (honours the stay's `no_post` flag and refuses checked-out stays), a minimal display name, the stay reference and the target window (GUEST / COMPANY). Each lookup is audited.
    - **Post to room** — outlet, check number, business date, covers, server, revenue lines by class, the POS's GST components, tip, discount → one posting through the folio contract (`folio.add_item` path), idempotent on **(outlet, check number)**. Refusals use named error codes (`no_post`, checked out, not found) from the one `commandErrorHttpStatus` table.
    - **Void / correction** — a reversal line, never an edit (append-only folio).
    - **Mapping** — outlet and revenue class → charge code and §7.9 product class, configured per property and read inside the DO.
    - **Events to the POS** — check-in, check-out, room move and `no_post` changes, from the outbox, carrying the stay reference and no guest PII beyond the display name.
    - **Outlet day-close totals** — revenue and tender totals per outlet per business date, for **R4.14** and **R4.12**; they never touch a folio.
    - **Optional forecast feed** — rooms on the books and arrivals by day from `availability_day` (no reservation scan), for the vendor's covers forecast.
    - **Night audit** — an outlet with no day-close or a failed posting is a `PRE_CHECK` exception on the workbench; no new audit step.
  - **Locked:** the adapter's credential is `SECRET` class, per property, scoped to lookup and posting only, revocable at kill-switch speed. Posts carry the hotel **business date**, never the POS's wall clock; the POS queues while HospAI is unreachable and replays with the same idempotency key. The folio **copies the POS's tax amounts** (as transfer and split do) and rejects a posting whose GST rate does not match the property's specified-premises declaration — it does not recompute.
  - **Vendor must support:** a documented PMS interface (room lookup, idempotent post-to-room, void, receiving stay events); GST posted by component with a per-property restaurant rate; posting against the hotel business date and a day close; and **not issuing a separate GST tax invoice for a check charged to the room** — that F&B appears on the hotel's checkout invoice, which carries the IRN for B2B guests (**R5.5**). Confirm the invoicing rule with the client's tax advisor.
  - **Vendor check, from the page ([Point of Sales](https://www.bluepms.com/modules/point-of-sales/), 2026-10-31):** ask for table states (occupied, vacant, reserved, active, billed); waitlist; orders by server and type, modifiers; non-chargeable KOT with reason, BOT, kitchen routing, reprint; KDS delay threshold and moving orders between tables, guests or outlets; bill on hold, pending bills, service charge and round-off; tips and split methods; paid-in, paid-out, sessions, breaks and staff allocation; waste reasons and cost; free-product rules by day and hour and usage limits; forecasts of sales, staffing and preparation.
  - **Open — B2B check paid at the outlet (advisor and vendor):** this slice covers room-charged checks. A company guest paying at the restaurant may need an IRN on that check, and BluePMS shows buyer GST on a POS bill. Who issues it, the vendor or HospAI? Do not pick before the advisor answers. If it is the vendor, add it to *Vendor must support*.
  - **Tests:** a duplicate post of one check charges the room once; a post after check-out is refused with a named code and lands on the workbench; the posted tax components foot to the check total; a missing day-close raises a pre-check exception.
  - **Scope out:** tables, orders, kitchen, settlement, promotions and POS reports (vendor); a second POS vendor; stock and recipe costing (§16.6).

- [ ] **R4.14 Operational report set (named, not a catalogue)**
  - **Depends:** **R1.1**, **R1.16**, **R4.11**; the POS and distribution reports land with **R4.21** and **R4.3**.
  - **Pilot checklist:** front-office reports, housekeeping reports, POS reports, distribution reports.
  - **Locked list — nothing outside it without a new slice (§16.6 "Reports are not a backlog"), rewritten once from the client's Q10 answer (F3):**
    - **Front office:** arrivals, departures, in-house, **forecast** (rooms on the books by day, read from `availability_day` within the 90-night cap — not a reservation scan), cashier (shift close per cashier), night audit (existing `SNAPSHOT_REPORTS`), and from the R1.10 spec: night-audit revenue, daily statistics and end-of-day control, read over those snapshots and the R1.10 check log, with layouts from the client's samples (Q8).
    - **Housekeeping:** room status, attendant workload, inspection scores, lost and found register, damage cases, linen log.
    - **POS:** room charges by outlet and outlet day-close totals from **R4.21**. Item, tender, discount, void, promotion and waste reports are the POS vendor's — that is how this must-have is met.
    - **Distribution:** bookings, revenue and commission by channel.
  - **Locked:** each report is a read over an existing ledger or a night-audit snapshot — no new money calculation. Permission is the permission of the data underneath. Print (card-isolated print CSS) and CSV. `/reports` stops redirecting to the Dashboard (R1.14).
  - **Decided F3:** when Q10 arrives, add exactly the reports the client names, then the list is closed again. R4.23's open-folio register and BluePMS's other reports join only if named there. Excel or PDF only if Q10 shows they are needed.
  - **Scope out:** occupancy and demand **trends** (warehouse, §7.8); a report builder; the BluePMS catalogue; the Manager Report (**R4.32**).

- [ ] **R4.32 Manager Report and MIS settings**
  - **Depends:** **R4.14**, **R1.10** (`SNAPSHOT_REPORTS`), **R1.6** (sources), **R3.1**, **R3.6**. **A sample of the client's real report (Q8, Q9) comes first.**
  - **Pilot checklist:** *Manager settings*. **Page:** [Front Office](https://www.bluepms.com/modules/front-office/), Manager Reporting And MIS Settings. **Prototype:** none.
  - **Live:** nothing. R1.11, R1.12, R1.17 and R3.1 are general settings, a different meaning. This is probably the GM's daily sheet, and the parallel run compares against it.
  - **Locked:** a new slice under §16.6's rule, not a change to R4.14's list. A date-range report for one property, with **management totals from night-audit snapshots** and room statistics from snapshots and `availability_day` (§7.8: a closed-period report is OLTP, not warehouse). No live scan of folios or reservations, no fan-out across properties, no new money calculation. Print and CSV as R4.14 (Excel or PDF only if Q10 shows they are needed, per F3). Permission is that of the data underneath.
  - **Locked (settings):** each setting is a register key pms-core reads (AGENTS §4), or it is hidden. Occupancy rules only for states HospAI has: no-show, out-of-order and checkout day; day-use, complimentary and house-use are added only if Q9 shows the hotel counts them. Source mapping reads R1.6 codes. Report rows: an on/off list of built-in rows with labels, decimals and order. **Formula library: a fixed registry the manager selects from, not an expression language.**
  - **Open — nationality:** nationality sits in OrgDO and events carry no PII, so PropertyDO cannot count it from the profile. If Q9 needs nationality rows, the spec chooses a non-PII code on the stay, as R1.6 does for source. Do not decrypt per row.
  - **Tests:** one day's totals foot to `SNAPSHOT_REPORTS`; changing an occupancy rule changes that row and only that row; a two-day range sums its days; hotel A cannot run hotel B; a seeded day matches the client's sample layout.
  - **Scope out:** day-wise sale and expenditure (stores data; Inventory was left blank); trends (warehouse); a report builder.

- [ ] **R4.16 Copilot — read-only, permission-aware**
  - **Depends:** **R3.10** (`ai_ops.enabled`, `ai_ops.messages.limit`), **R4.14** and **R4.32** (answers on reports read them; moved after both on 2026-10-31). Comes before **R4.6**, which adds the write path on top of it.
  - **Pilot checklist §14:** ask operational questions; answers with source context; help with reports and summaries; suggested next actions; only shows what the staff member may see.
  - **Prototype:** `CopilotHome.tsx`. **Page:** [AI Copilot Home](https://www.bluepms.com/modules/ai-copilot-home/) has titles and report bullets only. It shows a home with suggested questions and shortcuts, and mentions report discovery and explaining exceptions: name these in the spec.
  - **Locked:** the copilot's tools are **existing read routes**, called **as the asking user** through `dispatchV1` — the same permission, property scope and `assertTenantActive` as the SPA. No tool without an existing route; no command execution. **Suggested next actions** render as links or buttons to the existing screen or command, and the **clerk** clicks them — the copilot never submits. Every answer cites its sources as links to the records it read (reservation, folio, report snapshot).
  - **Locked (PII):** guest data only through the decrypt paths the user may already call; guest-profile reads are audited per read, as in R5.11. Conversation content is not written to logs or events and is not retained past the session. The model provider is named in the DPA.
  - **Also locked:** metering is `ai_ops.messages.limit` (`soft`, §6.6). Build the tool mapping and permission check so **R4.6** and **R5.11** reuse them.
  - **Scope out:** any write (R4.6); guest-facing replies (R5.9); external agents (R5.11); warehouse trends; model choice and prompt content.
  - **Tests:** a `roster:read`-only user's question about a folio gets a refusal, not data; a user at hotel A gets nothing from hotel B; every answer carries at least one source link or says it has none.

- [ ] **R4.8 Migration importers — the switch path**
  - **Why now:** switching PMS is the largest objection in every deal, and for a multi-property operator the **consolidation demo is the sales conversation** — three legacy exports in, one estate view out. There is currently no slice, no contract and no tooling for it anywhere in this repo.
  - **Stage A (single property):** importers for reservations, guest profiles, rate plans and folio history. **First source: BluePMS** — the pilot is switching from it; get a sample export from the client before designing the mapping. Canadian incumbents follow in **R4.19**. Map onto existing commands — **no bulk write path that bypasses `COMMAND_CATALOG`** — and run in the `BULK` lane (§4.2) under the chunk cap so an import cannot stall a front desk.
  - **Cut-over data (2026-10-31):** stays in house on cut-over night carry their advances and open-folio holds; the importer maps them to **R4.25** payments and **R4.23** holds, through the folio contract.
  - **Stage B moved to R5.7** — group consolidation needs the projections, so it cannot finish in this track. R4.8 is done when Stage A is.
  - **Locked:** import is a product surface with progress, per-record rejection and a re-runnable report — **not** a services engagement and not a script an engineer runs. Idempotent per source record. Every imported money row lands through the folio contract, never inserted.
  - **Scope out:** competitor-specific screen-scraping; anything that writes a DO directly.

### Pilot go-live — not coding slices

Track P being `[x]` means the software is ready. **The pilot is live** when the hotel runs its front desk, housekeeping and night audit on HospAI with BluePMS switched off. These steps are client, advisor and ops work: an agent working the queue **does not pick them** and does not tick them. Steps 1–3 start **now**, in parallel with Tracks 1–3, because their answers shape slices before Track P begins.

- [ ] **Live BluePMS walkthrough and samples** — one session on the client's live system (Q8): Manager Report, night audit configuration, report list, a bill on hold if they use one. Collect one sample each of the Manager Report, final bill, advance receipt, proforma, registration card and B2B invoice with IRN, handled as guest PII. This is the first real check of everything read from BluePMS's marketing pages.
- [ ] **Client answers** — the open questions in the [checklist research](research/2026-10-27-pilot-client-checklist.md#open-questions-for-the-client): POS vendor (R4.21), night audit settings (R1.10), tenders (R4.18), Form C filing (R6.2), channel manager and OTAs (R4.3), GST registration and e-invoicing threshold (R5.5), Manager Report rows (R4.32), reports they run (R4.14), guest documents (R4.13, R4.15), open folio (R4.23), accounting export (R4.12), Tax & Compliance and Guest Experience, and the rest listed there. Record each answer in that file and in the slice it unblocks.
- [ ] **Apply the fork decisions** — the user decided [F1–F4](#fork-decisions) on 2026-10-31. Q17, Q18, Q10 and the advisor's Form C answer set how each lands. Record each outcome in its slice, and amend any lock it changes in the same change-set.
- [ ] **Indian tax advisor sign-off** — on the values entered in Settings → Tax (R3.6, decided 2026-11-18: the engine is configurable, so sign-off is on configuration, before the first rupee posts), then on real invoices before go-live: GST slab per night, place of supply, the restaurant rate under the specified-premises declaration, the financial-year invoice series, IRN for B2B, no separate POS tax invoice for room-charged checks, and the DPDP consent notice (R4.15). Added 2026-10-31: what a tax invoice must show, including buyer fields and HSN/SAC (R4.22); whether a meal plan joins the room for the slab, and composite supply on packages (R3.6, R4.13); GST and a receipt voucher on an advance (R4.25); who issues an IRN for a B2B check paid at the outlet (R4.21); how DPDP erasure treats a retained buyer snapshot (R4.22); the duty per foreign national on Form C (R6.2, F4).
- [ ] **BluePMS sample export** — reservations, guest profiles, rate plans and folio history, obtained before **R4.8** is designed. Handled as guest PII: stored only where the purge contract reaches.
- [ ] **POS vendor agreement** — the chosen vendor confirms the R4.21 *Vendor must support* list in writing and gives a sandbox. The connector passes end-to-end in that sandbox before the rehearsal.
- [ ] **Channel manager agreement and connection** — the chosen channel manager confirms the R4.3 *Channel manager must support* list in writing, gives a sandbox and completes its PMS certification of the connector; the hotel's OTAs are switched from BluePMS to HospAI inside the channel manager, with room and rate mappings loaded. No booking lands on the unmapped queue during the rehearsal.
- [ ] **Pilot tenant provisioned** — by ops on Growth with `pos.enabled` and `ai_ops.enabled` (Track P *Provisioning*); rooms, room types, rate plans, packages, charge codes, outlet mappings, staff users and roles configured; e-invoicing and POS credentials loaded as `SECRET`.
- [ ] **Staging rehearsal** — the hotel's configuration plus a full BluePMS import on staging. Run a booking-to-checkout day per room type, an advance with its receipt, an in-house extension, a checkout on an open-folio hold with a later charge, a B2B checkout with IRN, a room-charged POS check, a Form C record, a channel booking and a night audit; the R4.8 import report has no unexplained rejections.
- [ ] **Parallel run** — at least three consecutive nights with both systems live. Each night, compare the night audit (room revenue, tax by component, payments, in-house count) and the **Manager Report** with BluePMS. Any difference is explained and fixed before cut-over; the comparison is kept as the sign-off record.
- [ ] **Hardware and printing** — registration card, invoice and receipt printers at each desk; print CSS checked on the hotel's own printers; the browser and devices the staff will use.
- [ ] **Staff training** — front desk, housekeeping supervisor, night auditor, accounts (Tally / Zoho export) and managers (reports, copilot), each on their own role's navigation (R2.6).
- [ ] **Cut-over** — a dated cut-over night: final delta import of bookings made since the rehearsal, BluePMS made read-only, the first night audit on HospAI with the team on call, and a named support contact for the first week.

---

## Track 4 — Canada launch (Ontario and British Columbia)

Everything an independent in Ontario or British Columbia needs to switch and run on their own: the Canadian jurisdictions and export targets, money that moves, guest messaging, direct booking, the housekeeping app and a way to sign up and pay. Channels, accounting export and importers already ship from Track P.

Start only when Track P is `[x]`. Track P's module rules still apply. Order follows `ARCHITECTURE.md` §16.6 rule 3.

- [ ] **R4.19 Canada readiness — jurisdictions, export targets, importers**
  - **Depends:** **R3.6**, **R4.12**, **R4.8** (all done in Track P for India).
  - **Locked:** Ontario and British Columbia as jurisdiction configuration on the R3.6 engine — the municipal layer and **levy ordering** (§7.9 requirements 1 and 8) tested against real Ontario MAT-inside-HST and BC GST + PST + MRDT invoices. **QuickBooks Online and Xero** targets for R4.12. Importers for the Canadian incumbents on the R4.8 Stage A contract.
  - **Scope out:** Quebec (Blocked); any engine change — if a province needs one, the R3.6 engine was wrong; fix it there.

- [ ] **R4.7 Live payment acquiring — one gateway**
  - **Why it moved:** the commercial model prices Starter at or near zero because the **rails earn** — payments is the majority of small-property revenue and `payments.enabled` is `required` on Starter (§6.7). **R1.12** previously locked *sandbox only, no live gateway before Phase 3* and **R5.4** is where "gateways become real". That puts the revenue engine two phases behind the customers it is meant to fund. One acquirer comes forward; the rest of finance stays in R5.4.
  - **Depends on:** the §7.3 payments↔folio **event contract** (already specified and shipped on the folio side: multi-currency, authorize / void / capture).
  - **Locked:** a **PCI-isolated `payments` Worker** (§13). It **cannot** write folio rows and the folio **cannot** call the gateway — the seam stays the event bus, idempotent by `(event_id, gateway_reference)`, and money moves on the gateway's word. Tokenised / hosted fields or terminal only: **no PAN, CVV or magstripe ever enters this repo** (standing Blocked rule). Gateway credentials are `SECRET` class and unreadable by `pms-core` (§5.1) — `pms-core` sees `gateway`, `terminal_id` and nothing else.
  - **Scope out:** POS, Stripe *billing* for our own plans (**R5.6**), card-brand matrix and channel routings (**R5.4** / **R4.3**), a second gateway. One acquirer, one country, real money.

- [ ] **R5.2 Whistle (guest engagement group)**
  - **Prototype:** `WhistleHub.tsx` + `whistle/*` (inbox, automations, contacts, tasks, upsell, analytics, profile).
  - **Locked:** module **group**, entitlement per sub-module. Events by `guest_ref` only. **This slice owns transactional email** (confirm / cancel / no-show templates + real send) plus inbox, automations, scheduled campaigns and concierge **tasks** (reusing the R4.11 room-request task type). `guest_ref` on events; plaintext only on the mailer path from OrgDO. Guest with no email: skip + audit, do not fail the reservation command. **R5.9 layers the AI autoresponder on these surfaces** — build them so a second caller can drive them. Channel order by market (§16.6): **email and SMS first** for the Canada launch, **WhatsApp** with India (**R6.1**).

- [ ] **R4.2 Booking engine (direct book + preview)**
  - **Prototype:** `BookingEnginePreview.tsx`, `BookingEngineSettings.tsx`, `OnboardingDashboard.tsx` (first-hotel wizard — may ship as ops, not the public engine).
  - **Locked:** public site Worker + Static Assets; consume existing **ARI_KV** + reject-on-commit; photos from R2 (unlocks deferred type photos). Entitlement is `booking_engine.enabled` per §6.7 (Starter and up) with `booking_engine.custom_domain` above it — from **R3.10**. Do not re-derive the ARI spec.
  - **Email (resolved 2026-09-12):** **R5.2** now precedes this slice in Track 4, so the booking engine ships with confirm / cancel / no-show email. **Do not tick R4.2 before R5.2 is `[x]`** — a public booking path with no confirmation is a broken transaction, not a missing feature.

- [ ] **R4.10 Mobile app — housekeeping and communication**
  - **Decided (2026-09-12):** housekeeping and communication ship as a **separate mobile app**. The operator SPA stays desktop-only and §Viewport is now a permanent lock rather than a deferred question — see [`ARCHITECTURE.md` §9.1](../ARCHITECTURE.md#91-the-second-client--housekeeping-and-communication). **Do not add width breakpoints to `web-pms`.**
  - **Fork — scope this before building:** does *communication* mean staff↔staff (assignment, handover, maintenance) or staff↔guest (the **R5.2** Whistle inbox)? Staff-only keeps guest PII off a pooled handset entirely; guest-facing changes the security surface of every line below. **Recommend staff-first, guest inbox as a second release.**
  - **Locked:** consumes `@hospai/contracts` + `@hospai/client-core` — no forked types, no import from `web-pms` in either direction. The offline queue reuses the **existing command idempotency keys**, not a second replay path. Push payloads carry an identifier, **never guest PII**. Sessions are short, device-bound and independently revocable; do **not** extend token TTL to save a login prompt (§6.3 — the entitlement version rides that token). Device tokens purge with the user (§4.8).
  - **Also locked — no money on this client.** Folio, cashiering, night audit, rates and reservation editing stay on the desktop SPA. Last-write-wins is fine for a room status and unacceptable for anything financial, and an offline queue on a pooled device is the wrong place to discover that.
  - **Shape — recommendation:** **PWA first.** It removes the deploy-skew problem in §9.1 point 1 outright (the client updates with the Worker), needs no store review cycle, and housekeeping is a captive audience on known devices where store distribution buys almost nothing. Go native only if one of these forces it: push reliability web push cannot meet, camera-heavy maintenance capture, or offline depth beyond a status queue.
  - **Scope out:** the manager-glance view — **R5.11** (MCP) may answer it for free, so decide that before building it.

- [ ] **R5.6 Self-serve plans + usage billing**
  - **Moved into the Canada launch:** Starter charges a subscription and requires payments enrolment at provisioning, so plans and billing must exist before independents sign up. Stripe billing for plan changes; metered add-on usage. Do not start from Finance sandbox copy (R1.12).

---

## Track 5 — Upscale properties and groups

What a 100–200 room full-service hotel and a 3–10 property group buy on top of the launch product: the acting AI layer, revenue management, further interface adapters on R4.9 (door lock first, then spa — each its own slice), more payment gateways, group blocks and banquets, multi-property views, and external agent access. Packages, housekeeping depth and the interface framework moved to Track P with the pilot.

Start only when Track 4 is `[x]`. Track P's module rules still apply.

- [ ] **R4.6 AI operations layer — in-product agent, command-path foundation**
  - **Depends on:** **R3.10** (`ai_ops.*` keys), **R4.5** (queues/consumers), **R4.16** (the read-only copilot's tool mapping and permission model — reuse them, do not rebuild). This is the natural next proof of the module mechanism after the launch modules in Track 4.
  - **Locked:** an AI actor is a **first-class caller of `COMMAND_CATALOG`**, never a side door into PropertyDO. Same entitlement resolution, same audit-log write on every money/inventory mutation, same lane rules (§4.2). Add an **`agent` actor kind** to the audit trail so an AI-originated mutation is attributable and reversible; do not borrow a staff `userId`.
  - **Also locked:** AI writes never run in `INTERACTIVE`. Batch work — rate suggestions, review drafts, campaign sends — goes to `BULK` under the existing chunk cap, so an agent cannot starve the front desk. Metering is `ai_ops.messages.limit` (`soft`, §6.6).
  - **Scope out:** guest-facing inbox, automations and upsell (**R5.9**); rate setting (**R5.1**); **external** agent access (**R5.11**); model choice and prompt content. **This slice is the mechanism, not the product.**
  - **Note:** this is the *inboard* surface — our model, our prompts, full trust (§10.2 row 1). It is also the foundation **R5.11** stands on: get the command path and the `agent` actor right here and the external surface becomes a scoping problem rather than a second implementation.

- [ ] **R5.9 AI operations layer — in-product guest-facing surfaces**
  - **Depends on:** **R4.6** (command path), **R5.2** (Whistle inbox, automations, upsell).
  - **Locked:** builds **on** R5.2's surfaces and does not fork them — autoresponder over the Whistle inbox across WhatsApp / email / OTA in the guest's language, inbound mail parsed into reservation commands, review replies, upsell timing. Every write goes through the R4.6 command path with the `agent` actor. `guest_ref` on events; plaintext PII only on the mailer path from OrgDO.
  - **Scope out:** rate setting — that is **R5.1**, which follows this slice in Track 5. R5.9 does not set or suggest rates until R5.1 ships, and never reimplements it.

- [ ] **R5.1 Yield Analytics / dynamic / forecasting tabs**
  - **Prototype:** `ReportsAnalytics.tsx`, Rates `dynamic` / `forecasting`.
  - **Locked:** revenue-management module, keyed `revenue_mgmt.enabled` as an **add-on on every tier** (§6.7) — not a top-tier feature. Occupancy forecast OLTP may feed it; **no** competitor scraper theater. The prototype tab that `alert()`s “+20% surge applied” is the spec of *what clerks expect to configure* — implement rules + ledger writes, not that stub. Comp-set rates come from manual entry or a licensed rate-data feed, never scraping (§16.6).

- [ ] **R5.4 Remaining finance gateways**
  - PCI isolation (`ARCHITECTURE.md` §13) and the **first** acquirer are **R4.7**. What remains here: additional gateways and terminals, card-brand matrix, AVS.
  - **POS-lite withdrawn (2026-10-27):** the pilot integrates a third-party POS (**R4.21**); a built-in POS, if ever, is the parked **R4.17**. Do not build POS here.

- [ ] **R4.1 Group blocks / allotments**
  - **Prototype:** Settings split inventory + group as reservation flag.
  - **Locked:** own aggregate, not a reservation flag (§7.4). New module + entitlement.

- [ ] **R5.12 Banquet & Events — lean**
  - **Depends:** **R4.1** (group blocks), **R4.13** (packages), city-ledger AR.
  - **Prototype:** `BanquetHub.tsx` (BluePMS parity Phase 6).
  - **Scope (§16.6 *Add-on*, `banquet.enabled`):** function spaces and capacity; event → functions (date, time, space, covers); menus and resources per function; deposits; the banquet event order (BEO) as a printable view; a function diary of spaces against time; billing to a room folio or an AR company account; copy and move utilities.
  - **Locked:** event charges post through the existing folio and city-ledger contracts — **no separate event money path**.
  - **Scope out:** sales leads and follow-up traces (external CRM, §16.6); banquet staff payouts; event-specific reporting beyond revenue by space.

- [ ] **R4.4 Multi-property switcher (ops, not projections)**
  - Prototype header property dropdown. Until §7.6 projections: switch `propertyId` in the SPA from `/me` property list. Isolation is structural (one DO per property) — do not query across properties.

- [ ] **R5.7 Multi-property projections (§7.6)**
  - Distinct from the **R4.4** switcher. Projections are the read model for org-wide views. Do not scan every PropertyDO from the SPA.
  - **Sequencing (resolved 2026-09-12):** Track 5 is the upscale-and-groups stage, so projections land with the segment that buys them, ahead of everything in Track 6. **R4.4**, earlier in this track, is the interim property switch.
  - **Includes former R4.8 Stage B:** cross-property guest **deduplication** into OrgDO and a **parallel-run** mode that shadows the incumbent before cutover — the consolidation demo groups are sold on.

- [ ] **R5.13 `held` behaviour — staff blocks and central-reservation holds**
  - **Depends:** **R5.7** (group availability projection and two-phase central reservations).
  - **Why here:** `ARCHITECTURE.md` §7.6 names TTL holds as the fix for central reservations — a phone agent reserves stock at the owning PropertyDO while collecting details, instead of meeting a reject after four minutes. Groups buy central reservations, so holds land in the groups stage, not with India. Previously bundled into R5.5.
  - **Locked:** use the existing `held` ledger column (§7.1) — no second inventory counter. Holds expire on a TTL and release on abandonment, and a held room counts once against availability. Staff room blocks use `held`, never $0 reservations.
  - **Scope out:** channel-level holds; changing live **Hold** (`PENDING`, `sold++`), which stays as it is.

- [ ] **R5.3 Marketplace + public API**
  - **Prototype:** Settings `marketplace`.
  - **Locked:** OAuth, webhooks, versioned HTTP. Idempotency already command-scoped (R0.8).

- [ ] **R5.11 MCP server — external agent access**
  - **Depends on:** **R3.10** (`mcp.*` keys), **R4.6** (command path + `agent` actor), **R5.3** (OAuth2 apps, granular scopes, versioned HTTP). Do not build a second OAuth.
  - **Locked:** implement [`ARCHITECTURE.md` §10.2](../ARCHITECTURE.md#102-agent-surfaces--two-trust-boundaries-never-one). Tools map **1:1 to `COMMAND_CATALOG` entries** — no tool without a command, so the three gates of §1 and the audit write come for free. Effective permission is the **intersection** of the delegating user's role and the granted scopes; a grant is never as wide as the user. Audit rows carry the **OAuth client id** as well as the delegating user.
  - **Also locked:** external writes default **closed** and live in the config register, not the entitlement plane (§1 fourth plane). `mcp.clients.limit` is **`hard`** at the OrgEntitlementDO counter. Revocation is **kill-switch class** (§6.4) — it must not ride the version-keyed snapshot and must not wait out the session token TTL.
  - **Also locked:** guest-supplied text is **data, never instruction**. No command may be derived from guest content without explicit human confirmation, and that requirement sits on the command, not in a prompt. Guest-profile reads are a separate scope, audited per read, excluded from any default grant, and named in the DPA — §4.8 erasure cannot recall what an agent already retrieved.
  - **Scope out:** the in-product agent (**R4.6** / **R5.9**); public demand-side booking (**R5.10**); shipping our own MCP *client*.

---

## Track 6 — Later bets

The channel and the bets nothing else depends on. India's compliance moved to Track P with the pilot.

Start only when Track 5 is `[x]`.

- [ ] **R6.1 WhatsApp channel (India)**
  - **Depends:** **R5.2** (Whistle inbox, templates, delivery status).
  - **Locked:** a channel on the existing Whistle inbox and templates — **not** a second inbox. Template approval, opt-in and delivery status follow the provider's rules; `guest_ref` on events, plaintext only on the send path from OrgDO. Staff notifications it triggers follow the no-PII push rule in `ARCHITECTURE.md` §9.1.
  - **Scope out:** WhatsApp for the Canada launch (email and SMS cover it); broadcast marketing beyond R5.2's campaigns.

- [ ] **R5.10 Agentic distribution**
  - **Depends on:** **R3.8** (ARI KV), **R4.2** (reject-on-commit path), **R5.3** (public API + OAuth).
  - **Trust boundary:** the caller is **a stranger's** assistant, not the operator's (§10.2 row 3). No tenant principal, no PII read, no command surface — this is *not* the MCP server (**R5.11**) and must not reuse its scopes.
  - **Locked:** machine-readable rates, availability, restrictions and cancellation terms, plus a transactional booking endpoint for AI intermediaries. Consume **ARI_KV** and commit against the owning PropertyDO through the existing reject path — **do not add a second availability read model** and do not re-derive the ARI spec. Rate and parity rules stay operator-owned config in the register. Key is `agentic_distribution.enabled`, on **every tier and never sold separately** (§6.7).
  - **Scope out:** agent-specific pricing; anything that bypasses `quoteAriVersion`; a bespoke inventory projection.

- [ ] **R5.8 Partner sandbox**
  - Workers for Platforms or dynamic Worker loader. After **R5.3**.

- [ ] **R4.17 Built-in restaurant POS — parked fallback, not scheduled**
  - **Status (2026-10-27):** parked. The pilot integrates a third-party POS through **R4.21**. Start this only if no vendor meets the R4.21 requirements, or the client later wants one system — and only after amending the §16.6 POS row to *Add-on* (Blocked rule).
  - **Scope if started:** the twelve POS features the pilot ticked, as a `modules/pms/pos` add-on on `pos.enabled`, posting charge-to-room through the **same R4.21 command path** so the folio side is built once. Money in integer minor units with `allocate`; outlet-settled revenue reaches night audit and R4.12 through events and snapshots; tenders per **R4.18**; housekeeping `moduleTxnCtx` pattern, no PropertyDO extraction. Outlet demand forecast must not scan reservations (AGENTS §2). Email receipts need a transactional send path — **R5.2**'s if it has shipped, otherwise built first and adopted by R5.2, never two mailers.
  - **Scope out:** recipe costing, stock depletion, stores and purchase (§16.6 *Integrate*); labour scheduling and pay.

---

## Prototype → live map (status)

| Prototype section | Prototype file | Live today | Track |
|---|---|---|---|
| Dashboard Hub | `Dashboard.tsx` | `/dashboard` Hub, first nav item | R1.1 **done** |
| Room Plan Timeline | `TapeChart.tsx` | `/board` | R0.6, R1.3, R2; depth **R4.28** |
| Front Desk Board | `FrontDesk.tsx` | `/arrivals` etc. + BoardSummary | R0.6, R1.3, R1.19, R1.20, R2.2 |
| Cash drawer / shift | Front Desk cash | `/shift` + AppShell strip | R0.14, R1.16 honesty |
| Reservations **list** | `Reservations.tsx` list | `/reservations` | shipped |
| Reservations **stay card** | `Reservations.tsx` selected stay | missing SPA | **R1.15** (HTTP exists) |
| New Booking | `BookingWizard.tsx` | `/book` (adults, hold, promo, search) | R1.4 remainder, R1.20; room number **R4.26** |
| Housekeeping Desk | `Housekeeping.tsx` | board + assign + workload | R1.9 (priority, inventory, **maintenance module**, roster skills) |
| Rates & Yield | `RatesAvailability.tsx` | `/rates/*` | R1.7, R5.1 |
| Guest CRM | `GuestsCRM.tsx` | `/guests` | R1.8 (DEMO-READY P1); documents + consent **R4.15** |
| Folio Ledger | `FoliosBilling.tsx` | `/folios` directory → `/folio/:id` | R1.2 **done** |
| Folio extras (promo, damage, no-post, invoice) | stay + billing | money-ops + FolioScreen | shipped; wire on R1.15 if missing |
| Folio routing rules | Front Desk / Settings | Settings charges | shipped — do not rebuild |
| Night Audit | `NightAudit.tsx` | `/night-audit` (keep in nav) | R1.10, R0.7 |
| Open folio / bill on hold | — (BluePMS page) | missing | **R4.23** |
| Draft bill, settlement cancel | `FoliosBilling.tsx` | missing | **R4.29** |
| In-house stay changes | — (BluePMS page) | early depart and same-type move only | **R4.24** |
| Advance collection + receipt | — (BluePMS page) | payments exist, no flow or receipt | **R4.25** |
| Buyer GST details, HSN/SAC | — (BluePMS page) | missing | **R4.22**, **R5.5** |
| Manager Report + MIS settings | — (BluePMS page) | missing | **R4.32** |
| HK tasks, status history, supervisor dashboard | `Housekeeping.tsx` | assign + status only | **R4.30**, **R4.31** |
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
| In-house room move | Front Desk move modal | In-house board Move room | **R1.19** shipped |
| Products | `ProductsSettings.tsx` | charge codes | R1.5 **module** |
| Booking engine | `BookingEngine*.tsx` | missing | R4.2 (ARI_KV already ships) |
| Distribution / channels | `ChannelManager.tsx` | missing | R4.3 connector to a third-party channel manager (needs R4.5) |
| Yield Analytics | `ReportsAnalytics.tsx` | missing | R5.1 |
| Whistle | `WhistleHub.tsx` | missing | R5.2 |
| Onboarding | `OnboardingDashboard.tsx` | demo seed only | R4.2 ops |
| Marketplace | Settings tab | missing | R5.3 |
| Property switcher | header dropdown | missing | R4.4 |
| Multi-property projections | — | missing | R5.7 |
| Room Ops live view | `RoomOpsLiveView.tsx` | missing (`/board` is the tape) | **R4.27** — a status view, not a second grid (§16.6) |
| Package master | `PackageMaster.tsx` | missing | R3.2, R3.3 → **R4.13** (Track P) |
| Report catalogs + runner | `*ReportCatalog.tsx`, `NativeReportRunner.tsx` | snapshot reports | **R4.14** named set; catalog entries are **not** a backlog |
| AR (debtors, statements, aging) | `FoliosBilling.tsx` AR views | `/city-ledger` | R0.3 honesty, audit L1 |
| CRM sales pipeline | `GuestsCRM.tsx` sales views | — | §16.6 **Integrate** — do not build |
| POS | `PosHub.tsx` | missing | **R4.21** connector on R4.9 (Track P); built-in **R4.17** parked |
| F&B costing | `FnbHub.tsx` | — | §16.6 **Integrate** — do not build |
| Banquet & Events | `BanquetHub.tsx` | missing | R4.1, **R5.12** |
| Inventory (stores) | `InventoryHub.tsx` | — | §16.6 **Integrate** — HK list only (R1.9) |
| Purchase | `PurchaseHub.tsx` | — | §16.6 **Integrate** — export via R4.12 |
| Spa | `SpaHub.tsx` | — | §16.6 **Integrate** via R4.9 |
| Transport | `TransportHub.tsx` | — | §16.6 **Avoid** — service item + folio charge |
| Hostel | `HostelHub.tsx` | — | §16.6 **Avoid** |
| Payroll & HR | `PayrollHub.tsx` | — | §16.6 **Integrate** — export via R4.12 |
| AI Copilot | `CopilotHome.tsx` | missing | **R4.16** read-only (Track P); then R4.6, R5.9, R5.11 |
| Add-ons panel | Settings → Add-ons | — | entitlement plane (§6), never a local toggle |

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

**Whole PMS (Phase 1 operator)** is done when Tracks 0–2 are all `[x]` and **R3.1** is `[x]`. **Phase 1 architecture** additionally wants **R3.6–R3.9** (tax country decided: India first, then Canada — Ontario and British Columbia). **India pilot** is done when Track P is `[x]` and the client has cut over from BluePMS. **Canada launch** adds Track 4. **Upscale properties and groups** adds Track 5; **later bets** adds Track 6.

---

## Blocked / do not invent

If you hit one of these, **stop and tell the human** — do not pick a silent alternative:

- Need a new entitlement feature key not in `FEATURE_KEYS` **and not listed in `ARCHITECTURE.md` §6.7**. Keys in that table are authorised; **R3.10** lands them. Anything outside it: stop and ask.
- Need to grow `NIGHT_AUDIT_STEPS` (forbidden without an architecture amendment).
- Need to scan reservations for availability.
- Need to extract folio from PropertyDO.
- Disagreement between prototype UX and a **KEEP** architecture lock (e.g. pending vs inquiry). Record in ARCHITECTURE §16.3 rule 4; do not silently match the prototype.
- Need to support a Canadian province beyond Ontario and British Columbia — **Quebec in particular** (French-language obligations; certified sales-recording for restaurant and bar sales). Other provinces are configuration, but still a scope decision.
- Need to build a prototype hub that **ARCHITECTURE §16.6** classifies *Integrate* or *Avoid* — Payroll & HR, Purchase, stores Inventory, F&B costing, Spa, Transport dispatch, residential Hostel, sales-pipeline CRM. That is a scope change: amend §16.6 first.
- Need to start **R4.17** (built-in POS) — amend the §16.6 POS row to *Add-on* first.
- Need to connect an OTA directly or build channel-manager features of our own — R4.3 is a connector to a third-party channel manager; amend the §16.6 Channel Distribution row first.
- Need to store PAN, CVV, or magstripe in this repo.
- Need to clone `TicketsSettings.tsx` layout or add role impersonation.
- Need to lift a lock named in the [fork decisions](#fork-decisions) (F1–F4) before its named answer has arrived, or beyond what the decision allows.
- Need to build Guest Experience features (reviews, social, website builder, guest pages): not asked of the client, undecided in §16.6.
- Need to widen `tender_type` beyond `CARD` \| `CASH`, add Phase 1 email, extra stay `guest_ref`s, warehouse trends on the desk, or a second occupancy scan.

---

## Catalog pins (refresh each session)

After **R4.5** (2026-11-19):

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` | length **111** |
| `V1_HTTP_ROUTE_AUDIT` | **179** routes, last `post_event_consumer_exception_dismiss` |
| `PROPERTY_SCHEMA_HEAD` | **44** |
| `ORG_SCHEMA_HEAD` | **11** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

After a slice that adds a command/route/migration, **edit this table** in the same PR so the next agent does not use stale heads.

---

## Suggested first coding session

If the human says “work the roadmap”:

1. **R0.1** (provision graft) — audit Vertical 1. Highest severity. Characterization test first.
2. Then **R0.2** → **R0.3** → **R0.6** so staging and the desk are honest.
3. Then **R1.1** Dashboard Hub — first missing prototype **screen**.
4. Continue first `- [ ]` in this file.

Do not start Track P or Tracks 4–6 because they are more fun. The prototype “looks complete” only after Track 1 screens exist (including **R1.15** stay card) and Track 0 does not lie.
