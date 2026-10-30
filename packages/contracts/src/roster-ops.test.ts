import { describe, expect, it } from 'vitest';
import {
  ROSTER_KINDS,
  ROSTER_OPS_SKILL_LENGTH_MAX,
  ROSTER_OPS_SKILLS_MAX,
  normalizeRosterOpsSkills,
  rosterOpsFieldsValid,
  rosterOpsSkillsExceedCaps,
} from './roster-ops.js';

describe('roster ops', () => {
  it('permits housekeeper and maintenance', () => {
    expect(ROSTER_KINDS).toEqual(['housekeeper', 'maintenance']);
  });

  it('normalises skills: trim, collapse whitespace, drop empties, keep first spelling', () => {
    expect(
      normalizeRosterOpsSkills(['  High floor ', 'high  FLOOR', '', '   ', '  linen   room  ', 'Linen room']),
    ).toEqual(['High floor', 'linen room']);
  });

  it('caps normalised skills at 10 tags of 32 characters', () => {
    expect(ROSTER_OPS_SKILLS_MAX).toBe(10);
    expect(ROSTER_OPS_SKILL_LENGTH_MAX).toBe(32);
    expect(rosterOpsSkillsExceedCaps(Array.from({ length: 10 }, (_, i) => `s${i}`))).toBe(false);
    expect(rosterOpsSkillsExceedCaps(Array.from({ length: 11 }, (_, i) => `s${i}`))).toBe(true);
    expect(rosterOpsSkillsExceedCaps(['x'.repeat(32)])).toBe(false);
    expect(rosterOpsSkillsExceedCaps(['x'.repeat(33)])).toBe(true);
  });

  it('accepts null shift and max rooms, and rejects wrong types and out-of-range capacity', () => {
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: null, skills: [] })).toBe(true);
    expect(rosterOpsFieldsValid({ shift: 'morning', maxRooms: 1, skills: ['linen'] })).toBe(true);
    expect(rosterOpsFieldsValid({ shift: 'any', maxRooms: 50, skills: [] })).toBe(true);
    expect(rosterOpsFieldsValid({ shift: 'noon', maxRooms: 8, skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: 1, maxRooms: 8, skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: '8', skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: 1.5, skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: 0, skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: 51, skills: [] })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: null, skills: 'linen' })).toBe(false);
    expect(rosterOpsFieldsValid({ shift: null, maxRooms: null, skills: [1] })).toBe(false);
  });
});
