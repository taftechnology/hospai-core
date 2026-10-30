import type { HousekeepingRosterPerson } from './housekeeping-types.js';

const SHIFT_LABEL = {
  morning: 'Morning',
  evening: 'Evening',
  night: 'Night',
  any: 'Any',
} as const;

export function assignedCounts(
  assignments: ReadonlyArray<{ assigneeRef: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    counts.set(assignment.assigneeRef, (counts.get(assignment.assigneeRef) ?? 0) + 1);
  }
  return counts;
}

export function isOverRosterCapacity(person: HousekeepingRosterPerson, assigned: number): boolean {
  const max = person.ops?.maxRooms;
  if (max == null) return false;
  return assigned >= max;
}

export function sortAssignableHousekeepers(
  people: readonly HousekeepingRosterPerson[],
  counts: ReadonlyMap<string, number>,
): HousekeepingRosterPerson[] {
  return [...people].sort((a, b) => {
    const overA = isOverRosterCapacity(a, counts.get(a.staffId) ?? 0) ? 1 : 0;
    const overB = isOverRosterCapacity(b, counts.get(b.staffId) ?? 0) ? 1 : 0;
    if (overA !== overB) return overA - overB;
    const nameA = a.displayName ?? a.staffId;
    const nameB = b.displayName ?? b.staffId;
    return nameA.localeCompare(nameB);
  });
}

/** `Name · Morning · 8/12 · suites, linen, turndown +1` — omit parts that are not set. */
export function assignPickerLabel(person: HousekeepingRosterPerson, assigned: number): string {
  const parts = [person.displayName ?? person.staffId];
  const shift = person.ops?.shift;
  if (shift) parts.push(SHIFT_LABEL[shift]);
  if (person.ops?.maxRooms != null) parts.push(`${assigned}/${person.ops.maxRooms}`);
  const skills = person.ops?.skills ?? [];
  if (skills.length > 0) {
    const shown = skills.slice(0, 3).join(', ');
    const extra = skills.length - 3;
    parts.push(extra > 0 ? `${shown} +${extra}` : shown);
  }
  return parts.join(' · ');
}
