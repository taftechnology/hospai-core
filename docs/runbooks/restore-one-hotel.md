# Runbook: restore one hotel to a point in time

**Written:** 2026-11-25. **Owner:** the HospAI owner. **Spec:**
[restore drill](../superpowers/specs/2026-11-25-property-restore-drill-design.md). **Command:**
`ops.restore_property`, Ops Console, hotel health page, **Restores**.

This rewinds **one hotel** (its PropertyDO) to an earlier moment using Cloudflare point-in-time
recovery, and can undo that restore. It does not touch the customer's other hotels or the customer's
guest vault (OrgDO).

## When to use it

- A bad deploy or a bad bulk change (rates, restrictions, room moves, a wrong bulk status) at one hotel,
  noticed within 29 days, and fixing it forward by hand is worse than losing everything since.
- The staging drill below, before the first hotel goes live.

Do **not** use it to recover one reservation or one folio. Fix those in the hotel app. A restore throws
away **everything** the hotel did after the chosen time.

## What the platform refuses

- You are not an `ops_admin` (a viewer sees the ledger only).
- The customer is not **suspended**. Suspension stops staff writes so nothing races the restore.
- The time is later than now, or more than 29 days ago (Cloudflare keeps 30; one day of margin).
- The time is at or before the newest purge certificate of this customer (any erasure or purge). A
  restore never crosses one. Pick a later time.
- The hotel is purging or purged, or another restore of this hotel is unfinished.
- The hotel id you type does not match.

## Steps in the Ops Console

1. **Suspend** the customer (customer page, Suspend, with a reason). The hotel's staff cannot write now.
2. Open the hotel (customer page, the hotel's health page). Under **Restores** press
   **Restore to a point in time**.
3. Choose the date and time **on the hotel's own clock** (the dialog names the time zone). Read the
   warning, type the hotel id, give a reason (the hotel can see it) and a ticket reference, and submit.
4. Wait for **Done**. The request waits a few seconds for the hotel to restart and then runs the fence
   (see below). If it says the hotel has not finished restarting, send the same request again (press
   the button again without changing anything): it finishes the fence and does not restore twice.
5. **Check the hotel** before reopening it: business date, today's arrivals and departures, room rates
   for the next week, the front desk board. Compare with what you expect at the chosen time.
6. **Reinstate** the customer (customer page, Reinstate).

If the restore was the wrong one, go to step 7 while the customer is still suspended.

7. **Undo**: in the Restores table the newest finished restore has **Undo**. It puts the hotel back as
   it was just before that restore (everything the hotel did in between is lost again), with the same
   checks except the purge floor (undo goes forward in time). Only the newest finished restore can be
   undone, and only once. If the customer is already reinstated, suspend it again first.

## What the fence does (so you know what you are looking at)

After the restart the hotel is made safe to reuse in one step: the ARI version is set above anything
written before the restore (so cached availability is never read as current), the event sequence is
raised above what consumers already saw, and one `property.restored` event is published. The next
availability read rebuilds the ARI cache. Nothing else changes.

## What a restore does not fix: reconcile by hand

Tell the hotel which business dates to re-check, and reconcile each of these yourself:

1. **Money at the payment provider.** Payments, captures, refunds and voids after the restore time
   already happened at the provider. The restored folios do not know them.
2. **Invoices issued** (and IRN numbers registered) after the restore time. They exist at the tax
   portal and in the customer's records.
3. **The customer's guest vault** (OrgDO): guest records, Form C submissions, uploaded documents,
   purge certificates. These are not rewound, on purpose (rewinding could bring back erased data).
4. **R2 documents and the event log**, **accounting journal exports** and **Form C filings** sent after
   the restore time.
5. **Events already delivered.** Other stores (head-office rows, ARI cache) were updated from events the
   restored hotel no longer has. The head-office row refreshes from `property.restored`. Anything else that
   keeps its own copy needs a manual check.
6. **Night audit.** If the restore crosses a business-date roll, the hotel's open date moves back and the
   next audit runs from there. Check the business date on the health page and that the audit runs.
7. **Staff and guests.** Reservations, check-ins and folio postings the hotel made after the restore time
   are gone. The hotel must re-enter what it still needs.

## If something goes wrong

- **"Another restore is unfinished".** The ledger shows a row that is Starting or Applied, finishing.
  Send the original request again to finish it. A row stuck at Starting for more than a few minutes means
  the request died before the hotel answered: ask the owner to look at the `property_restore` row in
  Platform D1 (the row can be set to `failed` there) and then retry.
- **"No restore point for that time".** Cloudflare has no bookmark that far back. Choose a later time.
- **The hotel does not answer.** A restore restarts the hotel for a moment. Wait a minute and send the
  same request again.

## Staging drill (before the first hotel goes live)

Done once on staging, with the owner's go. Use a staging customer that has the demo hotel.

1. In the staging hotel app, note today's front desk board and one room rate. Write down the time (on the
   hotel's clock).
2. Make a visible bad change: change one room type's rate for the next 7 days, and make one test booking.
3. Suspend the staging customer in the staging Ops Console.
4. Restore to the time you wrote down in step 1, reason "restore drill", ticket "DRILL".
5. Reinstate. In the hotel app confirm the rate is back to what you noted, and the test booking is gone.
6. Look at the Restores table: one restore, **Done**. In the hotel's Settings, **HospAI account changes**
   shows "Hotel restored to an earlier time".
7. Check the events queue consumer did not fail: the head-office row for the hotel still loads.
8. Suspend again and **Undo**. Reinstate and confirm the bad change and the test booking are back.
9. Try a time older than 29 days and a time before a test erasure: both must be refused in words.
10. Record the date, the operator and anything surprising at the bottom of this file.

## Drill log

**2026-11-25, staging, operator iamabdus (ticket DRILL), commit `9f7eb81`.** Hotel `prop_staging`
(The Meridian Seattle, America/Los_Angeles) of `org_staging`.

- Before: BAR had no rates for the next two weeks; no arrivals on 26 Nov. Restore point 12:00 hotel time.
- Bad change at 12:01–12:02: King Deluxe BAR set to $289.00 for 25 Nov–1 Dec (bulk fill), and a confirmed
  King Deluxe booking for 26 Nov ("Restore Drill Test").
- Restore to 12:00 answered **Done** in under 10 seconds. While suspended and after reinstating, the rates
  were gone and 26 Nov had no arrivals. A King Deluxe quote for 26 Nov said no published rate, so the ARI
  cache was not served stale. The hotel's Settings → Logs showed "Hotel restored to an earlier time".
  The hotel's own audit log for the day was empty (the bulk-fill entry was rewound too, as expected).
  Oldest pending event went from "Under a minute" to none, so the queue consumer took `property.restored`.
- Undo answered **Done**; after reinstating, the $289 rates and the booking were back. Neither row offers
  Undo afterwards.
- A restore to 20 Oct was refused: "That is more than 29 days ago."
- **Not run:** the purge-floor refusal (staging has no test erasure for this customer; covered by the
  `ops-restore` tests), and the head-office row check (HospAI Staging is on starter, without
  `pms.multi_property`).
- **Left on staging:** the bad change, by design of step 8: KDX BAR $289 for 25 Nov–1 Dec, the
  26 Nov booking, and its guest record in the vault (not rewound, as the warning says).
- **Surprise:** the restore details in Settings → Logs and in the Ops Console operator actions show
  `targetTime` as epoch milliseconds (`1795636800000`) and internal restore ids, not a time on the
  hotel's clock.
