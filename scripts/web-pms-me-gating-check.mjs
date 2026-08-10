/**
 * web-pms me-gating gate:
 * 1) No ROLE_GRANTS client oracle from @hospai/contracts
 * 2) No role-equality gating (owner/admin/staff)
 *
 *   node scripts/web-pms-me-gating-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'apps/web-pms/src');
const ROLE_GRANTS_IMPORT = /ROLE_GRANTS/;
const ROLE_GATE =
  /\b(?:me\.)?role\s*===\s*['"](?:owner|admin|staff)['"]|\.role\s*===\s*['"](?:owner|admin|staff)['"]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(srcRoot)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  if (ROLE_GRANTS_IMPORT.test(text) && /@hospai\/contracts/.test(text)) {
    violations.push(`${rel}: ROLE_GRANTS import from contracts (client oracle forbidden)`);
  }
  for (const [i, line] of text.split('\n').entries()) {
    if (ROLE_GATE.test(line)) {
      violations.push(`${rel}:${i + 1}: role equality gating forbidden — use permission helpers`);
    }
  }
}
if (violations.length) {
  console.error('check:web-pms-me-gating failed:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('check:web-pms-me-gating: ok');
