import { describe, expect, it } from 'vitest';
import { EntitlementRequiredError, parseFeatureValue, require } from './index.js';
import type { EntitlementSnapshot } from '@hospai/contracts';

describe('require', () => {
  const base: EntitlementSnapshot = {
    orgId: 'org_1',
    version: 1,
    features: { 'pms.core': true, 'pms.units.limit': 20 },
    limits: {},
    computedAt: '2026-01-01T00:00:00.000Z',
  };

  it('passes when pms.core is true', () => {
    expect(() => require(base, 'pms.core')).not.toThrow();
  });

  it('throws when pms.core is absent', () => {
    expect(() => require({ ...base, features: {} }, 'pms.core')).toThrow(EntitlementRequiredError);
  });

  it('parses feature values', () => {
    expect(parseFeatureValue('BOOLEAN', 'true')).toBe(true);
    expect(parseFeatureValue('LIMIT', '20')).toBe(20);
  });
});
