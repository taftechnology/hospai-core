import { describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

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

  it('unknown class does not paint the class token', () => {
    const err = new ClassifiedError({
      class: 'server_error',
      status: 500,
      body: {},
      retryAfterMs: null,
    });
    const msg = messageForFolioMutationError(err, 'Cash failed');
    expect(msg).not.toMatch(/server_error/);
    expect(msg).toBe('Cash failed');
  });
});
