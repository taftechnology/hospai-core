# Gate Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI gates trustworthy — harden SQL write scanning, assert DO-plane code cannot write module-owned `schema.tables`, and add `--self-test` for colors + DDL checkers.

**Architecture:** Extend `module-manifests-check.mjs` (source-parse only) with a hardened `tablesWrittenIn` and an ownership scan over `apps/pms-core/src/**`. Refactor colors/DDL scripts to injectable entry points + exclusive `--self-test` dispatch, matching `forbidden-body-check.mjs`.

**Tech Stack:** Node ESM check scripts (`.mjs`), pnpm, GitHub Actions `ci.yml`

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-gate-trust-design.md`
- Keys on **`schema.tables`**, not `writes` (O2 proves this)
- Source parse only — no `import()` of built module manifests
- Exclusive `if (--self-test) … else …` dispatch; colors real walk must live in `else`
- `property-ddl.mjs` dynamic `import(modPath)` stays inside `--check`/`--write` only
- O1 is load-bearing (gate vacuous on real tree)
- S1 is a **regression guard** for the alias rewrite — do not drop
- Commit split: harden scanner + green modules **before** ownership assertion
- No vertical extraction; no line ratchet; do not scan migrations or `apps/pms-core/test/**`

## File map

| File | Role |
|---|---|
| `scripts/module-manifests-check.mjs` | Harden scanner; parse/`writes ⊇ tables`; ownership gate; self-tests S*/O* |
| `scripts/web-pms-colors-check.mjs` | `checkColors({ cssByFile })` + exclusive dispatch + `--self-test` |
| `scripts/property-ddl.mjs` | `compareDdl` + `--self-test`; keep dist import branch-local |
| `.github/workflows/ci.yml` | Wire colors + DDL `--self-test` steps |

---

### Task 1: Harden `tablesWrittenIn` (commit 1)

**Files:**
- Modify: `scripts/module-manifests-check.mjs`
- Test: `node scripts/module-manifests-check.mjs --self-test`
- Verify: `pnpm check:module-manifests` (must stay green — modules have no `INSERT OR` / `REPLACE INTO`)

**Interfaces:**
- Produces: exported `tablesWrittenIn(src) → Set<string>` covering variants 1–4
- Consumes: existing `selfTest` / `checkModuleManifests` infra path

- [ ] **Step 1: Add failing scanner self-tests (S1–S1d, S2, S3)**

Export `tablesWrittenIn`. At the top of `selfTest()`, before existing cases:

```js
function assertTables(label, src, expected) {
  const got = [...tablesWrittenIn(src)].sort();
  const exp = [...expected].sort();
  if (got.length !== exp.length || got.some((t, i) => t !== exp[i])) {
    console.error(`self-test ${label} FAILED: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`);
    failed = true;
  }
}

// S1 — regression guard: bare forms must survive the alias rewrite
assertTables('S1 insert', 'INSERT INTO reservation (x) VALUES (1)', ['reservation']);
assertTables('S1 update spaced', 'UPDATE  room   SET status = ?', ['room']);

// S1b
assertTables('S1b replace', 'REPLACE INTO room (room_id) VALUES (?)', ['room']);

// S1c
assertTables('S1c alias AS', 'UPDATE room AS r SET status = ?', ['room']);
assertTables('S1c alias bare', 'UPDATE room r SET status = ?', ['room']);

// S1d
assertTables('S1d quoted', 'UPDATE "room" SET status = ?', ['room']);
assertTables('S1d bracketed', 'UPDATE [room] SET status = ?', ['room']);

// OR IGNORE (live blind spot)
assertTables(
  'S1 OR IGNORE',
  'INSERT OR IGNORE INTO housekeeping_assignment (x) VALUES (1)',
  ['housekeeping_assignment'],
);
assertTables(
  'S1 OR REPLACE',
  'INSERT OR REPLACE INTO rate_plan (x) VALUES (1)',
  ['rate_plan'],
);

// S2 / S3 negatives
assertTables('S2 select', 'SELECT * FROM room WHERE id = ?', []);
assertTables(
  'S3 upsert',
  `INSERT INTO housekeeping_assignment (a) VALUES (1)
   ON CONFLICT(a) DO UPDATE SET b = excluded.b`,
  ['housekeeping_assignment'],
);
```

- [ ] **Step 2: Run self-test — expect FAIL** on OR IGNORE / REPLACE / aliases / quotes (current regex misses them)

```bash
node scripts/module-manifests-check.mjs --self-test
```

Expected: failures for S1b/S1c/S1d/OR IGNORE (S1 bare may still pass).

- [ ] **Step 3: Replace `tablesWrittenIn` (and align `hasWriteSql`)**

Share one `UPDATE_RE` between capture and the read-path gate. Do **not** use a loose `[\s\S]*?` UPDATE form — it crosses newlines and false-positives legitimate read files.

```js
function unwrapIdent(raw) {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1);
  return raw;
}

// Optional alias: (?:AS\s+)?ident — MUST be an identifier class so SET is not swallowed.
// S1 guards bare UPDATE … SET against greedy-alias regressions.
const UPDATE_RE =
  /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|\[[^\]]+\])(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?\s+SET\b/gi;
const INSERT_RE =
  /\bINSERT\s+(?:OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\s+)?INTO\s+([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|\[[^\]]+\])/gi;
const REPLACE_RE = /\bREPLACE\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|\[[^\]]+\])/gi;
const DELETE_RE = /\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+"|\[[^\]]+\])/gi;

/** Table names from INSERT / INSERT OR … / REPLACE INTO / UPDATE / DELETE FROM. */
export function tablesWrittenIn(src) {
  const tables = new Set();
  for (const re of [INSERT_RE, REPLACE_RE, UPDATE_RE, DELETE_RE]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) tables.add(unwrapIdent(m[1]));
  }
  return tables;
}

function hasWriteSql(src) {
  INSERT_RE.lastIndex = 0;
  REPLACE_RE.lastIndex = 0;
  UPDATE_RE.lastIndex = 0;
  DELETE_RE.lastIndex = 0;
  return (
    INSERT_RE.test(src) || REPLACE_RE.test(src) || UPDATE_RE.test(src) || DELETE_RE.test(src)
  );
}
```

- [ ] **Step 4: Re-run self-test — expect OK**

```bash
node scripts/module-manifests-check.mjs --self-test
```

Expected: `check:module-manifests --self-test OK`

- [ ] **Step 5: Confirm module check still green (commit-split signal)**

```bash
pnpm check:module-manifests
```

Expected: `check:module-manifests: ok`  
If this fails: **regex bug** — do not proceed to Task 2 until green. Modules have zero `INSERT OR` / `REPLACE INTO` under `modules/pms/*/src`.

- [ ] **Step 6: Commit**

```bash
git add scripts/module-manifests-check.mjs
git commit -m "$(cat <<'EOF'
fix(checks): capture INSERT OR / REPLACE / aliased UPDATE in tablesWrittenIn

Close the live INSERT OR IGNORE blind spot before the ownership gate
depends on the same scanner.
EOF
)"
```

---

### Task 2: Ownership assertion + parse invariants (commit 2)

**Files:**
- Modify: `scripts/module-manifests-check.mjs`
- Test: `node scripts/module-manifests-check.mjs --self-test`
- Verify: `pnpm check:module-manifests` (real tree still green — vacuous)

**Interfaces:**
- Consumes: `tablesWrittenIn`, `walkTsFiles`, `opts.moduleDirs` / `opts.manifestSrcByDir` / `opts.pmsCoreSrcByFile`
- Produces: ownership errors; parse errors; `writes ⊇ schema.tables`

- [ ] **Step 1: Add extractSchemaTables + loud parse for writes**

```js
function extractSchemaTables(manifestSrc) {
  const m = manifestSrc.match(/\bschema\s*:\s*\{[^}]*\btables\s*:\s*\[([^\]]*)\]/s);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}
```

In `checkModuleManifests`, replace the writes block’s null message and add schema parse + subset check inside the per-module loop (after `id` is known):

```js
const writes = extractWrites(manifestSrc);
if (!writes) {
  errors.push(`${id}: could not parse writes from module.manifest.ts`);
}

const schemaTables = extractSchemaTables(manifestSrc);
if (!schemaTables) {
  errors.push(`${id}: could not parse schema.tables from module.manifest.ts`);
}

if (writes && schemaTables) {
  for (const t of schemaTables) {
    if (!writes.includes(t)) {
      errors.push(
        `${id}: schema.tables includes ${t} but writes does not (writes must ⊇ schema.tables)`,
      );
    }
  }
}

if (writes) {
  // existing under-declaration scan unchanged…
}
```

- [ ] **Step 2: Accumulate `ownedBy` in the first loop + scan DO plane**

Before the `for (const dir of moduleDirs)` loop:

```js
  const ownedBy = new Map(); // table -> moduleId
```

Inside that loop, after `schemaTables` is parsed successfully (and after the `writes ⊇ schema.tables` check), register ownership — **one parse path**, no second pass over manifests:

```js
  if (schemaTables) {
    for (const t of schemaTables) {
      if (ownedBy.has(t) && ownedBy.get(t) !== id) {
        errors.push(
          `schema.tables conflict: table \`${t}\` claimed by both \`${ownedBy.get(t)}\` and \`${id}\``,
        );
      } else {
        ownedBy.set(t, id);
      }
    }
  }
```

After the module loop, scan the DO plane (iterate **on-disk `moduleDirs`** only — already done above; no separate registry filter):

```js
  const pmsCoreFiles = opts.pmsCoreSrcByFile
    ? Object.entries(opts.pmsCoreSrcByFile).map(([rel, src]) => ({ rel, src }))
    : walkTsFiles(join(root, 'apps/pms-core/src')).map((abs) => ({
        rel: relative(root, abs),
        src: readText(abs),
      }));

  for (const { rel, src } of pmsCoreFiles) {
    for (const t of tablesWrittenIn(src)) {
      const owner = ownedBy.get(t);
      if (!owner) continue;
      errors.push(
        `${rel}: writes table \`${t}\` owned by \`${owner}\` — ` +
          `extract this write into ${owner}; if \`${t}\` genuinely is not owned by that ` +
          `module, its schema.tables declaration is wrong and should be corrected there.`,
      );
    }
  }

  return errors;
```

- [ ] **Step 3: Add ownership self-tests O1–O4**

```js
  // O1 — load-bearing (real tree is vacuous)
  const o1 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    uiSrcByDir: { '/virtual/hk': okUi },
    pmsCoreSrcByFile: {
      'apps/pms-core/src/property-do.ts':
        'INSERT OR IGNORE INTO housekeeping_assignment (x) VALUES (1);',
    },
  });
  if (
    !o1.some(
      (e) =>
        /housekeeping_assignment/.test(e) &&
        /pms\.housekeeping/.test(e) &&
        /extract this write/.test(e),
    )
  ) {
    console.error('self-test O1 ownership violation should fail:\n' + o1.join('\n'));
    failed = true;
  }

  // O2 — proves key is schema.tables, not writes
  const o2 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    uiSrcByDir: { '/virtual/hk': okUi },
    pmsCoreSrcByFile: {
      'apps/pms-core/src/property-do.ts': 'UPDATE room SET code = ?;',
    },
  });
  if (o2.some((e) => /owned by/.test(e))) {
    console.error('self-test O2 UPDATE room must pass (in writes, not schema.tables):\n' + o2.join('\n'));
    failed = true;
  }

  // O3 — duplicate owners via existing moduleDirs injection
  // Include dotted module id so registrySrc.includes(id) passes (no package.json on /virtual/inv).
  const o3 = checkModuleManifests({
    registrySrc:
      okRegistry +
      `\nimport inventory from '@hospai/pms-inventory'; // pms.inventory\n`,
    moduleDirs: ['/virtual/hk', '/virtual/inv'],
    manifestSrcByDir: {
      '/virtual/hk': `
const manifest = { id: 'pms.housekeeping', writes: ['room'], schema: { tables: ['room'] } } as const;
export default manifest;
`,
      '/virtual/inv': `
const manifest = { id: 'pms.inventory', writes: ['room'], schema: { tables: ['room'] } } as const;
export default manifest;
`,
    },
  });
  if (!o3.some((e) => /conflict/.test(e) && /room/.test(e))) {
    console.error('self-test O3 duplicate owners should fail:\n' + o3.join('\n'));
    failed = true;
  }

  // O4 — unparseable schema.tables
  const o4 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: {
      '/virtual/hk': `
const HK_TABLES = ['housekeeping_assignment'];
const manifest = { id: 'pms.housekeeping', writes: ['housekeeping_assignment'], schema: { tables: HK_TABLES } } as const;
export default manifest;
`,
    },
  });
  if (!o4.some((e) => /could not parse schema\.tables/.test(e))) {
    console.error('self-test O4 unparseable schema.tables should fail:\n' + o4.join('\n'));
    failed = true;
  }
```

- [ ] **Step 4: Run self-test — expect OK**

```bash
node scripts/module-manifests-check.mjs --self-test
```

- [ ] **Step 5: Real check still green (vacuous adoption)**

```bash
pnpm check:module-manifests
```

Expected: ok (only `housekeeping_assignment` owned; DO plane writes none of it).

- [ ] **Step 6: Commit**

```bash
git add scripts/module-manifests-check.mjs
git commit -m "$(cat <<'EOF'
feat(checks): forbid DO-plane writes to module schema.tables

Auto-ratchet ownership as modules claim tables; O1 fixture is load-bearing
because the real tree is vacuous on day one.
EOF
)"
```

---

### Task 3: Colors `checkColors` + `--self-test` + CI

**Files:**
- Modify: `scripts/web-pms-colors-check.mjs`
- Modify: `.github/workflows/ci.yml`
- Test: `node scripts/web-pms-colors-check.mjs --self-test`
- Verify: `pnpm check:web-pms-colors`

**Interfaces:**
- Produces: `export function checkColors({ cssByFile }) → { ok, errors, stats }`
- Consumes: existing pure helpers (`contrastRatio`, `relativeLuminance`, …)

- [ ] **Step 1: Wrap body as `checkColors({ cssByFile })`**

Move the module-scope walk into a function that accepts `cssByFile: Record<string, string>` (relpath → raw CSS). Return errors instead of calling `process.exit` inside.

**Keep error message text verbatim** when converting `console.error(...)` → `errors.push(...)`. C3 greps `/contrast/` and `/colour literal/` against those strings; rewriting the wording in the same edit makes both assertions silently vacuous.

```js
export function contrastRatio(a, b) { /* existing */ }
export function relativeLuminance(hex) { /* existing */ }

export function checkColors({ cssByFile }) {
  const errors = [];
  let literalOk = 0;
  const allCss = [];

  for (const [rel, raw] of Object.entries(cssByFile)) {
    const css = stripComments(raw);
    allCss.push(css);
    // … same literal scan, push to errors instead of console.error/failed …
  }

  // … same contrast loop, push to errors …

  return {
    ok: errors.length === 0,
    errors,
    stats: { fileCount: Object.keys(cssByFile).length, literalOk, statusFgCount: statusFgs.length, contrastOk },
  };
}
```

- [ ] **Step 2: Exclusive dispatch tail (load-bearing)**

```js
function selfTest() {
  let failed = false;

  // C1 — strict === is intentional (exactly 21 in JS float here)
  if (contrastRatio('#000000', '#ffffff') !== 21) {
    console.error('self-test C1 FAILED: #000/#fff must be exactly 21');
    failed = true;
  }

  // C2 — boundary pair
  const pass = contrastRatio('#767676', '#ffffff');
  const failPair = contrastRatio('#777777', '#ffffff');
  if (!(pass >= 4.5)) {
    console.error(`self-test C2 pass pair FAILED: ${pass}`);
    failed = true;
  }
  if (!(failPair < 4.5)) {
    console.error(`self-test C2 fail pair FAILED: ${failPair}`);
    failed = true;
  }

  // C3 — rejection path via same entry point (two-tier tokens like production).
  // Literals only on --color-*; semantics use var() so resolveToHex is exercised.
  // Do NOT put #777777 on --status-demo-fg — that trips the literal rule and
  // passes C3 for the wrong reason without testing contrast resolution.
  const bad = checkColors({
    cssByFile: {
      'fixture.css': `
        --color-surface-base: #ffffff;
        --color-demo-fg: #777777;
        --status-demo-fg: var(--color-demo-fg);
        --status-demo-surface: var(--color-surface-base);
      `,
    },
  });
  if (bad.ok || !bad.errors.some((e) => /contrast/.test(e))) {
    console.error('self-test C3 FAILED: expected contrast failure via checkColors', bad);
    failed = true;
  }
  if (bad.errors.some((e) => /colour literal/.test(e))) {
    console.error('self-test C3 FAILED: fixture must not trip literal rule', bad.errors);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:web-pms-colors --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const files = walkCss(cssRoot);
  if (files.length === 0) {
    console.error('No CSS files under apps/web-pms');
    process.exit(1);
  }
  const cssByFile = Object.fromEntries(
    files.map((f) => [f.slice(root.length + 1), readFileSync(f, 'utf8')]),
  );
  const result = checkColors({ cssByFile });
  for (const e of result.errors) console.error(e);
  if (!result.ok) process.exit(1);
  console.log(
    `OK web-pms-colors: ${result.stats.fileCount} css files, ${result.stats.literalOk} primitive literals, ${result.stats.statusFgCount} status fgs, ${result.stats.contrastOk} contrast assertions`,
  );
}
```

Do **not** leave a module-scope real walk outside the `else` — `--self-test` would hit the real tree first.

- [ ] **Step 3: Run both**

```bash
node scripts/web-pms-colors-check.mjs --self-test
pnpm check:web-pms-colors
```

Expected: both OK.

- [ ] **Step 4: Wire CI**

In `.github/workflows/ci.yml`, after the existing self-test lines (~31–33):

```yaml
      - run: node scripts/web-pms-colors-check.mjs --self-test
```

- [ ] **Step 5: Commit**

```bash
git add scripts/web-pms-colors-check.mjs .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
test(checks): add web-pms-colors --self-test via injectable checkColors

Prove WCAG math and the contrast rejection path through the same entry
the real CSS walk uses.
EOF
)"
```

---

### Task 4: DDL `compareDdl` + `--self-test` + CI

**Files:**
- Modify: `scripts/property-ddl.mjs`
- Modify: `.github/workflows/ci.yml`
- Test: `node scripts/property-ddl.mjs --self-test`
- Verify: `pnpm check:ddl`

**Interfaces:**
- Produces: `compareDdl(generated, committed) → { ok: true } | { ok: false, reason: 'missing' | 'drift' }`
- Consumes: existing targets loop; dynamic `import(modPath)` **only** in check/write branch

- [ ] **Step 1: Extract `compareDdl` and restructure argv**

Replace the top-level mode hard-exit so `--self-test` works without loading dist:

```js
/**
 * Generate or check DDL SQL files against @hospai/do-runtime sources.
 *
 *   node scripts/property-ddl.mjs --write
 *   node scripts/property-ddl.mjs --check
 *   node scripts/property-ddl.mjs --self-test
 */

export function compareDdl(generated, committed) {
  if (committed == null) return { ok: false, reason: 'missing' };
  if (committed !== generated) return { ok: false, reason: 'drift' };
  return { ok: true };
}

function selfTest() {
  let failed = false;
  const gen = '-- header\nCREATE TABLE t (id INTEGER);\n';
  if (!compareDdl(gen, gen).ok) {
    console.error('self-test D1 matching pair should pass');
    failed = true;
  }
  const d2 = compareDdl(gen, gen + '-- drifted\n');
  if (d2.ok || d2.reason !== 'drift') {
    console.error('self-test D2 drift should fail', d2);
    failed = true;
  }
  const d3 = compareDdl(gen, null);
  if (d3.ok || d3.reason !== 'missing') {
    console.error('self-test D3 missing should fail', d3);
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('check:ddl --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const args = new Set(process.argv.slice(2));
  const mode = args.has('--write') ? 'write' : args.has('--check') ? 'check' : null;
  if (!mode) {
    console.error('Usage: node scripts/property-ddl.mjs --write | --check | --self-test');
    process.exit(2);
  }

  // existing dynamic import(modPath) + targets array MUST stay inside this else
  // …

  let failed = false;
  for (const t of targets) {
    const expected = t.header + t.sql;
    if (mode === 'write') {
      mkdirSync(dirname(t.path), { recursive: true });
      writeFileSync(t.path, expected);
      console.log(`Wrote ${t.path}`);
    } else {
      let onDisk = null;
      try {
        onDisk = readFileSync(t.path, 'utf8');
      } catch {
        onDisk = null;
      }
      const result = compareDdl(expected, onDisk);
      if (!result.ok) {
        if (result.reason === 'missing') console.error(`Missing ${t.path}`);
        else console.error(`DDL drift: ${t.path}`);
        failed = true;
      } else {
        console.log(`OK ${t.path}`);
      }
    }
  }

  if (mode === 'check' && failed) {
    console.error('Run: pnpm generate:ddl');
    process.exit(1);
  }
}
```

**Do not** move `await import(modPath)` to top level — that would couple `--self-test` to `pnpm --filter @hospai/do-runtime build`.

- [ ] **Step 2: Run self-test + real check**

```bash
node scripts/property-ddl.mjs --self-test
pnpm check:ddl
```

Expected: both OK. If `check:ddl` fails, the refactor changed comparison behavior — fix before committing.

- [ ] **Step 3: Wire CI**

```yaml
      - run: node scripts/property-ddl.mjs --self-test
```

Place next to the colors self-test step from Task 3.

- [ ] **Step 4: Commit**

```bash
git add scripts/property-ddl.mjs .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
test(checks): add property-ddl --self-test via compareDdl

Keep do-runtime dist import inside check/write so self-test stays
build-independent.
EOF
)"
```

---

### Task 5: Full CI-order verification (no new commit unless red)

**Files:** none unless a prior task left something broken

**Why:** This chunk edits three gate scripts plus `ci.yml`. Both `check:ddl` and `check:web-pms-colors` sit in the main CI sequence; root `eslint .` covers the new `export` statements on `.mjs` scripts.

- [ ] **Step 1: Run the main CI check sequence locally**

Mirror `.github/workflows/ci.yml` `checks` job order (after `pnpm install` / `pnpm build` if needed):

```bash
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
node scripts/module-manifests-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm lint
```

Expected: all green.

- [ ] **Step 2: If anything fails, fix in the owning task’s files and amend only if the last commit is yours and unpushed per repo commit rules; otherwise new fix commit**

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|---|---|
| Harden variants 1–4 + S1 regression guard + S2/S3 | Task 1 |
| `hasWriteSql` mirrors `UPDATE_RE` (no loose cross-newline form) | Task 1 |
| Commit split / module green before ownership | Task 1 step 5 → Task 2 |
| Ownership on `apps/pms-core/src/**`, `schema.tables` only; `ownedBy` in first loop | Task 2 |
| Loud parse + `writes ⊇ schema.tables` | Task 2 |
| O1 load-bearing, O2 control, O3/O4 (O3 registry includes `pms.inventory`) | Task 2 |
| Colors `checkColors` + exclusive dispatch + C1–C3 (two-tier C3 fixture) | Task 3 |
| DDL `compareDdl` + branch-local import + D1–D3 | Task 4 |
| CI wire-up colors + DDL self-tests | Tasks 3–4 |
| Full CI-order verification incl. lint | Task 5 |
| No extraction / no ratchet / no migration scan | Global Constraints |

No TBDs / no "if you prefer" forks. Types/names consistent: `pmsCoreSrcByFile`, `checkColors`, `compareDdl`, `tablesWrittenIn`, shared `UPDATE_RE`.
