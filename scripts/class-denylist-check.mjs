#!/usr/bin/env node
/**
 * Verify every repo `export class` name is listed in CLASS_DENYLIST.
 *
 *   node scripts/class-denylist-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const denylistPath = join(root, 'tooling/eslint-plugin-hospai/dist/class-denylist.js');

let CLASS_DENYLIST;
try {
  ({ CLASS_DENYLIST } = await import(denylistPath));
} catch (e) {
  console.error('Build eslint-plugin-hospai first: pnpm --filter eslint-plugin-hospai build');
  console.error(e);
  process.exit(1);
}

const denylist = new Set(CLASS_DENYLIST);
const exported = new Set();
const skipDir = new Set(['node_modules', 'dist', '.git', '.turbo', '.wrangler', 'coverage']);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDir.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/^export class (\w+)/gm)) {
      exported.add(match[1]);
    }
  }
}

walk(root);

let failed = false;

for (const name of exported) {
  if (!denylist.has(name)) {
    console.error(`export class missing from CLASS_DENYLIST: ${name}`);
    failed = true;
  }
}

for (const name of denylist) {
  if (!exported.has(name)) {
    console.error(`CLASS_DENYLIST phantom entry (no export class in repo): ${name}`);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log(`OK class-denylist: ${denylist.size} export class names aligned`);
