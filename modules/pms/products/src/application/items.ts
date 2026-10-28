import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  ProductCategoryNotFoundError,
  ProductExistsError,
  ProductLimitExceededError,
  ProductNotFoundError,
  ProductSkuTakenError,
  ProductValidationError,
} from '../domain/errors.js';
import {
  MAX_PRODUCT_ITEMS,
  optionalSku,
  requireAmountMinor,
  requireName,
  requirePostableChargeCode,
  requireProductId,
  requireStatus,
  type ProductStatus,
} from '../domain/validation.js';

export type ProductItemRecord = {
  productId: string;
  categoryId: string;
  sku: string | null;
  name: string;
  chargeCode: string;
  defaultAmountMinor: number;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
};

type ItemRow = {
  product_id: string;
  category_id: string;
  sku: string | null;
  name: string;
  charge_code: string;
  default_amount_minor: number;
  status: ProductStatus;
  created_at: number;
  updated_at: number;
};

export function toItemRecord(r: ItemRow): ProductItemRecord {
  return {
    productId: r.product_id,
    categoryId: r.category_id,
    sku: r.sku,
    name: r.name,
    chargeCode: r.charge_code,
    defaultAmountMinor: r.default_amount_minor,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function loadItem(ctx: ModuleTxnCtx, productId: string): ProductItemRecord | null {
  const rows = ctx.sql
    .exec(`SELECT * FROM products_item WHERE product_id = ?`, productId)
    .toArray() as ItemRow[];
  return rows[0] ? toItemRecord(rows[0]) : null;
}

function requireActiveCategory(ctx: ModuleTxnCtx, raw: unknown): string {
  const categoryId = requireProductId(raw);
  const rows = ctx.sql
    .exec(`SELECT status FROM products_category WHERE category_id = ?`, categoryId)
    .toArray() as Array<{ status: string }>;
  if (!rows[0] || rows[0].status !== 'active') throw new ProductCategoryNotFoundError();
  return categoryId;
}

function assertSkuFree(ctx: ModuleTxnCtx, sku: string | null, selfId: string) {
  if (sku === null) return;
  const rows = ctx.sql
    .exec(`SELECT product_id FROM products_item WHERE sku = ?`, sku)
    .toArray() as Array<{ product_id: string }>;
  if (rows.some((r) => r.product_id !== selfId)) throw new ProductSkuTakenError();
}

function emitChanged(ctx: ModuleTxnCtx, id: string, op: 'create' | 'update', at: number) {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'products.changed',
    payload: { propertyId: ctx.propertyId, entity: 'item', id, op, at },
  });
}

export type ProductWriteOptions = {
  /** do-runtime `SYSTEM_CHARGE_CODES`, passed by PropertyDO (the module does not import do-runtime). */
  systemChargeCodes: readonly string[];
};

export type CreateItemInput = {
  productId: string;
  categoryId: string;
  name: string;
  sku?: string | null;
  chargeCode: string;
  defaultAmountMinor: number;
};

export function createProductItem(
  ctx: ModuleTxnCtx,
  input: CreateItemInput,
  opts: ProductWriteOptions,
): { ok: true; item: ProductItemRecord } {
  const productId = requireProductId(input.productId);
  const name = requireName(input.name);
  const sku = optionalSku(input.sku);
  const defaultAmountMinor = requireAmountMinor(input.defaultAmountMinor);
  if (loadItem(ctx, productId)) throw new ProductExistsError();
  const categoryId = requireActiveCategory(ctx, input.categoryId);
  const chargeCode = requirePostableChargeCode(ctx.sql, input.chargeCode, opts.systemChargeCodes);
  assertSkuFree(ctx, sku, productId);
  const count = ctx.sql
    .exec(`SELECT COUNT(*) AS n FROM products_item`)
    .toArray() as Array<{ n: number }>;
  if ((count[0]?.n ?? 0) >= MAX_PRODUCT_ITEMS) throw new ProductLimitExceededError();
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO products_item
       (product_id, category_id, sku, name, charge_code, default_amount_minor, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    productId,
    categoryId,
    sku,
    name,
    chargeCode,
    defaultAmountMinor,
    now,
    now,
  );
  emitChanged(ctx, productId, 'create', now);
  return { ok: true, item: loadItem(ctx, productId)! };
}

export type UpdateItemInput = {
  productId: string;
  categoryId?: string;
  name?: string;
  sku?: string | null;
  chargeCode?: string;
  defaultAmountMinor?: number;
  status?: ProductStatus;
};

export function updateProductItem(
  ctx: ModuleTxnCtx,
  input: UpdateItemInput,
  opts: ProductWriteOptions,
): { ok: true; before: ProductItemRecord; item: ProductItemRecord } {
  const productId = requireProductId(input.productId);
  const before = loadItem(ctx, productId);
  if (!before) throw new ProductNotFoundError();
  const fields = ['categoryId', 'name', 'sku', 'chargeCode', 'defaultAmountMinor', 'status'] as const;
  if (!fields.some((f) => input[f] !== undefined)) throw new ProductValidationError();
  const name = input.name === undefined ? before.name : requireName(input.name);
  const sku = input.sku === undefined ? before.sku : optionalSku(input.sku);
  const defaultAmountMinor =
    input.defaultAmountMinor === undefined
      ? before.defaultAmountMinor
      : requireAmountMinor(input.defaultAmountMinor);
  const status = input.status === undefined ? before.status : requireStatus(input.status);
  const categoryId =
    input.categoryId === undefined || input.categoryId === before.categoryId
      ? before.categoryId
      : requireActiveCategory(ctx, input.categoryId);
  const chargeCode =
    input.chargeCode === undefined || input.chargeCode === before.chargeCode
      ? before.chargeCode
      : requirePostableChargeCode(ctx.sql, input.chargeCode, opts.systemChargeCodes);
  assertSkuFree(ctx, sku, productId);
  const now = Date.now();
  ctx.sql.exec(
    `UPDATE products_item
        SET category_id = ?, sku = ?, name = ?, charge_code = ?, default_amount_minor = ?,
            status = ?, updated_at = ?
      WHERE product_id = ?`,
    categoryId,
    sku,
    name,
    chargeCode,
    defaultAmountMinor,
    status,
    now,
    productId,
  );
  emitChanged(ctx, productId, 'update', now);
  return { ok: true, before, item: loadItem(ctx, productId)! };
}
