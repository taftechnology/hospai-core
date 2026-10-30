/** Plaintext operational tags on `roster_property`. Not `StaffProfile.skills`. */
export const ROSTER_OPS_SKILLS_MAX = 10;
export const ROSTER_OPS_SKILL_LENGTH_MAX = 32;
export const ROSTER_OPS_MAX_ROOMS_MIN = 1;
export const ROSTER_OPS_MAX_ROOMS_MAX = 50;

export const ROSTER_KINDS = ['housekeeper', 'maintenance'] as const;
export type RosterKind = (typeof ROSTER_KINDS)[number];

export const ROSTER_SHIFTS = ['morning', 'evening', 'night', 'any'] as const;
export type RosterShift = (typeof ROSTER_SHIFTS)[number];

export type RosterOps = {
  shift: RosterShift | null;
  maxRooms: number | null;
  skills: string[];
};

/** Object hashed and sent for `roster.set_ops`. Includes the URL property. */
export type RosterSetOpsPayload = {
  staffId: string;
  propertyId: string;
  shift: RosterShift | null;
  maxRooms: number | null;
  skills: string[];
};

export function isRosterKind(value: unknown): value is RosterKind {
  return typeof value === 'string' && (ROSTER_KINDS as readonly string[]).includes(value);
}

export function isRosterShift(value: unknown): value is RosterShift {
  return typeof value === 'string' && (ROSTER_SHIFTS as readonly string[]).includes(value);
}

/** Trim, collapse whitespace, drop empties, case-insensitive dedupe keeping the first spelling. */
export function normalizeRosterOpsSkills(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills) {
    const normalized = raw.trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function rosterOpsSkillsExceedCaps(skills: readonly string[]): boolean {
  if (skills.length > ROSTER_OPS_SKILLS_MAX) return true;
  return skills.some((skill) => skill.length > ROSTER_OPS_SKILL_LENGTH_MAX);
}

export function rosterOpsFieldsValid(input: {
  shift: unknown;
  maxRooms: unknown;
  skills: unknown;
}): input is { shift: RosterShift | null; maxRooms: number | null; skills: string[] } {
  if (input.shift !== null && !isRosterShift(input.shift)) return false;
  if (input.maxRooms !== null) {
    if (typeof input.maxRooms !== 'number' || !Number.isInteger(input.maxRooms)) return false;
    if (input.maxRooms < ROSTER_OPS_MAX_ROOMS_MIN || input.maxRooms > ROSTER_OPS_MAX_ROOMS_MAX) {
      return false;
    }
  }
  if (!Array.isArray(input.skills)) return false;
  return input.skills.every((skill) => typeof skill === 'string');
}
