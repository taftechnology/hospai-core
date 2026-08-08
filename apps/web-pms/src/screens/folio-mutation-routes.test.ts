import { describe, expect, it } from 'vitest';
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts/v1-http-routes';
import { permissionForForbidden } from '@hospai/client-core';
import { FOLIO_MUTATION_ROUTES } from './folio-mutation-routes.js';

const EXPECTED: Record<(typeof FOLIO_MUTATION_ROUTES)[keyof typeof FOLIO_MUTATION_ROUTES], string> =
  {
    post_folio_lines: 'folio:post',
    post_cash_payment: 'folio:post',
    post_folio_authorize: 'folio:post',
    post_folio_capture: 'folio:post',
    post_folio_split: 'folio:adjust',
    post_folio_split_payment: 'folio:adjust',
    post_reservation_check_out: 'reservations:write',
  };

describe('FOLIO_MUTATION_ROUTES', () => {
  it.each(Object.entries(FOLIO_MUTATION_ROUTES) as Array<[string, string]>)(
    '%s → audit permission matches expected',
    (_key, routeId) => {
      const row = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === routeId);
      expect(row).toBeTruthy();
      expect(row && 'permission' in row ? row.permission : null).toBe(EXPECTED[routeId as keyof typeof EXPECTED]);
      expect(permissionForForbidden({ error: 'forbidden' }, routeId)).toBe(
        EXPECTED[routeId as keyof typeof EXPECTED],
      );
    },
  );
});
