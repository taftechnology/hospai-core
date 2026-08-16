/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useQuery, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
