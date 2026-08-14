# Script + two dry runs (P0-5)

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P0-5 (lines 196–205), 8-minute hotel-day table (209–226), definition of done (271–280); [sign-in Clerk (P0-4)](./2026-08-13-sign-in-clerk-design.md) §3.1 dashboard checklist, §6.2 members-by-email mapping curl, §11.2 leftover deferred P0-5; [demo tenant seed (P0-1)](./2026-08-13-demo-tenant-seed-design.md) §3–§7 (`pnpm demo:seed`, wipe, **The Meridian Seattle**); [README.md](../../../README.md) Run locally §1 auth/demo paragraphs (mapping curl); `apps/web-pms/src/App.tsx`; happy-path screen files cited below.

**Closes:** DEMO-READY P0-5 (written 8-minute script, happy-path route discipline, one backup beat, two dry-run checklists, kill list). Fixes stale P0-4 prose in DEMO-READY §P0-4 (lines 183–185 still describe `/sign-in` as a dead paragraph — P0-4 landed; this chunk updates that prose when ticking P0-5).

**Amends:** None to prior specs. P0-4 operational steps (Clerk dashboard, mapping curl, password-gate trigger) are **executed** by the runbook sections of the deliverable script file, not re-specified here beyond pointers.

**Does not close:** P1 lab-copy scan, UI convergence batches 1–7, sign-out chrome, second seeded property, production Clerk instance, automated CI rehearsal, any Worker or SPA behaviour change.

---

## 1. Context & Motivation

Slices P0-1 through P0-4 made the product demoable: a named occupied hotel, folio first-paint, prototype chrome, and Clerk (or password-gate) sign-in. The meeting still fails if the presenter improvises, opens Advanced folio, or spends eight minutes in DevTools.

P0-5 is **documentation and rehearsal**, not a product spec. DEMO-READY line 299: *"Slice 5 is documentation and rehearsal, not a product spec."* It produces speaker notes, operational runbooks deferred from P0-4, kill lists, and human dry-run checklists. It must **not** add features, routes, commands, schema, package dependencies, or UI work.

If the author discovers a product defect that would block the script (e.g. walk-in Book sold out, check-in room list empty, night audit cannot run), name it in §11 as a **leftover for a later chunk** — do not fold a fix into this spec.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| 8-minute beat table | `DEMO-READY.md:209–226` — timed beats, surfaces, honest payment lines |
| P0-5 checkboxes (open) | `DEMO-READY.md:196–205` — script, route discipline, backup beat, dry runs, kill list |
| Stale P0-4 prose | `DEMO-READY.md:183–185` — still says SPA defaults to dev actor and `/sign-in` is literal "Sign in required"; **out of date** after P0-4 |
| One-command seed | `package.json` `"demo:seed": "node scripts/demo-seed.mjs"`; README §3; property **The Meridian Seattle** (`demo-tenant-seed` §4) |
| Wipe + re-seed | README:114–118; `demo-tenant-seed` §7.2 — stop Worker, delete `apps/pms-core/.wrangler/state`, restart, `pnpm demo:seed` |
| Demo board fixture | Seed §5.5 — 8 in-house, 4 arrivals, 3 departures, 1 unassigned (Amira Hassan / `res_demo_arr_04`); walk-in inventory rooms `108`–`110`, `205`–`206`, `303`–`304` |
| `/sign-in` route | `App.tsx:80` → `SignInScreen` (outside `AppShell`) |
| Sign-in surface | `SignInScreen.tsx:12–27` — HospAI mark, "Sign in", "Front desk"; Clerk / password-gate / engineer modes via `spa-auth-mode.ts` |
| Happy-path routes | `App.tsx:46–54,57,70,78` — `/board`, `/book`, `/check-in/:reservationId`, `/folio/:reservationId`, `/housekeeping/*`, `/night-audit` |
| Tape / Room Plan | `TapeChartScreen.tsx:404` — `<h1 className="board-title">Room Plan</h1>`; guest names via `GuestNameLink` |
| Book | `BookRoute.tsx:15` gates permissions; `BookingScreen.tsx:362` `data-testid="booking-screen"`; dollar quote `stay-quote`; `confirm-book` |
| Check-in | `CheckInScreen.tsx:18` — `/check-in/:reservationId`; room picker `check-in-room` by **code** |
| Folio first-paint | `FolioScreen.tsx:777` `folio-balance`; `867` `folio-lines`; `889–904` Post charge / `add-charge`; `916–945` Take payment / card+cash; `976` `folio-advanced` collapsed `<details>` |
| Housekeeping | `HousekeepingScreen.tsx:8` — `@hospai/pms-housekeeping/ui` board |
| Night audit | `NightAuditRoute.tsx:11`; `NightAuditScreen.tsx:140` `night-audit-screen`; Run control present |
| Property rail | `AppShell.tsx:207` `data-testid="property-name"`; footer `shell-role` `:298` |
| Clerk demo path | README:75–88 — unset `VITE_USE_DEV_ACTOR`, set `VITE_CLERK_PUBLISHABLE_KEY`, Worker `CLERK_*`, mapping curl after seed |
| Password-gate fallback | `spa-auth-mode.ts:11–12` — `VITE_USE_DEV_ACTOR=1` + `VITE_DEMO_PASSWORD`; `.env.example:7–9` commented |
| Engineer path (not meeting) | README:75 — `VITE_USE_DEV_ACTOR=1` auto-redirects `/sign-in` → `/board`; **not** the meeting auth path |
| P0-4 dashboard checklist | `sign-in-clerk-design.md:133–141` — dev Clerk app, no Organizations, email+password, one user, env vars |
| P0-4 mapping curl | `sign-in-clerk-design.md:286–290`; README:81–86 — seed first, members POST, then sign-in |
| Kill-list surfaces (exist but off-path) | `App.tsx:71–76` — `/exceptions`, `/settings/charges`; `App.tsx:68–69` `/staff`; folio Advanced § above |
| `/dev/ui` | **Not shipped.** Referenced only in ui-system-convergence spec/plan — no route in `App.tsx`. Include on kill list as *if present in a future dev build, do not open* |
| `docs/demo/` | **Absent.** No prior script file |
| Heads | `register.test.ts:627` — `COMMAND_CATALOG` length **77**; `:619` — `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` |
| web-pms tests | **49** `*.test.{ts,tsx}` under `apps/web-pms/src` (P0-4 added auth tests; count moved from 44) |
| `@clerk/react` | `apps/web-pms/package.json:14` — already present from P0-4; **this chunk adds no deps** |

**Heads (this chunk does not move them):** catalog **77**, route audit **[127] = post_demo_seed**, writer set **52**, schema **25** / **7**, `NIGHT_AUDIT_STEPS` **7**, `PLATFORM_GAPS` `[]`. No new Worker route, command, or table.

### 1.2 What is broken today (verified — this is the motivation)

| # | Gap | Evidence | Symptom |
|---|---|---|---|
| 1 | **No written script.** | `docs/demo/` missing; P0-5 boxes open | Presenter improvises; opens Advanced, Settings, or Staff |
| 2 | **P0-4 runbook steps live in specs/README, not speaker notes.** | `sign-in-clerk-design.md:133–141`, `§6.2`; README:79–88 | Cold-laptop operator hunts three files before the meeting |
| 3 | **No dry-run checklists.** | DEMO-READY:203–204 | "Complete twice, timed" is unverifiable |
| 4 | **Stale DEMO-READY P0-4 prose.** | `DEMO-READY.md:183–185` | Reviewer reads contradictory state vs ticked P0-4 |
| 5 | **Kill list only implied.** | Scattered in DEMO-READY:204–205, 278 | Presenter clicks Exceptions or charge codes under pressure |

**Not gaps (do not "fix" in P0-5):** Product routes, seed fixture, sign-in implementation, folio Advanced existing, empty exception queue by default, no second property seeded, no sign-out button.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **No Worker or SPA behaviour change.** No edits under `apps/pms-core/src`, `apps/web-pms/src`, `packages/`, or root `package.json` scripts/deps. Documentation and DEMO-READY prose only (plus ticking P0-5).
2. **Heads frozen** per §1.1. No `pnpm generate:ddl` diff. Catalog **77**, route **[127]**, schema **25** / **7**.
3. **P0-4 auth decisions stand.** Meeting default = Clerk custom sign-in (`spa-auth-mode` `clerk`). Password-gate = named fallback when dashboard keys cannot land. Engineer `VITE_USE_DEV_ACTOR=1` without password is **local engineering only**, never documented as the meeting path.
4. **Happy path route discipline.** Script beats use only: `/sign-in` → `/board` → `/book` → `/check-in/:id` → `/folio/:id` → `/housekeeping` → `/night-audit`. Sidebar may be used to navigate; do not require `/arrivals`, `/reservations`, `/guests`, etc. on the timed path unless the script explicitly marks them optional.
5. **One backup beat only.** Second property isolation **or** exception queue — **not both**. This spec locks **second property isolation** (§4.3).
6. **Honest lines required.** Script includes DEMO-READY payment sandbox line and "no live hotel yet" — do not fake either.
7. **Dry runs are human, not CI.** Checklists are written and recorded by people; no GitHub Action, no Vitest timer test, no merge gate that requires Dry run 2 completion.
8. **Kill list is normative for the happy path.** Settings charge codes, Folio Advanced, Exceptions, Staff, lab surfaces — unless an investor asks.
9. **Cold boot uses documented seed only.** Runbook references `pnpm demo:seed` and README wipe steps; does not invent `--wipe` automation or new seed commands.
10. **Single presenter artifact.** One markdown file holds timed beats, copy, kill list, runbooks, and dry-run log sections (§4.1).

---

## 3. Scope in

1. **Primary deliverable:** `docs/demo/8-minute-script.md` — copy-ready speaker notes (§4, §5, §6, §7).
2. **DEMO-READY tick:** P0-5 checkboxes (lines 196–205) in the implementation PR.
3. **DEMO-READY prose fix:** Replace stale P0-4 paragraph (lines 183–185) with accurate post-P0-4 summary (Clerk default, password-gate fallback, real `/sign-in`; remove "dead paragraph" claim).
4. **Clerk dashboard + mapping runbook** inside the script file (content from P0-4 §3.1, §6.2 — not a duplicate spec).
5. **Password-gate fallback runbook** inside the script file (trigger, env vars, honest Network-tab caveat).
6. **Cold-laptop boot sequence** inside the script file (terminals, env flags, seed, mapping order).
7. **Dry run 1 and Dry run 2 checklists** at the bottom of the same file with dated pass/fail checkboxes (§8).
8. **Kill list** section in the script file (§7).

### 3.1 Scope out (normative — name them so a later pass does not "fix" them here)

- **Any product code** — routes, screens, Worker, seed fixture changes, new env vars, package.json deps.
- **Sign-out, `<UserButton>`, MFA, OAuth, Clerk hosted pages.**
- **Second seeded property** or org switcher UI.
- **Staging a forced exception** for the backup beat (exception queue rejected as backup — §4.3).
- **Automated timed rehearsal** in CI or Vitest.
- **Dry run 2 as a merge gate** — requires another human; state honestly in spec and checklist.
- **UI convergence / P1 lab-copy scan.**
- **Architecture slides** — backup beat is in-product narrative, not a deck (DEMO-READY:202).
- **Restyling screens, re-seeding fixtures** beyond documenting existing wipe command.
- **Creating `docs/demo/dry-runs.md` as a separate file** — rejected; keep one artifact (§4.1).
- **Committing Clerk secrets, demo passwords, or real user emails** into the repo — placeholders only in committed markdown; real values live in operator notes / gitignored `.env`.

---

## 4. Decision 1 — deliverable shape (normative)

### 4.1 File path (locked)

| Deliverable | Path | Role |
|---|---|---|
| Speaker notes + runbooks + dry-run log | `docs/demo/8-minute-script.md` | Presenter copies sections into notes app; single source of truth |

Rejected: splitting runbooks into a second repo file (operator would hunt). Rejected: embedding only in DEMO-READY (too long; DEMO-READY stays a checklist hub).

### 4.2 Required sections inside `8-minute-script.md` (locked outline)

The implementation PR **writes** this file. The spec defines what each section must contain:

1. **Title + meeting metadata** — 8-minute ceiling, property **The Meridian Seattle**, org **Harborlight Hospitality**, demo URL `http://127.0.0.1:5173/` (or built Assets origin if used).
2. **Cold-laptop boot** (§6) — before sign-in.
3. **Clerk happy-path runbook** (§5.1) — dashboard + env + mapping curl.
4. **Password-gate fallback runbook** (§5.2) — one-screen switch procedure.
5. **Timed beats table** — copy DEMO-READY table (209–226) row-for-row with **exact clicks, testids or labels, and spoken one-liners** per beat (§5.3).
6. **Kill list** (§7).
7. **Backup beat** (§4.3) — optional 60s, clearly marked skippable.
8. **Honest lines** — verbatim from DEMO-READY:224–225.
9. **Dry run 1 checklist** (§8.1) — dated pass/fail checkboxes.
10. **Dry run 2 checklist** (§8.2) — dated pass/fail checkboxes.
11. **Dry run log** — empty dated rows for implementer / presenter to fill after rehearsals.

### 4.3 Backup beat choice (locked)

| Option | Verdict | Why |
|---|---|---|
| **Exception queue after forced fail** | **Rejected for this script** | Requires staging a failure or hoping the queue is non-empty; contradicts kill list unless investor asks; "forced fail" is operational risk with no documented one-liner in seed |
| **Second property isolation (60s moat)** | **Locked** | Speak to multi-tenant isolation while pointing at `property-name` chip (**The Meridian Seattle**); explain one Durable Object per property / no cross-property leakage without needing a second seeded tenant or `/exceptions` navigation |

**Backup script shape (normative content requirements):**

- Stay on `/board` or return there from `/night-audit`.
- Point at `data-testid="property-name"` and sidebar context — *this* hotel only.
- One sentence: Harborlight may operate many properties; each property's ledger and inventory are isolated in their own Durable Object — data from another hotel never appears on this tape.
- **Do not** open `/exceptions`, Settings, or a second browser profile.
- **Stop at 60 seconds.** No architecture slides.

---

## 5. Decision 2 — auth path for the meeting (normative)

### 5.1 Default — Clerk happy path (locked)

Follow P0-4 §3.1 and README:75–88. The script file's runbook section must include, in order:

1. Clerk Dashboard: development application; **Organizations off**; email+password only; sign-ups disabled if offered; **one** demo user (email + password in operator notes, not committed).
2. SPA `apps/web-pms/.env` (gitignored): **delete / unset** `VITE_USE_DEV_ACTOR`; set `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…`.
3. Worker `apps/pms-core/.dev.vars`: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, optional `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` (add Assets origin if serving built SPA on `:8787`).
4. Keep existing unsafe-local flags (`HOSPAI_UNSAFE_LOCAL`, `HOSPAI_ALLOW_DEV_ACTOR`, `HOSPAI_ORG_MASTER_KEY`) — seed still uses dev actor over HTTP.
5. Boot Worker + SPA; `pnpm demo:seed`.
6. Mapping curl (after Clerk user exists, before first demo sign-in):

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/members \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"email":"<Clerk user email>","role":"owner"}'
```

7. Sign in at `/sign-in` → land `/board` with occupied Room Plan; footer `shell-role` **Owner**.

**Failure mode to document:** sign-in before mapping → `me-no-access` (correct; re-order steps).

### 5.2 Fallback — password gate (locked)

**Trigger:** Clerk dashboard keys or Worker `CLERK_*` cannot land before the meeting.

Procedure the script must document:

1. SPA `.env`: `VITE_USE_DEV_ACTOR=1`; set `VITE_DEMO_PASSWORD=…` (and optional `VITE_DEMO_EMAIL`, default `demo@hospai.local`); **no** `VITE_CLERK_PUBLISHABLE_KEY`.
2. Worker: Clerk keys omitted; keep `HOSPAI_ALLOW_DEV_ACTOR=1`.
3. Same seed command; **no mapping curl** (actor remains seeded `user_owner`).
4. `/sign-in` shows password gate; unlock → `/board`.
5. **Honest caveat** (required copy): presentation control only; `x-dev-actor` may appear in DevTools — not the happy path, acceptable for fallback only. Never project `.env`.

### 5.3 Engineer path — explicitly not the meeting path (locked)

`VITE_USE_DEV_ACTOR=1` without `VITE_DEMO_PASSWORD` → immediate `/board` redirect. Document in runbook as **"local engineering only — do not use in the room."**

---

## 6. Decision 3 — cold-laptop boot sequence (normative)

The script file must document this sequence verbatim (adjust only if README changes):

| Step | Action |
|---|---|
| 1 | Clone / pull repo; `pnpm install` |
| 2 | Copy env templates: `cp apps/pms-core/.dev.vars.example apps/pms-core/.dev.vars`; `cp apps/web-pms/.env.example apps/web-pms/.env` |
| 3 | Configure auth per §5.1 or §5.2 |
| 4 | Terminal A: `pnpm --filter @hospai/pms-core dev` (wait for `:8787`) |
| 5 | Terminal B: `pnpm --filter @hospai/web-pms dev` |
| 6 | Terminal B (or C): `pnpm demo:seed` — expect **The Meridian Seattle**, board 8/4/3 |
| 7 | Clerk only: mapping curl §5.1 step 6 |
| 8 | Open `http://127.0.0.1:5173/sign-in` — not DevTools |

**Recovery:** README wipe (stop Worker → delete `apps/pms-core/.wrangler/state` → restart → `pnpm demo:seed` → re-map Clerk user if needed).

**Timezone note:** If property was first provisioned with UTC three-curl bootstrap, seed dates follow stored TZ (demo-seed open question 10). Script should say: *if board dates look wrong after an old curl, wipe and re-seed* — do not add product work.

---

## 7. Decision 4 — timed beats and kill list (normative)

### 7.1 Timed beats — content requirements

Copy DEMO-READY times as a **ceiling**. Each beat row in the script must add:

| Time | Beat | Script must specify |
|---|---|---|
| 0:00 | Sign-in | Clerk email/password fields; success → Room Plan populated (not empty-state apology); property name visible |
| 0:45 | Tape chart | Sidebar **Room Plan** or already on `/board`; today + 6 nights; click a named in-house stay → folio link (e.g. James Whitaker / room `101`) — **optional** folio peek or defer to 4:30 |
| 2:00 | Walk-in book | Sidebar **New Booking** → `/book`; King Deluxe / Twin type **names**; `$289.00`-style quote (`stay-quote`); guest name; **Confirm booking** — use seeded free inventory (e.g. room type King Deluxe, nights tonight→+1) |
| 3:30 | Check-in | Navigate to `/check-in/:id` for **new walk-in** or seeded unassigned **Amira Hassan** (`res_demo_arr_04`) if walk-in assign is skipped; pick room **by code** (e.g. `108`); registration card print is a **click**, not a scroll-forever blob; complete check-in → in-house |
| 4:30 | Folio | `/folio/:id` for the checked-in guest; **Post charge** (minibar or generic description); **Take payment** card path; `folio-balance` updates; **do not expand Advanced** |
| 5:30 | Housekeeping | Sidebar **Housekeeping**; mark the checked-in room **dirty** → **clean**; optionally glance at Room Plan to show reflection |
| 6:30 | Night audit | Sidebar **Night Audit**; **Run night audit** or show last run / step list as business-date job — not raw JSON |
| 7:30 | Moat (optional) | §4.3 backup beat only if time remains |

**Route discipline:** Primary surfaces in DEMO-READY: `TapeChartScreen`, `/book`, check-in, `/folio/:id`, `/housekeeping`, `/night-audit`. Script must not require DevTools, curl in the room (mapping is pre-meeting), or apologizing for empty state.

### 7.2 Kill list (locked — verbatim baseline + extensions)

The script file must include a prominent **Do not click unless asked** section:

| Surface | Route / control | Why |
|---|---|---|
| Settings charge codes | `/settings/charges` | Lab config |
| Folio Advanced | `details[data-testid="folio-advanced"]` | Operator internals |
| Exceptions | `/exceptions` | Fail-closed workbench — backup rejected |
| Staff | `/staff` | Not part of hotel day |
| Inventory / Rates / Roster | sidebar secondary | Off-script depth |
| Raw ids in spoken copy | — | Never say `rt_king`, `prop_demo`, `paymentId`, `user_owner` |
| DevTools / Network | — | DEMO-READY definition of done §278 |
| `.env` on projector | — | P0-4 invariant |
| `/dev/ui` | if ever present in dev builds | Convergence gallery — not demo path |

---

## 8. Decision 5 — dry runs (normative)

### 8.1 Recording method (locked)

- **Location:** Bottom of `docs/demo/8-minute-script.md` — sections **Dry run 1**, **Dry run 2**, and **Dry run log**.
- **Format:** Markdown checkboxes `- [ ]` / `- [ ] PASS` / `- [ ] FAIL` with `Date: ____` and `Operator: ____` lines.
- **Rejected:** Separate `docs/demo/dry-runs.md` (split attention). Rejected: GitHub Issue template. Rejected: spreadsheet.

### 8.2 Dry run 1 — cold laptop, seeded hotel, timed

**Who:** Implementer may execute if a seeded stack is running; **not required as merge gate** (human clock + full cold boot is expensive in CI/agent context).

**Checklist items the script must include:**

- [ ] Cold boot §6 completed without ad-hoc curls in the room
- [ ] Sign-in → `/board` ≤ 45s into run
- [ ] Room Plan shows named occupancy (8+ stays visible on tape); property **The Meridian Seattle**
- [ ] Walk-in book completes with dollar quote
- [ ] Check-in assigns by room code
- [ ] Folio post + payment; balance changes; Advanced stayed collapsed
- [ ] Housekeeping dirty → clean for demo room
- [ ] Night audit screen shows job chrome; run or last-run visible
- [ ] Total time ≤ 8 minutes
- [ ] Kill-list surfaces not opened
- [ ] No DevTools; no `X-Dev-Actor` visible in UI copy

### 8.3 Dry run 2 — someone else drives

**Who:** Another human (founder, AE, engineer who didn't write the script). **Honest scope:** An agent cannot sit a second person through rehearsal; the implementation PR **writes** the checklist only. Passing Dry run 2 is **recommended before the meeting**, not enforced by automation.

**Checklist items the script must include:**

- [ ] Driver had not run seed in the last 24h (or used wipe boot)
- [ ] Driver followed script clicks only — no sidebar improvisation
- [ ] Driver completed all beats without presenter rescue
- [ ] Timer recorded; note overruns by beat
- [ ] Feedback lines blank for post-run notes

---

## 9. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `docs/demo/8-minute-script.md` | **New** — full deliverable per §4.2 |
| `DEMO-READY.md` | Tick P0-5 boxes (196–205); fix stale P0-4 prose (183–185) |
| `README.md` | Optional one-line pointer: "Meeting script: `docs/demo/8-minute-script.md`" — **allowed, not required** |

**Not touched:** `apps/pms-core/**`, `apps/web-pms/**`, `packages/**`, `package.json`, `scripts/demo-seed.mjs`, `.env.example` (already updated in P0-4), contracts, seed fixture.

---

## 10. Leftovers

### 10.1 Folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Written 8-minute script / speaker notes | DEMO-READY P0-5 |
| 2 | Kill list | DEMO-READY:204–205 |
| 3 | Two dry-run checklists | DEMO-READY:203 |
| 4 | Clerk dashboard + mapping runbook execution docs | P0-4 §3.1, §6.2 deferred |
| 5 | Password-gate fallback runbook | P0-4 §3.2 |
| 6 | Cold-laptop boot + wipe recovery | P0-1 README + demo-seed §7 |
| 7 | Fix stale P0-4 prose in DEMO-READY | This spec §1.2 #4 |
| 8 | Tick P0-5 | DEMO-READY |

### 10.2 Deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **Exception queue backup beat** | Rejected §4.3 — would need forced fail staging |
| 2 | **Second seeded property** | Isolation beat is narrative only |
| 3 | **Sign-out control** | P0-4 leftover |
| 4 | **Automated rehearsal / CI timer** | §8 |
| 5 | **P1 lab-copy scan** | DEMO-READY P1 |
| 6 | **UI convergence `/dev/ui`** | Not in tree; kill-list mention only |
| 7 | **Card last-4 / brand on tenders** | P1; script may note sandbox payments honestly |
| 8 | **Product fixes** if dry run discovers blockers | File as new P0/P1 slice — e.g. walk-in inventory sold out, night audit hard-403, empty tape after seed |

---

## 11. Tests (acceptance-shaped)

Reviewer checks **without running the meeting**:

**Deliverable presence**

1. `docs/demo/8-minute-script.md` exists and is copy-ready prose (not bullet stubs).
2. Every DEMO-READY table beat (209–226) appears as a timed row with clicks/copy.
3. Kill list §7.2 present verbatim baseline.
4. Clerk runbook §5.1 and password-gate §5.2 present.
5. Cold boot §6 present including `pnpm demo:seed` and wipe pointer.
6. Mapping curl present with placeholder email; order seed → map → sign-in stated.
7. Backup beat is **second property isolation only** — no exception-queue instructions.
8. Honest lines (224–225) quoted.
9. Dry run 1 and 2 checklists with dated pass/fail at file bottom §8.
10. Statement that Dry run 2 requires a human and is not a merge gate.

**Repo hygiene (no product diff)**

11. `git diff` shows **no** changes under `apps/`, `packages/`, `scripts/demo-seed.mjs`, or root `package.json` dependency blocks.
12. `COMMAND_CATALOG` length **77**; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (unchanged).
13. DEMO-READY P0-5 boxes ticked; P0-4 prose no longer claims dead `/sign-in` paragraph.

**Optional manual (implementer)**

14. Dry run 1 executed — log filled in script file (not required for spec approval or merge).

---

## 12. Open questions (locked unless noted)

1. **Deliverable path?** **Locked: `docs/demo/8-minute-script.md`.**
2. **Separate dry-run file?** **Locked: no — bottom of script file.**
3. **Backup beat?** **Locked: second property isolation verbal moat.** Exception queue rejected.
4. **Meeting auth default?** **Locked: Clerk.** Password-gate fallback only. Engineer dev-actor not meeting path.
5. **Dry run 2 merge gate?** **Locked: no.** Checklist written; human rehearsal recommended.
6. **Dry run 1 merge gate?** **Locked: no** — optional for implementer; human clock.
7. **Product code in this chunk?** **Locked: none.**
8. **Fix DEMO-READY stale P0-4 prose?** **Locked: yes** in same PR as P0-5 tick.
9. **README pointer to script?** **Locked: optional one line** — implementer discretion.
10. **Walk-in vs Amira for check-in beat?** **Locked: script picks one primary path** — walk-in from Book beat preferred for narrative continuity; Amira (`res_demo_arr_04`) as fallback if book beat is shortened. Implementer chooses in script prose; spec requires room-by-code assign.
11. **Which in-house stay for tape click (0:45)?** **Locked: any named in-house block** — suggest James Whitaker room `101` in script for repeatability.

---

## 13. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Write `docs/demo/8-minute-script.md` per §4.2, §5, §6, §7, §8 (full prose, placeholders for secrets).
- [ ] Include kill list §7.2 and honest lines.
- [ ] Lock backup beat to second property isolation §4.3 only.
- [ ] Tick DEMO-READY P0-5 (196–205).
- [ ] Fix DEMO-READY P0-4 stale prose (183–185).
- [ ] Optional README one-liner to script path.
- [ ] Verify zero product diff — no `apps/`, `packages/`, `package.json` deps/scripts changes.
- [ ] Optionally execute Dry run 1 and fill log — not merge-blocking.
- [ ] Stop. Do not start UI convergence. Do not commit in the spec-authoring turn.

---

## 14. Reviewer checklist

- [ ] Verified-current-state §1.1 matches tree: routes in `App.tsx`, `SignInScreen` real, seed command, catalog **77**, route **127**, no `docs/demo/` yet, stale DEMO-READY P0-4 prose noted.
- [ ] Invariants include no Worker/SPA change, heads frozen, P0-4 auth stands, one backup beat, human dry runs.
- [ ] Deliverable path **`docs/demo/8-minute-script.md`** locked; dry-run checkboxes at bottom of same file.
- [ ] Backup beat **second property isolation** — exception queue explicitly rejected with reason.
- [ ] Clerk runbook + mapping curl + order + password-gate + engineer-not-meeting path all specified.
- [ ] Kill list matches DEMO-READY plus lab surfaces; `/dev/ui` mentioned as conditional.
- [ ] Scope-out names product code, CI rehearsal, second property seed, exception staging.
- [ ] Acceptance tests §11 and implementation checklist §13 present.
- [ ] Folded vs deferred leftovers §10 present.
- [ ] This file is **spec only** — no plan, no script file written in spec turn, no commit, status Draft not Approved.
