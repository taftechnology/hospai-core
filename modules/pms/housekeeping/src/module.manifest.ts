import type { ModuleManifest } from '@hospai/contracts';

const manifest = {
  id: 'pms.housekeeping',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: {
    prefix: null,
    tables: [
      'housekeeping_assignment',
      'housekeeping_priority',
      'housekeeping_inventory_item',
      'housekeeping_inventory_movement',
      'housekeeping_task',
      'room_status_history',
    ],
  },
  writes: [
    'room',
    'housekeeping_assignment',
    'housekeeping_priority',
    'housekeeping_inventory_item',
    'housekeeping_inventory_movement',
    'housekeeping_task',
    'room_status_history',
  ],
  publishes: [
    'housekeeping.assigned',
    'housekeeping.priority_changed',
    'housekeeping.inventory_changed',
    'room.status_changed',
  ],
  subscribes: [],
  permissions: ['housekeeping:read', 'housekeeping:write'],
  meters: [],
} as const satisfies ModuleManifest;

export default manifest;
