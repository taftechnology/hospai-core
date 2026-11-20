import { z } from 'zod';
import type { CommandError } from './command-error.js';
import { LIMIT_EXCEEDED } from './entitlements.js';
import { VALIDATION_ERROR } from './idempotency.js';

export const ROOM_PREFERENCE_CODES = [
  'HIGH_FLOOR',
  'LOW_FLOOR',
  'QUIET_ROOM',
  'NEAR_ELEVATOR',
  'AWAY_FROM_ELEVATOR',
  'CONNECTING_ROOM',
] as const;
export type RoomPreferenceCode = (typeof ROOM_PREFERENCE_CODES)[number];

export const BEDDING_PREFERENCE_CODES = [
  'KING',
  'QUEEN',
  'TWIN',
  'EXTRA_BED',
  'CRIB',
  'FEATHER_FREE',
] as const;
export type BeddingPreferenceCode = (typeof BEDDING_PREFERENCE_CODES)[number];

export const DIETARY_PREFERENCE_CODES = [
  'VEGETARIAN',
  'VEGAN',
  'JAIN',
  'HALAL',
  'KOSHER',
  'GLUTEN_FREE',
  'NUT_ALLERGY',
  'LACTOSE_FREE',
] as const;
export type DietaryPreferenceCode = (typeof DIETARY_PREFERENCE_CODES)[number];

export const ACCESSIBILITY_CODES = [
  'WHEELCHAIR',
  'ACCESSIBLE_BATHROOM',
  'GROUND_FLOOR',
  'HEARING_SUPPORT',
  'VISUAL_SUPPORT',
] as const;
export type AccessibilityCode = (typeof ACCESSIBILITY_CODES)[number];

export const ROOM_PREFERENCE_LABELS: Record<RoomPreferenceCode, string> = {
  HIGH_FLOOR: 'High floor',
  LOW_FLOOR: 'Low floor',
  QUIET_ROOM: 'Quiet room',
  NEAR_ELEVATOR: 'Near elevator',
  AWAY_FROM_ELEVATOR: 'Away from elevator',
  CONNECTING_ROOM: 'Connecting room',
};

export const BEDDING_PREFERENCE_LABELS: Record<BeddingPreferenceCode, string> = {
  KING: 'King',
  QUEEN: 'Queen',
  TWIN: 'Twin',
  EXTRA_BED: 'Extra bed',
  CRIB: 'Crib',
  FEATHER_FREE: 'Feather free',
};

export const DIETARY_PREFERENCE_LABELS: Record<DietaryPreferenceCode, string> = {
  VEGETARIAN: 'Vegetarian',
  VEGAN: 'Vegan',
  JAIN: 'Jain',
  HALAL: 'Halal',
  KOSHER: 'Kosher',
  GLUTEN_FREE: 'Gluten free',
  NUT_ALLERGY: 'Nut allergy',
  LACTOSE_FREE: 'Lactose free',
};

export const ACCESSIBILITY_LABELS: Record<AccessibilityCode, string> = {
  WHEELCHAIR: 'Wheelchair',
  ACCESSIBLE_BATHROOM: 'Accessible bathroom',
  GROUND_FLOOR: 'Ground floor',
  HEARING_SUPPORT: 'Hearing support',
  VISUAL_SUPPORT: 'Visual support',
};

export const GUEST_PREFERENCE_OTHER_MAX = 200;

export type GuestPreferences = {
  room?: RoomPreferenceCode[];
  bedding?: BeddingPreferenceCode[];
  dietary?: DietaryPreferenceCode[];
  accessibility?: AccessibilityCode[];
  other?: string;
};

const uniqueCapped = <T extends string>(codes: readonly T[]) =>
  z
    .array(z.enum(codes as unknown as [T, ...T[]]))
    .max(codes.length);

export const GuestPreferencesSchema = z
  .object({
    room: uniqueCapped(ROOM_PREFERENCE_CODES).optional(),
    bedding: uniqueCapped(BEDDING_PREFERENCE_CODES).optional(),
    dietary: uniqueCapped(DIETARY_PREFERENCE_CODES).optional(),
    accessibility: uniqueCapped(ACCESSIBILITY_CODES).optional(),
    other: z.string().max(GUEST_PREFERENCE_OTHER_MAX).optional(),
  })
  .strict();

function dedupe<T extends string>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function arrayOverCap(value: unknown, cap: number): boolean {
  return Array.isArray(value) && value.length > cap;
}

/** Validate a preferences object. `null` is the clear sentinel and is not passed here. */
export function parseGuestPreferences(
  raw: unknown,
): { ok: true; preferences: GuestPreferences } | { ok: false; error: CommandError } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  const record = raw as Record<string, unknown>;
  if (
    arrayOverCap(record.room, ROOM_PREFERENCE_CODES.length) ||
    arrayOverCap(record.bedding, BEDDING_PREFERENCE_CODES.length) ||
    arrayOverCap(record.dietary, DIETARY_PREFERENCE_CODES.length) ||
    arrayOverCap(record.accessibility, ACCESSIBILITY_CODES.length)
  ) {
    return { ok: false, error: LIMIT_EXCEEDED };
  }
  const parsed = GuestPreferencesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: VALIDATION_ERROR };
  const preferences: GuestPreferences = {};
  if (parsed.data.room) {
    const room = dedupe(parsed.data.room);
    if (room.length > 0) preferences.room = room;
  }
  if (parsed.data.bedding) {
    const bedding = dedupe(parsed.data.bedding);
    if (bedding.length > 0) preferences.bedding = bedding;
  }
  if (parsed.data.dietary) {
    const dietary = dedupe(parsed.data.dietary);
    if (dietary.length > 0) preferences.dietary = dietary;
  }
  if (parsed.data.accessibility) {
    const accessibility = dedupe(parsed.data.accessibility);
    if (accessibility.length > 0) preferences.accessibility = accessibility;
  }
  if (parsed.data.other !== undefined) {
    const other = parsed.data.other.trim();
    if (other.length > GUEST_PREFERENCE_OTHER_MAX) return { ok: false, error: VALIDATION_ERROR };
    if (other.length > 0) preferences.other = other;
  }
  return { ok: true, preferences };
}
