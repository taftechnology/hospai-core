import { describe, expect, it } from 'vitest';
import { permissionForForbidden } from '../src/permission-copy.js';

describe('permissionForForbidden', () => {
  it('returns body.permission', () => {
    expect(permissionForForbidden({ error: 'forbidden', permission: 'folio:adjust' })).toBe(
      'folio:adjust',
    );
  });

  it('returns null when body omits permission', () => {
    expect(permissionForForbidden({ error: 'forbidden' })).toBeNull();
  });
});
