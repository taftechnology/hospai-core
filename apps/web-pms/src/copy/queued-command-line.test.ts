import { describe, expect, it } from 'vitest';
import { queuedCommandLine } from './queued-command-line.js';

describe('queuedCommandLine', () => {
  it('humanizes queued entries without wire tokens', () => {
    const line = queuedCommandLine({
      commandId: 'post_folio_charge',
      idempotencyKey: 'idem_abc123',
      issuedAt: '2026-08-14T15:30:00.000Z',
      businessDate: '2026-08-14',
    });
    expect(line).toBe('Folio charge · 2026-08-14');
    expect(line).not.toMatch(/post_folio_charge/i);
    expect(line).not.toMatch(/idempotency/i);
    expect(line).not.toMatch(/idem_/i);
  });

  it('falls back to issuedAt date when businessDate is absent', () => {
    const line = queuedCommandLine({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: '2026-08-13T22:00:00.000Z',
    });
    expect(line).toBe('Check-in · 2026-08-13');
  });

  it('distinct commandIds on the same date produce different labels', () => {
    const date = '2026-08-14';
    const checkIn = queuedCommandLine({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: `${date}T12:00:00Z`,
      businessDate: date,
    });
    const charge = queuedCommandLine({
      commandId: 'folio.add_item',
      idempotencyKey: 'k2',
      issuedAt: `${date}T12:00:00Z`,
      businessDate: date,
    });
    expect(checkIn).toBe('Check-in · 2026-08-14');
    expect(charge).toBe('Folio charge · 2026-08-14');
    expect(checkIn).not.toBe(charge);
  });

  it('appends reservation suffix when reservationId is present', () => {
    const line = queuedCommandLine({
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: '2026-08-14T12:00:00Z',
      businessDate: '2026-08-14',
      reservationId: 'res_abc12def',
    });
    expect(line).toBe('Check-in · 2026-08-14 · #abc12def');
    expect(line).not.toMatch(/res_abc12def/);
  });
});
