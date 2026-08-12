#!/usr/bin/env node
/**
 * Purge gates: module onPurge entitlement rule, certificate column allowlist
 * (no PII-shaped names), and PropertyDO guest-PII declare→enforce write scan.
 *
 *   node scripts/purge-check.mjs
 *   node scripts/purge-check.mjs --self-test
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PII_COLUMN_RE = /name|email|phone|passport|cipher|ssn|dob|address/i;

function readText(path) {
  return readFileSync(path, 'utf8');
}

function listModuleDirs() {
  const base = join(root, 'modules/pms');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'src/module.manifest.ts')));
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

function extractEntitlement(manifestSrc) {
  const m = manifestSrc.match(/\bentitlement\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function extractOnPurge(manifestSrc) {
  const m = manifestSrc.match(/\bonPurge\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function extractId(manifestSrc) {
  const m = manifestSrc.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

/**
 * entitlement === 'pms.core' → lifecycle.onPurge optional.
 * Else → must declare lifecycle.onPurge string.
 */
export function assertOnPurgeRequirement(manifest) {
  const entitlement = manifest.entitlement;
  if (!entitlement || typeof entitlement !== 'string') {
    return ['manifest missing entitlement'];
  }
  if (entitlement === 'pms.core') return [];
  const onPurge = manifest.lifecycle?.onPurge;
  if (typeof onPurge !== 'string' || onPurge.length === 0) {
    return [
      `entitlement ${JSON.stringify(entitlement)} requires lifecycle.onPurge (add-on purge hook)`,
    ];
  }
  return [];
}

/**
 * Declared set must equal the contracts allowlist; no PII-shaped names.
 */
export function assertCertificateColumns(declaredColumns, allowlist) {
  const errors = [];
  const declared = [...declaredColumns].sort();
  const allowed = [...allowlist].sort();
  if (declared.length !== allowed.length || declared.some((c, i) => c !== allowed[i])) {
    errors.push(
      `purge certificate columns drift: declared=${JSON.stringify(declared)} allowlist=${JSON.stringify(allowed)}`,
    );
  }
  for (const col of declaredColumns) {
    if (PII_COLUMN_RE.test(col)) {
      errors.push(`purge certificate column ${JSON.stringify(col)} looks like PII`);
    }
  }
  return errors;
}

/** Column idents from INSERT (…) lists and UPDATE SET targets. */
export function columnsWrittenIn(src) {
  const cols = new Set();

  const insertRe =
    /\bINSERT\s+(?:OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\s+)?INTO\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]+)\)/gi;
  for (const m of src.matchAll(insertRe)) {
    for (const part of m[1].split(',')) {
      const id = part.trim().replace(/^["[]|[\]"]$/g, '');
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) cols.add(id);
    }
  }

  const updateRe =
    /\bUPDATE\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?\s+SET\s+([^;]+?)(?:\bWHERE\b|$)/gis;
  for (const m of src.matchAll(updateRe)) {
    const setClause = m[1];
    for (const assign of setClause.split(',')) {
      const left = assign.split('=')[0]?.trim() ?? '';
      const id = left.replace(/^["[]|[\]"]$/g, '');
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) cols.add(id);
    }
  }

  return cols;
}

/**
 * Denylist columns written in pms-core must appear in PROPERTY_GUEST_PII_COLUMNS.
 */
export function assertGuestPiiWrites(opts) {
  const {
    denylist,
    allowlist,
    sources, // Array<{ rel, src }>
  } = opts;
  const allowed = new Set(allowlist.map((e) => e.column));
  const errors = [];
  for (const { rel, src } of sources) {
    const written = columnsWrittenIn(src);
    for (const col of denylist) {
      if (written.has(col) && !allowed.has(col)) {
        errors.push(
          `${rel}: writes guest-PII denylist column \`${col}\` — add to PROPERTY_GUEST_PII_COLUMNS and implement guest purge`,
        );
      }
    }
  }
  return errors;
}

async function loadContracts() {
  const contractsPath = pathToFileURL(
    join(root, 'packages/contracts/dist/index.js'),
  ).href;
  return import(contractsPath);
}

export async function checkPurge(opts = {}) {
  const errors = [];
  const contracts = opts.contracts ?? (await loadContracts());
  const {
    PURGE_CERTIFICATE_COLUMNS,
    PROPERTY_GUEST_PII_COLUMNS,
    PROPERTY_GUEST_PII_DENYLIST,
  } = contracts;

  // --- onPurge ---
  const moduleDirs = opts.moduleDirs ?? listModuleDirs();
  for (const dir of moduleDirs) {
    const manifestPath = join(dir, 'src/module.manifest.ts');
    const src = opts.manifestSrcByDir?.[dir] ?? readText(manifestPath);
    const id = extractId(src) ?? relative(root, dir);
    const entitlement = extractEntitlement(src);
    const onPurge = extractOnPurge(src);
    const manifest = {
      entitlement,
      lifecycle: onPurge ? { onPurge } : undefined,
    };
    for (const e of assertOnPurgeRequirement(manifest)) {
      errors.push(`${id}: ${e}`);
    }
  }
  if (opts.extraManifests) {
    for (const m of opts.extraManifests) {
      for (const e of assertOnPurgeRequirement(m)) {
        errors.push(e);
      }
    }
  }

  // --- certificate columns ---
  const declared =
    opts.declaredColumns ??
    (() => {
      const purgeCertSrc = readText(
        join(root, 'packages/contracts/src/purge-certificate-columns.ts'),
      );
      return [...purgeCertSrc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    })();
  errors.push(...assertCertificateColumns(declared, PURGE_CERTIFICATE_COLUMNS));

  // Drift: pms-core re-export must not redefine a local array
  if (!opts.skipPmsCoreDrift) {
    const pmsSrc = readText(join(root, 'apps/pms-core/src/purge-certificate.ts'));
    if (/export const PURGE_CERTIFICATE_COLUMNS\s*=\s*\[/.test(pmsSrc)) {
      errors.push(
        'apps/pms-core/src/purge-certificate.ts must re-export PURGE_CERTIFICATE_COLUMNS from @hospai/contracts',
      );
    }
  }

  // --- guest-PII write gate ---
  const sources = opts.pmsCoreSrcByFile
    ? Object.entries(opts.pmsCoreSrcByFile).map(([rel, src]) => ({ rel, src }))
    : walkTsFiles(join(root, 'apps/pms-core/src')).map((abs) => ({
        rel: relative(root, abs),
        src: readText(abs),
      }));
  errors.push(
    ...assertGuestPiiWrites({
      denylist: PROPERTY_GUEST_PII_DENYLIST,
      allowlist: opts.guestPiiAllowlist ?? PROPERTY_GUEST_PII_COLUMNS,
      sources,
    }),
  );

  return errors;
}

function selfTest() {
  let failed = false;

  // onPurge: pms.core without onPurge → OK
  {
    const e = assertOnPurgeRequirement({ entitlement: 'pms.core' });
    if (e.length !== 0) {
      console.error('self-test pms.core without onPurge should pass:\n' + e.join('\n'));
      failed = true;
    }
  }

  // onPurge: addon without onPurge → FAIL
  {
    const e = assertOnPurgeRequirement({ entitlement: 'pms.addon.x' });
    if (!e.some((x) => /onPurge/.test(x))) {
      console.error('self-test addon without onPurge should fail');
      failed = true;
    }
  }

  // onPurge: addon with onPurge → OK
  {
    const e = assertOnPurgeRequirement({
      entitlement: 'pms.addon.x',
      lifecycle: { onPurge: 'handlers.onPurge' },
    });
    if (e.length !== 0) {
      console.error('self-test addon with onPurge should pass:\n' + e.join('\n'));
      failed = true;
    }
  }

  // certificate: guest_name → FAIL
  {
    const e = assertCertificateColumns(
      ['certificate_id', 'guest_name'],
      ['certificate_id', 'workflow_id'],
    );
    if (!e.some((x) => /PII|drift/.test(x))) {
      console.error('self-test guest_name column should fail:\n' + e.join('\n'));
      failed = true;
    }
  }

  // guest-PII: write billed_party with empty allowlist → FAIL
  {
    const e = assertGuestPiiWrites({
      denylist: ['billed_party'],
      allowlist: [],
      sources: [
        {
          rel: 'apps/pms-core/src/property-do.ts',
          src: 'UPDATE folio_window SET billed_party = ? WHERE id = ?',
        },
      ],
    });
    if (!e.some((x) => /billed_party/.test(x))) {
      console.error('self-test billed_party write should fail:\n' + e.join('\n'));
      failed = true;
    }
  }

  // guest-PII: same write with allowlist entry → OK
  {
    const e = assertGuestPiiWrites({
      denylist: ['billed_party'],
      allowlist: [{ column: 'billed_party', reason: 'city ledger' }],
      sources: [
        {
          rel: 'apps/pms-core/src/property-do.ts',
          src: 'UPDATE folio_window SET billed_party = ? WHERE id = ?',
        },
      ],
    });
    if (e.length !== 0) {
      console.error('self-test billed_party with allowlist should pass:\n' + e.join('\n'));
      failed = true;
    }
  }

  // columnsWrittenIn INSERT
  {
    const cols = columnsWrittenIn(
      'INSERT INTO folio_window (folio_window_id, billed_party) VALUES (?, ?)',
    );
    if (!cols.has('billed_party')) {
      console.error('self-test INSERT column list should detect billed_party');
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('check:purge --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const errors = await checkPurge();
  if (errors.length) {
    console.error('check:purge failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('check:purge: ok');
}
