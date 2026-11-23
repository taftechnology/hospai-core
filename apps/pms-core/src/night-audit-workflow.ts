import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NIGHT_AUDIT_STEPS } from './property-do.js';
import { countPendingOpen } from './night-audit-census.js';
import { resolvePropertyFromRegistry } from './provision.js';
import type { NightAuditWorkflowParams, PmsEnv } from './env.js';

/**
 * §8 alarm → Workflow → `runAuditStep` handoff. Resolves the PropertyDO **only** via
 * `resolvePropertyFromRegistry` (Platform D1) — never `idFromName` / raw jurisdiction
 * args (§4.5). Exits without starting a new date's run while halted (any `FAILED` row).
 * Exits without running any step while the business date has not ended (`check-due`).
 * After a full pass (including `ROLL_BUSINESS_DATE`), re-arms the schedule via
 * `rescheduleNightAudit(businessDate)` so the DO does not go dark if it is still behind
 * "today" — and does not spin if the run failed to advance the date.
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

    // Not-due gate: a night audit for D must not run any step until D has ended in the
    // property timezone. Running early recorded every step COMPLETED for a live day and
    // (before the roll gate) left the DO re-firing every ~2 s (2026-11-23 staging incident).
    const due = await step.do('check-due', async () => stub.isNightAuditDue(businessDate));
    if (!due) {
      // Point the schedule at the next valid occurrence (after the business date).
      await step.do('reschedule', async () => stub.rescheduleNightAudit());
      return;
    }

    for (const auditStep of NIGHT_AUDIT_STEPS) {
      // Only the plain `status` is returned from the step callback — the DO RPC result
      // itself carries a non-serializable `Symbol.dispose`, which a Workflow step's
      // durable checkpoint cannot store.
      const { status } = await step.do(auditStep, async () => {
        const census =
          auditStep === 'PRE_CHECK'
            ? { pendingOpenCount: await countPendingOpen(this.env.PLATFORM_DB, propertyId) }
            : undefined;
        const result = await stub.runAuditStep(businessDate, auditStep, census);
        return { status: result.status };
      });
      if (status === 'FAILED') return;
    }

    await step.do('reschedule', async () => stub.rescheduleNightAudit(businessDate));
  }
}
