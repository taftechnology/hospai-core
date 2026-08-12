import type { ModuleUiManifest } from '@hospai/contracts';

export const housekeepingUi = {
  moduleId: 'pms.housekeeping',
  nav: [
    {
      id: 'housekeeping',
      label: 'Housekeeping',
      path: '/housekeeping',
      order: 25,
      permission: 'housekeeping:read',
    },
  ],
} as const satisfies ModuleUiManifest;
