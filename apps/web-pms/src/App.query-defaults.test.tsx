/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useQuery, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => ({
  asClassified: (err: unknown) => ({
    class: 'server_error' as const,
    status: 500,
    body: { error: String(err) },
    retryAfterMs: null,
  }),
}));

import { createQueryClient } from './query-client.js';

describe('App QueryClient defaults', () => {
  afterEach(() => cleanup());

  it('does not refetch on window focus', async () => {
    const queryFn = vi.fn(async () => 'ok');
    const client = createQueryClient();
    function Probe() {
      useQuery({ queryKey: ['focus-test'], queryFn });
      return null;
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 50));

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('a successful mutation marks the room board stale; a failed one does not', async () => {
    const client = createQueryClient();
    client.setQueryData(['room-board', 'prop_demo'], { ok: true, rooms: [] });
    client.setQueryData(['front-desk-tape', 'prop_demo', 'a', 'b'], { ok: true });
    client.setQueryData(['housekeeping-dashboard', 'prop_demo', '2026-11-20', ''], { ok: true });
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new Error('nope');
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(client.getQueryState(['room-board', 'prop_demo'])?.isInvalidated).toBe(false);
    expect(
      client.getQueryState(['housekeeping-dashboard', 'prop_demo', '2026-11-20', ''])?.isInvalidated,
    ).toBe(false);

    await client
      .getMutationCache()
      .build(client, { mutationFn: async () => 'ok' })
      .execute(undefined);
    expect(client.getQueryState(['room-board', 'prop_demo'])?.isInvalidated).toBe(true);
    // R4.31: the housekeeping supervisor dashboard goes stale on the same success.
    expect(
      client.getQueryState(['housekeeping-dashboard', 'prop_demo', '2026-11-20', ''])?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(['front-desk-tape', 'prop_demo', 'a', 'b'])?.isInvalidated).toBe(false);
  });
});
