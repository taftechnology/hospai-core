import { describe, expect, it } from 'vitest';
import { defineModule } from './define-module.js';

describe('defineModule', () => {
  it('rejects missing writes', () => {
    expect(() =>
      defineModule({
        id: 'pms.housekeeping',
        version: '0.0.1',
        entitlement: 'pms.core',
        schema: { tables: ['housekeeping_assignment'] },
      } as never),
    ).toThrow();
  });

  it('accepts a valid housekeeping-shaped manifest', () => {
    const mod = defineModule({
      id: 'pms.housekeeping',
      version: '0.0.1',
      entitlement: 'pms.core',
      schema: { prefix: null, tables: ['housekeeping_assignment'] },
      writes: ['room', 'housekeeping_assignment'],
    });
    expect(mod.id).toBe('pms.housekeeping');
    expect(mod.writes).toEqual(['room', 'housekeeping_assignment']);
  });
});
