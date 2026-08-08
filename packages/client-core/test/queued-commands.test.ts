import { describe, expect, it } from 'vitest';
import {
  createQueuedCommandLog,
  partitionQueuedByReservation,
} from '../src/queued-commands.js';

describe('queued-command log', () => {
  it('appends from 202 provisional body', () => {
    const log = createQueuedCommandLog();
    log.recordFromProvisionalBody({
      ok: true,
      provisional: true,
      commandId: 'reservations.check_in',
      idempotencyKey: 'k1',
      issuedAt: '2026-08-07T12:00:00.000Z',
      businessDate: '2026-08-07',
    });
    expect(log.entries()).toEqual([
      {
        commandId: 'reservations.check_in',
        idempotencyKey: 'k1',
        issuedAt: '2026-08-07T12:00:00.000Z',
        businessDate: '2026-08-07',
      },
    ]);
  });

  it('ignores non-provisional bodies', () => {
    const log = createQueuedCommandLog();
    log.recordFromProvisionalBody({ ok: true });
    log.recordFromProvisionalBody(null);
    expect(log.entries()).toEqual([]);
  });

  it('records optional reservationId from caller context', () => {
    const log = createQueuedCommandLog();
    log.recordFromProvisionalBody(
      {
        provisional: true,
        commandId: 'folio.add_item',
        idempotencyKey: 'k1',
        issuedAt: '2026-08-08T00:00:00.000Z',
      },
      { reservationId: 'res_1' },
    );
    expect(log.entries()[0]?.reservationId).toBe('res_1');
  });

  it('partition puts untagged in other', () => {
    const tagged = {
      commandId: 'folio.add_item',
      idempotencyKey: 'a',
      issuedAt: 't',
      reservationId: 'res_1',
    };
    const untagged = {
      commandId: 'reservations.check_out',
      idempotencyKey: 'b',
      issuedAt: 't',
    };
    const otherRes = {
      commandId: 'folio.add_item',
      idempotencyKey: 'c',
      issuedAt: 't',
      reservationId: 'res_2',
    };
    const { forReservation, other } = partitionQueuedByReservation(
      [tagged, untagged, otherRes],
      'res_1',
    );
    expect(forReservation).toEqual([tagged]);
    expect(other).toEqual([untagged, otherRes]);
  });
});

