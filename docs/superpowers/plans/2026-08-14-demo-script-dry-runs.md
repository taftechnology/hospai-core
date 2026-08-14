# Script + two dry runs (P0-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Produce one copy-ready presenter artifact — `docs/demo/8-minute-script.md` — that folds the 8-minute hotel-day beats, Clerk/password-gate runbooks, cold-laptop boot, kill list, verbal second-property moat backup, and human dry-run checklists into speaker notes. Tick DEMO-READY P0-5 and fix stale P0-4 prose. **No product code.**

**Architecture:** Documentation-only slice. The script file is the single source of truth for the meeting path (runbooks + timed beats + rehearsal log at the bottom). DEMO-READY remains the checklist hub; README boot steps are **copied**, not reinvented. P0-4 auth behaviour is already shipped — this chunk **documents** dashboard setup, mapping curl order, and password-gate fallback for the room.

**Tech Stack:** Markdown only. References existing routes/testids in `apps/web-pms` and boot commands in `README.md` / `package.json` `"demo:seed"`. No new deps, scripts, or Worker/SPA edits.

**Spec:** `docs/superpowers/specs/2026-08-14-demo-script-dry-runs-design.md` (Approved). Spec commit: `1cde085`.

---

## Sequencing gate (read before starting)

This is **P0-5**. DEMO-READY: work P0 in order — P0-1 through P0-4 must already be ticked.

| After this plan | Do not start |
|---|---|
| Tick DEMO-READY P0-5 in Task 2 | **UI convergence batches 1–7** (they wait for P0-4 **and** P0-5) |
| — | Product fixes discovered during dry run (file a new slice) |
| — | Automated CI rehearsal or merge gates on dry runs |

Dry run 1 is **optional** for the implementer and **not** a merge gate. Dry run 2 requires another human — write the checklist only; do not block the PR on completion or pre-filled PASS boxes.

---

## Open decisions (locked here; spec §12 left some to the implementer)

### D1 — Check-in beat: walk-in primary, Amira fallback

**Locked for this plan:** Primary path = **walk-in reservation from the Book beat** (narrative continuity). Navigate to `/check-in/:id` for that new reservation; assign room **by code** from seeded free inventory (e.g. `108`–`110`, `205`–`206`, `303`–`304`).

**Fallback (if Book beat is shortened):** Seeded unassigned arrival **Amira Hassan** — reservation `res_demo_arr_04`; same room-by-code assign flow.

The implementer writes both paths in Task 1 prose but **labels walk-in as primary** so the decision is not re-litigated during implementation.

### D2 — Tape click at 0:45

**Locked:** Click **James Whitaker**, room **`101`** — named in-house block on the tape for repeatability. Optional folio peek or defer to 4:30.

### D3 — Backup beat (7:30 moat)

**Locked:** **Verbal second-property isolation only** — stay on `/board` (or return from `/night-audit`); point at `data-testid="property-name"` (**The Meridian Seattle**); one sentence on Durable Object per property / no cross-hotel leakage. **Do not** open `/exceptions`, Settings, or a second browser profile. **60 seconds max.** No architecture slides.

Exception-queue backup is **rejected** (spec §4.3).

### D4 — Meeting auth default

**Locked:** Clerk happy path (P0-4 §3.1 + README:75–88). Password-gate = presentation fallback when Clerk keys cannot land. Engineer `VITE_USE_DEV_ACTOR=1` without password = **local engineering only — not the meeting path.**

### D5 — README pointer

**Locked:** Optional one-line pointer to `docs/demo/8-minute-script.md` in README Run locally — implementer discretion in Task 2.

---

## Global Constraints

- **No Worker or SPA behaviour change.** `git diff` must show **no** edits under `apps/`, `packages/`, `scripts/demo-seed.mjs`, or root `package.json` dependency/script blocks.
- **Heads frozen.** `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. `PROPERTY_SCHEMA_HEAD` **25**. `ORG_SCHEMA_HEAD` **7**. `pnpm generate:ddl` is a no-op diff.
- **Do not invent `--wipe` or new seed commands.** Recovery = README wipe only: stop Worker → delete `apps/pms-core/.wrangler/state` → restart → `pnpm demo:seed` → re-map Clerk user if needed.
- **Happy-path route discipline.** Timed beats use only: `/sign-in` → `/board` → `/book` → `/check-in/:id` → `/folio/:id` → `/housekeeping` → `/night-audit`. Sidebar navigation is fine; do not require `/arrivals`, `/reservations`, `/guests`, etc. on the timed path.
- **Kill list is normative.** Settings charge codes, Folio Advanced, Exceptions, Staff, Inventory/Rates/Roster sidebar depth, raw ids in spoken copy, DevTools, `.env` on projector — unless an investor asks.
- **Honest lines required** (DEMO-READY:224–225): payments tokenized/sandbox; no live hotel yet — verbatim in script.
- **No secrets in repo.** Clerk email/password and demo passwords = placeholders in committed markdown; real values in operator notes / gitignored `.env`.
- **Single artifact.** No `docs/demo/dry-runs.md` — dry-run sections live at the bottom of `8-minute-script.md`.
- **Dry run checklists:** Write empty `- [ ]` boxes and blank `Date: ____` / `Operator: ____` lines. Do **not** pre-check PASS/FAIL unless the implementer actually ran a rehearsal in that PR.
- Living plan checkboxes: tick `- [x]` on merge only (Task 4). Do not backfill historical plans.

---

## File map

| File | Role | Task |
|---|---|---|
| `docs/demo/8-minute-script.md` | **New.** Full speaker notes per spec §4.2 | 1 |
| `DEMO-READY.md` | Tick P0-5 (196–205); fix stale P0-4 prose (183–185); align moat row (222) + backup checkbox (201–202) to verbal isolation lock | 2 |
| `README.md` | Optional one-line pointer to script path | 2 |
| this plan file | Tick checkboxes | 4 |

**Not touched:** `apps/pms-core/**`, `apps/web-pms/**`, `packages/**`, `package.json`, `scripts/demo-seed.mjs`, `.env.example`, contracts, seed fixture.

---

## Spec §4.2 → script section map (Task 1 must write all — not stubs)

Use this as the implementer's outline. Every section is **full copy-ready prose** with clicks, testids/labels, and spoken one-liners.

| # | Section | Source / content |
|---|---|---|
| 1 | Title + meeting metadata | 8-minute ceiling; **The Meridian Seattle**; org **Harborlight Hospitality**; URL `http://127.0.0.1:5173/` (or Assets `:8787` if built) |
| 2 | Cold-laptop boot | Spec §6 — copy README §1 env copy, §2 servers, §3 `pnpm demo:seed`, wipe recovery (README:112–118); timezone note (wipe + re-seed if dates wrong) |
| 3 | Clerk happy-path runbook | Spec §5.1 — dashboard checklist, SPA/Worker env, keep unsafe-local flags, seed, mapping curl (placeholder email), order seed → map → sign-in, `me-no-access` failure mode |
| 4 | Password-gate fallback runbook | Spec §5.2 — trigger, env switch, no mapping curl, honest DevTools caveat, never project `.env` |
| 5 | Engineer path (not meeting) | Spec §5.3 — one paragraph: local only |
| 6 | Timed beats table | DEMO-READY:213–222 row-for-row **plus** per-beat click/copy column (see [Beat detail](#beat-detail-task-1) below) |
| 7 | Kill list | Spec §7.2 baseline verbatim + extensions |
| 8 | Backup beat (skippable) | Spec §4.3 / D3 — verbal isolation on `/board`, 60s cap |
| 9 | Honest lines | DEMO-READY:224–225 verbatim |
| 10 | Dry run 1 checklist | Spec §8.2 — empty checkboxes; note optional / not merge gate |
| 11 | Dry run 2 checklist | Spec §8.3 — empty checkboxes; note human required / not merge gate |
| 12 | Dry run log | Empty dated rows (`Date`, `Operator`, `Duration`, `Notes`) |

### Beat detail (Task 1)

Copy DEMO-READY times as a **ceiling**. Each row adds exact UI steps:

| Time | Beat | Script must specify |
|---|---|---|
| 0:00 | Sign-in | `/sign-in`; Clerk email/password (`sign-in-email`, `sign-in-password`, `sign-in-submit`) or password-gate; success → Room Plan populated; `property-name` **The Meridian Seattle**; footer `shell-role` **Owner** |
| 0:45 | Tape chart | Sidebar **Room Plan** or already on `/board`; today + 6 nights; click **James Whitaker** / room **`101`** → folio link (optional peek or defer) |
| 2:00 | Walk-in book | Sidebar **New Booking** → `/book`; `data-testid="booking-screen"`; room type **names** (King Deluxe / Twin); `stay-quote` dollar amount (e.g. `$289.00`); guest name; **Confirm booking** (`confirm-book`); seeded free inventory |
| 3:30 | Check-in | **Primary:** `/check-in/:id` for walk-in just booked. **Fallback:** Amira Hassan `res_demo_arr_04`. Room picker `check-in-room` by **code** (e.g. `108`); registration card print = one click; complete → in-house |
| 4:30 | Folio | `/folio/:id` for checked-in guest; **Post charge** (minibar); **Take payment** card path; `folio-balance` updates; **do not expand** `folio-advanced` |
| 5:30 | Housekeeping | Sidebar **Housekeeping**; mark demo room **dirty** → **clean**; optional glance at Room Plan |
| 6:30 | Night audit | Sidebar **Night Audit**; `night-audit-screen`; **Run night audit** or last-run / step list — not raw JSON |
| 7:30 | Moat (optional) | D3 backup only if time remains — verbal isolation, no `/exceptions` |

---

### Task 1: Write `docs/demo/8-minute-script.md` (full prose)

**Spec:** §4.2, §5, §6, §7, §8.

**Files:**
- Create: `docs/demo/8-minute-script.md`

**Forbidden this commit:** any file outside `docs/demo/`; stub sections; real Clerk passwords or `sk_`/`pk_` values; exception-queue backup instructions; invented CLI flags.

**Produces:** Single presenter artifact with all 12 sections above — copy-ready, not bullet stubs.

- [ ] **Step 1: Create `docs/demo/` and write sections 1–5 (metadata + boot + runbooks)**

Title block + cold-laptop boot table copied from README (§1 env templates, §2 dual terminals, §3 `pnpm demo:seed`, wipe steps README:114–118). Clerk runbook in spec §5.1 order including mapping curl:

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/members \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"email":"<Clerk user email>","role":"owner"}'
```

Password-gate and engineer-not-meeting paragraphs per spec §5.2–5.3.

- [ ] **Step 2: Write timed beats (section 6) from DEMO-READY table + beat detail**

Include a markdown table mirroring DEMO-READY:213–222 with an added **Clicks & spoken line** column. Lock D1 (walk-in primary / Amira fallback) and D2 (James Whitaker `101`) in prose. Route discipline: no DevTools or in-room curl.

- [ ] **Step 3: Write kill list, backup beat, honest lines (sections 7–9)**

Kill list = spec §7.2 table (Settings `/settings/charges`, Folio Advanced `folio-advanced`, Exceptions `/exceptions`, Staff `/staff`, sidebar secondary, raw ids, DevTools, `.env`, `/dev/ui` conditional).

Backup = D3 verbal moat on `/board` only — **skippable**, clearly marked.

Honest lines = DEMO-READY:224–225 quoted verbatim.

- [ ] **Step 4: Write dry-run sections (10–12) with empty checkboxes**

Dry run 1 items per spec §8.2 (cold boot, ≤45s sign-in, 8+ stays, walk-in book, check-in by code, folio post+payment, HK dirty→clean, night audit chrome, ≤8 min, kill list respected, no DevTools).

Dry run 2 items per spec §8.3 (fresh driver, script-only clicks, no rescue, timer + overrun notes, feedback blanks).

Add explicit note: **Dry run 1 optional for merge; Dry run 2 requires another human and is not a merge gate.**

Dry run log: 3+ empty row templates — do not fill unless rehearsal was actually run.

- [ ] **Step 5: Self-review against spec §11 deliverable checks 1–10**

Confirm no stub headings, every beat has clicks/copy, no `/exceptions` in backup, placeholders only for secrets.

- [ ] **Step 6: Commit**

```bash
git add docs/demo/8-minute-script.md
git commit -m "$(cat <<'EOF'
docs: 8-minute demo script with runbooks and dry-run checklists

Single presenter artifact for P0-5: cold boot, Clerk and password-gate
runbooks, timed beats with click discipline, kill list, verbal second-
property moat backup, and empty dry-run sections. Docs only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: DEMO-READY tick, P0-4 prose fix, optional README pointer

**Spec:** §3, §9, §10.1 #6–8.

**Files:**
- Modify: `DEMO-READY.md`
- Modify (optional): `README.md`

**Forbidden this commit:** `docs/demo/8-minute-script.md` edits (Task 1 owns it); any product path; ticking this plan file (Task 4).

- [ ] **Step 1: Replace stale P0-4 paragraph (lines 183–185)**

Remove claim that `/sign-in` is literal "Sign in required" and that SPA defaults to dev actor for the **demo** path. Replace with accurate post-P0-4 summary, e.g.:

- Meeting default: Clerk custom sign-in (`SignInScreen`); unset `VITE_USE_DEV_ACTOR`, set `VITE_CLERK_PUBLISHABLE_KEY`, Worker `CLERK_*`, members mapping curl after seed.
- Password-gate fallback when Clerk keys cannot land (`VITE_USE_DEV_ACTOR=1` + `VITE_DEMO_PASSWORD`).
- Engineer path (`VITE_USE_DEV_ACTOR=1` without password) auto-redirects `/sign-in` → `/board` — local only.
- Pointer: runbook detail in `docs/demo/8-minute-script.md`.

Keep P0-4 checkboxes ticked (`- [x]`).

- [ ] **Step 2: Tick P0-5 checkboxes (lines 196–205)**

Change all five `- [ ]` to `- [x]`. Update backup-beat line (201–202) to match spec lock: **second property verbal isolation only** (remove "or exception queue"). Update 8-minute table moat row (222): primary surface = verbal isolation on `/board`; remove `/exceptions` as an option.

- [ ] **Step 3 (optional): README one-liner**

After README §3 seed paragraph (~line 110), add:

> Meeting script: [`docs/demo/8-minute-script.md`](docs/demo/8-minute-script.md)

Skip if redundant with existing P0-5 mapping curl pointer.

- [ ] **Step 4: Commit**

```bash
git add DEMO-READY.md README.md
git commit -m "$(cat <<'EOF'
docs: tick P0-5 and fix stale P0-4 prose in DEMO-READY

P0-4 summary reflects Clerk sign-in and password-gate fallback.
P0-5 checkboxes ticked; moat beat locked to verbal second-property
isolation. Optional README pointer to the demo script.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

(Omit `README.md` from `git add` if Step 3 skipped.)

---

### Task 3: Repo hygiene — zero product diff, heads pinned

**Spec:** §11.11–12, invariant §2.

**Files:** none (verification only).

**Forbidden this commit:** any source edit; filling dry-run PASS boxes unless Task 1 rehearsal actually happened.

- [ ] **Step 1: Confirm docs-only diff**

```bash
git diff --name-only origin/main...HEAD
git diff --name-only
```

Expected touches: `docs/demo/8-minute-script.md`, `DEMO-READY.md`, optionally `README.md`, and (after Task 4) this plan file. **No** paths under `apps/`, `packages/`, `scripts/demo-seed.mjs`, or `package.json` deps/scripts.

```bash
git diff --name-only | grep -E '^(apps/|packages/|package\.json|scripts/demo-seed)' && echo FAIL || echo ok
```

- [ ] **Step 2: Pin frozen heads (no codegen drift)**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG|post_demo_seed"
```

Expect: `COMMAND_CATALOG` length **77**; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`.

- [ ] **Step 3: Optional Dry run 1 (human, not merge gate)**

If implementer runs a timed rehearsal: fill **Dry run log** rows in `docs/demo/8-minute-script.md` only — do not check PASS boxes in the PR unless the run actually happened. If not run, leave checklists empty and proceed.

- [ ] **Step 4: Commit (only if Step 3 filled log)**

If dry-run log was updated:

```bash
git add docs/demo/8-minute-script.md
git commit -m "$(cat <<'EOF'
docs: dry run 1 log entry (optional rehearsal)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

If no rehearsal: **skip commit** — Task 3 is verify-only.

---

### Task 4: Tick this plan

**Spec:** §13 stop line; plan housekeeping.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-demo-script-dry-runs.md` (checkboxes only)

**Forbidden this commit:** product code; starting UI convergence batches 1–7.

- [ ] **Step 1: Re-run Task 3 grep if Tasks 1–2 landed in separate commits**

Confirm still docs-only.

- [ ] **Step 2: Tick every `- [ ]` on Tasks 1–4 in this file**

Do not backfill other plans.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-14-demo-script-dry-runs.md
git commit -m "$(cat <<'EOF'
docs: tick P0-5 demo script plan checkboxes after merge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Do not start UI convergence batches 1–7. Do not open product fixes for dry-run discoveries without a new slice.

---

## Spec §14 reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state §1.1 matches tree: routes in `App.tsx`, `SignInScreen` real, seed command, catalog **77**, route **127**, no `docs/demo/` yet, stale DEMO-READY P0-4 prose noted.
- [ ] Invariants include no Worker/SPA change, heads frozen, P0-4 auth stands, one backup beat, human dry runs.
- [ ] Deliverable path **`docs/demo/8-minute-script.md`** locked; dry-run checkboxes at bottom of same file.
- [ ] Backup beat **second property isolation** — exception queue explicitly rejected with reason.
- [ ] Clerk runbook + mapping curl + order + password-gate + engineer-not-meeting path all specified.
- [ ] Kill list matches DEMO-READY plus lab surfaces; `/dev/ui` mentioned as conditional.
- [ ] Scope-out names product code, CI rehearsal, second property seed, exception staging.
- [ ] Acceptance tests §11 and plan tasks present.
- [ ] Folded vs deferred leftovers §10 present in spec.
- [ ] Walk-in primary / Amira fallback and James Whitaker `101` tape click locked in plan Task 1.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §4.1 single artifact `docs/demo/8-minute-script.md` | 1 |
| §4.2 all 11 section types (full prose) | 1 |
| §4.3 backup = verbal second-property isolation; no `/exceptions` | 1 (D3) |
| §5.1 Clerk runbook + mapping curl order | 1 |
| §5.2 password-gate fallback + honest caveat | 1 |
| §5.3 engineer path not meeting | 1 |
| §6 cold boot from README; wipe recovery; no invented flags | 1 |
| §7.1 timed beats from DEMO-READY + clicks/copy | 1 |
| §7.2 kill list baseline | 1 |
| §8.1–8.3 dry-run checklists + log at file bottom | 1 |
| §8.1 dry run 1 optional / not merge gate | 1, 3 |
| §8.3 dry run 2 human / not merge gate | 1 |
| §9 file map | 1–4 |
| §10.1 tick P0-5; fix P0-4 prose | 2 |
| §10.2 scope-out (no product, CI, exception staging) | all (forbidden) |
| §11 acceptance deliverable checks 1–10 | 1 |
| §11.11–12 zero product diff; heads 77 / [127] | 3 |
| §12.10 walk-in primary, Amira fallback | 1 (D1) |
| §12.11 James Whitaker room `101` | 1 (D2) |
| §12 optional README pointer | 2 (D5) |
| Invariant 1 no Worker/SPA change | all |
| Invariant 2 heads frozen | 3 |
| Invariant 9 cold boot documented seed only | 1 |
| Leftover deferred §10.2 (sign-out, second property seed, CI timer, product fixes) | all (forbidden) |
