# Gate Trust — Module Ownership Boundary + Check Self-Tests

**Date:** 2026-08-12  
**Status:** Accepted — implementation-ready  
**Sources:** ARCHITECTURE.md §15 (boundary rules), §16.2 (size as symptom, structural cure), §16.4 (visual identity / colour gate precedence); [housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md) (`schema.tables` vs `writes`, net line-delta acceptance already satisfied); `scripts/module-manifests-check.mjs`; `scripts/web-pms-colors-check.mjs`; `scripts/property-ddl.mjs`; `scripts/forbidden-body-check.mjs` (`--self-test` idiom); `.github/workflows/ci.yml`

**Implementation order:** (1) harden `tablesWrittenIn` + confirm module check green → (2) ownership assertion + parse/`writes ⊇ schema.tables` fixes + load-bearing fixtures → (3) colors `checkColors({ cssByFile })` + `--self-test` + CI → (4) DDL `compareDdl` + `--self-test` + CI.

---

## 1. Context & Motivation

§15's rules govern **boundaries** — what imports what, where logic lives, what may cross an interface. None mention volume, file size, or line counts. §16.2 diagnoses monolith size as a *symptom* and prescribes a structural cure ("Modules contribute UI through the manifest"), never a cap.

A line ratchet on `property-do.ts` would contradict no rule, but it sits outside the document's grammar: it can be satisfied by moving code to a sibling under `apps/pms-core/` while leaving the boundary unchanged. That is a gate you can pass while doing the wrong thing — the failure mode this repo has been careful to avoid.

Housekeeping extraction already proved the mechanism and left `schema.tables: ['housekeeping_assignment']` vs `writes: ['room', 'housekeeping_assignment']` as a locked distinction. The payoff is an **architecture-native auto-ratchet**:

> No TypeScript under `apps/pms-core/src/**` may SQL-write a table declared in any on-disk module's `schema.tables`.

Each extraction that claims tables tightens the gate automatically — no number, no `{limit, reason}` file, no bump theatre. Relocating writes within `apps/pms-core/src/**` cannot dodge it.

Separately, CI already runs three `--self-test` scripts ([ci.yml:31-33](../../../.github/workflows/ci.yml)), but `web-pms-colors-check.mjs` and `property-ddl.mjs` — the same text-analysis / drift class — have none. Hardening one fragile gate while leaving its siblings unproven would split one risk class across two specs. This chunk hardens the ownership scanner **and** proves the two sibling checkers.

### 1.1 Scope in

1. **Harden `tablesWrittenIn`** in `scripts/module-manifests-check.mjs` (evidence-ordered variants below), confirm `check:module-manifests` green, **then** add the ownership assertion over `apps/pms-core/src/**`.
2. **Parse safety** — `extractWrites` and new `extractSchemaTables` must error explicitly on no-match (no `null` silent pass); assert per module that `writes ⊇ schema.tables`.
3. **`--self-test` for colors** — injectable `checkColors({ cssByFile })` + exclusive argv dispatch + CI.
4. **`--self-test` for DDL** — pure `compareDdl(generated, committed)` used by `--check`; synthetic match/drift/missing; CI. `check:ddl` stays green across the refactor.

### 1.2 Scope out

- Any vertical extraction from `property-do.ts` (amortize against feature work; this gate makes that path safe).
- Line/method ratchets on `property-do.ts`, `v1-dispatch.ts`, or `org-do.ts`.
- Self-tests for the other parsed-data checks (`entitlements`, `permissions`, `degraded`, `class-denylist`, `web-pms-me-gating`, `pms-core-test-dates`).
- Schema-qualified SQL names (`main.room`) — DO SQLite has one schema; no uses; complicates capture for nothing.
- Scanning `packages/**` or migration SQL — migrations are **schema evolution**, not domain writes (see e.g. rebuild DML in `packages/do-runtime/src/property-migrations.ts`). Deliberately out of scope; widening would flag evolution as a boundary violation.
- Scanning `apps/pms-core/test/**` — fixtures legitimately do raw setup; excluded by `src/**`.

### 1.3 Why `apps/pms-core/src/**`, not only `property-do.ts`

Most discussion said "PropertyDO may not write…", but OrgDO already writes `guest`, `data_key`, `member`, `property_member`, `property_ref`. A future guests module owns `guest` (§4.8 Guest PII class); the gate must bite `org-do.ts` then. Scoping the whole DO/worker plane under `apps/pms-core/src/**` closes the "move the write to a sibling file" dodge and covers OrgDO without a second rule later.

### 1.4 Vacuous on day one (by design)

`property-do.ts` currently writes these **18 tables**:

`audit_log`, `availability_day`, `charge_code`, `folio_line`, `folio_window`, `night_audit_run`, `payment`, `property_config`, `property_config_audit`, `provisional_exception`, `rate_day`, `rate_plan`, `reservation`, `restriction_day`, `room`, `room_type`, `shift`, `tax_rule`.

**None are module-owned.** Housekeeping owns only `housekeeping_assignment`, and the DO plane writes zero of it. On adoption the assertion protects one table and catches nothing on the real tree. That is correct — value compounds with each extraction — but it means **the gate cannot be validated against production code**. The synthetic failing fixture (O1) is the only evidence it works and is **load-bearing acceptance**, not optional polish.

This 18-table list is also the remaining extraction surface inventory for later chunks.

### 1.5 Scanner variants (harden, ordered by evidence)

| Priority | Form | Evidence |
|---|---|---|
| 1 | `INSERT OR (IGNORE\|REPLACE\|ABORT\|FAIL\|ROLLBACK) INTO` | **Six live sites** invisible to today's `/\bINSERT\s+INTO\s+/` (`property-do.ts`: `provisional_exception`, `rate_plan`, `charge_code`, `folio_window`; `registry.ts`: `org`, `subscription`). Three of those tables (`rate_plan`, `charge_code`, `folio_window`) are future module-owned — without this, ownership would go green while violated. |
| 2 | `REPLACE INTO` | SQLite shorthand for `INSERT OR REPLACE`; zero uses; same family. |
| 3 | Optional alias after table on `UPDATE` (`UPDATE room AS r SET`, `UPDATE room r SET`) | Zero uses; cheap half of the same rewrite. |
| 4 | Quoted/bracketed identifiers (`"room"`, `[room]`) | Zero uses; light character-class support, not contortion. |

Skip schema-qualified names.

**Modules stay green through harden:** zero `INSERT OR` / `REPLACE INTO` under `modules/pms/*/src`. If commit 1 goes red on the module `writes` check, it is a **regex bug**, not a real finding — that clean signal is why harden and ownership are separate commits.

### 1.6 Sequencing (single answer)

1. Harden `tablesWrittenIn` + scanner self-tests; confirm `check:module-manifests` green.
2. Ownership assertion + ownership/parse self-tests + `writes ⊇ schema.tables`.
3. Colors injectable entry + `--self-test` + CI.
4. DDL `compareDdl` + `--self-test` + CI; `check:ddl` green.

Colors-before-DDL only (easier new harness before the riskier script). Do **not** put colors before the scanner — `module-manifests-check.mjs` already has the injectable fixture harness.

---

## 2. Ownership boundary

### 2.1 Rule

No TypeScript under `apps/pms-core/src/**` may contain a SQL write whose target table appears in any **on-disk** module's `schema.tables` (the set `listModuleDirs()` already walks — every such module is also asserted registered in `registry.ts`, so "registered" and "on-disk with a manifest" coincide; iterate the on-disk set, do not add a second registry filter).

Keys on **`schema.tables` only**, not `writes`. The housekeeping `writes` overlap design (`declared ⊇ actual`, overlap allowed) is untouched: `room` stays in housekeeping `writes` without being owned, so DO `rooms.create` / `rooms.update` remain legal until inventory claims `room` in `schema.tables`.

### 2.2 Data source — source parse only

`check:module-manifests` is pure source analysis (`readText` + regex extractors + `registrySrc.includes`). It does **not** `import()` built package manifests or `MODULE_REGISTRY`. Ownership must stay on that mode — add `extractSchemaTables(manifestSrc)` as a sibling of `extractWrites`. Mixing dist imports into this script would create two analysis modes in one gate.

### 2.3 Parse failures must be loud

Do **not** mirror today's `extractWrites` `return null` pattern. That pattern is latently unsafe:

- `null` + detected writes → `TypeError` on `.includes` (ugly).
- `null` + no detected writes → **silent pass**.

For `schema.tables`, silent pass means a reformatted manifest or `tables: HK_TABLES` quietly stops protecting that module's tables — the same failure class as the `INSERT OR IGNORE` hole. Both extractors push an explicit error, e.g. `{id}: could not parse schema.tables from module.manifest.ts` / `{id}: could not parse writes from module.manifest.ts`. Fixing `extractWrites` is on-theme for this chunk.

### 2.4 `writes ⊇ schema.tables`

A module that owns a table must be permitted to write it. Housekeeping already satisfies this. Catches the realistic extraction mistake of claiming a table in `schema.tables` while forgetting `writes` — which would otherwise surface as a confusing under-declaration error pointing at the wrong field.

### 2.5 Scan

Reuse existing `walkTsFiles` on `apps/pms-core/src` (already skips `*.test.ts` / `*.d.ts` — defensive; no colocated tests under `src` today). For each file, `tablesWrittenIn(src)` ∩ owned-tables map → error. Injectable `opts.pmsCoreSrcByFile` (same family as `opts.manifestSrcByDir` / `opts.infraSrcByDir`) so self-tests never touch the real tree. O3 (duplicate owners) needs no new injection — hand two synthetic dirs via existing `opts.moduleDirs` + `opts.manifestSrcByDir`.

Build `Map<tableName, moduleId>`; duplicate owners → error.

### 2.6 Failure message

Extraction is the remedy; correcting a mistaken declaration is not a co-equal escape hatch:

```
apps/pms-core/src/property-do.ts: writes table `room` owned by `pms.inventory` —
extract this write into pms.inventory; if `room` genuinely is not owned by that
module, its schema.tables declaration is wrong and should be corrected there.
```

### 2.7 Interaction with prior specs

- Housekeeping "net line delta negative" was a one-time acceptance criterion, already satisfied — not a standing gate; no conflict.
- Purge / lifecycle reads `schema.tables` for migration ownership — same field, same meaning.

---

## 3. Self-tests

### Idiom

`--self-test` flags, not vitest. Follow `forbidden-body-check.mjs`: in-process fixtures, assert pass/fail, `process.exit(1)` on failure.

**Hard constraint:** each self-test drives the **same function** the real check calls — no parallel reimplementation.

**Exclusive argv dispatch (contract):**

```js
if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  // real check only
}
```

Never run the real tree walk when `--self-test` is set. For colors this is **load-bearing**: the real check today runs at module scope against the real CSS tree; without an if/else tail there is no `else` to move it into, and `--self-test` would execute the real walk before fixtures.

### 3.1 `module-manifests-check.mjs`

#### Scanner cases

| ID | Fixture | Expect | Why |
|---|---|---|---|
| **S1** | Bare `INSERT INTO …`, spaced `UPDATE room SET` | tables captured | **Regression guard for the alias rewrite**, not a redundant baseline. An optional alias group that greedily swallows `SET` (or uses `.+?`) silently stops matching bare `UPDATE … SET` — 7 write sites on `reservation` alone and 4 on `room`. S1 is what stops that. |
| **S1b** | `REPLACE INTO room` | `room` captured | Variant 2 |
| **S1c** | `UPDATE room AS r SET`, `UPDATE room r SET` | `room` captured | Variant 3 |
| **S1d** | `UPDATE "room" SET` (and/or `[room]`) | `room` captured | Variant 4 |
| **S2** | `SELECT … FROM room` | not a write | Negative — easy to over-match once OR-forms land |
| **S3** | `INSERT … ON CONFLICT(…) DO UPDATE SET` | no phantom table from `DO UPDATE` | Housekeeping assign uses this upsert; lock before rewriting `UPDATE … SET` |

#### Ownership / parse cases

| ID | Fixture | Expect | Why |
|---|---|---|---|
| **O1** | DO src writes `housekeeping_assignment`; manifest owns it | **fail** with framed message | **Load-bearing** — only proof the assertion works (real tree vacuous) |
| **O2** | DO src only `UPDATE room SET`; `room` in `writes` not `schema.tables` | **pass** | Proves the gate keys on **ownership**, not `writes` — the whole design. Do not drop as "redundant with under-declaration checks." |
| **O3** | Two manifests both claim `room` in `schema.tables` | **fail** | Duplicate owners |
| **O4** | Unparseable / missing `schema.tables` (and sibling for `writes`) | **fail** with could-not-parse | §2.3 |
| (existing) | `writes` under-declaration | still fails | Unchanged |

Also exercise `INSERT OR IGNORE INTO housekeeping_assignment` under O1 (or S1) so the live blind spot is in the ownership path, not only the unit capture path.

### 3.2 `web-pms-colors-check.mjs`

The seven helpers (`relativeLuminance`, `contrastRatio`, `resolveToHex`, …) are **already pure**. The gap is the **driving body** at module scope (walks real CSS, accumulates `failed`, `process.exit`).

**Restructure (exactly two moves):**

1. Wrap the body as `checkColors({ cssByFile })` (mirror `checkModuleManifests(opts)`).
2. Add the exclusive `--self-test` / else dispatch tail; the real run builds `cssByFile` from `walkCss` and calls `checkColors`.

Without (1)+(2), case C3 is unbuildable and an implementer will either drop it or write a parallel assertion — forbidden by the hard constraint.

| ID | Assertion | Notes |
|---|---|---|
| **C1** | `contrastRatio('#000000', '#ffffff') === 21` | Exactly true in JS float here — keep strict `===`; do not "fix" to `toBeCloseTo`. |
| **C2** | `#767676` on `#ffffff` → **4.5422** ≥ 4.5; `#777777` on `#ffffff` → **4.4781** < 4.5 | Boundary pair one gray step apart straddling AA |
| **C3** | Fixture CSS with failing `--status-*-fg` / surface pair → **`checkColors({ cssByFile })` returns failure** | Proves rejection path; requires injectable entry |

CI: `node scripts/web-pms-colors-check.mjs --self-test`.

### 3.3 `property-ddl.mjs`

Extract `compareDdl(generated, committed)` → `{ ok: true } | { ok: false, reason: 'missing' | 'drift' }`. `--check` builds `expected = header + sql`, reads disk, calls `compareDdl` — **one comparison path**.

| ID | Fixture | Expect |
|---|---|---|
| **D1** | matching generated/committed | ok |
| **D2** | drifted body | fail `drift` |
| **D3** | missing committed | fail `missing` |

**Dynamic import stays inside `--check`/`--write`:** [property-ddl.mjs:76](../../../scripts/property-ddl.mjs) already `await import(modPath)` inside the main flow. `--self-test` must not load `do-runtime` dist. Do **not** tidy that import to top-level — doing so would silently couple `--self-test` to `pnpm --filter @hospai/do-runtime build` and undo fixture independence.

`pnpm check:ddl` must stay green across the refactor (schema-freeze guard).

CI: `node scripts/property-ddl.mjs --self-test`.

---

## 4. Testing, risks, acceptance

### 4.1 Acceptance (falsifiable)

"CI green on the real tree" alone does **not** prove the ownership gate (vacuous on day one). All of the following must hold:

1. **Scanner** — S1 (regression guard), S1b–S1d, S2, S3 green under `--self-test`. After commit 1, `pnpm check:module-manifests` stays green (any new module-side red ⇒ regex bug).
2. **Ownership** — O1 fails with framed message (table, owning module id, extract-first remedy); **O2 passes**; O3/O4 fail as specified. Real `apps/pms-core/src/**` remains green (only `housekeeping_assignment` owned; no DO writes to it).
3. **Invariants** — every on-disk module: parseable `writes` and `schema.tables`; `writes ⊇ schema.tables`.
4. **Colors** — C1–C3 via `checkColors`; exclusive dispatch; CI wired.
5. **DDL** — D1–D3 via `compareDdl` only; no `do-runtime` import on `--self-test` path; dynamic import remains branch-local; `check:ddl` green; CI wired.
6. **Out of scope stays out** — no vertical extraction; no line ratchet; migrations / tests unscanned.

### 4.2 Risks

| Risk | Mitigation |
|---|---|
| Ownership gate "passes" while broken (vacuous on real tree) | O1 is load-bearing acceptance; acceptance leans on fixtures |
| Hardening scanner turns a previously green module `writes` check red — can't tell regex bug from real under-declaration | **Commit split:** harden + confirm green *before* ownership assertion. Modules have no OR/REPLACE forms today, so commit-1 red ⇒ regex bug. That is the documented reason for the split, not a convention. |
| Alias rewrite breaks bare `UPDATE … SET` | S1 regression guard; identifier-class optional alias, not greedy/`.*?` |
| Self-test green, real check broken | Same entry points (`checkModuleManifests` / `checkColors` / `compareDdl`); exclusive dispatch so colors self-test never hits the real tree |
| Colors C3 dropped or parallelized | Injectable `checkColors({ cssByFile })` + if/else tail required in §3.2 |
| DDL refactor changes drift detection | `check:ddl` must stay green; keep `import(modPath)` inside check/write branch |
| Future "scan packages/ too?" flags migration DML | §1.2: migrations are schema evolution, deliberately out of scope |
| Failure message invites shrug-delete from `schema.tables` | Copy frames extraction as remedy; declaration fix only if ownership claim is wrong |
| Someone "simplifies" away O2 | O2 is the proof the gate keys on `schema.tables` not `writes` — dropping it collapses the design |

### 4.3 Commit order

1. Harden `tablesWrittenIn` + S1–S1d / S2–S3; confirm module check green.
2. Ownership assertion + O1–O4 + parse/`writes ⊇ schema.tables`; `walkTsFiles` on `apps/pms-core/src`.
3. Colors: `checkColors({ cssByFile })` + exclusive dispatch + `--self-test` + CI.
4. DDL: `compareDdl` + `--self-test` + CI; `check:ddl` green.

---

## 5. Non-goals (restate)

This chunk does **not** extract the eleven remaining verticals. Bundle the ownership gate with the two sibling self-tests; amortize extraction against feature work. The gate is what makes that incremental path safe — remaining debt is bounded rather than growing.
