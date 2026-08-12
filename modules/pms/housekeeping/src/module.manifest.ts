import type { ModuleManifest } from '@hospai/contracts';

const manifest = {
  id: 'pms.housekeeping',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: { prefix: null, tables: ['housekeeping_assignment'] },
  writes: ['room', 'housekeeping_assignment'],
  publishes: ['housekeeping.assigned', 'room.status_changed'],
  subscribes: [],
  permissions: ['housekeeping:read', 'housekeeping:write'],
  meters: [],
} as const satisfies ModuleManifest;

export default manifest;
