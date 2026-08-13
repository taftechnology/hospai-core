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

export type AvailabilityRead = {
  propertyId: string;
  fromDate: string;
  toDate: string;
  ariVersion: number;
  source: 'kv' | 'do';
  cache: 'hit' | 'miss';
  items: Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    free: number;
  }>;
};

export type NightAuditStepStatus = {
  step: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  attempt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

export type NightAuditStatus = {
  ok: true;
  businessDate: string;
  timelineDate: string;
  halted: boolean;
  pendingOpenCount: number;
  closingExceptionCount: number;
  steps: NightAuditStepStatus[];
  reports: Array<{ reportId: string; businessDate: string; generatedAt: number }>;
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
    /** Callers that mutate the current actor's grants should invalidate `['me', propertyId]`. */
    async listOrgMembers(orgId: string) {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/members`);
      return body as {
        ok: true;
        members: Array<{
          userId: string;
          role: 'owner' | 'admin' | 'staff';
          createdAt: number;
          updatedAt: number | null;
          displayName: string | null;
          email: string | null;
        }>;
        /** Present only when Clerk directory lookup failed; omit when ok. */
        directory?: 'unavailable';
      };
    },
    /**
     * On conflict, `ClassifiedError.classified` is `client_error` / 409 with body
     * `{ error: 'already_member', userId: string, role: 'owner' | 'admin' | 'staff' }`.
     */
    async createOrgMember(
      orgId: string,
      input: { email: string; role: 'owner' | 'admin' | 'staff' },
    ) {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return body as { ok: true; userId: string; role: 'owner' | 'admin' | 'staff' };
    },
    async updateOrgMember(
      orgId: string,
      userId: string,
      input: { role: 'owner' | 'admin' | 'staff' },
    ) {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/members/${enc(userId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return body as {
        ok: true;
        userId: string;
        role: 'owner' | 'admin' | 'staff';
        previousRole?: 'owner' | 'admin' | 'staff';
      };
    },
    async deleteOrgMember(orgId: string, userId: string) {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/members/${enc(userId)}`, {
        method: 'DELETE',
      });
      return body as { ok: true; userId: string };
    },
    async listPropertyMembers(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/members`);
      return body as {
        ok: true;
        members: Array<{
          userId: string;
          role: 'owner' | 'admin' | 'staff';
          createdAt: number;
          updatedAt: number | null;
          displayName: string | null;
          email: string | null;
          hasOrgRole: boolean;
        }>;
        /** Present only when Clerk directory lookup failed; omit when ok. */
        directory?: 'unavailable';
      };
    },
    /**
     * On conflict, `ClassifiedError.classified` is `client_error` / 409 with body
     * `{ error: 'already_member', userId: string, role: 'owner' | 'admin' | 'staff' }`.
     */
    async createPropertyMember(
      propertyId: string,
      input: { email: string; role: 'admin' | 'staff' },
    ) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return body as { ok: true; userId: string; role: 'admin' | 'staff' };
    },
    async updatePropertyMember(
      propertyId: string,
      userId: string,
      input: { role: 'admin' | 'staff' },
    ) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/members/${enc(userId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return body as {
        ok: true;
        userId: string;
        role: 'admin' | 'staff';
        previousRole?: 'owner' | 'admin' | 'staff';
      };
    },
    async deletePropertyMember(propertyId: string, userId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/members/${enc(userId)}`, {
        method: 'DELETE',
      });
      return body as { ok: true; userId: string };
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

    /**
     * Deliberately no roomTypeId — booking quotes must use DO ariVersion (Branch 2), not KV min.
     * HTTP accepts roomTypeId; this client method does not expose it.
     */
    async getAvailability(
      propertyId: string,
      range: { fromDate: string; toDate: string },
    ): Promise<AvailabilityRead> {
      const qs = new URLSearchParams({
        fromDate: range.fromDate,
        toDate: range.toDate,
      });
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/availability?${qs.toString()}`,
      );
      return body as AvailabilityRead;
    },

    async createGuest(
      propertyId: string,
      input: { guestId: string; displayName: string; email?: string; phone?: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      const payload: Record<string, unknown> = {
        guestId: input.guestId,
        displayName: input.displayName,
        idempotencyKey,
      };
      if (input.email !== undefined) payload.email = input.email;
      if (input.phone !== undefined) payload.phone = input.phone;
      return getJson(`/v1/properties/${enc(propertyId)}/guests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },

    async createReservation(
      propertyId: string,
      input: {
        reservationId: string;
        roomTypeId: string;
        guestRef: string;
        arrivalDate: string;
        departureDate: string;
        quoteAriVersion: number;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reservationId: input.reservationId,
          roomTypeId: input.roomTypeId,
          guestRef: input.guestRef,
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          quoteAriVersion: input.quoteAriVersion,
          idempotencyKey,
        }),
      });
    },
    async listRooms(
      propertyId: string,
      query?: { roomTypeId?: string; status?: string },
    ): Promise<{
      ok: true;
      rooms: Array<{
        roomId: string;
        roomTypeId: string;
        code: string;
        status: string;
        floor: string | null;
        createdAt: number;
        updatedAt: number;
      }>;
    }> {
      const qs = new URLSearchParams();
      if (query?.roomTypeId) qs.set('roomTypeId', query.roomTypeId);
      if (query?.status) qs.set('status', query.status);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/rooms${q ? `?${q}` : ''}`,
      );
      return body as {
        ok: true;
        rooms: Array<{
          roomId: string;
          roomTypeId: string;
          code: string;
          status: string;
          floor: string | null;
          createdAt: number;
          updatedAt: number;
        }>;
      };
    },
    async listHousekeepingAssignments(
      propertyId: string,
      businessDate: string,
    ): Promise<{
      ok: true;
      assignments: Array<{
        assignmentId: string;
        roomId: string;
        businessDate: string;
        assigneeRef: string;
        createdAt: number;
        updatedAt: number;
      }>;
    }> {
      const qs = new URLSearchParams({ businessDate });
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/assignments?${qs}`,
      );
      return body as {
        ok: true;
        assignments: Array<{
          assignmentId: string;
          roomId: string;
          businessDate: string;
          assigneeRef: string;
          createdAt: number;
          updatedAt: number;
        }>;
      };
    },
    async updateRoomStatus(
      propertyId: string,
      roomId: string,
      status: string,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, idempotencyKey }),
      });
    },
    async listRoster(propertyId: string, query?: { kind?: string }) {
      const qs = new URLSearchParams();
      if (query?.kind) qs.set('kind', query.kind);
      const q = qs.toString();
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/roster${q ? `?${q}` : ''}`);
      return body as {
        ok: true;
        staff: Array<{
          staffId: string;
          kinds: string[];
          status: string;
          exitedAt: number | null;
          displayName?: string;
          email?: string;
          phone?: string;
          hourlyRate?: { amountMinor: number; currency: string };
          rating?: number;
          skills?: string[];
        }>;
      };
    },
    async getRoster(propertyId: string, staffId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/roster/${enc(staffId)}`,
      );
      return body;
    },
    async addRoster(
      propertyId: string,
      input: {
        displayName: string;
        kinds: string[];
        email?: string;
        phone?: string;
        hourlyRate?: { amountMinor: number; currency: string };
        rating?: number;
        skills?: string[];
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      const payload: Record<string, unknown> = {
        displayName: input.displayName,
        kinds: input.kinds,
        idempotencyKey,
      };
      if (input.email !== undefined) payload.email = input.email;
      if (input.phone !== undefined) payload.phone = input.phone;
      if (input.hourlyRate !== undefined) payload.hourlyRate = input.hourlyRate;
      if (input.rating !== undefined) payload.rating = input.rating;
      if (input.skills !== undefined) payload.skills = input.skills;
      return getJson(`/v1/properties/${enc(propertyId)}/roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    async updateRoster(
      propertyId: string,
      staffId: string,
      input: {
        displayName?: string;
        kinds?: string[];
        email?: string;
        phone?: string;
        hourlyRate?: { amountMinor: number; currency: string };
        rating?: number;
        skills?: string[];
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/roster/${enc(staffId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async setRosterStatus(
      propertyId: string,
      staffId: string,
      status: 'active' | 'inactive',
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/roster/${enc(staffId)}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, idempotencyKey }),
      });
    },
    async exitRoster(propertyId: string, staffId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/roster/${enc(staffId)}/exit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      });
    },
    async getNightAudit(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/night-audit`);
      return body as NightAuditStatus;
    },
    async getNightAuditReport(propertyId: string, businessDate: string, reportId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/night-audit/reports/${enc(businessDate)}/${enc(reportId)}`,
      );
      return body as Record<string, unknown>;
    },
    async runNightAudit(propertyId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/night-audit/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      });
    },
    async retryNightAuditStep(
      propertyId: string,
      input: { businessDate: string; step: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/night-audit/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          businessDate: input.businessDate,
          step: input.step,
        }),
      });
    },
    async resolveNightAuditHalt(propertyId: string, businessDate: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/night-audit/resolve-halt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey, businessDate }),
      });
    },
    async resolveProvisionalException(propertyId: string, exceptionId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions/${enc(exceptionId)}/resolve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async assignHousekeeping(
      propertyId: string,
      input: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
    ) {
      return getJson(`/v1/properties/${enc(propertyId)}/housekeeping/assignments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
  };
}
