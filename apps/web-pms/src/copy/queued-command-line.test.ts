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
    expect(line).toBe('Queued action · 2026-08-14');
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
    expect(line).toBe('Queued action · 2026-08-13');
  });
});
