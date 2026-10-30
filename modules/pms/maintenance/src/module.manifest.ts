import type { ModuleManifest } from '@hospai/contracts';

const manifest = {
  id: 'pms.maintenance',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: {
    prefix: 'maintenance_',
    tables: ['maintenance_task_type', 'maintenance_ticket'],
  },
  writes: ['maintenance_task_type', 'maintenance_ticket'],
  publishes: ['maintenance.ticket_changed', 'maintenance.task_type_changed'],
  subscribes: [{ event: 'room.ooo_changed', handler: 'onRoomOooChanged' }],
  permissions: ['maintenance:read', 'maintenance:write'],
  meters: [],
} as const satisfies ModuleManifest;

export default manifest;
