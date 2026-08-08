import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTITLEMENT_REQUIRED } from './entitlements.js';
import { RESERVATION_STATUSES } from './reservation-status.js';
import { V1_HTTP_ROUTE_AUDIT } from './v1-http-routes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('browser-safe subpath exports', () => {
  it('package.json declares SPA-safe export paths', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports['./v1-http-routes']).toBeTruthy();
    expect(pkg.exports['./entitlements']).toBeTruthy();
    expect(pkg.exports['./provisional-command']).toBeTruthy();
    expect(pkg.exports['./reservation-status']).toBeTruthy();
  });

  it('v1-http-routes module graph stays free of config/register', () => {
    expect(V1_HTTP_ROUTE_AUDIT.length).toBeGreaterThanOrEqual(68);
    expect(V1_HTTP_ROUTE_AUDIT.some((r) => r.id === 'get_front_desk_arrivals')).toBe(true);
    expect(ENTITLEMENT_REQUIRED).toBe('entitlement_required');
    expect(RESERVATION_STATUSES).toContain('confirmed');

    const routesSrc = readFileSync(join(root, 'src/v1-http-routes.ts'), 'utf8');
    const entitlementsSrc = readFileSync(join(root, 'src/entitlements.ts'), 'utf8');
    const provisionalSrc = readFileSync(join(root, 'src/provisional-command.ts'), 'utf8');
    const reservationSrc = readFileSync(join(root, 'src/reservation-status.ts'), 'utf8');
    for (const src of [routesSrc, entitlementsSrc, provisionalSrc, reservationSrc]) {
      expect(src).not.toMatch(/config\/register/);
      expect(src).not.toMatch(/\bfrom ['"]zod['"]/);
    }
  });
});
