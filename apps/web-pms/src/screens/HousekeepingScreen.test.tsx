import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const getProperty = vi.fn();
const listRooms = vi.fn();
const listHousekeepingAssignments = vi.fn();
const getHousekeepingPriorities = vi.fn();
const listRoster = vi.fn();

vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => 'UTC',
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...args: unknown[]) => getMe(...args),
    getProperty: (...args: unknown[]) => getProperty(...args),
    listRooms: (...args: unknown[]) => listRooms(...args),
    listHousekeepingAssignments: (...args: unknown[]) => listHousekeepingAssignments(...args),
    getHousekeepingPriorities: (...args: unknown[]) => getHousekeepingPriorities(...args),
    listRoster: (...args: unknown[]) => listRoster(...args),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { HousekeepingScreen } from './HousekeepingScreen.js';

function renderScreen(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HousekeepingScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HousekeepingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_admin',
      role: 'admin',
      permissions: ['housekeeping:read', 'housekeeping:write', 'roster:read'],
      orgPermissions: ['org:read'],
    });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });
    listHousekeepingAssignments.mockResolvedValue({ ok: true, assignments: [] });
    getHousekeepingPriorities.mockResolvedValue({ ok: true, date: '2026-10-29', queue: [] });
    listRoster.mockResolvedValue({ ok: true, staff: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('board subtitle uses the live property name', async () => {
    renderScreen('/housekeeping');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.getByText(/Room status and assignments/)).toBeTruthy();
  });

  it('priority subtitle uses the live property name', async () => {
    renderScreen('/housekeeping/priority');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Housekeeping priority' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Cleaning queue · Harbor Inn/)).toBeTruthy());
  });
});
