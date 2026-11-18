import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();
const getProvisionalExceptions = vi.fn();
const getProvisionalException = vi.fn();
const retryProvisionalException = vi.fn();
const resolveProvisionalException = vi.fn();
const assignProvisionalException = vi.fn();
const addProvisionalExceptionNote = vi.fn();
const postGuestsBatch = vi.fn();
const listPropertyMembers = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProvisionalExceptions: (...a: unknown[]) => getProvisionalExceptions(...a),
    getProvisionalException: (...a: unknown[]) => getProvisionalException(...a),
    retryProvisionalException: (...a: unknown[]) => retryProvisionalException(...a),
    resolveProvisionalException: (...a: unknown[]) => resolveProvisionalException(...a),
    assignProvisionalException: (...a: unknown[]) => assignProvisionalException(...a),
    addProvisionalExceptionNote: (...a: unknown[]) => addProvisionalExceptionNote(...a),
    postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
    listPropertyMembers: (...a: unknown[]) => listPropertyMembers(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
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

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { ExceptionsScreen } from './ExceptionsScreen.js';

const staffMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_staff',
  role: 'staff' as const,
  permissions: ['property:read', 'reservations:read'] as const,
  orgPermissions: ['org:read'] as const,
};

const ownerMe = {
  ...staffMe,
  userId: 'user_owner',
  role: 'admin' as const,
  permissions: ['property:read', 'night_audit:run', 'staff:read'] as const,
};

const checkInRow = {
  exceptionId: 'exc_1',
  commandType: 'reservations.check_in',
  reason: 'room_already_assigned',
  businessDate: '2026-03-01',
  createdAt: Date.UTC(2026, 2, 1, 12),
  resolvedAt: null,
  assignedTo: null,
  affected: {
    reservationId: 'res_1',
    roomId: 'rm_1',
    guestRef: 'g1',
    folioLineId: null,
  },
  payload: { reservationId: 'res_1' },
};

function renderScreen(path = '/exceptions') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exceptions" element={<ExceptionsScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExceptionsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
    getProvisionalExceptions.mockResolvedValue({ ok: true, exceptions: [checkInRow], nextCursor: null });
    getProvisionalException.mockResolvedValue({
      ok: true,
      exception: checkInRow,
      actions: [],
      notes: [],
    });
    postGuestsBatch.mockResolvedValue({ ok: true, guests: {}, states: {} });
    listPropertyMembers.mockResolvedValue({ ok: true, members: [] });
    retryProvisionalException.mockResolvedValue({ ok: true, retried: true });
    resolveProvisionalException.mockResolvedValue({ ok: true });
    assignProvisionalException.mockResolvedValue({ ok: true });
    addProvisionalExceptionNote.mockResolvedValue({ ok: true });
  });

  afterEach(() => cleanup());

  it('T8: subtitle uses live property name not hardcoded Meridian', async () => {
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Exceptions' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.queryByText(/Meridian Seattle/)).toBeNull();
  });

  it('filters write ?resolution=', async () => {
    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('exceptions-workbench')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /^resolved$/i }));
    });
    await waitFor(() =>
      expect(getProvisionalExceptions).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({ resolution: 'resolved' }),
      ),
    );
  });

  it('Retry/Resolve/Assign/Note present for owner, absent for staff; confirmation before resolve', async () => {
    getMe.mockResolvedValue(staffMe);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('exceptions-workbench')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^resolve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^assign$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^note$/i })).toBeNull();
    cleanup();

    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /^resolve$/i })).toBeTruthy());
    expect(screen.getByRole('button', { name: /^retry$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^assign$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^note$/i })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^resolve$/i }));
    });
    expect(resolveProvisionalException).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    });
    await waitFor(() => expect(resolveProvisionalException).toHaveBeenCalled());
  });

  it('Folio link for a check-in row; guest CRM href when guestRef is set', async () => {
    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    await waitFor(() => expect(screen.getByRole('link', { name: /^folio$/i })).toBeTruthy());
    expect(screen.getByRole('link', { name: /^folio$/i }).getAttribute('href')).toBe('/folio/res_1');
    expect(screen.getByRole('link', { name: /^check-in$/i }).getAttribute('href')).toBe(
      '/check-in/res_1',
    );
    expect(document.querySelector('a[href="/guests/g1"]')).toBeTruthy();
  });

  it('a list error is an alert, not an empty match', async () => {
    getMe.mockResolvedValue(ownerMe);
    getProvisionalExceptions.mockRejectedValue(
      new ClassifiedError({
        class: 'read_stale',
        status: 503,
        body: {},
        retryAfterMs: 0,
      }),
    );
    renderScreen();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Data is stale/);
    expect(screen.queryByText(/No exceptions match/)).toBeNull();
  });
});
