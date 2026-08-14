# Demo-ready

Prioritized work to make the PMS presentable in an investor meeting. This is **not** a Phase 1
completion list. Phase 0 is done; the sellable loop already runs on live APIs. The meeting fails
if the UI still looks like a lab, the hotel is empty, or the hour is spent on architecture.

**Two finish lines (do not conflate them):**

| Bar | What it means | When |
|---|---|---|
| **Demo-ready** (this file) | An 8-minute hotel day looks like a product a GM would trust | Before the meeting |
| **Sellable** ([ARCHITECTURE.md](ARCHITECTURE.md) §14 Phase 1 leftovers) | A first hotel can go live | After the round |

Domain is ~85% of a sellable PMS. Demo presentability is the gap this document closes.

**How to use this file:** work P0 in order. Do not start P1 until every P0 checkbox is ticked.
Do not pull anything from [Out of scope](#out-of-scope-do-not-do-before-the-meeting) into a
demo slice. Tick boxes here as slices land. P0-3’s chrome + skin decision is recorded in this
file (no separate spec unless implementation needs one).

---

## Already true — do not rebuild

The 8-minute path can already be walked on current APIs. Do not re-derive these.

- Live SPA: tape chart, arrivals / in-house / departures, reservations directory, guests,
  book, check-in, folio, inventory, rates, staff, roster, housekeeping, night audit,
  exceptions, settings (`apps/web-pms`).
- PropertyDO ledgers: availability, restrictions, folio windows, OOO → blocked.
- Entitlements, property-scoped RBAC, degraded mode + exception workbench, night-audit
  `BusinessDate` machine, multi-currency folio, guest PII shredding.
- Booking wizard shows room-type **names/codes** when the type directory is loaded
  (`BookingScreen.tsx`). Global reservation search exists in the shell.

The gap is staging, first-paint, and appearance — not missing commands.

---

## Priority order

| Priority | Goal | Rule |
|---|---|---|
| **P0** | Meeting can happen | Blocker. One slice at a time, in the order below. |
| **P1** | Meeting is stronger | Only after P0. Drop if the calendar is tight. |
| **P2** | After the round | First-hotel / Phase 1 work. Not a pitch gate. |

Recommended calendar for P0: **2–3 weeks**. P1 adds another 1–3 weeks if you want guest CRM
depth in the room.

---

## P0 — meeting blockers

Work these in order. Each item is independently demoable; P0-1 unblocks every later dry run.

### P0-1. One-command demo hotel

- [x] A single local command provisions a **named** demo tenant (no curl sequence in the room).
- [x] Property name a GM would recognize (not `prop_demo` on the tape header).
- [x] ~20 rooms with human codes (`101`, `102`, …) and type names (`King Deluxe`, `Twin`,
      `Suite`) — never lead with `rt_king` / raw ids.
- [x] BAR (or equivalent) rates seeded across the visible tape window so Book does not look
      empty or unpriced.
- [x] Today’s board is occupied: roughly 8 in-house, 4 arrivals, 3 departures, a mix of
      assigned and one unassigned arrival.
- [x] Named guests (first + last). Stay blocks on the tape show **guest name**, not
      `reservationId`.
- [x] Idempotent re-run (or a documented wipe + re-seed) so a failed dry run can recover in
      minutes.
- [x] README “Run locally” points at this command; the three-curl bootstrap remains for
      developers, not for the meeting.

Closed 2026-08-13 by [demo tenant seed](docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md).

### P0-2. Folio first-paint is a bill

`FolioScreen.tsx` currently paints operator internals on first load: window ids, Open COMPANY,
holds keyed by `paymentId`, transfer dest selects, queued command ids, chargeback / FX / split.

This is **content IA**, not the P0-3 skin. Do not fold Advanced / first-paint into the chrome
slice.

- [x] First paint: guest name, dates, room code, **balance**, line list (description + amount),
      post charge, take payment (card + cash).
- [x] Holds / captured show as tenders (amount, last-4 or method) — not raw `paymentId`.
- [x] Chargeback, FX editor, split-to-window, Open COMPANY, queued-command dump live behind
      **Advanced** (collapsed by default).
- [x] No “simulate”, no “unattributed until close discloses the count” on the happy path.
      Open a shift as part of seed or auto-open for the demo actor.
- [x] `data-testid`s on existing controls stay so tests do not rewrite the vertical.

Closed 2026-08-13 by [folio first-paint](docs/superpowers/specs/2026-08-13-folio-first-paint-design.md).

### P0-3. Prototype chrome + contrast-safe skin

Investors should recognize the same product as `hospai-pms-prototype`: left sidebar, sage/tan
warmth, icons, top search rail. They should not get a pixel-faithful rebuild, Tailwind, or
Phase 2/3 surfaces.

**Decided:** chrome + skin on live screens (not skin-only, not pixel-faithful). Palette
re-derived from prototype hues until WCAG AA passes. Hand-written CSS + existing tokens — no
Tailwind, no `packages/ui-kit`. Contrast gate (`check:web-pms-colors`) stays merge-blocking.
Reference: prototype `src/App.tsx` shell + `src/index.css` `@theme`.

#### Shell

`AppShell` becomes the prototype frame. Routes and permissions stay; only chrome moves.
Landing remains `/board` (tape). No Dashboard Hub.

- [x] Left sidebar (~16rem, sticky) + main column. Sage mark + “HospAI PMS”. Selected row:
      cream fill, sage text, icon.
- [x] Footer shows the signed-in role from `/me`. No role-swap dropdown.
- [x] Top operations rail: global search (guest name first), property **name**, business-date
      chip.
- [x] Shift strip stays under the rail. Queued-commands and exceptions stay available but
      **collapsed when empty**.
- [x] Small local SVG set copied from prototype `Icons.tsx` into `apps/web-pms`. No
      `lucide-react`, no `motion`.

**Primary nav (this order):**

| Sidebar label | Route |
|---|---|
| Room Plan | `/board` |
| Front Desk | `/arrivals` (in-house / departures linked from that board, not three equal items) |
| Reservations | `/reservations` |
| New Booking | `/book` |
| Housekeeping | `/housekeeping` |
| Guests | `/guests` |
| Rates | `/rates` |
| Night Audit | `/night-audit` |
| Settings | `/settings` |

**Secondary (visually quieter):** Inventory, Staff, Roster, Exceptions. Folio stays a drill-in
from a stay — we have no org-wide billing list.

**Do not copy from the prototype chrome:** Whistle button, “Simulation Active”, role
impersonation, training-disclaimer footer, property switcher (single demo tenant until seed
exists).

#### Tokens

All colour literals stay on `--color-*` in `apps/web-pms/src/styles/tokens.css`. Semantic
alias names (`--ink`, `--bg`, `--action-primary-*`, `--status-*`) stay so screens inherit
without a markup sweep.

- [x] Chrome primitives from the prototype where they already pass AA; otherwise nudged:
      page bg `#F9F8F4`, selected/chip `#F1EFE9`, borders `#E8E4D8`, ink `#2D2926`, primary
      `#4A5D4E` (white label on `--color-action-primary-surface`), accent `#C18C5D` only if
      it clears 4.5:1 on its fill (else darkened).
- [x] Status rungs unchanged (`settled` / `neutral` / `informational` / `attention` /
      `exception`). Informational drops institutional blue (sage-tinted). Settled stays a
      distinct green, not the same as primary sage. Attention / exception stay amber / red,
      warmed to the new neutrals.
- [x] Every `--status-*-fg` passes 4.5:1 against its surface **and** `--color-surface-base`
      (`pnpm check:web-pms-colors` green).
- [x] Keep IBM Plex / Segoe. Add `--radius` (~8px) for nav rows, search, chips. Nav labels
      ~12px. No dark theme, no prototype `shadow-sm` / `animate-pulse`.

#### Screens (light markup only)

Do not rebuild prototype layouts (tape scheduler popups, folio as a billing app, Dashboard
Hub, recharts). Housekeeping and guests inherit via existing classes.

- [x] Guest names and room codes everywhere a stay is shown. No raw `roomId` / `guestRef` as
      the primary label.
- [x] Tape: page title “Room Plan”; summary chips use cream/sage; stay blocks keep
      `statusClass`.
- [x] Book: drop “Type-only stay…” and `Quote ariVersion`; show a **dollar quote**. Hide
      `guestRef` next to the name.
- [x] Check-in: room picker by **code**; registration card is a print control, not a
      permanent blob.
- [x] Folio: **skin only** (headers, buttons, chips). First-paint / Advanced is P0-2.
- [x] Night audit: operator job chrome, not a JSON dump. Step names stay.
- [x] `data-testid`s stay. Tests change only where shell DOM or copy actually moves (nav
      into `<aside>`).

Closed 2026-08-13 by [prototype chrome + skin](docs/superpowers/specs/2026-08-13-prototype-chrome-skin-design.md).

### P0-4. Sign-in that is not a lab flag

P0-4 shipped Clerk custom sign-in (`SignInScreen`) and a password-gate fallback.

- **Meeting default:** Clerk custom sign-in; unset `VITE_USE_DEV_ACTOR`, set
  `VITE_CLERK_PUBLISHABLE_KEY`, Worker `CLERK_*`, members mapping curl after seed.
- **Password-gate fallback** when Clerk keys cannot land (`VITE_USE_DEV_ACTOR=1` +
  `VITE_DEMO_PASSWORD`).
- **Engineer path** (`VITE_USE_DEV_ACTOR=1` without password) auto-redirects `/sign-in` →
  `/board` — local only, not the meeting path.
- Runbook detail: [`docs/demo/8-minute-script.md`](docs/demo/8-minute-script.md).

- [x] Demo runbook uses Clerk (or a hosted session) on the demo tenant. `X-Dev-Actor` is
      never visible in the room (no header flag, no `.env` on the projector).
- [x] `/sign-in` is a real sign-in surface, not a dead paragraph.
- [x] Unauthorized still redirects there; after sign-in, land on `/board` with the seeded
      day.

If Clerk dashboard setup cannot land in time: a **single demo user** behind a password gate
is acceptable. A visible `X-Dev-Actor` is not.

### P0-5. Script + two dry runs

- [x] Written 8-minute script (copy the table below into speaker notes; times are a ceiling).
- [x] Happy path never leaves these routes: `/board` → `/book` → check-in → `/folio/:id` →
      housekeeping → `/night-audit`.
- [x] Backup beat (optional, 60s): second property verbal isolation on `/board` only. Do not
      open architecture slides unless asked.
- [x] Dry run 1: cold laptop, seeded hotel, timed. Dry run 2: someone else drives.
- [x] Kill list: what you will **not** click (Settings charge codes, Folio Advanced,
      Exceptions, Staff) unless asked.

---

## The 8-minute hotel day

If any step needs a console, a curl, or an apology, P0 is not done.

| Time | Beat | Must look like | Primary surface |
|---|---|---|---|
| 0:00 | Sign-in | Real session. Land on Room Plan, not an empty board. | `/sign-in` → `/board` |
| 0:45 | Tape chart | Today + 6 nights. Named rooms. Click a stay → folio. | `TapeChartScreen` |
| 2:00 | Walk-in book | Type names, **price**, guest name. Confirm → reservation. | `/book` |
| 3:30 | Check-in | Assign by room code, print reg card, land in-house. | `/check-in/:id` |
| 4:30 | Folio | Post minibar, take a card. Balance updates. | `/folio/:id` |
| 5:30 | Housekeeping | That room dirty → clean. Board/tape reflects it. | `/housekeeping` |
| 6:30 | Night audit | Run (or show last run) as a business-date job. | `/night-audit` |
| 7:30 | Moat (optional) | Verbal second-property isolation — 60 seconds, then stop. | `/board` (verbal moat) |

Honest lines you may say: payments are tokenized / sandbox; no live hotel yet. Do not fake
either.

---

## P1 — stronger meeting (after P0)

- [ ] **Guest CRM depth** — merge, consent, stay-history richness beyond the directory that
      already exists. Do not block P0; Book already has find-existing.
- [ ] **Card last-4 / brand on tenders** — keep the simulate gateway; the UI must not say
      simulate. Pair with P0-2.
- [ ] **One hotel voice** — advisor quote, LOI, or a GM who would trial. Not engineering.
- [x] **Hide lab copy** leftover scan: `ariVersion`, `fail_closed` strings, `idempotencyKey`,
      `billed party` placeholders, `user_owner` anywhere visible.

---

## P2 — after the round (not this file’s job)

Track these in [ARCHITECTURE.md](ARCHITECTURE.md) §14 / §16.5 and existing specs, not here.

- Virtual room types
- City ledger, invoice engine, night-audit auto-transfer, partial refunds
- Guest CRM depth beyond a directory (merge, consent, LTV warehouse)
- Channel manager / OTAs, booking engine, group blocks (Phase 2)
- Self-serve Stripe, marketplace, fiscalization (Phase 3)
- ~~Extracting `packages/ui-kit` (§16.4). P0-3 is a token + shell restyle, not that extraction.~~ **Done** (2026-08-14).
- ~~Recording the P0-3 palette adoption in §16.4 (Tailwind still out; visual divergence is no
  longer “expected”)~~ **Done** (2026-08-14).

---

## Out of scope (do not do before the meeting)

Pulling any of these into a “quick polish” slice is how the meeting slips.

- Finishing every Phase 1 leftover so the product is “complete”
- Building OTAs, booking-engine preview, Dashboard Hub, Yield Analytics, or Whistle
- Pixel-faithful rebuild of prototype screen layouts (tape popups, billing app, recharts)
- Exact prototype hex that fails `check:web-pms-colors` (re-derive instead)
- Adding Tailwind v4 to `web-pms`
- ~~Extracting `packages/ui-kit`~~ **Done** (2026-08-14)
- Splitting `property-do.ts` as its own project
- Demo theater: fake Opera sync, impersonation, “Simulation Active”, competitor scrape

---

## Definition of done

P0 is done when **all** of the following are true on a cold machine:

1. One command (or a 3-line runbook with no curl JSON) yields the seeded hotel.
2. Sign-in → Room Plan shows today’s named occupancy with no empty-state apology.
3. Chrome matches the prototype read: sidebar, sage/tan (AA-safe), search rail, icons.
4. The 8-minute script completes twice, timed, without opening DevTools or Advanced.
5. Folio first paint is a bill a GM would recognize.
6. Nobody in the room sees `X-Dev-Actor`, `rt_king`, `prop_demo`, or `paymentId`.

P1 is optional. Shipping P1 without P0 is not demo-ready.

---

## Suggested slice order (when you start building)

Each row is one spec → plan → PR. Do not combine 1 with 3, or 2 with 3.

| # | Slice | Closes |
|---|---|---|
| 1 | Demo tenant seed (Worker + script) | P0-1 |
| 2 | Folio first-paint / Advanced | P0-2 |
| 3 | Prototype chrome + tokens + light screen copy | P0-3 |
| 4 | Demo auth (Clerk SPA or password gate) | P0-4 |
| 5 | Script + dry-run checklist (this section, speaker notes) | P0-5 |
| 6 | Guest CRM depth (only if calendar allows) | P1 |

Slice 5 is documentation and rehearsal, not a product spec. Slices 1–4 follow the normal
`docs/superpowers/specs/` path when they change Worker or SPA behaviour. P0-3’s product
decisions live in this file; write a spec only if the implementer needs one.
