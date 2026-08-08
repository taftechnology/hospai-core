/**
 * V1_HTTP_ROUTE_AUDIT ids passed to permissionForForbidden on 403.
 * Kept as a table so a typo fails the audit canary instead of degrading to generic copy.
 */
export const FOLIO_MUTATION_ROUTES = {
  addCharge: 'post_folio_lines',
  cash: 'post_cash_payment',
  authorize: 'post_folio_authorize',
  capture: 'post_folio_capture',
  split: 'post_folio_split',
  splitPayment: 'post_folio_split_payment',
  checkOut: 'post_reservation_check_out',
} as const;

export type FolioMutationRouteKey = keyof typeof FOLIO_MUTATION_ROUTES;
