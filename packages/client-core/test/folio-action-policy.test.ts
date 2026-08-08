import { describe, expect, it } from 'vitest';
import { folioActionPolicy } from '../src/folio-action-policy.js';

describe('folioActionPolicy', () => {
  it('policy C: folio fail_closed refuses money, allows checkout when checked_in', () => {
    const p = folioActionPolicy({
      folioReadClass: 'fail_closed',
      reservationReadClass: 'live',
      reservationStatus: 'checked_in',
    });
    expect(p.canPostCharge).toBe(false);
    expect(p.canPay).toBe(false);
    expect(p.canSplit).toBe(false);
    expect(p.canCheckout).toBe(true);
    expect(p.reasons.checkout).toMatch(/will not settle/i);
  });

  it('hides checkout when reservation status unknown', () => {
    const p = folioActionPolicy({
      folioReadClass: 'live',
      reservationReadClass: 'fail_closed',
      reservationStatus: null,
    });
    expect(p.canCheckout).toBe(false);
    expect(p.canPostCharge).toBe(true);
  });

  it('happy path: checked_in + live folio enables all', () => {
    const p = folioActionPolicy({
      folioReadClass: 'live',
      reservationReadClass: 'live',
      reservationStatus: 'checked_in',
    });
    expect(p).toMatchObject({
      canPostCharge: true,
      canPay: true,
      canSplit: true,
      canCheckout: true,
    });
  });

  it('pending disables all', () => {
    const p = folioActionPolicy({
      folioReadClass: 'pending',
      reservationReadClass: 'live',
      reservationStatus: 'checked_in',
    });
    expect(p.canPostCharge).toBe(false);
    expect(p.canCheckout).toBe(false);
  });

  it('confirmed guest cannot checkout', () => {
    const p = folioActionPolicy({
      folioReadClass: 'live',
      reservationReadClass: 'live',
      reservationStatus: 'confirmed',
    });
    expect(p.canCheckout).toBe(false);
  });
});
