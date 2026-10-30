import { describe, expect, it } from 'vitest';
import type { ModuleTxnCtx } from '@hospai/contracts';
import { HK_INVENTORY_LIVE_ITEMS_MAX } from '@hospai/contracts';
import { adjustInventoryItem } from './inventory-adjust.js';
import { createInventoryItem } from './inventory-create-item.js';
import { readHousekeepingInventory, readHousekeepingInventoryMovements } from './read-inventory.js';
import { updateInventoryItem } from './inventory-update-item.js';
import { MemorySql } from './memory-sql.fixture.js';

function txn(sql: MemorySql): ModuleTxnCtx {
  return {
    propertyId: 'prop_test',
    orgId: 'org_test',
    sql,
    appendOutbox: () => {},
  };
}

describe('housekeeping inventory use cases', () => {
  it('create writes count movement and rejects duplicate live name', () => {
    const sql = new MemorySql();
    const ctx = txn(sql);
    createInventoryItem(ctx, {
      itemId: 'i1',
      name: 'Towels',
      category: 'towels',
      unit: 'each',
      parLevel: 10,
      onHand: 5,
      actorRef: 'user_1',
      businessDate: '2026-08-12',
    });
    expect(() =>
      createInventoryItem(ctx, {
        itemId: 'i2',
        name: 'towels',
        category: 'towels',
        unit: 'each',
        parLevel: 10,
        onHand: 1,
        actorRef: 'user_1',
        businessDate: '2026-08-12',
      }),
    ).toThrow('inventory_item_exists');
    const movements = readHousekeepingInventoryMovements(sql, 'i1');
    expect(movements.movements).toHaveLength(1);
    expect(movements.movements[0]?.kind).toBe('count');
    expect(movements.movements[0]?.onHandAfter).toBe(5);
  });

  it('issue below zero throws and leaves on_hand unchanged', () => {
    const sql = new MemorySql();
    const ctx = txn(sql);
    createInventoryItem(ctx, {
      itemId: 'i1',
      name: 'Soap',
      category: 'toiletries',
      unit: 'each',
      parLevel: 5,
      onHand: 2,
      actorRef: 'user_1',
      businessDate: '2026-08-12',
    });
    expect(() =>
      adjustInventoryItem(ctx, {
        itemId: 'i1',
        kind: 'issue',
        quantity: 3,
        actorRef: 'user_1',
        businessDate: '2026-08-12',
      }),
    ).toThrow('insufficient_stock');
    const list = readHousekeepingInventory(sql, { includeArchived: false });
    expect(list.items[0]?.onHand).toBe(2);
    expect(readHousekeepingInventoryMovements(sql, 'i1').movements).toHaveLength(1);
  });

  it('archive frees name and update does not change on_hand', () => {
    const sql = new MemorySql();
    const ctx = txn(sql);
    createInventoryItem(ctx, {
      itemId: 'i1',
      name: 'Linens',
      category: 'linens',
      unit: 'each',
      parLevel: 20,
      onHand: 8,
      actorRef: 'user_1',
      businessDate: '2026-08-12',
    });
    updateInventoryItem(ctx, {
      itemId: 'i1',
      name: 'Linens',
      category: 'linens',
      unit: 'each',
      parLevel: 25,
      archived: true,
    });
    createInventoryItem(ctx, {
      itemId: 'i2',
      name: 'Linens',
      category: 'linens',
      unit: 'each',
      parLevel: 10,
      onHand: 0,
      actorRef: 'user_1',
      businessDate: '2026-08-12',
    });
    const row = readHousekeepingInventory(sql, { includeArchived: true }).items.find((i) => i.itemId === 'i1');
    expect(row?.onHand).toBe(8);
    expect(row?.parLevel).toBe(25);

    // The archived item may still be edited under the name a live item now holds…
    updateInventoryItem(ctx, {
      itemId: 'i1',
      name: 'Linens',
      category: 'linens',
      unit: 'each',
      parLevel: 30,
      archived: true,
    });
    // …but cannot be restored while that live name is taken.
    expect(() =>
      updateInventoryItem(ctx, {
        itemId: 'i1',
        name: 'Linens',
        category: 'linens',
        unit: 'each',
        parLevel: 30,
        archived: false,
      }),
    ).toThrow('inventory_item_exists');
  });

  it('restoring an archived item respects the live item cap', () => {
    const sql = new MemorySql();
    const ctx = txn(sql);
    const base = { category: 'other', unit: 'each', parLevel: 1, onHand: 0, actorRef: 'user_1', businessDate: '2026-08-12' };
    createInventoryItem(ctx, { ...base, itemId: 'old', name: 'Old item' });
    updateInventoryItem(ctx, { itemId: 'old', name: 'Old item', category: 'other', unit: 'each', parLevel: 1, archived: true });
    for (let n = 0; n < HK_INVENTORY_LIVE_ITEMS_MAX; n++) {
      createInventoryItem(ctx, { ...base, itemId: `i_${n}`, name: `Item ${n}` });
    }
    expect(() =>
      updateInventoryItem(ctx, { itemId: 'old', name: 'Old item', category: 'other', unit: 'each', parLevel: 1, archived: false }),
    ).toThrow('limit_exceeded');
  });

  it('enforces live item cap', () => {
    const sql = new MemorySql();
    const ctx = txn(sql);
    for (let n = 0; n < HK_INVENTORY_LIVE_ITEMS_MAX; n++) {
      createInventoryItem(ctx, {
        itemId: `i_${n}`,
        name: `Item ${n}`,
        category: 'other',
        unit: 'each',
        parLevel: 1,
        onHand: 0,
        actorRef: 'user_1',
        businessDate: '2026-08-12',
      });
    }
    expect(() =>
      createInventoryItem(ctx, {
        itemId: 'i_over',
        name: 'Over cap',
        category: 'other',
        unit: 'each',
        parLevel: 1,
        onHand: 0,
        actorRef: 'user_1',
        businessDate: '2026-08-12',
      }),
    ).toThrow('limit_exceeded');
  });
});
