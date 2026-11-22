import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const listEventConsumerExceptions = vi.fn();
const retryEventConsumerException = vi.fn();
const dismissEventConsumerException = vi.fn();
const getFormCRegister = vi.fn();

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
    listEventConsumerExceptions: (...a: unknown[]) => listEventConsumerExceptions(...a),
    retryEventConsumerException: (...a: unknown[]) => retryEventConsumerException(...a),
    dismissEventConsumerException: (...a: unknown[]) => dismissEventConsumerException(...a),
    getFormCRegister: (...a: unknown[]) => getFormCRegister(...a),
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
    listEventConsumerExceptions.mockResolvedValue({ ok: true, count: 0, exceptions: [] });
    retryEventConsumerException.mockResolvedValue({ ok: true });
    dismissEventConsumerException.mockResolvedValue({ ok: true });
    getFormCRegister.mockResolvedValue({ ok: true, rows: [] });
  });

  afterEach(() => cleanup());

  it('R6.2: an India property with overdue Form C records shows an alert linking to the register', async () => {
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
      formCApplicable: true,
    });
    getFormCRegister.mockResolvedValue({
      ok: true,
      rows: [{ recordId: 'fcb_1' }, { recordId: 'fcb_2' }, { recordId: 'fcb_3' }],
    });
    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    const alert = await screen.findByTestId('form-c-overdue-alert');
    expect(getFormCRegister).toHaveBeenCalledWith('prop_demo', 'overdue');
    expect(alert.textContent).toContain('3 Form C records are past their 24-hour deadline.');
    expect(within(alert).getByRole('link').getAttribute('href')).toBe('/form-c?filter=overdue');
  });

  it('R6.2: no Form C alert outside India or at zero overdue', async () => {
    getMe.mockResolvedValue(ownerMe);
    getFormCRegister.mockResolvedValue({ ok: true, rows: [{ recordId: 'fcb_1' }] });
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Exceptions' })).toBeTruthy(),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(getFormCRegister).not.toHaveBeenCalled();
    expect(screen.queryByTestId('form-c-overdue-alert')).toBeNull();
  });

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

  it('event delivery is empty, errors, and filters as three states', async () => {
    getMe.mockResolvedValue(ownerMe);
    renderScreen();
    expect(await screen.findByText('No event delivery failures.')).toBeTruthy();

    cleanup();
    listEventConsumerExceptions.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderScreen();
    expect(await screen.findByText('Could not load event delivery failures.')).toBeTruthy();

    cleanup();
    listEventConsumerExceptions.mockImplementation(async (_id: string, query?: { status?: string }) => {
      if (query?.status === 'all') return { ok: true, count: 0, exceptions: [] };
      return { ok: true, count: 0, exceptions: [] };
    });
    renderScreen();
    await screen.findByText('No event delivery failures.');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    expect(await screen.findByText('No event delivery failures match this filter.')).toBeTruthy();
  });

  it('retry and dismiss invalidate the event delivery list and require a reason', async () => {
    getMe.mockResolvedValue(ownerMe);
    listEventConsumerExceptions.mockResolvedValue({
      ok: true,
      count: 1,
      exceptions: [
        {
          exceptionId: 'ece_1',
          consumerId: 'pms.ari_projection',
          consumerLabel: 'ARI projection',
          eventType: 'availability.changed',
          attempts: 2,
          firstFailedAt: Date.UTC(2026, 2, 1, 12),
          lastFailedAt: Date.UTC(2026, 2, 2, 12),
          errorCode: 'timeout',
          errorDetail: 'slow',
          resolvedAt: null,
          resolution: null,
        },
      ],
    });
    renderScreen();
    const section = await screen.findByTestId('event-delivery');
    const view = within(section);
    await waitFor(() => expect(view.getByRole('button', { name: /^retry$/i })).toBeTruthy());
    const callsBefore = listEventConsumerExceptions.mock.calls.length;
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() => expect(retryEventConsumerException).toHaveBeenCalledTimes(1));
    const success = await screen.findByText('The event was re-sent.');
    expect(success.className).toContain('ui-alert--settled');
    const firstKey = retryEventConsumerException.mock.calls[0]?.[2] as string;
    expect(firstKey).toMatch(/^event:retry:prop_demo:ece_1:/);
    await waitFor(() =>
      expect((view.getByRole('button', { name: /^retry$/i }) as HTMLButtonElement).disabled).toBe(false),
    );
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^retry$/i }));
    });
    await waitFor(() => expect(retryEventConsumerException).toHaveBeenCalledTimes(2));
    const secondKey = retryEventConsumerException.mock.calls[1]?.[2] as string;
    expect(secondKey).toMatch(/^event:retry:prop_demo:ece_1:/);
    expect(secondKey).not.toBe(firstKey);
    await waitFor(() => expect(listEventConsumerExceptions.mock.calls.length).toBeGreaterThan(callsBefore));

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^dismiss$/i }));
    });
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^dismiss$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'not our event' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(dismissEventConsumerException).toHaveBeenCalled());
  });

  it('a failed event retry shows an exception alert', async () => {
    getMe.mockResolvedValue(ownerMe);
    listEventConsumerExceptions.mockResolvedValue({
      ok: true,
      count: 1,
      exceptions: [
        {
          exceptionId: 'ece_1',
          consumerId: 'pms.ari_projection',
          consumerLabel: 'ARI projection',
          eventType: 'availability.changed',
          attempts: 2,
          firstFailedAt: Date.UTC(2026, 2, 1, 12),
          lastFailedAt: Date.UTC(2026, 2, 2, 12),
          errorCode: 'timeout',
          errorDetail: 'slow',
          resolvedAt: null,
          resolution: null,
        },
      ],
    });
    retryEventConsumerException.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderScreen();
    const section = await screen.findByTestId('event-delivery');
    const view = within(section);
    await waitFor(() => expect(view.getByRole('button', { name: /^retry$/i })).toBeTruthy());
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /^retry$/i }));
    });
    const failure = await view.findByText('Could not retry this event.');
    expect(failure.className).toContain('ui-alert--exception');
  });

  it('disables event delivery actions without night_audit:run', async () => {
    getMe.mockResolvedValue(staffMe);
    listEventConsumerExceptions.mockResolvedValue({
      ok: true,
      count: 1,
      exceptions: [
        {
          exceptionId: 'ece_1',
          consumerId: 'pms.ari_projection',
          consumerLabel: 'ARI projection',
          eventType: 'availability.changed',
          attempts: 1,
          firstFailedAt: Date.UTC(2026, 2, 1),
          lastFailedAt: Date.UTC(2026, 2, 1),
          errorCode: 'handler_error',
          errorDetail: null,
          resolvedAt: null,
          resolution: null,
        },
      ],
    });
    renderScreen();
    const section = await screen.findByTestId('event-delivery');
    expect(within(section).getByText(/Night audit permission is required/)).toBeTruthy();
    await waitFor(() => expect(within(section).getByRole('button', { name: /^retry$/i })).toBeTruthy());
    expect((within(section).getByRole('button', { name: /^retry$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(section).getByRole('button', { name: /^dismiss$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
