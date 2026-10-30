export const GUEST_TAGS_MAX = 20;
export const GUEST_TAG_LENGTH_MAX = 40;
export const GUEST_NOTES_LENGTH_MAX = 2000;

export type GuestCrmProfileFields = {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  vip?: boolean;
  notes?: string;
};

export function normalizeGuestCrmFields(profile: GuestCrmProfileFields): GuestCrmProfileFields {
  const out: GuestCrmProfileFields = { displayName: profile.displayName };
  if (profile.email !== undefined) out.email = profile.email;
  if (profile.phone !== undefined) out.phone = profile.phone;

  if (profile.tags !== undefined) {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const raw of profile.tags) {
      const normalized = raw.trim().replace(/\s+/g, ' ');
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(normalized);
    }
    if (tags.length > 0) out.tags = tags;
  }

  if (profile.vip === true) out.vip = true;

  if (profile.notes !== undefined) {
    const trimmed = profile.notes.trim();
    if (trimmed.length > 0) out.notes = trimmed;
  }

  return out;
}

export function guestCrmExceedsCaps(profile: GuestCrmProfileFields): boolean {
  if (profile.tags && profile.tags.length > GUEST_TAGS_MAX) return true;
  if (profile.tags?.some((t) => t.length > GUEST_TAG_LENGTH_MAX)) return true;
  if (profile.notes && profile.notes.length > GUEST_NOTES_LENGTH_MAX) return true;
  return false;
}

export function guestCrmBodyTypesValid(body: {
  tags?: unknown;
  vip?: unknown;
  notes?: unknown;
}): boolean {
  if ('tags' in body && body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return false;
    if (!body.tags.every((t) => typeof t === 'string')) return false;
  }
  if ('vip' in body && body.vip !== undefined && typeof body.vip !== 'boolean') return false;
  if ('notes' in body && body.notes !== undefined && typeof body.notes !== 'string') return false;
  return true;
}
