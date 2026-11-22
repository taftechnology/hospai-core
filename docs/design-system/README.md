House Colour is the HospAI desk's look: warm greys, one peacock teal and softer corners, on a dense, calm layout built for a small monitor. Colour means something here. Teal is the hotel's action colour, and every other hue is a state with a word or a shape beside it.

## Principles

- **The rooms come first.** On Room Plan the tape fills the window. Counts sit on one line beside the title, and the shift sits in the top bar. Test every desk screen at `screen-floor-w` × `screen-floor-h` (1366 × 650).
- **Shape, then word, then colour.** A stay reads by its form: solid is in the room, outline is coming, dashed isn't firm. Room state reads by its mark and word. Colour backs these up and never stands alone.
- **Green is never a stay.** `color-status-settled-*` means good and finished: Paid, Clear, Resolved. BluePMS paints a free room green, so a green booking could read as free. Blank means free.
- **One of each.** One Button, one DataTable, one Dialog, one date format, one money format, one loading state. If a screen needs its own version, change the system.
- **Calm change.** Labels and sidebar order stay put. Staff shouldn't have to relearn the desk after a release.

## Content fundamentals

Write like a good front office manager: plain, short and specific.

- **Say what happened and what to do.** "1 check is blocking the audit. Close the open cashier shift, then run again." Not "Fail checks stopped the audit."
- **Name the thing.** "Payment of ₹5,000.00 recorded." Not "Success!"
- **Buttons start with a verb and name the action.** "Check in", "Void charge", "Take payment". A confirm button is never "OK" or "Yes".
- **Sentence case** for buttons, badges, table heads and messages: "Due out today", "Balance due". Title Case for page titles and nav items: "Room Plan", "Night Audit". Use one spelling of a name everywhere.
- **Hotel words:** guest (never customer), stay, folio, room, rate plan, arrival, departure, in house, no-show, out of order, business date.
- **Never show a wire word or code.** Map `COMPANY OPEN`, `checked_in` and ISO dates to words. Errors come from `classifiedUserMessage`, never from a stringified body.
- **No emoji** in the product.
- **I and you:** the system says "you" to staff and doesn't say "I". The copilot is the exception and answers plainly.
- **Numbers and dates**: see Patterns. Always `₹1,24,500.00` and `1 Nov 2026` or `Sun 1 Nov 2026`.

## Visual foundations

**Colour.** Set pages on `color-bg`, with sections on `color-surface-base`. Sunken areas use `color-selected`. Body text is `color-ink` and supporting text is `color-muted`, on any of those grounds. `color-line` draws decorative hairlines; `color-field` draws control edges at 3:1. `color-primary` is for primary buttons, the selected nav item and links only. Every text pair holds at least 5.9:1 in both themes, and every mark or border that carries meaning holds 3:1.

**Stays.** `color-stay-inhouse` is the solid bar and `color-stay-confirmed` with its border is the outline. `color-stay-pending` has a dashed border. `color-stay-overstay` is solid with an alert icon. `color-stay-departed` is quiet. Out of order is hatched with `color-stay-blocked`. The same fills serve the tape and `StatusBadge`.

**Status rungs.** `settled`, `informational`, `attention`, `exception`, `vip` and `cancelled` each have an `-fg` and a `-surface`. Don't invent a rung. Don't use `exception` to decorate; it means wrong or blocking.

**Type.** Figtree for everything, at 400, 500, 600 and 700. Always set `font-variant-numeric: tabular-nums`, because Figtree's default digits have different widths and money columns won't line up without it. Text scale: `page-title` 21, `panel-title` 18, `card-title` 16, `body` 14, `small` 13, `caption` 12. Nothing a person must read goes below 12px; `eyebrow` at 11 is for labels that repeat something visible. Hindi falls through to Noto Sans Devanagari. Code and payloads use the system mono stack.

**The ₹ sign is in a separate font file.** Figtree's Latin file doesn't contain it, so always load `figtree-latin-ext` as well, with a `unicode-range`, as `components/bundle.css` does. Without it the rupee sign falls back to another font.

**Density.** Rows are `table-row-h` (44), or `table-row-dense` (36) for ledgers and grids. Tape rows are `tape-row-h` (32). Every control is `control-h` (36), so a header button and a row button match. `control-h-compact` (30) is only for dense grids and popovers.

**Spacing and layout.** A 4px step, from `space-1` to `space-8`. Blocks in a card are `space-4` apart; cards on a desk screen are `space-3` apart. The sidebar is a fixed `sidebar-w` (256). Each page has one scroll area. The desk app is desktop only, from 1280px, with no breakpoints.

**Corners and shadows.** `radius` (8) on controls and `radius-xl` (12) on cards, with `radius-sm` (6) on tape bars. Cards carry a hairline and the soft, warm `shadow-xs`. `shadow-overlay` is only for Dialog and Popover.

**States.** Hover is `color-hover`, and a primary button hovers to the solid `color-primary-hover`, never an opacity fade. Focus is a 2px `color-focus` outline with a 2px offset, on every interactive element. Selected rows use `color-primary-tint` with `color-primary-tint-fg`. Disabled controls use 50% opacity and say why.

**Motion.** Colour transitions only, at 150ms. Nothing slides or bounces. Skeletons pulse only when the viewer allows motion.

**Print.** Black on white in every theme, with ruled tables. Print forces the light tokens.

## Iconography

Lucide, 24 units on a 2px round stroke, in `currentColor`: 16px in nav and buttons, 14px in tables, 20px on quick actions. In the repo, icons stay hand-copied inline SVG in `apps/web-pms/src/shell/icons.tsx` with no dependency. Icons mark and support; a nav item or a status always has its word too. No emoji and no illustrations.

There is no logo yet. The sidebar shows the wordmark HOSPAI in plain type beside an "H" on a `color-primary` tile. Replace it when a real mark exists.

## Hard limits

These come from the repo's own rules and stay in force:

- No Tailwind, shadcn or Radix imports, chart libraries or Storybook. `ui-kit` keeps its closed API.
- Hex lives only in `tokens.css`. Dark mode is tokens only, with no per-screen rules.
- One h1 per page, in `PageHeader`.
- No trends or charts on desk screens; trends come from the warehouse.
- No drag-to-move on the tape, and no card number or CVV field anywhere.
- A Settings control must be read by pms-core, or it stays hidden.
