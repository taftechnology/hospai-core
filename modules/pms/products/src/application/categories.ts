import type { ModuleTxnCtx } from '@hospai/contracts';
import {
  ProductCategoryExistsError,
  ProductCategoryNotFoundError,
  ProductLimitExceededError,
  ProductValidationError,
} from '../domain/errors.js';
import {
  MAX_PRODUCT_CATEGORIES,
  requireName,
  requireProductId,
  requireSortOrder,
  requireStatus,
  type ProductStatus,
} from '../domain/validation.js';

export type ProductCategory = {
  categoryId: string;
  name: string;
  sortOrder: number;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
};

type CategoryRow = {
  category_id: string;
  name: string;
  sort_order: number;
  status: ProductStatus;
  created_at: number;
  updated_at: number;
};

function toCategory(r: CategoryRow): ProductCategory {
  return {
    categoryId: r.category_id,
    name: r.name,
    sortOrder: r.sort_order,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function loadCategory(ctx: ModuleTxnCtx, categoryId: string): ProductCategory | null {
  const rows = ctx.sql
    .exec(`SELECT * FROM products_category WHERE category_id = ?`, categoryId)
    .toArray() as CategoryRow[];
  return rows[0] ? toCategory(rows[0]) : null;
}

function emitChanged(ctx: ModuleTxnCtx, id: string, op: 'create' | 'update', at: number) {
  ctx.appendOutbox({
    eventId: crypto.randomUUID(),
    eventType: 'products.changed',
    payload: { propertyId: ctx.propertyId, entity: 'category', id, op, at },
  });
}

export type CreateCategoryInput = { categoryId: string; name: string; sortOrder?: number };

export function createProductCategory(
  ctx: ModuleTxnCtx,
  input: CreateCategoryInput,
): { ok: true; category: ProductCategory } {
  const categoryId = requireProductId(input.categoryId);
  const name = requireName(input.name);
  const sortOrder = input.sortOrder === undefined ? 0 : requireSortOrder(input.sortOrder);
  if (loadCategory(ctx, categoryId)) throw new ProductCategoryExistsError();
  const count = ctx.sql
    .exec(`SELECT COUNT(*) AS n FROM products_category`)
    .toArray() as Array<{ n: number }>;
  if ((count[0]?.n ?? 0) >= MAX_PRODUCT_CATEGORIES) throw new ProductLimitExceededError();
  const now = Date.now();
  ctx.sql.exec(
    `INSERT INTO products_category (category_id, name, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    categoryId,
    name,
    sortOrder,
    now,
    now,
  );
  emitChanged(ctx, categoryId, 'create', now);
  return { ok: true, category: loadCategory(ctx, categoryId)! };
}

export type UpdateCategoryInput = {
  categoryId: string;
  name?: string;
  sortOrder?: number;
  status?: ProductStatus;
};

export function updateProductCategory(
  ctx: ModuleTxnCtx,
  input: UpdateCategoryInput,
): { ok: true; before: ProductCategory; category: ProductCategory } {
  const categoryId = requireProductId(input.categoryId);
  const before = loadCategory(ctx, categoryId);
  if (!before) throw new ProductCategoryNotFoundError();
  const name = input.name === undefined ? before.name : requireName(input.name);
  const sortOrder =
    input.sortOrder === undefined ? before.sortOrder : requireSortOrder(input.sortOrder);
  const status = input.status === undefined ? before.status : requireStatus(input.status);
  if (input.name === undefined && input.sortOrder === undefined && input.status === undefined) {
    throw new ProductValidationError();
  }
  const now = Date.now();
  ctx.sql.exec(
    `UPDATE products_category SET name = ?, sort_order = ?, status = ?, updated_at = ?
     WHERE category_id = ?`,
    name,
    sortOrder,
    status,
    now,
    categoryId,
  );
  emitChanged(ctx, categoryId, 'update', now);
  return { ok: true, before, category: loadCategory(ctx, categoryId)! };
}
