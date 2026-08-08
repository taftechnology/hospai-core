#!/usr/bin/env node
/**
 * web-pms colour gate:
 * 1) Colour literals only on declarations whose property starts with `--color-`
 * 2) Every `--status-*-fg` clears WCAG AA 4.5:1 vs paired `-surface` and `--color-surface-base`
 *
 *   node scripts/web-pms-colors-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cssRoot = join(root, 'apps/web-pms');
const MIN_CONTRAST = 4.5;

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

function contrastRatio(a, b) {
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

const files = walkCss(cssRoot);
if (files.length === 0) {
  console.error('No CSS files under apps/web-pms');
  process.exit(1);
}

let failed = false;
let literalOk = 0;
const allCss = [];

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const css = stripComments(raw);
  allCss.push(css);
  const rel = file.slice(root.length + 1);

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
      console.error(`${rel}: colour literal ${lit} on property "${prop}" (only --color-* may hold literals)`);
      failed = true;
    }
  }
}

const props = collectCustomProps(allCss.join('\n'));
const panel = resolveToHex(props.get('--color-surface-base') ?? '', props);
if (!panel) {
  console.error('Missing resolvable --color-surface-base hex primitive');
  failed = true;
}

const statusFgs = [...props.keys()].filter((k) => /^--status-.+-fg$/.test(k));
if (statusFgs.length === 0) {
  console.error('No --status-*-fg custom properties found');
  failed = true;
}

let contrastOk = 0;
for (const fgProp of statusFgs) {
  const rung = fgProp.replace(/^--status-/, '').replace(/-fg$/, '');
  const surfaceProp = `--status-${rung}-surface`;
  const fgHex = resolveToHex(props.get(fgProp) ?? '', props);
  const surfaceHex = resolveToHex(props.get(surfaceProp) ?? '', props);
  if (!fgHex) {
    console.error(`${fgProp}: could not resolve to hex for contrast check`);
    failed = true;
    continue;
  }
  if (!surfaceHex) {
    console.error(`${surfaceProp}: could not resolve to hex for contrast check`);
    failed = true;
    continue;
  }
  const vsSurface = contrastRatio(fgHex, surfaceHex);
  if (vsSurface < MIN_CONTRAST) {
    console.error(
      `${fgProp} vs ${surfaceProp}: contrast ${vsSurface.toFixed(2)} < ${MIN_CONTRAST}`,
    );
    failed = true;
  } else {
    contrastOk += 1;
  }
  if (panel) {
    const vsPanel = contrastRatio(fgHex, panel);
    if (vsPanel < MIN_CONTRAST) {
      console.error(
        `${fgProp} vs --color-surface-base: contrast ${vsPanel.toFixed(2)} < ${MIN_CONTRAST}`,
      );
      failed = true;
    } else {
      contrastOk += 1;
    }
  }
}

if (failed) process.exit(1);

console.log(
  `OK web-pms-colors: ${files.length} css files, ${literalOk} primitive literals, ${statusFgs.length} status fgs, ${contrastOk} contrast assertions`,
);
