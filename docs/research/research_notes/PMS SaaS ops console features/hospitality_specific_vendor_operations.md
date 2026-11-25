# Hospitality-specific vendor operations for a hotel PMS SaaS (what the vendor's own staff must do, and what the internal ops console needs)

Research date: 2026-11-24. India first; EU, UK and US secondary.

How to read these notes:

- **[Documented]** = stated on the cited page, which I opened and read in this session.
- **[Documented, snippet]** = stated in a search-result summary of the cited page; I did not open the page itself. Treat as lower confidence and re-check before quoting.
- **[Inferred]** = my reasoning from the documented facts. All "how often" and most "how urgent" ratings are inferred: I found no vendor that publishes ticket-volume statistics by category.
- Regulatory facts carry the date they took effect. Most Indian tax and privacy facts below come from law-firm, tax-portal and vendor summaries, not from the notification text. Check the primary notification before building rules on them.
- Urgency scale used in the tables: **P1** = front desk blocked now (cannot check in, check out, take payment, or close the day); **P2** = money or inventory is wrong and getting worse by the hour (overbooking, missed reservations, wrong tax on live invoices); **P3** = same-day; **P4** = scheduled work.

---

## 1. Property go-live: what an implementation checklist contains, and who does what

### Takeaway
Published vendor outlines put go-live at roughly 6 to 8 weeks of preparation, with the hotel owning configuration data and third-party paperwork and the vendor owning the tooling, imports, interface setup, training environment and a hand-off to support. The cutover night itself (old-system night audit, balance tie-out, stayover re-entry, numbering checks) is the least documented and highest-risk part.

### Cited Findings
- [Documented] Stayntouch plans "approximately 6-8 weeks of prep work prior to the cutover date" and publishes an 8-week outline: contract and first invoice, kick-off call, configuration worksheet, data import, payment gateway paperwork, interface vendor outreach, interface PC setup, CRS sync, staff training, go-live prep call, go-live, post-go-live support days — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Hotel-side duties in that outline: name a "Property Champion" who owns configuration deliverables and invites staff; fill in the Auto-Configurator Excel worksheet; supply logos, room images, device information and key-card details; email each interface vendor (PBX, POS, key) copying the vendor's consultant; return payment gateway paperwork; provide a dedicated on-site interface PC; run an internet speed test; order devices — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Vendor-side duties in that outline: project manager and implementation consultant; 2 to 4 instructor-led configuration sessions; a data loader; payment integration setup and testing; interface meetings and testing; a training environment and academy by department (front desk, housekeeping, management); go-live summary; "dedicated support days"; a 15-minute support hand-off training; optionally a 60-day transition manager — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Payment setup has its own lead times in the same outline: gateway files arrive in 2 to 3 days for the vendor's own payments product and 7 to 10 days for a third-party US gateway; the hotel must confirm a card batch time or it "defaults to 2 a.m. local time" if there is no reply 10 days before go-live — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Mews lists 11 go-live tasks for a property changing PMS: set the cashier starting balance per currency; mark out-of-order spaces; review room statuses with housekeeping; create availability blocks ("Mews does not transfer availability blocks during the reservation import"); import future reservations and resolve overbookings (check the next 5 to 10 days); import stayover reservations and assign the same room number as in the old PMS; post open balances from the old PMS; connect and test printers and key cutters; review bill and invoice numbering and counters after the first closed bill; confirm each integration is enabled; confirm the channel manager is enabled and watch new bookings arrive — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms)
- [Documented] Stayover guests "receive two sets of invoices, one from each system" and should be told in advance — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms)
- [Documented, snippet] Mews puts the average go-live at "around two months" — [Mews migration blog](https://www.mews.com/en/blog/migrate-pms-confidence-mews)
- [Documented, snippet] One vendor guide recommends a rehearsal before cutover, a step-by-step runbook, a hypercare period afterward, and aligning go-live "with lower occupancy periods" — [Priority Software implementation guide](https://www.priority-software.com/resources/hotel-pms-implementation-guide/)

### Inferences
- [Inferred] A go-live is a tracked project per property, not a sign-up. The ops console needs a **per-property onboarding record** with a checklist whose items have an owner (vendor or hotel), a due date relative to the go-live date, and evidence. The documented item groups are: room types and rooms; rate plans; taxes; users and roles; cashier opening balance per currency; document numbering counters; payment gateway and terminals (with KYC status and batch time); interfaces (lock, PBX, POS); channel mapping; imports (profiles, companies, future reservations with deposits, stayovers, open balances); training completion by department; go-live prep call; hypercare end date.
- [Inferred] The vendor needs a **training or sandbox property** per customer that mirrors the real configuration, because the documented model has staff "practice in a training environment" before go-live. The console needs to create it, refresh it from live configuration, and label it clearly as non-production so it never reaches channels, payments or statutory reports.
- [Inferred] Cutover night needs its own **runbook view**: old system's last night audit done, trial balance figures from the old system entered, the new system's ledger totals shown beside them, the difference displayed, and a "balanced" sign-off by a named hotel user before stayovers are checked in. The vendor's implementation person should be on call for that night.

| Operation | What goes wrong or what the hotel asks | How often [Inferred] | Urgency | What the vendor operator needs to see or do |
|---|---|---|---|---|
| New property setup | Hotel returns the configuration worksheet late or incomplete | Every go-live | P4 | Onboarding checklist with owners and overdue items; bulk load of rooms, rates, taxes, users |
| Payment setup | Gateway KYC or terminal shipping slips past go-live | Common | P3 before go-live, P1 on go-live day | KYC and terminal status per property; go-live blocked or flagged if payments are not live |
| Numbering and fiscal counters | First invoice has the wrong number series, header or tax ID | Every go-live (a check, not always a fault) | P2 | View and correct document counters before the first closed bill; audit entry for any change |
| Cutover night | Ledgers do not tie to the old PMS; stayovers in wrong rooms | Every migration go-live | P1 | Balance tie-out view; stayover list with old room number; named on-call implementer |
| Hypercare | High ticket volume in the first days | Every go-live | P1 to P3 | Property flagged "in hypercare until <date>" so support routes and prioritises it |

### Gaps
- No vendor I read publishes a step-by-step cutover-night runbook. The Stayntouch outline only says a go-live prep call "covers necessary items"; the Mews article does not cover the old system's last night audit, payment terminal switchover or channel switch timing.
- I did not find HTNG, AHLA or HFTP publications on PMS implementation in this session; nothing here is sourced from them.
- No Indian vendor's (eZee, Hotelogix, IDS Next, WINHMS) implementation guide was found or read. India-specific go-live items (GSTIN per property, invoice series per GSTIN, e-invoice credentials, Form C portal login) are my inference from section 6.

---

## 2. Data migration from a previous PMS

### Takeaway
The standard import set is guest, company and travel-agent profiles plus future reservations with their deposit totals; in-house stays and open balances are normally re-entered or posted by hand through a special one-sided entry, and availability blocks often do not migrate at all. Validation in the published guidance is manual (overbooking checks for the next 5 to 10 days, random-sample checks), and nobody documents a rollback.

### Cited Findings
- [Documented] Stayntouch's data loader "can import company profiles, travel agency profiles, guest profiles, and reservation data with the advanced deposit total"; AR balances and other deposit types are not in the outline — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Mews: post all open balances from the old PMS using the "External payment Cross settlement" payment type, or import balances as deposits or prepayments through the reservation import; "once the two systems balance, check out in-house stayover guests" from the old one — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms)
- [Documented] Mews does not transfer availability blocks in the reservation import; the hotel must create them first — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms)
- [Documented] Imported reservations need the channel identifiers to keep working with the channel: a later OTA cancellation fails on a reservation that was entered by hand or imported incompletely; "imported reservations need Channel Manager Number, Channel Number, and Integration ID" — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented, snippet] Stayntouch describes outstanding A/R as "one of the trickiest parts of any PMS migration" because balances "often don't transfer through a standard reservation import"; its route is an "Add Manual Balance" feature in Accounts Receivable, a one-sided entry "used only before cutover" — [Stayntouch switching guide](https://www.stayntouch.com/blog/how-to-make-the-switch-to-saas-hotel-pms/)
- [Documented, snippet] The same vendor advises submitting import files "in test form about a week before your migration date" so the implementation team can run a trial import and flag issues — [Stayntouch switching guide](https://www.stayntouch.com/blog/how-to-make-the-switch-to-saas-hotel-pms/)
- [Documented, snippet] A third-party checklist advises exporting every reservation with check-in after the cutover date and "verifying a random sample of future reservations", including prepaid ones — [Smart Order switching checklist](https://www.smartorder.ai/resources/blog/switching-hotel-pms-checklist/)
- [Documented] After a legal-entity change one vendor copies configuration, pricing and structures into a new account and "imports future reservations up to the transition date"; the old account stays available read-only "for a minimal monthly fee" for disputes and tax audits — [Clock PMS legal entity change](https://support.clock-software.com/en/support/solutions/articles/9000269223-changing-legal-entities-considerations-you-can-t-overlook)

### Inferences
- [Inferred] The vendor's import tool must be a first-class ops console function, not a script: upload a file, run it as a **dry run against the training property**, show row-level errors (unknown room type, unmapped rate code, overlapping room assignment, missing channel reference), then run for real with an import batch id.
- [Inferred] Because no one documents rollback, the safe design is that every imported row carries its **import batch id** so a bad batch can be reversed as a unit before the property starts trading, and is locked once the first business day closes.
- [Inferred] Reconciliation needs to be numeric and shown in the console: count and total value of future reservations by arrival month, deposits held, guest ledger, and city ledger (receivables) balance by company, each as "old system figure entered by hotel" against "new system figure after import".
- [Inferred] Opening balances are money created without a matching transaction. They should be a distinct, labelled entry type usable only before the first business date closes, with the entering operator recorded — this mirrors the documented "one-sided entry used only before cutover".
- [Inferred] Importing reservations changes sold inventory. The import must write availability in the same step and then run an overbooking check for at least the next 5 to 10 days, matching the documented manual check.

| Operation | What goes wrong | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Trial import | File has wrong columns, date formats, unmapped codes | Every migration | P4 | Dry-run report with row errors; mapping table old code to new code |
| Final import | Duplicates on re-run; overbookings after import | Every migration | P1 on cutover night | Idempotent batch; overbooking list; reverse-batch action until day one closes |
| Open balances and deposits | Ledger totals differ from old PMS | Every migration | P1 on cutover night | Opening-entry type with tie-out totals and sign-off |
| OTA references | Later OTA modification or cancellation fails on imported bookings | Days to weeks after go-live | P2 | Search imported bookings missing channel references; add the reference |
| Guest profiles | Duplicates, personal data imported without a lawful basis or beyond the retention period | Every migration | P4 | Duplicate report; import cut-off by last-stay date |

### Gaps
- No source describes an automated reconciliation or a rollback procedure for a PMS data migration. This is a real absence in the public material, not just in my search.
- I could not open the Hospitality Net pieces on migration data readiness; only their titles surfaced, so nothing is cited from them.
- Which legacy PMS export formats are common among Indian independent hotels is not covered by any source found.

---

## 3. Night audit / end of day: stuck cases, vendor intervention, and controls on back-dated changes

### Takeaway
Night audit fails for a small, well-documented set of reasons — users still logged in, due-outs not handled, a posting job that hangs, earlier business dates left open, a negative cashier drop, missing setup — and on legacy systems the vendor's support staff resolve it by editing job state in the database, an action the vendor's own documentation warns "can jeopardize the property's financial data". Modern cloud systems replace that with permissions, a per-run log and automatic retry, and they block back-dated financial changes outright: corrections are new counter-entries dated today.

### Cited Findings
**Failure cases (Oracle OPERA 5 troubleshooting page; legacy on-premise, but the most detailed public list)**
- [Documented] End of day "cannot proceed past Departures": due-out guests must each be extended or checked out; "this step cannot be bypassed" — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] Due-in guests not checked in become no-shows when the business date rolls — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] Users still logged in at roll: the system broadcasts a message, waits a configured number of minutes, then ends all sessions and rolls the date — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] Cashier close fails on a negative shift drop when the "positive cashier drop" setting is on — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] Room-and-tax posting stuck in "PROGRESS": support kills the job, sets the status to ERROR for that business date and commits; "updating it to anything other than ERROR can cause serious problems" and wrong updates "can jeopardize the property's financial data" — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] A failed procedure is picked up again by the end-of-day run until its status is COMPLETE; errors are read from a night-audit journal table; to skip a procedure that keeps failing, support must first "get the property's consent", mark it completed, and re-run — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] The business date moves through named states (open, in progress, room posting complete, procedures complete, reports complete, closed), and a per-reservation check table tracks completion of room and tax, fixed charges and packages — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented] Night-audit reports can be "reprinted" (the same output) or "regenerated" (re-run, so "data changed after the original audit appears on the regenerated report") — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)
- [Documented, snippet] OPERA Cloud: with income audit, the business date can advance without being closed; "final reports and procedures are not run when business date is not closed", and "another night audit cannot be run for the property until the oldest open business date is closed" — [OPERA Cloud End of Day controls](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/c_opera_controls_end_of_day.htm)

**Vendor-controlled date changes**
- [Documented] OPERA's Change Business Date utility "should be used with extreme caution"; it "requires a password available from Oracle Systems Development"; the date cannot be changed if financial transactions exist or a night audit has ever run for the property. The same page describes running multiple consecutive end-of-day processes to roll the date forward several days "such as when a property reopens after a closure", which requires all guests checked out, no open folios, all prior days closed, and a specific permission — [OPERA Change Business Date](https://docs.oracle.com/cd/E53533_01/opera_5_5_1_0_core_help/live_date.htm)
- [Documented, snippet] Stayntouch: running end of day manually for the current date needs the permission "Override Business Date Change <18 Hours", which "by default is only assigned to Hotel Admin"; the product has an End of Day Log — [Stayntouch End of Day log](https://stayntouch.freshdesk.com/support/solutions/articles/6000141982-end-of-day-log)

**Controls on back-dated financial changes (Mews)**
- [Documented, snippet] An "accounting editable history window" sets how far back accounting items can be changed, and only on open bills; "to make corrections to a closed bill, you need to rebate that bill" — [Mews accounting configuration](https://help.mews.com/s/article/what-is-the-accounting-configuration); [Mews closed-items error](https://help.mews.com/s/article/why-do-i-get-a-cannot-modify-closed-items-error)
- [Documented, snippet] A 2023 Mews community tutorial says the accounting window limits bill-item changes to within one day by default with a 7-day maximum (check the current value) — [Mews community: editable history windows](https://community.mews.com/community-library-94/get-the-most-from-mews-editable-history-windows-623)
- [Documented, snippet] "A rebate does not remove the original bill from the ledger"; Mews says you "cannot create bills or invoices with a date in the past, or change their date" — an external accounting system is needed for that — [Mews correcting closed bills FAQ](https://help.mews.com/s/article/Correcting-issued-invoices-and-closed-bills-FAQs)
- [Documented, snippet] Only users with the "Rebate items and reissue bills and invoices" permission can change issued invoices and closed bills — [Mews reissue article](https://help.mews.com/s/article/How-to-reissue-an-issued-invoice-or-closed-bill-to-make-changes-and-issue-refunds)

### Inferences
- [Inferred] A stuck night audit is a **P1** for the vendor even though the hotel may only notice at 3 a.m.: until the date rolls, the next day's room charges, arrivals list and reports are wrong. The Mews SLA would class it as "high priority" (a core function failed) rather than "critical" (whole platform down) — see section 8 — which shows that published severity definitions under-rate this case.
- [Inferred] The ops console needs a **night-audit monitor across all properties**: property, business date, local time, state of each step, how long it has been in that state, and the list of reservations that failed (missing rate, validation error). An alert should fire when a property's business date is more than N hours behind its local calendar date.
- [Inferred] Operator actions should be a short named list rather than free-form data edits: (a) re-run a failed step; (b) mark one reservation's failed posting as an exception and continue; (c) roll the business date forward for a property with no in-house guests (seasonal reopening); (d) regenerate a report for a closed date. Each needs a reason, the hotel's consent recorded where the legacy docs require it ("get the property's consent"), and an audit entry. Direct state edits of the kind the legacy docs describe should not exist.
- [Inferred] Rolling the business date **backward** should not be offered. The documented pattern everywhere is forward-only: corrections are rebates or counter-postings dated today, and the only "change date" tool is locked behind a vendor password and refuses once money has moved.
- [Inferred] "Regenerate" versus "reprint" is a control point: the console should keep the report output produced at close and mark any regenerated copy as such.

| Case | What the hotel reports | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Audit will not start or close | "End of day is stuck" | Weekly across a fleet; rare per property | P1 | Step-level state, blocking reason (due-outs, open cashier, prior open date), time in state |
| Unposted room charges | Some rooms have no charge for last night | Occasional, usually after a rate or tax change | P2 | Per-reservation failure list with cause; re-post action for that business date only |
| Business date wrong | Property skipped audits for days; date is behind | Seasonal properties, small hotels without night staff | P2 | Dates-behind indicator; multi-day roll with preconditions checked |
| Unbalanced folio or ledger | Trial balance does not tie | Rare | P2 | Ledger check per business date; the specific entries that break it |
| Back-dated correction request | "Change yesterday's invoice / post into last month" | Frequent request | P3 | No back-dating; guide to rebate and reissue; who holds the reissue permission |
| Audit report missing | Night reports were not emailed or printed | Occasional | P3 | Re-send stored output; regenerate marked as regenerated |

### Gaps
- I found no public figures on how often night audits fail on any PMS, and no cloud vendor documents its internal support tooling for audit intervention. The OPERA page is for a legacy on-premise product; cloud practice is inferred.
- I did not find documentation on audit failure handling from Indian vendors.
- No source addresses what an auditor or tax authority expects as evidence when a vendor intervenes in a closed financial day.

---

## 4. Channel manager and OTA connectivity

### Takeaway
Most connectivity tickets are mapping or configuration faults the hotel can fix, but undelivered reservations, failed modifications, overbookings and price mismatches go straight to vendor support and need internal tools — a message queue with raw payloads, timestamps and resend. The OTAs themselves put operational duties on the provider: Booking.com emails the hotel directly if the provider has not retrieved a reservation within 30 minutes, and Expedia requires partners to monitor their own success rates and "maintain the health of your connection".

### Cited Findings
**What goes wrong, and who fixes it (Mews)**
- [Documented] "Properties can only correct mapping-related issues themselves"; other cases need Mews internal tools — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented] Cases sent to vendor support: reservations not received; updates or cancellations not applied; modification of a reservation the PMS never received; data differing from the OTA when it was sent correctly; overbookings ("report with example as soon as it occurs"); delayed reservations where the PMS processed late; availability or rate updates not sent — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented] Cases the hotel fixes: unmapped rate code, wrong or mismatched room category code (including hidden spaces in the code), product not linked to a rate, rate synchronisation flags, disabled upload of availability or rates, wrong credentials — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented] Tools exposed to the hotel: a channel manager queue with status, results, "Created" and "Processed" timestamps and downloadable XML/JSON; a mail queue with mapping-error notices; an inventory updates queue and jobs archive; a per-reservation action log. "Logs used for investigating issues are only stored for 30 days." "Delta updates are not always visible in the queue" — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented] The vendor will push full inventory to fix an OTA mismatch only "with your written confirmation" through support — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)
- [Documented] Named OTA error codes the article maps to owners: Booking.com `HOTEL_ACCESS_DENIED` (connection deactivated in extranet), `ROOM_ID_INVALID`, `RATE_NOT_ACTIVE_FOR_ROOM`, `RATE_IS_A_SLAVE_RATE`, `OCCUPANCY_EXCEEDS_MAX_OCCUPANCY`, price too high or low, `EXCEEDS_MAX_RELATIVE_RELEASE_TIME` (restriction beyond 360 days), 403 on XML delivery; Expedia 3142 (collect-type mismatch), 3128 (zero price), 7022 (inactive rate plan), 3210 (lock error from simultaneous updates; resend affected dates) — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)

**Other vendors**
- [Documented, snippet] SiteMinder: when a value is outside what the channel accepts, "the channel rejects the update, and the rate becomes automatically disabled"; the fix is to re-map on the channel's room rate mapping page — [SiteMinder mapping errors](https://help-platform.siteminder.com/en/articles/8673526-learn-about-common-mapping-error-messages)
- [Documented, snippet] Little Hotelier: after creating a rate on the channel, wait 60 minutes before mapping again; channel credential changes go through the vendor's support team — [Little Hotelier mapping troubleshooting](https://help-platform.littlehotelier.com/en/articles/10814237-troubleshooting-channel-mapping-errors)
- [Documented, snippet] Cloudbeds' channel product documents numbered failure codes such as "[1012] ARIUpdate contains no channels to update" — [Cloudbeds myallocator error 1012](https://myallocator.cloudbeds.com/hc/en-us/articles/218959217-Failed-1012-ARIUpdate-contains-no-channels-to-update)

**Duties the OTA programmes put on the provider**
- [Documented, snippet] Booking.com does not push reservations; the provider must poll. If the provider's system has not picked up a new, modified or cancelled reservation within 30 minutes, Booking.com sends a fallback email to the property — [Booking.com missing reservation messages FAQ](https://developers.booking.com/connectivity/docs/con-faq-reservations-missing-res-messages)
- [Documented, snippet] Unacknowledged reservations stay in the queue until acknowledged or the timeout passes — [Booking.com acknowledging reservations](https://developers.booking.com/connectivity/docs/reservations-api/acknowledging-new-reservations-ota)
- [Documented, snippet] The Reservation Recovery API extends the window from 30 minutes to 24 hours except for check-ins within the next 48 hours, which still fall back after 30 minutes; Booking.com recommends calling the missed-reservations endpoint at least every 30 minutes — [Booking.com recovering reservations](https://developers.booking.com/connectivity/docs/reservations-flow-control-api/recovering-reservations)
- [Documented, snippet] If Booking.com has an outage before acknowledgement, the provider gets HTTP 500 and the fallback fires — [Booking.com reservations process](https://developers.booking.com/connectivity/docs/reservations-api/reservations-process-ota)
- [Documented, snippet] After onboarding, Booking.com partners are expected to keep pace with ongoing API changes — [Booking.com connectivity docs](https://developers.booking.com/connectivity/docs)
- [Documented, snippet; secondary sources] Booking.com's Connectivity Partner Programme ranks providers (Standard, Advanced, Premier, and from 2026 a "Premier Plus" tier) on a points score covering business value, product implementation, connection quality and engagement — [Hospitable summary](https://hospitable.com/booking-com-connectivity-partners); [Hostify on Premier Plus](https://hostify.com/blog/booking-com-partner-premier-plus-hostify)
- [Documented] Expedia's Connectivity Partner Program has Elite and Preferred tiers; partners are "required to maintain the health of your connection" under the Connectivity Partner Agreement and must implement mandatory updates; minimum technical requirements include an Availability/Rates API with Expedia Traveler Preference, Booking APIs with virtual cards, and "PCI compliance, where applicable"; qualifying metrics include net booking value, property growth, capability adoption, and the share of properties with at least one API call in a period; at least one "Optimization Initiative" is mandatory. No numeric thresholds are published — [Expedia Connectivity Partner Program](https://developers.expediagroup.com/supply/lodging/cpp/overview)
- [Documented, snippet] Expedia: "ensure monitoring is in place in the Booking Retrieval and Booking Confirmation APIs' implementation to validate the success rate of updates"; the Expedia booking ID is the only unique key for a booking — [Expedia booking retrieval requirements](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/booking_retrieval/getting_started/requirements-best-practices)
- [Documented, snippet] Expedia Booking Notification: end-to-end certification with Expedia teams is required, and every request must be answered with a confirmation number or an error code — [Expedia booking notification requirements](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/booking_notification/getting_started/requirements-best-practices/)

### Inferences
- [Inferred] Whether the vendor is itself the certified provider or sits behind a third-party channel manager decides who carries the OTA duties. Either way the hotel calls the PMS vendor first, so the console needs the same visibility.
- [Inferred] The console needs a **connectivity view per property and per channel**: last successful inbound reservation, last successful outbound availability/rate/restriction push, failure counts, oldest unprocessed message, and the mapping table (PMS room type and rate plan to channel codes) with unmapped or disabled rows highlighted.
- [Inferred] The operator needs **replay tools**: re-fetch or re-process one inbound reservation by channel reference; resend availability, rates and restrictions for a date range; trigger a full refresh. Full refresh overwrites what the OTA shows, so it should require the hotel's recorded confirmation, as the documented vendor practice does.
- [Inferred] The 30-minute Booking.com fallback is a hard external clock. A fleet alert should fire well before it ("inbound reservations not retrieved for 10 minutes"), and for check-ins within 48 hours the missed booking is already in the hotel's inbox, so the operator also needs to see which bookings fell back to email to help the hotel enter them by hand.
- [Inferred] Raw payload retention must outlast the dispute window. The documented 30 days is short for an overbooking dispute raised after the stay; payloads contain guest personal data and sometimes card data, so retention has to be weighed against privacy and PCI scope (sections 5 and 7).
- [Inferred] An overbooking incident needs a timeline an operator can hand to the hotel: when each booking was created at the channel, when it was received, what availability the PMS had sent and when. The documented diagnosis is exactly a comparison of "Created" and "Processed" timestamps.

| Case | What the hotel reports | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Mapping error | "My rate is not updating on the OTA" | Most common connectivity ticket | P3 | Mapping table with channel codes; last error text per rate |
| Failed availability or rate push | OTA shows rooms that are sold, or old prices | Regular | P2 | Outbound queue, failures by channel, resend for date range |
| Reservation not delivered | Guest arrives with a booking the PMS never got | Rare per property, serious | P1 at arrival, otherwise P2 | Inbound queue, fetch by channel reference, fallback-email list |
| Modification or cancellation not applied | Room held for a cancelled booking, or no-show charged wrongly | Regular | P2 | Message history per channel reference; re-process |
| Overbooking | Two bookings for the last room | Peak season | P1 on the day | Timeline of bookings and availability pushes |
| Channel deactivated or credentials changed | Everything stopped | Occasional | P2 | Connection status, last auth error, who changed what |
| OTA-side outage | Many properties affected at once | A few times a year | P2 | Fleet view by channel; one incident linked to many properties |

### Gaps
- I could not find a Booking.com or Expedia document that sets a support response-time SLA on providers. One vendor page attributes a 99.9% uptime figure to Booking.com; I could not verify it and have not used it. Programme terms sit in partner agreements that are not public.
- No STAAH, eZee Centrix or RateGain help documentation surfaced, so India's most-used channel managers are not represented.
- Expedia publishes no numeric thresholds for its partner metrics; "consult your account manager".

---

## 5. Payments

### Takeaway
Payment onboarding is a regulated KYC process run by the payment provider, not the PMS vendor, but the vendor's implementation team tracks it, ships or provisions terminals, sets the batch time, and is the hotel's first call when a capture fails. In India the vendor must also design around RBI rules: payment aggregators are now regulated for face-to-face payments too, merchant KYC goes through the central KYC registry, and recurring card charges above ₹15,000 need the cardholder's extra authentication each time.

### Cited Findings
- [Documented] In one vendor's onboarding, the hotel submits legal entity name, application contact and terminal shipping details (or a signed service agreement, hardware order form and site survey for a third-party gateway); credentials are issued once documents are received; EMV devices arrive around week 4; the batch time must be confirmed before go-live — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] A change of legal entity means "a new KYC process is typically necessary with payment providers such as Adyen", and the new entity needs a new fiscal account — [Clock PMS legal entity change](https://support.clock-software.com/en/support/solutions/articles/9000269223-changing-legal-entities-considerations-you-can-t-overlook)
- [Documented, snippet; RBI, 15 Sept 2025] The Reserve Bank of India (Regulation of Payment Aggregators) Directions, 2025 consolidate and supersede earlier guidelines and apply to bank and non-bank aggregators; the RBI's page shows the text "updated as on November 11, 2026" — [RBI Master Directions](https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896)
- [Documented, snippet; secondary] Under those Directions, aggregators handling in-person (physical point-of-sale) payments are within RBI's scope; merchant KYC at onboarding must use the Central KYC Records Registry; non-bank aggregators may use agents for identity checks but stay responsible; settlement timelines are now set in the merchant agreement under high-level rules — [YourStory on the PA rulebook](https://yourstory.com/2025/09/new-rbi-rulebook-opens-agent-assisted-kyc-route-for-payment-aggregators); [AZB summary](https://www.azbpartners.com/?p=87411)
- [Documented, snippet; RBI, 21 April 2026] RBI issued the "Digital Payments – E-mandate Framework, 2026", consolidating its e-mandate circulars; later recurring transactions can run without additional factor authentication (AFA) up to ₹15,000 per transaction; the first transaction needs AFA; changing or withdrawing a mandate needs AFA; issuers may map existing mandates to reissued cards — [Business Today, 21 April 2026](https://www.businesstoday.in/personal-finance/news/story/rbi-caps-recurring-payments-at-rs15000-without-otp-under-new-e-mandate-framework-526759-2026-04-21); [KPMG note, June 2026](https://kpmg.com/in/en/insights/2026/06/reserve-bank-of-india-rbi-digital-payments-e-mandate-framework-2026.html)
- [Documented, snippet; secondary] RBI's card-on-file tokenisation replaces the card number, expiry and CVV with a token, and creating a token needs the customer's explicit consent validated through AFA — [GKToday summary of RBI tokenisation guidelines](https://www.gktoday.in/rbi-card-security-and-tokenisation-guidelines/)
- [Documented, snippet] PCI DSS v4.0.1: Requirement 12.8 covers how customers manage third-party service providers; Requirement 12.9 covers the providers' own obligations; Appendix A1 covers multi-tenant providers — [OneUptime guide to the responsibility matrix, Sept 2026](https://oneuptime.com/blog/post/2026-09-24-pci-dss-cloud-tpsp-responsibility-matrix/view)
- [Documented, snippet] The PCI SSC says a third-party service provider "is obligated to provide information to its customers about which PCI DSS requirements" are the provider's responsibility and which are the customer's — [PCI SSC FAQ](https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/what-evidence-is-a-tpsp-expected-to-provide-to-customers-to-demonstrate-pci-dss-compliance/)
- [Documented] Expedia requires connectivity partners to support virtual cards in the booking APIs and to be PCI compliant "where applicable" — [Expedia Connectivity Partner Program](https://developers.expediagroup.com/supply/lodging/cpp/overview)

### Inferences
- [Inferred] The vendor's own staff must stay **out of card data scope**. The ops console must never display a full card number, and anything that can — OTA reservation payloads with virtual cards, support screenshots, session recordings, raw message logs — needs masking at capture. Remote-assistance sessions on a front desk screen are the likely leak.
- [Inferred] OTA virtual cards are the one place a PMS that otherwise never touches cards receives card numbers. Handling them through a payment provider's vault or token service, rather than storing them, keeps the vendor's PCI scope small. This is a design decision the ops console inherits: the operator sees "card on file: token ending 1234", never the number.
- [Inferred] For India, where the desk records cash, card-terminal and UPI payments made on separate devices, the PMS vendor's payment duties are mostly reconciliation support rather than processing: a hotel asks "the guest paid by UPI but the folio shows unpaid". The operator needs the folio's payment entries with who recorded them and when, not gateway logs.
- [Inferred] If the vendor later integrates a gateway, the console needs per property: payment provider account id, KYC state (not started, submitted, verified, rejected, re-verification due), terminals (serial, model, location, last seen), batch or settlement time, and a list of failed captures, open pre-authorisations nearing expiry, refunds pending, and chargebacks with their response deadlines.
- [Inferred] Hotel "card guarantee" and no-show charging depend on charging a stored card without the guest present. Under the Indian rules above this is constrained (token consent with AFA; AFA on recurring charges over ₹15,000), so the product cannot assume the European or US pattern of holding a card and charging later.

| Case | What the hotel reports | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Gateway KYC pending or rejected | "We cannot take cards on go-live" | Every onboarding with integrated payments | P1 near go-live | KYC state and blocking document per property |
| Terminal not pairing or offline | "The machine is not connecting" | Regular | P1 at a busy desk | Terminal registry, last seen, re-pair action |
| Failed capture or expired pre-authorisation | Guest left; charge failed | Regular | P2 | Authorisation list with expiry; retry; reason codes |
| Payment recorded twice or on wrong folio | Cashier error | Frequent | P3 | Payment entries with actor and time; void/refund path with permission |
| Chargeback | Bank disputes a charge | Occasional | P3 with a deadline | Evidence pack: registration card, folio, signature, deadline |
| Change of legal entity | New owner | Rare | P4 | New merchant account and KYC before switch date |

### Gaps
- I did not open the RBI Directions or the e-mandate framework text; all India payment facts here are from secondary summaries. I found no source on UPI-specific settlement or dispute mechanics, on how hotels in India hold card guarantees, or on the widely cited rule that merchants and aggregators may not store card numbers — treat that last point as unverified here.
- No PMS vendor's PCI responsibility matrix was found, and nothing specific on PCI rules for support staff remote access.
- Chargeback volumes and failed-capture rates for hotels were not found.

---

## 6. Tax and statutory compliance the vendor keeps configured (India first)

### Takeaway
India changed hotel GST twice in 2025 — the restaurant "specified premises" test on 1 April and the room-rate slabs on 22 September, the latter announced on 3 September with under three weeks' notice — and replaced Form C with an electronic Form-III under a new immigration law on 1 September 2025. A vendor therefore needs dated, centrally managed tax rule sets that can be rolled out to every property for a given effective date, plus statutory registers and filings (foreign-guest reporting, e-invoicing, state police systems) tracked per property.

### Cited Findings
**India: GST on rooms (effective 22 September 2025)**
- [Documented, snippet; secondary] The 56th GST Council met on 3 September 2025; from 22 September 2025, accommodation with value up to ₹7,500 per unit per day is taxed at 5% without input tax credit (down from 12%); above ₹7,500 it stays at 18% with input tax credit — [ClearTax](https://cleartax.in/s/impact-of-gst-hospitality-industry); [VATupdate](https://www.vatupdate.com/2025/09/22/gst-rate-cut-to-5-for-budget-hotels-under-%e2%82%b97500-restricts-input-tax-credit/)
- [Documented, snippet; secondary] The legal instrument is reported as Notification 15/2025-Central Tax (Rate) dated 17 September 2025 — [Petpooja](https://blog.petpooja.com/?p=47409)
- [Documented, snippet; secondary] The rate follows the per-night value, so a tariff change can move a room category between slabs; the threshold includes extra-bed charges — [TaxGuru on the GST 2.0 hotel changes](https://taxguru.in/goods-and-service-tax/gst-implication-hotel-industry-due-rate-rationalization-gst-2-0-regime.html)
- [Documented, snippet; secondary] Input tax credit attributable to rooms now at 5% must be reversed for supplies from 22 September 2025 — [Masters India](https://www.mastersindia.co/blog/gst-changes-hotel-industry-itc/)
- [Documented, snippet] Industry bodies have asked the Council to restore input tax credit, so the rule may change again — [Business Standard on HRAWI's proposal](https://www.business-standard.com/industry/news/hrawi-proposes-5-percent-gst-hotel-room-rates-itc-benefit-125092401378_1.html)
- [Conflict] Some sources say rooms up to ₹1,000 a day are exempt — [Bajaj Finserv](https://www.bajajfinserv.in/all-about-gst-on-hotel-rooms) — while others describe a flat 5% up to ₹7,500 with no exemption — [ClearTax](https://cleartax.in/s/impact-of-gst-hospitality-industry). I could not settle this from the notification text. Check before configuring the lowest slab.

**India: restaurants in hotels ("specified premises", effective 1 April 2025)**
- [Documented, snippet; secondary] Notification 05/2025-Central Tax (Rate) redefined "specified premises" from 1 April 2025: the test is whether any unit of accommodation was supplied at a value above ₹7,500 per day in the preceding financial year, replacing the old "declared tariff" test; restaurant service at specified premises is 18% with input tax credit, elsewhere 5% without — [Taxmann on the CBIC FAQs](https://www.taxmann.com/post/blog/cbic-issued-faqs-to-explain-criteria-procedures-and-gst-implications-for-restaurant-services-supplied-at-specified-premises/); [Business Today, 2 April 2025](https://www.businesstoday.in/personal-finance/tax/story/18-gst-hits-hotel-restaurants-where-room-tariff-exceeds-rs-7500-per-day-check-details-470411-2025-04-02)
- [Documented, snippet; secondary] Hotels can opt in or out by a declaration filed per premises between 1 January and 31 March, taking effect from 1 April of the next financial year; commentators disagree on whether an opt-in carries forward automatically — [Taxmann on the CBIC FAQs](https://www.taxmann.com/post/blog/cbic-issued-faqs-to-explain-criteria-procedures-and-gst-implications-for-restaurant-services-supplied-at-specified-premises/); [TaxGuru FAQs](https://taxguru.in/goods-and-service-tax/faqs-restaurant-service-supplied-specified-premises.html)

**India: e-invoicing**
- [Documented, snippet; vendor blogs] E-invoicing applies to businesses with aggregate annual turnover above ₹5 crore (since 1 August 2023; unchanged as of mid-2026); from 1 April 2025, taxpayers at ₹10 crore and above cannot report an invoice to the Invoice Registration Portal more than 30 days after its date — [Tally on the e-invoicing limit](https://tallysolutions.com/gst/e-invoicing-limit-india/); [Lookuptax on the 30-day limit](https://lookuptax.com/tax-changes/india/einvoice-30day-limit-10cr-2024)

**India: foreign guests (effective 1 September 2025)**
- [Documented, snippet] The Immigration and Foreigners Act, 2025 and the Immigration and Foreigners Rules, 2025 took effect on 1 September 2025; the Rules supersede the Registration of Foreigners Rules, 1992 among others — [Mondaq summary of the Rules](https://webiis08.mondaq.com/india/general-immigration/1674456/immigration-rules-2025-what-foreign-nationals-carriers-and-businesses-need-to-know); [Rules text hosted by a High Court site](https://www.thc.nic.in/Central%20Governmental%20Rules/Immigration%20and%20Foreigners%20Rules,%202025..pdf)
- [Documented, snippet; local press quoting a police directive] Under the Rules the accommodation keeper must electronically send a completed Form-III, which replaces the old Form C, to the Registration Officer within 24 hours of a foreigner's arrival, through indianfrro.gov.in or its mobile app — [Morung Express on the Dimapur police directive](https://morungexpress.com/dimapur-police-issues-directive-on-foreigners-registration-compliance)
- [Documented, snippet] The duty covers hotels, guest houses, dharamshalas, individual houses, universities, hospitals and institutes that accommodate foreigners — [india.gov.in on online Form C](https://www.india.gov.in/online-form-c-bureau-immigration)
- [Documented, snippet; local press] Goa is reported to be enforcing a penalty of ₹50,000 per unreported foreign guest — [Navhind Times](https://navhindtimes.in/?p=449585). I did not find the national penalty provision.
- [Documented, snippet] Process varies by state — [Airbnb host guide on FRRO and Form C](https://www.airbnb.co.in/help/article/1641)

**India: state police guest reporting**
- [Documented, snippet; press] Gujarat Police's PATHIK (Programme for Analysis of Traveller and Hotel Informatics) tracks guests at hotels, PGs and homestays; over 9,000 hotels in Gujarat were connected by January 2026, when the Ahmedabad Crime Branch signed a pact with UIDAI to integrate Aadhaar verification by consent-based QR scan — [DeshGujarat, 29 Jan 2026](https://deshgujarat.com/2026/01/29/ahmedabad-crime-branch-uidai-ink-pact-pathik-software-integrated-with-aadhaar/); [Lokmat Times](https://www.lokmattimes.com/national/ahmedabad-crime-branch-sets-national-precedent-with-aadhaar-integrated-pathik-software)

**EU**
- [Documented, snippet] Spain: PMS vendors connect to the Interior Ministry's SES.Hospedajes by web service with separate web-service credentials per establishment; Cloudbeds offers an app that creates the required traveller and reservation reports from PMS data — [Cloudbeds SES.Hospedajes](https://myfrontdesk.cloudbeds.com/hc//articles/30627728183835)
- [Documented, snippet] Italy: Alloggiati Web is the State Police portal for reporting guests to the Questura, typically within 24 hours of arrival; a PMS typically exports data in the required format mapped to official code tables — [Smartness integration directory](https://pms-intool.smartness.com/integrations/alloggiati-web)
- [Documented, snippet] Germany: under KassenSichV (in force since 2020) bills must be signed and recorded by a technical security element (TSE); one PMS vendor says the customer contacts the vendor's service team for activation; a hotel with a restaurant typically needs one TSE for the PMS and one for the POS — [Clock fiskaly integration](https://clock-software.com/products/integrations/fiskaly-fiscalization); [SIHOT KassenSichV guide](https://sihot.com/wp-content/uploads/2021/03/KassensichV_V3.pdf)
- [Documented, snippet] Portugal requires certified invoicing software; one PMS added a fiscal middleware provider for it in a product release — [HotelFriend release notes](https://hotelfriend.com/blogpost/product-updates-v-4-12-0)
- [Documented, snippet] A PMS vendor's German compliance page states it "is not a legally approved document" — [Cloudbeds Government Compliance: Germany](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/20108125522971-Government-Compliance-Germany)

### Inferences
- [Inferred] The September 2025 change gave 19 days from announcement to effect and about 5 days from the reported notification date. A vendor cannot rely on each hotel editing its own tax setup. The console needs **versioned tax rule sets by jurisdiction with an effective date**, published centrally and applied to every property in that jurisdiction, with a per-property report of who is on which version, and a preview of the effect on in-house and future stays.
- [Inferred] The effective date applies to the **night of stay**, so a stay spanning 21 to 23 September 2025 has nights taxed under two rule sets. The rule engine must pick the rule by business date of the charge, and night audit must not fail for a property whose rule set is missing a row for that date (ties to section 3).
- [Inferred] Slab-by-value rules create edge cases an operator will be asked about: a discount or extra bed moving a night across ₹7,500; a package with an inclusive rate; a tariff exactly at the threshold. Support needs a "why was this night taxed at X%" explanation on any folio line.
- [Inferred] "Specified premises" is a per-property, per-financial-year status that depends on last year's room values and a filed declaration. It is a property attribute the hotel's accountant sets, with an annual reminder window (1 January to 31 March), not a rate table entry.
- [Inferred] The ops console needs a **statutory profile per property**: GSTIN(s) and state, invoice series per GSTIN and financial year, e-invoicing applicable (yes/no, credentials state), specified-premises status, Form-III portal registration state, state police system (if any) and its submission state.
- [Inferred] Foreign-guest reporting has a 24-hour clock per arrival. A vendor-side view of "arrivals of foreign nationals with no submission after N hours" across properties lets support warn hotels before the deadline. Whether the government portal offers a public API for automated submission is unknown (see Gaps); without one, the PMS produces the data and the hotel submits.
- [Inferred] Statutory integrations are per country and often per state or city. The EU evidence shows vendors handle this through partner middleware (fiscal signing providers, police-report connectors) rather than building each one, and disclaim legal responsibility for configuration.

| Operation | Trigger | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Publish a tax-rule change | Government notification | India: twice in 2025 for hotels; expect at least yearly | P2, hard date | Versioned rule set, effective date, rollout status per property, preview on live stays |
| Wrong tax on issued invoices | Hotel's accountant notices | After every rule change; after rate changes near a slab | P2 | Line-level explanation; list of affected invoices; credit-note and reissue route |
| Invoice series or GSTIN change | New financial year; new registration | Yearly | P3, hard date 1 April | Series and counter view per property; scheduled switch |
| E-invoice failures | Portal rejects or credentials expire | Regular for larger hotels | P2 (30-day limit for larger taxpayers) | Rejection reasons; invoices nearing 30 days unreported |
| Foreign-guest report overdue | Desk forgot or portal down | Daily risk at tourist properties | P2 (24 hours) | Overdue list across properties |
| Police or city register integration | State mandate | Varies by state | P3 | Per-property statutory profile |

### Gaps
- I did not read any CBIC notification or GST Council press release directly; every GST fact is from a secondary summary. The ₹1,000 exemption conflict is unresolved.
- HSN/SAC codes for accommodation and their placement on invoices were not sourced in this session.
- I did not confirm from the Rules text which rule number carries the Form-III duty, the national penalty, or whether the Bureau of Immigration offers an API or bulk upload to software vendors.
- General (non-foreigner) guest register law is state-level (police acts and local orders); I found no consolidated source. Outside Gujarat's PATHIK I found no list of state police systems, and no source says PATHIK is legally mandatory.
- No Indian PMS vendor's announcement of how it rolled out the 22 September 2025 change was found. Indian channel/PMS vendor blogs (Djubo, AxisRooms) covered the change but I did not open them.
- EU city/tourist tax configuration, Italy's fiscal printer rules, and UK and US specifics (US state and local occupancy taxes) were not covered by any source found.

---

## 7. Privacy operations

### Takeaway
The hotel is the controller (India: data fiduciary) and the PMS vendor the processor, so the vendor does not decide erasure but must give the hotel tools and help: find a person, anonymise the profile while keeping invoices, and block erasure while a stay or balance is open. In India the DPDP Rules were notified in November 2025 but the substantive duties — notices, security safeguards, breach notification, retention and rights handling — only start on 13 May 2027; as of late November 2026 only the Board provisions and, since 13 November 2026, the consent-manager rule are in force.

### Cited Findings
**India: DPDP Act 2023 and DPDP Rules 2025 (state at 24 November 2026)**
- [Documented, snippet] The Rules were notified on 13 November 2025 (the government press release is dated 14 November) — [Hogan Lovells](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-); [PIB explainer](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)
- [Documented, snippet] Phasing: Rules 1, 2 and 17 to 21 took effect on notification; Rule 4 (consent managers) on 13 November 2026; Rules 3, 5 to 16, 22 and 23 on 13 May 2027 — the last group includes security safeguards, privacy notices and breach reporting — [Hogan Lovells](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-); [Saga Legal via Legal 500](https://www.legal500.com/firms/237811-saga-legal/c-india/news-and-developments/the-privacy-timer-starts-now-analysing-the-dpdp-rules-and-its-18-month-countdown). One firm gives the end date as 12 May 2027 — [AZB](https://www.azbpartners.com/?p=87811)
- [Documented, snippet] Breach: the data fiduciary must tell the Board and affected individuals "without delay", with a detailed report to the Board within 72 hours (extendable), covering nature, extent, timing, location and likely impact — [EY on the DPDP Rules](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)
- [Documented, snippet] The Act places obligations on data fiduciaries, not directly on processors; fiduciaries must secure compliance through data processing agreements — [India Briefing](https://www.india-briefing.com/news/dpdp-rules-2025-india-data-protection-law-compliance-40769.html)

**EU: GDPR**
- [Statutory text; not re-fetched in this session] Article 28 requires a contract under which the processor acts only on the controller's documented instructions, assists with data subject requests, deletes or returns the data at the end of the service, and gets authorisation for sub-processors — [GDPR Art. 28](https://gdpr-info.eu/art-28-gdpr/)
- [Statutory text; not re-fetched in this session] Article 33: the controller notifies the supervisory authority within 72 hours of becoming aware of a breach; the processor notifies the controller "without undue delay" — [GDPR Art. 33](https://gdpr-info.eu/art-33-gdpr/)

**What PMS vendors actually provide**
- [Documented, snippet] Cloudbeds: an "Anonymize Guest Data" action in the guest profile's privacy menu, enabled only when the guest has no in-house or confirmed reservations and a zero balance and has not already been anonymised; "invoices won't be modified or removed"; irreversible — [Cloudbeds anonymise guest data](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/360004920294-Anonymize-guest-data-and-handle-guests-Personally-Identifiable-Information-PII)
- [Documented, snippet] Infor HMS: data may be kept for legal obligations such as invoices; "Remove Guest Profile Information" is blocked while future bookings, active or pending status, pending invoices or a non-zero folio balance exist — [Infor HMS GDPR overview](https://docs.infor.com/hms/3.8.x/en-us/hmsolh/izi1525665075848.html)
- [Documented, snippet] Stayntouch: erasure is a front-desk action on the guest card (search guest, manage card, remove) — [Stayntouch GDPR deletion](https://stayntouch.freshdesk.com/support/solutions/articles/24000047058-how-to-delete-guest-data-in-accordance-with-gdpr)
- [Documented, snippet] SabeeApp states that as processor it cannot delete data on its own; requests go to the hotel, which weighs legal retention duties such as tax periods — [SabeeApp anonymisation article](https://www.sabeeapp.com/knowledge-base/how-to-anonymise-guest-data-in-sabeeapp-according-to-gdpr)
- [Documented] Channel message logs with raw payloads (which carry guest data) are kept 30 days at one vendor — [Mews channel manager errors](https://help.mews.com/s/article/Understanding-Channel-Manager-errors-in-Mews-Operations)

### Inferences
- [Inferred] A guest who writes to the vendor directly must be routed to the hotel. The operator needs a **"find a data subject across one tenant"** search (by name, phone, email, document number) that returns which properties in that organisation hold the person, without exposing other tenants — and a logged hand-off to the hotel. For a privacy-by-design system that stores encrypted PII, the search has to work on blind indexes and every operator decryption must be logged with a reason.
- [Inferred] Erasure in a hotel is anonymisation with exceptions, as every vendor's tool shows: financial documents stay for the tax retention period; statutory registers (foreign-guest reports, police registers) stay for their own periods; an in-house guest or open balance blocks it. The console needs to show **why** an erasure is blocked and when it will unblock.
- [Inferred] The vendor should be able to issue the hotel an **erasure certificate**: what was erased, what was retained and under which legal basis, when, and by whom. Nothing I read documents a competitor doing this; it is a differentiator and a processor's evidence of acting on instruction.
- [Inferred] **Legal hold** is the opposite control: a flag on a guest, reservation or property that suspends erasure and retention purges (police request, chargeback, litigation, tax audit), with who placed it, why, and a review date. No source documents this for a PMS; it follows from retention duties colliding with erasure requests.
- [Inferred] Breach handling needs, per incident: affected tenants, affected data categories and counts, time of awareness, and a clock. Under GDPR the vendor's clock is "without undue delay" to the hotel so the hotel can meet its 72 hours; under India's rules from 13 May 2027 the hotel must notify "without delay" and file detail within 72 hours, so the vendor's contract must promise faster. The console needs the controller contact for every tenant kept current for exactly this.
- [Inferred] Vendor staff access to guest data is itself processing. Support impersonation, exports and raw payload views need purpose, time limit and an access log the hotel can obtain. Migration imports (section 2) should not bring in profiles older than the hotel's retention period.
- [Inferred] India's timeline means a vendor has until 13 May 2027 to have processor contracts, security safeguards, logs and rights-handling support in place for Indian hotels; hotels will start asking for data processing agreements before then.

| Operation | Trigger | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Access or erasure request reaches the vendor | Guest emails the vendor | Occasional | P3, statutory clock (GDPR: one month) | Tenant-scoped person search; hand-off record to the hotel |
| Hotel asks for help erasing | Hotel cannot complete erasure | Occasional | P3 | Blocking reasons; retained items and legal basis; certificate |
| Legal hold | Police or court request, dispute | Rare | P2 | Place and release hold; list of holds with review dates |
| Tenant offboarding | Contract ends | Per churned customer | P4 with contractual deadline | Export, then deletion with certificate; retention exceptions |
| Suspected breach | Internal detection | Rare | P1 | Affected tenants and counts; controller contacts; notification clock |
| Operator access review | Hotel or auditor asks who viewed data | Occasional | P4 | Access log by tenant, operator, reason |

### Gaps
- I did not read the DPDP Rules text. Details I believe but could not confirm from this session's sources and have therefore left out of Cited Findings: a minimum one-year retention of processing logs, a 90-day ceiling for answering grievances, and the exact content of the security-safeguard rule. One search summary mentioned erasure after a period of user inactivity; I could not confirm scope and it may apply only to specific large platforms.
- GDPR Articles 28 and 33 are cited from the standard text without re-fetching.
- No Mews documentation on erasure tooling surfaced. No vendor documents an erasure certificate or a legal-hold feature.
- UK GDPR and US state privacy law specifics were not researched.

---

## 8. Support model for hotels

### Takeaway
The clearest published benchmark (Mews, SLA v1.5 of 20 March 2024) offers 99.9% monthly uptime, 24x7 ticketing, and a "critical" severity that only covers the whole platform being down — a hotel that cannot check guests in is "high priority" with an 8-hour response on the standard tier. Round-the-clock human phone support for anything below "critical" is a paid add-on. High front-desk staff turnover makes re-training a permanent support load.

### Cited Findings
- [Documented] Mews SLA severity definitions: **Critical** = the system is "completely unavailable"; **High priority** = failure of one or more core functions without full unavailability (examples given: check-in, check-out, taking payments) or production "materially impaired" (slow performance); **General** = errors that do not prevent production, and procedural problems — [Mews SLA v1.5](https://www.mews.com/en/legal/service-level-agreement)
- [Documented] Mews times: Critical 4-hour response and 6-hour resolution (standard), 2-hour response (premium); High priority 8-hour response (standard) or 4-hour (premium) with a shared resolution plan and no fixed resolution time; General 24-hour (standard) or 12-hour (premium) response and no resolution time — [Mews SLA v1.5](https://www.mews.com/en/legal/service-level-agreement)
- [Documented] Mews standard support: 24x7 help desk by ticket, English only; knowledge base and online academy; 24x7 phone by a person "for critical requests only". Premium (paid) adds 24x7 live chat and a 24x7 hotline for all request types — [Mews SLA v1.5](https://www.mews.com/en/legal/service-level-agreement)
- [Documented] Mews uptime: 99.9% monthly; scheduled downtime needs at least 48 hours' notice; exclusions include slowness in reports, search and background jobs, and "communication issues caused by third-party systems, such as channel manager outages"; credit is (99.9 − actual uptime) × 5% of the monthly fee, only on request by the 15th of the following month, and is the sole remedy — [Mews SLA v1.5](https://www.mews.com/en/legal/service-level-agreement)
- [Documented, snippet] Mews Premium Support terms v2.0 took effect 5 July 2025; a Mews support page lists Premium at €299 per month — [Mews Premium Support terms](https://www.mews.com/en/legal/premium-support); [Mews support page (Italian)](https://www.mews.com/it/supporto)
- [Documented] Stayntouch's go-live hand-off includes a roughly 15-minute support training covering the support guide, help desk and how to submit requests, and access to a support portal and knowledge base — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented, snippet; vendor marketing] Front desk turnover is put at 50 to 80% a year, so a 20-person team replaces 10 to 16 staff annually; the same vendor claims about 2 hours to basic competence and about 2 days for full-platform training on its product — [Stayntouch on front desk training time](https://www.stayntouch.com/articles/?p=107)
- [Documented, snippet; vendor marketing] Simulated environments are listed as a training method; walk-ins and group check-ins are described as common sources of front desk errors — [Stayntouch on PMS training](https://www.stayntouch.com/articles/?p=65); [Stayntouch on check-in training](https://www.stayntouch.com/articles/?p=522)
- [Documented] Legacy-system support practice: before skipping a failing night-audit procedure, support must "get the property's consent" — [OPERA End of Day troubleshooting](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/end_of_day_troubleshooting.htm)

### Inferences
- [Inferred] Published severity scales are written to protect the vendor. A hotel-honest scale needs a top level for "one property's front desk is blocked" — cannot check in or out, cannot take or record payment, cannot close the day, keys not cutting at arrival peak — separate from "platform down". The ops console should let support set severity by **operational impact at the property** and show the property's local time and whether it is in arrival or audit hours.
- [Inferred] Likely top ticket categories, assembled from the documented material in the other sections (no vendor publishes a ranked list): (1) how-to questions from new staff; (2) user access — password resets, locked accounts, new joiners, leavers; (3) channel mapping and missing or wrong OTA bookings; (4) billing corrections — wrong folio, void, refund, reissue invoice; (5) night audit and business date; (6) tax and invoice format; (7) rate and availability setup; (8) printers, key encoders and other devices; (9) report figures that do not tie; (10) configuration changes — add rooms, rename room types.
- [Inferred] Per-ticket context the operator needs in one place: property, plan and entitlements, go-live date and whether it is in hypercare, business date and night-audit state, connectivity health, recent configuration changes and who made them, recent incidents affecting it, open tickets, and the contact's role at the hotel.
- [Inferred] Remote assistance must be "view as" with consent, time-limited, logged, and masked for card data and guest identity documents. An operator acting inside a property should be recorded as the operator, not as the hotel user, and should not be able to post money or change a closed day.
- [Inferred] Turnover means training never ends. Useful vendor-side functions: a training property per customer that can be reset; a record of which users completed which training; a "new user this week" signal that predicts tickets; and leaver handling — bulk deactivate a user across a group's properties — because shared and stale logins are a control weakness at a 24x7 desk.
- [Inferred] India-specific: English-only support (the documented benchmark) is a poor fit for small Indian hotels; regional-language phone and WhatsApp-style channels are what local vendors compete on. This is my inference; no source in this session measures it.

| Operation | What the hotel asks | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Access problems | "I am locked out" / "night manager left" | Daily across a fleet | P1 if the only user on shift | User list per property, reset, deactivate, last login |
| How-to | "How do I split this bill" | Highest volume | P3 | Knowledge links by screen; training status of the user |
| Configuration change | "Add 4 rooms / new room type" | Monthly per property | P3 | Guided change with effect on inventory, channels and billing |
| Re-training | New staff, new manager | Ongoing | P4 | Training property reset; training record |
| Complaint about response time | Escalation | Regular | P2 | Ticket history against stated targets |

### Gaps
- No vendor publishes ticket volumes by category; the list above is inferred. I did not open Mews's "customer support is broken" blog or the Hospitality Net training article, only saw their titles.
- I found no published support SLA from Cloudbeds, Stayntouch, Hotelogix, eZee, IDS Next, WINHMS, RMS or Oracle in this session.
- No source on remote-assistance tooling or consent practice at PMS vendors.

---

## 9. Hardware and local integrations

### Takeaway
A cloud PMS reaches on-premise devices — lock encoders, PBX, POS, printers, scanners — through a small local connector or a dedicated interface PC, and most device tickets come down to that connector being down, a wrong address or port, or an identifier or room-number mismatch between the PMS and the device vendor's software. The vendor needs a registry of what is installed where and whether it is alive.

### Cited Findings
- [Documented] One vendor's onboarding requires "a dedicated onsite PC" for interfaces, meetings with PBX, POS and key vendors, and interface testing before go-live; the hotel emails each interface vendor itself — [Stayntouch onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000013054-stayntouch-pms-onboarding-detailed-outline)
- [Documented] Mews go-live: connect and test printers and key cutters before check-ins begin, and check the device command queue for errors — [Mews go-live tasks](https://help.mews.com/s/article/what-are-the-go-live-tasks-for-properties-changing-pms)
- [Documented, snippet] Mews key cutter troubleshooting: the encoder must be selected in the local connector integration; room numbers must be mapped if formats differ between the lock software and the PMS — [Mews key cutter troubleshooting](https://help.mews.com/s/article/how-to-troubleshoot-your-key-cutter-integration)
- [Documented, snippet] A connection error "most likely" means the IP address or port in the key cutter settings is invalid or the lock server application is not running — [Mews: connector cannot reach lock software](https://help.mews.com/s/article/mews-connector-app-cannot-reach-lock-software)
- [Documented, snippet] "Encoder does not exist": the identifier in the PMS must match the encoder's identifier or name in the lock software — [Mews: encoder does not exist](https://help.mews.com/s/article/encoder-does-not-exist)
- [Documented, snippet] Cloudbeds' first steps for a Salto fault: check the right encoder is selected, then restart the local bridge service — [Cloudbeds Salto troubleshooting](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/37744391354907-Salto-Space-Troubleshooting)
- [Documented, snippet] A lock vendor's own first step for "encoder is not available" is to restart its server and the front desk computers — [dormakaba Ambiance encoder offline](https://kb.dormakaba.com/hc/en-us/articles/43082737279643-Ambiance-Encoder-Offline-Troubleshooting)
- [Documented, snippet] Oracle's on-site interface application connects on-premise vendor systems to the PMS, and Oracle publishes lists of certified third-party interfaces — [Oracle property interfaces](https://docs.oracle.com/cd/F29336_01/doc.201/f27480/c_property_interfaces.htm); [Oracle integration partners](https://www.oracle.com/hospitality/pms-pos-integration-partners/)
- [Documented, snippet] One vendor publishes a full listing of 100+ interfaces and integrations — [RoomKeyPMS interface listing](https://roomkeypms.com/news/roomkeypms-publishes-full-listing-of-100-system-interfaces-integrations/)
- [Documented, snippet] Key cards can stop working earlier or later than expected, a documented support topic (key validity versus reservation times) — [Mews key card timing](https://help.mews.com/s/article/Why-does-the-key-card-stop-working-earlier-later-than-expected)

### Inferences
- [Inferred] The console needs a **device and integration registry per property**: integration type (lock, PBX, POS, payment terminal, printer, scanner, fiscal device), vendor and model, software version, local connector version, the host it runs on, network address and port, identifiers as known to both sides, room-number mapping, status and last heartbeat, last error, and the third-party vendor's support contact.
- [Inferred] A key encoder failing during the arrival peak is a **P1** for the property even though nothing is wrong with the cloud service. Triage is three questions the registry should answer without a phone call: is the local connector reporting in; did the PMS send the command; did the lock software answer with an error.
- [Inferred] Most resolution is on the lock or PBX vendor's side. The operator's job is to prove where the fault sits (command log with timestamps and responses) and hand over cleanly, so the registry should store the hotel's contract and contact for each third party.
- [Inferred] Local connectors need fleet management: version inventory, remote restart, staged updates, and alerts when a connector has not reported in during the property's operating hours.
- [Inferred] For small Indian hotels the realistic device set at first is a receipt/A4 printer and standalone card and UPI devices, with locks often offline. The registry should not assume a lock interface exists; it should record "none" explicitly so support does not chase it.

| Case | What the hotel reports | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Keys not cutting | "Cannot make keys" | Regular at properties with lock interfaces | P1 at arrival time | Connector heartbeat, command log, encoder identifiers, lock vendor contact |
| Key expires at wrong time | Guest locked out | Occasional | P2 | Key validity rule against reservation times |
| POS charge not on folio | Restaurant bill missing | Regular where POS is interfaced | P2 before checkout | Interface message log by room and time |
| Printer or document format | Registration card or invoice will not print | Frequent | P3 | Template and device assignment per workstation |
| Connector offline after a Windows update or PC swap | Everything local stopped | Occasional | P1 to P2 | Host inventory, reinstall and re-pair steps |

### Gaps
- No source on passport or ID scanners, PBX call accounting, or energy and room-control systems surfaced.
- No public description of how any vendor's internal device registry works; the registry design is inferred from the troubleshooting articles.
- Nothing India-specific on lock and PBX brands common in pilot-size hotels.

---

## 10. Commercial operations specific to hotels

### Takeaway
Hotels change hands, close for seasons and change room counts, and each of these is a vendor operation rather than a billing tweak. A change of legal entity is the hard one: one vendor's stated experience is that a fresh account for the new entity "has proven to be the superior solution", with configuration copied, future reservations imported, payment KYC redone, and the old account kept read-only for audits.

### Cited Findings
- [Documented] Legal-entity change, option 1 (keep the account): no new setup, but reservations spanning the transition "must be split into two invoices, one per entity"; prepayments taken by the old entity for later stays "cannot be directly transferred"; receivables must be collected by the entity that issued the invoice; statutory reports become inconsistent unless revenue is separated by entity — [Clock PMS legal entity change](https://support.clock-software.com/en/support/solutions/articles/9000269223-changing-legal-entities-considerations-you-can-t-overlook)
- [Documented] Legal-entity change, option 2 (new account): the clearest regulatory position; the vendor copies configuration, pricing and structures, imports future reservations up to the transition date, re-establishes integrations and fiscal services, and supports activation; the new entity needs a new fiscal account and typically new payment-provider KYC; the hotel can keep read-only access to the old account for a small monthly fee for disputes and tax audits — [Clock PMS legal entity change](https://support.clock-software.com/en/support/solutions/articles/9000269223-changing-legal-entities-considerations-you-can-t-overlook)
- [Documented, snippet] SiteMinder and Little Hotelier have a "change of ownership" request submitted by the current account holder that transfers the account "and chosen data" to a new owner without cancelling it — [SiteMinder change of ownership](https://help-platform.siteminder.com/en/articles/9856974-request-a-change-of-ownership); [Little Hotelier change of ownership](https://help-platform.littlehotelier.com/en/articles/10390494-how-to-request-a-change-of-ownership)
- [Documented, snippet] Another small-property vendor suggests the new owner "inherit the existing account with all historical and future bookings" — [Preno change of ownership](https://help.prenohq.com/en/articles/2642269-preno-account-changing-of-ownership)
- [Documented, snippet] An OTA asks for a copy of the ownership transfer agreement to update its records — [Agoda Partner Hub](https://partnerhub.agoda.com/ms-my/?p=1806)
- [Documented, snippet] Seasonal hold: Little Hotelier lets a property place its subscription on hold; it is not available on the entry plan, and only a user with billing permission can request it — [Little Hotelier subscription hold](https://help-platform.littlehotelier.com/en/articles/10383014-how-to-place-your-little-hotelier-subscription-on-hold)
- [Documented, snippet] Per-room pricing does not fall automatically with occupancy; contracts differ on charging per installed room or per occupied room-night — [Smart Order on seasonal PMS pricing](https://www.smartorder.ai/resources/guide/w46-smartorder-en-03-424588c4)
- [Documented] Reopening after a closure: a legacy PMS runs multiple consecutive end-of-day processes to bring the business date forward, on the conditions that all guests are checked out, none are due before the target date, no blocks start in between, and no folios are open — [OPERA Change Business Date](https://docs.oracle.com/cd/E53533_01/opera_5_5_1_0_core_help/live_date.htm)
- [Documented, snippet] Oracle publishes a hotel-closure PMS checklist that recommends producing downtime reports and exporting affected guests' contact details — [Oracle hotel closure PMS checklist](https://oracle.com/a/ocom/docs/industries/hospitality/hosp-hotel-closure-pms-checklist.pdf) (the file returned HTTP 403 to me; this is from the search summary)
- [Documented, snippet] Premium support is sold as a flat monthly add-on (€299 a month at one vendor) rather than per room — [Mews support page (Italian)](https://www.mews.com/it/supporto)

### Inferences
- [Inferred] **Transfer of a property between legal entities or chains** is a named ops console workflow with a transfer date: (1) verify the request comes from the current owner and the new owner (ownership document, as the OTA practice shows); (2) decide copy-to-new-tenant versus hand-over-in-place; (3) on the date, close the old entity's books — final night audit, all in-house folios cut, invoices issued under the old tax registration; (4) open under the new entity with new tax registration, invoice series, payment merchant account and statutory portal logins; (5) carry future reservations across, with deposits handled as a liability the two parties settle between them rather than silently moved; (6) leave receivables with the old entity; (7) change users and owners' access at the cut-over minute; (8) keep the old entity's data read-only for the retention period.
- [Inferred] Guest personal data does not automatically follow the business. Whether the new owner may receive guest history depends on the sale agreement and privacy law, so the transfer workflow needs an explicit choice (carry profiles, carry only future reservations, carry nothing) and a record of who authorised it.
- [Inferred] A **management-company change** (same owner, new operator) is lighter: tax registration stays, but users, roles, reporting hierarchy and possibly brand and rate structure change.
- [Inferred] **Rebranding** touches: property name on documents, invoice header and logo, sender names on guest messages, channel listings (often a new listing id with the old one retired), and the booking engine address. It needs a dated switch so documents issued before the date keep the old name.
- [Inferred] **Adding or removing rooms** is an inventory change and a billing change at once: availability for all future dates, channel allotments, housekeeping sections, lock mapping, and the per-room subscription count from an effective date. Removing a room with future assignments must be blocked or must force reassignment first.
- [Inferred] **Seasonal suspension** needs a state between active and cancelled: no new bookings before the reopening date unless the hotel wants advance sales; channels closed or left open for the next season; night audit paused or auto-rolled; scheduled reports and alerts muted; reduced or paused billing by contract; and a reopening checklist (roll business date, room status reset, users reactivated, connectivity and devices tested, tax rules current). Monitoring must not page anyone for a dormant property.
- [Inferred] **Multi-property groups** add operations a single-hotel panel lacks: add a property to an existing organisation; move a property between organisations; group-wide users and roles; group billing (one invoice, per-property lines); copying configuration from a template property; and central guest profiles under one controller.

| Operation | Trigger | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Ownership or entity change | Sale, restructuring, new GST registration | A few per hundred properties per year | P4 with a hard date | Dated transfer workflow; verification; old tenant read-only |
| Management change | New operator | Similar | P4 with a hard date | Bulk user and role swap at a set time |
| Rebrand | New flag or name | Rare | P4 | Dated name and document switch; channel relisting tracker |
| Room count change | Renovation, extension | Yearly for some | P3 | Effective-dated inventory and billing change with checks |
| Seasonal close and reopen | Hill and beach properties | Yearly per seasonal property | P4; P2 if reopening fails | Suspended state; reopening checklist |
| Subscription dispute | "We were closed, why billed" | Regular | P3 | Room count and state history used for billing |

### Gaps
- No source describes how a vendor verifies an ownership change, what happens to guest personal data on a sale, or how deposits are settled between seller and buyer.
- No public per-room price lists were read; pricing norms for Indian independents were not found.
- Nothing found on rebranding procedures or on moving a property between chains inside one vendor.

---

## 11. Downtime procedures

### Takeaway
Hotels are told to keep a fresh set of "downtime reports" — arrivals, in-house, departures, room status, guest balances — produced automatically on a schedule and emailed or printed, and to run the desk on paper during an outage, then re-enter everything. The vendor's part is to make those reports arrive without anyone remembering, to publish a status page, to announce maintenance in advance, and to help reconcile afterwards.

### Cited Findings
- [Documented, snippet] Oracle's OPERA Cloud guide suggests setting up "Downtime Reports" as a shift-report bundle for unplanned power or data outages, covering arrivals, in-house guests, departures, housekeeping room status and guest ledger balances; shift reports can be generated automatically on a schedule and emailed as a PDF attachment — [OPERA Cloud shift reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.3/ocsuh/t_reports_configuring_shift_reports.htm)
- [Documented, snippet] A known failure mode: "scheduled reports will not be generated if the user who scheduled them becomes inactive" — [OPERA Cloud scheduled reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.3/ocsuh/t_reports_manage_scheduled_reports.htm)
- [Documented] Cloudbeds tells hotels to download or print daily, as part of night audit: in-house guest list, expected arrivals, expected departures, VIP list; room status, housekeeping list, maintenance work orders; current guest folios, deposits and prepayments, city ledger/receivables summary, cashier shift report; and to print registration cards daily — [Cloudbeds: preparing for maintenance and outages](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/9010869663259-Preparing-for-scheduled-maintenance-to-your-Cloudbeds-PMS)
- [Documented] During an outage, the same article says: rule out local causes; contact support; brief staff; prioritise urgent arrivals such as VIPs and groups; record guest details and check-ins by hand; keep paper copies of transactions and payments; take payments on the gateway manually and keep receipts; tell guests. Afterwards: enter all manual records and record payments from the receipts — [Cloudbeds: preparing for maintenance and outages](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/9010869663259-Preparing-for-scheduled-maintenance-to-your-Cloudbeds-PMS)
- [Documented] The vendor side in that article is a public system status page and a support request form — [Cloudbeds: preparing for maintenance and outages](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/9010869663259-Preparing-for-scheduled-maintenance-to-your-Cloudbeds-PMS)
- [Documented] Mews commits to at least 48 hours' notice of scheduled downtime and says it has not needed any because updates are zero-downtime; third-party failures such as channel manager outages are excluded from downtime — [Mews SLA v1.5](https://www.mews.com/en/legal/service-level-agreement)
- [Documented, snippet] During a provider outage OTA bookings keep arriving: Booking.com emails the hotel directly when the provider has not retrieved a reservation within 30 minutes — [Booking.com missing reservation messages FAQ](https://developers.booking.com/connectivity/docs/con-faq-reservations-missing-res-messages)

### Inferences
- [Inferred] Downtime reports should be a **vendor-run service, not a hotel setting**: generated per property on a fixed schedule (for example every few hours and at night audit) and delivered somewhere that survives the outage — email to the property's addresses, and ideally a copy cached on the front desk device. The documented failure where reports silently stop when the scheduling user leaves is exactly why the schedule should belong to the property, not to a user.
- [Inferred] The ops console should show, per property, **when the last downtime pack was produced and delivered**, and alert on a stale one. During an incident the operator should be able to push a fresh pack to every affected property from a replica or the last good snapshot.
- [Inferred] The pack contains guest names, room numbers and balances. Emailing it is a privacy exposure the hotel must accept knowingly; it should go to named recipients, be minimal, and never include identity document numbers or card data.
- [Inferred] Incident communication is an operator function: one incident record linked to the affected properties, a status-page entry, and a message to each property's on-duty contact by a channel that does not depend on the PMS (SMS or a messaging app). For Indian pilots that channel matters more than a status page.
- [Inferred] Recovery is where data goes wrong: staff re-enter a night's check-ins, charges and payments after the fact. The vendor should provide a **catch-up mode** — entries stamped with the real event time and the entering user, the night audit for the affected business date held until the hotel confirms catch-up is done, channel availability resent, and OTA bookings that fell back to email reconciled against what was retrieved.
- [Inferred] A local internet or power failure at one hotel is far more common than a platform outage, particularly in India, and looks identical to the desk. The same downtime pack and catch-up mode serve both; the operator's first job is to tell which it is (is the property's last request time stale while the platform is healthy?).

| Operation | Trigger | How often [Inferred] | Urgency | Operator needs |
|---|---|---|---|---|
| Downtime pack delivery | Schedule | Several times a day per property | P3 if stale | Last-produced and last-delivered time per property; resend |
| Platform incident | Outage or degradation | A few a year | P1 | Affected-property list; status page; out-of-band broadcast |
| Single-property connectivity loss | Local ISP or power | Frequent | P1 for that hotel | Last-seen time; confirm platform healthy; send pack by SMS/email link |
| Scheduled maintenance | Vendor change | Rare if deploys are zero-downtime | P4 | Advance notice (48 hours is the published norm), by property time zone, avoiding audit and arrival hours |
| Post-outage catch-up | After any outage | After each | P2 | Catch-up mode; held night audit; channel resync; fallback-booking reconciliation |

### Gaps
- No HTNG, AHLA or HFTP downtime-procedure publication was found in this session.
- No vendor documents a guaranteed "emergency report" service level, an offline mode, or how back-entered transactions are timestamped after an outage.
- I could not open Oracle's closure checklist PDF (HTTP 403).
