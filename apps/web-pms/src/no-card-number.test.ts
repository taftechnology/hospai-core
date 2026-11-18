import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function tsxSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      tsxSources(path, out);
      continue;
    }
    if (path.endsWith('.tsx') && !path.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

/**
 * "Card last 4" / last4 is a display token and must stay legal.
 * The label scan is the phrase "card number", not a bare "card".
 */
const LABEL_VALUE =
  /(?:\blabel|\bplaceholder|\baria-label)\s*=\s*(?:\{)?["'`]([^"'`]*)["'`]/gi;
const PAN_LABEL = /card number|cvv|cvc|security code|expiry/i;

describe('web-pms has no card-number fields', () => {
  it('no PAN, CVV, or expiry inputs in screen sources', () => {
    const root = fileURLToPath(new URL('./', import.meta.url));
    const files = tsxSources(root);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/cc-number|cc-csc|cc-exp|autoComplete="cc-|autoComplete='cc-|autoComplete=\{"cc-|autoComplete=\{'cc-/.test(src)) {
        hits.push(`${file}: autocomplete card field`);
      }
      for (const match of src.matchAll(LABEL_VALUE)) {
        const value = match[1] ?? '';
        if (PAN_LABEL.test(value)) hits.push(`${file}: ${value}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
