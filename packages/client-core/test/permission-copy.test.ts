import { describe, expect, it } from 'vitest';
import { permissionForForbidden } from '../src/permission-copy.js';

describe('permissionForForbidden', () => {
  it('prefers body.permission', () => {
    expect(
      permissionForForbidden({ error: 'forbidden', permission: 'folio:adjust' }, 'post_folio_split'),
    ).toBe('folio:adjust');
  });

  it('falls back to V1_HTTP_ROUTE_AUDIT when body omits permission', () => {
    expect(permissionForForbidden({ error: 'forbidden' }, 'post_folio_split')).toBe('folio:adjust');
  });

  it('returns null when neither body nor audit has permission', () => {
    expect(permissionForForbidden({ error: 'forbidden' }, 'post_orgs')).toBeNull();
  });
});
