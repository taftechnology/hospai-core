import type { NightAuditWorkflowParams } from './env.js';

export function nightAuditWorkflowId(propertyId: string, businessDate: string): string {
  return `na-${propertyId}-${businessDate}`;
}

export type NightAuditInstanceStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete';

export function mapNightAuditInstanceHttp(
  workflowId: string,
  businessDate: string,
  instanceStatus: string,
): { status: number; body: Record<string, unknown> } {
  const live = new Set(['queued', 'running', 'waiting', 'paused']);
  if (live.has(instanceStatus)) {
    return { status: 202, body: { workflowId, businessDate, instanceStatus } };
  }
  if (instanceStatus === 'complete') {
    return { status: 200, body: { workflowId, businessDate, instanceStatus: 'complete' } };
  }
  return {
    status: 409,
    body: { error: 'night_audit_workflow_exists', instanceStatus },
  };
}

export async function getOrCreateNightAuditWorkflow(
  workflow: Workflow<NightAuditWorkflowParams>,
  propertyId: string,
  businessDate: string,
): Promise<{ workflowId: string; instanceStatus: string; created: boolean }> {
  const id = nightAuditWorkflowId(propertyId, businessDate);
  try {
    const instance = await workflow.create({ id, params: { propertyId } });
    const st = await instance.status();
    return { workflowId: id, instanceStatus: st.status, created: true };
  } catch {
    const instance = await workflow.get(id);
    const st = await instance.status();
    return { workflowId: id, instanceStatus: st.status, created: false };
  }
}
