import type { PropertyRecord, RouteId } from '@hospai/contracts';
import type { V1DispatchContext } from './v1-dispatch.js';
import type { resolvePropertyFromRegistry } from './provision.js';

export type ResolvedPropertyCtx = {
  property: PropertyRecord;
  resolved: NonNullable<Awaited<ReturnType<typeof resolvePropertyFromRegistry>>>;
};

export function commandEnvelope(
  ctx: V1DispatchContext,
  resolvedCtx: ResolvedPropertyCtx,
  opts: {
    commandId: string;
    routeId: RouteId;
    idempotencyKey: string;
    requestFingerprint: string;
    commandPayload: unknown;
  },
) {
  return {
    env: ctx.env,
    observability: ctx.observability,
    commandId: opts.commandId,
    routeId: opts.routeId,
    orgId: resolvedCtx.property.orgId,
    propertyId: resolvedCtx.property.propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: opts.idempotencyKey,
    requestFingerprint: opts.requestFingerprint,
    commandPayload: opts.commandPayload,
  };
}
