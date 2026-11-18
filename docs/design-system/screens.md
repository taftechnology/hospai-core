# Screen map

Every route that ships today and every surface on the roadmap, with the template and components it uses. Items marked "later" are designed for but not built.

## Shipped

| Route | Template | Main components |
|---|---|---|
| `/dashboard` | TemplateDashboard | QuickAction, Metrics, Card, StatField, EmptyState |
| `/board` | TemplateRoomPlan | CountStrip, DateRange, TapeLegend, TapeChart, StayBar, Popover |
| `/board` Available tab | TemplateDirectory | Tabs, DataTable, RoomStatus |
| `/arrivals`, `/departures`, `/in-house` | TemplateDirectory | Tabs, DataTable, StatusBadge, RowActions, Dialog, RoomPicker |
| `/reservations` | TemplateDirectory | Toolbar, DataTable, Pagination |
| `/reservations/:id` | TemplateRecord | PageHeader, Card, StatusBadge, StatField, Dialog, Alert |
| `/book` | TemplateForm | SearchPick, ChoiceGroup, FieldGroup, MoneySummary |
| `/check-in/:id` | TemplateForm | RoomPicker, Alert, PrintDocument |
| `/folio/:id` | TemplateRecord | StatGrid, Tabs (windows), DataTable dense, Total, Dialog, Disclosure |
| `/folios` | TemplateDirectory | SearchField, DataTable |
| `/city-ledger`, `/city-ledger/:id` | TemplateDirectory, TemplateRecord | DataTable, StatGrid, Dialog |
| `/guests` | TemplateDirectory | SearchField, DataTable, Pagination |
| `/guests/:ref` | TemplateRecord | StatGrid, TagEditor, DataTable, Dialog |
| `/shift`, `/shift/:id` | TemplateForm, TemplateRecord | MoneyInput, StatGrid, Total, Alert |
| `/rates/plans` | TemplateSettings | Tabs, DataTable, Dialog |
| `/rates/matrix`, `/rates/restrictions` | TemplateGrid | DateRange, MatrixGrid |
| `/inventory`, `/inventory/rooms` | TemplateDirectory | Tabs, DataTable, Dialog |
| `/staff`, `/roster` | TemplateDirectory | DataTable, TagEditor, FieldGroup, Dialog |
| `/night-audit` | TemplateWorkbench | Tabs, Alert, CheckResult, DataTable |
| `/exceptions` | TemplateDirectory | Toolbar, SidePanel, PayloadInspector, Pagination |
| `/settings/*` (property, charges, tax, **finance**, products, maintenance, sources, **users**, **system**, **logs**, **guests**, **accommodations**) | TemplateSettings | Tabs, Field, AutosaveStatus, DataTable, OrderableList, Dialog, EmptyState, Checkbox |
| `/settings/guests` | TemplateSettings | Tabs, Checkbox, Field, Alert (`org:manage`) |
| `/housekeeping`, `/housekeeping/priority`, `/housekeeping/inventory` | TemplateDirectory | Tabs, Metrics, DataTable, RoomStatus, Dialog |
| `/maintenance` | TemplateDirectory | Toolbar, DataTable, Dialog, ChecklistRunner |
| `/sign-in` | AuthLayout | Field, Input, Button |
| Shell | AppShell | SidebarNav, TopBar, GlobalSearch, ThemeSwitch, Band, StaleWatermark |
| Print: registration card | PrintDocument | PrintHead |

## On the roadmap

| Area | Surface | Slice | Uses |
|---|---|---|---|
| Front office | Room move, in-house changes | R1.19, R4.24 | Dialog with a reason, RoomPicker |
| | Day-wise rates, room at booking | R4.20, R4.26 | NightGrid, RoomPicker |
| | Live room view | R4.27 | RoomGrid, RoomTile |
| | Grid depth | R4.28 | TapeChart, with an occupancy row and per-date cells |
| Folio, billing | Open folio, draft bill, reversals | R4.23, R4.29 | Timeline, Dialog with a reason and approver, SplitAllocator |
| | Advances, packages | R4.25, R4.13 | PaymentRows, MoneySummary, ChoiceGroup |
| Housekeeping | Tasks, status history, blocks | R4.30 | RoomStatus, Timeline, DataTable |
| | Depth, supervisor view | R4.11, R4.31 | ChecklistRunner, DataTable variance recipe, attention queue recipe |
| POS | Connector only | R4.9, R4.21 | MappingEditor, ConnectorStatus, DataTable. **No order or table screens.** |
| Channels | Connector | R4.3 | MappingEditor, ConnectorStatus, DataTable |
| Reports | Named set, Manager Report | R4.14, R4.32 | ReportRunner, DateRange, OrderableList, NativeSelect of fixed formulas |
| Admin | Finance | R1.12, R1.17, R1.18, R3.1 | TemplateSettings, Timeline, DataTable |
| | Import, accounting | R4.8, R4.12 | FileUpload, JobProgress, MappingEditor |
| | Billing, API, property switcher, org views | R5.6, R5.3, R5.11, R4.4, R5.7 | PlanPicker, UsageMeter, UpgradePrompt, DataTable, PropertySwitcher |
| Copilot | Answers, then agents | R4.16, R4.6, R5.9 | CopilotThread |
| Compliance | Buyer details, e-invoice queue | R4.22, R5.5 | Field, SearchPick, TemplateWorkbench, PayloadInspector, Timeline |
| | Form C, ID and consent | R6.2, R4.15 | DeadlineIndicator, DataTable, FileUpload |
| Printed | Proforma, tax invoice, receipt | R4.13, R4.22, R4.25, R5.5 | PrintDocument |
| Mobile | Housekeeping and staff client | R4.10 | MobileShell, MobileTaskCard, MobileStatusControl |
| Guest-facing | Booking engine | R4.2, R4.7 | Stepper, RoomOfferCard, PlanPicker, hosted card fields |
| Later modules | Whistle | R5.2, R6.1 | MessageThread, RuleEditor |
| | Yield | R5.1 | RuleEditor, TrendChart |
| | Groups, banquet | R4.1, R5.12 | MatrixGrid; the function diary reuses the TapeChart grid against hours |

## Recipes, not new components

These are `DataTable` with a fixed column set, so they get no card of their own:

- **Variance table** (R4.11): item, expected, counted, difference, with difference in `exception` when not zero.
- **Attention queue** (R4.31): room, reason word, age, action, sorted by urgency.
- **Consent table** (R4.15): purpose, status word, date, withdraw.
- **Connector exception rows** (R4.3, R4.21): time, item, what failed, retry.

## Deliberately not designed

- POS, F&B, inventory, purchase, spa, transport, hostel and payroll hubs: ARCHITECTURE §16.6 classifies them as Integrate or Avoid.
- Guest Experience (reviews, guest pages, website builder): undecided and blocked on the roadmap.
- A report builder, a custom calendar picker, kanban, signature capture and ID scanning: no slice asks for them.
- Drawers: use `SidePanel`.
- `held` inventory UI: waits for R5.13.
