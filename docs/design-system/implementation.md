# Implementation in the repo

How this system maps onto `hospai-core`. It replaces the shadcn neutral look of 29 October (R1.7a); the closed `ui-kit` API, the colour gate and the desktop-only rule all stay.

## Locks this reverses

Amend these in the same commit as the code:

| Where | Today | After |
|---|---|---|
| ARCHITECTURE §16.4 Palette | shadcn neutral, Inter | House Colour, Figtree |
| `docs/superpowers/specs/2026-10-29-shadcn-design-system-design.md` | Accepted | Superseded by this system |
| `.cursor/rules/spa-page-chrome.mdc` | Do not change `--tape-*` grid math; Metrics above the Card | Tape grid may change; `CountStrip` allowed in `PageHeader` |
| `StatusBadge` tones | Confirmed is green | Confirmed is the blue outline |
| AGENTS.md "Kit" paragraph | Lists `Dialog` though ui-kit has none | True once `Dialog` ships |

## Tokens

`color-*` names in this system are the repo's `--color-*` primitives. Replace the values in `apps/web-pms/src/styles/tokens.css`, in the light block, both dark blocks and the print block, and add the new names.

| Change | Tokens |
|---|---|
| Values change | `color-bg`, `color-surface-base`, `color-ink`, `color-muted`, `color-line`, `color-selected`, `color-primary`, `color-sidebar`, `color-focus`, all `color-action-*`, all `color-status-*`, all `color-room-*` |
| New | `color-hover`, `color-table-head`, `color-field`, `color-primary-hover`, `color-primary-tint`, `color-primary-tint-fg`, `color-action-destructive-hover`, `color-status-cancelled-surface`, all `color-stay-*`, all `color-chart-*` |
| Removed | `--font-mono`'s IBM Plex Mono face. `ui-quick-action__label` drops its mono caps |

Extend `check:web-pms-colors` to cover the new pairs in both themes: `color-field` and `color-focus` at 3:1, `color-primary-hover` and the `color-stay-*` pairs at 4.5:1. All 104 pairs pass today when calculated from `tokens.json`.

## Metrics

Update these in `packages/ui-kit/src/styles.css`:

| Variable | Today | After |
|---|---|---|
| `--control-h` | 32px | 36px |
| `--control-h-sm` | 28px | 30px, for dense grids only |
| `--input-h` | 36px | 36px |
| `--table-row-h` | 48px | 44px, plus a new dense size at 36px |
| `--radius` | 6px | 8px |
| `--radius-sm`, `-lg`, `-xl` | 4, 8, 12px | 6, 10, 12px |
| `--field-xs` | 8rem | 9.5rem, so a date field shows its whole year |
| `--text-xs` | 11px | 12px |
| `--text-sm` | 12px | 13px |
| `--text-xl` | 26px | 21px |
| `--text-metric` | 36px | 28px |
| `--text-eyebrow` | 10px | 11px |

## Fonts

- Copy these from the OFL `@fontsource/figtree` and `@fontsource/noto-sans-devanagari` packages to `apps/web-pms/public/fonts/`. CSP stays `default-src 'self'`.
- Both `figtree-latin-*` and `figtree-latin-ext-*` are required, each with its `unicode-range`. The ₹ sign is only in latin-ext.
- Set `font-variant-numeric: tabular-nums` on `body`.
- Devanagari ships only when a Hindi screen exists, likely in the mobile client.

## Components

**Restyle, same API:** Alert, Badge, Button, Card and its parts, Checkbox, DataTable and its parts, EmptyState, Field, Input, Metric, Metrics, NativeSelect, PageHeader, RoomStatus, RowActions, SectionLabel, Separator, Skeleton, StatField, StatusBadge, Tabs, Textarea, Toolbar, Total, VisuallyHidden.

**New in `ui-kit`, closed API:** AutosaveStatus, ChecklistRunner, CheckResult, ChoiceGroup, ConnectorStatus, CountStrip, DateRange, DeadlineIndicator, Dialog, Disclosure, FieldGroup, FileUpload, JobProgress, MappingEditor, MatrixGrid, MoneyInput, MoneySummary, NightGrid, OrderableList, Pagination, PayloadInspector, Popover, SearchField, SearchPick, SegmentedControl, SidePanel, SplitAllocator, StatGrid, Stepper, TagEditor, Timeline, UpgradePrompt, UsageMeter.

**CSS contract on a router Link:** LinkButton (`ui-link-btn`), QuickAction, route tabs, navigable Metric.

**Web-pms only:** AppShell, Band, GlobalSearch, PropertySwitcher, ReportRunner, RoomGrid, RoomPicker, RoomTile, RuleEditor, StayBar, TapeChart, TapeLegend, ThemeSwitch, TopBar, TrendChart, CopilotThread, MessageThread, PrintDocument. StayBar's button is the kit's `StayButton`, so web-pms keeps no raw controls.

Build a new component when its slice arrives, not all at once. The next slice builds only what the shipped screens use.

## Remove while you're there

- All seven hand-written dialogs (City Ledger has three of them), replaced by `Dialog`, and all three `window.confirm` calls.
- Per-screen form and table classes: `.staff__form`, `.roster__form`, `.inventory__form`, `.settings__form`, `.rates-plans__form`, `.city-ledger__create-form`, `.maintenance-report`, `.folio-forms`, `.guest-edit-form` and the matching `__table` classes.
- Duplicates: `.visually-hidden`, `.stack`, `.stack-row`.
- Raw kit classes where a component exists: `.ui-section-label`, `.ui-metric`, `.ui-field*` in Booking, Housekeeping, board-summary and `SettingsScreen.tsx:335`.
- Dead CSS: `.maintenance-filters`, `.exceptions-json`, `.board-header`, `.text-wrap-balance`.
- `boardRowSeverity` and `tapeBlockSeverity`. `StatusBadge` is the one mapping.
- The `$` in `ShiftStrip.tsx:157` and `BookingScreen.tsx:1098`, and the default float of 100.00.

## Order of work

1. Tokens, fonts and the colour gate. Every screen changes look at once, which is the point.
2. The formatter module for money and dates, used everywhere.
3. `Dialog`, `Tabs` everywhere, `EmptyState` kinds, `Skeleton`, removing the duplicates above.
4. Shell: `TopBar`, `Band`, `GlobalSearch`, with a new POST search route.
5. Room Plan: `CountStrip`, `TapeChart`, `StayBar`, `Popover`.
6. Browser check of every screen at 1366 × 650 and 1920 × 950, in light, dark and a red-green simulation.

## As shipped (R1.10a, 3 November 2026)

Where the build differs from what this system first said. The repo's spec, `docs/superpowers/specs/2026-11-01-house-colour-design-system-design.md` §9 and §12, has the detail.

| This system said | As built | Why |
|---|---|---|
| Four dialog implementations | Seven hand-written, plus three `window.confirm` | City Ledger has three more |
| Server search change on the existing route | New `post_reservation_search` route; the GET route is unchanged | The guest CRM lock keeps names out of URLs |
| Bar popover has Post charge | Open folio, plus Check in for an arrival due today | Posting lives on the folio screen |
| Free count "from the ledger" | Sum of `free` for physical room types on the tape only | Virtual types would double-count |
| `CountStrip` takes `items` | Takes linked children over a `ui-count` CSS contract | The kit can't depend on the router |
| `property.currency` implied | `get_property` returns `ledgerCurrency` | The property record has no currency |
| Room column hides the housekeeping word | The word stays visible | The word is always shown; colour never stands alone |
| No footer under the page | The Queued commands / Exceptions row shows only when it has something in it | It cost 32px on every page and broke the 12-room target |

Measured at 1366 × 650 with a Band open and the Free row showing: 12 of 20 rooms are fully visible on Room Plan.
