import { z } from 'zod';

/**
 * Housekeeping depth, Part C (R4.11): linen movements, minibar pickups, amenities.
 * Spec: docs/superpowers/specs/2026-11-20-housekeeping-depth-c-linen-minibar-amenities-design.md
 */

// ---------------------------------------------------------------------------
// Stock model (D1): every movement kind the rebuilt table allows
// ---------------------------------------------------------------------------

export const HOUSEKEEPING_STOCK_MOVEMENT_KINDS = [
  'receive',
  'issue',
  'count',
  'return',
  'laundry_out',
  'laundry_in',
  'discard',
  'adjust',
  'minibar',
  'amenity',
] as const;
export type HousekeepingStockMovementKind = (typeof HOUSEKEEPING_STOCK_MOVEMENT_KINDS)[number];

export function isHousekeepingStockMovementKind(v: unknown): v is HousekeepingStockMovementKind {
  return typeof v === 'string' && (HOUSEKEEPING_STOCK_MOVEMENT_KINDS as readonly string[]).includes(v);
}

/** Rows returned by each Part C list read. */
export const HK_STOCK_LIST_MAX = 500;
export const HK_STOCK_NOTE_MAX = 200;

// ---------------------------------------------------------------------------
// Linen movements (D2)
// ---------------------------------------------------------------------------

export const LINEN_MOVEMENT_KINDS = ['issue', 'return', 'laundry_out', 'laundry_in', 'discard', 'adjust'] as const;
export type LinenMovementKind = (typeof LINEN_MOVEMENT_KINDS)[number];

export const LINEN_CATEGORIES = ['linens', 'towels'] as const;

export function isLinenMovementKind(v: unknown): v is LinenMovementKind {
  return typeof v === 'string' && (LINEN_MOVEMENT_KINDS as readonly string[]).includes(v);
}

/** Kinds that take stock out of the shelf count. */
export const LINEN_SUBTRACTING_KINDS: readonly LinenMovementKind[] = ['issue', 'laundry_out', 'discard'];

export type LinenMovementInput = {
  itemId: string;
  kind: LinenMovementKind;
  /** Positive; `adjust` takes a signed, non-zero whole number. */
  quantity: number;
  roomId?: string | null;
  attendantRef?: string | null;
  note?: string | null;
  businessDate: string;
};

export type LinenMovementRow = {
  movementId: string;
  itemId: string;
  itemName: string;
  kind: HousekeepingStockMovementKind;
  quantity: number;
  onHandAfter: number;
  note: string | null;
  roomId: string | null;
  roomCode: string | null;
  attendantRef: string | null;
  actorRef: string;
  businessDate: string;
  createdAt: number;
};

export type LinenItemTotal = {
  itemId: string;
  name: string;
  category: 'linens' | 'towels';
  unit: string;
  onHand: number;
  /** Sum of laundry_out minus laundry_in, never below zero. */
  inLaundry: number;
  archived: boolean;
};

export type LinenMovementList = {
  ok: true;
  items: LinenItemTotal[];
  movements: LinenMovementRow[];
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Minibar (D3 to D5)
// ---------------------------------------------------------------------------

export const HK_MINIBAR_ITEMS_MAX = 50;
export const HK_MINIBAR_PICKUP_LINES_MAX = 20;
export const HK_MINIBAR_QTY_MAX = 20;
export const HK_MINIBAR_REASON_MAX = 200;
export const MINIBAR_CONFIG_KEY = 'pms.housekeeping.minibar';

export const MinibarConfigSchema = z
  .object({
    enabled: z.boolean(),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(120),
            inventoryItemId: z.string().min(1).max(120).nullable(),
          })
          .strict(),
      )
      .max(HK_MINIBAR_ITEMS_MAX),
  })
  .strict()
  .refine((c) => new Set(c.items.map((i) => i.productId)).size === c.items.length, {
    message: 'minibar_product_duplicate',
  });
export type MinibarConfig = z.infer<typeof MinibarConfigSchema>;
export const DEFAULT_MINIBAR_CONFIG: MinibarConfig = { enabled: false, items: [] };

/** Folio line id for a pickup line: deterministic, so a replay can never post a second charge. */
export function minibarFolioLineId(pickupLineId: string): string {
  return `fl_${pickupLineId}`;
}

export const MINIBAR_PICKUP_STATUSES = ['posted', 'complimentary'] as const;
export type MinibarPickupStatus = (typeof MINIBAR_PICKUP_STATUSES)[number];

export type MinibarPickupLineInput = { productId: string; quantity: number };

export type MinibarPickupInput = {
  businessDate: string;
  roomId: string;
  reservationId: string;
  /** Sorted by product id before it is hashed and sent. */
  lines: MinibarPickupLineInput[];
  attendantRef?: string | null;
  complimentary?: boolean;
  complimentaryReason?: string | null;
};

/** `posted`: charge on the GUEST window. `moved`: transferred, reversed or split away. */
export const MINIBAR_FOLIO_STATES = ['posted', 'moved', 'missing', 'none'] as const;
export type MinibarFolioState = (typeof MINIBAR_FOLIO_STATES)[number];

export type MinibarReconciliationRow = {
  pickupId: string;
  lineId: string;
  businessDate: string;
  roomId: string;
  roomCode: string;
  reservationId: string;
  /** For the host's property-scoped name batch; this read never carries a name. */
  guestRef: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
  attendantRef: string | null;
  status: MinibarPickupStatus;
  complimentaryReason: string | null;
  /** The product is linked to a stock item. */
  stockTracked: boolean;
  /** A `minibar` stock movement exists for the line. */
  stockMovement: boolean;
  folioState: MinibarFolioState;
  createdAt: number;
};

export type MinibarProductTotal = {
  productId: string;
  productName: string;
  quantity: number;
  complimentaryQuantity: number;
  /** Posted (charged) amount in ledger minor units. */
  postedAmountMinor: number;
};

/** The minibar setup as the pickup dialog needs it: only live products, with their catalogue price. */
export type MinibarSetupView = {
  enabled: boolean;
  products: Array<{ productId: string; name: string; unitAmountMinor: number; stockTracked: boolean }>;
};

export type MinibarReconciliation = {
  ok: true;
  rows: MinibarReconciliationRow[];
  totals: MinibarProductTotal[];
  truncated: boolean;
  setup: MinibarSetupView;
};

// ---------------------------------------------------------------------------
// Amenities (D6)
// ---------------------------------------------------------------------------

export const HK_AMENITIES_MAX = 100;
export const HK_AMENITY_RULES_MAX = 30;
export const HK_AMENITY_RULE_LINES_MAX = 30;
export const HK_AMENITY_NAME_MAX = 80;
export const HK_AMENITY_UNIT_MAX = 20;
export const HK_AMENITY_QTY_MAX = 1000;
export const HK_AMENITY_DISPATCH_ROOMS_MAX = 200;
export const HK_AMENITY_EXCEPTION_MAX = 200;

export const AMENITY_WHEN = ['arrival', 'stayover', 'departure'] as const;
export type AmenityWhen = (typeof AMENITY_WHEN)[number];
export function isAmenityWhen(v: unknown): v is AmenityWhen {
  return typeof v === 'string' && (AMENITY_WHEN as readonly string[]).includes(v);
}

export const AMENITY_DISPATCH_STATUSES = ['planned', 'confirmed'] as const;
export type AmenityDispatchStatus = (typeof AMENITY_DISPATCH_STATUSES)[number];
export function isAmenityDispatchStatus(v: unknown): v is AmenityDispatchStatus {
  return typeof v === 'string' && (AMENITY_DISPATCH_STATUSES as readonly string[]).includes(v);
}

/** `pending` until confirmed; then `posted` (a stock movement was written) or `not_linked`. */
export const AMENITY_STOCK_STATUSES = ['pending', 'posted', 'not_linked'] as const;
export type AmenityStockStatus = (typeof AMENITY_STOCK_STATUSES)[number];

export type AmenityRow = {
  amenityId: string;
  name: string;
  unit: string;
  standardQuantity: number;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  active: boolean;
};

export type AmenityRuleLine = { amenityId: string; quantity: number };

export type AmenityRuleRow = {
  ruleId: string;
  name: string;
  roomTypeId: string | null;
  when: AmenityWhen;
  lines: AmenityRuleLine[];
  active: boolean;
};

export type AmenityList = { ok: true; amenities: AmenityRow[]; rules: AmenityRuleRow[] };

export type SaveAmenityInput = {
  amenityId?: string;
  name: string;
  unit: string;
  standardQuantity: number;
  inventoryItemId?: string | null;
  active?: boolean;
};

export type SaveAmenityRuleInput = {
  ruleId?: string;
  name: string;
  roomTypeId?: string | null;
  when: AmenityWhen;
  /** Sorted by amenity id before it is hashed and sent. */
  lines: AmenityRuleLine[];
  active?: boolean;
};

export type PlanAmenityDispatchesInput = {
  businessDate: string;
  ruleId: string;
  /** Sorted before it is hashed and sent. */
  roomIds: string[];
};

export type ConfirmAmenityDispatchInput = {
  dispatchId: string;
  /** Sorted by line id before it is hashed and sent. */
  lines: Array<{ lineId: string; actualQuantity: number }>;
  exceptionReason?: string | null;
  supervisorRef?: string | null;
};

export type AmenityDispatchLine = {
  lineId: string;
  amenityId: string;
  amenityName: string;
  unit: string;
  expectedQuantity: number;
  actualQuantity: number | null;
  inventoryItemId: string | null;
};

export type AmenityDispatchRow = {
  dispatchId: string;
  businessDate: string;
  roomId: string;
  roomCode: string;
  ruleId: string;
  ruleName: string;
  when: AmenityWhen;
  status: AmenityDispatchStatus;
  lines: AmenityDispatchLine[];
  exceptionReason: string | null;
  supervisorRef: string | null;
  stockStatus: AmenityStockStatus;
  plannedAt: number;
  plannedBy: string;
  confirmedAt: number | null;
  confirmedBy: string | null;
};

export type AmenityDispatchList = { ok: true; dispatches: AmenityDispatchRow[]; truncated: boolean };

export type PlanAmenityDispatchesResult = {
  ok: true;
  created: AmenityDispatchRow[];
  /** Rooms that already had a dispatch for that date and rule. */
  skippedRoomIds: string[];
};
