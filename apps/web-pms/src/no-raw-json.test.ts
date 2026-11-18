import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function tsxSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
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

describe('operator UI has no raw JSON dumps', () => {
  it('no <pre in web-pms or pms module UI sources', () => {
    const webPms = fileURLToPath(new URL('./', import.meta.url));
    const modulesRoot = fileURLToPath(new URL('../../../modules/pms', import.meta.url));
    const files = tsxSources(webPms);
    if (existsSync(modulesRoot)) {
      for (const name of readdirSync(modulesRoot)) {
        tsxSources(join(modulesRoot, name, 'src', 'ui'), files);
      }
    }
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter((file) => readFileSync(file, 'utf8').includes('<pre'));
    expect(hits).toEqual([]);
  });
});
