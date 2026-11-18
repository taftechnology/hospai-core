import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * R3.1 — every config key a Settings screen shows must be read by pms-core.
 * A control that saves a key nothing reads is a toggle that changes nothing (AGENTS.md §2):
 * wire it in pms-core or hide it. This scans source text, so a read is any appearance of the
 * quoted key in pms-core, its modules or do-runtime outside the register and tests.
 */
function sources(dir: string, test: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') sources(path, test, out);
    } else if (test(path)) out.push(path);
  }
  return out;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const isProd = (path: string) =>
  /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path) && !path.includes('/test/');

function settingsKeys(): Map<string, string> {
  const screens = fileURLToPath(new URL('./screens/', import.meta.url));
  const files = sources(screens, (p) => isProd(p) && /\/(settings-[^/]+|SettingsScreen)\.tsx$/.test(p));
  const keys = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/configKey="(pms\.[a-z_.]+)"/g)) keys.set(m[1]!, file);
  }
  return keys;
}

function readerText(): string {
  const dirs = [
    join(root, 'apps/pms-core/src'),
    join(root, 'packages/do-runtime/src'),
    ...readdirSync(join(root, 'modules/pms')).map((m) => join(root, 'modules/pms', m, 'src')),
  ];
  return dirs
    .flatMap((d) => sources(d, isProd))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

describe('R3.1 Settings controls map to keys pms-core reads', () => {
  it('finds the Settings controls', () => {
    expect(settingsKeys().size).toBeGreaterThan(20);
  });

  it('every visible config key has a pms-core reader', () => {
    const text = readerText();
    const unread = [...settingsKeys().keys()].filter((key) => !text.includes(`'${key}'`));
    expect(unread).toEqual([]);
  });
});
