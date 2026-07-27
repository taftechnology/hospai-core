#!/usr/bin/env node
/**
 * Generate or check migrations/do-property/0001_freeze_gate.sql
 * against packages/do-runtime FREEZE_GATE_SQL (single source of truth).
 *
 *   node scripts/property-ddl.mjs --write   # regenerate the SQL file
 *   node scripts/property-ddl.mjs --check   # exit 1 on drift (CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = join(root, 'migrations/do-property/0001_freeze_gate.sql');
const modPath = join(root, 'packages/do-runtime/dist/property-migrations.js');

const HEADER = `-- Phase 0 schema-freeze gate (§14) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

`;

const args = new Set(process.argv.slice(2));
const mode = args.has('--write') ? 'write' : args.has('--check') ? 'check' : null;
if (!mode) {
  console.error('Usage: node scripts/property-ddl.mjs --write | --check');
  process.exit(2);
}

let FREEZE_GATE_SQL;
try {
  ({ FREEZE_GATE_SQL } = await import(modPath));
} catch (e) {
  console.error(
    'Failed to load @hospai/do-runtime dist. Run `pnpm --filter @hospai/do-runtime build` first.',
  );
  console.error(e);
  process.exit(1);
}

const expected = HEADER + FREEZE_GATE_SQL;
if (!expected.endsWith('\n')) {
  // FREEZE_GATE_SQL already ends with ;\n
}

if (mode === 'write') {
  writeFileSync(sqlPath, expected);
  console.log(`Wrote ${sqlPath}`);
  process.exit(0);
}

const onDisk = readFileSync(sqlPath, 'utf8');
if (onDisk !== expected) {
  console.error('DDL drift: migrations/do-property/0001_freeze_gate.sql does not match FREEZE_GATE_SQL.');
  console.error('Run: pnpm generate:ddl');
  process.exit(1);
}
console.log('DDL in sync with packages/do-runtime FREEZE_GATE_SQL');
