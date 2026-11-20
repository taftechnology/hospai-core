import type { EntitlementSnapshot } from '@hospai/contracts/entitlements';
import type {
  GuestDocumentList,
  GuestSettings,
  HousekeepingInventoryCategory,
  HousekeepingInventoryItemRow,
  HousekeepingInventoryMovementKind,
  HousekeepingInventoryMovementRow,
  HousekeepingPriorityLevel,
  HousekeepingPriorityLevelInput,
  HousekeepingPriorityQueueRow,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTaskTypeRow,
  MaintenanceTicketRow,
  NightAuditCheckLog,
  NightAuditCheckPreviewRow,
  OrgScopedPermission,
  PropertyScopedPermission,
  RatePlanInclusionInput,
  RatePlanListItem,
  InclusionTaxMode,
} from '@hospai/contracts';
import type { ReservationStatus } from '@hospai/contracts/reservation-status';
import { composeGuestStates, type GuestRowState } from './compose.js';
import type { FolioLine } from './folio-fold.js';
import { stableKeyForOperation } from './idempotency.js';
import type { createQueuedCommandLog } from './queued-commands.js';
import { ClassifiedError, requestJson } from './request.js';
import type { ClassifiedResponse } from './classify.js';
import type { createEntitlementStore } from './entitlements-state.js';
import type { Transport } from './transport.js';

export { ClassifiedError } from './request.js';

export type ListPage<T> = {
  ok: true;
  items: T[];
  nextCursor: string | null;
};

export type NamedListEntry = {
  code: string;
  name: string;
  status: 'active' | 'archived';
};

export type OperationalConfigKey = 'pms.property.sources' | 'pms.property.market_segments';

export type OperationalConfigItem = {
  key: OperationalConfigKey;
  value: NamedListEntry[];
  version: number;
  source: 'stored' | 'default';
};

export type OperationalConfigRead = {
  ok: true;
  items: OperationalConfigItem[];
};

export type FrontDeskItem = {
  reservationId: string;
  guestRef: string;
  status: ReservationStatus;
  departureDate: string;
  arrivalDate?: string;
  roomId?: string | null;
  sourceCode?: string | null;
  marketSegmentCode?: string | null;
  [key: string]: unknown;
};

export type PropertyRead = {
  property: { propertyId: string; timeZone: string; name: string; [key: string]: unknown };
  locationHint?: string;
  recordedJurisdiction?: unknown;
  schemaVersion?: number | null;
  propertyDo?: 'unreachable';
  /** Stored ledger currency, or null before one is set / when the property DO is unreachable. */
  ledgerCurrency?: string | null;
};

/** `get_products` (R1.5). `taxGroup` is the charge code's — read-only on a product. */
export type ProductCategoryRead = {
  categoryId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'archived';
};

export type ProductItemRead = {
  productId: string;
  categoryId: string;
  sku: string | null;
  name: string;
  chargeCode: string;
  defaultAmountMinor: number;
  status: 'active' | 'archived';
  taxGroup: string | null;
  postable: boolean;
};

export type ProductsList = {
  ok: true;
  categories: ProductCategoryRead[];
  items: ProductItemRead[];
};

/** `get_reservation_recurring_charges` (R3.2). Amounts are the schedule snapshot. */
export type RecurringCharge = {
  recurringChargeId: string;
  reservationId: string;
  pattern: 'NIGHTLY';
  productId: string;
  chargeCode: string;
  description: string;
  unitAmountMinor: number;
  quantity: number;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'cancelled';
  createdAt: number;
  createdBy: string;
  cancelledAt: number | null;
  cancelledBy: string | null;
};

export type FolioWindowSummary = {
  folioWindowId: string;
  kind: string;
  status: string;
  billedParty: string | null;
  closedAt: number | null;
  balanceMinor: number;
};

export type FolioRead = {
  ok: true;
  window: { folioWindowId: string; kind: string; status: string; closedAt?: number | null } | null;
  windows?: FolioWindowSummary[];
  lines: FolioLine[];
  balanceMinor: number;
  noPost?: boolean;
  ledgerCurrency?: string | null;
  balanceAtRisk?: boolean;
  txnBalances?: Array<{ currency: string; amountMinor: number }>;
};

/** POST post_folio_transfer success body; cityLedgerSynced set when AR posts on COMPANY transfer. */
export type FolioTransferResult = {
  ok: true;
  reverseFolioLineId: string;
  destFolioLineId: string;
  cityLedgerSynced?: boolean;
};

export type FxRateRow = {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  effectiveFrom: number;
  effectiveTo: number | null;
  createdAt: number;
  createdBy: string | null;
};

export type RoomTypeRead = {
  roomTypeId: string;
  code: string;
  name: string;
  kind?: 'physical' | 'virtual';
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
  status: 'active' | 'archived';
  constituentRoomTypeIds?: string[];
  createdAt?: number;
  updatedAt?: number;
};

export type ReservationCancellation = {
  penaltyType: 'none' | 'first_night' | 'nights' | 'percent' | 'full';
  graceHours: number | null;
  penaltyNights: number | null;
  penaltyBps: number | null;
  /** Property-timezone midnight of arrival, minus grace hours. Null when the plan has no penalty. */
  freeUntil: number | null;
  /** What cancel would post if called now. Null when the snapshotted policy is invalid. */
  cancelNowMinor: number | null;
  /** What no-show would post if called now. Null when the snapshotted policy is invalid. */
  noShowMinor: number | null;
  currency: string;
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
  adults?: number;
  children?: number;
  frontOfficeComment?: string | null;
  vipFlag?: boolean;
  dndFlag?: boolean;
  ratePlanId?: string;
  promoId?: string | null;
  expiresAt?: number | null;
  sourceCode?: string | null;
  marketSegmentCode?: string | null;
  confirmBy?: number | null;
  allocatedRoomTypeId?: string;
  createdAt: number;
  updatedAt: number;
  cancellation?: ReservationCancellation;
};

export type FolioPaymentRow = {
  paymentId: string;
  reservationId: string;
  amountMinor: number;
  currency: string;
  status: string;
  purpose?: 'STAY' | 'DAMAGE';
  gatewayReference: string | null;
  capturedAmountMinor: number | null;
  refundedAmountMinor?: number;
  createdAt: number;
  updatedAt: number;
  tenderType?: 'CARD' | 'CASH';
  cardLast4?: string | null;
  cardBrand?: string | null;
  fxRate?: string | null;
  fxRateAt?: number | null;
  balanceAtRisk?: boolean;
  dispute?: {
    disputeId: string;
    status: 'open' | 'closed';
    reason: string;
    openedAt: number;
  } | null;
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
  checks: NightAuditCheckPreviewRow[];
};

export type PropertyDoRpc = {
  generateCityLedgerStatement(
    propertyId: string,
    accountId: string,
    input?: { asOfDate?: string; idempotencyKey?: string },
  ): Promise<{ classified: ClassifiedResponse; body: unknown }>;
};

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function createClient(opts: {
  transport: Transport;
  queued: ReturnType<typeof createQueuedCommandLog>;
  entitlements: ReturnType<typeof createEntitlementStore>;
  keyStore: Map<string, string>;
  propertyDoRpc?: PropertyDoRpc;
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
    async getFrontOfficeTape(
      propertyId: string,
      query: { fromDate: string; toDate: string; roomTypeId?: string },
    ) {
      const qs = new URLSearchParams({ fromDate: query.fromDate, toDate: query.toDate });
      if (query.roomTypeId) qs.set('roomTypeId', query.roomTypeId);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/front-desk/tape?${qs.toString()}`,
      );
      return body as {
        ok: true;
        fromDate: string;
        toDate: string;
        asOf: number;
        rooms: Array<{
          roomId: string;
          roomTypeId: string;
          code: string;
          status: string;
          floor: string | null;
        }>;
        blocks: FrontDeskItem[];
        ooo: Array<{
          oooId: string;
          roomId: string;
          startDate: string;
          endDate: string;
          reason: string | null;
        }>;
      };
    },
    async getAuditLog(
      propertyId: string,
      query: {
        actor?: string;
        shiftId?: string;
        reservationId?: string;
        fromAt?: number;
        toAt?: number;
        limit?: number;
      },
    ) {
      const qs = new URLSearchParams();
      if (query.actor) qs.set('actor', query.actor);
      if (query.shiftId) qs.set('shiftId', query.shiftId);
      if (query.reservationId) qs.set('reservationId', query.reservationId);
      if (query.fromAt !== undefined) qs.set('fromAt', String(query.fromAt));
      if (query.toAt !== undefined) qs.set('toAt', String(query.toAt));
      if (query.limit !== undefined) qs.set('limit', String(query.limit));
      const suffix = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/audit-log${suffix ? `?${suffix}` : ''}`,
      );
      return body as {
        ok: true;
        rows: Array<{
          seq: number;
          at: number;
          actor: string;
          commandId: string;
          entityType: string;
          entityId: string;
          beforeJson: unknown | null;
          afterJson: unknown;
          shiftId: string | null;
          reservationId: string | null;
          createdAt: number;
        }>;
      };
    },
    async getFrontOfficeDirectory(
      propertyId: string,
      query: {
        window: 'today' | 'tomorrow' | 'week' | 'all';
        date?: string;
        status?: string;
        cursor?: string | null;
      },
    ) {
      const qs = new URLSearchParams({ window: query.window });
      if (query.date) qs.set('date', query.date);
      if (query.status) qs.set('status', query.status);
      if (query.cursor) qs.set('cursor', query.cursor);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/front-desk/directory?${qs.toString()}`,
      );
      return body as ListPage<FrontDeskItem>;
    },
    async getAvailableRooms(
      propertyId: string,
      query: { fromDate: string; toDate: string; roomTypeId?: string },
    ) {
      const qs = new URLSearchParams({ fromDate: query.fromDate, toDate: query.toDate });
      if (query.roomTypeId) qs.set('roomTypeId', query.roomTypeId);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/front-desk/available-rooms?${qs.toString()}`,
      );
      return body as {
        ok: true;
        fromDate: string;
        toDate: string;
        asOf: number;
        rooms: Array<{
          roomId: string;
          roomTypeId: string;
          code: string;
          status: string;
          floor: string | null;
        }>;
      };
    },
    async getFrontOfficeSummary(propertyId: string, date: string) {
      const qs = new URLSearchParams({ date });
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/front-desk/summary?${qs.toString()}`,
      );
      return body as {
        ok: true;
        date: string;
        asOf: number;
        arrivals: number;
        departuresDue: number;
        departed: number;
        inHouse: number;
        overstay: number;
        occupancy: { occupiedRooms: number; sellableRooms: number };
      };
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
    async listEventConsumerExceptions(
      propertyId: string,
      query?: { status?: 'open' | 'all'; limit?: number },
    ) {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      if (query?.limit !== undefined) qs.set('limit', String(query.limit));
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/event-consumer-exceptions${q ? `?${q}` : ''}`,
      );
      return body as {
        ok: true;
        count: number;
        exceptions: Array<{
          exceptionId: string;
          consumerId: string;
          consumerLabel: string;
          eventType: string;
          attempts: number;
          firstFailedAt: number;
          lastFailedAt: number;
          errorCode: string;
          errorDetail: string | null;
          resolvedAt: number | null;
          resolution: string | null;
        }>;
      };
    },
    async retryEventConsumerException(propertyId: string, exceptionId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/event-consumer-exceptions/${enc(exceptionId)}/retry`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async dismissEventConsumerException(
      propertyId: string,
      exceptionId: string,
      reason: string,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/event-consumer-exceptions/${enc(exceptionId)}/dismiss`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey, reason }),
        },
      );
    },
    async getProvisionalExceptions(
      propertyId: string,
      query?: {
        resolution?: 'open' | 'resolved' | 'all';
        commandType?: string;
        reason?: string;
        businessDateFrom?: string;
        businessDateTo?: string;
        assigned?: 'all' | 'unassigned' | 'assigned';
        assignedTo?: string;
        limit?: number;
        cursor?: string;
      },
    ) {
      const qs = new URLSearchParams();
      if (query) {
        if (query.resolution !== undefined) qs.set('resolution', query.resolution);
        if (query.commandType !== undefined) qs.set('commandType', query.commandType);
        if (query.reason !== undefined) qs.set('reason', query.reason);
        if (query.businessDateFrom !== undefined) qs.set('businessDateFrom', query.businessDateFrom);
        if (query.businessDateTo !== undefined) qs.set('businessDateTo', query.businessDateTo);
        if (query.assigned !== undefined) qs.set('assigned', query.assigned);
        if (query.assignedTo !== undefined) qs.set('assignedTo', query.assignedTo);
        if (query.limit !== undefined) qs.set('limit', String(query.limit));
        if (query.cursor !== undefined) qs.set('cursor', query.cursor);
      }
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions${q ? `?${q}` : ''}`,
      );
      return body;
    },
    async getOrgEntitlements(orgId: string): Promise<EntitlementSnapshot> {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/entitlements`);
      const snap = body as EntitlementSnapshot;
      opts.entitlements.set(snap);
      return snap;
    },
    async assignRoom(
      propertyId: string,
      reservationId: string,
      roomId: string,
      opId: string,
      extra?: { reason?: string },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      const reason = extra?.reason;
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/assign-room`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            roomId,
            idempotencyKey,
            ...(reason !== undefined ? { reason } : {}),
          }),
        },
      );
    },
    async checkIn(
      propertyId: string,
      reservationId: string,
      opId: string,
      extra?: { roomId?: string; overrideCleanliness?: boolean },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/check-in`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            ...(extra?.roomId !== undefined ? { roomId: extra.roomId } : {}),
            ...(extra?.overrideCleanliness !== undefined
              ? { overrideCleanliness: extra.overrideCleanliness }
              : {}),
          }),
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
    async searchReservations(propertyId: string, q: string) {
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations-search?q=${encodeURIComponent(q)}`,
      );
    },
    /** Desk search. `q` stays in the JSON body so names never land in a URL. */
    async searchDesk(propertyId: string, q: string) {
      return getJson(`/v1/properties/${enc(propertyId)}/reservations-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
      });
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
    async listRecurringCharges(
      propertyId: string,
      reservationId: string,
    ): Promise<{ ok: true; charges: RecurringCharge[] }> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/recurring-charges`,
      );
      const r = body as { ok?: true; charges?: RecurringCharge[] };
      return { ok: true, charges: Array.isArray(r.charges) ? r.charges : [] };
    },
    async scheduleRecurringCharge(
      propertyId: string,
      reservationId: string,
      input: {
        recurringChargeId: string;
        productId: string;
        quantity: number;
        startDate: string;
        endDate: string | null;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/recurring-charges`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recurringChargeId: input.recurringChargeId,
            productId: input.productId,
            quantity: input.quantity,
            startDate: input.startDate,
            endDate: input.endDate,
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async cancelRecurringCharge(
      propertyId: string,
      reservationId: string,
      recurringChargeId: string,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/recurring-charges/${enc(recurringChargeId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
        { reservationId },
      );
    },
    async recordCashPayment(
      propertyId: string,
      reservationId: string,
      input: { paymentId: string; amountMinor: number; currency?: string },
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
            ...(input.currency ? { currency: input.currency } : {}),
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async authorizePayment(
      propertyId: string,
      reservationId: string,
      input: {
        paymentId: string;
        amountMinor: number;
        currency?: string;
        purpose?: 'STAY' | 'DAMAGE';
      },
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
            ...(input.currency ? { currency: input.currency } : {}),
            ...(input.purpose ? { purpose: input.purpose } : {}),
            idempotencyKey,
          }),
        },
        { reservationId },
      );
    },
    async listFxRates(propertyId: string): Promise<{ ledgerCurrency: string | null; rates: FxRateRow[] }> {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/fx-rates`);
      const r = body as { ledgerCurrency?: string | null; rates?: FxRateRow[] };
      return { ledgerCurrency: r.ledgerCurrency ?? null, rates: Array.isArray(r.rates) ? r.rates : [] };
    },
    async createFxRate(
      propertyId: string,
      input: { quoteId: string; fromCurrency: string; toCurrency: string; rate: string; effectiveFrom: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/fx-rates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async supersedeFxRate(
      propertyId: string,
      supersedeQuoteId: string,
      input: { quoteId: string; rate: string; effectiveFrom: number },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/fx-rates/${enc(supersedeQuoteId)}/supersede`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async recordChargeback(
      propertyId: string,
      paymentId: string,
      input: { feeLedgerMinor: number; reason: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/folio/payments/${enc(paymentId)}/chargeback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async postFxAdjustment(
      propertyId: string,
      reservationId: string,
      input: {
        folioWindowId: string;
        kind: 'gain' | 'loss';
        amountMinor: number;
        reason: string;
        sourcePaymentId?: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/fx-adjustment`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
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
      input: {
        splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
      },
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
    async openFolioWindow(
      propertyId: string,
      reservationId: string,
      input: { kind: 'COMPANY' | 'MASTER'; billedParty?: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/windows`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async closeFolioWindow(propertyId: string, folioWindowId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/windows/${enc(folioWindowId)}/close`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async reopenFolioWindow(propertyId: string, folioWindowId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/windows/${enc(folioWindowId)}/reopen`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async transferFolioLine(
      propertyId: string,
      sourceFolioLineId: string,
      input: { destinationFolioWindowId: string },
      opId: string,
    ): Promise<FolioTransferResult> {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/folio/lines/${enc(sourceFolioLineId)}/transfer`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            destinationFolioWindowId: input.destinationFolioWindowId,
            idempotencyKey,
          }),
        },
      );
      return body as FolioTransferResult;
    },
    async voidPayment(propertyId: string, paymentId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/payments/${enc(paymentId)}/void`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async reconcilePayment(
      propertyId: string,
      paymentId: string,
      input: { outcome: 'authorized' | 'declined'; gatewayReference?: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/payments/${enc(paymentId)}/reconcile`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async refundPayment(
      propertyId: string,
      paymentId: string,
      amountMinor: number,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/payments/${enc(paymentId)}/refund`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amountMinor, idempotencyKey }),
        },
      );
    },
    async postDiscount(
      propertyId: string,
      sourceFolioLineId: string,
      input: {
        kind: 'percent' | 'fixed';
        bps?: number;
        amountMinor?: number;
        reason: string;
        folioLineId: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/lines/${enc(sourceFolioLineId)}/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async postStayDiscount(
      propertyId: string,
      reservationId: string,
      input: {
        kind: 'percent' | 'fixed';
        bps?: number;
        amountMinor?: number;
        reason: string;
        folioLineId: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async captureDue(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/folio/capture-due`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async checkOut(
      propertyId: string,
      reservationId: string,
      opId: string,
      extra?: { overrideBalance?: boolean },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/check-out`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            ...(extra?.overrideBalance !== undefined ? { overrideBalance: extra.overrideBalance } : {}),
          }),
        },
        { reservationId },
      );
    },
    async earlyDepart(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/early-depart`,
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
      input: {
        guestId: string;
        displayName: string;
        email?: string;
        phone?: string;
        tags?: string[];
        vip?: boolean;
        notes?: string;
      },
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
      if (input.tags !== undefined) payload.tags = input.tags;
      if (input.vip !== undefined) payload.vip = input.vip;
      if (input.notes !== undefined) payload.notes = input.notes;
      return getJson(`/v1/properties/${enc(propertyId)}/guests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },

    async listGuests(propertyId: string, query?: { cursor?: string; limit?: number }) {
      const qs = new URLSearchParams();
      if (query?.cursor) qs.set('cursor', query.cursor);
      if (query?.limit != null) qs.set('limit', String(query.limit));
      const q = qs.toString();
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/guests${q ? `?${q}` : ''}`);
      return body;
    },

    async searchGuests(
      propertyId: string,
      input: { q: string; cursor?: string; limit?: number },
    ) {
      return getJson(`/v1/properties/${enc(propertyId)}/guests-search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },

    async listGuestStays(
      propertyId: string,
      guestId: string,
      query?: { cursor?: string; limit?: number },
    ) {
      const qs = new URLSearchParams();
      if (query?.cursor) qs.set('cursor', query.cursor);
      if (query?.limit != null) qs.set('limit', String(query.limit));
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestId)}/stays${q ? `?${q}` : ''}`,
      );
      return body;
    },

    async getGuest(propertyId: string, guestId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/guests/${enc(guestId)}`);
      return body;
    },

    async updateGuest(
      propertyId: string,
      guestId: string,
      input: {
        displayName: string;
        email?: string;
        phone?: string;
        tags?: string[];
        vip?: boolean;
        notes?: string;
        preferences?: import('@hospai/contracts').GuestPreferences | null;
        gstBuyer?: import('@hospai/contracts').GstBuyerFields | null;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      const payload: Record<string, unknown> = {
        displayName: input.displayName,
        idempotencyKey,
      };
      if (input.email !== undefined) payload.email = input.email;
      if (input.phone !== undefined) payload.phone = input.phone;
      if (input.tags !== undefined) payload.tags = input.tags;
      if (input.vip !== undefined) payload.vip = input.vip;
      if (input.notes !== undefined) payload.notes = input.notes;
      if ('preferences' in input) payload.preferences = input.preferences;
      if ('gstBuyer' in input) payload.gstBuyer = input.gstBuyer;
      return getJson(`/v1/properties/${enc(propertyId)}/guests/${enc(guestId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },

    async listGuestDocuments(propertyId: string, guestRef: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents`,
      );
      return body as { ok: true } & GuestDocumentList;
    },

    async readGuestDocument(propertyId: string, guestRef: string, documentId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents/${enc(documentId)}`,
      );
      return body;
    },

    async addGuestDocument(
      propertyId: string,
      guestRef: string,
      input: { documentId: string; kind: string; fields: Record<string, unknown> },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },

    async attachGuestDocumentScan(
      propertyId: string,
      guestRef: string,
      documentId: string,
      file: { contentType: string; bytes: Uint8Array },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents/${enc(documentId)}/scan`,
        {
          method: 'PUT',
          headers: {
            'content-type': file.contentType,
            'x-idempotency-key': idempotencyKey,
          },
          body: new Blob([file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer], {
            type: file.contentType,
          }),
        },
      );
    },

    async getGuestDocumentScan(propertyId: string, guestRef: string, documentId: string) {
      const res = await opts.transport.fetch(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents/${enc(documentId)}/scan`,
      );
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        return { ok: false as const, status: res.status, body };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        ok: true as const,
        bytes,
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      };
    },

    async removeGuestDocument(
      propertyId: string,
      guestRef: string,
      documentId: string,
      reason: string,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/documents/${enc(documentId)}/remove`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason, idempotencyKey }),
        },
      );
    },

    async getGuestConsent(propertyId: string, guestRef: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/consent`,
      );
      return body as {
        ok: true;
        current: Record<string, { status: string; source: string; noticeVersion: string; recordedAt: number } | null>;
        history: Array<{
          id: string;
          purpose: string;
          status: string;
          source: string;
          noticeVersion: string;
          recordedAt: number;
          recordedHere: boolean;
        }>;
      };
    },

    async updateGuestConsent(
      propertyId: string,
      guestRef: string,
      input: { purpose: string; status: 'GRANTED' | 'WITHDRAWN'; source: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/guests/${enc(guestRef)}/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },

    async eraseGuest(propertyId: string, guestId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/guests/${enc(guestId)}/erase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
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
        status?: 'inquiry' | 'pending' | 'confirmed';
        adults?: number;
        children?: number;
        ratePlanId?: string;
        promoCode?: string;
        sourceCode?: string;
        marketSegmentCode?: string;
        frontOfficeComment?: string;
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
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.adults !== undefined ? { adults: input.adults } : {}),
          ...(input.children !== undefined ? { children: input.children } : {}),
          ...(input.ratePlanId !== undefined ? { ratePlanId: input.ratePlanId } : {}),
          ...(input.promoCode !== undefined ? { promoCode: input.promoCode } : {}),
          ...(input.sourceCode !== undefined ? { sourceCode: input.sourceCode } : {}),
          ...(input.marketSegmentCode !== undefined
            ? { marketSegmentCode: input.marketSegmentCode }
            : {}),
          ...(input.frontOfficeComment !== undefined
            ? { frontOfficeComment: input.frontOfficeComment }
            : {}),
          idempotencyKey,
        }),
      });
    },
    async confirmReservation(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async modifyReservation(
      propertyId: string,
      reservationId: string,
      opId: string,
      body: {
        roomTypeId: string;
        arrivalDate: string;
        departureDate: string;
        adults?: number;
        children?: number;
        ratePlanId?: string;
        noPost?: boolean;
        quoteAriVersion?: number;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            roomTypeId: body.roomTypeId,
            arrivalDate: body.arrivalDate,
            departureDate: body.departureDate,
            ...(body.adults !== undefined ? { adults: body.adults } : {}),
            ...(body.children !== undefined ? { children: body.children } : {}),
            ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
            ...(body.noPost !== undefined ? { noPost: body.noPost } : {}),
            ...(body.quoteAriVersion !== undefined ? { quoteAriVersion: body.quoteAriVersion } : {}),
            idempotencyKey,
          }),
        },
      );
    },
    async cancelReservation(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async noShowReservation(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/no-show`,
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
    async cancelCheckIn(propertyId: string, reservationId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/cancel-check-in`,
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
    async holdReservation(
      propertyId: string,
      reservationId: string,
      opId: string,
      extra?: { ratePlanId?: string; confirmBy?: number },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/hold`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey,
            ...(extra?.ratePlanId !== undefined ? { ratePlanId: extra.ratePlanId } : {}),
            ...(extra?.confirmBy !== undefined ? { confirmBy: extra.confirmBy } : {}),
          }),
        },
      );
    },
    async updateFrontOffice(
      propertyId: string,
      reservationId: string,
      opId: string,
      extra: {
        frontOfficeComment?: string;
        vipFlag?: boolean;
        noPost?: boolean;
        dndFlag?: boolean;
        sourceCode?: string | null;
        marketSegmentCode?: string | null;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/front-office`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey,
            ...extra,
          }),
        },
      );
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
        oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
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
          oooRanges: Array<{ oooId: string; startDate: string; endDate: string; reason: string | null }>;
        }>;
      };
    },
    async setOooRange(
      propertyId: string,
      roomId: string,
      input: {
        startDate: string;
        endDate: string;
        oooId?: string;
        reason?: string;
        idempotencyKey: string;
      },
    ): Promise<{ ok: true; roomId: string; oooId: string; alreadyApplied?: true }> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}/ooo`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      return body as { ok: true; roomId: string; oooId: string; alreadyApplied?: true };
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
    async getHousekeepingPriorities(
      propertyId: string,
      date: string,
    ): Promise<{ ok: true; date: string; queue: HousekeepingPriorityQueueRow[] }> {
      const qs = new URLSearchParams({ date });
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/priorities?${qs}`,
      );
      return body as { ok: true; date: string; queue: HousekeepingPriorityQueueRow[] };
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
          ops: {
            shift: 'morning' | 'evening' | 'night' | 'any' | null;
            maxRooms: number | null;
            skills: string[];
          };
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
    async setRosterOps(
      propertyId: string,
      staffId: string,
      input: {
        shift: 'morning' | 'evening' | 'night' | 'any' | null;
        maxRooms: number | null;
        skills: string[];
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/roster/${enc(staffId)}/ops`, {
        method: 'PUT',
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
    async getNightAuditCheckLog(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/night-audit/check-log`);
      return body as NightAuditCheckLog;
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
    async getProvisionalException(propertyId: string, exceptionId: string) {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions/${enc(exceptionId)}`,
      );
      return body;
    },
    async retryProvisionalException(propertyId: string, exceptionId: string, opId: string) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions/${enc(exceptionId)}/retry`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async assignProvisionalException(
      propertyId: string,
      exceptionId: string,
      assignedTo: string | null,
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions/${enc(exceptionId)}/assign`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assignedTo, idempotencyKey }),
        },
      );
    },
    async addProvisionalExceptionNote(
      propertyId: string,
      exceptionId: string,
      input: { noteId: string; text: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/provisional-exceptions/${enc(exceptionId)}/notes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ noteId: input.noteId, text: input.text, idempotencyKey }),
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
    async setHousekeepingPriority(
      propertyId: string,
      input: {
        roomId: string;
        businessDate: string;
        level: HousekeepingPriorityLevelInput;
      },
      opId: string,
    ): Promise<{
      classified: ClassifiedResponse;
      body: {
        ok: true;
        roomId: string;
        businessDate: string;
        level: HousekeepingPriorityLevel | null;
      };
    }> {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/housekeeping/priority`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      }) as Promise<{
        classified: ClassifiedResponse;
        body: {
          ok: true;
          roomId: string;
          businessDate: string;
          level: HousekeepingPriorityLevel | null;
        };
      }>;
    },
    async getHousekeepingInventory(
      propertyId: string,
      query?: { archived?: boolean },
    ): Promise<{ ok: true; items: HousekeepingInventoryItemRow[] }> {
      const qs = new URLSearchParams();
      if (query?.archived) qs.set('archived', '1');
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/inventory${q ? `?${q}` : ''}`,
      );
      return body as { ok: true; items: HousekeepingInventoryItemRow[] };
    },
    async getHousekeepingInventoryMovements(
      propertyId: string,
      itemId: string,
    ): Promise<{ ok: true; movements: HousekeepingInventoryMovementRow[] }> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/inventory/items/${enc(itemId)}/movements`,
      );
      return body as { ok: true; movements: HousekeepingInventoryMovementRow[] };
    },
    async createHousekeepingInventoryItem(
      propertyId: string,
      input: {
        itemId: string;
        name: string;
        category: HousekeepingInventoryCategory;
        unit: string;
        parLevel: number;
        onHand: number;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/housekeeping/inventory/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateHousekeepingInventoryItem(
      propertyId: string,
      itemId: string,
      input: {
        name: string;
        category: HousekeepingInventoryCategory;
        unit: string;
        parLevel: number;
        archived: boolean;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/inventory/items/${enc(itemId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async adjustHousekeepingInventoryItem(
      propertyId: string,
      itemId: string,
      input: { kind: HousekeepingInventoryMovementKind; quantity: number; note?: string },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/housekeeping/inventory/items/${enc(itemId)}/adjust`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },

    async getMaintenanceTickets(
      propertyId: string,
      query?: { status?: 'active' | 'open' | 'in_progress' | 'closed' | 'all'; roomId?: string },
    ): Promise<{ tickets: MaintenanceTicketRow[] }> {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      if (query?.roomId) qs.set('roomId', query.roomId);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/maintenance/tickets${q ? `?${q}` : ''}`,
      );
      return body as { tickets: MaintenanceTicketRow[] };
    },
    async createMaintenanceTicket(
      propertyId: string,
      input: {
        ticketId: string;
        roomId: string;
        description: string;
        category?: MaintenanceCategory;
        priority?: MaintenancePriority;
        taskTypeId?: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/maintenance/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateMaintenanceTicket(
      propertyId: string,
      ticketId: string,
      input: {
        priority?: MaintenancePriority;
        description?: string;
        assigneeRef?: string | null;
        checklistDone?: boolean[];
        status?: MaintenanceStatus;
        resolutionNote?: string;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/maintenance/tickets/${enc(ticketId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async getMaintenanceTaskTypes(
      propertyId: string,
    ): Promise<{ taskTypes: MaintenanceTaskTypeRow[] }> {
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/maintenance/task-types`,
      );
      return body as { taskTypes: MaintenanceTaskTypeRow[] };
    },
    async createMaintenanceTaskType(
      propertyId: string,
      input: {
        taskTypeId: string;
        name: string;
        category: MaintenanceCategory;
        defaultPriority: MaintenancePriority;
        checklist: string[];
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/maintenance/task-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateMaintenanceTaskType(
      propertyId: string,
      taskTypeId: string,
      input: {
        name: string;
        category: MaintenanceCategory;
        defaultPriority: MaintenancePriority;
        checklist: string[];
        active: boolean;
      },
      opId: string,
    ) {
      const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/maintenance/task-types/${enc(taskTypeId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },

    async listRoomTypes(
      propertyId: string,
      query?: { status?: 'active' | 'archived' | 'all' },
    ) {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/room-types${q ? `?${q}` : ''}`,
      );
      return body as { ok: true; roomTypes: RoomTypeRead[] };
    },
    async createRoomType(
      propertyId: string,
      input: {
        roomTypeId: string;
        code: string;
        name: string;
        kind?: 'physical' | 'virtual';
        roomCount?: number;
        maxOccupancy: number;
        maxAdults: number;
        constituentRoomTypeIds?: string[];
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `room-type:create:${input.roomTypeId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/room-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateRoomType(
      propertyId: string,
      roomTypeId: string,
      input: {
        code?: string;
        name?: string;
        roomCount?: number;
        maxOccupancy?: number;
        maxAdults?: number;
        constituentRoomTypeIds?: string[];
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `room-type:update:${roomTypeId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/room-types/${enc(roomTypeId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async archiveRoomType(propertyId: string, roomTypeId: string) {
      const idempotencyKey = stableKeyForOperation(
        `room-type:archive:${roomTypeId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/room-types/${enc(roomTypeId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
    async archiveRoom(propertyId: string, roomId: string) {
      const idempotencyKey = stableKeyForOperation(`room:archive:${roomId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
    async createRoom(
      propertyId: string,
      input: { roomId: string; roomTypeId: string; code: string; floor?: string },
    ) {
      const idempotencyKey = stableKeyForOperation(`room:create:${input.roomId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateRoom(
      propertyId: string,
      roomId: string,
      input: { code?: string; floor?: string },
    ) {
      const idempotencyKey = stableKeyForOperation(`room:update:${roomId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/rooms/${enc(roomId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async listRatePlans(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/rate-plans`);
      return body as { ok: true; plans: RatePlanListItem[] };
    },
    async createRatePlan(
      propertyId: string,
      input: {
        ratePlanId: string;
        code: string;
        name: string;
        cancelPenaltyType?: string;
        cancelGraceHours?: number;
        cancelPenaltyNights?: number | null;
        cancelPenaltyBps?: number | null;
        cancelPolicyText?: string | null;
        parentRatePlanId?: string | null;
        deriveBps?: number | null;
        inclusions?: RatePlanInclusionInput[];
        inclusionTax?: InclusionTaxMode;
        inclusionBandJoin?: boolean;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `rate-plan:create:${input.ratePlanId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-plans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateRatePlan(propertyId: string, ratePlanId: string, patch: Record<string, unknown>) {
      const idempotencyKey = stableKeyForOperation(
        `rate-plan:update:${ratePlanId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-plans/${enc(ratePlanId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...patch, idempotencyKey }),
      });
    },
    async archiveRatePlan(propertyId: string, ratePlanId: string) {
      const idempotencyKey = stableKeyForOperation(
        `rate-plan:archive:${ratePlanId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-plans/${enc(ratePlanId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
    async generateInvoice(
      propertyId: string,
      input: {
        reservationId: string;
        folioWindowId?: string;
        idempotencyKey?: string;
        generatedBy?: 'checkout' | 'desk';
        buyer?: { type: 'REGISTERED' | 'UNREGISTERED'; fields: Record<string, string> } | null;
      },
    ) {
      const idempotencyKey =
        input.idempotencyKey ??
        stableKeyForOperation(`invoice:generate:${input.reservationId}`, opts.keyStore);
      try {
        return await getJson(`/v1/properties/${enc(propertyId)}/invoices`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reservationId: input.reservationId,
            ...(input.folioWindowId ? { folioWindowId: input.folioWindowId } : {}),
            ...(input.generatedBy ? { generatedBy: input.generatedBy } : {}),
            ...(input.buyer !== undefined ? { buyer: input.buyer } : {}),
            idempotencyKey,
          }),
        });
      } catch (e) {
        if (e instanceof ClassifiedError) {
          const body = e.classified.body;
          if (
            e.classified.status === 409 &&
            body &&
            typeof body === 'object' &&
            'error' in body &&
            (body as { error?: string }).error === 'invoice_already_exists' &&
            'invoiceId' in body &&
            typeof (body as { invoiceId?: unknown }).invoiceId === 'string'
          ) {
            return { classified: e.classified, body };
          }
        }
        throw e;
      }
    },
    async getInvoice(propertyId: string, invoiceId: string) {
      return getJson(`/v1/properties/${enc(propertyId)}/invoices/${enc(invoiceId)}`);
    },
    async getInvoiceBuyer(propertyId: string, invoiceId: string) {
      return getJson(`/v1/properties/${enc(propertyId)}/invoices/${enc(invoiceId)}/buyer`);
    },
    async voidInvoice(
      propertyId: string,
      invoiceId: string,
      input?: { reason?: string; idempotencyKey?: string },
    ) {
      const idempotencyKey =
        input?.idempotencyKey ?? stableKeyForOperation(`invoice:void:${invoiceId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/invoices/${enc(invoiceId)}/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey, ...(input?.reason ? { reason: input.reason } : {}) }),
      });
    },
    async createCityLedgerAccount(
      propertyId: string,
      input: {
        name: string;
        creditLimitMinor?: number;
        termsDays?: number;
        gst?: import('@hospai/contracts').GstBuyerFields | null;
        idempotencyKey?: string;
      },
    ) {
      const idempotencyKey =
        input.idempotencyKey ??
        stableKeyForOperation(`city-ledger:create:${input.name.trim()}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/city-ledger/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: input.name,
          ...(input.creditLimitMinor !== undefined ? { creditLimitMinor: input.creditLimitMinor } : {}),
          ...(input.termsDays !== undefined ? { termsDays: input.termsDays } : {}),
          ...(input.gst !== undefined ? { gst: input.gst } : {}),
          idempotencyKey,
        }),
      });
    },
    async fetchCityLedgerAccounts(propertyId: string, opts2?: { status?: 'active' | 'all' }) {
      const q = opts2?.status ? `?status=${encodeURIComponent(opts2.status)}` : '';
      return getJson(`/v1/properties/${enc(propertyId)}/city-ledger/accounts${q}`);
    },
    async fetchCityLedgerAccount(propertyId: string, accountId: string) {
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts?accountId=${encodeURIComponent(accountId)}`,
      );
    },
    async updateCityLedgerAccount(
      propertyId: string,
      accountId: string,
      patch: {
        name?: string;
        creditLimitMinor?: number;
        termsDays?: number;
        gst?: import('@hospai/contracts').GstBuyerFields | null;
        idempotencyKey?: string;
      },
    ) {
      const idempotencyKey =
        patch.idempotencyKey ??
        stableKeyForOperation(`city-ledger:update:${accountId}`, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts/${enc(accountId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...('gst' in patch ? { gst: patch.gst } : {}),
            ...(patch.creditLimitMinor !== undefined
              ? { creditLimitMinor: patch.creditLimitMinor }
              : {}),
            ...(patch.termsDays !== undefined ? { termsDays: patch.termsDays } : {}),
            idempotencyKey,
          }),
        },
      );
    },
    async archiveCityLedgerAccount(
      propertyId: string,
      accountId: string,
      input?: { idempotencyKey?: string },
    ) {
      const idempotencyKey =
        input?.idempotencyKey ??
        stableKeyForOperation(`city-ledger:archive:${accountId}`, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts/${enc(accountId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'archived', idempotencyKey }),
        },
      );
    },
    async receiveCityLedgerPayment(
      propertyId: string,
      accountId: string,
      input: {
        amountMinor: number;
        businessDate?: string;
        reference?: string | null;
        idempotencyKey?: string;
      },
    ) {
      const idempotencyKey =
        input.idempotencyKey ??
        stableKeyForOperation(
          `city-ledger:payment:${accountId}:${input.amountMinor}`,
          opts.keyStore,
        );
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts/${enc(accountId)}/payments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amountMinor: input.amountMinor,
            ...(input.businessDate !== undefined ? { businessDate: input.businessDate } : {}),
            ...(input.reference !== undefined ? { reference: input.reference } : {}),
            idempotencyKey,
          }),
        },
      );
    },
    async generateCityLedgerStatement(
      propertyId: string,
      accountId: string,
      input?: { asOfDate?: string; idempotencyKey?: string },
    ) {
      if (!opts.propertyDoRpc?.generateCityLedgerStatement) {
        throw new Error('generateCityLedgerStatement requires propertyDoRpc');
      }
      return opts.propertyDoRpc.generateCityLedgerStatement(propertyId, accountId, input);
    },
    async fetchCityLedgerStatement(propertyId: string, accountId: string, statementId: string) {
      return getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts/${enc(accountId)}/statements/${enc(statementId)}`,
      );
    },
    async validateCityLedgerBilledParty(propertyId: string, billedParty: string) {
      const trimmed = billedParty.trim();
      const { classified, body } = await getJson(
        `/v1/properties/${enc(propertyId)}/city-ledger/accounts?status=active`,
      );
      const accounts = (body as { accounts?: Array<{ accountId: string; name: string }> }).accounts ?? [];
      const match = accounts.find((a) => a.accountId === trimmed || a.name === trimmed);
      if (match) {
        return {
          classified,
          body: { ok: true, billedParty: match.name, accountId: match.accountId },
        };
      }
      return {
        classified,
        body: { ok: false, error: 'city_ledger_billed_party_invalid' as const },
      };
    },
    async listRatePromos(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/rate-promos`);
      return body as {
        ok: true;
        promos: Array<{
          promoId: string;
          code: string;
          name: string;
          kind: 'percent' | 'fixed_per_night';
          bps: number | null;
          amountMinor: number | null;
          validFrom: string | null;
          validTo: string | null;
          ratePlanId: string | null;
        }>;
      };
    },
    async createRatePromo(
      propertyId: string,
      input: {
        promoId: string;
        code: string;
        name: string;
        kind: 'percent' | 'fixed_per_night';
        bps?: number;
        amountMinor?: number;
        validFrom?: string | null;
        validTo?: string | null;
        ratePlanId?: string | null;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:create:${input.promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateRatePromo(propertyId: string, promoId: string, patch: Record<string, unknown>) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:update:${promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos/${enc(promoId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...patch, idempotencyKey }),
      });
    },
    async archiveRatePromo(propertyId: string, promoId: string) {
      const idempotencyKey = stableKeyForOperation(
        `rate-promo:archive:${promoId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-promos/${enc(promoId)}`, {
        method: 'DELETE',
        headers: { 'x-idempotency-key': idempotencyKey },
      });
    },
    async listRateDays(
      propertyId: string,
      query: { fromDate: string; toDate: string; roomTypeId?: string; ratePlanId?: string },
    ) {
      const qs = new URLSearchParams();
      qs.set('fromDate', query.fromDate);
      qs.set('toDate', query.toDate);
      if (query.roomTypeId) qs.set('roomTypeId', query.roomTypeId);
      if (query.ratePlanId) qs.set('ratePlanId', query.ratePlanId);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/rate-days?${qs.toString()}`,
      );
      return body as { ok: true; days: unknown[] };
    },
    async putRateDay(
      propertyId: string,
      input: {
        roomTypeId: string;
        ratePlanId?: string;
        stayDate: string;
        amountMinor: number;
        currency: string;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `rate-day:${input.roomTypeId}:${input.ratePlanId ?? 'BAR'}:${input.stayDate}:${input.amountMinor}:${input.currency}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rate-days`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async bulkUpdateRates(
      propertyId: string,
      updates: Array<{
        roomTypeId: string;
        ratePlanId?: string;
        stayDate: string;
        amountMinor: number;
        currency: string;
      }>,
    ) {
      const idempotencyKey = stableKeyForOperation(
        `rates:bulk:${propertyId}:${updates
          .map((u) => `${u.roomTypeId}:${u.ratePlanId ?? 'BAR'}:${u.stayDate}:${u.amountMinor}:${u.currency}`)
          .join(',')}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/rates/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates, idempotencyKey }),
      });
    },
    async listRestrictionDays(
      propertyId: string,
      query: { fromDate: string; toDate: string; roomTypeId?: string },
    ) {
      const qs = new URLSearchParams();
      qs.set('fromDate', query.fromDate);
      qs.set('toDate', query.toDate);
      if (query.roomTypeId) qs.set('roomTypeId', query.roomTypeId);
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/restriction-days?${qs.toString()}`,
      );
      return body as { ok: true; days: unknown[] };
    },
    async putRestrictionDay(
      propertyId: string,
      input: {
        roomTypeId: string;
        stayDate: string;
        minLos?: number | null;
        maxLos?: number | null;
        cta?: boolean;
        ctd?: boolean;
        stopSell?: boolean;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `restriction-day:${input.roomTypeId}:${input.stayDate}:${input.minLos ?? ''}:${input.maxLos ?? ''}:${input.cta ? 1 : 0}:${input.ctd ? 1 : 0}:${input.stopSell ? 1 : 0}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/restriction-days`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async listOperationalConfig(propertyId: string): Promise<OperationalConfigRead> {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/operational-config`);
      return body as OperationalConfigRead;
    },
    async putOperationalConfig(
      propertyId: string,
      key: OperationalConfigKey,
      value: NamedListEntry[],
      reason: string,
    ) {
      const idempotencyKey = stableKeyForOperation(
        `operational-config:${key}:${JSON.stringify(value)}:${reason}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/operational-config/${enc(key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, reason, idempotencyKey }),
      });
    },
    async getGuestSettings(
      orgId: string,
    ): Promise<{ ok: true; value: GuestSettings; version: number }> {
      const { body } = await getJson(`/v1/orgs/${enc(orgId)}/guest-settings`);
      return body as { ok: true; value: GuestSettings; version: number };
    },
    /**
     * `baseVersion` is the stored version the edit started from. It is part of the
     * operation id, so saving A, then B, then A again is three writes, not a replay of the first.
     */
    async putGuestSettings(
      orgId: string,
      value: GuestSettings,
      reason: string,
      baseVersion: number,
    ) {
      const idempotencyKey = stableKeyForOperation(
        `guest-settings:v${baseVersion}:${JSON.stringify(value)}:${reason}`,
        opts.keyStore,
      );
      return getJson(`/v1/orgs/${enc(orgId)}/guest-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, reason, idempotencyKey }),
      });
    },
    async listDomainConfig(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/config/domain`);
      return body as { ok: true; keys: unknown[] };
    },
    async putDomainConfig(
      propertyId: string,
      input: { key: string; value: unknown; reason: string; effectiveFrom?: string },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `domain-config:${input.key}:${JSON.stringify(input.value)}:${input.reason}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/config/domain`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updatePropertyDetails(propertyId: string, input: { name: string }) {
      const idempotencyKey = stableKeyForOperation(
        `property:details:${propertyId}:${input.name}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async listChargeCodes(propertyId: string, query?: { status?: 'active' | 'archived' | 'all' }) {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/charge-codes${q ? `?${q}` : ''}`,
      );
      return body as { ok: true; codes: unknown[] };
    },
    async createChargeCode(propertyId: string, input: { code: string; name: string }) {
      const idempotencyKey = stableKeyForOperation(
        `charge-code:create:${input.code}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/charge-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateChargeCode(
      propertyId: string,
      code: string,
      input: { name?: string; taxGroup?: string | null },
    ) {
      const idempotencyKey = stableKeyForOperation(`charge-code:update:${code}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/charge-codes/${enc(code)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async setChargeCodeStatus(propertyId: string, code: string, status: 'active' | 'archived') {
      const idempotencyKey = stableKeyForOperation(
        `charge-code:status:${code}:${status}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/charge-codes/${enc(code)}/status`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, idempotencyKey }),
      });
    },
    async listProducts(propertyId: string, query?: { status?: 'active' | 'all' }) {
      const qs = query?.status === 'all' ? '?status=all' : '';
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/products${qs}`);
      return body as ProductsList;
    },
    async createProductCategory(
      propertyId: string,
      input: { categoryId: string; name: string; sortOrder?: number },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `product-category:create:${input.categoryId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/product-categories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateProductCategory(
      propertyId: string,
      categoryId: string,
      input: { name?: string; sortOrder?: number; status?: 'active' | 'archived' },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `product-category:update:${categoryId}:${JSON.stringify(input)}`,
        opts.keyStore,
      );
      return getJson(
        `/v1/properties/${enc(propertyId)}/product-categories/${enc(categoryId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async createProduct(
      propertyId: string,
      input: {
        productId: string;
        categoryId: string;
        name: string;
        sku?: string | null;
        chargeCode: string;
        defaultAmountMinor: number;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `product:create:${input.productId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/products`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async updateProduct(
      propertyId: string,
      productId: string,
      input: {
        categoryId?: string;
        name?: string;
        sku?: string | null;
        chargeCode?: string;
        defaultAmountMinor?: number;
        status?: 'active' | 'archived';
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `product:update:${productId}:${JSON.stringify(input)}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/products/${enc(productId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async listFolioRoutingRules(propertyId: string, query?: { status?: 'active' | 'archived' | 'all' }) {
      const qs = new URLSearchParams();
      if (query?.status) qs.set('status', query.status);
      const q = qs.toString();
      const { body } = await getJson(
        `/v1/properties/${enc(propertyId)}/folio/routing-rules${q ? `?${q}` : ''}`,
      );
      return body as {
        ok: true;
        rules: Array<{ ruleId: string; chargeCode: string; destWindowKind: string; status: string }>;
      };
    },
    async putFolioRoutingRule(
      propertyId: string,
      ruleId: string,
      input: { chargeCode: string; destWindowKind: 'COMPANY' | 'MASTER' },
    ) {
      const idempotencyKey = stableKeyForOperation(`routing-rule:upsert:${ruleId}`, opts.keyStore);
      return getJson(`/v1/properties/${enc(propertyId)}/folio/routing-rules/${enc(ruleId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async archiveFolioRoutingRule(propertyId: string, ruleId: string) {
      const idempotencyKey = stableKeyForOperation(`routing-rule:archive:${ruleId}`, opts.keyStore);
      return getJson(
        `/v1/properties/${enc(propertyId)}/folio/routing-rules/${enc(ruleId)}/archive`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idempotencyKey }),
        },
      );
    },
    async listTaxRules(propertyId: string, query?: { taxGroup?: string; effectiveDate?: string }) {
      const params = new URLSearchParams();
      if (query?.taxGroup) params.set('taxGroup', query.taxGroup);
      if (query?.effectiveDate) params.set('effectiveDate', query.effectiveDate);
      const queryString = params.toString();
      const suffix = queryString.length > 0 ? `?${queryString}` : '';
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/tax-rules${suffix}`);
      return body as { ok: true; rules: unknown[] };
    },
    async listTaxDeclarations(propertyId: string) {
      const { body } = await getJson(`/v1/properties/${enc(propertyId)}/tax-declarations`);
      return body as { ok: true; declarations: unknown[] };
    },
    async setTaxDeclaration(
      propertyId: string,
      input: { declarationId: string; declarationKey: string; value: string; validFrom: string },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `tax-declaration:${input.declarationId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/tax-declarations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async createTaxRule(
      propertyId: string,
      input: {
        taxRuleId: string;
        ruleKey: string;
        name: string;
        ruleType: string;
        rate?: string;
        taxGroup: string;
        outputChargeCode?: string;
        validFrom: string;
        validTo?: string | null;
        priceMode?: string;
        sequence?: number;
        base?: string;
        conditionKey?: string | null;
        conditionValue?: string | null;
        rebandsOnDiscount?: boolean;
        bands?: Array<{
          upToMinor: number | null;
          components: Array<{ outputChargeCode: string; rate: string }>;
        }>;
      },
    ) {
      const idempotencyKey = stableKeyForOperation(
        `tax-rule:create:${input.taxRuleId}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/tax-rules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, idempotencyKey }),
      });
    },
    async supersedeTaxRule(propertyId: string, taxRuleId: string, input: Record<string, unknown>) {
      const idempotencyKey = stableKeyForOperation(
        `tax-rule:supersede:${taxRuleId}`,
        opts.keyStore,
      );
      return getJson(
        `/v1/properties/${enc(propertyId)}/tax-rules/${enc(taxRuleId)}/supersede`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    async endTaxRule(propertyId: string, ruleKey: string, input: { validTo: string }) {
      const idempotencyKey = stableKeyForOperation(
        `tax-rule:end:${ruleKey}:${input.validTo}`,
        opts.keyStore,
      );
      return getJson(`/v1/properties/${enc(propertyId)}/tax-rules/${enc(ruleKey)}/end`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ validTo: input.validTo, idempotencyKey }),
      });
    },
  };
}
