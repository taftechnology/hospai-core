#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TARGET = join(ROOT, 'apps/pms-core/src/v1-dispatch.ts');
const src = readFileSync(TARGET, 'utf8');
const forbidden = [
  'mapReservationCommandErrorStatus',
  'mapGuestCommandErrorStatus',
  'mapPersonEntityCommandErrorStatus',
  'mapConfigErrorStatus',
  'mapPaymentCommandErrorStatus',
  'function mapCommandErrorStatus',
];
for (const name of forbidden) {
  if (src.includes(name)) {
    console.error(`Forbidden revived mapper: ${name} in v1-dispatch.ts`);
    process.exit(1);
  }
}
console.log('check-error-mapper-singleton: ok');
