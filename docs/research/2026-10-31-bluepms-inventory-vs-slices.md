# BluePMS inventories vs roadmap slices: the 58 ticked items

**Read:** 2026-10-31, repo HEAD `0273fe8`. **Purpose:** the evidence behind the 2026-10-31 widening of [`docs/roadmap.md`](../roadmap.md) Track P. It records what the client ticked, what BluePMS says that tick contains, and what HospAI has. Decisions live in the roadmap and in [`ARCHITECTURE.md` §16.6](../../ARCHITECTURE.md#166-bluepms-parity-hubs--production-scope-2026-09-12).

**Evidence limits**

- BluePMS text is **marketing material, not verified in a live system**. It is paraphrased here ([inventories](2026-09-12-bluepms-modules.md#module-page-inventories-read-2026-10-31)). It says what a feature probably means, not what this client has switched on.
- Code claims come from reading the code and migrations. Nothing was run, so anything marked "not run" is unproven at runtime.
- "Covered" means a slice names the item. Most of those slices are still open, so it does not mean built.

## Result

| Status | Count | Meaning |
|---|---|---|
| Covered | 27 | A slice names it. 11 of these are POS items that rest on a vendor nobody has chosen. |
| Partly covered | 29 | A slice exists, but its scope falls short of the page, or a "Shipped" claim was overstated. |
| Missing | 2 | **Manager settings** and **Live room view**: on 2026-10-31 no slice did what the page describes. |

These counts describe the roadmap **before** the 2026-10-31 widening. The "Slice now" lines below show where each gap went.

**Why the serial queue would not have caught these:** R1.9 and R1.4 are already `[x]`, and the coverage table marked several rows "Shipped". Nothing reopens them unless someone decides to.

## Pages used

| Page | What it has |
|---|---|
| [Front Office](https://www.bluepms.com/modules/front-office/) | Full inventory, 163 points (counted) |
| [Housekeeping](https://www.bluepms.com/modules/housekeeping/) | Full inventory, 40 points (counted) |
| [Point of Sales](https://www.bluepms.com/modules/point-of-sales/) | Full inventory, 26 points (counted) |
| [Tax & Compliance](https://www.bluepms.com/modules/tax-compliance/) | Full inventory, 61 points (counted). Not on the client's checklist |
| [Guest Experience](https://www.bluepms.com/modules/guest-experience/) | Full inventory, 79 points (counted). Not on the client's checklist |
| [CRM](https://www.bluepms.com/modules/crm/) | Video chapters and report groups only, **no inventory** |
| [Channel Distribution](https://www.bluepms.com/modules/channel-distribution/) | Six chapter titles and report bullets only, **no inventory** |
| [AI Copilot Home](https://www.bluepms.com/modules/ai-copilot-home/) | Six chapter titles and report bullets only, **no inventory** |

**No module page exists** for accounting software integration. The word "accounting" and the names Tally and Zoho appear on none of these pages. [Integrations](https://www.bluepms.com/integrations/) mentions only a general finance handoff.

## What the spot-check changed

The first draft of this report was checked claim by claim against the repo and the pages. All counts hold (27 + 29 + 2 = 58). These claims did not hold as written and are corrected below.

| Claim in the first draft | Finding |
|---|---|
| No slice captures the buyer's GST details | **Overstated.** R5.5 and `ARCHITECTURE.md` §7.9 require the guest's or company's GSTIN on the invoice. The gap is that nothing says **where it is captured**, and that the fields beyond GSTIN are absent. |
| R4.14 blocks the Manager Report | **Overstated.** R4.14 and §16.6 say nothing goes outside the list "without a new slice", so a new slice is the allowed path. The fork is whether the list opens for the other reports. |
| `/board` has no dirty state | **Wrong in part.** The tape's room column shows the current status word (`TapeChartScreen.tsx:485`). It has no status per date, no billed state and no occupancy row. Live room view is still Missing: no slice groups rooms by condition, with cards and actions. |
| The report named no lock on the live room view | **Missed.** §16.6 and the roadmap map said "`RoomOpsLiveView` is covered by `/board` — no second grid". Those lines are corrected with R4.27. It is a status view, not a second grid; grid depth widens `/board` in R4.28. |
| Whether the server allows posting after checkout is untested | **Read, not run.** `tryAddFolioLine` checks only that the reservation exists and that the window is `OPEN` (`property-do.ts:15983`, `:15613`), and checkout leaves the window open unless `pms.folio.close_window_on_check_out` is on and the balance is zero (`:10210`). So a charge can reach a checked-out stay with no approval. |
| Open folio collides with nothing | **Missed.** §7.3 rule 3 says late charges on a checked-out, **closed** window go to the exception path. An approved hold must keep the window open; it cannot reopen a closed one quietly. |
| No task record, type, status or lifecycle | **True of housekeeping only.** The R1.9 maintenance module has tickets with types, checklists and a lifecycle. Housekeeping work is still one assignee per room per date (`UNIQUE (room_id, business_date)`). |
| No record of a status change | **Close.** No comment and no queryable history. `room.status_changed` does reach the outbox with from and to status, but nothing reads it back. |
| The housekeeping board shows no occupancy | **True of the board.** The R1.9 priority queue does read arrivals and in-house stays to score rooms (`read-priorities.ts`). |
| Draft R1.10 spec leaves the options out | **Stale.** The [R1.10 spec](../superpowers/specs/2026-10-30-night-audit-operator-job-design.md) builds configurable checks, and R1.10 shipped on 2026-10-31. |

**New findings the first draft did not have**

- **Tax on plans and packages.** The Tax & Compliance page has composite-supply profiles and room-and-plan rules deciding which plan types join the room amount for the GST slab. HospAI's R4.13 locks that a package "splits into posting lines that each carry their own tax", and R3.6 resolves the slab per night on the room value. Both may be right or wrong for India; the advisor has to say. This reaches R3.6, which runs before Track P.
- **Buyer details and the invoice snapshot.** The invoice engine spec keeps plaintext out of the snapshot (`guestRef` and `piiKeyId` only, [spec](../superpowers/specs/2026-08-15-invoice-generation-engine-design.md)). A tax invoice must show the buyer's legal name and address, and must be kept. Where those fields live, and how they survive erasure, is part of R4.22.
- **Reports the R1.10 spec sends to R4.14.** That spec routes the revenue report, daily statistics and end-of-day control report to R4.14, whose list names none of them. Part of fork F3.
- **Amenity delivery.** R4.11 said "posted through the folio contract". The page shows a stock posting and a store reference, and the older note calls these complimentary. Corrected in R4.11; a chargeable amenity is a client question.
- **Night-audit checks with no home.** The R1.10 spec names checks that wait on later slices. Open folio had none; R4.23 now owns it. R4.25 (arrival deposits), R4.15 (ID proof, country and state) and R5.5 (tax document readiness) now say so too.

## Ranked by pilot risk

All fifteen are High risk: a daily desk, housekeeping or finance routine, or a legal duty, is affected. The order is a judgment, weighing how likely each is to stop the switch and how unlikely the queue was to catch it. POS ranks lower only because the go-live checklist already forces a vendor decision.

### 1. Manager settings: Missing

- **The page:** a group on the Manager Report and MIS. A folio-backed management report over a date range with print, PDF and Excel, and section visibility. Settings cover occupancy rules (day-use, no-show, complimentary, house-use, out-of-order, checkout day), nationality and source mapping, report rows and labels, and a formula library. Day-wise sale and expenditure belongs to the same group but draws on stores data, and the client left Inventory blank.
- **The table said:** R1.11, R1.12, R1.17 and R3.1. Those are users, logs, finance and guest defaults, which is a **different meaning**. "Manager report" appears nowhere else in the roadmap, ARCHITECTURE or specs.
- **Why it matters:** this is probably the GM's daily sheet, and the parallel run will compare against BluePMS's figures.
- **Slice now:** **R4.32**, shaped from a real sample of the client's report. Fork F3 touches it.

### 2. Open folio (bill on hold): no slice

- **The page:** its own group. Check out with an approved open folio and charge after the stay. Place a hold with reason, follow-up date, close-by date and approver. Release, extend and close it. Auto-open at end of day, auto-close at zero balance, night-audit checks, and a register report.
- **The table said:** "Shipped folio; R1.2 directory". R1.2 is a list screen. "Open folio" and "bill on hold" appeared in no slice, and the R1.10 spec says the same.
- **What exists:** a "Depart with open balance" override on checkout, and window reopen. There is no hold record, approver or follow-up. See the spot-check for posting after checkout.
- **Slice now:** **R4.23**.

### 3. GST / e-invoice QR: Partly, with a legal exposure

- **The page:** this now lives in a separate Tax & Compliance module that **was not on the client's checklist**. Registered and unregistered buyers, buyer GSTIN with lookup, legal and trade name, address, state, PIN, place of supply, and a retained buyer snapshot. HSN/SAC classification. An e-invoice queue with payload inspection, dry run, correct-and-rebuild, manual acknowledgement and IRN cancellation. IRN, acknowledgement number and date, and QR on the printed bill.
- **R5.5 has:** IRN, QR, retry, cancellation and credit notes, and it requires the buyer's GSTIN on the invoice, as does §7.9.
- **Gaps:** nothing says **where buyer details are captured**. "GSTIN" appears in no app, package, module or migration, the `invoice` table has no buyer columns, and `city_ledger_account` holds only name, credit limit and terms. **HSN/SAC appears nowhere** in the roadmap, ARCHITECTURE, specs or code. The advisor should confirm what a tax invoice must show. There was also no correct-and-rebuild or manual acknowledgement path.
- **Also:** walk-in B2B restaurant bills. R4.21 handles room-charged checks, and nothing says who gets an IRN for a B2B check paid at the outlet. The page shows buyer GST on a POS bill.
- **Slice now:** **R4.22**, a widened **R5.5**, a vendor and advisor question on **R4.21**.

### 4. Editing a stay after check-in (inside "Edit reservation"): no path

- **The page:** a separate edit-check-in flow for in-house corrections.
- **The code:** `tryModifyReservation` accepts only `inquiry`, `pending` and `confirmed` (`property-do.ts:9141`) and returns `NOT_MODIFIABLE` for `checked_in`, so **no desk command can extend an in-house guest**. `reservations.early_depart` shortens. Auto-extend is a night-audit setting, not a clerk action.
- **Conflict:** R1.19 said a type change on an in-house stay is "R1.15 modify", but modify refuses that status.
- **Slice now:** **R4.24**; R1.19 corrected.

### 5. Task assignment: table said Shipped, Partly in fact

- **The page:** tasks with date, type, room, attendant, priority, status and supervisor notes. Search, start, update, complete, review and cancel, with counters for open, overdue and so on.
- **The code:** `housekeeping_assignment` is one assignee per room per business date. There is no housekeeping task record, type, status or lifecycle.
- **Knock-on:** R4.11 cleaning stages are recorded against a task, and the guest requests also need one.
- **Slice now:** **R4.30**, ahead of R4.11.

### 6. Room status with comments: Partly

The coverage table said "confirm room comments exist". **They do not.** `updateRoomStatus` takes only `roomId` and `status`, and there is no status history table. The page has a reason and feedback when marking dirty, quality-check comments when clearing, and a recorded transaction. The checklist wording itself says "with comments", and no slice owned it. **Slice now: R4.30.**

### 7. Supervisor dashboard: Partly, table said Shipped plus R1.9

- **The page:** readiness percentage, dirty rooms, open and overdue tasks, active blocks, open requests, unclaimed items, damage cases and audit variance. Also expected arrivals and departures for prioritising, conflicts between occupancy and room status, checkout-time alerts, and one attention queue.
- **Live:** a status table with filters and a workload strip, plus the R1.9 priority queue.
- **Risk:** R4.11 scoped out "metrics dashboards", which could be read as excluding this. Sharpened to budgeting and productivity charts.
- **Slice now:** **R4.31**.

### 8. Live room view: Missing

- **The page:** rooms grouped by type and condition (available, reserved, occupied, dirty, maintenance, billed, unavailable), with summary cards and actions per room.
- **The table said:** "Shipped `/board`". `/board` is the tape: stays and OOO ranges, with the current status word beside each room. It has no billed state and no grouping by condition. The housekeeping board shows cleanliness but no occupancy. No screen combines them.
- **Slice now:** **R4.27**; §16.6 corrected.

### 9. Room operations grid: Partly, conflicts with a lock

- **The page:** a 26-day grid, plus 7, 14 and 30-day and custom ranges, with an occupancy row and colours for dirty and billed.
- **Live:** `MAX_TAPE_UI_DAYS = 14`, which AGENTS §4 requires, and audit P13 gives the reason (rooms × days of DOM, no virtualizer).
- **Slice now:** **R4.28**. The occupancy row, per-date states and filters proceed. The range is **fork F2**.

### 10. Billing depth (the rest of "Front-office billing"): Partly, conflicts with a lock

- **The page:** a draft bill with charge review. A check on posted, unposted and future tariff rows. Equal, source-based and custom splits. **Line transfer to another room.** Settlement rows. Privileged bill void and settlement cancellation with reasons, then regenerate.
- **Live:** line split, same-stay window transfer, invoice void, payment void and refund.
- **Lock:** AGENTS rejects transfer to another reservation (`transfer_cross_reservation`).
- **Slice now:** **R4.29** for the draft bill and settlement-cancel path. The line transfer is **fork F1**.

### 11. Front-office reports: Partly

- **Checklist wording:** ends in "etc.", so it is open-ended. R4.14 is locked to six reports, print and CSV.
- **Named on the page but not in R4.14:** Cashier Audit, Corrections and Canceled Payment, Deposit Activity and Deposit Ledger, Detailed Folio, Open Folio register, Tax Report, Trial Balance and Guest Trial Balance. Also Detailed and Month-wise Availability, Night Audit Revenue, Daily Statistics, and End of Day Control. Output includes Excel and PDF, and a report builder (R4.14 scopes it out).
- **Note:** the 247 count should not be the target. The client needs to name the ones they run.
- **Slice now:** **R4.14**, **fork F3**.

### 12. Advance / deposit: Partly

- **The page:** take an advance at booking, later against the reservation, and at check-in, plus a standalone page. Several payment rows, method, transaction ID and notes. Estimated bill less advances. A **numbered, printable receipt**, and a deposit balance check at audit.
- **R1.20:** only gates on `require_prepayment` using the simulate path. No slice owned the receipt or the collection flow. `BookingScreen` has no payment step. The cash path checks only that the reservation exists, so a pre-arrival record looks possible (read, not run).
- **R4.18 (tenders) is Blocked on the client:** the page's guest-charge payment already lists cash, card, UPI, room posting, split and debtor account, which partly answers checklist Q4.
- **Slice now:** **R4.25**.

### 13. New reservation: Partly, table said Shipped

- **Gap:** the checklist names "room number", and booking has **no room field**. `tryCreateReservation` takes no `roomId`, so assignment happens later from arrivals. The page has an availability-checked room picker during booking. `tryAssignRoom` already accepts `pending` and `confirmed`, so the picker needs no new command.
- **Also on the page:** waitlisted status, and booker, company and guest type. Meal plans wait on R3.3.
- **Slice now:** **R4.26**.

### 14. POS: 12 items resting on an unchosen vendor

Covered on paper by R4.21, but no vendor is chosen. See the POS table for what was added to the vendor check.

### 15. Additional guests: a lock that conflicts with a legal slice

This row is not a tick of its own.

- **The page:** capture additional guests, with duplicate checks and configurable requirements, and flag them in desk readiness checks.
- **The lock:** party size is `adults` / `children`, with no second profile (AGENTS §4, holes sweep decision 14).
- **The conflict:** R6.2 records "each foreign national" but builds a per-stay record "from the profile's documents". Two foreign nationals sharing a room leave one without a record. This holds whatever BluePMS does.
- **Slice now:** **fork F4** on R6.2 and R4.15.

## Every ticked item

Risk: H / M / L. "T" means the coverage table claimed it was shipped. "Slice" is the state on 2026-10-31 after the widening.

### 01 Front Office (18): 2 covered, 14 partly, 2 missing

Source for all rows: [Front Office](https://www.bluepms.com/modules/front-office/). The group named is the section on that page.

| Item | Status | Risk | Slice | Gap (group on the page) |
|---|---|---|---|---|
| Guest lookup | Partly | M | Shipped, R4.15 | Live search is exact match on an equality blind index. The page shows matching profiles with photo and ID preview. OCR is out of R4.15 and is not in the tick's wording. (Command Center and Guest Intake) |
| New reservation | Partly | H (T) | Shipped, R1.4, R3.3, **R4.26** | No room at booking: rank 13. (Reservations, Rates And Packages) |
| Day-wise rate overrides | Partly | L | R4.20 | Covers room nights. The page also has editable plan and package rows, and a show/hide rate toggle. |
| Add-ons | Partly | M | R1.5, R1.4, R4.13 | R4.13 listed stay, arrival, departure, weekends and single days. It omitted **chosen dates**, which the checklist names. Added. |
| Advance / deposit | Partly | H | R1.20, R4.18, **R4.25** | Rank 12. (Advance Collection, Receipts And Deposits) |
| Proforma invoices | Partly | M | R4.13 | R4.13 was reservation only. The page adds check-in-based proforma, tax summary and warnings, advance and balance, print settings, PDF and email. Email is R5.2, after the pilot. (Proforma Estimates And Guest Documents) |
| Edit reservation, preferences | Partly | H | R1.15, **R4.24**, R4.15 | No in-house edit: rank 4. Preferences differ: the page has early check-in, late checkout, airport transfer and VIP toggles, and R4.15 had room, bedding, dietary and accessibility. (Check-In, Stay And Checkout) |
| Check-in from reservation | Covered | L | Shipped, R1.15 | R1.15's list never named the check-in action. Named. |
| Registration cards | Partly | M | Shipped, R2.4, R4.13 | Templates are in R4.13. Reprint from the in-house list and generating from a reservation as well as a check-in added. |
| Package templates and rules | Covered | M | R4.13, R3.2, R3.3 | Matches closely. The page also applies packages at check-in. Risk comes from depending on two open slices, and from the tax question above. |
| Room operations grid | Partly | H (T) | Shipped, R1.3, **R4.28** | Rank 9. (Room Operations And Availability) |
| Live room view | **Missing** | H (T) | **R4.27** | Rank 8. (Room Operations And Availability) |
| Billing and open folio | Partly | H (T) | Shipped, R1.2, **R4.23**, **R4.29** | Rank 2 and rank 10. (FO Billing And Cashiering; Bill On Hold / Open Folio; Reversals, Cancellations And Audit Controls) |
| GST / e-invoice QR | Partly | H | R3.6, R1.12, **R4.22**, R5.5 | Rank 3. Source: [Tax & Compliance](https://www.bluepms.com/modules/tax-compliance/). |
| Guest documents | Partly | M | R4.13, R4.25, R4.15 | **Likely a different meaning.** The page's "guest documents" section is about guest-facing proforma and registration-card templates, with action buttons for those and the advance receipt. The table mapped it to ID scans. Ask the client. |
| Night audit (customisable) | Partly | H | R1.10 | Shipped 2026-10-31: on/off, Fail/Warn/Info, preview and close log inside PRE_CHECK. Many listed checks belong to modules the client left blank (transport, spa, banquet, purchase). |
| Manager settings | **Missing** | H | **R4.32** | Rank 1. (Manager Reporting And MIS Settings) |
| Front-office reports | Partly | H | R4.14 | Rank 11. (Reports Library, Masters And Integrations) |

### 02 Housekeeping (14): 3 covered, 11 partly

Source for all rows: [Housekeeping](https://www.bluepms.com/modules/housekeeping/).

| Item | Status | Risk | Slice | Gap (group on the page) |
|---|---|---|---|---|
| Supervisor dashboard | Partly | H (T) | Shipped, R1.9, R4.11, **R4.31** | Rank 7. (Command Center And Room Readiness) |
| Priority / floor-by-floor | Partly | M | R1.9 `[x]`, **R4.31** | Priority shipped with a floor filter and column. No floor-level readiness comparison and no integrated room search. The checklist says "floor-by-floor". |
| Room status with comments | Partly | H (T) | Shipped, R1.9, **R4.30** | Rank 6. (Room Status, Turnaround And Checkout) |
| Guest requests | Partly | M | R4.11 | R4.11 assigned to an attendant. The page routes by responsible department with type, ownership, search and resolution. (Guest Service And Asset Exceptions) |
| Task assignment | Partly | H (T) | Shipped, **R4.30** | Rank 5. (Tasks, Attendants And Maintenance) |
| Maintenance / OOO blocks | Partly | M | Shipped, R1.9, **R4.30** | `room_ooo` has dates and an optional reason. The page has block type, start and end **times**, inspection notes, a required release reason and release history. Full release **deletes** the OOO row (`property-do.ts:7092`), though the ticket keeps a timestamp. Auto-release on task completion is deliberately not built (R1.9 spec decision 10). |
| Lost and found | Covered | L | R4.11 | Custody lifecycle matches. Page's field list added. |
| Missing / damaged | Covered | L | R4.11 | Returned-item status and inspection detail added. |
| Guest audit | Partly | L | R4.11 | Comparison and variance reason were there. The page adds audit sessions, count adjustment and saved evidence per business date, by floor and room type. Added. |
| Inspections and scores | Covered | L | R4.11 | Template activate/deactivate, defects and remarks added. |
| Cleaning stages, linen log | Partly | M | R4.11, **R4.30** | Stages (started, paused, resumed, inspected, completed, released) hang off a task record that did not exist. The page's linen movements are issue, return, laundry, discard and adjust, by room and attendant. R1.9 movements are receive, issue and count, with no room. |
| Minibar to folio and stock | Partly | M | R4.11 | Folio and stock are named. Issue-to-room stock is still R1.9 leftover 7. The page's POS-bill link is deliberately dropped. Reconciliation view added. |
| Amenity delivery | Partly | M | R4.11 | See the new findings. Added: amenity master, rule templates, expected vs actual with exception reason, supervisor confirmation, dispatch ledger. (Amenity Management And Dispatch) |
| Housekeeping reports | Partly | M | R4.14 | R4.14 has room status, workload, inspection scores, lost and found, damage, linen. On the page but not in R4.14: blocks, status-change history, guest audit, requests, minibar, amenities, daily control. The page says six of its own 36 entries are still pending data mapping. Fork F3. |

### 03 Point of Sale (12): 11 covered by vendor, 1 partly

Source for all rows: [Point of Sales](https://www.bluepms.com/modules/point-of-sales/). All rest on the vendor plus R4.21 and R4.9. **Vendor not chosen and no candidate checked.** The last column was added to the R4.21 vendor check.

| Item | Status | Vendor check |
|---|---|---|
| Table board by outlet | Covered | Occupied, vacant, reserved, active and billed states |
| Outlet reservations, waitlist | Covered | Waitlist as well as reservations |
| Order entry | Covered | Order by server and type, modifiers, in-house guest via R4.21 room lookup |
| KOT | Covered | Non-chargeable KOT with reason, BOT, kitchen routing, reprint |
| KDS | Covered | Delay alert threshold, move order between tables, guests or outlets |
| Billing, discounts, split | **Partly** | Rank 3: B2B e-invoice on a check paid at the outlet. Also bill on hold, pending bills, service charge and round-off |
| Settlement | Covered | Tips, split methods, print or email. Room charge via R4.21 |
| Cash and clock-in/out | Covered | Paid-in, paid-out, sessions, breaks, staff allocation |
| Menu waste | Covered | Reasons and cost. The stock link is out, since F&B and Inventory were left blank |
| Promotions | Covered | Free-product rules by day and hour, usage limits |
| Outlet forecasting | Covered | Expected sales, staffing and preparation. R4.21's optional feed helps |
| POS reports | Covered | HospAI side is in R4.14. The rest is the vendor's |

### 06 Channel Distribution (7): 5 covered, 2 partly

Source: [Channel Distribution](https://www.bluepms.com/modules/channel-distribution/), which has **no feature inventory**, so this check is shallow. R4.3 is detailed and nothing contradicts it.

| Item | Status | Risk | Gap |
|---|---|---|---|
| Channel partners / systems | Covered | M | Depends on choosing a channel manager |
| ARI publishing | Covered | M | The per-occupancy price fork is still open |
| Rate and room mapping | Covered | L | None visible |
| Incoming booking events | Covered | L | None visible |
| Unmapped / exception queue | Covered | L | None visible |
| Commission and settlements | Partly | M | R4.3 shows the commission the manager reports. The page mentions settlement review and reconciliation, and nothing matches OTA payouts. Client question added |
| Distribution reports | Partly | L | R4.14 has bookings, revenue and commission by channel. The page also lists ARI status, event activity, mapping health and partner performance. Some is on the R4.3 status view. Fork F3 |

### 12 CRM (1): covered

Source: [CRM](https://www.bluepms.com/modules/crm/), chapters only.

| Item | Status | Risk | Gap |
|---|---|---|---|
| Guest 360 | Covered | M | Identity, stays, preferences and consent are in shipped work, R1.8 and R4.15. The page's record also shows contact health, complaints, relationship value and next follow-up, which are outside the tick's wording. Relationship value is locked to the warehouse |

### 14 AI Copilot (5): 4 covered, 1 partly

Source: [AI Copilot Home](https://www.bluepms.com/modules/ai-copilot-home/), **titles and report bullets only**.

| Item | Status | Risk | Gap |
|---|---|---|---|
| Ask operational questions | Covered | L | The page shows a home with suggested questions and shortcuts. Named in R4.16 |
| Answers with source context | Covered | L | None visible |
| Reports and summaries | Partly | M | R4.16 tools are existing read routes. Answers on reports depend on R4.14 and R4.32, so R4.16 now follows them. The page also mentions report discovery and explaining exceptions |
| Suggested next actions | Covered | L | None visible |
| Permission-aware review | Covered | L | None visible |

### Accounting (1): covered

| Item | Status | Risk | Gap |
|---|---|---|---|
| Tally / Zoho | Covered | M | R4.12. **No BluePMS page to check against.** The client's current export method was unknown, and the checklist had no open question for it. Added |

## Fork decisions

Four findings collide with existing locks. The user accepted the recommendations on 2026-10-31; the [roadmap](../roadmap.md#fork-decisions) holds the full text.

| Fork | Collision | Decision | Slices |
|---|---|---|---|
| **F1** | Line transfer to another room vs `transfer_cross_reservation` | Lock holds unless Q17 shows the desk really moves lines; then one named command | R4.29 |
| **F2** | A 26-day grid vs the 14-day tape cap | Cap holds unless Q18 shows a need; then 30, after measuring | R4.28 |
| **F3** | R4.14's closed report list vs the open "etc." in the tick | Rule stays; list rewritten once, with the three R1.10 reports and what Q10 names | R4.14, R4.32 |
| **F4** | Party-size-only guests vs R6.2's per-person Form C | Party size stays; a narrow Form C person record per foreign national | R6.2, R4.15 |

The report's fifth question, whether rows marked T and the R1.9 floor view reopen shipped slices or get new ones, is settled by the 2026-10-31 instruction: new Track P slices. No `[x]` box is reopened.

## Questions the pages can't answer

These are recorded as the [open questions in the checklist research](2026-10-27-pilot-client-checklist.md#open-questions-for-the-client), with the slice each one unblocks.
