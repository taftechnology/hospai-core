# BluePMS — modules and features

**Compiled:** 2026-09-12 · **Purpose:** a reference for what BluePMS offers. What HospAI builds is decided in [`ARCHITECTURE.md` §16.6](../../ARCHITECTURE.md#166-bluepms-parity-hubs--production-scope-2026-09-12); this file only describes BluePMS.

## Sources

- **Module list, feature summaries and report counts:** <https://www.bluepms.com/modules/>, read 2026-09-12.
- **Feature detail:** the 370 demo-video chapter titles and descriptions published at `bluepms.com/product-videos/<module>/`, compiled in `hospai-pms-prototype/docs/bluepms/bluepms-chapters-complete-2026-09-08.html`.
- **Not covered:** the feature inventories on the individual `bluepms.com/modules/<module>/` pages, except where noted. Read those before scoping a feature; they go well beyond this summary (found 2026-10-30).

## Read this first

- Everything below restates BluePMS's own marketing and demo material. None of it has been checked in a live system or a trial.
- Four modules — **Channel Distribution, Communications, AI Copilot Home and Hostel** — have a workflow guide but no demo video, and their chapters publish titles only. Their entries describe only what the titles say.
- A feature not listed here may still exist. The modules page does not mention a booking engine, embedded payments, multi-property management, accounting integration or a guest app — that is absence from the page, not proof of absence from the product.
- Report counts are as published and cover 12 of the first 17 modules. The site now lists **19 modules**: Tax & Compliance and Guest Experience were added after this file was first compiled, and neither was on the client's checklist.
- The chapter summaries below stop short of what each module page claims. For the modules that matter to the pilot, read [Module page inventories](#module-page-inventories-read-2026-10-31) at the end of this file.
- Several features point at India and the Gulf: GST and e-invoice QR on invoices, GST purchase tax, Indian payroll statutory outputs (PF, ESI, Professional Tax, Labour Welfare Fund, TDS, Form 16), Indian identity and bank fields (PAN, Aadhaar, UAN, IFSC), and WPS salary-transfer reconciliation.

## At a glance

| # | Module | Demo | Chapters | Published reports | HospAI decision (§16.6) |
|---|---|---|---|---|---|
| 01 | Front Office | Video | 71 | 247 | Core |
| 02 | Housekeeping | Video | 35 | 36 | Core |
| 03 | Point of Sales | Video | 33 | 182 | Integrate through a PMS connector (R4.21) |
| 04 | Food and Beverages | Video | 22 | 55 | Integrate |
| 05 | Banquet & Events | Video | 23 | 36 | Add-on, lean |
| 06 | Channel Distribution | Guide only | 6 | — | Integrate through a channel manager connector (R4.3) |
| 07 | Forecast Intelligence | Video | 12 | — | Add-on |
| 08 | Inventory | Video | 10 | 61 | Integrate |
| 09 | Purchase | Video | 22 | 60 | Integrate |
| 10 | SPA | Video | 8 | 71 | Integrate |
| 11 | Accounts Receivable | Video | 17 | 66 | Core |
| 12 | CRM | Video | 23 | 127 | Core (guest); integrate (sales pipeline) |
| 13 | Communications | Guide only | 6 | — | Core |
| 14 | AI - Copilot Home | Guide only | 6 | — | Core, extended |
| 15 | Transport | Video | 26 | 21 | Avoid |
| 16 | Hostel | Guide only | 6 | — | Avoid |
| 17 | Payroll & HR | Video | 44 | 47 | Integrate |
| 18 | Tax & Compliance | Guide | not counted | see inventory | Core (R3.6, R4.22, R5.5) |
| 19 | Guest Experience | Guide | not counted | not counted | Undecided: not asked of the client |

**Total for the first seventeen rows:** 370 chapters; just over 1,000 published reports.

---

## 01 · Front Office

Reservations through check-in, room operations and reports, from one front-desk workflow.

- **Guest lookup** — search an existing profile or create a guest; matches show photo and ID documents, which carry into the booking.
- **Reservation entry** — dates, guest count, room type, a specific room number, and a meal or rate plan whose inclusions follow the booking.
- **Day-wise rates** — override the tariff for individual nights; show or hide rate detail while booking.
- **Add-on scheduling** — sell add-ons for the full stay, arrival or departure day, weekends, a single day, or chosen dates.
- **Advance payments** — collect a deposit inside the reservation flow.
- **Proforma invoices** — generate one from the booking, with switchable templates.
- **Edits and preferences** — reopen a reservation and record guest requests, such as a top-floor room.
- **Check-in** — from the same reservation screen rather than a separate flow.
- **Registration cards** — generate, print or reprint from the in-house list; switch between card templates.
- **Package templates** — predefined stays: room type, plan, number of nights, fixed price and included add-ons.
- **Package posting rules** — split the price across room, plan and add-ons, and post it every night, on arrival, on a set night, or before departure during night audit.
- **Package reservations** — apply a package and let the checkout date, room defaults and add-ons fill in.
- **Room operations grid** — a 26-day grid of availability, reservations, occupancy and maintenance; reserve or walk in from an empty room.
- **Live room view** — rooms by condition (available, occupied, billed, dirty, maintenance) with date-range, room-type and status filters and occupancy statistics.
- **Reports** — a catalogue grouped by arrivals, departures, in-house, reservations, groups, forecast, night audit, cashier, financial, profiles and statistics, plus a Dynamic Report Builder for custom reports.
- **Also listed on the modules page:** front-office billing, open folio, GST and e-invoice QR, guest documents, availability reports, customisable night audit, manager settings.
- **Customisable night audit** (added 2026-10-31 from the Custom Night Audit section of <https://www.bluepms.com/modules/front-office/>) — a configuration page with each check on or off and handled as Fail, Warn or Info; a preview before the business date closes; a close once blockers are cleared; and a log of past closes. Checks are grouped as pre-close, post-roll and mandatory.

## 02 · Housekeeping

Room readiness, supervisor control, and the chargeable side of room operations.

- **Supervisor dashboard** — clean and dirty rooms, tasks, blocks, requests, guest audit, lost and found, and damage cases, with a launcher into each workflow.
- **Priority workbench** — what needs attention first, with readiness compared floor by floor.
- **Room status changes** — mark a room dirty with a reason; clear it after a quality check with comments.
- **Guest requests** — log a request against a room, route it, and find it again on the grid.
- **Tasks** — assign work to an attendant with date, type and notes; start, complete and review it.
- **Maintenance blocks** — block a room with type, start and end time, reason and inspection notes; release it with a closeout note.
- **Lost and found** — a custody record from discovery through handover to closure; closed items stay in history.
- **Missing and damaged items** — linen, amenity and room-damage cases tracked until resolved.
- **Guest audit** — compare front-office occupancy with housekeeping's room counts and record variance reasons.
- **Inspections** — checklist templates with weighted items and required checks that produce a room score.
- **Cleaning stages and linen** — record cleaning progress by stage and attendant; log linen issues.
- **Minibar** — record a pickup; posting creates a POS bill, reduces stock and charges the guest folio.
- **Amenity delivery** — record complimentary supplies with supervisor confirmation and stock posting.
- **Reports** — room status, tasks, blocks, audit, requests, lost and damaged, quality, linen, minibar and amenities.

## 03 · Point of Sales

A full restaurant and outlet POS.

- **Table board** — tables by outlet, colour-coded as in use, billed or available.
- **Reservations and waitlist** — outlet bookings, reservation limits and table layouts.
- **Order entry** — products filtered by group and kitchen; an in-house guest or outside customer; covers; preparation instructions.
- **Kitchen order tickets (KOT)** — chargeable or non-chargeable (with a reason), routed to the kitchen that makes the item.
- **Kitchen display (KDS)** — orders on screen, turning red past a configurable delay; move orders between tables and reprint tickets.
- **Billing** — generate bills, apply discounts, rename items and split checks.
- **Settlement** — tips, full or split payment across methods, bill templates, and print, email or send.
- **Cash and staff** — cash movements, staff scheduling, and clock-in and clock-out for labour efficiency.
- **Menu waste** — track waste and link sales to F&B costing for automatic stock depletion.
- **Promotions** — coupon codes, time-based happy hours, and buy-one-get-one offers applied automatically at billing.
- **Forecasting** — demand forecasting for outlets.
- **Reports** — by workstation, summary, daily detail, performance, comparison, item sales, kitchen and labour, plus dynamic reports.

## 04 · Food and Beverages

Recipe costing and stock depletion behind the POS.

- **Recipe costing** — recipe versions with ingredient rate, unit, quantity, yield and wastage, rolling up to cost, cost percentage and margin.
- **Cost methods** — weighted average, last receipt price or standard cost, with a preview before committing.
- **Menu links** — tie each POS item to a recipe with a consumption ratio, and flag items with no link.
- **Automatic depletion** — post ingredient use when a kitchen order is saved, by order type (dine-in, takeaway, delivery, room service), with exceptions for missing recipes or stock, negative-stock rules and retries.
- **Manual depletion** — post and reverse against a source document.
- **Production batches** — record prepared output against the active recipe version.
- **Stock risk** — projected stock, average daily use and run-out date per ingredient.
- **Audit and reports** — an audit trail of costing changes; consumption, variance, waste, yield and valuation reports; a menu engineering matrix.

## 05 · Banquet & Events

Selling, planning and billing events and functions.

- **Operations dashboard** — total and upcoming events, today's functions, month revenue, confirmed bookings, and a filterable event register.
- **Spaces and packages** — function spaces with capacity; packages with price, minimum covers and inclusions.
- **Event wizard** — dates, status, lead source, space, package, expected and guaranteed covers, contact and billing account.
- **Functions** — sessions with time, space and covers; menus attached at a per-cover rate; resources such as AV, furniture, décor and staff.
- **Deposits** — receipts with payment mode, reference and outstanding balance.
- **Banquet event order (BEO)** — the handoff document for setup, kitchen and service; printable.
- **Billing** — an invoice summary, and conversion of event charges to a room folio or an AR company account.
- **Sales** — leads and follow-up tasks.
- **Function diary** — a board of spaces against time.
- **Utilities** — copy an event to a new date; move it to another date or space.
- **Reports** — including revenue by space, with chart settings.

## 06 · Channel Distribution

*Workflow guide only — chapter titles, no descriptions.*

- Channel systems and partners
- Rate and availability (ARI) publishing
- Rate and room mapping
- Booking events
- Unmapped-booking queue and exceptions
- Commission and settlements
- **Also listed on the modules page:** distribution operations; reporting included.

## 07 · Forecast Intelligence

Revenue management: forecasts, competitor rates and pricing recommendations.

- **Command centre** — entry point to the forecast feed, rate shopper, competitors, comp sets, automation and reports.
- **Revenue cockpit** — forecast rooms and revenue, budget gap, occupancy, demand by source, comp-set price position and alerts.
- **Automation** — recommendations built from forecast, budget, pickup, wash and comp-set signals, run in approval-required or auto-apply mode, then approved, rejected or queued for publishing.
- **Forecast data feed** — dated batches with version and scenario; a row editor for rooms on the books, forecast, revenue, budget, cancellations, no-shows, wash and overbooking; CSV import and export; approve and lock.
- **Competitors and comp sets** — competitor hotels with star rating, distance, segment and weighting, grouped into reusable comp sets.
- **Manual rate shopper** — competitor rate observations entered by hand in batches, approved, and summarised as minimum, average and maximum.
- **Reports** — occupancy, market, rate category, packages, rooms on the books, history and forecast.

## 08 · Inventory

Multi-store stock control.

- **Command centre** — business-date stock value, pending requisitions, receipts, issues and stock risk.
- **Receipts** — goods received from a supplier into a store, with item, quantity and rate.
- **Requisitions and approval** — requests between stores or departments with a cost centre; approve quantities.
- **Material issues** — post stock out against an approved requisition.
- **Opening stock** — starting balances by store and date.
- **Movement ledger and registers** — receipts and issues with filters, printing and CSV.
- **Reports** — table and chart views, saved views, and Excel, CSV and PDF export.

## 09 · Purchase

Procurement from requisition to purchase order.

- **Command centre and lifecycle** — supplier setup, requisition, approval, sourcing, purchase order, documents, reports.
- **Templates** — reusable buying templates with approved products, quantities, prices and tax.
- **Requisitions and approval** — department, cost centre and need-by date; approve or reject quantities.
- **Requests for quotation (RFQ)** — create, track, and export or print for suppliers.
- **Purchase orders** — import approved demand; payment terms and promise dates; GST purchase tax; shipment details.
- **Verification** — a reprint desk for audit, and tax recalculation.
- **Documents** — purchase order preview with letterhead and approval blocks; export to Excel or PDF, email, or WhatsApp.
- **Reports** — requisitions, RFQs, quotations, purchase orders, receipts, suppliers and spend analysis.

## 10 · SPA

Spa appointments, treatments and therapist commissions.

- **Command centre** — appointments, active therapists, members and treatment rooms.
- **Schedule board** — therapist time and room capacity at a glance.
- **Reservations and check-in** — appointments with therapist, service, room, package and billing; walk-ins.
- **Treatment console** — treatment delivery, add-ons and progress.
- **Vouchers and memberships** — sell, redeem and track prepaid value.
- **SOAP notes** — clinical-style treatment notes.
- **Commissions and reports** — therapist commission rules; revenue, treatment mix, room use, no-shows and retail sales.

## 11 · Accounts Receivable

Credit accounts, invoicing and collections.

- **Dashboard** — debtor accounts, credit exposure, collections and direct billing.
- **Debtor accounts** — account code, credit limit, primary flag and external reference.
- **Charge to account** — move a POS bill to account settlement after checking credit limit and balance.
- **Source postings** — a transfer register tracing charges back to the source folio and business date.
- **Invoices** — raise from account activity; a register with print, email and allocation.
- **Payments and credits** — record collections and allocate them to invoices.
- **Statements and reminders** — statement packs; reminder levels with a minimum gap between notices.
- **Aging** — dated snapshots of what is owed, with follow-up tasks.
- **Research and reports** — search across invoices and payments; ledger, aging, statement and audit reports with chart settings.

## 12 · CRM

Guest relationships, B2B sales and service recovery.

- **Sales and service overview** — pipeline, leads, opportunities, campaigns, open tickets, segments and an "AI insight" panel.
- **Customer 360** — identity, contact health, past business, bookings, complaints, consent, preferences and relationship value.
- **Leads** — source, contact channel, score and quality.
- **Activities** — calls, outcomes, reminders and next actions.
- **Opportunities and pipeline** — stages, weighted forecast value and line items.
- **Quotes, proformas and proposals** — generated from the opportunity, with approval and audit, India and international templates, and print, email or WhatsApp.
- **Campaigns** — target segments, channel and budget, with conversion and ROI tracking.
- **Service recovery** — tickets with priority, queues, SLA policies and escalation.
- **Customer portal** — self-service access created from the profile.
- **Billing account usage** — subscription billing against the CRM customer.
- **Reports** — profiles, leads, opportunities, campaigns, service, portal, AI and audit.

## 13 · Communications

*Workflow guide only — chapter titles, no descriptions.*

- WhatsApp conversations
- Message templates
- Message queue and delivery status
- Guest and booking context
- Email and internal chat
- Communication reports
- **Also listed on the modules page:** service notifications.

## 14 · AI - Copilot Home

*Workflow guide only — chapter titles, no descriptions.*

- Copilot home
- Ask an operational question
- Grounded answers with source context
- Report and summary help
- Suggested next actions
- Permission-aware review

## 15 · Transport

Guest transport booking, dispatch and billing.

- **Dashboard and supervisor view** — open bookings, unassigned trips, fleet readiness, revenue and exceptions.
- **Setup** — vehicles, drivers, vendors, pickup and drop-off locations, and pricing rules.
- **Booking** — from a CRM guest with reservation and room context; passengers, luggage, flight or carrier, and where the charge posts.
- **Route pricing and quote** — saved locations with one-off overrides; fare, tax and total.
- **Live queue and search** — bookings with service and billing status; filters.
- **Dispatch** — confirm, assign vehicle, driver and vendor, and monitor the trip.
- **Driver mobile** — the driver's trip list with start, picked-up and complete actions.
- **Charge posting** — to the room folio, AR, pay now or at the hotel, or complimentary.
- **Night audit exceptions** — unposted charges, pending payments and unassigned trips before close.
- **Front office entry** — book transport from the front desk.
- **Reports** — operations, dispatch and drivers, fleet and pricing, and billing audit.

## 16 · Hostel

*Workflow guide only — chapter titles, no descriptions.* The chapters describe residential housing (applications, residents, fees), not short-stay backpacker hostels.

- Application intake
- Property, building, floor, room and bed setup
- Allocation console
- Resident profile and calendar
- Fee generation
- Hostel reports
- **Also listed on the modules page:** renewals.

## 17 · Payroll & HR

Payroll with Indian statutory compliance and a hospitality earnings pack.

- **Command centre** — pay runs from ready to posted, with disbursement, deductions, bank files, WPS, overtime, service charge and tips.
- **Master controls** — PF, ESI, Professional Tax, Labour Welfare Fund, TDS, gratuity, leave encashment, bonus and arrears.
- **Employees** — directory; bank account verification (IFSC); statutory identity (PAN, Aadhaar, UAN, ESI, passport); contracts and salary package; salary components.
- **Pay inputs** — biometric attendance, leave and loss of pay, approved overtime, and one-off additions and recoveries.
- **Pay run** — readiness checks, calculation, maker-checker approval, and line-by-line payslips.
- **Posting and payment** — posting to accounting, bank salary files, WPS reconciliation, and journals with account mapping.
- **Tax and statutory** — tax declarations and proofs, Form 16 and TDS certificates, PF and ESI challans, and state-wise Professional Tax and Labour Welfare Fund returns.
- **Employee lifecycle** — staff loans with instalment recovery, exit and full-and-final settlement, and an audit log of sensitive actions.
- **Hospitality pack** — service charge distribution, tips, POS incentives, spa commission, banquet payouts, housekeeping productivity pay, night-duty and split-shift allowances, staff benefits and contract labour.
- **Cost analytics** — payroll cost by department and outlet, per occupied room, per cover and per event.

---

## Module page inventories (read 2026-10-31)

**Source:** the "every capability" lists on the `bluepms.com/modules/<module>/` pages, read 2026-10-31. Point counts are what the pages publish, and they match a count of the bullets. Everything here is paraphrased marketing copy, **not verified in a live system**, and says nothing about what the pilot client has switched on. How each item maps to HospAI is in [the inventory comparison](2026-10-31-bluepms-inventory-vs-slices.md).

CRM, Channel Distribution and AI Copilot Home publish **no inventory**: only chapter titles, CRM's video chapters, and short report bullets, noted at the end. There is no page for accounting software integration.

### Front Office — 163 points

- **Command centre and guest intake** — counts of rooms, pending arrivals, in-house guests, departures, unfinished due-outs and occupancy; attention cards; "hotel pulse" cards for pending bills, arrival tariff value, unassigned arrivals, source and room-type demand; launchers for the common flows. CRM guest search before booking, with identity, contact, passport or ID, and nationality carried in. Booker, company, source, segment, channel, guest type and payment status on the booking. Readiness checks flag missing guest, stay, room, rate, additional-guest, payment or balance details.
- **Reservations, rates and packages** — create, view, edit, cancel and reopen. Statuses for confirmed, tentative, waitlisted, cancelled and no-show. Dates, guest count, room type, exact room number, plan, tariff and package, with an availability-checked room picker at booking and check-in. Editable day-by-day room, plan and package prices. Add-ons for the full stay, arrival day, departure day, weekends, one day or selected dates. Package templates with nights, room defaults, plans, add-ons, fixed price and posting schedule; a package booking fills checkout, add-ons, total and tariff split. A group workspace (blocks, rooming lines, cutoff, pickup, group billing). Transport requests where enabled.
- **Advances, receipts and deposits** — take an advance when creating a reservation, later against it, during a stay, or from a standalone page by reservation or check-in number. Several payment rows per capture, with amount, method, method id, transaction id and details, source and notes. A panel of room, plan and package totals, estimated bill, total advance and pending amount. A numbered receipt, printable. Group deposits allocated to child bookings. A night-audit check on arrival deposit balance.
- **Proformas and guest documents** — proforma from reservation or check-in day-price rows, with base, tax, estimate, advance and balance; a tax summary and warnings; branded template picker; PDF print; email with attachment; print settings for header, stay details, totals, tax, advances and footer. Registration cards from reservation or check-in, with a master and several templates. Action buttons for proforma, registration card and advance receipt.
- **Check-in, stay and checkout** — check-in from a booking and walk-in check-in. **A separate edit-check-in flow for in-house corrections.** Additional-guest capture with duplicate checks and configurable requirements. ID scan and AI extraction modes. Toggles for early check-in, late checkout, airport transfer, and VIP or management guest. An in-house list with registration number, company, room, dates, amount, contact and ID context. Checkout with charges, advance, balance, refund, settlement and room closeout. Overdue-checkout alerts with grace rules. Early-departure options (no penalty, flat amount, last night, unused nights, deposit retained, rate tier) with manager override and reason.
- **Billing and cashiering** — a draft bill from the checked-in folio; charge review; a tariff check across posted, unposted, future and early rows; post or remove tariff rows from the draft; create the final bill. Equal, source-based and custom splits. **Transfer lines to another room.** Group master bill. Settlement with payment rows and tender details. Controlled negative adjustments with an approval threshold. Previews, PDFs, email, regenerate and reprint.
- **Bill on hold / open folio** — switched on per property. Check out on an approved open folio and charge afterwards. Place a hold with reason, notes, follow-up date, close-by date, approver and expected settlement; release with a reason; extend with a reason; close at zero or when settlement allows. Settings for approval, reason and follow-up, and for which source modules take part. Auto-open at end of day, auto-close at zero after set days. Night-audit checks for unsettled, expired, invalid or zero-balance holds.
- **Reversals and audit controls** — high-privilege bill and settlement cancellation with a required reason. Voiding a pending bill marks the folio document void, restores the room to occupied where applicable, voids related penalty rows, and allows a regenerated bill. Cancelling a settlement first honours tax-document state, voids payment rows, returns the bill to pending or open folio, reopens the stay if no room conflict exists, and reactivates a settled hold.
- **Facility and guest charges** — charge bills for in-house or CRM guests from a package catalogue, with date, quantity, discount and tax; a non-chargeable toggle with reasons; a stay ledger view; quick payment by cash, card, UPI, room posting, split or another method, with transaction id, room target and debtor account; receipts and email; privileged reversal.
- **Room operations and availability** — a grid of availability, occupancy, reservations and room actions. **A 26-day grid plus 7, 14, next-30 and custom ranges**, with room-type and status filters. **A live view grouped by room type and condition.** An occupancy row and summary cards. Colours for available, reserved, occupied, dirty, maintenance, billed and unavailable. Actions: book or walk in on a free room, edit or check in on a reserved one, stay detail on an occupied one. A checkout warning panel. Release from maintenance with a required reason. Room change with transfer history. Calendar settings for colours, default view, start day, refresh and show-rates. Availability report settings.
- **Custom night audit** — on/off per check; Fail, Warn or Info; preview before close; close once blockers clear; a log. Pre-close checks: pseudo rooms, country and state, arrival deposits, arrivals not checked in, departures not checked out, ID proof, dirty rooms assigned, open folios and holds, cashier closure, weather and notes. Post-roll checks across room and tax posting, rate mismatch, POS, guest charges, transport, spa and banquet. Mandatory audit checks including comp postings, income audit, settlement activity, final reports, tax documents, statistics, profile updates, stores and purchase. Open-folio automation. A revenue report, daily statistics in Manager Report format, and an end-of-day control report.
- **Manager reporting and MIS settings** — **a Manager Report with folio-backed totals and room statistics**, over a date range, with print, PDF and Excel, section visibility and density. Settings for calculation basis and posting detail. Occupancy rules for day-use, no-show, complimentary, house-use, out-of-order, out-of-service, management block and checkout day. Mapping for nationality, domestic countries and company, group and travel-agent sources. Active report rows with labels, formulas, decimals and order. A formula library with approved calculations and locked built-ins. Day-wise sale and expenditure, with store source controls.
- **Reports, masters and integrations** — 247 native reports plus a larger catalogue, grouped by arrivals, departures, in-house, charges, reservations, rooms, groups, forecast, end of day, management, cashier, financial, profile, statistics and miscellaneous. Availability reports (detailed, month-wise, future occupancy, room plan, on the books). Cashier and financial reports (deposit activity and ledger, cashier summary and audit, corrections and cancelled payments, detailed folio, open-folio register, payment tax invoices, tax report, trial balance, guest trial balance). A report builder; print, export, CSV and PDF. Masters for rooms, tariffs, packages, FX, profiles and audit controls. A configuration area for most of the above. Door lock, Wi-Fi and payment gateway integrations.

### Housekeeping — 40 points

- **Command centre and readiness** — readiness percentage, dirty rooms, open and overdue tasks, active blocks, open messages, unclaimed items, damage cases and audit variance. A status board across clean, dirty, occupied, reserved, billed, blocked, maintenance and available. Filters by type, floor, room and status. Pending arrivals and departures for prioritising. A priority workbench, floor comparison, room search with current stay context.
- **Status and turnaround** — mark dirty with room, reason and feedback, recorded as a transaction; clear dirty with quality-check comments. Conflict detection between occupancy and status. Checkout timing alerts with grace cutoff. One attention queue across conflicts, alerts, overdue tasks, blocks, requests and damage.
- **Tasks, attendants and maintenance** — tasks by date, type, room, attendant, priority, status and supervisor notes. Search, start, update, complete, review and cancel. Counters for open, pending, in progress, completed, overdue and blocked. Blocks with type, start and end time, reason, inspection notes, availability impact, register and release history. Task-linked blocks that release when the task completes, with protection for task-generated blocks.
- **Quality and cleaning** — property-level switches for each control. Inspection checklists with sections, weights, mandatory items and order; templates can be activated and deactivated. Inspection capture with inspector, attendant, answers, defects, remarks, result, item and overall scores, and history. Cleaning stages (started, paused, resumed, inspected, completed, released) by task, room, attendant and time.
- **Guest service and exceptions** — requests with room, guest, type, **responsible department**, note, ownership, status, search and resolution. A lost-and-found custody register through handover, claim and closure. Missing and damaged cases with reporter, inspection detail, closure note and returned-item status. A guest audit comparing front-office and housekeeping counts by room, floor, type, date and session, with count adjustment, variance reason, saved evidence and history.
- **Linen, minibar and folio** — a linen item master; movements for issue, return, laundry, discard and adjustment by date, item, room, attendant and notes. Minibar setup with an outlet and eligible products; pickup with room, guest, item, quantity, price, attendant and status. Reconciliation linking pickup, POS bill, stock depletion and folio charge.
- **Amenities** — an amenity master with unit, standard quantity and linked stock product. Rule templates for expected room supply. Planned and confirmed dispatches with several lines. Expected vs actual with a required exception reason and optional supervisor confirmation. A dispatch ledger with stock-posting status and reconciliation.
- **Reports** — 36 reports across status, status changes, blocks, tasks, audit, requests, lost items, damage, quality, linen, minibar and executive control, with filters, visuals, print, Excel, CSV and PDF. The page says six entries are pending data mapping.

### Point of Sales — 26 points

- **Command centre and outlet flow** — sales, open checks, covers, settlement status and outlet performance. Order entry by restaurant, table, server, guest and order type. A table board (occupied, vacant, reserved, active, billed). Outlet reservations and waitlist.
- **Orders and kitchen** — KOT and BOT with modifiers, instructions and kitchen routing; non-chargeable KOT with a reason; kitchen display with delay monitoring; reprint; move an order between tables, guests or outlets.
- **Billing and settlement** — bills from saved orders with tax, service charge, discount and round-off; split billing; a pending-bills screen; settlement with method, tips and cashier controls; bill on hold.
- **Printing** — bill formats, printer behaviour, copies and paper width; kitchen printer routing.
- **Cash, labour and stock** — paid-in, paid-out and register checks; sessions; staff allocation; time clock with breaks; menu waste with reason and cost; stock depletion through F&B costing.
- **Forecasting and promotions** — demand, sales, staffing and preparation forecasts; coupons, happy hours and free-product offers with date, time, usage and outlet limits.
- **Masters** — restaurants, tables, order types, sections, servers, kitchens, products and menu mapping.

### Tax & Compliance — 61 points

Not on the client's checklist. Its e-invoicing is what the client's *GST / e-invoice QR* tick now points at.

- **Foundation** — country packs; a company tax profile; tax registrations; document rules by source module, document type, buyer type and domestic context; e-invoice provider setup and an adapter registry.
- **Tax masters** — categories, definitions, structures, rules and dependencies for ordered or compound tax; a calculator; **HSN/SAC classifications**; active and inactive control.
- **Engine policies** — slab rule sets; **composite-supply profiles** for linked room, plan and service; tax-basis policies for what enters the taxable base; **room-and-plan rules deciding which plan types join the room amount for the slab**; a per-transaction tax check and a tax-basis audit.
- **Buyer identity and source documents** — unregistered and registered buyers; **GSTIN entry with provider lookup; legal and trade name, address, city, state, PIN, state code and place of supply; a buyer snapshot retained with the document**. Mapping from source modules. Automatic queueing of eligible documents, including front-office settlements and guest charge payments.
- **E-invoice queue** — review by document, provider, status, IRN, QR, failure and retry. Submit and resubmit. Payload inspection and audit trail. **Correct-and-rebuild preview.** Dry run where the adapter supports it. **Manual acknowledgement requiring official IRN and QR.** Cancel a never-submitted item, kept distinct from portal cancellation inside the window, followed by reconciliation. Audit events at every stage.
- **Statutory output** — IRN, acknowledgement number and date, QR image, seller and buyer registration, HSN/SAC and tax breakup printed on supported documents; visibility controls in print settings.
- **India GST reports** — a compliance pack, invoice registers, GSTR-1 sales register, GSTR-2 purchase register, a 3B working paper, a reconciliation dashboard, labelled by availability.
- **Registers and controls** — a tax ledger and summary, e-invoice, tax document and credit or debit note registers, a tax exception report and a setup audit; print, Excel, CSV and PDF.

### Guest Experience — 79 points

Not on the client's checklist. It overlaps HospAI's R5.2 (guest messaging) and R4.2 (booking engine), and it reaches beyond them.

- **Dashboard and setup** — workload summary, role-focused task order, property readiness, permission-aware actions and a practice mode.
- **Website studio and direct booking** — a hotel website builder with templates, reusable blocks, previews, a launch audit and publishing; booking-engine embed or external link; direct-booking promo codes.
- **Reviews and replies** — feedback capture with a rating, reply drafts with internal notes, approval and rejection, publication status, handoff to a service request.
- **Messages** — a unified guest and staff inbox; automatic messages by email, SMS, WhatsApp and in-app; delivery progress and retry.
- **Service recovery and alerts** — requests with department, team, room, priority, ticket number, due time and checklists; recurring team tasks; operational alerts with acknowledge and resolve.
- **Guest pages and forms** — published guest pages from secure links; form rules that open a ticket or queue a message.
- **Social and media** — social posts with approval and per-channel results; a media library.
- **Insights and governance** — feedback, request and guest-page counts; connection readiness; retention policies; role permissions and audit context.

### Modules with no inventory

- **CRM** — video chapters and report groups only. The Customer 360 chapters are summarised in section 12 above.
- **Channel Distribution** — the six chapter titles in section 06 above, plus report bullets: publishing status, event activity, booking exceptions, mapping health, the unmapped queue, partner performance, settlement review, commission and reconciliation.
- **AI Copilot Home** — the six chapter titles in section 14 above, plus: role-aware context, suggested questions, shortcuts, report discovery, summaries, exception explanation, Q&A over authorised data, manager summaries and follow-up prompts.
