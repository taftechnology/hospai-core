# Pilot client — BluePMS feature checklist (returned)

**Received:** 2026-10-27 · **Purpose:** the evidence behind the India pilot decision in [`ARCHITECTURE.md` §7.9](../../ARCHITECTURE.md#79-regulatory--the-hidden-second-product) and the §16.6 amendment of the same date. What HospAI builds is decided there and in [`docs/roadmap.md`](../roadmap.md) Track P; this file only records what the client ticked.

## Source

- `BluePMS-feature-checklist.pdf` (HospAI, 6 pages, AcroForm), compiled from the BluePMS public module pages in September 2026 ([`2026-09-12-bluepms-modules.md`](2026-09-12-bluepms-modules.md)) and returned by the client with boxes ticked.
- Read from the form-field values (`use_001`–`use_159`), which match the ticks on the rendered pages.
- **58 of 159** boxes ticked. Every write-in line — *Other* and the 1–10 *must-haves* — is **blank**.

## Read this first

- The client is in **India** (confirmed 2026-10-27) and is switching **from BluePMS**.
- **Every ticked item is a must-have** (client, 2026-10-27). None is optional, deferred or replaced by a link to a later track. The coverage table below is Track P's done-criterion.
- Nothing here has been checked against the client's live BluePMS configuration.
- **The checklist was compiled from a summary** that left out the feature inventories on the module pages. On 2026-10-31 those inventories were read against every tick ([comparison](2026-10-31-bluepms-inventory-vs-slices.md)): 27 covered, 29 partly, 2 missing. Coverage below is corrected to match.
- **A blank tick means "not asked" for anything the checklist never listed.** That covers two whole modules (below) and several front-office features (Q16). It means "not used" only for items the client saw.

## Summary

| # | Module | Ticked | Notes |
|---|---|---|---|
| 01 | Front Office | **18 / 18** | all |
| 02 | Housekeeping | **14 / 14** | all |
| 03 | Point of Sale | **12 / 12** | all |
| 04 | Food and Beverages | 0 / 8 | recipe costing and stock depletion not used |
| 05 | Banquet & Events | 0 / 10 | |
| 06 | Channel Distribution | **7 / 7** | all |
| 07 | Forecast Intelligence | 0 / 6 | |
| 08 | Inventory | 0 / 7 | |
| 09 | Purchase | 0 / 7 | |
| 10 | SPA | 0 / 7 | |
| 11 | Accounts Receivable | 0 / 8 | |
| 12 | CRM | 1 / 10 | Guest 360 only |
| 13 | Communications | 0 / 8 | no WhatsApp, no email |
| 14 | AI Copilot | **5 / 5** | all |
| 15 | Transport | 0 / 10 | |
| 16 | Hostel | 0 / 7 | |
| 17 | Payroll & HR | 0 / 9 | |
| — | Not in BluePMS's list | 1 / 5 | accounting software integration only |
| 18 | Tax & Compliance | **not on the checklist** | added to BluePMS's site later. The *GST / e-invoice QR* tick now points at it. Ask: Q14 |
| 19 | Guest Experience | **not on the checklist** | added to BluePMS's site later. Ask: Q15 |

## Ticked items

**01 Front Office** — guest lookup (search / create profile, ID documents); new reservation (dates, guests, room type, room number, meal/rate plan); day-wise rate overrides; add-ons (stay, arrival/departure, weekends, chosen dates); advance / deposit payments in the booking; proforma invoices; edit reservation and guest preferences; check-in from the reservation screen; registration cards (print / reprint, templates); package templates and package posting rules; room operations grid / tape; live room view by status; front-office billing and open folio; GST / e-invoice QR on invoices; guest documents; night audit (customisable); manager settings; front-office reports (arrivals, departures, in-house, forecast, cashier, night audit).

**02 Housekeeping** — supervisor dashboard; priority / floor-by-floor workbench; room status (dirty / inspected / ready, with comments); guest requests against a room; task assignment to attendants; maintenance / out-of-order blocks; lost and found; missing / damaged items; guest audit (front-office occupancy vs housekeeping counts); inspection checklists and room scores; cleaning stages and linen log; minibar pickup to guest folio and stock; amenity delivery; housekeeping reports.

**03 Point of Sale** — table board by outlet; outlet reservations and waitlist; order entry (in-house guest or walk-in, covers, prep notes); kitchen order tickets (KOT); kitchen display (KDS); billing, discounts, split checks; settlement (tips, split tender, print/email); cash movements and staff clock-in/out; menu waste tracking; promotions (coupons, happy hour, buy-one-get-one); outlet demand forecasting; POS reports.

**06 Channel Distribution** — channel partners / systems; rate and availability (ARI) publishing; rate and room mapping; incoming booking events; unmapped-booking / exception queue; commission and settlements; distribution reports.

**12 CRM** — Guest 360 (identity, stays, preferences, consent).

**14 AI Copilot** — ask operational questions; answers with source context; help with reports / summaries; suggested next actions; permission-aware review (only shows what staff may see).

**Not in BluePMS's list** — accounting software integration (Tally, Zoho Books, etc.).

**Not ticked in that list:** booking engine / website bookings; embedded card payments / payment gateway; multi-property / group operations; guest mobile app.

## Open questions for the client

1. ~~Must-haves~~ — answered: every tick is a must-have.
2. **POS vendor.** Decided 2026-10-27: a third-party POS through a connector (R4.21). Which POS will the client run, and does it cover all twelve ticked POS features plus the R4.21 vendor requirements?
3. **Night audit "customisable".** BluePMS's Front Office page defines this as configurable checks. In BluePMS's Night Audit Check Configuration, which checks does the client have on, and which are set to Fail, Warn or Info? Does the client rely on a listed check that the first R1.10 build leaves out? Do they use open folio holds? The answers set values and later checks; they do not block R1.10 ([draft spec §8](../superpowers/specs/2026-10-30-night-audit-operator-job-design.md)).
4. **Tenders.** Which payment methods does the desk record today (cash, card on an external terminal, UPI, bank transfer, company credit)? HospAI records `CARD` and `CASH` only until the cashiering spec is amended.
5. **Form C.** How are foreign-national arrivals reported today — through BluePMS, or by hand on the Bureau of Immigration portal?
6. **Channels.** Decided 2026-10-28: a third-party channel manager through a connector (R4.3) — HospAI builds no channel manager of its own. Which channel manager sits between BluePMS and the OTAs today, which OTAs does it reach, and will the client keep it? Do those OTAs price by number of guests, and how does the hotel handle OTA card and virtual-card details today ([R4.3 forks](2026-10-28-channel-manager-integration-practice.md#forks--decide-before-building-r43))?
7. **GST registration.** Is the hotel above the e-invoicing turnover threshold, and does it issue B2B invoices to guests' GSTINs?
8. **Live walkthrough — do this first.** One session on the client's live BluePMS, with their Manager Report, night audit configuration and report list on screen. BluePMS's pages are marketing material; this is the only check against what the hotel really uses, and it can answer most of the questions below in one sitting. Ask for samples: one Manager Report, final bill, advance receipt, proforma, registration card, and a B2B invoice with IRN.
9. **Manager settings (R4.32).** Which Manager Report rows and settings do they use, and who reads the report? We read this tick as the Manager Report and MIS settings, not as general settings. Confirm.
10. **Reports (R4.14, fork F3).** Which reports do they run daily and monthly, and in which format? "247" is not a list. Which of them are filed or sent outside the hotel?
11. **Guest documents (R4.13, R4.15).** Does this tick mean ID scans, or the printed guest-facing set (proforma, registration card, advance receipt)? BluePMS's page uses it for the printed set.
12. **Open folio (R4.23).** Do they check guests out on an approved open folio and charge afterwards? Who approves, and how often does it happen?
13. **Accounting (R4.12).** How do they get figures into Tally or Zoho today: which report, how often, who does it?
14. **Tax & Compliance (R4.22, R5.5).** They never saw this module. Do they use GSTIN lookup, the GST registers or 3B working papers? How do they correct a rejected e-invoice today?
15. **Guest Experience.** They never saw this module either. Do they use reviews, guest messaging, service tickets, guest pages or the website builder in BluePMS? Their Communications and booking-engine ticks were blank, so we plan to build none of it for the pilot unless they say otherwise.
16. **Front-office features the checklist never listed.** Do they use additional-guest capture, group reservations, door lock, Wi-Fi, ID scanning, guest and facility charge bills, early-departure penalties, or a waitlist status?
17. **Line transfer to another room (R4.29, fork F1).** Do they move charges from one room's bill to another's? How often, and for what?
18. **Planning range (R4.28, fork F2).** How far ahead does the desk read the room grid each day? How many rooms does the hotel have?
19. **Several guests in a room (R6.2, R4.15, fork F4).** When two foreign nationals share a room, do they record each one today? Do they record ID for every adult?
20. **In-house changes (R4.24, R4.15).** What do they change after check-in: dates, room type, plan, party size? Do they use the early check-in, late checkout and airport transfer flags?
21. **Advances (R4.25, R4.18).** Do they take advances at booking, at check-in, or both? Do guests get a numbered receipt, and do they split one advance across methods?
22. **Housekeeping detail (R4.11, R4.30, R4.31).** Which departments receive guest requests? Are amenities always complimentary, or sometimes charged? Should completing a maintenance task release the room by itself? Do they use checkout-time alerts?
23. **OTA payouts (R4.3).** Do they reconcile OTA settlements in BluePMS, in accounts, or not at all?

These answers are the first step of the [pilot go-live checklist](../roadmap.md#pilot-go-live--not-coding-slices) — ask them now, not when Track P starts. Questions for the tax advisor are on that same checklist.

## Coverage — ticked item to slice

Each row must end on `[x]` slices before Track P is done. *Shipped* means live today; the slices after it close what is missing. Corrected 2026-10-31 against the [inventory comparison](2026-10-31-bluepms-inventory-vs-slices.md), which has the gap behind each row. **F1–F4** are the [fork decisions](../roadmap.md#fork-decisions), which Q10, Q17, Q18 and Q19 help apply.

### 01 Front Office

| Ticked item | Covered by |
|---|---|
| Guest lookup (search / create profile, ID documents) | Shipped exact-match search and create; **R4.15** documents and preview on selecting a match |
| New reservation (dates, guests, room type, room number, meal/rate plan) | Shipped `/book` without a room number; **R1.4**; room at booking **R4.26**; meal plans **R3.3** |
| Day-wise rate overrides | **R4.20**; package and plan rows with **R4.13** |
| Add-ons (stay, arrival/departure, weekends, chosen dates) | **R1.5**, **R1.4**; scheduling, including chosen dates, **R4.13** |
| Advance / deposit payments in the booking | Collection and numbered receipt **R4.25**; gate **R1.20**; tenders **R4.18** |
| Proforma invoices | **R4.13** |
| Edit reservation and guest preferences | Before arrival **R1.15**; after check-in **R4.24**; preferences **R4.15** |
| Check-in from the reservation screen | Shipped check-in; **R1.15** stay card |
| Registration cards (print / reprint, templates) | Shipped view; **R2.4**; templates **R4.13** |
| Package templates and package posting rules | **R3.2**, **R3.3**, **R4.13** |
| Room operations grid / tape | Shipped `/board` (14-day cap); **R1.3**; occupancy row and date states **R4.28**; range **F2** |
| Live room view by status | **R4.27** (`/board` is the tape, not this view) |
| Front-office billing and open folio | Shipped folio; **R1.2** directory; open folio **R4.23**; draft bill and reversals **R4.29**; line transfer to another room **F1** |
| GST / e-invoice QR on invoices | **R3.6**, **R1.12**; buyer details and HSN/SAC **R4.22**; **R5.5** |
| Guest documents | Meaning unconfirmed (Q11): printed set **R4.13**, **R4.25**; ID scans **R4.15** |
| Night audit (customisable) | Shipped audit; **R1.10** configurable checks |
| Manager settings | Manager Report and MIS settings **R4.32**. General settings (**R1.11**, **R1.12**, **R1.17**, **R3.1**) do not cover this tick |
| Front-office reports | **R4.14**; list **F3** |

### 02 Housekeeping

| Ticked item | Covered by |
|---|---|
| Supervisor dashboard | Shipped HK board and priority queue; **R1.9**; requests **R4.11**; dashboard **R4.31** |
| Priority / floor-by-floor workbench | Priority **R1.9**; floor comparison and room search **R4.31** |
| Room status (dirty / inspected / ready, with comments) | Shipped statuses, no comments; comments and history **R4.30** |
| Guest requests against a room | **R4.11** |
| Task assignment to attendants | Shipped one assignee per room per day; task record and lifecycle **R4.30** |
| Maintenance / out-of-order blocks | Shipped OOO; **R1.9** maintenance module; block detail and release history **R4.30** |
| Lost and found | **R4.11** |
| Missing / damaged items | **R4.11** |
| Guest audit (front office vs housekeeping counts) | **R4.11** |
| Inspection checklists and room scores | **R4.11** |
| Cleaning stages and linen log | **R4.11** on the **R4.30** task record |
| Minibar pickup to guest folio and stock | **R4.11** on the **R1.9** operational list |
| Amenity delivery | **R4.11** |
| Housekeeping reports | **R4.14**; list **F3** |

### 03 Point of Sale

All twelve items are met by the **third-party POS vendor** plus the **R4.21** connector on **R4.9**. No vendor is chosen yet, so all twelve are unproven until one passes R4.21's check, which now lists what the page implies. The *billing* row is only partly covered: nothing yet says who issues an IRN for a B2B check paid at the outlet. HospAI's side of POS reports — room charges and outlet day-close totals — is **R4.14**. If no vendor meets R4.21's requirements, the parked built-in POS (**R4.17**) is the fallback.

### 06 Channel Distribution

All seven items are met by the **third-party channel manager** plus the **R4.3** connector on **R4.5**: ARI publishing, mapping, booking receipt, the unmapped-booking queue and commission per booking are the connector's side; OTA connections are the channel manager's. Distribution reports **R4.14** (list **F3**). Matching OTA payouts is not covered: BluePMS's page mentions settlement review, so Q23 decides whether it joins R4.3. This module's page has no inventory, so the check is shallow.

### 12 CRM, 14 AI Copilot, accounting

| Ticked item | Covered by |
|---|---|
| Guest 360 (identity, stays, preferences, consent) | Shipped profile and stay history; **R1.8**; **R4.15** |
| AI Copilot — all five items | **R4.16**; answers on reports need **R4.14** and **R4.32** |
| Accounting software integration (Tally, Zoho Books) | **R4.12**; no BluePMS page to check against, so Q13 sets the format |
