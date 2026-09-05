#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TARGET = join(ROOT, 'apps/pms-core/src/v1-dispatch.ts');
const src = readFileSync(TARGET, 'utf8');
const lines = src.split('\n');
const violations = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Handler call sites: two args only — not the function definition (prefetched? param).
  if (
    line.includes('resolvePropertyContext(ctx, propertyId)') &&
    !line.includes('ctx.tenantProperty') &&
    !line.includes('prefetched?')
  ) {
    violations.push({ line: i + 1, text: line.trim() });
  }
}

if (violations.length > 0) {
  console.error(`check-resolve-property-prefetch: ${violations.length} two-arg handler call site(s):`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  v1-dispatch.ts:${v.line}: ${v.text}`);
  }
  if (violations.length > 20) {
    console.error(`  … and ${violations.length - 20} more`);
  }
  process.exit(1);
}
console.log('check-resolve-property-prefetch: ok');
