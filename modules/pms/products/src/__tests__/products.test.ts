import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS, SYSTEM_CHARGE_CODES } from '@hospai/do-runtime';
import type { ModuleSql, ModuleTxnCtx } from '@hospai/contracts';
import manifest, {
  createProductCategory,
  createProductItem,
  readProducts,
  updateProductCategory,
  updateProductItem,
} from '../index.js';

const opts = { systemChargeCodes: SYSTEM_CHARGE_CODES };

function sqliteModuleSql(db: DatabaseSync): ModuleSql {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const stmt = db.prepare(query);
      const params = bindings as Array<string | number | null>;
      if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) as unknown[] };
      stmt.run(...params);
      return { toArray: () => [] };
    },
  };
}

let db: DatabaseSync;
let ctx: ModuleTxnCtx;
let events: Array<{ eventType: string; payload: Record<string, unknown> }>;

function seedChargeCode(code: string, taxGroup: string | null, status = 'active') {
  db.prepare(
    `INSERT INTO charge_code (code, name, status, created_at, updated_at, tax_group)
     VALUES (?, ?, ?, 1, 1, ?)
     ON CONFLICT(code) DO UPDATE SET status = excluded.status, tax_group = excluded.tax_group`,
  ).run(code, code, status, taxGroup);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of PROPERTY_MIGRATIONS) for (const s of m.statements) db.exec(s);
  for (const code of SYSTEM_CHARGE_CODES) seedChargeCode(code, null);
  seedChargeCode('MINIBAR', 'GOODS');
  seedChargeCode('LAUNDRY', 'SERVICES');
  seedChargeCode('TAX', null);
  seedChargeCode('OLDCODE', 'GOODS', 'archived');
  db.prepare(
    `INSERT INTO tax_rule
       (tax_rule_id, rule_key, name, rule_type, rate, tax_group, output_charge_code, valid_from, created_at, updated_at)
     VALUES ('tr1', 'gst', 'GST', 'PERCENTAGE', '0.05', 'GOODS', 'TAX', '2026-01-01', 1, 1)`,
  ).run();
  events = [];
  ctx = {
    sql: sqliteModuleSql(db),
    appendOutbox: (evt) => events.push({ eventType: evt.eventType, payload: evt.payload }),
    orgId: 'org_1',
    propertyId: 'prop_1',
  };
});

function seedCategory(categoryId = 'cat_minibar', name = 'Minibar') {
  return createProductCategory(ctx, { categoryId, name });
}

function seedItem(overrides: Partial<Parameters<typeof createProductItem>[1]> = {}) {
  return createProductItem(
    ctx,
    {
      productId: 'prod_water',
      categoryId: 'cat_minibar',
      name: 'Water 500ml',
      sku: 'MB-WATER',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      ...overrides,
    },
    opts,
  );
}

describe('products manifest', () => {
  it('declares the products tables and the products.changed event', () => {
    expect(manifest.id).toBe('pms.products');
    expect(manifest.schema.tables).toEqual(['products_category', 'products_item']);
    expect(manifest.writes).toEqual(['products_category', 'products_item']);
    expect(manifest.publishes).toEqual(['products.changed']);
  });
});

describe('categories', () => {
  it('creates, renames and archives a category and emits products.changed', () => {
    const created = seedCategory();
    expect(created.category).toMatchObject({ categoryId: 'cat_minibar', name: 'Minibar', status: 'active' });
    const updated = updateProductCategory(ctx, {
      categoryId: 'cat_minibar',
      name: '  Mini bar ',
      status: 'archived',
    });
    expect(updated.before.name).toBe('Minibar');
    expect(updated.category).toMatchObject({ name: 'Mini bar', status: 'archived' });
    expect(events.map((e) => e.payload.op)).toEqual(['create', 'update']);
    expect(events[0]!.eventType).toBe('products.changed');
    expect(events[0]!.payload).toMatchObject({ propertyId: 'prop_1', entity: 'category' });
  });

  it('first writer wins: a second create on the same id is category_exists', () => {
    seedCategory();
    expect(() => seedCategory('cat_minibar', 'Other')).toThrow('category_exists');
  });

  it('rejects a bad id, a blank name and an empty update', () => {
    expect(() => createProductCategory(ctx, { categoryId: 'bad id', name: 'X' })).toThrow(
      'validation_error',
    );
    expect(() => createProductCategory(ctx, { categoryId: 'c1', name: '   ' })).toThrow(
      'validation_error',
    );
    seedCategory();
    expect(() => updateProductCategory(ctx, { categoryId: 'cat_minibar' })).toThrow(
      'validation_error',
    );
    expect(() => updateProductCategory(ctx, { categoryId: 'nope', name: 'X' })).toThrow(
      'category_not_found',
    );
  });

  it('caps categories at 200', () => {
    for (let i = 0; i < 200; i++) createProductCategory(ctx, { categoryId: `c${i}`, name: `C${i}` });
    expect(() => createProductCategory(ctx, { categoryId: 'c200', name: 'One too many' })).toThrow(
      'limit_exceeded',
    );
  });
});

describe('items', () => {
  beforeEach(() => {
    seedCategory();
  });

  it('creates an item in integer minor units', () => {
    const { item } = seedItem();
    expect(item).toMatchObject({
      productId: 'prod_water',
      categoryId: 'cat_minibar',
      sku: 'MB-WATER',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      status: 'active',
    });
    expect(events.at(-1)!.payload).toMatchObject({ entity: 'item', id: 'prod_water', op: 'create' });
  });

  it('rejects system codes, tax-output codes, archived and unknown codes as not postable', () => {
    for (const code of ['ROOM', 'PAYMENT', 'DAMAGE', 'TAX', 'OLDCODE', 'MISSING']) {
      expect(() => seedItem({ productId: `p_${code}`, sku: null, chargeCode: code })).toThrow(
        'charge_code_not_postable',
      );
    }
  });

  it('rejects amounts that are negative, fractional or above the cap', () => {
    for (const amount of [-1, 12.5, 100_000_001, Number.NaN]) {
      expect(() => seedItem({ defaultAmountMinor: amount })).toThrow('invalid_amount');
    }
    expect(seedItem({ defaultAmountMinor: 0 }).item.defaultAmountMinor).toBe(0);
  });

  it('first writer wins on product id; SKU is unique per property', () => {
    seedItem();
    expect(() => seedItem({ sku: 'OTHER' })).toThrow('product_exists');
    expect(() => seedItem({ productId: 'prod_juice', name: 'Juice' })).toThrow('sku_taken');
    expect(seedItem({ productId: 'prod_juice', name: 'Juice', sku: '' }).item.sku).toBeNull();
  });

  it('needs an active category', () => {
    expect(() => seedItem({ categoryId: 'nope' })).toThrow('category_not_found');
    updateProductCategory(ctx, { categoryId: 'cat_minibar', status: 'archived' });
    expect(() => seedItem()).toThrow('category_not_found');
  });

  it('updates fields, keeps unchanged ones, and archives', () => {
    seedItem();
    seedCategory('cat_laundry', 'Laundry');
    const r = updateProductItem(
      ctx,
      {
        productId: 'prod_water',
        categoryId: 'cat_laundry',
        chargeCode: 'LAUNDRY',
        defaultAmountMinor: 4500,
      },
      opts,
    );
    expect(r.before.defaultAmountMinor).toBe(4000);
    expect(r.item).toMatchObject({
      categoryId: 'cat_laundry',
      chargeCode: 'LAUNDRY',
      defaultAmountMinor: 4500,
      sku: 'MB-WATER',
      name: 'Water 500ml',
    });
    expect(
      updateProductItem(ctx, { productId: 'prod_water', status: 'archived' }, opts).item.status,
    ).toBe('archived');
    expect(() => updateProductItem(ctx, { productId: 'prod_water' }, opts)).toThrow(
      'validation_error',
    );
    expect(() =>
      updateProductItem(ctx, { productId: 'prod_water', chargeCode: 'ROOM' }, opts),
    ).toThrow('charge_code_not_postable');
    expect(() => updateProductItem(ctx, { productId: 'nope', name: 'X' }, opts)).toThrow(
      'product_not_found',
    );
  });
});

describe('readProducts', () => {
  beforeEach(() => {
    seedCategory();
    seedItem();
  });

  it('returns the charge code tax group read-only and marks postable items', () => {
    const r = readProducts(ctx.sql, { status: 'active', ...opts });
    expect(r.categories.map((c) => c.categoryId)).toEqual(['cat_minibar']);
    expect(r.items[0]).toMatchObject({ productId: 'prod_water', taxGroup: 'GOODS', postable: true });
  });

  it('marks an item unpostable when its charge code is archived later', () => {
    db.prepare(`UPDATE charge_code SET status = 'archived' WHERE code = 'MINIBAR'`).run();
    const r = readProducts(ctx.sql, { status: 'active', ...opts });
    expect(r.items[0]!.postable).toBe(false);
  });

  it('active hides archived rows and unpostable-by-category items; all shows them', () => {
    updateProductCategory(ctx, { categoryId: 'cat_minibar', status: 'archived' });
    const active = readProducts(ctx.sql, { status: 'active', ...opts });
    expect(active.categories).toEqual([]);
    expect(active.items[0]!.postable).toBe(false);
    updateProductItem(ctx, { productId: 'prod_water', status: 'archived' }, opts);
    expect(readProducts(ctx.sql, { status: 'active', ...opts }).items).toEqual([]);
    const all = readProducts(ctx.sql, { status: 'all', ...opts });
    expect(all.categories).toHaveLength(1);
    expect(all.items).toHaveLength(1);
  });
});
