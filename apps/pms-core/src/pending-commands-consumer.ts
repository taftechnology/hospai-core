import type {
  PendingCommandMessage,
  ProvisionalContext,
} from '@hospai/contracts';
import { BUSINESS_DATE_CLOSED, DOMAIN_ERROR, fingerprintPayload } from '@hospai/contracts';
import { LaneGuard } from '@hospai/do-runtime';
import { logInfo, logWarn } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import { isPropertyDoTransportFailure } from './property-do-transport.js';
import { resolvePropertyFromRegistry } from './provision.js';
import { assertTenantActive } from './registry.js';
import { deletePendingOpen } from './night-audit-census.js';
import { REPLAY_DISPATCH } from './replay-dispatch.js';

export { REPLAY_DISPATCH, REPLAY_COMMAND_IDS } from './replay-dispatch.js';

const replayLanes = new LaneGuard();

const REPLAY_ACTOR = { kind: 'system' as const, reason: 'queue_replay' as const };

async function ackTerminal(
  env: PmsEnv,
  msg: Message<PendingCommandMessage>,
): Promise<void> {
  const { provisional } = msg.body;
  await deletePendingOpen(env.PLATFORM_DB, provisional.propertyId, provisional.idempotencyKey);
  msg.ack();
}

export async function handlePendingCommandsBatch(
  batch: MessageBatch<PendingCommandMessage>,
  env: PmsEnv,
): Promise<void> {
  if (!replayLanes.admitBackground()) {
    for (const msg of batch.messages) msg.retry();
    return;
  }

  for (const msg of batch.messages) {
    const { provisional } = msg.body;
    const ctx = { moduleId: 'pms.core.degraded' as const };

    try {
      const resolved = await resolvePropertyFromRegistry(env, provisional.propertyId);
      if (!resolved) {
        logWarn(ctx, {
          msg: 'degraded.exception',
          reason: 'property_not_found',
          propertyId: provisional.propertyId,
          commandId: provisional.command.type,
          actorUserId: provisional.actor.userId,
        });
        await ackTerminal(env, msg);
        continue;
      }

      const gate = await assertTenantActive(env, { propertyId: provisional.propertyId });
      if (!gate.ok) {
        logWarn(ctx, {
          msg: 'degraded.exception',
          reason: 'tenant_not_active',
          propertyId: provisional.propertyId,
          commandId: provisional.command.type,
          status: gate.status,
          actorUserId: provisional.actor.userId,
        });
        await ackTerminal(env, msg);
        continue;
      }

      const dispatch = REPLAY_DISPATCH[provisional.command.type];
      if (!dispatch) {
        await resolved.stub.recordProvisionalException(provisional, 'unknown_command', null);
        logWarn(ctx, {
          msg: 'degraded.exception',
          reason: 'unknown_command',
          propertyId: provisional.propertyId,
          commandId: provisional.command.type,
          actorUserId: provisional.actor.userId,
        });
        await ackTerminal(env, msg);
        continue;
      }

      const fingerprint = await fingerprintPayload(dispatch.fingerprintInput(provisional.command.payload));
      if (fingerprint !== provisional.requestFingerprint) {
        await resolved.stub.recordProvisionalException(provisional, 'fingerprint_mismatch', {
          expected: provisional.requestFingerprint,
          actual: fingerprint,
        });
        await ackTerminal(env, msg);
        continue;
      }

      const provisionalCtx: ProvisionalContext = {
        issuedAt: provisional.issuedAt,
        businessDate: provisional.businessDate,
        auditUserId: provisional.actor.userId,
      };

      const result = await dispatch.invoke(
        resolved.stub,
        REPLAY_ACTOR,
        provisional.command.payload,
        { key: provisional.idempotencyKey, fingerprint: provisional.requestFingerprint },
        provisionalCtx,
      );

      if (result.ok) {
        logInfo(ctx, {
          msg: 'degraded.replayed',
          propertyId: provisional.propertyId,
          commandId: provisional.command.type,
          idempotencyKey: provisional.idempotencyKey,
          actorUserId: provisional.actor.userId,
        });
        await ackTerminal(env, msg);
        continue;
      }

      if (result.error === 'org_unreachable') {
        msg.retry();
        continue;
      }

      const reason =
        result.error === BUSINESS_DATE_CLOSED ? 'business_date_closed' : (result.error ?? DOMAIN_ERROR);

      await resolved.stub.recordProvisionalException(provisional, reason, result);
      logWarn(ctx, {
        msg: 'degraded.exception',
        reason,
        propertyId: provisional.propertyId,
        commandId: provisional.command.type,
        idempotencyKey: provisional.idempotencyKey,
        actorUserId: provisional.actor.userId,
      });
      await ackTerminal(env, msg);
    } catch (e) {
      if (isPropertyDoTransportFailure(e)) {
        msg.retry();
        continue;
      }
      logWarn(ctx, {
        msg: 'degraded.replay_error',
        propertyId: provisional.propertyId,
        commandId: provisional.command.type,
        idempotencyKey: provisional.idempotencyKey,
        error: e instanceof Error ? e.message : String(e),
      });
      msg.retry();
    }
  }
}
