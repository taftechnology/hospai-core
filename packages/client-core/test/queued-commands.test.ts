import { describe, expect, it } from 'vitest';
import { createQueuedCommandLog } from '../src/queued-commands.js';

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
});
