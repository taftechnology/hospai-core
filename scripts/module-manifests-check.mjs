#!/usr/bin/env node
/**
 * Gate module manifests: registry membership, ui/server moduleId pairing,
 * writes ⊇ infrastructure SQL writes, writes ⊇ schema.tables, read-path
 * files write-free, and apps/pms-core/src must not write module-owned tables.
 *
 *   node scripts/module-manifests-check.mjs
 *   node scripts/module-manifests-check.mjs --self-test
 *
 * Read-path convention: application files matching *read* (e.g. read-assignments.ts)
 * must not contain INSERT/UPDATE/DELETE.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function listModuleDirs() {
  const base = join(root, 'modules/pms');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'src/module.manifest.ts')));
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function extractId(manifestSrc) {
  const m = manifestSrc.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function extractModuleId(uiSrc) {
  const m = uiSrc.match(/\bmoduleId\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function extractWrites(manifestSrc) {
  const m = manifestSrc.match(/\bwrites\s*:\s*\[([^\]]*)\]/s);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function extractSchemaTables(manifestSrc) {
  const m = manifestSrc.match(/\bschema\s*:\s*\{[^}]*\btables\s*:\s*\[([^\]]*)\]/s);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function walkTsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsFiles(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

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

function packageNameForModuleDir(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readText(pkgPath)).name ?? null;
  } catch {
    return null;
  }
}

export function checkModuleManifests(opts = {}) {
  const registrySrc =
    opts.registrySrc ?? readText(join(root, 'packages/kernel/src/registry.ts'));
  const moduleDirs = opts.moduleDirs ?? listModuleDirs();
  const errors = [];
  const ownedBy = new Map(); // table -> moduleId

  for (const dir of moduleDirs) {
    const manifestPath = join(dir, 'src/module.manifest.ts');
    const manifestSrc = opts.manifestSrcByDir?.[dir] ?? readText(manifestPath);
    const id = extractId(manifestSrc);
    if (!id) {
      errors.push(`${relative(root, manifestPath)}: missing id`);
      continue;
    }

    const pkgName = packageNameForModuleDir(dir);
    const registered =
      (pkgName && registrySrc.includes(pkgName)) || registrySrc.includes(id);
    if (!registered) {
      errors.push(
        `${id}: not registered in packages/kernel/src/registry.ts (expected import of ${pkgName ?? id})`,
      );
    }

    const uiPath = join(dir, 'src/ui.manifest.ts');
    if (existsSync(uiPath) || opts.uiSrcByDir?.[dir]) {
      const uiSrc = opts.uiSrcByDir?.[dir] ?? readText(uiPath);
      const moduleId = extractModuleId(uiSrc);
      if (moduleId !== id) {
        errors.push(
          `${id}: ui.manifest moduleId ${JSON.stringify(moduleId)} !== server id`,
        );
      }
    }

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

    if (writes) {
      const infraDir = join(dir, 'src/infrastructure');
      const appDir = join(dir, 'src/application');
      const scanFiles = [
        ...walkTsFiles(infraDir),
        ...walkTsFiles(appDir).filter((f) => !/read/i.test(relative(appDir, f))),
      ];
      if (opts.infraSrcByDir?.[dir]) {
        for (const [name, src] of Object.entries(opts.infraSrcByDir[dir])) {
          const written = tablesWrittenIn(src);
          for (const t of written) {
            if (!writes.includes(t)) {
              errors.push(`${id}: writes under-declares ${t} (seen in ${name})`);
            }
          }
        }
      } else {
        for (const file of scanFiles) {
          const src = readText(file);
          for (const t of tablesWrittenIn(src)) {
            if (!writes.includes(t)) {
              errors.push(
                `${id}: writes under-declares ${t} (seen in ${relative(root, file)})`,
              );
            }
          }
        }
      }
    }

    const readFiles = opts.readSrcByDir?.[dir]
      ? Object.entries(opts.readSrcByDir[dir]).map(([name, src]) => ({ name, src }))
      : walkTsFiles(join(dir, 'src/application'))
          .filter((f) => /read/i.test(relative(join(dir, 'src/application'), f)))
          .map((f) => ({ name: relative(root, f), src: readText(f) }));

    for (const { name, src } of readFiles) {
      if (hasWriteSql(src)) {
        errors.push(`${id}: read-path ${name} must not INSERT/UPDATE/DELETE`);
      }
    }
  }

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
}

function selfTest() {
  let failed = false;

  function assertTables(label, src, expected) {
    const got = [...tablesWrittenIn(src)].sort();
    const exp = [...expected].sort();
    if (got.length !== exp.length || got.some((t, i) => t !== exp[i])) {
      console.error(
        `self-test ${label} FAILED: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`,
      );
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
  assertTables(
    'S1 OR ABORT',
    'INSERT OR ABORT INTO folio_window (x) VALUES (1)',
    ['folio_window'],
  );
  assertTables(
    'S1 OR FAIL',
    'INSERT OR FAIL INTO charge_code (x) VALUES (1)',
    ['charge_code'],
  );
  assertTables(
    'S1 OR ROLLBACK',
    'INSERT OR ROLLBACK INTO provisional_exception (x) VALUES (1)',
    ['provisional_exception'],
  );

  // Newlines inside INSERT INTO <table> / UPDATE <table> … SET (template-literal drift)
  assertTables(
    'S1 newline insert',
    'INSERT INTO\n folio_line (x) VALUES (1)',
    ['folio_line'],
  );
  assertTables(
    'S1 newline update',
    'UPDATE\n room\n SET status = ?',
    ['room'],
  );

  // S2 / S3 negatives
  assertTables('S2 select', 'SELECT * FROM room WHERE id = ?', []);
  assertTables(
    'S3 upsert',
    `INSERT INTO housekeeping_assignment (a) VALUES (1)
   ON CONFLICT(a) DO UPDATE SET b = excluded.b`,
    ['housekeeping_assignment'],
  );

  const okRegistry = `import housekeeping from '@hospai/pms-housekeeping'; // pms.housekeeping\nexport const MODULE_REGISTRY = [defineModule(housekeeping)];\n`;
  const okManifest = `
const manifest = {
  id: 'pms.housekeeping',
  writes: ['room', 'housekeeping_assignment'],
  schema: { tables: ['housekeeping_assignment'] },
} as const;
export default manifest;
`;
  const okUi = `export const housekeepingUi = { moduleId: 'pms.housekeeping', nav: [] };`;

  const e0 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    uiSrcByDir: { '/virtual/hk': okUi },
    infraSrcByDir: {
      '/virtual/hk': {
        'assign.ts': 'INSERT INTO housekeeping_assignment (x) VALUES (1); UPDATE room SET status = ?;',
      },
    },
    readSrcByDir: {
      '/virtual/hk': { 'read-assignments.ts': 'SELECT * FROM housekeeping_assignment;' },
    },
    pmsCoreSrcByFile: {},
  });
  if (e0.length !== 0) {
    console.error('self-test valid fixture should pass:\n' + e0.join('\n'));
    failed = true;
  }

  const e1 = checkModuleManifests({
    registrySrc: 'export const MODULE_REGISTRY = [];\n',
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    uiSrcByDir: { '/virtual/hk': okUi },
    pmsCoreSrcByFile: {},
  });
  if (!e1.some((e) => /not registered/.test(e))) {
    console.error('self-test missing registry entry should fail');
    failed = true;
  }

  const e2 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    uiSrcByDir: { '/virtual/hk': `export const housekeepingUi = { moduleId: 'pms.other', nav: [] };` },
    pmsCoreSrcByFile: {},
  });
  if (!e2.some((e) => /moduleId/.test(e))) {
    console.error('self-test moduleId mismatch should fail');
    failed = true;
  }

  const e3 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: {
      '/virtual/hk': `
const manifest = {
  id: 'pms.housekeeping',
  writes: ['housekeeping_assignment'],
  schema: { tables: ['housekeeping_assignment'] },
} as const;
export default manifest;
`,
    },
    infraSrcByDir: {
      '/virtual/hk': { 'x.ts': 'UPDATE room SET status = ?;' },
    },
    pmsCoreSrcByFile: {},
  });
  if (!e3.some((e) => /under-declares room/.test(e))) {
    console.error('self-test write-set under-declaration should fail');
    failed = true;
  }

  const e4 = checkModuleManifests({
    registrySrc: okRegistry,
    moduleDirs: ['/virtual/hk'],
    manifestSrcByDir: { '/virtual/hk': okManifest },
    readSrcByDir: {
      '/virtual/hk': { 'read-assignments.ts': 'UPDATE room SET status = ?;' },
    },
    pmsCoreSrcByFile: {},
  });
  if (!e4.some((e) => /read-path/.test(e))) {
    console.error('self-test read-path with UPDATE should fail');
    failed = true;
  }

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
    console.error(
      'self-test O2 UPDATE room must pass (in writes, not schema.tables):\n' + o2.join('\n'),
    );
    failed = true;
  }

  // O3 — duplicate owners via existing moduleDirs injection
  const o3 = checkModuleManifests({
    registrySrc:
      okRegistry + `\nimport inventory from '@hospai/pms-inventory'; // pms.inventory\n`,
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
    pmsCoreSrcByFile: {},
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
    pmsCoreSrcByFile: {},
  });
  if (!o4.some((e) => /could not parse schema\.tables/.test(e))) {
    console.error('self-test O4 unparseable schema.tables should fail:\n' + o4.join('\n'));
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:module-manifests --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const errors = checkModuleManifests();
  if (errors.length) {
    console.error('check:module-manifests failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('check:module-manifests: ok');
}
