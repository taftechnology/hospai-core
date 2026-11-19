import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProvisionalExceptionCount = vi.fn();
const listEventConsumerExceptions = vi.fn();
const getProvisionalExceptions = vi.fn();
const resolveProvisionalException = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProvisionalExceptionCount: (...a: unknown[]) => getProvisionalExceptionCount(...a),
    listEventConsumerExceptions: (...a: unknown[]) => listEventConsumerExceptions(...a),
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
  permissions: ['reservations:read', 'folio:read', 'property:read'] as const,
  orgPermissions: ['org:read'] as const,
};

const ownerMe = {
  ...staffMe,
  userId: 'user_owner',
  role: 'admin' as const,
  permissions: ['night_audit:run', 'property:read'] as const,
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExceptionsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExceptionsPanel badge-as-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProvisionalExceptionCount.mockResolvedValue({ propertyId: 'prop_demo', exceptionCount: 1 });
    listEventConsumerExceptions.mockResolvedValue({ ok: true, count: 0, exceptions: [] });
    getProvisionalExceptions.mockResolvedValue({
      exceptions: [{ exceptionId: 'exc_1', businessDate: '2026-03-01' }],
    });
    resolveProvisionalException.mockResolvedValue({ ok: true });
  });

  afterEach(() => cleanup());

  it('staff and owner see Exceptions link; no Resolve; click does not resolve', async () => {
    getMe.mockResolvedValue(staffMe);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('exceptions-panel')).toBeTruthy());
    const staffLink = screen.getByRole('link', { name: /exceptions/i });
    expect(staffLink.getAttribute('href')).toBe('/exceptions');
    expect(screen.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    await act(async () => {
      fireEvent.click(staffLink);
    });
    expect(resolveProvisionalException).not.toHaveBeenCalled();
    cleanup();

    getMe.mockResolvedValue(ownerMe);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('exceptions-panel')).toBeTruthy());
    const ownerLink = screen.getByRole('link', { name: /exceptions/i });
    expect(ownerLink.getAttribute('href')).toBe('/exceptions');
    expect(screen.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    await act(async () => {
      fireEvent.click(ownerLink);
    });
    expect(resolveProvisionalException).not.toHaveBeenCalled();
    expect(getProvisionalExceptions).not.toHaveBeenCalled();
  });
});
