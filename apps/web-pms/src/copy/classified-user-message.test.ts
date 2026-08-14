import { describe, expect, it } from 'vitest';
import type { ClassifiedResponse } from '@hospai/client-core';
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
    expect(msg).toMatch(/Something went wrong/i);
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
