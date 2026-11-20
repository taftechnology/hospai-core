import { describe, expect, it } from 'vitest';
import { propertyFormat, type ClassifiedResponse } from '@hospai/client-core';
import { classifiedUserMessage } from './classified-user-message.js';

function classified(partial: Pick<ClassifiedResponse, 'class'> & Partial<ClassifiedResponse>): ClassifiedResponse {
  return {
    status: 500,
    body: {},
    retryAfterMs: null,
    ...partial,
  };
}

describe('classifiedUserMessage', () => {
  it('fail_closed does not paint the class token', () => {
    const msg = classifiedUserMessage(classified({ class: 'fail_closed' }), {
      fallback: 'Booking failed',
    });
    expect(msg).not.toMatch(/fail_closed/);
    expect(msg).toMatch(/Property unreachable/i);
  });

  it('unknown class does not paint the raw token', () => {
    const msg = classifiedUserMessage(classified({ class: 'client_error' }), {
      fallback: 'Open shift failed',
    });
    expect(msg).not.toMatch(/client_error/);
    expect(msg).toBe('Open shift failed');
  });

  it('read_stale does not paint the class token', () => {
    const msg = classifiedUserMessage(classified({ class: 'read_stale' }), {
      fallback: 'Availability failed',
    });
    expect(msg).not.toMatch(/read_stale/);
    expect(msg).toMatch(/Data is stale/i);
  });

  it('forbidden with permission body returns Requires permission line', () => {
    const msg = classifiedUserMessage(
      classified({
        class: 'forbidden',
        status: 403,
        body: { error: 'forbidden', permission: 'folio:post' },
      }),
      {},
    );
    expect(msg).toMatch(/Requires permission folio:post/i);
  });
});

function classifiedWithCode(code: string, bodyExtra: Record<string, unknown> = {}) {
  return classified({
    class: 'client_error',
    status: 422,
    body: { error: code, ...bodyExtra },
  });
}

describe('domain code messages', () => {
  it.each([
    ['balance_due', { balanceMinor: 2500 }, /Guest owes 25\.00 — settle on the folio before checkout/],
    ['balance_due', {}, /Guest balance is due — settle on the folio before checkout/],
    ['folio_balance_due', { balanceMinor: 100 }, /before generating the invoice/],
    ['room_already_assigned', {}, /already assigned — move the guest first/],
    ['not_in_house', {}, /Only an in-house stay/],
    ['use_early_depart', {}, /Early departure/],
    ['room_id_required', {}, /Pick a room of the new type/],
    ['room_move_reason_required', {}, /Give a reason for the room move/],
    ['room_not_ready', {}, /not ready yet — pick a clean or inspected room/],
    [
      'prepayment_required',
      {},
      /requires a card hold or payment before check-in/,
    ],
    ['room_out_of_order', {}, /out of order — pick another room/],
    ['room_type_mismatch', {}, /does not match the booked room type/],
    ['hold_expired', {}, /hold has expired/],
    ['inquiry_expired', {}, /inquiry has expired/],
    ['invoice_required', {}, /An invoice is required before checkout/],
    [
      'invoice_number_invalid',
      {},
      /That invoice number is not valid for this series/,
    ],
    ['not_modifiable', {}, /cannot be changed in its current status/],
    ['no_availability', { date: '2026-08-11' }, /No availability on 11\/08\/2026/],
    ['no_availability', {}, /No availability — pick another room type or date/],
    ['duplicate_upi_reference', {}, /already recorded on another payment/],
    ['invalid_upi_reference', {}, /6 to 35 letters or digits/],
    ['date_outside_stay', {}, /outside the stay/],
    ['package_already_applied', {}, /already has a package/],
    ['package_mismatch', {}, /do not match the package/],
    ['package_nights_posted', {}, /already posted/],
    [
      'open_folio_disabled',
      {},
      /Open folio is off for this property\. Turn it on in Settings → Folio/,
    ],
    ['hold_already_active', {}, /already has an open-folio hold/],
    ['no_active_hold', {}, /no active open-folio hold/],
    [
      'checked_out_requires_hold',
      {},
      /Place an open-folio hold to post charges after checkout/,
    ],
  ] as const)('%s', (code, extra, pattern) => {
    const msg = classifiedUserMessage(classifiedWithCode(code, extra), { fallback: 'X' });
    expect(msg).toMatch(pattern);
    expect(msg).not.toMatch(/try again/i);
    expect(msg).not.toMatch(new RegExp(code, 'i'));
  });

  it('room_already_assigned on a type change names the occupied room', () => {
    expect(
      classifiedUserMessage(classifiedWithCode('room_already_assigned'), {
        roomCode: '206',
        fallback: 'X',
      }),
    ).toBe('Room 206 is still occupied or booked for these nights. Pick another room.');
  });

  it('guest profile rules name the missing field or the match', () => {
    expect(classifiedUserMessage(classifiedWithCode('guest_email_required'), {})).toBe(
      'Email is required on new guest profiles.',
    );
    expect(classifiedUserMessage(classifiedWithCode('guest_phone_required'), {})).toBe(
      'Phone is required on new guest profiles.',
    );
    expect(
      classifiedUserMessage(classifiedWithCode('guest_duplicate', { match: 'email', guestRef: 'g1' }), {}),
    ).toMatch(/this email is already on file/);
    expect(
      classifiedUserMessage(classifiedWithCode('guest_duplicate', { match: 'phone', guestRef: 'g1' }), {}),
    ).toMatch(/this phone is already on file/);
    expect(classifiedUserMessage(classifiedWithCode('guest_duplicate'), {})).toMatch(
      /email or phone is already on file/,
    );
  });

  it('domain message beats class-mapped client_error fallback', () => {
    const msg = classifiedUserMessage(classifiedWithCode('balance_due'), { fallback: 'Checkout failed' });
    expect(msg).toMatch(/balance is due|Guest owes/);
    expect(msg).not.toBe('Checkout failed');
  });

  it('without fmt prints grouped digits and no currency sign', () => {
    const msg = classifiedUserMessage(
      classifiedWithCode('balance_due', { balanceMinor: 12_450_000 }),
      {},
    );
    expect(msg).toContain('124,500.00');
    expect(msg).not.toMatch(/[$₹]|USD|INR/);
  });

  it('with fmt prints the minus sign before the currency', () => {
    const fmt = propertyFormat({ timeZone: 'Asia/Kolkata', currency: 'INR' });
    const checkout = classifiedUserMessage(
      classifiedWithCode('balance_due', { balanceMinor: -2500 }),
      { fmt },
    );
    expect(checkout).toContain('\u2212₹25.00');
    const invoice = classifiedUserMessage(
      classifiedWithCode('folio_balance_due', { balanceMinor: -100 }),
      { fmt },
    );
    expect(invoice).toContain('\u2212₹1.00');
    expect(invoice).toMatch(/before generating the invoice/);
  });

  it('check_out_not_today explains same-day reopen only', () => {
    const msg = classifiedUserMessage(classifiedWithCode('check_out_not_today'), {
      fallback: 'Undo failed',
    });
    expect(msg).toBe(
      'This stay checked out on an earlier business date and cannot be reopened.',
    );
    expect(msg).not.toMatch(/check_out_not_today/);
  });
});
