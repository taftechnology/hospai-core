import type { ModuleSql } from '@hospai/contracts';
import {
  ChargeCodeNotPostableError,
  ProductInvalidAmountError,
  ProductValidationError,
} from './errors.js';

export const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PRODUCT_SKU_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const PRODUCT_NAME_MAX = 80;
export const MAX_PRODUCT_CATEGORIES = 200;
export const MAX_PRODUCT_ITEMS = 2000;
export const MAX_PRODUCT_AMOUNT_MINOR = 100_000_000;
export const MAX_SORT_ORDER = 10_000;

export type ProductStatus = 'active' | 'archived';

export function requireProductId(raw: unknown): string {
  if (typeof raw !== 'string' || !PRODUCT_ID_RE.test(raw)) throw new ProductValidationError();
  return raw;
}

export function requireName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ProductValidationError();
  const name = raw.trim();
  if (name.length < 1 || name.length > PRODUCT_NAME_MAX) throw new ProductValidationError();
  return name;
}

/** `undefined` / `null` / blank → no SKU. */
export function optionalSku(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ProductValidationError();
  const sku = raw.trim();
  if (sku.length === 0) return null;
  if (!PRODUCT_SKU_RE.test(sku)) throw new ProductValidationError();
  return sku;
}

export function requireAmountMinor(raw: unknown): number {
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > MAX_PRODUCT_AMOUNT_MINOR
  ) {
    throw new ProductInvalidAmountError();
  }
  return raw;
}

export function requireSortOrder(raw: unknown): number {
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < -MAX_SORT_ORDER ||
    raw > MAX_SORT_ORDER
  ) {
    throw new ProductValidationError();
  }
  return raw;
}

export function requireStatus(raw: unknown): ProductStatus {
  if (raw !== 'active' && raw !== 'archived') throw new ProductValidationError();
  return raw;
}

export type ChargeCodeStanding = {
  /** Exists, active, operator-postable (not a system or tax-output code). */
  postable: boolean;
  taxGroup: string | null;
};

/**
 * Whether an operator may post this code as a product (spec §2.4): it exists,
 * is active, is not a DO-written system code and is not any tax rule's output.
 */
export function chargeCodeStanding(
  sql: ModuleSql,
  code: string,
  systemChargeCodes: readonly string[],
): ChargeCodeStanding {
  const rows = sql
    .exec(`SELECT status, tax_group FROM charge_code WHERE code = ?`, code)
    .toArray() as Array<{ status: string; tax_group: string | null }>;
  const row = rows[0];
  if (!row) return { postable: false, taxGroup: null };
  if (row.status !== 'active' || systemChargeCodes.includes(code)) {
    return { postable: false, taxGroup: row.tax_group };
  }
  const output = sql
    .exec(`SELECT 1 AS hit FROM tax_rule WHERE output_charge_code = ? LIMIT 1`, code)
    .toArray();
  return { postable: output.length === 0, taxGroup: row.tax_group };
}

export function requirePostableChargeCode(
  sql: ModuleSql,
  raw: unknown,
  systemChargeCodes: readonly string[],
): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new ProductValidationError();
  if (!chargeCodeStanding(sql, raw, systemChargeCodes).postable) {
    throw new ChargeCodeNotPostableError();
  }
  return raw;
}
