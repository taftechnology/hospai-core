/** Maintenance tickets and task types (R1.9 D). */

export const MAINTENANCE_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'furniture',
  'locks',
  'housekeeping',
  'other',
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const MAINTENANCE_PRIORITIES = ['low', 'medium', 'high', 'emergency'] as const;

export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];

export const MAINTENANCE_CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  furniture: 'Furniture',
  locks: 'Locks',
  housekeeping: 'Housekeeping',
  other: 'Other',
};

export const MAINTENANCE_PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  emergency: 'Emergency',
};

export const MAINTENANCE_STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_SOURCES = ['desk', 'ooo'] as const;

export type MaintenanceSource = (typeof MAINTENANCE_SOURCES)[number];

export const MAINTENANCE_DESCRIPTION_MAX = 2000;
export const MAINTENANCE_RESOLUTION_NOTE_MAX = 2000;
export const MAINTENANCE_CHECKLIST_MAX_ITEMS = 20;
export const MAINTENANCE_CHECKLIST_ITEM_MAX = 80;
export const MAINTENANCE_TASK_TYPE_NAME_MAX = 80;
export const MAINTENANCE_TASK_TYPES_MAX = 100;
export const MAINTENANCE_TICKETS_LIST_MAX = 200;

export type MaintenanceChecklistItem = { label: string; done: boolean };

export type MaintenanceTicketRow = {
  ticketId: string;
  ticketNo: number;
  roomId: string;
  roomCode: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  description: string;
  taskTypeId: string | null;
  checklist: MaintenanceChecklistItem[];
  status: MaintenanceStatus;
  assigneeRef: string | null;
  source: MaintenanceSource;
  oooId: string | null;
  oooReleasedAt: number | null;
  /** `room_ooo` row exists and `end_date` is still after the property business date. */
  oooActive: boolean;
  oooStartDate: string | null;
  resolutionNote: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
};

export type MaintenanceTaskTypeRow = {
  taskTypeId: string;
  name: string;
  category: MaintenanceCategory;
  defaultPriority: MaintenancePriority;
  checklist: string[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

const LEGAL_TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  open: ['in_progress', 'resolved', 'cancelled'],
  in_progress: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

export function isMaintenanceCategory(value: unknown): value is MaintenanceCategory {
  return typeof value === 'string' && (MAINTENANCE_CATEGORIES as readonly string[]).includes(value);
}

export function isMaintenancePriority(value: unknown): value is MaintenancePriority {
  return typeof value === 'string' && (MAINTENANCE_PRIORITIES as readonly string[]).includes(value);
}

export function isMaintenanceStatus(value: unknown): value is MaintenanceStatus {
  return typeof value === 'string' && (MAINTENANCE_STATUSES as readonly string[]).includes(value);
}

export function isLegalMaintenanceTransition(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
): boolean {
  if (from === to) return false;
  return (LEGAL_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function maintenanceDescriptionOverCap(text: string): boolean {
  return text.length > MAINTENANCE_DESCRIPTION_MAX;
}

export function maintenanceResolutionNoteOverCap(text: string): boolean {
  return text.length > MAINTENANCE_RESOLUTION_NOTE_MAX;
}

export function maintenanceTaskTypeNameOverCap(name: string): boolean {
  return name.length > MAINTENANCE_TASK_TYPE_NAME_MAX;
}

export function maintenanceChecklistOverCap(items: readonly string[]): boolean {
  return items.length > MAINTENANCE_CHECKLIST_MAX_ITEMS;
}

export function maintenanceChecklistItemOverCap(item: string): boolean {
  return item.length > MAINTENANCE_CHECKLIST_ITEM_MAX;
}
