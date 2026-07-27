export type Lane = 'INTERACTIVE' | 'BACKGROUND' | 'BULK' | 'SHELL';
export type DegradedClass = 'READ_STALE' | 'QUEUE_PROVISIONAL' | 'FAIL_CLOSED' | 'N/A';

export type CommandEntry = {
  id: string;
  /**
   * Prototype action this command implements, or null for platform-only splits
   * of a compound prototype action (the primary split keeps the prototypeAction).
   */
  prototypeAction: string | null;
  lane: Lane;
  degraded: DegradedClass;
  idempotent: boolean;
  events: string[];
  notes?: string;
};

export type PlatformGap = {
  id: string;
  reason: string;
};

/**
 * Each entry has ONE degraded class. Compound prototype actions that mixed
 * FAIL_CLOSED with softer classes are split so an omission cannot silently
 * become a queued write (§4.6).
 */
export const COMMAND_CATALOG: CommandEntry[] = [
  { id: 'shell.set_role', prototypeAction: 'SET_ROLE', lane: 'SHELL', degraded: 'N/A', idempotent: false, events: [] },
  { id: 'shell.set_property', prototypeAction: 'SET_PROPERTY', lane: 'SHELL', degraded: 'N/A', idempotent: false, events: [] },
  {
    id: 'reservations.create',
    prototypeAction: 'ADD_RESERVATION',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['reservation.created', 'availability.changed'],
  },
  // UPDATE_RESERVATION_STATUS split — inventory/legal transitions fail closed
  {
    id: 'reservations.check_in',
    prototypeAction: 'UPDATE_RESERVATION_STATUS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.status_changed'],
    notes: '§4.6 QUEUE_PROVISIONAL — check-ins commute; room conflicts → exception queue on replay.',
  },
  {
    id: 'reservations.check_out',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.status_changed'],
    notes: '§4.6 QUEUE_PROVISIONAL — same admission class as check-in.',
  },
  {
    id: 'reservations.cancel',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['reservation.status_changed', 'availability.changed'],
    notes: 'Inventory-affecting — must not invent stock during outage.',
  },
  {
    id: 'reservations.no_show',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['reservation.status_changed', 'availability.changed'],
    notes: 'Inventory-affecting — must not invent stock during outage.',
  },
  {
    id: 'reservations.update_status',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.status_changed'],
    notes: 'Non-inventory status notes only (e.g. VIP flag). Check-in/out/cancel/no-show are separate.',
  },
  {
    id: 'reservations.cancel_check_in',
    prototypeAction: 'CANCEL_CHECK_IN',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.status_changed'],
  },
  {
    id: 'reservations.assign_room',
    prototypeAction: 'ASSIGN_ROOM',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.room_assigned'],
  },
  {
    id: 'reservations.modify',
    prototypeAction: 'MODIFY_RESERVATION',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['reservation.modified', 'availability.changed'],
  },
  {
    id: 'rooms.update_status',
    prototypeAction: 'UPDATE_ROOM_STATUS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['room.status_changed', 'availability.changed'],
  },
  {
    id: 'rooms.bulk_update_status',
    prototypeAction: 'BULK_UPDATE_ROOM_STATUS',
    lane: 'BULK',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['room.status_changed'],
  },
  {
    id: 'housekeeping.assign',
    prototypeAction: 'ASSIGN_HOUSEKEEPER',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['housekeeping.assigned'],
  },
  // ADD_FOLIO_ITEM split — payments fail closed; non-payment may queue
  {
    id: 'folio.add_item',
    prototypeAction: 'ADD_FOLIO_ITEM',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['folio.line_posted'],
    notes: 'Non-payment folio lines only.',
  },
  {
    id: 'folio.authorize',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.payment_authorized'],
    notes: 'Payment authorization — never queue during outage (§4.6).',
  },
  {
    id: 'folio.capture',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.payment_captured'],
    notes: 'Payment capture — never queue during outage (§4.6).',
  },
  // SPLIT_FOLIO_CHARGE split
  {
    id: 'folio.split_charge',
    prototypeAction: 'SPLIT_FOLIO_CHARGE',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['folio.line_posted'],
    notes: 'Non-payment splits. Payment-bearing splits use folio.split_charge_payment.',
  },
  {
    id: 'folio.split_charge_payment',
    prototypeAction: null,
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['folio.line_posted'],
  },
  {
    id: 'night_audit.run',
    prototypeAction: 'RUN_NIGHT_AUDIT',
    lane: 'BACKGROUND',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['night_audit.started', 'night_audit.completed'],
  },
  {
    id: 'channels.sync',
    prototypeAction: 'SYNC_CHANNEL',
    lane: 'BULK',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['channel.synced'],
  },
  {
    id: 'channels.add',
    prototypeAction: 'ADD_CHANNEL',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['channel.mapping.created'],
  },
  {
    id: 'audit.append',
    prototypeAction: 'ADD_AUDIT_LOG',
    lane: 'BACKGROUND',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['audit.recorded'],
  },
  {
    id: 'guests.create',
    prototypeAction: 'ADD_GUEST',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['guest.created'],
  },
  {
    id: 'guests.update',
    prototypeAction: 'UPDATE_GUEST',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['guest.updated'],
  },
  {
    id: 'rates.create_plan',
    prototypeAction: 'ADD_RATE_PLAN',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_plan.changed'],
  },
  {
    id: 'rates.update_plan',
    prototypeAction: 'UPDATE_RATE_PLAN',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_plan.changed'],
  },
  {
    id: 'rates.delete_plan',
    prototypeAction: 'DELETE_RATE_PLAN',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_plan.changed'],
  },
  {
    id: 'rates.update_room_type_rate',
    prototypeAction: 'UPDATE_ROOM_TYPE_RATE',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_plan.changed'],
  },
  {
    id: 'rates.bulk_update',
    prototypeAction: 'UPDATE_BULK_RATES',
    lane: 'BULK',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['rate_plan.changed'],
  },
  {
    id: 'property.update_details',
    prototypeAction: 'UPDATE_PROPERTY_DETAILS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['property.updated'],
  },
  {
    id: 'housekeeping.staff_add',
    prototypeAction: 'ADD_HOUSEKEEPER',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['staff.housekeeper_changed'],
  },
  {
    id: 'housekeeping.staff_status',
    prototypeAction: 'UPDATE_HOUSEKEEPER_STATUS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['staff.housekeeper_changed'],
  },
  {
    id: 'housekeeping.staff_delete',
    prototypeAction: 'DELETE_HOUSEKEEPER',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['staff.housekeeper_changed'],
  },
  {
    id: 'housekeeping.staff_update',
    prototypeAction: 'UPDATE_HOUSEKEEPER',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['staff.housekeeper_changed'],
  },
  {
    id: 'inventory.add_room_type',
    prototypeAction: 'ADD_ROOM_TYPE',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['inventory.room_type_changed', 'availability.changed'],
  },
  {
    id: 'inventory.update_room_type',
    prototypeAction: 'UPDATE_ROOM_TYPE',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['inventory.room_type_changed', 'availability.changed'],
  },
  {
    id: 'inventory.delete_room_type',
    prototypeAction: 'DELETE_ROOM_TYPE',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['inventory.room_type_changed'],
  },
  {
    id: 'staff.add',
    prototypeAction: 'ADD_STAFF',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['staff.changed'],
  },
  {
    id: 'staff.update',
    prototypeAction: 'UPDATE_STAFF',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['staff.changed'],
  },
  {
    id: 'staff.delete',
    prototypeAction: 'DELETE_STAFF',
    lane: 'INTERACTIVE',
    degraded: 'FAIL_CLOSED',
    idempotent: true,
    events: ['staff.changed'],
  },
  {
    id: 'reservations.update_extras',
    prototypeAction: 'UPDATE_RESERVATION_EXTRAS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.modified'],
  },
];

export const PLATFORM_GAPS: PlatformGap[] = [
  { id: 'availability.book', reason: 'Ledger decrement in same txn as reservation (§7.1)' },
  { id: 'rooms.set_ooo_range', reason: 'Explicit OOO delta on blocked' },
  { id: 'restrictions.upsert_day', reason: 'restriction_day ledger' },
  { id: 'folio.transfer_charge', reason: 'Window routing / night-audit auto-transfer' },
  { id: 'folio.split_charge_v2', reason: 'Reverse + two posts replacing mutate-in-place' },
  { id: 'config.put_domain', reason: 'Write DOMAIN config with config.changed' },
];

export const PROTOTYPE_ACTIONS = [
  'SET_ROLE',
  'SET_PROPERTY',
  'ADD_RESERVATION',
  'UPDATE_RESERVATION_STATUS',
  'CANCEL_CHECK_IN',
  'ASSIGN_ROOM',
  'MODIFY_RESERVATION',
  'UPDATE_ROOM_STATUS',
  'BULK_UPDATE_ROOM_STATUS',
  'ASSIGN_HOUSEKEEPER',
  'ADD_FOLIO_ITEM',
  'SPLIT_FOLIO_CHARGE',
  'RUN_NIGHT_AUDIT',
  'SYNC_CHANNEL',
  'ADD_CHANNEL',
  'ADD_AUDIT_LOG',
  'ADD_GUEST',
  'UPDATE_GUEST',
  'ADD_RATE_PLAN',
  'UPDATE_RATE_PLAN',
  'DELETE_RATE_PLAN',
  'UPDATE_ROOM_TYPE_RATE',
  'UPDATE_BULK_RATES',
  'UPDATE_PROPERTY_DETAILS',
  'ADD_HOUSEKEEPER',
  'UPDATE_HOUSEKEEPER_STATUS',
  'DELETE_HOUSEKEEPER',
  'UPDATE_HOUSEKEEPER',
  'ADD_ROOM_TYPE',
  'UPDATE_ROOM_TYPE',
  'DELETE_ROOM_TYPE',
  'ADD_STAFF',
  'UPDATE_STAFF',
  'DELETE_STAFF',
  'UPDATE_RESERVATION_EXTRAS',
] as const;

export function getCommand(id: string): CommandEntry {
  const entry = COMMAND_CATALOG.find((c) => c.id === id);
  if (!entry) throw new Error(`Unknown command: ${id}`);
  return entry;
}

/** Prototype actions covered by at least one catalog entry. */
export function coveredPrototypeActions(): string[] {
  return [
    ...new Set(
      COMMAND_CATALOG.map((c) => c.prototypeAction).filter((a): a is string => a !== null),
    ),
  ].sort();
}
