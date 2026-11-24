#!/usr/bin/env node
/**
 * ui-kit adoption ratchet (spec §9.1):
 * Counts raw JSX intrinsics in scope for the lint rule across web-pms and module UI.
 * Also counts className tokens panel / badge (Phase G G5; compound classNames included).
 * Fails when any count rises, or falls without a baseline update in the same commit.
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
/** panel / badge as whitespace-delimited tokens inside className="..." (not side-panel etc.) */
const PANEL_RE = /className="(?:[^"\s]+\s+)*panel(?:\s+[^"\s]+)*"/g;
const BADGE_RE = /className="(?:[^"\s]+\s+)*badge(?:\s+[^"\s]+)*"/g;

const SCAN_ROOTS = [
  join(root, 'apps/web-pms/src'),
  join(root, 'apps/web-admin/src'),
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

function countMatches(re, text) {
  let count = 0;
  re.lastIndex = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

export function countRawControls() {
  const byTag = Object.fromEntries(FORBIDDEN.map((t) => [t, 0]));
  let total = 0;
  let panelClassName = 0;
  let badgeClassName = 0;
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walkTsx(scanRoot)) {
      const text = readFileSync(file, 'utf8');
      let m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(text)) !== null) {
        byTag[m[1]] += 1;
        total += 1;
      }
      panelClassName += countMatches(PANEL_RE, text);
      badgeClassName += countMatches(BADGE_RE, text);
    }
  }
  return { total, byTag, panelClassName, badgeClassName };
}

function loadBaseline() {
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function checkRatchet(name, live, baseline) {
  if (live > baseline) {
    console.error(
      `ui-kit adoption ratchet FAILED: ${name} count ${live} exceeds baseline ${baseline}`,
    );
    return false;
  }
  if (live < baseline) {
    console.error(
      `ui-kit adoption ratchet FAILED: ${name} count ${live} is below baseline ${baseline} — update scripts/.ui-kit-adoption-baseline.json in this commit`,
    );
    return false;
  }
  return true;
}

function selfTest() {
  let failed = false;

  const sampleIncrease = `<button type="button">x</button>`;
  if (!TAG_RE.test(sampleIncrease)) {
    console.error('self-test FAILED: TAG_RE must match raw button');
    failed = true;
  }
  TAG_RE.lastIndex = 0;

  if (countMatches(PANEL_RE, '<div className="panel">') !== 1) {
    console.error('self-test FAILED: PANEL_RE must match className="panel"');
    failed = true;
  }

  if (countMatches(PANEL_RE, '<div className="panel overscroll-contain">') !== 1) {
    console.error('self-test FAILED: PANEL_RE must match compound panel className');
    failed = true;
  }

  if (countMatches(PANEL_RE, '<div className="side-panel">') !== 0) {
    console.error('self-test FAILED: PANEL_RE must not match side-panel');
    failed = true;
  }

  if (countMatches(BADGE_RE, '<span className="badge">') !== 1) {
    console.error('self-test FAILED: BADGE_RE must match className="badge"');
    failed = true;
  }

  const baseline = loadBaseline();
  if (
    typeof baseline.total !== 'number' ||
    !baseline.byTag ||
    typeof baseline.panelClassName !== 'number' ||
    typeof baseline.badgeClassName !== 'number'
  ) {
    console.error('self-test FAILED: baseline shape invalid', baseline);
    failed = true;
  }

  const live = countRawControls();
  if (live.total > baseline.total) {
    console.error('self-test FAILED: live count exceeds baseline — update baseline or revert raw controls');
    failed = true;
  }
  if (live.panelClassName > baseline.panelClassName) {
    console.error('self-test FAILED: live panelClassName exceeds baseline');
    failed = true;
  }
  if (live.badgeClassName > baseline.badgeClassName) {
    console.error('self-test FAILED: live badgeClassName exceeds baseline');
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

  let ok = true;
  ok = checkRatchet('raw control', live.total, baseline.total) && ok;
  ok = checkRatchet('panelClassName', live.panelClassName, baseline.panelClassName) && ok;
  ok = checkRatchet('badgeClassName', live.badgeClassName, baseline.badgeClassName) && ok;

  if (!ok) {
    console.error('byTag live:', live.byTag);
    console.error('byTag baseline:', baseline.byTag);
    process.exit(1);
  }

  console.log(
    `OK ui-kit-adoption: ${live.total} raw controls, ${live.panelClassName} panel, ${live.badgeClassName} badge (baseline ${baseline.total}/${baseline.panelClassName}/${baseline.badgeClassName})`,
  );
}
