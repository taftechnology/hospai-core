import { describe, expect, it } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';
import { messageForFolioMutationError } from './use-folio-action-mutation.js';

describe('messageForFolioMutationError', () => {
  it('forbidden message renders body.permission', () => {
    const err = new ClassifiedError({
      class: 'forbidden',
      status: 403,
      body: { error: 'forbidden', permission: 'folio:post' },
      retryAfterMs: null,
    });
    expect(messageForFolioMutationError(err, 'Cash failed')).toMatch(/folio:post/);
  });

  it('forbidden message is generic when body omits permission', () => {
    const err = new ClassifiedError({
      class: 'forbidden',
      status: 403,
      body: { error: 'forbidden' },
      retryAfterMs: null,
    });
    expect(messageForFolioMutationError(err, 'Cash failed')).toBe(
      'Forbidden — insufficient permission.',
    );
  });
});
