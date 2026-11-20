import type { HousekeepingApi } from './housekeeping-types.js';

/** Empty-data stand-ins for the R4.11 Part B methods, so older suites keep one-line stubs. */
export function depthBStubs(): Pick<
  HousekeepingApi,
  | 'getInspectionTemplates'
  | 'getInspections'
  | 'recordInspection'
  | 'getHousekeepingTaskStages'
  | 'getGuestAudits'
  | 'getGuestAudit'
  | 'startGuestAudit'
  | 'recordGuestAuditCount'
  | 'closeGuestAudit'
> {
  return {
    getInspectionTemplates: async () => ({ ok: true, templates: [] }),
    getInspections: async () => ({ ok: true, inspections: [], truncated: false }),
    recordInspection: async () => ({ ok: true }),
    getHousekeepingTaskStages: async (_p, taskId) => ({ ok: true, taskId, stages: [] }),
    getGuestAudits: async () => ({ ok: true, sessions: [], truncated: false }),
    getGuestAudit: async () => {
      throw new Error('not stubbed');
    },
    startGuestAudit: async () => ({ ok: true }),
    recordGuestAuditCount: async () => ({ ok: true }),
    closeGuestAudit: async () => ({ ok: true }),
  };
}
