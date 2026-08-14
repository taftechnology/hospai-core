# 8-minute hotel day — speaker notes

**Ceiling:** 8 minutes  
**Property:** The Meridian Seattle  
**Organization:** Harborlight Hospitality  
**Demo URL:** `http://127.0.0.1:5173/` (or built Assets origin `http://127.0.0.1:8787/` if serving the built SPA)

Copy sections below into your notes app before the meeting. Runbooks are pre-meeting only — no curl or DevTools in the room.

---

## Cold-laptop boot (before sign-in)

Do this on a fresh machine or after a wipe. Adjust only if README boot steps change.

| Step | Action |
|---|---|
| 1 | Clone / pull repo; `pnpm install` |
| 2 | Copy env templates: `cp apps/pms-core/.dev.vars.example apps/pms-core/.dev.vars`; `cp apps/web-pms/.env.example apps/web-pms/.env` |
| 3 | Configure auth per **Clerk happy path** (default) or **Password-gate fallback** below |
| 4 | Terminal A: `pnpm --filter @hospai/pms-core dev` (wait for `:8787`) |
| 5 | Terminal B: `pnpm --filter @hospai/web-pms dev` |
| 6 | Terminal B (or C): `pnpm demo:seed` — expect **The Meridian Seattle**, board **8 in-house / 4 arrivals / 3 departures** |
| 7 | Clerk only: mapping curl (see Clerk runbook) |
| 8 | Open `http://127.0.0.1:5173/sign-in` — not DevTools |

**Recovery (dirty hotel after a dry run):**

1. Stop `pnpm --filter @hospai/pms-core dev`
2. Delete `apps/pms-core/.wrangler/state`
3. Start the Worker again
4. `pnpm demo:seed`
5. Re-map Clerk user if using Clerk path

Do not run org purge for this. Do not invent `--wipe` or new seed commands.

**Timezone note:** If the property was first provisioned with a UTC three-curl bootstrap, seed dates follow the stored timezone. If board dates look wrong after an old curl, wipe and re-seed — do not add product work in the room.

---

## Clerk happy-path runbook (meeting default)

Follow this order. Real Clerk email and password live in operator notes — never commit them.

### 1. Clerk Dashboard

- Development application (not production)
- **Organizations off**
- Email + password only; disable sign-ups if offered
- **One** demo user (email + password in operator notes)

### 2. SPA env (`apps/web-pms/.env`, gitignored)

- **Delete / unset** `VITE_USE_DEV_ACTOR`
- Set `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` (placeholder — use your dev key)

### 3. Worker env (`apps/pms-core/.dev.vars`)

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- Optional `CLERK_JWT_KEY`
- `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` (add Assets origin if serving built SPA on `:8787`)
- Keep existing unsafe-local flags: `HOSPAI_UNSAFE_LOCAL`, `HOSPAI_ALLOW_DEV_ACTOR`, `HOSPAI_ORG_MASTER_KEY` — seed still uses dev actor over HTTP

### 4. Boot and seed

1. Start Worker + SPA (cold boot steps 4–5)
2. `pnpm demo:seed`

### 5. Mapping curl (after Clerk user exists, **before** first demo sign-in)

Order is load-bearing: **seed → map → sign-in**.

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/members \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"email":"<Clerk user email>","role":"owner"}'
```

Replace `<Clerk user email>` with the demo user's email from operator notes.

### 6. Sign in

Open `/sign-in` → enter Clerk email and password → land on `/board` with occupied Room Plan; footer `shell-role` shows **Owner**.

**Failure mode:** Sign-in before mapping → `me-no-access` (correct behavior; re-order steps — map first, then sign in).

---

## Password-gate fallback runbook

**Trigger:** Clerk dashboard keys or Worker `CLERK_*` cannot land before the meeting.

1. SPA `.env`: `VITE_USE_DEV_ACTOR=1`; set `VITE_DEMO_PASSWORD=…` (and optional `VITE_DEMO_EMAIL`, default `demo@hospai.local`); **no** `VITE_CLERK_PUBLISHABLE_KEY`
2. Worker: omit Clerk keys; keep `HOSPAI_ALLOW_DEV_ACTOR=1`
3. Same seed command; **no mapping curl** (actor remains seeded `user_owner`)
4. `/sign-in` shows password gate; unlock → `/board`

**Honest caveat (say if asked):** This is presentation control only. `x-dev-actor` may appear in DevTools Network tab — not the happy path, acceptable for fallback only. **Never project `.env` on screen.**

---

## Engineer path — not the meeting path

`VITE_USE_DEV_ACTOR=1` **without** `VITE_DEMO_PASSWORD` → `/sign-in` auto-redirects immediately to `/board`. This is **local engineering only — do not use in the room.** The meeting default is Clerk (above); password-gate is the named fallback when Clerk keys cannot land.

---

## Timed beats

Times are a **ceiling**. If any step needs a console, a curl, or an apology, stop and fix boot — do not improvise in the room.

**Route discipline:** Happy path uses only `/sign-in` → `/board` → `/book` → `/check-in/:id` → `/folio/:id` → `/housekeeping` → `/night-audit`. Sidebar navigation is fine. Do not require `/arrivals`, `/reservations`, `/guests`, etc. on the timed path.

| Time | Beat | Must look like | Primary surface | Clicks & spoken line |
|---|---|---|---|---|
| 0:00 | Sign-in | Real session. Land on Room Plan, not an empty board. | `/sign-in` → `/board` | Open `/sign-in`. Clerk: fill `sign-in-email` and `sign-in-password`, click `sign-in-submit`. Password-gate: enter demo password. **Say:** "Front desk signs in — we land on today's room plan, not an empty board." Success: Room Plan populated; `data-testid="property-name"` shows **The Meridian Seattle**; footer `shell-role` **Owner**. |
| 0:45 | Tape chart | Today + 6 nights. Named rooms. Click a stay → folio. | `TapeChartScreen` | Sidebar **Room Plan** (or already on `/board`). Confirm today + 6 nights visible. Click **James Whitaker**, room **`101`** — named in-house block. Optional folio peek via guest link, or defer to 4:30. **Say:** "This is the tape — every occupied room, arrivals, and departures for the week." |
| 2:00 | Walk-in book | Type names, **price**, guest name. Confirm → reservation. | `/book` | Sidebar **New Booking** → `/book` (`data-testid="booking-screen"`). Pick room type by **name** (e.g. **King Deluxe** or **Twin**). Confirm `stay-quote` shows a dollar amount (e.g. **$289.00**). Enter guest name. Click **Confirm booking** (`confirm-book`). Uses seeded free inventory (rooms `108`–`110`, `205`–`206`, `303`–`304`). **Say:** "Walk-in at the desk — pick a type, see the rate, confirm the reservation." |
| 3:30 | Check-in | Assign by room code, print reg card, land in-house. | `/check-in/:id` | **Primary:** Navigate to `/check-in/:id` for the walk-in reservation just booked. **Fallback (if Book beat shortened):** Seeded unassigned arrival **Amira Hassan** — reservation `res_demo_arr_04`. Room picker `check-in-room`: assign by **code** (e.g. **`108`**). Registration card print = one click — not a scroll-forever blob. Complete check-in → guest lands in-house. **Say:** "Assign a physical room by code, print the reg card, guest is in-house." |
| 4:30 | Folio | Post minibar, take a card. Balance updates. | `/folio/:id` | `/folio/:id` for the checked-in guest. **Post charge** — minibar or generic description (`folio-lines` updates). **Take payment** — card path; `folio-balance` updates. **Do not expand** `details[data-testid="folio-advanced"]`. **Say:** "Post a charge, take payment — balance updates like a real front-desk folio." |
| 5:30 | Housekeeping | That room dirty → clean. Board/tape reflects it. | `/housekeeping` | Sidebar **Housekeeping**. Mark the checked-in demo room **dirty** → **clean**. Optionally glance at Room Plan to show reflection. **Say:** "Housekeeping marks the room — the tape reflects status." |
| 6:30 | Night audit | Run (or show last run) as a business-date job. | `/night-audit` | Sidebar **Night Audit** (`night-audit-screen`). **Run night audit** or show last run / step list as business-date job chrome — not raw JSON. **Say:** "Night audit rolls the business date — operator job, not a JSON dump." |
| 7:30 | Moat (optional) | Isolation — 60 seconds, then stop. | verbal on `/board` | See **Backup beat** below. Only if time remains. |

---

## Kill list — do not click unless asked

| Surface | Route / control | Why |
|---|---|---|
| Settings charge codes | `/settings/charges` | Lab config |
| Folio Advanced | `details[data-testid="folio-advanced"]` | Operator internals |
| Exceptions | `/exceptions` | Fail-closed workbench — backup rejected |
| Staff | `/staff` | Not part of hotel day |
| Inventory / Rates / Roster | sidebar secondary | Off-script depth |
| Raw ids in spoken copy | — | Never say `rt_king`, `prop_demo`, `paymentId`, `user_owner` |
| DevTools / Network | — | DEMO-READY definition of done |
| `.env` on projector | — | P0-4 invariant |
| `/dev/ui` | if ever present in dev builds | Convergence gallery — not demo path |

---

## Backup beat — second property isolation (skippable)

**Optional. 60 seconds max. Skip if you are at or past 8 minutes.**

Stay on `/board` (or return there from `/night-audit`). Do **not** open `/exceptions`, Settings, or a second browser profile. No architecture slides.

1. Point at `data-testid="property-name"` — **The Meridian Seattle** — and sidebar context: *this* hotel only.
2. **Say (one sentence):** "Harborlight may operate many properties; each property's ledger and inventory live in their own Durable Object — data from another hotel never appears on this tape."
3. Stop at 60 seconds.

Exception-queue backup is **not** part of this script — it would require staging a failure or hoping the queue is non-empty.

---

## Honest lines

You may say these verbatim:

> Honest lines you may say: payments are tokenized / sandbox; no live hotel yet. Do not fake either.

---

## Dry run 1 — cold laptop, seeded hotel, timed

**Optional for merge.** Not a merge gate. Human clock + full cold boot.

Date: 2026-08-14  
Operator: Abdus (Cursor-assisted, password-gate fallback)

- [x] Cold boot §6 completed without ad-hoc curls in the room
- [x] Sign-in → `/board` ≤ 45s into run
- [x] Room Plan shows named occupancy (8+ stays visible on tape); property **The Meridian Seattle**
- [x] Walk-in book completes with dollar quote
- [x] Check-in assigns by room code
- [x] Folio post + payment; balance changes; Advanced stayed collapsed
- [x] Housekeeping dirty → clean for demo room
- [x] Night audit screen shows job chrome; run or last-run visible
- [x] Total time ≤ 8 minutes
- [x] Kill-list surfaces not opened
- [x] No DevTools; no `X-Dev-Actor` visible in UI copy

Pass: [x] PASS  [ ] FAIL

**Notes (do not apologize for these in the room — fix the script or file a slice):**

- Auth was password-gate (`VITE_DEMO_PASSWORD`), not Clerk — keys were not in local env.
- Confirm booking lands on `/arrivals` with a reservation-id toast. Use the first **Check in** row; do not read the UUID aloud.
- Check-in stays on `/check-in/:id` with “Checked in”; tape then shows In-house +1. Print control exists — skip the print dialog.
- Tape **Folio** link is easy to miss (stay block intercepts). Guest name opens `/guests` (`PII: Live`). Prefer the Folio link, or recover via **View folio**.
- Leave charge code **MISC**. Typing `MINIBAR` fails. Card path shows **Visa •••• 4242 · 50.00**; Advanced stayed collapsed.
- **Run night audit** is disabled while closing date is today. Show idle job chrome + step list; do not click **Open exceptions**.

---

## Dry run 2 — someone else drives

**Requires another human.** Recommended before the meeting; **not a merge gate.** An agent cannot sit a second person through rehearsal — this checklist is written for a live driver.

Date: ____  
Operator (driver): ____

- [ ] Driver had not run seed in the last 24h (or used wipe boot)
- [ ] Driver followed script clicks only — no sidebar improvisation
- [ ] Driver completed all beats without presenter rescue
- [ ] Timer recorded; note overruns by beat
- [ ] Feedback lines blank for post-run notes

Pass: [ ] PASS  [ ] FAIL

**Post-run feedback:**

---

## Dry run log

Fill rows only after an actual rehearsal. Do not pre-fill in the PR.

| Date | Operator | Duration | Notes |
|---|---|---|---|
| 2026-08-14 | Abdus (password-gate) | 4:55 | Wipe + seed The Meridian Seattle. Beats completed. Presenter traps below — not fail. |
| | | | |
| | | | |
