import type { ModuleManifest } from '@hospai/contracts';

const manifest = {
  id: 'pms.products',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: { prefix: 'products_', tables: ['products_category', 'products_item'] },
  writes: ['products_category', 'products_item'],
  publishes: ['products.changed'],
  subscribes: [],
  permissions: ['settings:configure', 'folio:read'],
  meters: [],
} as const satisfies ModuleManifest;

export default manifest;
