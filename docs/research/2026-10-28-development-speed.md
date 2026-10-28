# Development speed — where the time goes and how to get it back

**Researched:** 2026-10-28 · **Purpose:** the India pilot needs about 45 more roadmap slices plus go-live work ([`docs/roadmap.md`](../roadmap.md) Track P). This note measures how development has actually gone in this repo and ranks the changes that would shorten the path to the pilot.

## Read this first

- The measurements come from this repo's git history and a timed run of the local verify loop on 2026-10-28. The practices come from public sources and are cited at the end.
- Measured from git: **how fast the work goes is not the problem; how often it happens is.**
- Nothing here relaxes a `check:*` gate, a test or an AGENTS.md rule. Those are what stopped the 2026-09 audit defects from coming back.

## What the history shows

| Measure | Value |
|---|---|
| Repo started | 2026-07-26 |
| Days with any commit | **22 of 94** calendar days |
| Last code commit | **2026-09-05** (doc-only commits on 2026-09-12 and 2026-10-28) |
| Commits | about 816: 281 `feat`, 258 `docs`, 113 `fix`, 67 `test`, 40 `chore`, 34 `refactor` |
| Specs / plans written | 111 specs, 90 plans |
| Busiest stretch | 2026-08-12 → 08-15: 110, 122, 89 and 138 commits a day |
| Track 0 (14 audit slices) | all 14 between 23:12 on 2026-09-04 and 03:45 on 2026-09-05 — **about 10–25 minutes per slice**, failing test first each time |

What that means:

1. **On a working day, a slice is fast.** Track 0's slices each went from a red characterization test to a ticked box in well under half an hour. Even allowing for heavier Track P slices, the agent workflow is not what limits the schedule.
2. **Most calendar days have no work.** 72 of 94 days have no commit, and the last seven weeks have none. At the August pace, that gap alone is roughly the size of Track 1.
3. **About a third of commits are documents.** 258 of about 816 commits are `docs`: specs, plans and roadmap edits. Much of that was necessary — the architecture locks are why Track 0 was fixable in a night — but every slice paying for both a spec and a plan is a fixed cost.
4. **The queue is strictly serial.** The roadmap says take one open slice, finish it, then take the next, and Track P waits for every Phase-1 box in Tracks 0–2. Slices that do not depend on each other still wait in line.

## The verify loop

Timed on 2026-10-28 on the development Mac, steps run one after another as AGENTS.md prescribes (`pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`). All steps passed.

| Step | Time |
|---|---|
| `pnpm build` | 2 s (turbo cache hit; a cold build is longer) |
| `pnpm typecheck` | 5 s |
| `pnpm lint` | 13 s |
| package tests (all but pms-core) | under 1 s (turbo cache hit) |
| pms-core shards 1–8 | 65, 21, 19, 42, 15, 12, 17, 11 s — **202 s** |
| **Total** | **about 4 minutes** |

- **The loop is not the bottleneck.** Four minutes against a 10–25 minute slice is acceptable, and it is the safety net that made Track 0 fast. Leave it whole before every commit.
- **While iterating, run only the spec files you are changing** (`pnpm --filter @hospai/pms-core exec vitest run test/<file>.spec.ts`) and keep the full loop for the commit.
- **Shards are uneven** — shards 1 and 4 take 65 s and 42 s, the rest 11–21 s — because vitest splits by file, not by duration. Rebalancing would shave CI wall-clock a little; it is not worth doing for local speed.
- **Two pms-core runs at once on one machine are unsafe.** The suite runs with `singleWorker` and shared storage, unsharded runs already crash `workerd`, and CI needed eight shards to stay stable. Parallel agents must take turns on the full loop.

## Practices from outside

- **Parallel agents need isolation.** The common 2026 pattern for several agents on one repo is one git worktree and one branch per task, so agents cannot overwrite each other's files and conflicts surface at merge time instead. It suits independent, long-running tasks. Claude Code has worktree support built in; plain `git worktree add` works with any agent.
- **Unattended runs need bounded tasks.** Agents finish reliably on tasks with clear inputs, defined outputs and a bounded scope, and stall or over-correct on vague ones. Unattended runs belong in an isolated workspace with a restricted tool list, and the result still needs checking.
- **Measure, do not assume.** METR's 2025 randomised trial found experienced developers on their own large repos took **19% longer** with AI tools, while believing they had been about 20% faster. Time went to prompting, waiting and cleaning up output. The tools have improved since, and this repo's Track 0 night is evidence the other way — but the lesson stands: judge changes by the dates slices land, not by how the session felt.

## Recommendations, ranked by days saved

### 1. Protect a fixed number of coding days a week

The largest lever by far. Decide how many days a week go to slices, keep them, and put the pilot date on that cadence. Everything below is worth days; this is worth months.

### 2. Start client and vendor dependencies now

The go-live checklist's first steps — client answers, the Indian tax advisor, the BluePMS export, the POS vendor and the channel manager — have lead times outside our control. Starting them in Track P would put weeks of waiting on the critical path. They need no code.

> **Decided 2026-10-28: the queue stays serial.** Recommendations 3 and 4 were considered and not adopted — the roadmap's one-slice-at-a-time rule and the Track P gate stand. They are kept below as the record of what was weighed.

### 3. Let independent Track P slices start before Tracks 1–2 finish

Track P is gated on every Phase-1 box in Tracks 0–2. Several Track P slices depend on none of the Track 1–2 screens:

- **R3.6** India tax model (already a Track P prerequisite — start it first, with the advisor)
- **R3.10** entitlement catalog
- **R4.5** outbox consumers and Queue workers
- **R4.9** interface framework, then the **R4.21** POS and **R4.3** channel manager connectors, once the vendors are known

The rule would become: a Track P slice may start once **its own *Depends* list** is `[x]`, instead of once all of Tracks 1–2 are. This is a roadmap gating change, and it needs the human's call.

### 4. Run backend and UI slices in parallel, in separate worktrees

Once item 3 allows it, two agents can work at once: one on a Track 1–2 screen in `apps/web-pms`, one on a Track P backend slice in `apps/pms-core` / `packages`. Each gets its own worktree and branch; merges stay one at a time onto `main`.

- **The catalog and schema pins are the conflict point.** `COMMAND_CATALOG` length, the last `V1_HTTP_ROUTE_AUDIT` id and `PROPERTY_SCHEMA_HEAD` change with almost every backend slice. Two backend slices in parallel will collide on them; one backend and one UI slice usually will not. Merge the backend slice first, then rebase the other and re-run verify.
- **Do not run two pms-core suites at once on one machine** — see the verify loop above.

### 5. Match the paperwork to the slice

Keep the full spec → plan → implement → review loop for slices that touch tenancy, money, inventory, authorization or a new subsystem — most of Track P. For a slice that only builds a screen over routes that already exist, and whose roadmap entry already names an accepted spec (12 Track 1 slices do), go straight to a plan. The tests and `check:*` gates stay the same either way.

### 6. Batch decisions

Every fork that waits on the human stalls a slice. Collect the forks a slice will hit before it starts — from the roadmap's *Fork* lines and the client questions — and decide them together, so a session runs to done without stopping.

### 7. Use idle days for bounded, unattended work — carefully

A scheduled agent could work one slice in its own worktree overnight and leave a branch for review in the morning. It fits small, well-specified slices — a screen over existing routes with an accepted spec. It does **not** fit money, inventory or tenancy work, where a confident wrong answer is expensive and review costs as much as writing. Nothing merges or pushes without the human.

## What not to do

- Do not drop the failing-test-first rule, skip `check:*` gates, add `it.skip` or relax a lock to go faster. Those are what make a 15-minute slice safe.
- Do not cut a ticked pilot item; the client confirmed all of them are must-haves.
- Do not add Playwright or another test layer for speed; AGENTS.md rules it out and it would slow the loop.

## Sources

- [METR study coverage — The Register](https://www.theregister.com/2025/07/11/ai_code_tools_slow_down/)
- [METR study coverage — Business Insider](https://www.businessinsider.nl/ai-coding-tools-could-make-experienced-software-engineers-less-productive-a-new-study-suggests/)
- [Git worktrees for parallel AI agents — Augment Code](https://augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)
- [Git worktrees for parallel AI agents — MindStudio](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)
- [Git worktrees for AI development — KDnuggets](https://www.kdnuggets.com/git-worktrees-for-ai-development)
- [Claude Code headless mode — MindStudio](https://mindstudio.ai/blog/claude-code-headless-mode-autonomous-agents-2)
- [Claude Code sandbox practices for headless runs — Novita](https://blogs.novita.ai/claude-code-sandbox-best-practices/)
- [Cloudflare Vitest integration — isolation and concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/)
