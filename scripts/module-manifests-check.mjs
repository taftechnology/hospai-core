#!/usr/bin/env node
/**
 * Gate module manifests: registry membership, ui/server moduleId pairing,
 * writes ⊇ infrastructure SQL writes, read-path files write-free.
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

/** Rough table names from INSERT INTO / UPDATE / DELETE FROM. */
function tablesWrittenIn(src) {
  const tables = new Set();
  for (const m of src.matchAll(/\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
    tables.add(m[1]);
  }
  for (const m of src.matchAll(/\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\b/gi)) {
    tables.add(m[1]);
  }
  for (const m of src.matchAll(/\bDELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
    tables.add(m[1]);
  }
  return tables;
}

function hasWriteSql(src) {
  return /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(src);
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
      errors.push(`${id}: missing writes array`);
    } else {
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

  return errors;
}

function selfTest() {
  let failed = false;

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
const manifest = { id: 'pms.housekeeping', writes: ['housekeeping_assignment'] } as const;
export default manifest;
`,
    },
    infraSrcByDir: {
      '/virtual/hk': { 'x.ts': 'UPDATE room SET status = ?;' },
    },
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
  });
  if (!e4.some((e) => /read-path/.test(e))) {
    console.error('self-test read-path with UPDATE should fail');
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
