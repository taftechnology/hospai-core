import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { OPS_COPY_KINDS } from '@hospai/contracts';
import type { OpsCopyWorkflowParams, PmsEnv } from './env.js';
import {
  COPY_RATE_JOBS_PER_STEP,
  executeCopyKind,
  executeCopyRates,
  finishCopyRun,
  listCopyRateJobs,
  startCopyRun,
  type CopyStepOutcome,
} from './ops-copy.js';

/**
 * R7.5 `ops.copy_setup` (ops-platform spec §11 C1). One Workflow step per kind, in dependency order, plus
 * `rates:<n>` sub-steps for the nightly rates (a plan x room type is up to 366 DO calls, so a few go in each
 * step to stay under the per-step subrequest limit).
 *
 * The body keeps no state of its own. The run row in Platform D1 holds kinds, progress and the id map, and
 * every item is an idempotent replay on the target, so any step can be retried and the whole instance can be
 * replaced by a new attempt without writing anything twice. A domain refusal (an item the target will not
 * take) is a skipped item in the result, not a failure. A step that fails for real marks the run `failed`,
 * which lets the operator send the same request again to start the next attempt.
 */
export class OpsCopyWorkflow extends WorkflowEntrypoint<PmsEnv, OpsCopyWorkflowParams> {
  async run(event: WorkflowEvent<OpsCopyWorkflowParams>, step: WorkflowStep): Promise<void> {
    const { copyId } = event.payload;
    const env = this.env;

    const started = await step.do('start', async () => startCopyRun(env, copyId));
    if (!started) return;

    const fail = async (error: string): Promise<void> => {
      await step.do('mark-failed', async () => finishCopyRun(env, copyId, 'failed', error));
    };

    try {
      for (const kind of OPS_COPY_KINDS) {
        if (!started.kinds.includes(kind)) continue;
        const outcome: CopyStepOutcome = await step.do(kind, async () => executeCopyKind(env, copyId, kind));
        if (!outcome.ok) return fail(outcome.error);

        if (kind === 'rate_plans') {
          const jobs = await step.do('rate_plans:jobs', async () => listCopyRateJobs(env, copyId));
          for (let i = 0; i * COPY_RATE_JOBS_PER_STEP < jobs.length; i += 1) {
            const chunk = jobs.slice(i * COPY_RATE_JOBS_PER_STEP, (i + 1) * COPY_RATE_JOBS_PER_STEP);
            const rates: CopyStepOutcome = await step.do(`rate_plans:rates:${i}`, async () =>
              executeCopyRates(env, copyId, chunk),
            );
            if (!rates.ok) return fail(rates.error);
          }
        }
      }
    } catch (e) {
      await fail(e instanceof Error && e.message ? 'step_failed' : 'step_failed');
      throw e;
    }

    await step.do('finish', async () => finishCopyRun(env, copyId, 'completed'));
  }
}
