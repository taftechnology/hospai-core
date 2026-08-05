import type { ProvisionalCommand, PendingCommandMessage } from '@hospai/contracts';
import { logInfo, type ObservabilityContext } from '@hospai/observability';
import type { PmsEnv } from './env.js';

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
  await env.PENDING_COMMANDS_QUEUE.send(message);
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
