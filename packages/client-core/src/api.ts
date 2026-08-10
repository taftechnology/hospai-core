import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';
import type { OrgScopedPermission, PropertyScopedPermission } from '@hospai/contracts';
import type { ReservationStatus } from '@hospai/contracts/reservation-status';
import { composeGuestStates, type GuestRowState } from './compose.js';
import type { FolioLine } from './folio-fold.js';
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
  status: ReservationStatus;
  departureDate: string;
  arrivalDate?: string;
  roomId?: string | null;
  [key: string]: unknown;
};

export type PropertyRead = {
  property: { propertyId: string; timeZone: string; name: string; [key: string]: unknown };
  locationHint?: string;
  recordedJurisdiction?: unknown;
  schemaVersion?: number | null;
  propertyDo?: 'unreachable';
};

export type FolioRead = {
  ok: true;
  window: { folioWindowId: string; kind: string; status: string } | null;
  lines: FolioLine[];
  balanceMinor: number;
};

export type ReservationRead = {
  reservationId: string;
  roomTypeId: string;
  guestRef: string;
  piiKeyId: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  roomId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FolioPaymentRow = {
  paymentId: string;
  reservationId: string;
  amountMinor: number;
  currency: string;
  status: string;
  gatewayReference: string | null;
  capturedAmountMinor: number | null;
  createdAt: number;
  updatedAt: number;
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

  async function getJson(
    path: string,
    init?: RequestInit,
    queueContext?: { reservationId?: string },
  ) {
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
        opts.queued.recordFromProvisionalBody(body, queueContext);
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
    async getProperty(propertyId: string): Promise<PropertyRead> {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}`);
      return body as PropertyRead;
    },
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
    async getMe(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/me`);
      return body as {
        ok: true;
        orgId: string;
        propertyId: string;
        userId: string;
        role: 'owner' | 'admin' | 'staff';
        permissions: PropertyScopedPermission[];
        orgPermissions: OrgScopedPermission[];
      };
    },
    async getOpenShift(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/front-desk/shift`);
      return body;
    },
    async getRecentShifts(propertyId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/front-desk/shifts/recent`,
      );
      return body as {
        ok: true;
        shifts: Array<{
          shiftId: string;
          businessDate: string;
          openedAt: number;
          closedAt: number | null;
          openingFloat: number;
          closingCount: number | null;
          variance: number | null;
          status: 'CLOSED' | 'FORCE_CLOSED';
        }>;
      };
    },
    async getShiftById(propertyId: string, shiftId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/shifts/${enc(shiftId)}`,
      );
      return body;
    },
    async openShift(
      propertyId: string,
      input: { shiftId: string; openingFloat: number },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `shift:open:${input.shiftId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/shifts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shiftId: input.shiftId,
          openingFloat: input.openingFloat,
          idempotencyKey,
        }),
      });
    },
    async closeShift(
      propertyId: string,
      shiftId: string,
      input: { closingCount: number },
    ) {
      const idempotencyKey = stableKeyForOperation(`shift:close:${shiftId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/shifts/${enc(shiftId)}/close`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          closingCount: input.closingCount,
          idempotencyKey,
        }),
      });
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
        { reservationId },
      );
    },
    async getFolio(propertyId: string, reservationId: string): Promise<FolioRead> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio`,
      );
      return body as FolioRead;
    },
    async getReservation(propertyId: string, reservationId: string): Promise<ReservationRead> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}`,
      );
      return body as ReservationRead;
    },
    async getFolioPayments(
      propertyId: string,
      reservationId: string,
    ): Promise<{ ok: true; payments: FolioPaymentRow[] }> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/payments`,
      );
      const r = body as { ok?: true; payments?: FolioPaymentRow[] };
      return { ok: true, payments: Array.isArray(r.payments) ? r.payments : [] };
    },
    async addFolioLine(
      propertyId: string,
      reservationId: string,
      input: { chargeCode: string; amountMinor: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/lines`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chargeCode: input.chargeCode,
            amountMinor: input.amountMinor,
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async recordCashPayment(
      propertyId: string,
      reservationId: string,
      input: { paymentId: string; amountMinor: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/payments/cash`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paymentId: input.paymentId,
            amountMinor: input.amountMinor,
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async authorizePayment(
      propertyId: string,
      reservationId: string,
      input: { paymentId: string; amountMinor: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/payments/authorize`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paymentId: input.paymentId,
            amountMinor: input.amountMinor,
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async capturePayment(
      propertyId: string,
      paymentId: string,
      input: { amountMinor: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/payments/${enc(paymentId)}/capture`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amountMinor: input.amountMinor,
            idempotencyKey,
          }),
        },
      );
    },
    async splitFolioLine(
      propertyId: string,
      sourceFolioLineId: string,
      input: { splits: Array<{ folioLineId: string; amountMinor: number }> },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/lines/${enc(sourceFolioLineId)}/split`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ splits: input.splits, idempotencyKey }),
        },
      );
    },
    async splitFolioPayment(
      propertyId: string,
      sourceFolioLineId: string,
      input: { splits: Array<{ folioLineId: string; amountMinor: number }> },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/lines/${enc(sourceFolioLineId)}/split-payment`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ splits: input.splits, idempotencyKey }),
        },
      );
    },
    async checkOut(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/check-out`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({}),
        },
        { reservationId },
      );
    },
  };
}
