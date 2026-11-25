/**
 * R7.4 head-office view: the shapes one hotel reports, the response of
 * `GET /v1/orgs/:orgId/head-office`, and the one rule for the group total.
 * Counts, dates, one money figure and a currency code. No guest data, no error text.
 */

export type HeadOfficeAuditState = 'idle' | 'running' | 'halted';

/** What one hotel's `PropertyDO.readHeadOfficeRow()` returns (the hotel name is added by the consumer). */
export type HeadOfficeRowRead = {
  propertyId: string;
  businessDate: string;
  audit: {
    state: HeadOfficeAuditState;
    failedStep: string | null;
    lastCompletedDate: string | null;
    lastCompletedAt: number | null;
  };
  closed: HeadOfficeClosed | null;
  today: { arrivals: number; departuresDue: number; inHouse: number };
  /** Monotonic for this hotel: the highest outbox `seq` at read time. */
  stateVersion: number;
};

export type HeadOfficeClosed = {
  businessDate: string;
  currency: string;
  roomRevenueMinor: number;
  roomsSold: number;
  roomsSellable: number;
};

export type HeadOfficeRow = {
  propertyId: string;
  propertyName: string;
  businessDate: string;
  audit: HeadOfficeRowRead['audit'];
  closed: HeadOfficeClosed | null;
  today: HeadOfficeRowRead['today'];
  updatedAt: number;
};

export type HeadOfficeTotal = {
  currency: string;
  roomRevenueMinor: number;
  roomsSold: number;
  roomsSellable: number;
};

export type HeadOfficeResponse = {
  orgId: string;
  rows: HeadOfficeRow[];
  /** Accessible hotels with no row yet (not audited since the projection shipped). */
  missing: string[];
  total: HeadOfficeTotal | null;
};

/**
 * The group total, only when every row has a closed block in the same currency and for the same
 * closed business date. Otherwise null: a sum across currencies or days would mislead. Integer sums.
 */
export function computeHeadOfficeTotal(rows: ReadonlyArray<Pick<HeadOfficeRow, 'closed'>>): HeadOfficeTotal | null {
  if (rows.length === 0) return null;
  const first = rows[0]!.closed;
  if (!first) return null;
  let roomRevenueMinor = 0;
  let roomsSold = 0;
  let roomsSellable = 0;
  for (const r of rows) {
    const c = r.closed;
    if (!c || c.currency !== first.currency || c.businessDate !== first.businessDate) return null;
    roomRevenueMinor += c.roomRevenueMinor;
    roomsSold += c.roomsSold;
    roomsSellable += c.roomsSellable;
  }
  return { currency: first.currency, roomRevenueMinor, roomsSold, roomsSellable };
}
