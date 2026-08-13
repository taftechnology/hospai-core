import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProvisionalExceptionCount = vi.fn();
const getProvisionalExceptions = vi.fn();
const resolveProvisionalException = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProvisionalExceptionCount: (...a: unknown[]) => getProvisionalExceptionCount(...a),
    getProvisionalExceptions: (...a: unknown[]) => getProvisionalExceptions(...a),
    resolveProvisionalException: (...a: unknown[]) => resolveProvisionalException(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { ExceptionsPanel } from './ExceptionsPanel.js';

const staffMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_staff',
  role: 'staff' as const,
  permissions: ['reservations:read', 'folio:read'] as const,
  orgPermissions: ['org:read'] as const,
};

const ownerMe = {
  ...staffMe,
  userId: 'user_owner',
  role: 'admin' as const,
  permissions: ['night_audit:run'] as const,
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExceptionsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('ExceptionsPanel Resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProvisionalExceptionCount.mockResolvedValue({ propertyId: 'prop_demo', exceptionCount: 1 });
    getProvisionalExceptions.mockResolvedValue({
      exceptions: [{ exceptionId: 'exc_1', businessDate: '2026-03-01' }],
    });
    resolveProvisionalException.mockResolvedValue({ ok: true });
  });

  afterEach(() => cleanup());

  it('27: Resolve absent without night_audit:run; present with it; click invalidates', async () => {
    getMe.mockResolvedValue(staffMe);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('exceptions-panel')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    await waitFor(() => expect(screen.getByText('exc_1')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    cleanup();

    getMe.mockResolvedValue(ownerMe);
    const { invalidateSpy } = renderPanel();
    await waitFor(() => expect(screen.getByTestId('exceptions-panel')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /^resolve$/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    });
    await waitFor(() => expect(resolveProvisionalException).toHaveBeenCalled());
    expect(resolveProvisionalException).toHaveBeenCalledWith(
      'prop_demo',
      'exc_1',
      'provisional:resolve:prop_demo:exc_1',
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['provisional-exception-count', 'prop_demo'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['provisional-exceptions', 'prop_demo'],
    });
  });
});
