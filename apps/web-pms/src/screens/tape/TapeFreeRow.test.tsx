import { ClassifiedError } from '@hospai/client-core';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TapeFreeRow } from './TapeFreeRow.js';

const getMe = vi.fn();
const getAvailability = vi.fn();

vi.mock('../../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: {
    getMe: (...args: unknown[]) => getMe(...args),
    getAvailability: (...args: unknown[]) => getAvailability(...args),
  },
}));

function renderRow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TapeFreeRow
        dates={['2026-08-13']}
        tapeCols="2"
        roomTypeIdsOnTape={new Set(['rt'])}
        from="2026-08-13"
        to="2026-08-14"
      />
    </QueryClientProvider>,
  );
}

describe('TapeFreeRow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state instead of 0 while availability is pending', () => {
    getMe.mockResolvedValue({ permissions: ['inventory:read'] });
    getAvailability.mockReturnValue(new Promise(() => {}));
    renderRow();
    return screen.findByRole('status', { name: 'Loading free rooms' }).then((node) => {
      expect(node).toBeTruthy();
      expect(screen.queryByText('0')).toBeNull();
    });
  });

  it('shows Unavailable when the availability read fails', async () => {
    getMe.mockResolvedValue({ permissions: ['inventory:read'] });
    getAvailability.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: {},
        retryAfterMs: null,
      }),
    );
    renderRow();
    // The free row and the occupancy row share one read, so both say Unavailable.
    expect((await screen.findAllByText('Unavailable')).length).toBe(2);
    expect(screen.queryByText('0')).toBeNull();
  });
});
