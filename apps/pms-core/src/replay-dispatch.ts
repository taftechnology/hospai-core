import type { ActorContext, ProvisionalContext } from '@hospai/contracts';

/** Duck-type so PropertyDO can pass `this` without a cycle into this module. */
export type ReplayTarget = {
  tryCheckIn: (
    actor: ActorContext,
    payload: { reservationId: string; roomId?: string; overrideCleanliness?: boolean },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryCheckOut: (
    actor: ActorContext,
    payload: { reservationId: string; overrideBalance?: boolean },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryCancelCheckIn: (
    actor: ActorContext,
    payload: { reservationId: string },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryUpdateFrontOffice: (
    actor: ActorContext,
    payload: {
      reservationId: string;
      frontOfficeComment?: string;
      vipFlag?: boolean;
      dndFlag?: boolean;
      noPost?: boolean;
    },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryAddFolioLine: (
    actor: ActorContext,
    payload: {
      folioLineId: string;
      reservationId: string;
      chargeCode: string;
      amountMinor: number;
    },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryUpdateRoomStatus: (
    actor: ActorContext,
    payload: { roomId: string; status: string },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryBulkUpdateRoomStatus: (
    actor: ActorContext,
    payload: { updates: Array<{ roomId: string; status: string }> },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
  tryAssignHousekeeping: (
    actor: ActorContext,
    payload: { roomId: string; businessDate: string; assigneeRef: string },
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
};

type ReplayDispatch = {
  fingerprintInput: (payload: unknown) => unknown;
  invoke: (
    stub: ReplayTarget,
    actor: ActorContext,
    payload: unknown,
    idem: { key: string; fingerprint: string },
    ctx: ProvisionalContext,
  ) => Promise<{ ok: boolean; error?: string }>;
};

/** Phase 1 replay registry — extend when new QUEUE_PROVISIONAL HTTP routes land. */
export const REPLAY_DISPATCH: Record<string, ReplayDispatch> = {
  'reservations.check_in': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryCheckIn(
        actor,
        payload as { reservationId: string; roomId?: string; overrideCleanliness?: boolean },
        idem,
        ctx,
      ),
  },
  'reservations.check_out': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryCheckOut(
        actor,
        payload as { reservationId: string; overrideBalance?: boolean },
        idem,
        ctx,
      ),
  },
  'reservations.cancel_check_in': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryCancelCheckIn(actor, payload as { reservationId: string }, idem, ctx),
  },
  'reservations.update_status': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryUpdateFrontOffice(
        actor,
        payload as {
          reservationId: string;
          frontOfficeComment?: string;
          vipFlag?: boolean;
          dndFlag?: boolean;
          noPost?: boolean;
        },
        idem,
        ctx,
      ),
  },
  'folio.add_item': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryAddFolioLine(
        actor,
        payload as {
          folioLineId: string;
          reservationId: string;
          chargeCode: string;
          amountMinor: number;
        },
        idem,
        ctx,
      ),
  },
  'rooms.update_status': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryUpdateRoomStatus(actor, payload as { roomId: string; status: string }, idem, ctx),
  },
  'rooms.bulk_update_status': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryBulkUpdateRoomStatus(
        actor,
        payload as { updates: Array<{ roomId: string; status: string }> },
        idem,
        ctx,
      ),
  },
  'housekeeping.assign': {
    fingerprintInput: (p) => p,
    invoke: (stub, actor, payload, idem, ctx) =>
      stub.tryAssignHousekeeping(
        actor,
        payload as { roomId: string; businessDate: string; assigneeRef: string },
        idem,
        ctx,
      ),
  },
};

export const REPLAY_COMMAND_IDS = Object.keys(REPLAY_DISPATCH);
