import type { Permission } from '@hospai/contracts';
import { currencyCode, money, type Money } from '@hospai/money';
import type { StaffProfile } from '@hospai/crypto-shredding';

export type RosterOperational = {
  staffId: string;
  kinds: string[];
  status: 'active' | 'inactive';
  exitedAt: number | null;
  displayName?: string;
};

export type RosterHttpRow = RosterOperational & {
  email?: string;
  phone?: string;
  hourlyRate?: Money;
  rating?: number;
  skills?: string[];
};

export function compensationWriteDenied(
  grants: readonly Permission[],
  patch: { hourlyRate?: unknown; rating?: unknown; skills?: unknown },
): boolean {
  const touches =
    patch.hourlyRate !== undefined || patch.rating !== undefined || patch.skills !== undefined;
  if (!touches) return false;
  return !grants.includes('roster:compensation');
}

export function stripRosterRow(
  grants: readonly Permission[],
  row: {
    staffId: string;
    kinds: string[];
    status: 'active' | 'inactive';
    exitedAt: number | null;
    profile: StaffProfile;
  },
): RosterHttpRow {
  const out: RosterHttpRow = {
    staffId: row.staffId,
    kinds: row.kinds,
    status: row.status,
    exitedAt: row.exitedAt,
  };
  if (row.profile.displayName !== undefined) out.displayName = row.profile.displayName;
  if (grants.includes('roster:write')) {
    if (row.profile.email !== undefined) out.email = row.profile.email;
    if (row.profile.phone !== undefined) out.phone = row.profile.phone;
  }
  if (grants.includes('roster:compensation')) {
    if (row.profile.hourlyRateMinor !== undefined && row.profile.hourlyRateCurrency) {
      out.hourlyRate = money(row.profile.hourlyRateMinor, currencyCode(row.profile.hourlyRateCurrency));
    }
    if (row.profile.rating !== undefined) out.rating = row.profile.rating;
    if (row.profile.skills !== undefined) out.skills = row.profile.skills;
  }
  return out;
}

export function profileFromHttpBody(body: {
  displayName?: string;
  email?: string;
  phone?: string;
  hourlyRate?: { amountMinor: number; currency: string };
  rating?: number;
  skills?: string[];
}): StaffProfile {
  const profile: StaffProfile = {};
  if (body.displayName !== undefined) profile.displayName = body.displayName;
  if (body.email !== undefined) profile.email = body.email;
  if (body.phone !== undefined) profile.phone = body.phone;
  if (body.hourlyRate) {
    const m = money(body.hourlyRate.amountMinor, currencyCode(body.hourlyRate.currency));
    profile.hourlyRateMinor = m.amountMinor;
    profile.hourlyRateCurrency = m.currency;
  }
  if (body.rating !== undefined) profile.rating = body.rating;
  if (body.skills !== undefined) profile.skills = body.skills;
  return profile;
}
