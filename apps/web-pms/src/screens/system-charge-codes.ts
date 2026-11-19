/**
 * Codes the property writes itself. Same list as do-runtime `SYSTEM_CHARGE_CODES`.
 * web-pms does not import do-runtime.
 */
export const SYSTEM_CHARGE_CODES = new Set([
  'ROOM',
  'PAYMENT',
  'CANCEL',
  'NO_SHOW',
  'DISCOUNT',
  'DAMAGE',
  'FX_GAIN',
  'FX_LOSS',
  'CHARGEBACK_FEE',
]);
