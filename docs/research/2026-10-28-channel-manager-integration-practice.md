# Channel manager integration — industry practice

**Researched:** 2026-10-28 · **Purpose:** how PMS-to-channel-manager connections work across the industry, so roadmap **R4.3** (a connector to a third-party channel manager, [`ARCHITECTURE.md` §16.6](../../ARCHITECTURE.md)) follows the same rules the channel managers certify against.

## Read this first

- Everything here comes from public vendor documentation: SiteMinder (pmsXchange, SMX), RateGain (RG Bridge), Channex, and partner pages for STAAH. Nothing has been tested against a live channel manager.
- The [findings for R4.3](#what-this-means-for-r43) section lists where the slice as written matches this practice and where it does not. Of its three forks, the first (bookings with no availability) was decided on 2026-10-28; card data and per-occupancy prices remain open.
- STAAH, eZee Centrix and AxisRooms do not publish their PMS API documentation; a PMS partner gets it through their partner or property support teams.

## The model

```
PMS  ── ARI (availability, rates, restrictions) ──▶  Channel manager  ──▶  OTAs
PMS  ◀── reservations (new / modified / cancelled) ──  Channel manager  ◀──  OTAs
```

- **The PMS is the source of truth for availability.** It pushes availability, rates and restrictions; reservations flow back from the OTAs through the channel manager.
- **One system masters rates.** Rates come from the PMS, or from the channel manager or a revenue management system — not both. SiteMinder warns that manual edits in the channel manager for data a connected PMS already manages "could result in incorrect data".
- **The channel manager owns the OTA side:** OTA connections and certification, listing content, and translating to each OTA's own codes and rules.
- **The two-way connection is the norm in India too:** IDS Next and Clock PMS+ describe their STAAH integrations as inventory out of the PMS and OTA bookings back in.

## Message formats

- **OpenTravel (OTA) XML** is the long-standing standard. The three messages a PMS uses:
  - `OTA_HotelAvailNotifRQ` — availability, inventory and restrictions
  - `OTA_HotelRateAmountNotifRQ` — rates (and inclusions) for one room type at one hotel
  - `OTA_HotelResNotifRQ` — one reservation per message
  
  SiteMinder pmsXchange and RateGain RG Bridge both use them, over SOAP.
- **JSON REST** is the newer style. Channex is JSON; it splits availability and rate-and-restriction updates into separate messages.
- **Vendor specifics vary** even on the same OTA messages — required fields, error codes and retry rules differ, so each channel manager is its own adapter.
- **Some vendors split the interfaces:** SiteMinder's pmsXchange (ARI) and SMX (reservations) are separate products with separate hotel codes, built separately.

## ARI — availability, rates, restrictions

| Practice | Source |
|---|---|
| **Full refresh only when a hotel first connects; deltas after that.** Refreshes otherwise "only under exceptional circumstances". | SiteMinder pmsXchange |
| **Delta updates are required in production** for availability, restrictions and rates. | SiteMinder SMX |
| **Timed full syncs are not accepted** for certification. A full sync is allowed at most once every 24 hours, off-peak. | Channex certification |
| **Batch changes per property**, sent immediately or every 30–60 seconds; 100 days of one plan's prices is one call, not 100. Messages under 10 MB. | Channex |
| **A queue or rate limiter is required** so the PMS never floods the API. | Channex certification |
| **Messages are processed FIFO**, one at a time — order matters. | Channex |
| **Codes are per integration**, not fixed by the channel manager. A message with an unmapped room or rate code fails (SiteMinder error 783). | SiteMinder |
| **Restrictions:** stop sell, min / max stay (usually applied on arrival), closed to arrival, closed to departure. Some channels do not accept every restriction. After a new mapping, restrictions do not carry over — the PMS must push them again. | SiteMinder help |
| **Derived rates:** anchor on a flexible base rate and derive other plans as percentage or fixed offsets; standalone prices drift. | SiteMinder help, SmartOrder |

## Reservations

| Practice | Source |
|---|---|
| **Push is recommended**: the channel manager posts reservations to a PMS endpoint as they happen. **Pull** is the alternative: the PMS polls every 2–5 minutes. | SiteMinder pmsXchange FAQ |
| **Save durably, then acknowledge.** A webhook's HTTP response and the booking acknowledgement are separate actions. Acknowledge only after the save succeeds, so an acknowledged booking is guaranteed to be in the PMS. | Channex |
| **Unacknowledged bookings are resent**: Channex repeats for 30 minutes, then emails a warning; SiteMinder SMX retries every 30 seconds up to 3 times, then its support team flushes and resends. | Channex, SiteMinder SMX |
| **Idempotent on booking id plus revision id**, so a repeated delivery never creates a duplicate reservation or deducts inventory twice. | Channex |
| **Modifications and cancellations arrive as new revisions** of the same booking. | Channex |
| **Accept every reservation status and respond with success.** | SiteMinder SMX |
| **One reservation per message**; the response carries the PMS's own confirmation number. On error, the reservation stays in the retry cycle until the error is fixed. | RateGain, SiteMinder |
| **Do not re-pull all bookings as a safety net.** | Channex |

### Bookings with no availability

An OTA booking is already confirmed to the guest by the time it reaches the PMS. Vendor guidance treats the over-sold booking as something the PMS **accepts and then resolves** — move or upgrade the guest, or walk them, and fix the inventory — not something it rejects. Overbookings are a known limitation of every channel manager; most come from sync lag (around two minutes), mapping errors or manual changes on an OTA extranet. No source names a standard for a PMS refusing an OTA-confirmed booking.

## Card data

- OTAs pass guest card details, or a **virtual card** for OTA-collected bookings, inside the reservation.
- **SiteMinder never sends card number and CVV in the same message** (PCI). The hotel reads the CVV on the OTA extranet.
- **Tokenisation proxies** are the standard way for a PMS to avoid holding card numbers: the proxy pulls the reservation, tokenises the card and passes the booking on with a token. SiteMinder supports PCI Proxy, Shift4 (4res) and FreedomPay; MONEI offers the same for SiteMinder and Channex. The PMS signs with the proxy and each hotel authorises it.

## Certification

Channel managers certify a PMS before production access. Channex publishes its scenarios:

1. full sync (500 days, all rooms and rates, in two calls)
2. single-date and multi-date price changes, single and multiple rate plans, in one call
3. min stay, stop sell and combined restrictions in one call
4. a six-month rate and restriction update
5. single-date and date-range availability changes
6. **create, modify and cancel a booking, then acknowledge it**
7. a queue or limiter staying inside rate limits
8. deltas only, not timed full syncs
9. a note on supported restriction types, room and rate support and **card-data handling**

Evidence is task ids and booking evidence, then a live screen-share review. A successful API call alone is not certification.

## What this means for R4.3

### Already matches

- Outbox-driven ARI push on `availability.changed`, inside the ≤ 2 min freshness SLA.
- Booking receipt onto the existing reservation commands, idempotent on the channel manager's booking id plus version.
- Per-property mapping and an unmapped-booking queue.
- `SECRET`-class credentials; one adapter contract so a second channel manager is a new adapter.

### To add to R4.3

- **Full sync on connect and on operator request only; deltas after.** At most one scheduled reconciliation sync per 24 hours, off-peak — never a timer-driven full push.
- **Batching and a rate limiter** per property, preserving order (FIFO); bulk pushes in the `BULK` lane.
- **Acknowledge only after the reservation is committed** in the PropertyDO.
- **Push and pull both supported**, per channel manager: a Worker endpoint for push, a scheduled poll (2–5 minutes) for pull.
- **Re-push restrictions after any mapping change.**
- **Certification** against the chosen channel manager's scenarios is part of done, not only a go-live step.

### Forks — decide before building R4.3

1. **No availability on an OTA booking — decided 2026-10-28:** accepted as an overbooking, as recommended below; see `ARCHITECTURE.md` §7.1 *Channel-delivered bookings*. Before the amendment, `ARCHITECTURE.md` §7.1 said the channel manager "translates [reject-on-commit] to the OTA's own rejection semantics". Industry practice is the opposite for OTA bookings: the booking is already confirmed, so the PMS accepts it. The likely answer is to accept it beyond the `allow_overbooking` allowance, still through the `availability_day` ledger (oversell, not a reservation scan), and raise an overbooking exception on the workbench for the desk to resolve. That changes an inventory rule, so it needed an `ARCHITECTURE.md` amendment first. The booking engine (**R4.2**) keeps reject-on-commit, because nothing has been promised to its guest yet.
2. **Card data.** HospAI must never store a card number or CVV (roadmap *Blocked*). The options are a tokenisation proxy, a channel manager setting that strips card data before delivery, or relying on the OTA extranet for cards. Decide with the channel manager the client picks; tie it to **R1.20** (guarantee without card number) and **R4.18** (tenders).
3. **Per-occupancy prices.** Many OTAs price by number of guests. HospAI's rate plans have no per-occupancy price today (no such field in the code as of 2026-10-28). This is **not** the banned occupancy-*pricing* UI (yield by hotel occupancy) — it is a price per number of adults. Confirm what the client's channels need before R4.3; if they need it, it is a rate-plan change with its own slice.

### Test bed

**Channex** publishes its PMS API, best-practices guide and certification scenarios openly, which makes it a candidate test bed for R4.3, in the same role Loyverse and URY play for the POS connector. Its sandbox terms have not been checked. Like the POS test beds, it proves our side of the contract; the client's channel manager still needs its own adapter.

## Sources

- [RateGain RG Bridge — availability and rates notification](https://developer.rategain.com/our-products/channel-manager/rg-bridge-supply-push/interface-specifications-availability-and-rates-notification-service)
- [RateGain — OTA_HotelAvailNotifRQ](https://developer.rategain.com/our-products/channel-manager/rg-bridge-supply-push/interface-specifications-availability-and-rates-notification-service/operations/availability-notification/ota_hotelavailnotifrq)
- [RateGain — OTA_HotelResNotifRQ](https://developer.rategain.com/our-products/channel-manager/rg-bridge-supply-push/interface-specifications-reservation-notification-service/operations/reservation-notification/ota_hotelresnotifrq.md)
- [SiteMinder — PMS Inventory API](https://siteminder.atlassian.net/wiki/x/Fkof)
- [SiteMinder — pmsXchange FAQ](https://developer.siteminder.com/siteminder-apis/pms-rms/introduction/pmsxchange/faq)
- [SiteMinder — pmsXchange technical guide](https://developer.siteminder.com/siteminder-apis/pms-rms/introduction/pmsxchange/technical-guide)
- [SiteMinder — SMX FAQ](https://developer.siteminder.com/smx-api/additional-resources/faq)
- [SiteMinder — SMX availability and rates](https://developer.siteminder.com/siteminder-apis/apps/introduction/siteminder-exchange/api-reference/availability-and-rates)
- [SiteMinder — credit card tokenisation](https://developer.siteminder.com/siteminder-apis/pms-rms/api-reference/reservations/credit-card-tokenization)
- [SiteMinder — mapping FAQs](https://help-classic.siteminder.com/en/articles/8673946-channel-manager-mapping-faqs)
- [Channex — best practices guide](https://docs.channex.io/guides/best-practices-guide)
- [Channex — PMS integration guide](https://docs.channex.io/guides/pms-integration-guide)
- [Channex — PMS certification tests](https://docs.channex.io/api-v.1-documentation/pms-certification-tests)
- [MONEI — channel manager tokenisation](https://docs.monei.com/channel-tokenization/)
- [Planyo — STAAH integration](https://www.planyo.com/faq.php?q=318)
- [IDS Next — two-way STAAH integration](https://hotelexecutive.com/newswire/62199/ids-next-completes-2-way-integration-of-its-hotel-erp-with-staah)
- [Clock PMS+ — STAAH integration](https://www.clock-software.com/products/integrations/staah)
- [SabeeApp — avoiding overbooking](https://www.sabeeapp.com/knowledge-base/how-to-avoid-overbooking-what-you-can-do)
- [AxisRooms — avoiding hotel overbooking](https://blog.axisrooms.com/avoid-hotel-overbooking/)
- [SmartOrder — rate plans in channel managers](https://www.smartorder.ai/resources/blog/rate-plans-hotel-channel-managers-how-they-work-how-many-you-need/)
