#!/usr/bin/env node
/**
 * SPA page-shell floor check (spec Lock 9):
 * Every scanned operational screen must render PageHeader + Card;
 * no mode.replace titles; TapeChart view tabs need ui-tab; tape-scroller bounded.
 *
 *   node scripts/spa-page-chrome-check.mjs
 *   node scripts/spa-page-chrome-check.mjs --self-test
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS_DIR = join(root, 'apps/web-pms/src/screens');
const HK_APP = join(root, 'modules/pms/housekeeping/src/ui/HousekeepingApp.tsx');
const STYLES = join(root, 'apps/web-pms/src/styles.css');
const EXCLUDE = new Set(['HousekeepingScreen.tsx']);

const PAGE_HEADER_RE = /<PageHeader[\s>]/;
const CARD_RE = /<Card[\s>]/;
const MODE_REPLACE_RE = /mode\.replace\('-',\s*' '\)/;

/** Opening <Link …> for a view tab must include ui-tab before > */
function linkOpenerHasUiTab(opener) {
  if (/className="ui-tab"/.test(opener)) return true;
  if (/className=\{'ui-tab'\}/.test(opener)) return true;
  if (/className=\{[^}]*['"]ui-tab['"]/.test(opener)) return true;
  if (/clsx\([^)]*['"]ui-tab['"]/.test(opener)) return true;
  return false;
}

/** Find Tape / Available view-tab Link openers in TapeChartScreen source */
export function checkTapeViewTabs(src) {
  const errors = [];
  const linkRe = /<Link\b([^>]*)>([\s\S]*?)<\/Link>/g;
  let m;
  while ((m = linkRe.exec(src)) !== null) {
    const opener = m[1];
    const inner = m[2].trim();
    if (inner === 'Tape' || inner === 'Available') {
      if (!linkOpenerHasUiTab(opener)) {
        errors.push(`view tab Link "${inner}" missing ui-tab on opening tag`);
      }
    }
  }
  return errors;
}

export function checkTapeScrollerCss(css) {
  const block = css.match(/\.tape-scroller\s*\{[^}]*\}/s);
  if (!block) return ['.tape-scroller block not found'];
  if (!/max-block-size/.test(block[0])) {
    return ['.tape-scroller block lacks max-block-size'];
  }
  return [];
}

export function checkScreenFile(filePath, src) {
  const errors = [];
  const rel = filePath.replace(root + '/', '');
  if (!PAGE_HEADER_RE.test(src)) errors.push(`${rel}: missing PageHeader`);
  if (!CARD_RE.test(src)) errors.push(`${rel}: missing Card`);
  if (MODE_REPLACE_RE.test(src)) errors.push(`${rel}: mode.replace title`);
  if (rel.endsWith('TapeChartScreen.tsx')) {
    errors.push(...checkTapeViewTabs(src).map((e) => `${rel}: ${e}`));
  }
  return errors;
}

function listScreenFiles() {
  return readdirSync(SCREENS_DIR)
    .filter((name) => name.endsWith('Screen.tsx') && !EXCLUDE.has(name))
    .map((name) => join(SCREENS_DIR, name));
}

export function runLiveCheck() {
  const errors = [];
  for (const file of listScreenFiles()) {
    const src = readFileSync(file, 'utf8');
    errors.push(...checkScreenFile(file, src));
  }
  const hkSrc = readFileSync(HK_APP, 'utf8');
  errors.push(...checkScreenFile(HK_APP, hkSrc));
  const css = readFileSync(STYLES, 'utf8');
  errors.push(...checkTapeScrollerCss(css).map((e) => `apps/web-pms/src/styles.css: ${e}`));
  return errors;
}

function selfTest() {
  let failed = false;
  const fail = (msg) => {
    console.error('self-test FAILED:', msg);
    failed = true;
  };

  if (!PAGE_HEADER_RE.test('<PageHeader title="X" />')) {
    fail('PAGE_HEADER_RE must match PageHeader');
  }
  if (PAGE_HEADER_RE.test('<PageHeaderish')) {
    fail('PAGE_HEADER_RE must not match partial');
  }
  if (!CARD_RE.test('<Card>')) fail('CARD_RE must match <Card>');
  if (!CARD_RE.test('<Card data-testid="x">')) fail('CARD_RE must match <Card prop>');
  if (CARD_RE.test('<CardHeader>')) fail('CARD_RE must not match CardHeader');
  if (CARD_RE.test('<CardTitle>')) fail('CARD_RE must not match CardTitle');
  if (!MODE_REPLACE_RE.test("mode.replace('-', ' ')")) {
    fail('MODE_REPLACE_RE must match mode.replace');
  }

  // Lock 9 Tape/Available fixtures
  const tapeFail = '<Link to="/board">Tape</Link>';
  const tapePass = '<Link className="ui-tab" to="/board">Tape</Link>';
  const availFail = '<Link to="/board?view=available">Available</Link>';
  const availPass =
    '<Link className="ui-tab" to="/board?view=available" aria-current="page">Available</Link>';

  if (checkTapeViewTabs(tapeFail).length === 0) fail('tapeFail fixture should FAIL');
  if (checkTapeViewTabs(tapePass).length !== 0) fail('tapePass fixture should PASS');
  if (checkTapeViewTabs(availFail).length === 0) fail('availFail fixture should FAIL');
  if (checkTapeViewTabs(availPass).length !== 0) fail('availPass fixture should PASS');

  const cssOk = `.tape-scroller {
  overflow: auto;
  max-block-size: min(70vh, calc(100dvh - 18rem));
}`;
  if (checkTapeScrollerCss(cssOk).length !== 0) fail('cssOk fixture should PASS');
  const cssBad = `.tape-scroller { overflow: auto; }`;
  if (checkTapeScrollerCss(cssBad).length === 0) fail('cssBad fixture should FAIL');

  const badScreen = 'export function X() { return <div><Card /></div>; }';
  if (checkScreenFile('apps/web-pms/src/screens/XScreen.tsx', badScreen).length === 0) {
    fail('missing PageHeader fixture should FAIL');
  }
  const goodScreen =
    'export function X() { return <div><PageHeader title="T" /><Card /></div>; }';
  if (checkScreenFile('apps/web-pms/src/screens/XScreen.tsx', goodScreen).length !== 0) {
    fail('PageHeader+Card fixture should PASS');
  }

  if (failed) process.exit(1);
  console.log('check:spa-page-chrome --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const errors = runLiveCheck();
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`spa-page-chrome FAILED (${errors.length} issue(s))`);
    process.exit(1);
  }
  console.log('OK spa-page-chrome: all scanned screens pass floor check');
}
