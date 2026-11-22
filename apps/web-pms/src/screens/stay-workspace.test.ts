import { FALLBACK_FORMAT, formatDate, formatMoney, propertyFormat } from '@hospai/client-core';
import { describe, expect, it } from 'vitest';
import {
  cancelChargeSentence,
  cancelCheckInOpId,
  cancellationPolicySentence,
  changeInHouseStayOpId,
  inHouseChangePreview,
  invalidateStayMutations,
  modifyReservationOpId,
  stayMutationQueryKeys,
} from './stay-workspace.js';

const fmt = propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' });
const money = (minor: number, currency?: string) => formatMoney(minor, fmt, currency);

describe('stay mutation query keys', () => {
  it('invalidates every consumer prefix the desk screens use', () => {
    const seen: unknown[][] = [];
    invalidateStayMutations(
      {
        invalidateQueries: ({ queryKey }) => {
          seen.push(queryKey);
        },
      },
      'prop_1',
      'res_1',
    );
    expect(seen).toEqual(stayMutationQueryKeys('prop_1', 'res_1'));
    const consumers: unknown[][] = [
      ['reservation', 'prop_1', 'res_1'],
      ['reservation-rate-nights', 'prop_1', 'res_1'],
      ['folio', 'prop_1', 'res_1'],
      ['folio-payments', 'prop_1', 'res_1'],
      ['board', 'arrivals', 'prop_1', '2026-11-09', null],
      ['front-desk-tape', 'prop_1', '2026-11-01', '2026-11-07'],
      ['front-desk-free', 'prop_1', '2026-11-09', 'rt'],
      ['front-desk-available', 'prop_1', '2026-11-09', 'rt'],
      ['front-desk-summary', 'prop_1', '2026-11-09'],
      ['front-desk-directory', 'prop_1', 'today', '2026-11-09', null, null],
      ['reservation-search', 'prop_1', 'ada'],
      ['availability', 'prop_1', '2026-11-09', '2026-11-12'],
      ['guest-stays', 'prop_1', 'guest_1'],
    ];
    for (const full of consumers) {
      expect(seen.some((prefix) => prefix.every((part, i) => full[i] === part))).toBe(true);
    }
  });
});

describe('stay operation ids', () => {
  it('changes the modify opId when any body field changes', () => {
    const base = {
      roomTypeId: 'rt',
      arrivalDate: '2026-11-10',
      departureDate: '2026-11-12',
      adults: 2,
      children: 0,
      ratePlanId: 'BAR',
    };
    const first = modifyReservationOpId('res_1', base);
    expect(modifyReservationOpId('res_1', { ...base, departureDate: '2026-11-13' })).not.toBe(first);
    expect(modifyReservationOpId('res_1', { ...base, adults: 3 })).not.toBe(first);
    expect(modifyReservationOpId('res_1', { ...base, roomTypeId: 'rt2' })).not.toBe(first);
    expect(modifyReservationOpId('res_1', { ...base, ratePlanId: 'NRF' })).not.toBe(first);
    expect(cancelCheckInOpId('res_1', 10)).not.toBe(cancelCheckInOpId('res_1', 11));
    expect(changeInHouseStayOpId('res_1', 'a')).not.toBe(changeInHouseStayOpId('res_1', 'b'));
  });
});

describe('in-house change preview', () => {
  const fmtDate = (iso: string) => formatDate(iso, FALLBACK_FORMAT);

  it('names added nights, type move with room, and rate plan', () => {
    const line = inHouseChangePreview(
      {
        departureDate: '2026-11-24',
        roomTypeId: 'rt',
        ratePlanId: 'BAR',
        adults: 2,
        children: 0,
      },
      {
        departureDate: '2026-11-26',
        roomTypeId: 'rt_suite',
        roomId: 'rm_3',
        ratePlanId: 'RACK',
        adults: 2,
        children: 0,
        reason: 'Upgrade',
      },
      {
        roomTypeName: 'Suite',
        roomCode: '304',
        ratePlanName: 'Rack',
        formatDate: fmtDate,
      },
    );
    expect(line).toBe(
      'Adds 2 nights · departs 26 Nov 2026 · Moves to Suite 304 from tonight · Rate plan Rack applies from tonight',
    );
  });

  it('asks for a room before one is picked on a type change', () => {
    const line = inHouseChangePreview(
      {
        departureDate: '2026-11-24',
        roomTypeId: 'rt',
        ratePlanId: 'BAR',
        adults: 2,
        children: 0,
      },
      {
        departureDate: '2026-11-24',
        roomTypeId: 'rt_twin',
        roomId: '',
        ratePlanId: 'BAR',
        adults: 2,
        children: 0,
        reason: 'Move',
      },
      { roomTypeName: 'Twin', formatDate: fmtDate },
    );
    expect(line).toBe('Moves to Twin from tonight — pick a room');
  });
});

describe('cancellation copy', () => {
  const policy = {
    penaltyType: 'first_night' as const,
    graceHours: 24,
    penaltyNights: null,
    penaltyBps: null,
    freeUntil: Date.UTC(2026, 10, 14, 6, 30),
    cancelNowMinor: 450000,
    noShowMinor: 450000,
    currency: 'INR',
  };
  const dateTime = () => '14 Nov 2026, 12:00 pm';

  it('names the free window while it is still open', () => {
    const line = cancellationPolicySentence(
      { ...policy, cancelNowMinor: 0 },
      money,
      dateTime,
      policy.freeUntil - 1,
    );
    expect(line).toBe('Free cancellation until 14 Nov 2026, 12:00 pm. After that: first night.');
  });

  it('states the charge once the free window has passed', () => {
    const line = cancellationPolicySentence(policy, money, dateTime, policy.freeUntil);
    expect(line).toBe(`Cancellation charge now: first night (${money(450000, 'INR')} before tax).`);
    expect(line).not.toContain('Free cancellation');
  });

  it('says when the charge cannot be worked out', () => {
    expect(
      cancellationPolicySentence({ ...policy, cancelNowMinor: null }, money, dateTime, policy.freeUntil),
    ).toBe("The cancellation charge can't be worked out.");
  });

  it('words the dialog amounts as before tax', () => {
    expect(cancelChargeSentence(450000, money, 'INR')).toBe(
      `Cancelling now posts a cancellation charge of ${money(450000, 'INR')}, before tax, to the guest folio.`,
    );
    expect(cancelChargeSentence(0, money, 'INR')).toBe('No cancellation charge applies.');
    expect(cancelChargeSentence(null, money, 'INR')).toMatch(/can't be worked out/);
    expect(cancelChargeSentence(null, money, 'INR')).toMatch(/may be refused/);
  });
});
