#!/usr/bin/env node
/**
 * web-pms colour gate:
 * 1) Colour literals only on declarations whose property starts with `--color-`
 * 2) Every chrome pair and every `--status-*-fg` clears WCAG AA 4.5:1
 *    vs its surface (and the panel) in BOTH light and dark. A dark
 *    primitive wins when `@media (prefers-color-scheme: dark)` redefines it.
 * 3) Non-text pairs (field, focus, stay borders, room marks) clear 3:1
 *    on their grounds in both themes. A missing or unresolvable token
 *    is an error, the same as a chrome pair.
 *
 *   node scripts/web-pms-colors-check.mjs
 *   node scripts/web-pms-colors-check.mjs --self-test
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// apps/web-admin has no tokens of its own (it imports web-pms tokens.css), but its CSS must stay literal-free.
const cssRoots = [join(root, 'apps/web-pms'), join(root, 'apps/web-admin'), join(root, 'packages/ui-kit')];
const MIN_CONTRAST = 4.5;
const MIN_NON_TEXT_CONTRAST = 3;

/** Spec §4 — chrome and action pairs (fg prop, surface prop). */
const CHROME_PAIRS = [
  ['--ink', '--bg'],
  ['--ink', '--panel'],
  ['--muted', '--bg'],
  ['--muted', '--panel'],
  ['--muted', '--selected'],
  ['--primary', '--selected'],
  ['--primary', '--bg'],
  ['--action-primary-fg', '--action-primary-surface'],
  ['--action-destructive-fg', '--action-destructive-surface'],
  ['--ink', '--color-table-head'],
  ['--muted', '--color-table-head'],
  ['--ink', '--color-hover'],
  ['--muted', '--color-hover'],
  ['--ink', '--color-sidebar'],
  ['--muted', '--color-sidebar'],
  ['--primary', '--panel'],
  ['--action-primary-fg', '--color-primary'],
  ['--action-primary-fg', '--color-primary-hover'],
  ['--color-primary-tint-fg', '--color-primary-tint'],
  ['--action-destructive-fg', '--color-action-destructive-hover'],
  ['--color-stay-inhouse-fg', '--color-stay-inhouse'],
  ['--color-stay-confirmed-fg', '--color-stay-confirmed'],
  ['--color-stay-pending-fg', '--color-stay-pending'],
  ['--color-stay-overstay-fg', '--color-stay-overstay'],
  ['--color-stay-departed-fg', '--color-stay-departed'],
  ['--color-status-cancelled-fg', '--color-status-cancelled-surface'],
];

/** Live room view conditions (R4.27). Checked wherever the stylesheet declares them. */
const CONDITION_NAMES = [
  'available',
  'reserved',
  'occupied',
  'dirty',
  'maintenance',
  'billed',
  'unavailable',
];

/** Non-text edges (fg prop, surface prop) at 3:1. */
const NON_TEXT_PAIRS = [
  ['--color-field', '--color-surface-base'],
  ['--color-field', '--color-bg'],
  ['--color-focus', '--color-surface-base'],
  ['--color-focus', '--color-bg'],
  ['--color-focus', '--color-sidebar'],
  ['--color-focus', '--color-selected'],
  ['--color-stay-confirmed-border', '--color-surface-base'],
  ['--color-stay-pending-border', '--color-surface-base'],
  ['--color-room-clean', '--color-surface-base'],
  ['--color-room-clean', '--color-bg'],
  ['--color-room-dirty', '--color-surface-base'],
  ['--color-room-dirty', '--color-bg'],
  ['--color-room-inspected', '--color-surface-base'],
  ['--color-room-inspected', '--color-bg'],
  ['--color-room-ooo', '--color-surface-base'],
  ['--color-room-ooo', '--color-bg'],
];

const NAMED_COLORS = new Set([
  'white',
  'black',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'gray',
  'grey',
  'cyan',
  'magenta',
  'navy',
  'teal',
  'olive',
  'maroon',
  'silver',
  'lime',
  'aqua',
  'fuchsia',
  'aliceblue',
  'antiquewhite',
  'azure',
  'beige',
  'bisque',
  'blanchedalmond',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'greenyellow',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'limegreen',
  'linen',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'oldlace',
  'olivedrab',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'plum',
  'powderblue',
  'rebeccapurple',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'whitesmoke',
  'yellowgreen',
]);

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const FUNC_RE = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi;
const DECL_RE = /(--[a-zA-Z0-9-]+|[a-zA-Z-]+)\s*:\s*([^;{}]+);/g;

function walkCss(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkCss(path, out);
    else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function relativeLuminance(hex) {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n.slice(0, 6);
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a, b) {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function findLiteralsInValue(value) {
  const found = [];
  for (const m of value.matchAll(HEX_RE)) found.push(m[0]);
  for (const m of value.matchAll(FUNC_RE)) found.push(m[0]);
  for (const token of value.split(/[\s,/()]+/)) {
    const t = token.toLowerCase();
    if (NAMED_COLORS.has(t)) found.push(token);
  }
  return found;
}

function collectCustomProps(cssText) {
  const props = new Map();
  for (const m of cssText.matchAll(DECL_RE)) {
    const prop = m[1].trim();
    const value = m[2].trim();
    if (prop.startsWith('--')) props.set(prop, value);
  }
  return props;
}

function matchingClose(css, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function mediaRanges(css, test) {
  const ranges = [];
  for (const m of css.matchAll(/@media\b([^{]*)\{/g)) {
    if (!test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const close = matchingClose(css, open);
    if (close < 0) continue;
    ranges.push({ start: m.index, end: close + 1, inner: css.slice(open + 1, close) });
  }
  return ranges;
}

function excise(css, ranges) {
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let out = css;
  for (const range of sorted) out = out.slice(0, range.start) + out.slice(range.end);
  return out;
}

/** Custom props declared on `:root` selectors, including `:root:not(...)` and `:root[data-theme]`. */
function collectRootProps(css) {
  const props = new Map();
  for (const m of css.matchAll(/:root(?![a-zA-Z0-9_-])[^{]*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingClose(css, open);
    if (close < 0) continue;
    for (const [key, value] of collectCustomProps(css.slice(open + 1, close))) {
      props.set(key, value);
    }
  }
  return props;
}

function insideRange(ranges, index) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/** Top-level `:root[data-theme="dark"]` rules. Skips copies nested in print or the OS-dark media. */
function dataThemeDarkBlocks(css, skipRanges) {
  const blocks = [];
  for (const m of css.matchAll(/:root\[data-theme="dark"\][^{]*\{/g)) {
    if (insideRange(skipRanges, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchingClose(css, open);
    if (close < 0) continue;
    blocks.push({ start: m.index, end: close + 1, inner: css.slice(open + 1, close) });
  }
  return blocks;
}

function mergeProps(target, source) {
  for (const [key, value] of source) target.set(key, value);
}

function darkBlockDrift(mediaProps, attrProps) {
  if (mediaProps.size === 0 && attrProps.size === 0) return [];
  const errors = [];
  const keys = new Set([...mediaProps.keys(), ...attrProps.keys()]);
  for (const key of [...keys].sort()) {
    if (!mediaProps.has(key)) {
      errors.push(`dark blocks differ: ${key} missing from prefers-color-scheme dark`);
    } else if (!attrProps.has(key)) {
      errors.push(`dark blocks differ: ${key} missing from :root[data-theme="dark"]`);
    } else if (mediaProps.get(key) !== attrProps.get(key)) {
      errors.push(
        `dark blocks differ: ${key} is ${mediaProps.get(key)} in prefers-color-scheme dark and ${attrProps.get(key)} in :root[data-theme="dark"]`,
      );
    }
  }
  return errors;
}

/**
 * Light props are every custom prop outside the dark and print blocks.
 * Dark starts from light and overrides primitives the dark `:root` redefines.
 * The OS-dark block and `:root[data-theme="dark"]` must declare the same custom props.
 * Print is excluded so it cannot mask a dark value or a light one.
 */
function themeMaps(cssByFile, errors) {
  const lightParts = [];
  const darkOverrides = new Map();
  for (const raw of Object.values(cssByFile)) {
    const css = stripComments(raw);
    const darkRanges = mediaRanges(css, (prelude) => /prefers-color-scheme\s*:\s*dark/.test(prelude));
    const printRanges = mediaRanges(css, (prelude) => /\bprint\b/.test(prelude));
    const mediaProps = new Map();
    for (const range of darkRanges) mergeProps(mediaProps, collectRootProps(range.inner));
    const attrBlocks = dataThemeDarkBlocks(css, [...darkRanges, ...printRanges]);
    const attrProps = new Map();
    for (const block of attrBlocks) mergeProps(attrProps, collectCustomProps(block.inner));
    for (const drift of darkBlockDrift(mediaProps, attrProps)) errors.push(drift);
    mergeProps(darkOverrides, mediaProps.size > 0 ? mediaProps : attrProps);
    lightParts.push(excise(css, [...darkRanges, ...printRanges, ...attrBlocks]));
  }
  const light = collectCustomProps(lightParts.join('\n'));
  const dark = new Map(light);
  for (const [key, value] of darkOverrides) dark.set(key, value);
  return { light, dark };
}

function chromePairs(props) {
  const pairs = CHROME_PAIRS.slice();
  if (props.has('--sidebar')) pairs.push(['--ink', '--color-sidebar']);
  for (const name of CONDITION_NAMES) {
    if (props.has(`--color-cond-${name}`)) pairs.push([`--color-cond-${name}-fg`, `--color-cond-${name}`]);
  }
  return pairs;
}

function resolveToHex(value, props, depth = 0) {
  if (depth > 8) return null;
  const v = value.trim();
  const hex = v.match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const n = hex[0].slice(1);
    return n.length === 3 ? `#${n.split('').map((c) => c + c).join('')}` : hex[0].toLowerCase();
  }
  const varMatch = v.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,[^)]+)?\)$/);
  if (varMatch) {
    const next = props.get(varMatch[1]);
    if (!next) return null;
    return resolveToHex(next, props, depth + 1);
  }
  return null;
}

/** @param {{ cssByFile: Record<string, string> }} opts */
export function checkColors({ cssByFile }) {
  const errors = [];
  let literalOk = 0;

  for (const [rel, raw] of Object.entries(cssByFile)) {
    const css = stripComments(raw);

    for (const m of css.matchAll(DECL_RE)) {
      const prop = m[1].trim();
      const value = m[2].trim();
      const literals = findLiteralsInValue(value);
      if (literals.length === 0) continue;
      if (prop.startsWith('--color-')) {
        literalOk += literals.length;
        continue;
      }
      for (const lit of literals) {
        errors.push(
          `${rel}: colour literal ${lit} on property "${prop}" (only --color-* may hold literals)`,
        );
      }
    }
  }

  const { light, dark } = themeMaps(cssByFile, errors);
  const lightStats = assertThemeContrast(light, 'light', errors);
  const darkStats = assertThemeContrast(dark, 'dark', errors);

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      fileCount: Object.keys(cssByFile).length,
      literalOk,
      statusFgCount: lightStats.statusFgCount,
      contrastOk: lightStats.contrastOk + darkStats.contrastOk,
    },
  };
}

function assertThemeContrast(props, theme, errors) {
  let contrastOk = 0;
  const panel = resolveToHex(props.get('--color-surface-base') ?? '', props);
  if (!panel) {
    errors.push(`${theme}: Missing resolvable --color-surface-base hex primitive`);
  }

  const statusFgs = [...props.keys()].filter((k) => /^--status-.+-fg$/.test(k));
  if (statusFgs.length === 0) {
    errors.push(`${theme}: No --status-*-fg custom properties found`);
  }

  for (const [fgProp, surfaceProp] of chromePairs(props)) {
    const fgHex = resolveToHex(props.get(fgProp) ?? '', props);
    const surfaceHex = resolveToHex(props.get(surfaceProp) ?? '', props);
    if (!fgHex) {
      errors.push(`${theme}: ${fgProp}: could not resolve to hex for chrome pair check`);
      continue;
    }
    if (!surfaceHex) {
      errors.push(`${theme}: ${surfaceProp}: could not resolve to hex for chrome pair check`);
      continue;
    }
    const ratio = contrastRatio(fgHex, surfaceHex);
    if (ratio < MIN_CONTRAST) {
      errors.push(
        `${theme}: ${fgProp} vs ${surfaceProp}: contrast ${ratio.toFixed(2)} < ${MIN_CONTRAST}`,
      );
    } else {
      contrastOk += 1;
    }
  }

  for (const fgProp of statusFgs) {
    const rung = fgProp.replace(/^--status-/, '').replace(/-fg$/, '');
    const surfaceProp = `--status-${rung}-surface`;
    const fgHex = resolveToHex(props.get(fgProp) ?? '', props);
    const surfaceHex = resolveToHex(props.get(surfaceProp) ?? '', props);
    if (!fgHex) {
      errors.push(`${theme}: ${fgProp}: could not resolve to hex for contrast check`);
      continue;
    }
    if (!surfaceHex) {
      errors.push(`${theme}: ${surfaceProp}: could not resolve to hex for contrast check`);
      continue;
    }
    const vsSurface = contrastRatio(fgHex, surfaceHex);
    if (vsSurface < MIN_CONTRAST) {
      errors.push(
        `${theme}: ${fgProp} vs ${surfaceProp}: contrast ${vsSurface.toFixed(2)} < ${MIN_CONTRAST}`,
      );
    } else {
      contrastOk += 1;
    }
    if (panel) {
      const vsPanel = contrastRatio(fgHex, panel);
      if (vsPanel < MIN_CONTRAST) {
        errors.push(
          `${theme}: ${fgProp} vs --color-surface-base: contrast ${vsPanel.toFixed(2)} < ${MIN_CONTRAST}`,
        );
      } else {
        contrastOk += 1;
      }
    }
  }

  for (const [fgProp, surfaceProp] of NON_TEXT_PAIRS) {
    const fgHex = resolveToHex(props.get(fgProp) ?? '', props);
    const surfaceHex = resolveToHex(props.get(surfaceProp) ?? '', props);
    if (!fgHex) {
      errors.push(`${theme}: ${fgProp}: could not resolve to hex for non-text pair check`);
      continue;
    }
    if (!surfaceHex) {
      errors.push(`${theme}: ${surfaceProp}: could not resolve to hex for non-text pair check`);
      continue;
    }
    const ratio = contrastRatio(fgHex, surfaceHex);
    if (ratio < MIN_NON_TEXT_CONTRAST) {
      errors.push(
        `${theme}: ${fgProp} vs ${surfaceProp}: contrast ${ratio.toFixed(2)} < ${MIN_NON_TEXT_CONTRAST}`,
      );
    } else {
      contrastOk += 1;
    }
  }

  return { contrastOk, statusFgCount: statusFgs.length };
}

function selfTest() {
  let failed = false;

  /** House Colour light values that clear every required pair, plus one status rung. */
  function passingLightDecls() {
    return `
          --color-bg: #f7f6f3;
          --color-surface-base: #ffffff;
          --color-ink: #1b1a17;
          --color-muted: #5c5a53;
          --color-selected: #efede8;
          --color-hover: #f3f1ec;
          --color-table-head: #fbfaf8;
          --color-sidebar: #efede8;
          --color-field: #85817a;
          --color-primary: #0b5c63;
          --color-primary-hover: #084a50;
          --color-primary-tint: #d8eff0;
          --color-primary-tint-fg: #0a4b51;
          --color-focus: #0b5c63;
          --color-action-primary-surface: #0b5c63;
          --color-action-primary-fg: #ffffff;
          --color-action-destructive-surface: #a8302b;
          --color-action-destructive-fg: #ffffff;
          --color-action-destructive-hover: #8e2621;
          --color-status-cancelled-fg: #57544d;
          --color-status-cancelled-surface: #ecebe6;
          --color-stay-inhouse: #2b5a8a;
          --color-stay-inhouse-fg: #ffffff;
          --color-stay-confirmed: #dde9f5;
          --color-stay-confirmed-fg: #234a73;
          --color-stay-confirmed-border: #2b5a8a;
          --color-stay-pending: #fbeccb;
          --color-stay-pending-fg: #85480a;
          --color-stay-pending-border: #85480a;
          --color-stay-overstay: #a8302b;
          --color-stay-overstay-fg: #ffffff;
          --color-stay-departed: #ecebe6;
          --color-stay-departed-fg: #57544d;
          --color-room-clean: #11804f;
          --color-room-dirty: #b85c00;
          --color-room-inspected: #2b6cb0;
          --color-room-ooo: #a8302b;
          --ink: var(--color-ink);
          --muted: var(--color-muted);
          --bg: var(--color-bg);
          --panel: var(--color-surface-base);
          --selected: var(--color-selected);
          --primary: var(--color-primary);
          --sidebar: var(--color-sidebar);
          --action-primary-fg: var(--color-action-primary-fg);
          --action-primary-surface: var(--color-action-primary-surface);
          --action-destructive-fg: var(--color-action-destructive-fg);
          --action-destructive-surface: var(--color-action-destructive-surface);
          --color-demo-fg: #000000;
          --status-demo-fg: var(--color-demo-fg);
          --status-demo-surface: var(--color-surface-base);
    `;
  }

  // C1 — strict === is intentional (exactly 21 in JS float here)
  if (contrastRatio('#000000', '#ffffff') !== 21) {
    console.error('self-test C1 FAILED: #000/#fff must be exactly 21');
    failed = true;
  }

  // C2 — boundary pair
  const pass = contrastRatio('#767676', '#ffffff');
  const failPair = contrastRatio('#777777', '#ffffff');
  if (!(pass >= 4.5)) {
    console.error(`self-test C2 pass pair FAILED: ${pass}`);
    failed = true;
  }
  if (!(failPair < 4.5)) {
    console.error(`self-test C2 fail pair FAILED: ${failPair}`);
    failed = true;
  }

  // C3 — rejection path via same entry point (two-tier tokens like production).
  const bad = checkColors({
    cssByFile: {
      'fixture.css': `
        --color-surface-base: #ffffff;
        --color-demo-fg: #777777;
        --status-demo-fg: var(--color-demo-fg);
        --status-demo-surface: var(--color-surface-base);
      `,
    },
  });
  if (bad.ok || !bad.errors.some((e) => /contrast/.test(e))) {
    console.error('self-test C3 FAILED: expected contrast failure via checkColors', bad);
    failed = true;
  }
  if (bad.errors.some((e) => /colour literal/.test(e))) {
    console.error('self-test C3 FAILED: fixture must not trip literal rule', bad.errors);
    failed = true;
  }

  // C4 — ui-kit literal on non --color-* must fail rule 1.
  const uiKitBad = checkColors({
    cssByFile: {
      'packages/ui-kit/src/styles.css': `
        .ui-btn { color: #ff0000; }
      `,
    },
  });
  if (uiKitBad.ok || !uiKitBad.errors.some((e) => /colour literal/.test(e))) {
    console.error('self-test C4 FAILED: expected literal rejection in ui-kit fixture', uiKitBad);
    failed = true;
  }

  // C5 — a pair that passes in light and fails once the dark block redefines it.
  const darkFail = checkColors({
    cssByFile: {
      'fixture.css': `
        :root {
          ${passingLightDecls()}
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --color-ink: #777777;
            --color-bg: #ffffff;
          }
        }
      `,
    },
  });
  const darkContrast = darkFail.errors.filter((e) => e.startsWith('dark:') && /contrast/.test(e));
  if (darkFail.ok || darkContrast.length === 0 || !darkContrast.some((e) => /--ink vs --bg/.test(e))) {
    console.error('self-test C5 FAILED: expected a failing dark --ink/--bg pair', darkFail.errors);
    failed = true;
  }
  if (darkFail.errors.some((e) => e.startsWith('light:'))) {
    console.error('self-test C5 FAILED: light theme of the fixture must pass', darkFail.errors);
    failed = true;
  }

  // C6 — 8-digit hex is a colour literal, and it is legal on --color-*.
  const eightRejected = checkColors({
    cssByFile: {
      'fixture.css': `.swatch { box-shadow: 0 1px 3px 0 #0000000d; }`,
    },
  });
  if (!eightRejected.errors.some((e) => e.includes('#0000000d') && /colour literal/.test(e))) {
    console.error('self-test C6 FAILED: 8-digit hex must count as a colour literal', eightRejected.errors);
    failed = true;
  }
  const eightAllowed = checkColors({
    cssByFile: {
      'fixture.css': `--color-shadow: #0000000d;`,
    },
  });
  if (eightAllowed.errors.some((e) => /#0000000d/.test(e) && /colour literal/.test(e))) {
    console.error('self-test C6 FAILED: 8-digit hex on --color-* must be allowed', eightAllowed.errors);
    failed = true;
  }

  // C7 — the two dark blocks must declare the same custom properties.
  const drift = checkColors({
    cssByFile: {
      'fixture.css': `
        :root { --color-ink: #000000; --color-bg: #ffffff; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) { --color-ink: #ffffff; --color-bg: #000000; }
        }
        :root[data-theme="dark"] { --color-ink: #eeeeee; --color-bg: #000000; }
      `,
    },
  });
  if (!drift.errors.some((e) => /dark blocks differ/.test(e) && /--color-ink/.test(e))) {
    console.error('self-test C7 FAILED: differing dark blocks must be reported', drift.errors);
    failed = true;
  }
  const matched = checkColors({
    cssByFile: {
      'fixture.css': `
        :root { --color-ink: #000000; --color-bg: #ffffff; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) { --color-ink: #ffffff; --color-bg: #000000; }
        }
        :root[data-theme="dark"] { --color-ink: #ffffff; --color-bg: #000000; }
      `,
    },
  });
  if (matched.errors.some((e) => /dark blocks differ/.test(e))) {
    console.error('self-test C7 FAILED: matching dark blocks must not drift', matched.errors);
    failed = true;
  }

  // C8 — each new pair class fails on the same light palette when its token is too close.
  const weakPairs = checkColors({
    cssByFile: {
      'fixture.css': `
        :root {
          ${passingLightDecls()}
          --color-field: #d4d4d4;
          --color-focus: #d4d4d4;
          --color-primary-hover: #a3a3a3;
          --color-stay-confirmed-fg: #dde9f5;
        }
      `,
    },
  });
  const weakContrast = weakPairs.errors.filter((e) => /contrast/.test(e));
  const weakExpected = [
    '--color-field',
    '--color-focus',
    '--color-primary-hover',
    '--color-stay-confirmed-fg',
  ];
  for (const token of weakExpected) {
    if (!weakContrast.some((e) => e.includes(token))) {
      console.error(`self-test C8 FAILED: expected a contrast error naming ${token}`, weakPairs.errors);
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('check:web-pms-colors --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const files = cssRoots.flatMap((dir) => walkCss(dir));
  if (files.length === 0) {
    console.error('No CSS files under apps/web-pms, apps/web-admin or packages/ui-kit');
    process.exit(1);
  }
  const cssByFile = Object.fromEntries(
    files.map((f) => [f.slice(root.length + 1), readFileSync(f, 'utf8')]),
  );
  const result = checkColors({ cssByFile });
  for (const e of result.errors) console.error(e);
  if (!result.ok) process.exit(1);
  console.log(
    `OK web-pms-colors: ${result.stats.fileCount} css files, ${result.stats.literalOk} primitive literals, ${result.stats.statusFgCount} status fgs, ${result.stats.contrastOk} contrast assertions`,
  );
}
