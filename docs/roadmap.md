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

**Revision:** 2026-09-04 completeness pass (stay workspace, HK inventory, Settings Guests, cashiering, §14 leftovers). Older drafts that treated Reservations as “polish R2” or HK inventory as dropped are wrong — use this file.

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
**Do not** start Track 4 (Phase 2 add-ons) while **Track 1 or Track 2** still have open boxes. R3.2–R3.5 leftovers may remain; **R3.1** must be done; **R3.8** before R4.2.

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
- **Same clerk flows:** tape click → stay; book → quote $ → Hold/Confirm/Inquiry; stay card modify/cancel/no-show; check-in by room **code**; folio as a bill; HK dirty→clean; night audit as a job; shift open/close.
- **Chrome:** existing P0-3 tokens (sage `#4A5D4E`, cream, IBM Plex). `PageHeader` + `Card`. One `<h1>`. Live `property.name`.
- **Not:** Tailwind v4, `lucide-react`, `recharts` as a product, pixel-identical CSS, prototype “Simulation Active”, role impersonation, Opera fake sync, competitor scrape.

### All features functional

- Every prototype **core-PMS** behaviour that ARCHITECTURE §16.5 marked **KEEP** (or shipped) works on PropertyDO/OrgDO/HTTP/SPA.
- Settings keys the SPA shows are **read** by pms-core (or hidden).
- City-ledger AR actually posts (audit L1). Board updates after check-in without waiting on WebSocket (audit U1).
- Prototype **Phase 2/3** surfaces (channel manager, booking engine, groups, Whistle, yield engine, marketplace, POS) are **on this roadmap** as Track 4–5, not dropped. They are not Phase 1.

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
| HK budgeting / metrics / mobile / HK reports | Dropped from Phase 1 |
| HK **inventory** (linens/stock) and **manager priorities** | **KEEP** — §16.1 core HK; not in the drop list |
| Settings **Tickets** (valet SLA, inspections, escalations) | Not Phase 1. Maintenance work orders are R1.9. Guest-service tickets → Whistle (R5.2) or stay hidden |
| Keyless / door-lock | Dropped |
| Room-type photos | Deferred (booking engine Phase 2) |
| Recurring breakfast/parking engine | Deferred (named leftover) |
| Plan-scoped restrictions | Type-wide `*` until channel-manager phase |
| Rate-plan inclusions JSON | Deferred with recurring |

---

## Already shipped — do not rebuild

Tick these mentally; they are not open work.

- Live routes: Room Plan `/board`, Front Desk `/arrivals|departures|in-house`, Reservations **directory**, Book, Check-in, Folio **drill-in**, Guests directory + profile, Inventory (physical + **virtual** types, floors, OOO ranges), Rates (plans including **derived**, matrix bulk, type-wide restrictions), Staff, Roster, Housekeeping **board + assign**, Night audit, Exceptions (platform-only; not in prototype nav), Settings (property / charges **including routing rules** / tax), City ledger screen, Shift, Sign-in, demo seed, invoice **engine** on folio, hold/confirm/cancel/no-show **commands**, registration-card **view**, global search shell.
- Ledgers: availability, restrictions, folio windows, OOO → blocked, night-audit `BusinessDate` (8 steps, `AUTO_TRANSFER` at [3]), entitlements, RBAC, degraded mode + exception workbench, multi-currency folio, guest shredding, promo/discount/damage/no-post (money-ops), `dnd_flag` / VIP / front-office comment **domain** (SPA editor still thin).
- Demo-ready P0 chrome + folio first-paint + seed ([DEMO-READY.md](../DEMO-READY.md)).

**Shipped but lying or unfinished** (Track 0 / 1): Booking Settings keys persist unread; COMPANY AR never posts; check-in does not invalidate `['board']`; Rates matrix paints a label in every cell; Settings is three tabs vs prototype’s twelve sections; no Dashboard Hub; no org-wide folio directory; Reservations directory is a **list**, not the prototype stay workspace (modify / cancel+penalty / add-ons); HK has no priority / inventory / maintenance tabs; guest CRM has no tags/LTV; products are charge codes only; guest-profile Settings (`pms.guests.settings` exists unread); Shift exists but FX/cash-date bugs are audit L9–L10.

**Shipped — do not rebuild, only wire if a hole remains:** folio routing rules (Settings charges), invoice generate/view on FolioScreen, promo/discount/damage/no-post RPCs, Hold/Confirm/Cancel/No-show **commands**, `StaleWatermark` on front office, ShiftScreen + ShiftStrip, Exceptions workbench, global search (`reservation_id` = confirmation).

---

## Completeness re-check (what earlier drafts missed)

Cross-checked against prototype `App.tsx` / `Reservations.tsx` / `Settings.tsx` / `Housekeeping.tsx` / `TicketsSettings.tsx`, ARCHITECTURE §14–§16.1, `EXCLUDED_PROTOTYPE_KEYS`, and live SPA routes. Locked below so an agent does not skip them.

| Gap | Lock |
|---|---|
| Reservations stay card (`Reservations.tsx`) | **R1.15** — not “polish R2”. Directory is shipped; modify / cancel+penalty / no-show / confirm / cancel-check-in / extras are not. |
| HK inventory + manager priorities | **KEEP** in **R1.9**. Move `pms_hk_inventory` / `pms_hk_manager_priorities` out of `EXCLUDED_PROTOTYPE_KEYS` when implemented. Budgeting/metrics/mobile/HK reports stay dropped. |
| Maintenance task types + checklists | **R1.9** work orders. Not a clone of `TicketsSettings.tsx`. |
| Roster skills / shifts / capacity | **R1.9** on existing `/roster` — no second staff table. |
| Settings → Guests | **R1.17**. Key `pms.guests.settings` already exists. Distinct from CRM directory (R1.8). |
| Settings → Accommodations | **R1.18** deep-link to Inventory. Do not fork a second room editor. |
| Settings → Tickets (valet SLA, inspections, escalation) | **Hide.** Maintenance = R1.9. Guest-service tickets = Whistle **R5.2**. |
| Bulk rates by date range **and day-of-week**; plan modifiers | **R1.7**. Live has date-range bulk; DOW filter and non-derived modifiers were missing from the first draft. |
| Hold vs Confirm vs inquiry/pending | **R1.4**. Commands exist; wizard must name the three outcomes. |
| Shift / cashiering | Live ShiftScreen exists. SPA honesty + Front Desk strip = **R1.16**. Cash FX/date = **R0.14** (L9–L10). |
| Folio routing / invoice / promo apply | Routing + invoice engine shipped. Stay-card extras + apply-promo UI = **R1.15** / FolioScreen hole-fill, not a new money model. |
| Dirty-room force check-in (prototype confirm) | **Keep** platform cleanliness gate. Alert why; no force unless an existing override permission already exists. |
| Night audit in live nav (prototype hides it) | **Keep** live nav. Do not “fix” by hiding it. |
| DEMO-READY P1 guest CRM still unchecked | That is **R1.8**, not a demo blocker. Do not reopen P0. |
| ARI KV + reject-on-commit | Phase 1 architecture, consumed by booking engine. **R3.8** before **R4.2**. Does **not** block Track 1 desk screens. |
| Launch-country tax model | **R3.6**. Stop if the human has not named a country. |
| Cross-store purge Workflow | **R3.7**. Needed before first tenant churn, not before the 8-minute demo. |
| Degraded SPA watermarks | `StaleWatermark` shipped. **R3.9** only gap-fills missing classes. |
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
  - **Live:** none. Add `/` or `/dashboard` (keep `/board` as Room Plan). Nav first item.
  - **Locked:** OLTP only — occupancy from `availability_day` (not reservation scan), arrivals/in-house/departures from existing front-desk reads, ADR from folio ROOM posts for `businessDate`. Available-rooms uses existing `GET …/front-desk/available-rooms`. CSS/ui-kit metrics; **no recharts**.
  - **Out:** competitor scrape, Whistle launcher as a product, “add 5 fake arrivals”.
  - **Tests:** occupancy matches ledger for a seeded day; available-rooms omit occupied+OOO.

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
  - **Locked:** tape empty-cell → Book with dates/type prefilled (prototype `prefilled`). Available-rooms as a modal or Room Plan view that books. Board: VIP/DND/comment badges from existing fields; assign-room from board. Cancel check-in: wire the existing command on the stay card (**R1.15**) and board if the catalog already has it. Dirty-room check-in: **keep** the cleanliness gate; Alert the reason — do not add a silent force-override.
  - **Out:** prototype “Add 5 arrivals” theater.

- [ ] **R1.4 Booking wizard remainder**
  - **Depends:** R0.11 (hide or wire Booking settings).
  - **Prototype:** `BookingWizard.tsx`.
  - **Live:** `BookingScreen.tsx`.
  - **Locked:** collect adults/children (domain already enforces). Guest search via blind index (audit P3 — if R0.12 did exact-id-only, this slice adds name search the honest way). Quote is dollars. Types FAIL_CLOSED disables confirm. **Three outcomes, named:** Hold (existing `holdReservation`), Confirm (`PENDING`→`CONFIRMED` machine), Inquiry (`INQUIRY`). Do not collapse inquiry into confirmed. Wire `same_day_*` / `require_prepayment` **or keep hidden** — do not show inert toggles. Booking add-ons (parking, breakfast) = **products** from R1.5 posted to the folio, not the recurring engine (R3.2).
  - **Tests:** occupancy exceeded on wizard submit; FAIL_CLOSED disables Hold/Quote/Confirm.

### R1 — Inventory / rates / products

- [ ] **R1.5 Products catalog (not only charge codes)**
  - **Depends:** none after R0.1.
  - **Prototype:** `ProductsSettings.tsx` (categories, SKU items, add-ons, tax code).
  - **Live:** Settings → Charges (`charge_code` rows).
  - **Locked:** products module (or Settings tab) on PropertyDO: category + item + default `amountMinor` + `chargeCode` + tax group. Folio “post charge” picker uses **products**, not raw codes, for incidentals. System codes (ROOM, PAYMENT, …) stay hidden. **No** stock/reorder engine in Phase 1 (null stock like prototype services).
  - **Pins:** new commands/routes + schema version in the same commit.
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
  - **Live:** `GuestsDirectoryScreen.tsx`, `GuestProfileScreen.tsx`.
  - **Locked:** tags + VIP on profile (VIP flag may already exist on stay — guest-level VIP in OrgDO profile). Stay history from property reservations for that `guest_ref`. **LTV / lifetime spend** = sum of that property’s folio postings (OLTP), not warehouse. Consent / merge: merge two `guest_ref`s with an explicit command (shred loser key). Sort by stay count or spend on the directory.
  - **Out:** warehouse LTV trends (§7.8).

- [ ] **R1.9 Housekeeping — KEEP core extras**
  - **Depends:** none after R0.1.
  - **Prototype:** `Housekeeping.tsx` tabs: board, priority, assignments, staff, inventory, budgeting, metrics, reports, maintenance, mobile.
  - **Live:** `modules/pms/housekeeping` board + assign + roster picker.
  - **Locked Phase 1 tabs:** **board** (done), **assignments** (done), **priority** (ordered room list — implement; move `pms_hk_manager_priorities` out of `EXCLUDED_PROTOTYPE_KEYS`), **inventory** (linens/stock counts as OPERATIONAL config + a simple list SPA — implement; move `pms_hk_inventory` out of excluded; **not** a warehouse or reorder engine), **maintenance** (work-order entity: room link, status, **task types**, **checklist** on the ticket). **Staff** = `/roster` with shifts / skills / capacity fields on the existing roster row — do not fork a second staff table.
  - **Drop (do not build):** budgeting, metrics dashboards, HK reports, mobile attendant, `TicketsSettings.tsx` valet/SLA/inspection-template product.
  - **Tests:** assign + status; maintenance ticket tied to room; OOO still fail-closed if assigned; inventory list round-trips; roster row stores skill/capacity without a new aggregate.

- [ ] **R1.10 Night audit operator job**
  - **Depends:** R0.7 (L5/N1).
  - **Prototype:** `NightAudit.tsx` stepped wizard (checks → settle → execute).
  - **Live:** `NightAuditScreen.tsx`.
  - **Locked:** Alert on run/fail; STEP_LABELS; halt copy = review, Retry, Resume. Pre-check counts (pending arrivals, due-outs, dirty rooms) from existing reads. Do **not** grow `NIGHT_AUDIT_STEPS`. Do not print folio/invoice in `DEGRADED`.

- [ ] **R1.11 Settings: Users / System / Logs**
  - **Depends:** R0.2.
  - **Prototype:** Settings `users`, `system` (preferences, notifications, tags), `logs`.
  - **Live:** Staff + Roster screens; limited property settings.
  - **Locked:** **Users** = Staff screen linked from Settings, not a third user model. Clerk remains authn-only. **System preferences** = classified OPERATIONAL keys that pms-core reads (timezone already on property). **Notifications** = defer unless a real channel exists (do not fake email). **Tags** = guest tags from R1.8. **Logs** = money/inventory audit log **read** UI (`GET` audit if missing). Prototype email templates / scheduling → Track 5 (Whistle) or hide.

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
  - **Locked:** Add `/reservations/:id` (or a directory split pane) on ui-kit. Modify stay uses existing reservation update (availability ledger, not a reservation scan). Cancel posts the **snapshotted** penalty when outside the free window — integers, append-only folio. No-show uses the existing command (night audit may also auto-no-show). Cancel check-in uses the existing command. Confirmation = `reservation_id`. Damage deposit = existing money-ops extra, checkbox on the card. Add-ons = products (R1.5) or hide until R1.5. Inquiry / pending / confirmed filters on the directory.
  - **Out:** dirty-room force check-in; recurring breakfast engine; a second folio UI.
  - **Tests:** cancel outside window posts one penalty line; modify dates moves availability; cancel-check-in returns the stay to confirmed without deleting folio history.

- [ ] **R1.16 Cashiering / shift as a first-class desk surface**
  - **Depends:** R0.14 for L9–L10 cash FX and business-date on close. If R0.14 is still open, do not start this slice.
  - **Prototype:** cash drawer on Front Desk.
  - **Live:** `ShiftScreen.tsx`, `ShiftStrip.tsx`. HTTP `get_shift` / `put_shift_close` exist (coverage is thin — characterization, not a new protocol).
  - **Locked:** Front Desk shows the strip; open/close/drawer counts on the existing shift aggregate. Per-cashier audit = existing money audit log filtered by actor, not a new ledger. Do not rebuild cashiering inside PropertyDO.
  - **Out:** live payment-gateway drawer; PCI card data.

- [ ] **R1.17 Settings → Guests (profile defaults)**
  - **Depends:** R0.11. Merge UI is R1.8.
  - **Prototype:** `Settings.tsx` `activeSection === 'guests'` (default country/language, require email/phone, require ID at check-in, duplicate matching).
  - **Live:** `pms.guests.settings` OPERATIONAL JSON exists; no Settings section; check-in does not read it.
  - **Locked:** Settings section bound to that key. Every toggle pms-core **reads** (ID-at-check-in must fail check-in when on). Duplicate match rules gate create; merge remains R1.8. Hide Opera-flavoured controls with no consumer.
  - **Out:** a second guest book; decrypt-on-list.

- [ ] **R1.18 Settings → Accommodations**
  - **Prototype:** Property subtab `accommodations`.
  - **Locked:** deep-link / embed the Inventory screens (types, rooms, floors, OOO, amenities). **Do not** build a second editor. Spaces / split-inventory tabs stay hidden until Track 4.

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

- [ ] **R3.7 Cross-store purge Workflow**
  - ARCHITECTURE §4.8 / §14. Guest shredding of keys is already shipped; the Workflow (VERIFY + certificate) must exist before first tenant churn.
  - **Locked:** complete the Workflow path; do not shred financial-record classes (§7.9). Characterization: VERIFY can fail the run.

- [ ] **R3.8 ARI KV + staleness SLA + reject-on-commit**
  - Desk availability is already the `availability_day` ledger. KV ARI is for the **booking engine and channels**.
  - **Depends:** before **R4.2**. Does **not** block Track 1.
  - **Locked:** projection + stated staleness + reject-on-commit (§7.1). Bookability code must not import reservation-list modules.

- [ ] **R3.9 Degraded SPA watermarks (gap-fill only)**
  - `StaleWatermark` + exception workbench already ship. Walk remaining screens: every `READ_STALE` / `QUEUE_PROVISIONAL` / `FAIL_CLOSED` path the clerk can hit shows a watermark or Alert. Do not add a second banner system.

---

## Track 4 — Phase 2 add-ons (prototype Distribution / Booking Engine / Groups)

Start only when Tracks 0–2 Phase-1 boxes are `[x]` (R3.2–R3.5 leftovers may remain). **R3.1** must be `[x]`. **R3.8** must be `[x]` before **R4.2**. Each add-on is a **gated module** (`ARCHITECTURE.md` §14 Phase 2). Core never imports add-ons.

- [ ] **R4.1 Group blocks / allotments**
  - **Prototype:** Settings split inventory + group as reservation flag.
  - **Locked:** own aggregate, not a reservation flag (§7.4). New module + entitlement.

- [ ] **R4.2 Booking engine (direct book + preview)**
  - **Prototype:** `BookingEnginePreview.tsx`, `BookingEngineSettings.tsx`, `OnboardingDashboard.tsx` (first-hotel wizard — may ship as ops, not the public engine).
  - **Locked:** public site Worker + Static Assets; ARI from KV; reject-on-commit; photos from R2 (unlocks deferred type photos). Entitlement `pms.booking_engine` or catalog equivalent.

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
  - **Locked:** revenue-management module. Occupancy forecast OLTP may feed it; **no** competitor scraper theater.

- [ ] **R5.2 Whistle (guest engagement group)**
  - **Prototype:** `WhistleHub.tsx` + `whistle/*` (inbox, automations, contacts, tasks, upsell, analytics, profile).
  - **Locked:** module **group**, entitlement per sub-module. Events by `guest_ref` only. Email templates from Settings Email live here, not as fake Settings.

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
| Dashboard Hub | `Dashboard.tsx` | missing | R1.1 |
| Room Plan Timeline | `TapeChart.tsx` | `/board` | R0.6, R1.3, R2 |
| Front Desk Board | `FrontDesk.tsx` | `/arrivals` etc. | R0.6, R1.3, R2.2 |
| Cash drawer / shift | Front Desk cash | `/shift` + strip | R0.14, R1.16 |
| Reservations **list** | `Reservations.tsx` list | `/reservations` | R2 polish |
| Reservations **stay card** | `Reservations.tsx` selected stay | missing | **R1.15** |
| New Booking | `BookingWizard.tsx` | `/book` | R1.4 |
| Housekeeping Desk | `Housekeeping.tsx` | HK board + assign | R1.9 (priority, inventory, maintenance, roster skills) |
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
| Settings Tickets | `TicketsSettings.tsx` | hide | R1.9 maintenance / R5.2 |
| Products | `ProductsSettings.tsx` | charge codes | R1.5 |
| Booking engine | `BookingEngine*.tsx` | missing | R4.2 (needs R3.8) |
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
- Need to clone `TicketsSettings.tsx` or add role impersonation.

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
