import { describe, expect, it } from 'vitest';
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts/v1-http-routes';
import { permissionForForbidden } from '@hospai/client-core';
import {
  FOLIO_MUTATION_ROUTES,
  type FolioMutationRouteKey,
} from './folio-mutation-routes.js';

const EXPECTED: Record<FolioMutationRouteKey, { routeId: string; permission: string }> = {
  addCharge: { routeId: 'post_folio_lines', permission: 'folio:post' },
  cash: { routeId: 'post_cash_payment', permission: 'folio:post' },
  authorize: { routeId: 'post_folio_authorize', permission: 'folio:post' },
  capture: { routeId: 'post_folio_capture', permission: 'folio:post' },
  split: { routeId: 'post_folio_split', permission: 'folio:adjust' },
  splitPayment: { routeId: 'post_folio_split_payment', permission: 'folio:adjust' },
  checkOut: { routeId: 'post_reservation_check_out', permission: 'reservations:write' },
};

describe('FOLIO_MUTATION_ROUTES', () => {
  it.each(Object.keys(EXPECTED) as FolioMutationRouteKey[])(
    '%s maps to its own route id and permission',
    (key) => {
      const { routeId, permission } = EXPECTED[key];
      expect(FOLIO_MUTATION_ROUTES[key]).toBe(routeId);

      const row = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === routeId);
      expect(row).toBeTruthy();
      expect(row && 'permission' in row ? row.permission : null).toBe(permission);

      expect(permissionForForbidden({ error: 'forbidden' }, FOLIO_MUTATION_ROUTES[key])).toBe(
        permission,
      );
    },
  );
});
