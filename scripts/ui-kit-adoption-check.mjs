#!/usr/bin/env node
/**
 * ui-kit adoption ratchet (spec §9.1):
 * Counts raw JSX intrinsics in scope for the lint rule across web-pms and module UI.
 * Fails when the count rises, or falls without a baseline update in the same commit.
 *
 *   node scripts/ui-kit-adoption-check.mjs
 *   node scripts/ui-kit-adoption-check.mjs --self-test
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts/.ui-kit-adoption-baseline.json');

const FORBIDDEN = [
  'button',
  'input',
  'select',
  'textarea',
  'table',
  'th',
  'td',
  'tr',
  'thead',
  'tbody',
];

const TAG_RE = new RegExp(`<(${FORBIDDEN.join('|')})(\\s|>|/)`, 'g');

const SCAN_ROOTS = [
  join(root, 'apps/web-pms/src'),
  join(root, 'modules/pms/housekeeping/src/ui'),
];

function walkTsx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkTsx(path, out);
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(path);
  }
  return out;
}

export function countRawControls() {
  const byTag = Object.fromEntries(FORBIDDEN.map((t) => [t, 0]));
  let total = 0;
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walkTsx(scanRoot)) {
      const text = readFileSync(file, 'utf8');
      let m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(text)) !== null) {
        byTag[m[1]] += 1;
        total += 1;
      }
    }
  }
  return { total, byTag };
}

function loadBaseline() {
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function selfTest() {
  let failed = false;

  const sampleIncrease = `<button type="button">x</button>`;
  if (!TAG_RE.test(sampleIncrease)) {
    console.error('self-test FAILED: TAG_RE must match raw button');
    failed = true;
  }
  TAG_RE.lastIndex = 0;

  const baseline = loadBaseline();
  if (typeof baseline.total !== 'number' || !baseline.byTag) {
    console.error('self-test FAILED: baseline shape invalid', baseline);
    failed = true;
  }

  const live = countRawControls();
  if (live.total > baseline.total) {
    console.error('self-test FAILED: live count exceeds baseline — update baseline or revert raw controls');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:ui-kit-adoption --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const baseline = loadBaseline();
  const live = countRawControls();

  if (live.total > baseline.total) {
    console.error(
      `ui-kit adoption ratchet FAILED: raw control count ${live.total} exceeds baseline ${baseline.total}`,
    );
    console.error('byTag live:', live.byTag);
    console.error('byTag baseline:', baseline.byTag);
    process.exit(1);
  }

  if (live.total < baseline.total) {
    console.error(
      `ui-kit adoption ratchet FAILED: raw control count ${live.total} is below baseline ${baseline.total} — update scripts/.ui-kit-adoption-baseline.json in this commit`,
    );
    process.exit(1);
  }

  console.log(
    `OK ui-kit-adoption: ${live.total} raw controls (baseline ${baseline.total}, at floor until batches 2–7 land)`,
  );
}
