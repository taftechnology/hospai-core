import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';
import { composeGuestStates, type GuestRowState } from './compose.js';
import { stableKeyForOperation } from './idempotency.js';
import type { createQueuedCommandLog } from './queued-commands.js';
import { ClassifiedError, requestJson } from './request.js';
import type { createEntitlementStore } from './entitlements-state.js';
import type { Transport } from './transport.js';

export { ClassifiedError } from './request.js';

export type ListPage<T> = {
  ok: true;
  items: T[];
  nextCursor: string | null;
};

export type FrontDeskItem = {
  reservationId: string;
  guestRef: string;
  [key: string]: unknown;
};

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function createClient(opts: {
  transport: Transport;
  queued: ReturnType<typeof createQueuedCommandLog>;
  entitlements: ReturnType<typeof createEntitlementStore>;
  keyStore: Map<string, string>;
}) {
  const on402 = () => opts.entitlements.onEntitlementRequired();

  async function getJson(path: string, init?: RequestInit) {
    const { classified, body } = await requestJson({
      transport: opts.transport,
      path,
      init,
      onEntitlementRequired: on402,
    });
    if (
      classified.class === 'live' ||
      classified.class === 'provisional'
    ) {
      if (classified.class === 'provisional') {
        opts.queued.recordFromProvisionalBody(body);
      }
      return { classified, body };
    }
    throw new ClassifiedError(classified);
  }

  async function listFrontDesk(
    kind: 'arrivals' | 'departures' | 'in-house',
    propertyId: string,
    query: Record<string, string | undefined>,
  ): Promise<ListPage<FrontDeskItem>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') qs.set(k, v);
    }
    const q = qs.toString();
    const path = `/v1/properties/${enc(propertyId)}/front-desk/${kind}${q ? `?${q}` : ''}`;
    const { body } = await getJson(path);
    const r = body as { ok?: boolean; items?: FrontDeskItem[]; nextCursor?: string | null };
    return {
      ok: true,
      items: Array.isArray(r.items) ? r.items : [],
      nextCursor: r.nextCursor ?? null,
    };
  }

  return {
    async getArrivals(propertyId: string, date: string, cursor?: string | null) {
      return listFrontDesk('arrivals', propertyId, {
        date,
        cursor: cursor ?? undefined,
      });
    },
    async getDepartures(propertyId: string, date: string, cursor?: string | null) {
      return listFrontDesk('departures', propertyId, {
        date,
        cursor: cursor ?? undefined,
      });
    },
    async getInHouse(propertyId: string, cursor?: string | null) {
      return listFrontDesk('in-house', propertyId, {
        cursor: cursor ?? undefined,
      });
    },
    async postGuestsBatch(
      propertyId: string,
      refs: string[],
    ): Promise<
      | { ok: true; guests: Record<string, unknown>; states: Record<string, GuestRowState> }
      | { ok: false; wholesaleFailure: true; states: Record<string, GuestRowState> }
    > {
      try {
        const { body } = await getJson(`/v1/properties/${enc(propertyId)}/guests/batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refs }),
        });
        const r = body as { ok?: boolean; guests?: Record<string, unknown> };
        const guests = r.guests ?? {};
        return {
          ok: true,
          guests,
          states: composeGuestStates(refs, { ok: true, guests }),
        };
      } catch (e) {
        if (e instanceof ClassifiedError && e.classified.class === 'fail_closed') {
          return {
            ok: false,
            wholesaleFailure: true,
            states: composeGuestStates(refs, { ok: false, wholesaleFailure: true }),
          };
        }
        throw e;
      }
    },
    async getShift(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/front-desk/shift`);
      return body;
    },
    async getProvisionalExceptionCount(propertyId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exception-count`,
      );
      return body as { propertyId: string; exceptionCount: number };
    },
    async getProvisionalExceptions(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/provisional-exceptions`);
      return body;
    },
    async getOrgEntitlements(orgId: string): Promise<EntitlementSnapshot> {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/entitlements`);
      const snap = body as EntitlementSnapshot;
      opts.entitlements.set(snap);
      return snap;
    },
    async assignRoom(propertyId: string, reservationId: string, roomId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/assign-room`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId, idempotencyKey }),
        },
      );
    },
    async checkIn(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/check-in`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({}),
        },
      );
    },
  };
}
