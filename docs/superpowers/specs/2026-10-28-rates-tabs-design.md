# Rates tabs — design

**Roadmap:** R1.7 · **Status:** accepted 2026-10-28, shipped · **Date:** 2026-10-28

**Sources:** roadmap R1.7 lock; [rate plans vertical](2026-08-05-rate-plans-vertical-design.md); [derived rate plans](2026-08-15-derived-rate-plans-design.md); [products catalog](2026-10-28-products-catalog-design.md) (R1.5); ARCHITECTURE §7.2, §16.1; AGENTS.md (*integer money*, *no `Math.round` on a ratio*, *arrays capped at HTTP and RPC*, *Alert for mutation results*).

## 1. What is already live

| Lock item | State |
|---|---|
| Derived plans on Plans | **Done** — "Derived from" + percent, badge `+15% of BAR`, matrix read-only for derived plans. |
| Restrictions type-wide only | **Done** — the SPA sends no `ratePlanId`; the route stores the type-wide `*` row. No change. |
| Bulk day-of-week filter | **Partly done** — Bulk fill has weekday checkboxes, but it only covers the matrix's visible window, has no range of its own, does not chunk, and has no failure handling. |
| Plan modifiers (percent / amount) | **Not in the domain.** `rate_plan` has only `derive_bps` on derived plans. Per the lock ("if the domain already has them") nothing is exposed and no second derivation graph is invented. |

This slice covers the rest. **No new command, route, permission, migration or pin.** All writes use the existing `rates.put_day` and `rates.bulk_update`.

## 2. Decisions

### 2.1 Tabs: Plans · Matrix · Restrictions only

- No Dynamic, Forecasting or Channels tab. Dynamic and forecasting are R5.1 (yield); channels are R4.3 (the third-party channel manager connector).
- The page subtitle says so in plain text, after the existing currency and plan text: **"Channel / Yield — later"**.
- **Ancillary** is the R1.5 products catalog. The subtitle carries a link, **"Add-ons: Products"**, to `/settings/products`. Nothing is duplicated on Rates.

### 2.2 Matrix reads as a grid of numbers

- Each cell shows the rate as **text**: formatted major units, right-aligned, tabular figures. An unset cell shows a muted **"—"**. There are no input boxes at rest.
- **Editing (base plans):** the cell is a button with an accessible name ("Edit rate for KDX on 2026-10-30"). A click or Enter turns that one cell into an `Input` with focus.
  - Enter or blur saves through `rates.put_day`. Escape cancels.
  - An empty or invalid value (not `^\d+(\.\d{1,2})?$`) does not save and puts the cell back.
  - Only one cell is in edit mode at a time.
- **Derived plans:** cells are plain text (no button). The footer keeps "Edit the parent plan's rates."
- **Save result:** on success, invalidate `['rate-days', propertyId]`. On failure, show an `Alert` with `classifiedUserMessage` and put the cell back to its stored value. Today the failure is an unhandled promise.
- **Restriction markers (read-only):** each cell shows small `Badge`s from the type-wide restriction row for that type and date: `Min N`, `Max N`, `CTA`, `CTD`, `Stop sell`. They read the existing `get_restriction_days` query for the same window. They are not edited from the matrix; the Restrictions tab stays the editor.
- **Window:** the window is unchanged (From / To, 90-day cap, 14-day default).

### 2.3 Bulk fill: its own date range, day-of-week, chunked to the cap

- The Bulk fill form gets its own **From** and **To**, defaulting to the matrix window, plus the existing room-type and weekday checkboxes and **Amount**.
  - **Set only.** The prototype's "adjust by percent / amount" is not built: it rounds a ratio on money, and it is yield work (R5.1).
- **Range cap: 366 days.** A longer range, or To before From, shows an inline error and disables submit.
- **Preview:** before submitting, the form states the cell count, e.g. "Sets 72 rates — 3 types × 24 days." Zero cells (no type or no weekday ticked, or no matching day) disables submit.
- **Chunking keeps the array cap.** The SPA builds the cells sorted by room type then date, then sends them in sequential chunks of `RATES_BULK_UPDATE_MAX` (500, imported from `@hospai/contracts`).
  - Each chunk is its own `bulkUpdateRates` call. The client already keys these by content, so a retry of the same chunk reuses its key.
  - The HTTP and RPC cap stays 500. Nothing is uncapped.
- **Partial failure:** the chunks that posted stay saved. An `Alert` states how many rates were saved and the date range that failed, using the operator copy. **Retry** re-sends only the failed chunks with the same keys. Success shows an `Alert` "Saved N rates."
- After any chunk posts, invalidate `['rate-days', propertyId]`.

### 2.4 Mutation feedback

The screen's transient `<p>` message ("Saved.", "Archived.") becomes an `Alert`, as AGENTS §4 requires for mutation results. The copy is unchanged.

### 2.5 Restrictions tab — load and save correctness (found in review)

- The table waits for `get_restriction_days` to settle ("Loading…"; an error shows an `Alert`). Before this, a cold load mounted the uncontrolled controls empty, so a closed-to-arrival date looked open.
- Each cell keeps local state and every save sends the cell's current values, so saving Max LOS can no longer revert a Min LOS saved a moment earlier from a stale row. A refetch updates only the fields whose stored value changed.
- A successful save invalidates `['restriction-days', propertyId]` (the matrix badges follow); a failed save shows an `Alert` and reverts that field.

## 3. Scope out

- Plan modifiers beyond `deriveBps`; adjust-by-percent bulk; occupancy in the matrix header (a warehouse trend, §7.8 — not in Phase 1).
- Plan-scoped restrictions; bulk restrictions.
- Dynamic, forecasting and channel tabs; OTA rate push.

## 4. Feature checklist (AGENTS §6)

- [x] No new route, command, permission or pin.
- [x] Arrays: bulk stays ≤ 500 per request; the SPA chunks to the cap it imports.
- [x] Money: integer minor units via `parseMajorToMinor`; set-only bulk with no ratio rounding.
- [x] Idempotency: existing content-derived keys per cell and per chunk; a retry reuses them.
- [x] SPA: `['rate-days', propertyId]` invalidated locally; `classifiedUserMessage`; ui-kit only; no inline styles.
- [x] No fake tabs: missing tabs are documented in the subtitle.

## 5. Tests (web-pms `RatesScreen.test.tsx`)

- **Tabs:** no Dynamic, Forecasting or Channels tab; the subtitle has "Channel / Yield — later" and a Products link to `/settings/products`.
- **Matrix display:** cells render the formatted amount as text and "—" when unset. There is no textbox until a cell is clicked.
- **Matrix edit:**
  - Click, type and Enter calls `putRateDay` with the right `amountMinor`.
  - Escape does not call it.
  - An invalid value does not call it.
  - A rejected call shows the Alert and puts the cell back.
  - A derived plan has no edit buttons.
- **Restriction badges:** shown from `listRestrictionDays`.
- **Bulk:**
  - The From/To and weekday filter produce exactly the matching cells.
  - The preview count is correct.
  - More than 366 days, or To before From, disables submit.
  - 1,200 cells go out as three calls (500 / 500 / 200), each ≤ 500.
  - The second chunk failing shows the Alert, and Retry re-sends only that chunk with identical cells.
- **Feedback:** success messages render in an Alert.
