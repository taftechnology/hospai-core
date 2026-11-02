import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getFrontOfficeSummary = vi.fn();
const getAvailableRooms = vi.fn();
const getArrivals = vi.fn();
const postGuestsBatch = vi.fn();
const getMe = vi.fn();
const getProperty = vi.fn();

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
  api: {
    getFrontOfficeSummary: (...args: unknown[]) => getFrontOfficeSummary(...args),
    getAvailableRooms: (...args: unknown[]) => getAvailableRooms(...args),
    getArrivals: (...args: unknown[]) => getArrivals(...args),
    postGuestsBatch: (...args: unknown[]) => postGuestsBatch(...args),
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
  },
}));

vi.mock('../shell/PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('../shell/property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

vi.mock('../status/property-local-today.js', () => ({
  propertyLocalToday: () => '2026-10-28',
}));

import { DashboardScreen } from './DashboardScreen.js';

const summary = {
  ok: true,
  date: '2026-10-28',
  asOf: 1,
  arrivals: 4,
  departuresDue: 3,
  departed: 1,
  inHouse: 12,
  overstay: 0,
  occupancy: { occupiedRooms: 12, sellableRooms: 20 },
};

function meWith(permissions: string[]) {
  return {
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_1',
    role: 'staff',
    permissions,
    orgPermissions: [],
  };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFrontOfficeSummary.mockResolvedValue(summary);
    getAvailableRooms.mockResolvedValue({
      ok: true,
      fromDate: '2026-10-28',
      toDate: '2026-10-29',
      asOf: 1,
      rooms: [
        { roomId: 'rm_103', roomTypeId: 'rt_king', code: '103', status: 'clean', floor: '1' },
        { roomId: 'rm_104', roomTypeId: 'rt_king', code: '104', status: 'dirty', floor: '1' },
      ],
    });
    getArrivals.mockResolvedValue({
      ok: true,
      items: [
        {
          reservationId: 'res_vip',
          guestRef: 'g_vip',
          status: 'confirmed',
          arrivalDate: '2026-10-28',
          departureDate: '2026-10-30',
          vipFlag: true,
        },
        {
          reservationId: 'res_plain',
          guestRef: 'g_plain',
          status: 'confirmed',
          arrivalDate: '2026-10-28',
          departureDate: '2026-10-29',
        },
      ],
      nextCursor: null,
    });
    postGuestsBatch.mockResolvedValue({
      ok: true,
      guests: {},
      states: {
        g_vip: { kind: 'resolved', displayName: 'Asha Rao' },
        g_plain: { kind: 'resolved', displayName: 'Ravi Kumar' },
      },
    });
    getMe.mockResolvedValue(meWith(['reservations:read', 'night_audit:run']));
    getProperty.mockResolvedValue({
      ok: true,
      property: { propertyId: 'prop_demo', name: 'Lakeview Residency' },
    });
  });

  afterEach(() => cleanup());

  it('is titled Dashboard with the live property name', async () => {
    renderDashboard();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Lakeview Residency/)).toBeInTheDocument());
  });

  it('shows the hub numbers from get_front_desk_summary for the property business date', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId('board-summary')).toBeInTheDocument());
    expect(getFrontOfficeSummary).toHaveBeenCalledWith('prop_demo', '2026-10-28');
    const text = screen.getByTestId('board-summary').textContent ?? '';
    expect(text).toMatch(/Arrivals\s*4/);
    expect(text).toMatch(/Due out\s*3/);
    expect(text).toMatch(/In-house\s*12/);
    expect(text).toMatch(/12 \/ 20/);
  });

  it('counts tonight’s available rooms from the available-rooms read and links to that view', async () => {
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-available-rooms')).toHaveTextContent('2'),
    );
    expect(getAvailableRooms).toHaveBeenCalledWith('prop_demo', {
      fromDate: '2026-10-28',
      toDate: '2026-10-29',
    });
    const link = screen.getByRole('link', { name: /View available rooms/i });
    expect(link.getAttribute('href')).toBe('/board?from=2026-10-28&to=2026-10-29&view=available');
  });

  it('lists only VIP arrivals, with resolved guest names', async () => {
    renderDashboard();
    const vip = await screen.findByTestId('dashboard-vip-arrivals');
    await waitFor(() => expect(vip).toHaveTextContent('Asha Rao'));
    expect(vip).not.toHaveTextContent('Ravi Kumar');
    expect(getArrivals).toHaveBeenCalledWith('prop_demo', '2026-10-28', null);
  });

  it('says so when no VIP is arriving', async () => {
    getArrivals.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    renderDashboard();
    const vip = await screen.findByTestId('dashboard-vip-arrivals');
    await waitFor(() => expect(vip).toHaveTextContent(/No VIP arrivals today/));
  });

  it('shows the night-audit entry point only to users who may run it', async () => {
    renderDashboard();
    const cta = await screen.findByRole('link', { name: /Night audit/i });
    expect(cta.getAttribute('href')).toBe('/night-audit');
  });

  it('hides the night-audit entry point without night_audit:run', async () => {
    getMe.mockResolvedValue(meWith(['reservations:read']));
    renderDashboard();
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await screen.findByTestId('dashboard-vip-arrivals');
    expect(screen.queryByRole('link', { name: /Night audit/i })).toBeNull();
  });

  it('reports an available-rooms failure in an Alert with operator copy', async () => {
    getAvailableRooms.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { error: 'property_unreachable' },
        retryAfterMs: null,
      }),
    );
    renderDashboard();
    const alert = await screen.findByTestId('dashboard-available-error');
    expect(alert).toHaveTextContent('Property unreachable.');
  });
});
