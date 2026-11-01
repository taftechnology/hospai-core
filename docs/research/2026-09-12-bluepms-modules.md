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
- Report counts are as published and cover 12 of the 17 modules.
- Several features point at India and the Gulf: GST and e-invoice QR on invoices, GST purchase tax, Indian payroll statutory outputs (PF, ESI, Professional Tax, Labour Welfare Fund, TDS, Form 16), Indian identity and bank fields (PAN, Aadhaar, UAN, IFSC), and WPS salary-transfer reconciliation.

## At a glance

| # | Module | Demo | Chapters | Published reports | HospAI decision (§16.6) |
|---|---|---|---|---|---|
| 01 | Front Office | Video | 71 | 247 | Core |
| 02 | Housekeeping | Video | 35 | 36 | Core |
| 03 | Point of Sales | Video | 33 | 182 | Add-on (POS-lite); integrate restaurant POS |
| 04 | Food and Beverages | Video | 22 | 55 | Integrate |
| 05 | Banquet & Events | Video | 23 | 36 | Add-on, lean |
| 06 | Channel Distribution | Guide only | 6 | — | Core |
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

**Total:** 370 chapters; just over 1,000 published reports.

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
