import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NIGHT_AUDIT_STEPS } from './property-do.js';
import { resolvePropertyFromRegistry } from './provision.js';
import type { NightAuditWorkflowParams, PmsEnv } from './env.js';

/**
 * §8 alarm → Workflow → `runAuditStep` handoff. Resolves the PropertyDO **only** via
 * `resolvePropertyFromRegistry` (Platform D1) — never `idFromName` / raw jurisdiction
 * args (§4.5). Exits without starting a new date's run while halted (any `FAILED` row).
 * After a full successful pass (including `ROLL_BUSINESS_DATE`), re-arms the schedule via
 * `rescheduleNightAudit()` so the DO does not go dark if it is still behind "today".
 */
export class NightAuditWorkflow extends WorkflowEntrypoint<PmsEnv, NightAuditWorkflowParams> {
  async run(event: WorkflowEvent<NightAuditWorkflowParams>, step: WorkflowStep): Promise<void> {
    const propertyId = event.payload.propertyId;

    const resolved = await step.do('resolve', async () => {
      const r = await resolvePropertyFromRegistry(this.env, propertyId);
      return r ? { found: true as const } : { found: false as const };
    });
    if (!resolved.found) return;

    // Re-resolve the stub outside `step.do` — DurableObjectStub is not structured-cloneable
    // and cannot cross a Workflow step boundary; only the resolution *result* is memoized.
    const resolvedAgain = await resolvePropertyFromRegistry(this.env, propertyId);
    if (!resolvedAgain) return;
    const stub = resolvedAgain.stub;

    const halted = await step.do('check-halted', async () => stub.isNightAuditHalted());
    if (halted) return;

    const businessDate = await step.do('read-business-date', async () => stub.readBusinessDate());
    if (!businessDate) return;

    for (const auditStep of NIGHT_AUDIT_STEPS) {
      // Only the plain `status` is returned from the step callback — the DO RPC result
      // itself carries a non-serializable `Symbol.dispose`, which a Workflow step's
      // durable checkpoint cannot store.
      const { status } = await step.do(auditStep, async () => {
        const result = await stub.runAuditStep(businessDate, auditStep);
        return { status: result.status };
      });
      if (status === 'FAILED') return;
    }

    await step.do('reschedule', async () => stub.rescheduleNightAudit());
  }
}
