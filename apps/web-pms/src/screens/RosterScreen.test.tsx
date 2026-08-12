import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const listRoster = vi.fn();
const addRoster = vi.fn();
const setRosterStatus = vi.fn();
const exitRoster = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    listRoster: (...a: unknown[]) => listRoster(...a),
    addRoster: (...a: unknown[]) => addRoster(...a),
    setRosterStatus: (...a: unknown[]) => setRosterStatus(...a),
    exitRoster: (...a: unknown[]) => exitRoster(...a),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { RosterScreen } from './RosterScreen.js';

const writerMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_admin',
  role: 'admin' as const,
  permissions: ['roster:read', 'roster:write'] as const,
  orgPermissions: ['org:read'] as const,
};

const compensationMe = {
  ...writerMe,
  permissions: ['roster:read', 'roster:write', 'roster:compensation'] as const,
};

const ada = {
  staffId: 'staff_ada',
  kinds: ['housekeeper'],
  status: 'active' as const,
  exitedAt: null,
  displayName: 'Ada',
};

function renderRoster(me: typeof writerMe | typeof compensationMe = writerMe) {
  getMe.mockResolvedValue(me);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RosterScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RosterScreen (not E2E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRoster.mockResolvedValue({ ok: true, staff: [] });
    addRoster.mockResolvedValue({ ok: true, staffId: 'staff_new', piiKeyId: 'k1' });
    setRosterStatus.mockResolvedValue({ ok: true });
    exitRoster.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('empty state: Add someone to the roster', async () => {
    renderRoster();
    expect(await screen.findByText(/Add someone to the roster/)).toBeTruthy();
  });

  it('33: compensation inputs absent without roster:compensation (fabricated me, not E2E)', async () => {
    renderRoster(writerMe);
    await screen.findByTestId('roster-screen');
    expect(screen.queryByLabelText(/hourly rate/i)).toBeNull();
    expect(screen.queryByLabelText(/rating/i)).toBeNull();
    expect(screen.queryByLabelText(/skills/i)).toBeNull();
  });

  it('33b: compensation inputs present with roster:compensation', async () => {
    renderRoster(compensationMe);
    await screen.findByTestId('roster-screen');
    expect(await screen.findByLabelText(/hourly rate/i)).toBeTruthy();
    expect(screen.getByLabelText(/rating/i)).toBeTruthy();
    expect(screen.getByLabelText(/skills/i)).toBeTruthy();
  });

  it('32: exit confirm names removal and retained employment record', async () => {
    listRoster.mockResolvedValue({ ok: true, staff: [ada] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRoster();
    fireEvent.click(await screen.findByRole('button', { name: /exit ada/i }));
    expect(confirm).toHaveBeenCalledWith(
      'The name and contact will be removed. The employment record is kept. This cannot be undone.',
    );
    await waitFor(() => {
      expect(exitRoster).toHaveBeenCalledWith('prop_demo', 'staff_ada', expect.any(String));
    });
    confirm.mockRestore();
  });
});
