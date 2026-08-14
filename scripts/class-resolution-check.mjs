#!/usr/bin/env node
/**
 * class-resolution gate (spec §16.5–8):
 * 1) Every class referenced in a `className` across `apps/web-pms/src` and
 *    module `src/ui` trees resolves to a rule in the web-pms CSS.
 * 2) Companion assertions: input/select/textarea/button declare font + block
 *    size; a :focus-visible rule and a :disabled rule exist; .panel declares
 *    border-radius.
 *
 * Template literals contribute only their static text segments — `${…}`
 * interpolations are ignored. The five status rungs returned by
 * `statusClass()` never appear as literals, so they are allowlisted.
 *
 *   node scripts/class-resolution-check.mjs
 *   node scripts/class-resolution-check.mjs --self-test
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxRoots = [join(root, 'apps/web-pms/src'), join(root, 'modules')];
const cssRoot = join(root, 'apps/web-pms/src');

const RUNG_ALLOWLIST = new Set([
  'status-settled',
  'status-neutral',
  'status-informational',
  'status-attention',
  'status-exception',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function skipString(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === quote) return i;
    else i += 1;
  }
  return src.length;
}

function skipTemplate(src, start) {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') i += 2;
    else if (ch === '`') return i;
    else if (ch === '$' && src[i + 1] === '{') i = scanBalanced(src, i + 1);
    else i += 1;
  }
  return src.length;
}

function scanBalanced(src, start) {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'") i = skipString(src, i);
    else if (ch === '`') i = skipTemplate(src, i);
    i += 1;
  }
  return src.length - 1;
}

function pushTokens(text, baseIndex, found) {
  for (const m of text.matchAll(/\S+/g)) {
    found.push({ token: m[0], index: baseIndex + m.index });
  }
}

function collectTemplateStatics(tpl, baseIndex, found) {
  let buf = '';
  let bufStart = 0;
  let i = 0;
  const flush = () => {
    if (buf.trim() !== '') pushTokens(buf, baseIndex + bufStart, found);
    buf = '';
  };
  while (i < tpl.length) {
    if (tpl[i] === '\\') {
      buf += tpl[i] + tpl[i + 1];
      i += 2;
      continue;
    }
    if (tpl[i] === '$' && tpl[i + 1] === '{') {
      flush();
      i = scanBalanced(tpl, i + 1) + 1;
      bufStart = i;
      continue;
    }
    if (buf === '') bufStart = i;
    buf += tpl[i];
    i += 1;
  }
  flush();
}

function extractFromExpression(expr, baseIndex, found) {
  let residual = '';
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === '`') {
      const end = skipTemplate(expr, i);
      collectTemplateStatics(expr.slice(i + 1, end), baseIndex + i + 1, found);
      residual += ' '.repeat(end - i + 1);
      i = end + 1;
    } else {
      residual += expr[i];
      i += 1;
    }
  }
  // Function calls (e.g. statusClass('informational')) do not contribute
  // class tokens — strip them, repeating for nested calls.
  let prev;
  do {
    prev = residual;
    residual = residual.replace(/[A-Za-z_$][\w$]*\([^()]*\)/g, '');
  } while (residual !== prev);
  // Whatever string literals remain (ternary branches, plain {'…'}) are classes.
  for (const m of residual.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)) {
    pushTokens(m[1] ?? m[2], baseIndex + m.index, found);
  }
}

export function extractClassNames(src) {
  const found = [];
  const re = /className\s*=\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const i = re.lastIndex;
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(src, i);
      pushTokens(src.slice(i + 1, end), i + 1, found);
      re.lastIndex = end + 1;
    } else if (ch === '`') {
      const end = skipTemplate(src, i);
      collectTemplateStatics(src.slice(i + 1, end), i + 1, found);
      re.lastIndex = end + 1;
    } else if (ch === '{') {
      const end = scanBalanced(src, i);
      extractFromExpression(src.slice(i + 1, end), i + 1, found);
      re.lastIndex = end + 1;
    }
  }
  return found;
}

function parseRules(cssText) {
  const css = stripComments(cssText);
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().startsWith('@')) continue;
    rules.push({ selector: m[1], body: m[2] });
  }
  return rules;
}

function selectorClasses(selector) {
  return [...selector.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((m) => m[1]);
}

function selectorTargetsElement(selector, el) {
  return selector.split(',').some((part) => {
    let cleaned = part.replace(/\[[^\]]*\]/g, '');
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/::?[a-zA-Z-]+\([^()]*\)/g, '');
    } while (cleaned !== prev);
    cleaned = cleaned.replace(/::?[a-zA-Z-]+/g, '').replace(/[.#][\w-]+/g, '');
    return cleaned.split(/[\s>+~]+/).some((tok) => tok === el);
  });
}

function collectDefinedClasses(rules) {
  const defined = new Set();
  for (const rule of rules) {
    for (const cls of selectorClasses(rule.selector)) defined.add(cls);
  }
  return defined;
}

function checkControlBaseline(rules, errors) {
  const uiKitByElement = {
    input: 'ui-input',
    select: 'ui-select',
    textarea: 'ui-textarea',
    button: 'ui-btn',
  };
  for (const [el, cls] of Object.entries(uiKitByElement)) {
    const matching = rules.filter((r) => selectorClasses(r.selector).includes(cls));
    if (!matching.some((r) => /(^|;)\s*font(\s*|-family\s*|-size\s*):/.test(r.body))) {
      errors.push(`companion §16.6: no rule declares font for .${cls} (<${el}>)`);
    }
    if (el !== 'textarea' && !matching.some((r) => /(^|;)\s*(block-size|height)\s*:/.test(r.body))) {
      errors.push(`companion §16.6: no rule declares a block size for .${cls} (<${el}>)`);
    }
    if (el === 'textarea' && !matching.some((r) => /(^|;)\s*(block-size|min-block-size|height)\s*:/.test(r.body))) {
      errors.push(`companion §16.6: no rule declares a block size for .${cls} (<${el}>)`);
    }
  }
  const allCss = rules.map((r) => `${r.selector}{${r.body}}`).join('\n');
  if (!/:focus-visible/.test(allCss)) {
    errors.push('companion §16.7: no :focus-visible rule exists');
  }
  if (!/:disabled/.test(allCss)) {
    errors.push('companion §16.7: no :disabled rule exists');
  }
  const cardRule = rules.find(
    (r) =>
      selectorClasses(r.selector).includes('ui-card') ||
      selectorClasses(r.selector).includes('panel'),
  );
  if (!cardRule || !/(^|;)\s*border-radius\s*:/.test(cardRule.body)) {
    errors.push('companion §16.8: .ui-card / .panel does not declare border-radius');
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** @param {{ tsxByFile: Record<string, string>, cssByFile: Record<string, string> }} opts */
export function checkClassResolution({ tsxByFile, cssByFile }) {
  const errors = [];
  const rules = parseRules(Object.values(cssByFile).join('\n'));
  const defined = collectDefinedClasses(rules);

  let referenced = 0;
  for (const [rel, src] of Object.entries(tsxByFile)) {
    for (const { token, index } of extractClassNames(src)) {
      referenced += 1;
      if (defined.has(token) || RUNG_ALLOWLIST.has(token)) continue;
      errors.push(
        `${rel}:${lineOf(src, index)}: class "${token}" has no rule in the web-pms CSS`,
      );
    }
  }

  checkControlBaseline(rules, errors);

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      tsxCount: Object.keys(tsxByFile).length,
      referenced,
      definedCount: defined.size,
    },
  };
}

const COMPANION_OK_CSS = `
  .ui-input, .ui-select, .ui-textarea, .ui-btn { font: inherit; }
  .ui-input, .ui-select, .ui-btn { block-size: 2.25rem; }
  .ui-textarea { min-block-size: 4.5rem; }
  .ui-btn:focus-visible { outline: 2px solid blue; }
  .ui-btn:disabled { opacity: 0.55; }
  .ui-card { border-radius: 8px; }
`;

function selfTest() {
  let failed = false;
  const fail = (msg, detail) => {
    console.error(`self-test ${msg}`, detail ?? '');
    failed = true;
  };

  // S1 — an undefined class fails; a defined one does not.
  const s1 = checkClassResolution({
    tsxByFile: { 'a.tsx': `export const A = () => <div className="known-class missing-class" />;` },
    cssByFile: { 'fixture.css': `.known-class { color: blue; }\n${COMPANION_OK_CSS}` },
  });
  if (s1.ok || !s1.errors.some((e) => /missing-class/.test(e))) {
    fail('S1 FAILED: expected missing-class to be flagged', s1.errors);
  }
  if (s1.errors.some((e) => /known-class/.test(e))) {
    fail('S1 FAILED: known-class must not be flagged', s1.errors);
  }

  // S2 — template literals contribute static segments only.
  const s2 = checkClassResolution({
    tsxByFile: {
      'b.tsx': 'export const B = (sev) => <span className={`badge ${statusClass(sev)}`} />;',
    },
    cssByFile: { 'fixture.css': `.badge { color: blue; }\n${COMPANION_OK_CSS}` },
  });
  if (!s2.ok) fail('S2 FAILED: badge + interpolation must pass', s2.errors);

  // S3 — ternary branches are classes; function-call arguments are not.
  const s3 = checkClassResolution({
    tsxByFile: {
      'c.tsx': `
        export const C = (w) => (
          <table className={w.length > 50 ? 'content-visibility-auto' : undefined}>
            <tbody><tr><td className={statusClass(w.status === 'CLOSED' ? 'informational' : 'neutral')} /></tr></tbody>
          </table>
        );
      `,
    },
    cssByFile: { 'fixture.css': `.content-visibility-auto { color: blue; }\n${COMPANION_OK_CSS}` },
  });
  if (!s3.ok) fail('S3 FAILED: ternary branch defined, call args ignored', s3.errors);

  const s3b = checkClassResolution({
    tsxByFile: { 'c.tsx': `export const C = (x) => <table className={x ? 'never-defined' : undefined} />;` },
    cssByFile: { 'fixture.css': COMPANION_OK_CSS },
  });
  if (s3b.ok || !s3b.errors.some((e) => /never-defined/.test(e))) {
    fail('S3b FAILED: undefined ternary branch must be flagged', s3b.errors);
  }

  // S4 — the five status rungs are allowlisted (returned by statusClass()).
  const s4 = checkClassResolution({
    tsxByFile: { 'd.tsx': `export const D = () => <span className="status-attention" />;` },
    cssByFile: { 'fixture.css': COMPANION_OK_CSS },
  });
  if (!s4.ok) fail('S4 FAILED: allowlisted rung must pass', s4.errors);

  // S5 — companion assertions fire.
  const s5 = checkClassResolution({
    tsxByFile: { 'e.tsx': `export const E = () => <div className="panel" />;` },
    cssByFile: {
      'fixture.css': `
        input, select, textarea, button { font: inherit; }
        input, select, button { block-size: 2.25rem; }
        textarea { block-size: auto; }
        :disabled { opacity: 0.55; }
        .panel { border-radius: 8px; }
      `,
    },
  });
  if (s5.ok || !s5.errors.some((e) => /:focus-visible/.test(e))) {
    fail('S5 FAILED: missing :focus-visible must be flagged', s5.errors);
  }

  const s6 = checkClassResolution({
    tsxByFile: { 'f.tsx': `export const F = () => <div className="panel" />;` },
    cssByFile: {
      'fixture.css': `
        input, select, textarea, button { font: inherit; }
        input, select, button { block-size: 2.25rem; }
        textarea { block-size: auto; }
        button:focus-visible { outline: 2px solid blue; }
        :disabled { opacity: 0.55; }
        .panel { padding: 1rem; }
      `,
    },
  });
  if (s6.ok || !s6.errors.some((e) => /border-radius/.test(e))) {
    fail('S6 FAILED: .panel without border-radius must be flagged', s6.errors);
  }

  if (failed) process.exit(1);
  console.log('check:class-resolution --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const tsxFiles = tsxRoots
    .flatMap((dir) => walk(dir))
    .filter(
      (f) =>
        f.endsWith('.tsx') &&
        !f.endsWith('.test.tsx') &&
        (f.includes('apps/web-pms/') || f.includes('/src/ui/')),
    );
  const cssFiles = [
    ...walk(cssRoot).filter((f) => f.endsWith('.css')),
    join(root, 'packages/ui-kit/src/styles.css'),
  ];
  if (tsxFiles.length === 0 || cssFiles.length === 0) {
    console.error('No tsx or css files found');
    process.exit(1);
  }
  const tsxByFile = Object.fromEntries(
    tsxFiles.map((f) => [f.slice(root.length + 1), readFileSync(f, 'utf8')]),
  );
  const cssByFile = Object.fromEntries(
    cssFiles.map((f) => [f.slice(root.length + 1), readFileSync(f, 'utf8')]),
  );
  const result = checkClassResolution({ tsxByFile, cssByFile });
  for (const e of result.errors) console.error(e);
  if (!result.ok) process.exit(1);
  console.log(
    `OK class-resolution: ${result.stats.referenced} class references across ${result.stats.tsxCount} tsx files, ${result.stats.definedCount} classes defined`,
  );
}
