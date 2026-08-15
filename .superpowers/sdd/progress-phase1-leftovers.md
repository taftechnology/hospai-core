# Phase 1 leftover campaign

Human asked to run remaining Phase 1 sellable leftovers consecutively (2026-08-14).

## Verification (do not re-litigate)

Closed already:
- Stay-level discounts (folio-money leftover 6) — `c0dace7`
- Partial refunds (leftover 4) — shipped; §19 item 4 pointer still stale
- Taxable discounts (leftover 5)
- Provisional retry / re-apply — exception-queue workbench (`provisional.retry_exception`); resolve stays acknowledge-only
- Night-audit auto-transfer (folio-money leftover 1) — `fe55d29` (spec `bd3da70`, plan `42f0393`)
- Auto-assign rooms (lifecycle leftover 3) — `05ffdfd` (spec `90f4896`, plan `dc21e00`)
- `pms.night_audit.auto_extend` consumer (night-audit leftover 4) — `33dfe9e` (spec `cc93a55`, plan `d309f0e`; DO `bc8a4fe`, SPA `092f426`)
- `rooms.delete` / unit archive — `f17f9f6` (spec `bcaf35b`, plan `3f507da`; schema `65c03a5`, DO `b012a48`, HTTP `64ade78`, SPA `2eaae99`)
- `unknown` payment reconciliation exit — `5d2c5c7` (spec `480b29b`, plan `fe8aca5`; DO `599b218`, HTTP `d1ce47b`, SPA `a863997`)
- Authorization expiry / hold-lapse — `952830d` (spec `24d8a34`, plan `b321a71`; DO `5c043ee`, SPA `9e9d26f`; Task 3 CI prefix `pms.payments`)
- Property-local derived rate plans — `40793b5` (spec `41e7674`, plan `d9aa697`; schema `fee32da`, DO/HTTP `8e3e4dd`, SPA `485774a`)
- Priced wizard / plan picker — `2a25ebd` (spec `093f042`, plan `dd0f55c`; client `6169c34`, HTTP `df79fe7`, SPA `311a7a7`)

Not Phase 1:
- Recurring / `breakfast_rule` engine — ARCHITECTURE §16.5 DEFER; prototype-holes leftover 1

Out of this campaign:
- MASTER group billing / allotments — Phase 2
- OrgDO-hosted chain-wide rate plans — property-local derived only
- `folio.add_item` catalog class review — named leftover, not on the punch list; park after the queue

## Queue (consecutive verticals, no pause)

1. Night-audit auto-transfer (routing rules + step 8) — DONE `fe55d29`
2. Auto-assign rooms (read `pms.ops.auto_assign_rooms`) — DONE `05ffdfd`
3. `pms.night_audit.auto_extend` consumer — DONE `33dfe9e`
4. `rooms.delete` / unit archive — DONE `f17f9f6`
5. `unknown` payment reconciliation exit — DONE `5d2c5c7`
6. Authorization expiry / hold-lapse — DONE `952830d`
7. Property-local derived rate plans — DONE `40793b5`
8. Priced wizard / plan picker (derived plans cannot be booked from the desk) — DONE `2a25ebd` (spec `093f042`, plan `dd0f55c`; client `6169c34`, HTTP `df79fe7`, SPA `311a7a7`)
9. Promo codes (on derivation graph) — DONE `92bf6ba` (spec `6ba7332`, plan `a4434f2`; schema `d1c9bdc`, CRUD `539a9e6`, snapshot `1c9bab8`+`6e1228d`, Rates `05d787d`, Booking `46a17e3`, leftovers `d94b34f`)
10. Invoice generation engine (R2 + existing numbering config) — DONE `811b2dd` (spec `8d767c4`, plan `b61747e`; v32 `invoice` table, R2 snapshots, Folio generate/view; schema `2a4b693`, DO `b347859`, HTTP `67766b9`, checkout `0647ef3`, SPA `811b2dd`, leftovers `7a165d7`)
11. City ledger / AR (not MASTER groups) — DONE `0282a5a` (spec `5a86dc8`, plan `317cda8`; v33 `city_ledger_*` tables, R2 statements, City Ledger SPA; schema `1904bf9`, DO `e809038`+`112d703`+`977a69e`, SPA `0282a5a`)
12. Collapse split commands — DONE `1aa4b75` (spec `182c8c1`, plan `c15f0bd`; catalog 90, writers 63, routes 144, SPA → `splitFolioLine`; tests `b50f7b9`+`44e4f9e`, contracts `83fa0f3`, DO `5d48954`, HTTP `3bdaa30`, client/SPA `1aa4b75`, fixes `372fa54`)
13. Retire `reservations.update_extras`

## Remaining Phase 1 sellable (re-audited 2026-08-15)

Sellable = a desk can take/price a stay, house it, settle money, roll the date. ARCHITECTURE §14 / §16.1.

Still owed:

Hygiene (not sellable; catalog debt):
5. Retire `reservations.update_extras` — catalog-only, no DO method, not in `REPLAY_DISPATCH`.

Stale leftover text (already shipped): folio-money §19 item **4** still says partial refunds open; `refunded_amount_minor` is written.

Not Phase 1: recurring/`breakfast_rule`; OrgDO chain-wide plans; MASTER allotments; plan-scoped restrictions (type-wide stays); inclusions/photos; real PSP; `rematerializesRates` consumer; `folio.add_item` class (locked `QUEUE_PROVISIONAL`).
