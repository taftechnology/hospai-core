#!/usr/bin/env node
/**
 * Ban machine-local / wall-clock day-0 derivation in pms-core tests.
 * Calendar stepping of a held YYYY-MM-DD (getUTCDate, d.toISOString().slice) is allowed.
 *
 *   node scripts/pms-core-test-dates-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = join(root, 'apps/pms-core/test');

/** @type {{ name: string, re: RegExp }[]} */
const BANS = [
  { name: 'toLocaleDateString', re: /toLocaleDateString\s*\(/ },
  { name: 'local getDate/getMonth/getFullYear', re: /\.get(?:Date|Month|FullYear)\s*\(/ },
  {
    name: 'new Date().toISOString().slice(0, 10)',
    re: /new\s+Date\s*\(\s*\)\s*\.toISOString\s*\(\s*\)\s*\.slice\s*\(\s*0\s*,\s*10\s*\)/,
  },
];

function walk(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(ent)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(testRoot)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ban of BANS) {
      if (ban.re.test(lines[i])) {
        hits.push(`${relative(root, file)}:${i + 1}: ${ban.name}`);
      }
    }
  }
}

if (hits.length) {
  console.error('pms-core test date gate failed:\n' + hits.map((h) => `  ${h}`).join('\n'));
  process.exit(1);
}
console.log('pms-core test date gate: ok');
