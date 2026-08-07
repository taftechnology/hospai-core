import { describe, expect, it } from 'vitest';
import { createTransport } from '../src/transport.js';

describe('transport credentials', () => {
  it('attaches exactly what the provider supplies', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response('{}', { status: 200 });
    };
    const t1 = createTransport({
      baseUrl: 'http://x',
      fetchImpl: fetchImpl as typeof fetch,
      credentials: { getCredentialHeaders: () => ({ 'x-dev-actor': 'user_a' }) },
    });
    await t1.fetch('/v1/orgs/o/entitlements');
    expect((calls[0]!.headers as Headers).get('x-dev-actor')).toBe('user_a');

    const t2 = createTransport({
      baseUrl: 'http://x',
      fetchImpl: fetchImpl as typeof fetch,
      credentials: { getCredentialHeaders: () => ({ cookie: 'session=abc' }) },
    });
    await t2.fetch('/v1/orgs/o/entitlements');
    expect((calls[1]!.headers as Headers).get('cookie')).toBe('session=abc');
  });
});
