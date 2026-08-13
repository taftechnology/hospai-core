import type { ProvisionalCommand, PendingCommandMessage } from '@hospai/contracts';
import { logInfo, type ObservabilityContext } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import { deletePendingOpen, insertPendingOpen } from './night-audit-census.js';

export async function enqueueProvisionalCommand(
  env: PmsEnv,
  cmd: ProvisionalCommand,
  observability?: ObservabilityContext,
): Promise<void> {
  const message: PendingCommandMessage = {
    v: 1,
    provisional: cmd,
    enqueuedAt: new Date().toISOString(),
  };
  await insertPendingOpen(env.PLATFORM_DB, {
    propertyId: cmd.propertyId,
    idempotencyKey: cmd.idempotencyKey,
    businessDate: cmd.businessDate,
    commandId: cmd.command.type,
  });
  try {
    await env.PENDING_COMMANDS_QUEUE.send(message);
  } catch (e) {
    await deletePendingOpen(env.PLATFORM_DB, cmd.propertyId, cmd.idempotencyKey);
    throw e;
  }
  if (observability) {
    logInfo(observability, {
      msg: 'degraded.enqueued',
      propertyId: cmd.propertyId,
      commandId: cmd.command.type,
      idempotencyKey: cmd.idempotencyKey,
      businessDate: cmd.businessDate,
    });
  }
}
