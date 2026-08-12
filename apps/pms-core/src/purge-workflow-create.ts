/** Idempotent Workflow create — prefer get-before-create over message-matching catches. */

import type { PurgeWorkflowParams } from './env.js';

/**
 * Ensure a Workflow instance exists for `opts.id`.
 *
 * - Already present → no-op (`already_exists`)
 * - Missing → `create`
 * - `create` fails → confirm via `get`; if present (race/redelivery) treat as success,
 *   otherwise **rethrow** so callers (queue consumer) can retry
 *
 * Real failures (missing binding, quota, rejected params) propagate — never swallowed.
 */
export async function ensurePurgeWorkflowInstance(
  workflow: Workflow<PurgeWorkflowParams>,
  opts: { id: string; params: PurgeWorkflowParams },
): Promise<'created' | 'already_exists'> {
  try {
    await workflow.get(opts.id);
    return 'already_exists';
  } catch {
    // `.get` throws when the id is absent (or invalid). Fall through to create.
    // If the binding itself is broken, `create` below will throw and we rethrow.
  }

  try {
    await workflow.create(opts);
    return 'created';
  } catch (e) {
    try {
      await workflow.get(opts.id);
      return 'already_exists';
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}
