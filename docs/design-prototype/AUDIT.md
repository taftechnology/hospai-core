# SPA visual audit + proposed design

**Date:** 2026-08-16
**Source:** the 29 screenshots in `docs/screenshots/spa/`
**Status:** prototype for review — nothing in `apps/web-pms` or `packages/ui-kit` has been touched

---

## What changed since the convergence spec

The [UI system convergence spec](../superpowers/specs/2026-08-13-ui-system-convergence-design.md) and its plan are ancestors of `main`, and the work has since **shipped**: `packages/ui-kit` exists with `Badge`, `Button`, `Card`, `DataTable`, `Field`, `Input`, `LinkButton`, `NativeSelect`, `Checkbox`, `Textarea`, `Alert`, `Separator`, `Skeleton`; 26 files in `apps/web-pms` import it; raw controls are down to **5 `<label>` and 1 `<dialog>`** from 89 buttons / 100 inputs / 21 selects / 16 tables.

So these screenshots are **not** of the pre-ui-kit app. The component layer landed and works. What is missing is the layer above it: `packages/ui-kit/src/styles.css` is 264 lines of component chrome with **no layout system, no type scale, no density scale, and no field-width scale**. Components are correct; the design on top of them was never specified.

That is what this prototype proposes.

---

## Findings

Severity: **A** = looks broken to a viewer · **B** = clearly unpolished · **C** = refinement.

| # | Sev | Finding | Where seen | Cause | Fix in prototype |
|---|---|---|---|---|---|
| 1 | A | Save buttons render as full-width bars across the whole content area | `26-settings-property` | `.ui-btn` is `inline-flex`, but inside a flex **column** the default `align-items: stretch` overrides it | `.ui-btn` sets `align-self: flex-start`; `.ui-stack` sets `align-items: flex-start` |
| 2 | A | Every form field spans the full content width — a date input ~1500px wide | `07-book`, `17-rates-matrix`, `26-settings` | No width scale; `.ui-field` is a full-width flex column | `--field-xs/sm/md/lg` (8/12/20/30rem); `.ui-field` defaults to `md` |
| 3 | A | Per-cell labels render as visible body text in every rate cell | `17-rates-matrix` | Labels present for a11y but no `visually-hidden` utility in ui-kit | `.ui-visually-hidden` in ui-kit; applied per cell |
| 4 | A | Three row actions run together as one sentence: "Check in Folio Book for guest" | `03-arrivals` | No row-action pattern; bare links separated by whitespace | `.ui-row-actions` — separated, right-aligned, primary action is a button |
| 5 | A | Folio charges and tenders render as bulleted `<ul>` lists with no alignment | `13-folio` | No table/ledger pattern for money | Ledger `DataTable`; `.ui-table__num` right-aligns with `tabular-nums` |
| 6 | A | Section headings (`Tenders`, `Post charge`) sit inline beside their inputs, vertically centred | `13-folio` | Browser-default `<h2>` inside a flex row | Sections are `Card`s with a header row; `.ui-section-label` for sub-labels |
| 7 | A | Content is cut off at the right edge — table columns, date inputs, guest names | `02-board`, `17-rates-matrix` | No max content width, no scroll container at the page level | `--content-max: 78rem` on `.ui-page__inner`; tables scroll inside `.ui-table-scroll` |
| 8 | B | Page title is a raw lowercase wire value | `03-arrivals` ("arrivals") | Title rendered from a route key | Page header takes a display title + subtitle |
| 9 | B | Native `<fieldset>`/`<legend>` renders as a notched 1997 border; radios float above their labels | `25-exceptions` | Native element, unstyled | `.ui-field-group` + `.ui-choice-row`, borderless, baseline-aligned |
| 10 | B | Tabs are three identical text links with no active state | `17-rates`, `26-settings`, `02-board` | No tab component | `.ui-tabs` / `.ui-tab` with an active underline |
| 11 | B | The informational "Guest credit $36.50" message renders in error red | `13-folio` | `.ui-alert` has exactly one variant | Four variants mapped to the four status rungs |
| 12 | B | Disabled buttons use `opacity: .55`, pushing white-on-sage below AA | `26-settings`, `24-night-audit` | Opacity-based disabled state | Flat token surface: `--selected` background, `--muted` text |
| 13 | B | The balance — the most important number on the folio — is plain body text with no currency symbol | `13-folio` | No money or total treatment | `.ui-total` with size, weight, and credit/due colour; `$` throughout |
| 14 | B | Empty states are a bare sentence | `25-exceptions`, `24-night-audit` (`Reports`) | No empty-state pattern | `.ui-empty` with title, guidance, and a recovery action |
| 15 | B | Enormous dead grey area below content on most screens | all | Page fills viewport; content top-aligned in an unbounded panel | Cards size to content; page background is consistent, so the gap reads as page not void |
| 16 | C | "City ledger" is the only nav item without an icon | all | Missing from the icon set | Full icon set; every nav row has one |
| 17 | C | Status values render as bare uppercase text (`PENDING`, `Confirmed`) | `24-night-audit`, `03-arrivals` | Wire values painted directly | `Badge` with a rung; wire values keep their text where the spec pins them |
| 18 | C | Table headers are same weight/size as body rows | all tables | No header treatment | Uppercase, small, muted, sticky |
| 19 | C | No hover feedback on table rows | all tables | — | Row hover on `--hover` |
| 20 | C | Housekeeping badges (`dirty`, `clean`) vary in width and sit mid-sentence | `02-board` | Inline text badges | `.ui-badge--plain`, consistent metrics |

### Deliberately not changed

- **Palette.** Every colour is an existing token. No new hex, so `pnpm check:web-pms-colors` stays green on port. Derived surfaces use `color-mix` on existing tokens only, matching what `styles.css` already does.
- **Night audit step names** (`PRE_CHECK` … `ARCHIVE`) stay wire values — spec §16.42 pins them.
- **Information architecture.** No screen flow, nav order, or folio IA moved. This is the layer above the components, not a re-think of the product.
- **Tape chart grid.** `.tape-*` is a CSS-var grid and is out of scope, as in the spec.

---

## What the prototype contains

| File | Role |
|---|---|
| `tokens.css` | Copied **verbatim** from `apps/web-pms/src/styles/tokens.css`. Unmodified. |
| `ui-kit.css` | The proposal. Successor to `packages/ui-kit/src/styles.css` (264 → ~640 lines) plus the chrome half of `apps/web-pms/src/styles.css`. |
| `index.html` | Component gallery — every component, every state. Maps to the `/dev/ui` route the spec already calls for (§9.2). |
| `arrivals.html` | Table + row actions + metrics + empty state |
| `folio.html` | Money: ledger table, summary, one prominent balance, split post/pay cards |
| `rates-matrix.html` | Dense editable grid + toolbar + hidden per-cell labels |
| `settings.html` | Form layout, field widths, one page-level Save |
| `_shell.html` | Reference copy of the shared shell markup |

To view: `python3 -m http.server` in this directory, then open `index.html`.

---

## Structural additions over the shipped ui-kit

Everything below is new; none of it replaces a working component.

1. **Layout** — `.ui-shell`, `.ui-sidebar`, `.ui-rail`, `.ui-strip`, `.ui-page`, `.ui-page__inner` with `--content-max`.
2. **Type scale** — six steps, 14px base for operational density. Section labels deliberately quieter than page titles.
3. **Field-width scale** — the single highest-impact fix. Four widths plus `--full`.
4. **`.ui-page-header`** — back link, title, subtitle, and right-aligned page actions. Gives every screen the same anatomy, which finding 6 shows is currently improvised per screen.
5. **`.ui-tabs`**, **`.ui-toolbar`**, **`.ui-metrics`**, **`.ui-empty`**, **`.ui-row-actions`**, **`.ui-summary`**, **`.ui-total`**, **`.ui-field-group`** — the patterns the screens needed and hand-rolled.
6. **Alert variants** — four rungs instead of one.
7. **Table** — sticky uppercase headers, row hover, numeric alignment, action column.

---

## If approved — porting cost

The prototype is deliberately shaped so the port is mostly mechanical:

| Step | Work |
|---|---|
| 1 | `ui-kit.css` → `packages/ui-kit/src/styles.css`. CSS only, no component API change. Most of the gain lands here. |
| 2 | Add `size` prop to `Field` (`xs`/`sm`/`md`/`lg`) as a closed union — the only new API, and it respects §7.3. |
| 3 | New components: `PageHeader`, `Tabs`, `Toolbar`, `Metric`, `EmptyState`, `RowActions`, `Total`. All presentational, all Tier A, all DOM-preserving. |
| 4 | `Alert` gains an `intent` union (four rungs). One-line call-site change where red was wrong. |
| 5 | Per-screen: adopt `PageHeader`, set field sizes, hide the rates-matrix labels. This is the only part that touches 29 screens, and each screen is small. |
| 6 | Delete the superseded chrome half of `apps/web-pms/src/styles.css`. |

Gate impact: none expected. No new hex, no literals outside `--color-*`, no new dependency, no Tailwind. `check:class-resolution` will need the new `ui-*` classes to exist in `ui-kit.css` — they do.

---

## Open questions for review

1. **14px base.** The prototype drops body text from 16px to 14px for density. Standard for ops tools; worth confirming you want it, since it touches every screen.
2. **One Save per page vs per field.** `settings.html` shows a single page-level Save. The shipped screen saves per field, which is an IA decision with an audit-log reason attached — I have not changed the behaviour, only shown the alternative layout.
3. **Sidebar width** 16rem → 15rem, and rail 4rem → 3.5rem. Tighter, more content. Note the spec's sticky-header offset (`top: 4rem`) assumed the old rail height — if the rail shrinks, that constant moves with it.
4. **Section label vs card header.** The prototype mostly uses card headers and rarely `.ui-section-label`. If you prefer flatter screens with fewer card borders, the label variant is there.
