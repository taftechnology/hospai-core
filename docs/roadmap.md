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

**Revision:** 2026-10-27 India pilot pass — the pilot client's returned BluePMS checklist ([research](research/2026-10-27-pilot-client-checklist.md)) becomes the scope of a new **Track P** ahead of the Canada launch. **R3.6** decides India first (Canada follows as **R4.19**). Moves **R4.5**, **R4.3**, **R4.12**, **R4.8** out of Track 4, **R4.13** and **R4.11** out of Track 5 and **R5.5** out of Track 6 into Track P; adds **R4.14** (named report set), **R4.15** (guest ID documents + consent), **R4.16** (read-only copilot), **R4.18** (India tenders fork), **R4.19** (Canada readiness), **R6.2** (Form C), **R4.21** (POS connector) with **R4.9** pulled forward from Track 5, and **R4.17** (built-in POS, parked in Track 6). 2026-10-28: **R4.3** becomes a connector to a third-party channel manager (§16.6 *Integrate*) — no channel manager of our own, no direct OTA integration. After the client confirmed every tick is a must-have: **R4.20** (day-wise rate override); guest preferences join R4.15, guest requests join R4.11. **R5.4** loses its POS-lite scope; **R4.11** no longer waits on R4.10. Prior: 2026-09-12 packaging + AI layer pass — adds **R3.10** (entitlement catalog per the revised `ARCHITECTURE.md` §6.7), **R4.6** / **R5.9** (in-product AI), **R5.11** (external MCP surface, `ARCHITECTURE.md` §10.2) and **R5.10** (public agentic distribution), and flags the **R5.7** sequencing question. The three agent surfaces are deliberately separate — see §10.2. Adds **R4.7** (live acquiring pulled forward from R5.4), **R4.8** (migration importers — previously absent), **R4.9** (on-property interface framework) and **R4.10** (mobile app for housekeeping and communication — decided; §9.1 added); records Canada / India / Australia in §7.9 and decides **R3.6**: Canada, starting with Ontario and British Columbia; flags the **R4.2** confirmation-email fork as blocking. Adds **§16.6** (production scope for the BluePMS parity hubs) with **R4.11** (housekeeping depth), **R4.12** (accounting export), **R4.13** (front office depth), **R5.12** (lean banquet) and a POS-lite scope on **R5.4**; the prototype-as-spec rule now covers only surfaces §16.5 / §16.6 place in scope. Sequencing pass: **R4.5** opens Track 4 (R4.3 depends on it); **R1.4** follows **R1.5** and **R1.6**; **R4.8** Stage B moved into **R5.7**; **R5.8** back in numeric order; **R3.6** and **R3.10** added to the Track 4 gate; **R1.5** tax group locked to a §7.9 product class; card-capture references point at **R4.7**. Stage resequencing: Track 4 is the **Canada launch** (R4.5, R4.7, R5.2, R4.2, R4.3, R4.12, R4.10, R4.8, R5.6), Track 5 **upscale properties and groups**, new Track 6 **India and later bets** with **R6.1** (WhatsApp); resolves the **R4.2** email fork and the **R5.7** sequencing flag. Moves `held` behaviour out of R5.5 into new **R5.13** after R5.7, since group central reservations need TTL holds before India. Prior: 2026-09-04 code + spec + architecture pass. Queue hygiene: R0.x id lists match the audit vertical membership (not a summary); **R1.13** is a tombstone, not a hole. Do not re-derive a surface that already has an accepted spec in `docs/superpowers/specs/`. Phase 1 must not contradict ARCHITECTURE.md §14–§16.6 or a named leftover in a shipped spec.

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
| Additional named guests as extra `guest_ref`s | Holes sweep: party = `adults`/`children` only. No second profiles. |
| Inventory `held` / wizard “hold a room without selling” | `held` unused until **R5.13** (Track 5, §7.1). Live **Hold** = `PENDING` (`sold++`), via `reservations.hold` / create-as-pending. |
| CHECK / VOUCHER / GIFT tenders | Cashiering spec settled `CARD` \| `CASH` only. Do not widen the CHECK. |
| Transactional email in Phase 1 | Guest engagement is **R5.2** in Track 4 (Canada launch), not Track 1. |
| Valet / coffee tickets inside HK | §16.1 **maintenance module** = work orders. Concierge tickets = Whistle **tasks** (R5.2). OOO emits `room.ooo_changed`; tickets subscribe (HK leftover 5). |
| HK reports tab | Not a catalogue tab. The pilot's housekeeping reports are the named **R4.14** set. Workload counts already on the HK board. |
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
| Folio transfer to **another reservation** | Rejected (`transfer_cross_reservation`). Charges move between **windows on the same stay** (GUEST/COMPANY) |
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
  - **Shipped (2026-10-28, [spec](superpowers/specs/2026-10-28-booking-remainder-design.md)):** FAIL_CLOSED disables, occupancy copy and R1.6 source/segment were already live. Added **Special requests** — `reservations.create` takes an optional `frontOfficeComment` written to the existing column (fingerprinted; > 2,000 → `front_office_comment_too_long`; non-string → 400). Added **Add-ons** from R1.5 products — after Hold or Confirm each line posts once through `folio.add_item` (`unitMinor × quantity`, stable op ids, Retry re-posts only failed lines, the booking stands); Quote is disabled while add-on lines exist. **Booking settings stay hidden**: `same_day_*` belong to online booking (R4.2 — the desk always takes walk-ins), `require_prepayment` to R1.20, `booking_date_change` to future modify rules; the **Policies** tab stays hidden until R1.20 or R4.2 wires one of them. No new commands, routes or migrations.

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

- [ ] **R1.11 Settings: Users / System / Logs**
  - **Depends:** R0.2.
  - **Prototype:** Settings `users`, `system` (preferences, notifications, tags), `logs`.
  - **Live:** Staff + Roster screens; limited property settings.
  - **Locked:** **Users** = Staff screen linked from Settings. **System preferences** = classified keys pms-core reads. **Notifications** = hide until **R5.2**. **Tags** = R1.8. **Logs** = existing `get_audit_log` read UI (folio:read). Do **not** add `audit.append` HTTP ([audit log spec](superpowers/specs/2026-08-07-audit-log-design.md)).

- [ ] **R1.12 Settings: Finance remainder**
  - **Depends:** R0.3.
  - **Prototype:** `FinanceSettings.tsx` / `FinanceModals.tsx` (gateways, terminals, AVS, invoice numbering).
  - **Live:** tax rules + charge codes; invoice engine exists.
  - **Locked:** Invoice numbering/templates **configuration** on the existing engine (if not already in Settings). **India (§7.9):** one consecutive series per **financial year (April–March)**, unique per GSTIN, within the length limit — the series resets on the financial year, not the calendar year. **R5.5** depends on this. Gateway/terminal/AVS: **sandbox-only** copy + existing simulate path; no live gateway in Phase 1 — the first real acquirer is **R4.7**. **Card-brand matrix** and **channel routings** = hide until R5.4 / R4.3. City ledger is `/city-ledger`, link from Finance. Folio **routing rules** already live under Settings charges — link, do not rebuild. Do not store secrets in the config register.

- **R1.13** — unused number, not a lost slice. Stay workspace is **R1.15**. Do not invent work under this id.

- [ ] **R1.14 Reports — OLTP only (optional nav)**
  - **Depends:** R1.1.
  - **Prototype:** `ReportsAnalytics.tsx` is **Yield**. That is Track 5.
  - **Locked:** Do **not** add Yield Analytics in Phase 1. Dashboard Hub (R1.1) is the report. If a `/reports` route is needed for IA, make it a redirect to Dashboard until **R4.14** (Track P) gives it the named operational report set.

### R1 — Stay workspace, cashiering, Settings leftovers

- [ ] **R1.15 Reservation stay workspace**
  - **Depends:** R0.6. Add-ons need R1.5 products if you post incidentals here.
  - **Prototype:** `Reservations.tsx` (not just the list — the selected-stay card: modify dates/type, confirm pending, inquiry filter, cancel + policy penalty, no-show, cancel check-in, confirmation code, add-ons, damage-deposit checkbox).
  - **Live:** `ReservationsDirectoryScreen.tsx` is a **list**. Folio and Check-in are separate routes. Commands for hold/confirm/cancel/no-show already exist — **wire the stay card**, do not invent new status verbs.
  - **Locked:** Add `/reservations/:id` (or split pane). **Wire existing commands** — do not invent verbs. Modify = `reservations.modify` (client-core method likely missing — add it). Cancel/no-show = existing DO paths + snapshotted penalty ([lifecycle spec](superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md)). Cancel check-in = `reservations.cancel_check_in`. Confirm pending = existing `confirmReservation`. Damage = FolioScreen `folio.authorize` `purpose=DAMAGE`; void = release; post `DAMAGE` + capture = forfeit ([money-ops](superpowers/specs/2026-08-12-folio-money-operations-design.md)). Front-office editor already on Check-in/Folio — reuse. Inquiry/pending/confirmed filters on the directory already exist as status query.
  - **Out:** extra named guests; dirty-room force check-in; recurring engine; second folio UI; PAN; new deposit commands.
  - **Tests:** cancel outside window posts one penalty line; modify dates moves availability; cancel-check-in returns confirmed without deleting folio history; DAMAGE void leaves stay capture-due untouched.

- [ ] **R1.16 Cashiering / shift as a first-class desk surface**
  - **Depends:** R0.14 for L9–L10 cash FX and business-date on close. If R0.14 is still open, do not start this slice.
  - **Prototype:** cash drawer on Front Desk.
  - **Live:** `ShiftScreen.tsx`, **ShiftStrip in AppShell** (all desk routes). Spec: [cashier-shift SPA](superpowers/specs/2026-08-09-cashier-shift-spa-design.md), [cashiering](superpowers/specs/2026-08-07-cashiering-design.md) (`tender_type` = `CARD` \| `CASH` only).
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
  - **Depends:** R1.4.
  - **Later, not a dependency:** real card capture is **R4.7** (first acquirer); terminals and further gateways are **R5.4**. This slice uses the simulate path only.
  - **Prototype:** Booking wizard step “Billing & Guarantee”; Front Desk pre-auth modal with card number/CVV.
  - **Locked:** Do **not** add `guaranteeMethod` if the folio payment already records the guarantee. Consume `pms.booking.require_prepayment` inside confirm/check-in (hide the toggle until then — R0.11). Card path = existing **simulate** authorize ([payments simulate](superpowers/specs/2026-08-06-payments-ledger-simulate-design.md), [card last4](superpowers/specs/2026-08-14-card-last4-brand-design.md)). Check-in shows last4/brand if present — never PAN/CVV. Cash / pay-at-hotel = no authorize required unless the config is on.
  - **Out:** PAN/expiry/CVV; `held` inventory; a second payments Worker.
  - **Tests:** require_prepayment blocks check-in with zero captured/authorized STAY money; simulate authorize unblocks; no card-number input in web-pms.

---

## Track 2 — Look like the prototype (interaction + kit, not Tailwind)

Do after R0.11 at minimum (audit UI). Can run in parallel with Track 1 slices that do not share screens.

- [ ] **R2.1 Nav IA**
  - Sidebar order matches prototype **roles we keep:** Dashboard, Room Plan, Front Desk, Reservations, New Booking, Housekeeping, Guests, Rates, Folios, Night Audit, Settings. Quiet: Inventory, Staff, Roster, Exceptions, City ledger, Shift.
  - **Today:** `nav.ts` has no Shift item (`ShiftStrip` links to `/shift` from AppShell). City ledger is in the list but not `tone: 'quiet'`. This slice adds both — not a later surprise.
  - **Night Audit stays in the sidebar.** The prototype only CTAs it from Dashboard; live already has a nav item — keep it.
  - **Out:** Whistle button, booking-engine simulation chrome, role-swap, property-switcher (until **R4.4**).
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
  - **Prototype / register:** `EXPECTED_PROTOTYPE_KEYS` length **97** (`packages/contracts/src/register.test.ts`). Do not confuse with `COMMAND_CATALOG` length **89**. **Do not** re-derive classification; extend `packages/contracts/src/config/register.ts`.

- [ ] **R3.2 Recurring / fixed charges (named leftover — still Phase 1-adjacent)**
  - Architecture deferred this. **When** you take it: schedule table, post inside existing `POST_ROOM_CHARGES` (no 9th step unless pin updates), snapshot `amountMinor`, honour `no_post`. Until then keep **unchecked** only if product pulls it forward; default is **after Track 1**.

- [ ] **R3.3 Rate-plan inclusions**
  - Deferred with R3.2. Do not add a JSON column nobody posts.
  - **Priority raised (2026-09-12):** package reservations are *Core* in ARCHITECTURE §16.6 and are built on this slice and **R3.2** — see **R4.13**. The no-unposted-column rule still holds.

- [x] **R3.4 Early-departure command**
  - Same as audit L6 / R0.14. If R0.14 is done, tick both.

- [ ] **R3.5 B3 HTTP `noPost` on guest PATCH**
  - Audit Vertical 14. SPA already uses front-office RPC.

- [ ] **R3.6 Launch-country tax model**
  - **Decided (2026-10-27): India first — the pilot client's state.** Supersedes the 2026-09-12 Canada-first call; Ontario and British Columbia follow as configuration on the same engine in **R4.19** (Track 4). Recorded in [`ARCHITECTURE.md` §7.9](../ARCHITECTURE.md#79-regulatory--the-hidden-second-product).
  - **Why India first:** the pilot is a real operator switching from BluePMS ([checklist](research/2026-10-27-pilot-client-checklist.md)), and India is the market that shaped the engine — the slab rate, the component split and the fiscal hook all exist because of it.
  - **Locked:** build the eight requirements in §7.9 — jurisdiction *stack* (not a country enum), rate as a **function** of `(jurisdiction, date, taxable base, product class)`, computed **inside the PropertyDO transaction** (§5.1) and **per night at posting**, a levy that can **split into components**, inclusive-vs-exclusive as a **jurisdiction property**, a nullable **fiscal-document hook** on the invoice engine, and **ordered levies** where one can sit inside another's base.
  - **Locked (India):** jurisdiction stack country → state; **GSTIN per property**. Room GST is a **slab keyed to the per-night value of supply**, so a discount or an upgrade can move a night across a boundary — that is why the rate is resolved inside the transaction. Components are `CGST` + `SGST` or `IGST` by **place of supply**. The F&B rate depends on the property's **specified-premises** declaration for the financial year: a dated, property-level DOMAIN key read inside the DO transaction — never from KV.
  - **Locked:** record tax jurisdiction **per property, not per org**. Keep a **tax-inclusive jurisdiction fixture** in the engine's tests; neither India nor Canada exercises requirement 6.
  - **Verify first:** slab boundaries, the specified-premises tariff test and the e-invoicing threshold with the client's tax advisor before the first rupee posts.
  - **Scope out:** Canadian provinces (**R4.19**); Quebec; Australia. Fiscalization is **R5.5** (Track P); `held` behaviour is **R5.13**.

- [x] **R3.7 Cross-store purge Workflow**
  - **Shipped.** Spec: [purge workflow](superpowers/specs/2026-08-12-purge-workflow-design.md). Code: `PurgeWorkflow`, certificates, `guest.erased` consumer. **Do not rebuild.** Iceberg skip remains honest on the certificate.

- [x] **R3.8 ARI KV + staleness SLA + reject-on-commit**
  - **Shipped.** Spec: [ARI KV projection](superpowers/specs/2026-07-29-ari-kv-projection-design.md). Binding `ARI_KV`; book uses `quoteAriVersion`. **Do not rebuild.** R4.2 is the public-engine consumer.

- [ ] **R3.9 Degraded SPA watermarks (gap-fill only)**
  - `StaleWatermark` + exception workbench already ship. Walk remaining screens: every `READ_STALE` / `QUEUE_PROVISIONAL` / `FAIL_CLOSED` path the clerk can hit shows a watermark or Alert. Do not add a second banner system.

- [ ] **R3.10 Entitlement catalog amendment (packaging v1)**
  - **Why now:** every Track 4 add-on is gated on a key that does not exist. `FEATURE_KEYS` holds **two** keys (`pms.core`, `pms.units.limit`); **R4.2** and **R4.3** both name keys outside it, so both are Blocked until this lands.
  - **Locked:** implement the authorised target table in [`ARCHITECTURE.md` §6.7](../ARCHITECTURE.md#67-package-composition) exactly. Extend `FEATURE_KEYS` (`packages/contracts/src/entitlements.ts`) and `PLATFORM_SEED_FEATURE_KEYS` (`packages/do-runtime/src/platform-migrations.ts`); seed three plans — **Starter / Growth / Group** — plus the add-ons. `pnpm check:entitlements` stays green and `FeatureKey` must not collapse to `| string`. There is **no Enterprise plan**; do not seed one.
  - **Also locked:** `pms.properties.limit` is a **`hard`** limit at the OrgEntitlementDO counter (§6.6) — it *is* the ten-property ceiling, and a stale snapshot must never let an eleventh property provision. `payments.enabled` on Starter is `required`, not a boolean grant: a Starter tenant without payments enrolment is a provisioning failure, not a silent free tier.
  - **Scope out:** billing, Stripe, plan self-serve, add-on purchase UI (all **R5.6**). Keys, plans and seed only.
  - **Blocks:** R4.2, R4.3, R4.6.

---

## Track P — India pilot client (switching from BluePMS)

The first paying operator: one Indian hotel replacing BluePMS. Its returned checklist ([`docs/research/2026-10-27-pilot-client-checklist.md`](research/2026-10-27-pilot-client-checklist.md)) is the scope — Front Office, Housekeeping, Point of Sale, Channel Distribution and AI Copilot in full, plus Guest 360, GST e-invoicing and a Tally / Zoho export. This track is what it needs to switch, and nothing it left blank.

Start only when Tracks 0–2 Phase-1 boxes are `[x]`, and **R3.1**, **R3.2**, **R3.3**, **R3.6** (India tax model) and **R3.10** (entitlement catalog) are `[x]`. R3.4, R3.5 and R3.9 may remain. Each gated module follows `ARCHITECTURE.md` §14 Phase 2: core never imports add-ons, and **the first gated module to ship proves the mechanism** — if it needs a special case, fix the mechanism, not the module.

**Provisioning:** the pilot tenant is provisioned by ops on **Growth** with the `pos.enabled` and `ai_ops.enabled` add-ons. Growth grants `payments.enabled` rather than requiring it, so no live acquirer (R4.7) and no self-serve billing (R5.6) is needed for the pilot. The pilot left *embedded card payments* blank — deposits are recorded as tenders.

**Every ticked item is a must-have** (client, 2026-10-27) — none may be scoped out, deferred to a later track or replaced by a link to a later slice. Track P is done when every row of the coverage table in the [checklist research](research/2026-10-27-pilot-client-checklist.md#coverage--ticked-item-to-slice) points at a `[x]` slice. Items the client left blank stay out.

- [ ] **R4.5 Outbox consumers + Queue workers**
  - ARCHITECTURE Phase 2 mechanism proof. **Locked:** required before or with **R4.3**. No special cases inside PropertyDO. Do not start R4.3 if events have no consumer.

- [ ] **R4.15 Guest ID documents, preferences + consent**
  - **Depends:** **R1.8** (guest CRM remainder), **R0.5** (per-org HKDF keys — shipped).
  - **Pilot checklist:** *Guest lookup (ID documents)*, *Guest documents*, *Edit reservation and guest preferences*, *Guest 360 (identity, stays, preferences, consent)*.
  - **Preferences:** structured guest preferences (room, bedding, dietary, accessibility) on the OrgDO profile, shown on the stay card and at check-in. R1.8's free-text notes stay notes; do not fold one into the other. `GuestProfile` holds none of these today.
  - **Undefers** two named leftovers of the [guest CRM directory spec](superpowers/specs/2026-08-13-guest-crm-directory-design.md) — ID documents and `guests.update_consent`. Amend that spec's leftover list in the same change-set; do not leave it saying "defer".
  - **Locked:** ID documents live on the **OrgDO profile**, encrypted under the per-org HKDF key; scans in R2 under the same key, **covered by `PurgeWorkflow` and its certificate** (erasure must delete the objects, not orphan them). Events carry `guest_ref` only. Every document read is audited. Fields include passport and visa details for foreign nationals, because **R6.2** Form C reads them. **Aadhaar numbers are stored masked (last four) only** — confirm current UIDAI rules before shipping.
  - **Locked (consent):** per-purpose consent with timestamp, source and notice version, read by whatever sends to the guest (R5.2 later). India's DPDP Act sets the notice and withdrawal rules — confirm with the advisor.
  - **Also locked:** **R1.17**'s *require ID at check-in* reads this — check-in fails closed when it is on and no document is recorded.
  - **Tests:** two-property same-org — hotel A cannot list or read hotel B's guest documents (AGENTS §5); purge removes R2 objects and the certificate says so.
  - **Scope out:** OCR, document verification services, `guests.merge`.

- [ ] **R5.5 Fiscalization (India e-invoicing)**
  - **Depends:** **R3.6** (India tax model), **R1.12** (financial-year invoice series), **R4.5** (the portal call is outbox-driven).
  - **Moved (2026-10-27):** from Track 6 into the pilot — an Indian hotel above the turnover threshold cannot legally issue a B2B invoice without it.
  - **Locked:** IRN and signed QR from the Invoice Registration Portal for **B2B invoices** (the guest's or company's **GSTIN** on the invoice), through the §7.9 requirement 7 **fiscal-document hook** on the existing invoice engine — not a second invoice path. The portal is called from an outbox consumer, never inside `transactionSync`. A B2B invoice is **not final until its IRN returns**; a portal failure lands in the exception workbench with Retry, and the desk is told plainly — checkout itself is not blocked. Cancellation inside the portal's window, then credit notes. Key `compliance.fiscalization` (every tier, §6.7). Portal credentials are `SECRET` class.
  - **Scope out:** B2C dynamic QR (only above a much larger turnover threshold — confirm the client is below it); Quebec sales-recording.

- [ ] **R6.2 Form C — foreign-national guest registration (India)**
  - **Depends:** **R4.15** (passport and visa fields).
  - **Not ticked by the pilot, but a legal duty in India** (§7.9): an arrival record for each foreign national to the Bureau of Immigration within 24 hours. Ask the client how they file today (checklist Q5) before building beyond the tracker.
  - **Locked:** a per-stay Form C record built from the profile's documents, with a **24-hour deadline** from check-in; an unfiled record past the deadline is an exception on the workbench. Submission is manual on the government portal unless an official API exists — HospAI produces the data and tracks the filed reference; it does not scrape or auto-submit a portal.
  - **Scope out:** C-form departure updates beyond what the portal requires; other countries' guest registration.

- [ ] **R4.18 Desk tenders for India — fork, Blocked until the client answers**
  - **Pilot checklist Q4:** which tenders the desk records today. Indian desks commonly take **UPI** and **bank transfer** alongside cash and card.
  - **Locked:** `tender_type` stays `CARD` \| `CASH` (cashiering spec, AGENTS §2) **until that spec is amended**. If the client needs more, amend [cashiering](superpowers/specs/2026-08-07-cashiering-design.md) first — tender list, shift-close expected amounts and the R4.12 ledger mapping — then implement. Recording a payment taken on an external terminal or UPI app is a tender, **not** a gateway integration (that is R4.7 / R5.4).
  - **Scope out:** UPI collect / gateway integration; cheques, vouchers, gift cards unless the amended spec names them.

- [ ] **R4.20 Day-wise rate override on a reservation**
  - **Depends:** **R1.4**, **R1.15**, **R3.6**.
  - **Pilot checklist:** *Day-wise rate overrides* in *New reservation*. The rates matrix (shipped) sets a plan's price per day; this is the clerk changing **one booking's** price for chosen nights. Nothing in pms-core supports it today.
  - **Locked:** the override replaces the snapshotted nightly amount on the stay (read the [reservations book](superpowers/specs/2026-07-27-reservations-book-design.md) and [modify](superpowers/specs/2026-07-27-reservations-modify-design.md) specs for where that snapshot lives — do not add a second price column). Integer minor units, a required reason, an audit-log write and its own permission. `POST_ROOM_CHARGES` posts the overridden amount, and **tax resolves per night on the overridden value** — in India that can move a night across a GST slab (§7.9 requirements 2 and 4). Modify keeps overrides on nights that remain.
  - **Tests:** an override that crosses a slab boundary posts that night's tax at the new slab; the other nights do not move; a clerk without the permission gets 403.

- [ ] **R4.13 Front Office depth — packages, proforma, document templates**
  - **Depends:** **R3.2** (recurring charges) and **R3.3** (rate-plan inclusions) — packages are built on both. **R1.5** for add-on products.
  - **Prototype:** `PackageMaster.tsx`, the Booking Wizard package mode, proforma and registration-card template switchers.
  - **Scope (§16.6 *Core*):** package templates (room type, plan, number of nights, fixed price, included add-ons) with a **posting schedule** — every night, arrival day, a set night, or before departure — executed inside the existing `POST_ROOM_CHARGES` step (do **not** grow `NIGHT_AUDIT_STEPS`); add-on scheduling for full stay, arrival, departure, weekends or single days; a proforma invoice from a reservation; selectable templates for the proforma and the registration card.
  - **Locked:** a package splits into posting lines that each carry their own tax under §7.9 — a bundled price is never taxed as one line. Printable documents never render in `DEGRADED` (§4.6).
  - **Scope out:** a template *designer*; e-invoicing (**R5.5**).

- [ ] **R4.11 Housekeeping depth**
  - **Depends:** **R1.9**. **R4.10** is no longer a dependency — the pilot needs this before the mobile app ships.
  - **Prototype:** `Housekeeping.tsx` Tools (BluePMS parity Phase 2).
  - **Scope (§16.6 *Core*):** lost and found custody — found, handed over, claimed or closed, never deleted; missing and damaged cases with closure; guest-count audit comparing front-office occupancy with housekeeping counts, with a variance reason; scored inspections from checklist templates (weighted items, required checks, room score); cleaning stages and linen movement; minibar pickup and amenity dispatch **posted through the folio contract**, never inserted.
  - **Guest requests against a room (pilot checklist):** a room-scoped housekeeping request — extra towels, cot, amenity — raised from the desk, assigned to an attendant and closed on the HK board. Moved here from the **R5.2** concierge tasks because the pilot needs it before Whistle; R5.2 reuses this task type rather than adding a second list. Not a maintenance work order (that stays the R1.9 module on `room.ooo_changed`).
  - **Locked:** **desktop capture first** — the supervisor records finds, damage, inspections and minibar pickups on the operator SPA. Attendant capture moves to the **R4.10** mobile app when it ships, on the same commands. No width breakpoints in `web-pms`. Minibar and amenity stock moves against the R1.9 operational list — **no stores inventory** (§16.6). Post minibar straight to the folio; do not create a POS bill to do it.
  - **Scope out:** budgeting and metrics dashboards (still dropped); stores inventory; productivity pay. Reports are **R4.14**.

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
  - **Scope out:** direct OTA connections; a channel manager of our own; OTA content (photos, descriptions); rate-parity tools; metasearch; a second channel manager in this slice.

- [ ] **R4.12 Accounting export**
  - **Why:** every one-to-ten property owner keeps books in accounting software, and neither BluePMS nor the prototype integrates one. It is also where purchasing, stock and payroll meet the PMS without us building those modules (§16.6).
  - **Locked:** export revenue, tax by jurisdiction component (§7.9), payments, deposits and AR as journal-ready summaries per business date and property, mapped to a tenant-configured chart of accounts. Build from night-audit snapshots — **never** a live read across PropertyDOs (§7.6). Idempotent per business date: a re-export produces the same journal.
  - **First targets:** **Tally and Zoho Books** (India pilot), with GST posted by component (`CGST` / `SGST` / `IGST`) to the configured ledgers. QuickBooks Online and Xero follow in **R4.19** with the Canada launch.
  - **Also locked:** payroll *inputs* — hours from roster and shift (POS clock-in stays in the vendor's system), and tips, service charge and commissions where captured — export as a file for the operator's payroll provider. **We do not calculate pay.**
  - **Also:** outlet revenue from the **R4.21** day-close totals journals as outlet revenue; room-charged checks are already in the folio and must not be counted twice.
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
  - **Tests:** a duplicate post of one check charges the room once; a post after check-out is refused with a named code and lands on the workbench; the posted tax components foot to the check total; a missing day-close raises a pre-check exception.
  - **Scope out:** tables, orders, kitchen, settlement, promotions and POS reports (vendor); a second POS vendor; stock and recipe costing (§16.6).

- [ ] **R4.16 Copilot — read-only, permission-aware**
  - **Depends:** **R3.10** (`ai_ops.enabled`, `ai_ops.messages.limit`). Comes before **R4.6**, which adds the write path on top of it.
  - **Pilot checklist §14:** ask operational questions; answers with source context; help with reports and summaries; suggested next actions; only shows what the staff member may see.
  - **Prototype:** `CopilotHome.tsx`.
  - **Locked:** the copilot's tools are **existing read routes**, called **as the asking user** through `dispatchV1` — the same permission, property scope and `assertTenantActive` as the SPA. No tool without an existing route; no command execution. **Suggested next actions** render as links or buttons to the existing screen or command, and the **clerk** clicks them — the copilot never submits. Every answer cites its sources as links to the records it read (reservation, folio, report snapshot).
  - **Locked (PII):** guest data only through the decrypt paths the user may already call; guest-profile reads are audited per read, as in R5.11. Conversation content is not written to logs or events and is not retained past the session. The model provider is named in the DPA.
  - **Also locked:** metering is `ai_ops.messages.limit` (`soft`, §6.6). Build the tool mapping and permission check so **R4.6** and **R5.11** reuse them.
  - **Scope out:** any write (R4.6); guest-facing replies (R5.9); external agents (R5.11); warehouse trends; model choice and prompt content.
  - **Tests:** a `roster:read`-only user's question about a folio gets a refusal, not data; a user at hotel A gets nothing from hotel B; every answer carries at least one source link or says it has none.

- [ ] **R4.14 Operational report set (named, not a catalogue)**
  - **Depends:** **R1.1**, **R1.16**, **R4.11**; the POS and distribution reports land with **R4.21** and **R4.3**.
  - **Pilot checklist:** front-office reports, housekeeping reports, POS reports, distribution reports.
  - **Locked list — nothing outside it without a new slice (§16.6 "Reports are not a backlog"):**
    - **Front office:** arrivals, departures, in-house, **forecast** (rooms on the books by day, read from `availability_day` within the 90-night cap — not a reservation scan), cashier (shift close per cashier), night audit (existing `SNAPSHOT_REPORTS`).
    - **Housekeeping:** room status, attendant workload, inspection scores, lost and found register, damage cases, linen log.
    - **POS:** room charges by outlet and outlet day-close totals from **R4.21**. Item, tender, discount, void, promotion and waste reports are the POS vendor's — that is how this must-have is met.
    - **Distribution:** bookings, revenue and commission by channel.
  - **Locked:** each report is a read over an existing ledger or a night-audit snapshot — no new money calculation. Permission is the permission of the data underneath. Print (card-isolated print CSS) and CSV. `/reports` stops redirecting to the Dashboard (R1.14).
  - **Scope out:** occupancy and demand **trends** (warehouse, §7.8); a report builder; the BluePMS catalogue.

- [ ] **R4.8 Migration importers — the switch path**
  - **Why now:** switching PMS is the largest objection in every deal, and for a multi-property operator the **consolidation demo is the sales conversation** — three legacy exports in, one estate view out. There is currently no slice, no contract and no tooling for it anywhere in this repo.
  - **Stage A (single property):** importers for reservations, guest profiles, rate plans and folio history. **First source: BluePMS** — the pilot is switching from it; get a sample export from the client before designing the mapping. Canadian incumbents follow in **R4.19**. Map onto existing commands — **no bulk write path that bypasses `COMMAND_CATALOG`** — and run in the `BULK` lane (§4.2) under the chunk cap so an import cannot stall a front desk.
  - **Stage B moved to R5.7** — group consolidation needs the projections, so it cannot finish in this track. R4.8 is done when Stage A is.
  - **Locked:** import is a product surface with progress, per-record rejection and a re-runnable report — **not** a services engagement and not a script an engineer runs. Idempotent per source record. Every imported money row lands through the folio contract, never inserted.
  - **Scope out:** competitor-specific screen-scraping; anything that writes a DO directly.

### Pilot go-live — not coding slices

Track P being `[x]` means the software is ready. **The pilot is live** when the hotel runs its front desk, housekeeping and night audit on HospAI with BluePMS switched off. These steps are client, advisor and ops work: an agent working the queue **does not pick them** and does not tick them. Steps 1–3 start **now**, in parallel with Tracks 1–3, because their answers shape slices before Track P begins.

- [ ] **Client answers** — the open questions in the [checklist research](research/2026-10-27-pilot-client-checklist.md#open-questions-for-the-client): POS vendor (R4.21), night audit settings (R1.10), tenders (R4.18), Form C filing (R6.2), channel manager and OTAs (R4.3), GST registration and e-invoicing threshold (R5.5). Record each answer in that file and in the slice it unblocks.
- [ ] **Indian tax advisor sign-off** — on the R3.6 tax model before it is built, then on real invoices before go-live: GST slab per night, place of supply, the restaurant rate under the specified-premises declaration, the financial-year invoice series, IRN for B2B, no separate POS tax invoice for room-charged checks, and the DPDP consent notice (R4.15).
- [ ] **BluePMS sample export** — reservations, guest profiles, rate plans and folio history, obtained before **R4.8** is designed. Handled as guest PII: stored only where the purge contract reaches.
- [ ] **POS vendor agreement** — the chosen vendor confirms the R4.21 *Vendor must support* list in writing and gives a sandbox. The connector passes end-to-end in that sandbox before the rehearsal.
- [ ] **Channel manager agreement and connection** — the chosen channel manager confirms the R4.3 *Channel manager must support* list in writing, gives a sandbox and completes its PMS certification of the connector; the hotel's OTAs are switched from BluePMS to HospAI inside the channel manager, with room and rate mappings loaded. No booking lands on the unmapped queue during the rehearsal.
- [ ] **Pilot tenant provisioned** — by ops on Growth with `pos.enabled` and `ai_ops.enabled` (Track P *Provisioning*); rooms, room types, rate plans, packages, charge codes, outlet mappings, staff users and roles configured; e-invoicing and POS credentials loaded as `SECRET`.
- [ ] **Staging rehearsal** — the hotel's configuration plus a full BluePMS import on staging. Run a booking-to-checkout day per room type, a B2B checkout with IRN, a room-charged POS check, a Form C record, a channel booking and a night audit; the R4.8 import report has no unexplained rejections.
- [ ] **Parallel run** — at least three consecutive nights with both systems live. Each night, compare the night audit (room revenue, tax by component, payments, in-house count) with BluePMS. Any difference is explained and fixed before cut-over; the comparison is kept as the sign-off record.
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
| Room Plan Timeline | `TapeChart.tsx` | `/board` | R0.6, R1.3, R2 |
| Front Desk Board | `FrontDesk.tsx` | `/arrivals` etc. + BoardSummary | R0.6, R1.3, R1.19, R1.20, R2.2 |
| Cash drawer / shift | Front Desk cash | `/shift` + AppShell strip | R0.14, R1.16 honesty |
| Reservations **list** | `Reservations.tsx` list | `/reservations` | shipped |
| Reservations **stay card** | `Reservations.tsx` selected stay | missing SPA | **R1.15** (HTTP exists) |
| New Booking | `BookingWizard.tsx` | `/book` (adults, hold, promo, search) | R1.4 remainder, R1.20 |
| Housekeeping Desk | `Housekeeping.tsx` | board + assign + workload | R1.9 (priority, inventory, **maintenance module**, roster skills) |
| Rates & Yield | `RatesAvailability.tsx` | `/rates/*` | R1.7, R5.1 |
| Guest CRM | `GuestsCRM.tsx` | `/guests` | R1.8 (DEMO-READY P1); documents + consent **R4.15** |
| Folio Ledger | `FoliosBilling.tsx` | `/folios` directory → `/folio/:id` | R1.2 **done** |
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
| Distribution / channels | `ChannelManager.tsx` | missing | R4.3 connector to a third-party channel manager (needs R4.5) |
| Yield Analytics | `ReportsAnalytics.tsx` | missing | R5.1 |
| Whistle | `WhistleHub.tsx` | missing | R5.2 |
| Onboarding | `OnboardingDashboard.tsx` | demo seed only | R4.2 ops |
| Marketplace | Settings tab | missing | R5.3 |
| Property switcher | header dropdown | missing | R4.4 |
| Multi-property projections | — | missing | R5.7 |
| Room Ops live view | `RoomOpsLiveView.tsx` | covered by `/board` | §16.6 — no second grid |
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
- Need to widen `tender_type` beyond `CARD` \| `CASH`, add Phase 1 email, extra stay `guest_ref`s, warehouse trends on the desk, or a second occupancy scan.

---

## Catalog pins (refresh each session)

After **R1.6** (2026-10-28):

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` | length **95** |
| `V1_HTTP_ROUTE_AUDIT` | **152** routes, last `put_operational_config` |
| `PROPERTY_SCHEMA_HEAD` | **36** |
| `ORG_SCHEMA_HEAD` | **10** |
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
