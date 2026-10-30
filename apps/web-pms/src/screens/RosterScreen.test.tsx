import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
const listRoster = vi.fn();
const addRoster = vi.fn();
const updateRoster = vi.fn();
const setRosterOps = vi.fn();
const setRosterStatus = vi.fn();
const exitRoster = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    listRoster: (...a: unknown[]) => listRoster(...a),
    addRoster: (...a: unknown[]) => addRoster(...a),
    updateRoster: (...a: unknown[]) => updateRoster(...a),
    setRosterOps: (...a: unknown[]) => setRosterOps(...a),
    setRosterStatus: (...a: unknown[]) => setRosterStatus(...a),
    exitRoster: (...a: unknown[]) => exitRoster(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
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

const readerMe = {
  ...writerMe,
  permissions: ['roster:read'] as const,
};

const ada = {
  staffId: 'staff_ada',
  kinds: ['housekeeper'],
  status: 'active' as const,
  exitedAt: null,
  displayName: 'Ada',
};

function renderRoster(
  me: typeof writerMe | typeof compensationMe | typeof readerMe = writerMe,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  getMe.mockResolvedValue(me);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RosterScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('RosterScreen (not E2E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
    listRoster.mockResolvedValue({ ok: true, staff: [] });
    addRoster.mockResolvedValue({ ok: true, staffId: 'staff_new', piiKeyId: 'k1' });
    updateRoster.mockResolvedValue({ ok: true });
    setRosterOps.mockResolvedValue({ ok: true });
    setRosterStatus.mockResolvedValue({ ok: true });
    exitRoster.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('T6: subtitle uses live property name not hardcoded Meridian', async () => {
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    renderRoster();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Roster' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.queryByText(/Meridian Seattle/)).toBeNull();
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
    renderRoster();
    fireEvent.click(await screen.findByRole('button', { name: /exit ada/i }));
    expect(
      screen.getByText(
        'The name and contact will be removed. The employment record is kept. This cannot be undone.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => {
      expect(exitRoster).toHaveBeenCalledWith('prop_demo', 'staff_ada', expect.any(String));
    });
  });

  it('kinds are two checkboxes; save needs at least one and sends the selected set', async () => {
    renderRoster();
    await screen.findByTestId('roster-add-form');
    await waitFor(() => expect(screen.queryByText(/Roster write is required/)).toBeNull());

    const form = screen.getByTestId('roster-add-form');
    const housekeeper = within(form).getByRole('checkbox', { name: 'Housekeeper' });
    const maintenance = within(form).getByRole('checkbox', { name: 'Maintenance' });
    expect((housekeeper as HTMLInputElement).checked).toBe(true);
    expect((maintenance as HTMLInputElement).checked).toBe(false);

    fireEvent.click(housekeeper);
    expect(within(form).getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
    expect(within(form).getByText('Select at least one kind.')).toBeTruthy();

    fireEvent.click(maintenance);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Bea' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(addRoster).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({ displayName: 'Bea', kinds: ['maintenance'] }),
        expect.any(String),
      );
    });
  });

  it('table shows shift, max rooms, and skills; Edit saves ops or kinds', async () => {
    listRoster.mockResolvedValue({
      ok: true,
      staff: [
        {
          ...ada,
          kinds: ['housekeeper', 'maintenance'],
          ops: {
            shift: 'morning',
            maxRooms: 8,
            skills: ['linen', 'suites', 'turndown', 'vip'],
          },
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderRoster(writerMe, client);

    const row = (await screen.findByText('Housekeeper · Maintenance')).closest('tr');
    expect(row).toBeTruthy();
    expect(within(row!).getByText('Morning')).toBeTruthy();
    expect(within(row!).getByText('8')).toBeTruthy();
    expect(within(row!).getByText('linen')).toBeTruthy();
    expect(within(row!).getByText('suites')).toBeTruthy();
    expect(within(row!).getByText('turndown')).toBeTruthy();
    expect(within(row!).getByText('+1')).toBeTruthy();
    expect(within(row!).queryByText('vip')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Ada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit — Ada' });
    expect(within(dialog).getByRole('group', { name: 'Works as' })).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Max rooms'), { target: { value: '12' } });
    const skill = within(dialog).getByTestId('roster-skill-staff_ada');
    fireEvent.change(skill, { target: { value: 'extra' } });
    fireEvent.keyDown(skill, { key: 'Enter' });
    expect(setRosterOps).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Remove skill extra' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setRosterOps).toHaveBeenCalledTimes(1));
    expect(updateRoster).not.toHaveBeenCalled();
    const firstOp = setRosterOps.mock.calls[0]?.[3];
    expect(firstOp).toMatch(/^[0-9a-f-]{36}$/);
    expect(setRosterOps.mock.calls[0]?.[2]).toEqual({
      shift: 'morning',
      maxRooms: 12,
      skills: ['linen', 'suites', 'turndown', 'vip', 'extra'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster', 'prop_demo'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster', 'prop_demo', 'housekeeper'] });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Ada' }));
    const again = await screen.findByRole('dialog', { name: 'Edit — Ada' });
    fireEvent.change(within(again).getByLabelText('Shift'), { target: { value: 'night' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setRosterOps).toHaveBeenCalledTimes(2));
    expect(updateRoster).not.toHaveBeenCalled();
    expect(setRosterOps.mock.calls[1]?.[3]).not.toBe(firstOp);
  });

  it('changing kinds only calls roster.update; no kind disables Save', async () => {
    listRoster.mockResolvedValue({
      ok: true,
      staff: [{ ...ada, kinds: ['housekeeper', 'maintenance'], ops: { shift: null, maxRooms: null, skills: [] } }],
    });
    renderRoster();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit — Ada' });

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Housekeeper' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Maintenance' }));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    expect(within(dialog).getByText('Pick at least one kind.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Maintenance' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(updateRoster).toHaveBeenCalledWith(
        'prop_demo',
        'staff_ada',
        { kinds: ['maintenance'] },
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      );
    });
    expect(setRosterOps).not.toHaveBeenCalled();
  });

  it('skill chips remove and stop at 10', async () => {
    listRoster.mockResolvedValue({
      ok: true,
      staff: [
        {
          ...ada,
          ops: {
            shift: null,
            maxRooms: null,
            skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
          },
        },
      ],
    });
    renderRoster();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit — Ada' });
    expect(within(dialog).getByText('Maximum of 10 skills.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove skill a' }));
    expect(within(dialog).queryByText('Maximum of 10 skills.')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add' })).toHaveProperty('disabled', false);
  });

  it('without roster:write there is no Edit button', async () => {
    listRoster.mockResolvedValue({
      ok: true,
      staff: [{ ...ada, ops: { shift: 'evening', maxRooms: 4, skills: ['linen'] } }],
    });
    renderRoster(readerMe);
    const row = (await screen.findByText('Ada')).closest('tr');
    expect(within(row!).getByText('Evening')).toBeTruthy();
    expect(within(row!).getByText('4')).toBeTruthy();
    expect(within(row!).getByText('linen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit Ada' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
