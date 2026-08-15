import { describe, expect, it } from 'vitest';
import { allocateVirtualConstituent, type ConstituentAvailabilityRow } from './virtual-allocation.js';
import { sumConstituentFree } from './virtual-free.js';

function row(free: number): ConstituentAvailabilityRow {
  return { physical: free, blocked: 0, held: 0, sold: 0, oversell: 0 };
}

function mapOf(
  entries: Record<string, Record<string, ConstituentAvailabilityRow>>,
): Map<string, Map<string, ConstituentAvailabilityRow>> {
  const outer = new Map<string, Map<string, ConstituentAvailabilityRow>>();
  for (const [id, nights] of Object.entries(entries)) {
    outer.set(id, new Map(Object.entries(nights)));
  }
  return outer;
}

describe('allocateVirtualConstituent', () => {
  const nights = ['2026-08-15'];

  it('King then Queen on two ROH books; third fails no_availability', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
      rt_queen: { '2026-08-15': row(1) },
    });
    const clean = () => true;

    const first = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(first).toEqual({ ok: true, allocatedRoomTypeId: 'rt_king' });

    availability.get('rt_king')!.set('2026-08-15', row(0));
    const second = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(second).toEqual({ ok: true, allocatedRoomTypeId: 'rt_queen' });

    availability.get('rt_queen')!.set('2026-08-15', row(0));
    const third = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: clean,
    });
    expect(third).toEqual({ ok: false, error: 'no_availability' });
  });

  it('King stop-sold restriction → allocates Queen (OR model)', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
      rt_queen: { '2026-08-15': row(1) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king', 'rt_queen'],
      availabilityByConstituent: availability,
      restrictionClean: (id) => id !== 'rt_king',
    });
    expect(result).toEqual({ ok: true, allocatedRoomTypeId: 'rt_queen' });
  });

  it('tie-break lexicographic room_type_id when minFree equal', () => {
    const availability = mapOf({
      rt_z: { '2026-08-15': row(2) },
      rt_a: { '2026-08-15': row(2) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_z', 'rt_a'],
      availabilityByConstituent: availability,
      restrictionClean: () => true,
    });
    expect(result).toEqual({ ok: true, allocatedRoomTypeId: 'rt_a' });
  });

  it('every free constituent restricted → restriction_violated', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
    });
    const result = allocateVirtualConstituent({
      nights,
      constituentIds: ['rt_king'],
      availabilityByConstituent: availability,
      restrictionClean: () => false,
    });
    expect(result).toEqual({ ok: false, error: 'restriction_violated' });
  });
});

describe('sumConstituentFree', () => {
  it('sums free availability across constituents for a stay date', () => {
    const availability = mapOf({
      rt_king: { '2026-08-15': row(1) },
      rt_queen: { '2026-08-15': row(2) },
    });
    expect(sumConstituentFree(['rt_king', 'rt_queen'], '2026-08-15', availability)).toBe(3);
  });
});
