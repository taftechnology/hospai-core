import type {
  PendingCommandMessage,
  ProvisionalCommand,
  ProvisionalContext,
} from '@hospai/contracts';
import { BUSINESS_DATE_CLOSED, fingerprintPayload } from '@hospai/contracts';
import { LaneGuard } from '@hospai/do-runtime';
import { logInfo, logWarn } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import type { PropertyDO } from './property-do.js';
import { isPropertyDoTransportFailure } from './property-do-transport.js';
import { resolvePropertyFromRegistry } from './provision.js';

const replayLanes = new LaneGuard();

const REPLAY_ACTOR = { kind: 'system' as const, reason: 'queue_replay' as const };

type ReplayDispatch = {
  fingerprintInput: (payload: unknown) => unknown;
  invoke: (
    stub: DurableObjectStub<PropertyDO>,
    payload: unknown,
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
};

/** Phase 1 replay registry — extend when new QUEUE_PROVISIONAL HTTP routes land. */
export const REPLAY_DISPATCH: Record<string, ReplayDispatch> = {
  'reservations.check_in': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryCheckIn(REPLAY_ACTOR, payload as { reservationId: string }, idem, ctx),
  },
  'reservations.check_out': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryCheckOut(REPLAY_ACTOR, payload as { reservationId: string }, idem, ctx),
  },
  'reservations.cancel_check_in': {
    fingerprintInput: (p) => p,
    invoke: (stub, payload, idem, ctx) =>
      stub.tryCancelCheckIn(REPLAY_ACTOR, payload as { reservationId: string }, idem, ctx),
  },
};

export const REPLAY_COMMAND_IDS = Object.keys(REPLAY_DISPATCH);

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
        });
        msg.ack();
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
        });
        msg.ack();
        continue;
      }

      const fingerprint = await fingerprintPayload(dispatch.fingerprintInput(provisional.command.payload));
      if (fingerprint !== provisional.requestFingerprint) {
        await resolved.stub.recordProvisionalException(provisional, 'fingerprint_mismatch', {
          expected: provisional.requestFingerprint,
          actual: fingerprint,
        });
        msg.ack();
        continue;
      }

      const provisionalCtx: ProvisionalContext = {
        issuedAt: provisional.issuedAt,
        businessDate: provisional.businessDate,
      };

      const result = await dispatch.invoke(
        resolved.stub,
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
        });
        msg.ack();
        continue;
      }

      const reason =
        result.error === BUSINESS_DATE_CLOSED ? 'business_date_closed' : (result.error ?? 'domain_error');

      await resolved.stub.recordProvisionalException(provisional, reason, result);
      logWarn(ctx, {
        msg: 'degraded.exception',
        reason,
        propertyId: provisional.propertyId,
        commandId: provisional.command.type,
        idempotencyKey: provisional.idempotencyKey,
      });
      msg.ack();
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
