import type { ModuleSql } from '@hospai/contracts';
import { chargeCodeStanding, type ProductStatus } from '../domain/validation.js';
import { toItemRecord, type ProductItemRecord } from './items.js';
import type { ProductCategory } from './categories.js';

export type ProductItem = ProductItemRecord & {
  /** The charge code's `tax_group` (spec §2.3) — read-only, never stored on the product. */
  taxGroup: string | null;
  /** Active, in an active category, on an operator-postable charge code. */
  postable: boolean;
};

export type ProductsRead = {
  ok: true;
  categories: ProductCategory[];
  items: ProductItem[];
};

/**
 * One bounded list (≤ 200 categories, ≤ 2,000 items). `status: 'active'` returns
 * active rows only; `'all'` includes archived rows for Settings.
 */
export function readProducts(
  sql: ModuleSql,
  filters: { status: 'active' | 'all'; systemChargeCodes: readonly string[] },
): ProductsRead {
  const where = filters.status === 'active' ? `WHERE status = 'active'` : '';
  const categoryRows = sql
    .exec(`SELECT * FROM products_category ${where} ORDER BY sort_order, name, category_id`)
    .toArray() as Array<{
    category_id: string;
    name: string;
    sort_order: number;
    status: ProductStatus;
    created_at: number;
    updated_at: number;
  }>;
  const allCategories = sql
    .exec(`SELECT category_id, status FROM products_category`)
    .toArray() as Array<{ category_id: string; status: string }>;
  const activeCategory = new Set(
    allCategories.filter((c) => c.status === 'active').map((c) => c.category_id),
  );
  const itemRows = sql
    .exec(`SELECT * FROM products_item ${where} ORDER BY name, product_id`)
    .toArray() as Parameters<typeof toItemRecord>[0][];

  const standing = new Map<string, ReturnType<typeof chargeCodeStanding>>();
  const items = itemRows.map((row) => {
    const record = toItemRecord(row);
    let s = standing.get(record.chargeCode);
    if (!s) {
      s = chargeCodeStanding(sql, record.chargeCode, filters.systemChargeCodes);
      standing.set(record.chargeCode, s);
    }
    return {
      ...record,
      taxGroup: s.taxGroup,
      postable: record.status === 'active' && activeCategory.has(record.categoryId) && s.postable,
    };
  });

  return {
    ok: true,
    categories: categoryRows.map((r) => ({
      categoryId: r.category_id,
      name: r.name,
      sortOrder: r.sort_order,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    items,
  };
}
