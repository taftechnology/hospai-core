import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const BANNED = [
  'SignIn', 'SignUp', 'SignedIn', 'SignedOut', 'UserButton', 'UserProfile', 'UserAvatar',
  'OrganizationSwitcher', 'OrganizationProfile', 'OrganizationList', 'CreateOrganization',
  'Waitlist', 'GoogleOneTap', 'PricingTable', 'APIKeys',
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('no Clerk prebuilt UI in the Ops Console', () => {
  it('imports none of the prebuilt components from @clerk/*', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@clerk\/[^'"]*['"]/g)) {
        const names = (m[1] ?? '').split(',').map((n) => (n.trim().split(/\s+as\s+/)[0] ?? '').replace(/^type\s+/, ''));
        for (const n of names) if (BANNED.includes(n)) offenders.push(`${file}: ${n}`);
      }
    }
    expect(
      offenders,
      'Clerk prebuilt components inject inline <style> tags, which the console CSP (no style-src unsafe-inline) blocks, ' +
        'so they render unstyled. Build the UI with ui-kit and the headless hooks instead (see auth/ConsoleSignIn.tsx).',
    ).toEqual([]);
  });
});
