import { describe, expect, it } from 'vitest';
import {
  GUEST_NOTES_LENGTH_MAX,
  GUEST_TAG_LENGTH_MAX,
  GUEST_TAGS_MAX,
  guestCrmExceedsCaps,
  normalizeGuestCrmFields,
} from './guest-crm.js';

describe('normalizeGuestCrmFields', () => {
  it('passes displayName, email, phone through unchanged', () => {
    expect(
      normalizeGuestCrmFields({
        displayName: ' Ada ',
        email: ' ada@ex.com ',
        phone: ' 555 ',
      }),
    ).toEqual({
      displayName: ' Ada ',
      email: ' ada@ex.com ',
      phone: ' 555 ',
    });
  });

  it('normalises tags: trim, collapse whitespace, dedupe case-insensitively', () => {
    expect(
      normalizeGuestCrmFields({
        displayName: 'G',
        tags: [' High floor ', 'high  FLOOR', ''],
      }),
    ).toEqual({
      displayName: 'G',
      tags: ['High floor'],
    });
  });

  it('omits empty tags array, vip false, and blank notes', () => {
    expect(
      normalizeGuestCrmFields({
        displayName: 'G',
        tags: [],
        vip: false,
        notes: '  ',
      }),
    ).toEqual({ displayName: 'G' });
  });

  it('keeps vip true and trimmed notes with internal newlines', () => {
    expect(
      normalizeGuestCrmFields({
        displayName: 'G',
        vip: true,
        notes: ' line one\nline two ',
      }),
    ).toEqual({
      displayName: 'G',
      vip: true,
      notes: 'line one\nline two',
    });
  });
});

describe('guestCrmExceedsCaps', () => {
  it('allows exactly max tags, tag length, and notes length', () => {
    const tags = Array.from({ length: GUEST_TAGS_MAX }, (_, i) => `t${i}`);
    tags[GUEST_TAGS_MAX - 1] = 'a'.repeat(GUEST_TAG_LENGTH_MAX);
    expect(
      guestCrmExceedsCaps({
        displayName: 'G',
        tags,
        notes: 'n'.repeat(GUEST_NOTES_LENGTH_MAX),
      }),
    ).toBe(false);
  });

  it('rejects over cap tags, tag length, and notes length', () => {
    expect(
      guestCrmExceedsCaps({
        displayName: 'G',
        tags: Array.from({ length: GUEST_TAGS_MAX + 1 }, (_, i) => `t${i}`),
      }),
    ).toBe(true);
    expect(
      guestCrmExceedsCaps({
        displayName: 'G',
        tags: ['x'.repeat(GUEST_TAG_LENGTH_MAX + 1)],
      }),
    ).toBe(true);
    expect(
      guestCrmExceedsCaps({
        displayName: 'G',
        notes: 'n'.repeat(GUEST_NOTES_LENGTH_MAX + 1),
      }),
    ).toBe(true);
  });
});
