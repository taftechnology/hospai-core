import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMaintenanceTaskTypes = vi.fn();
const createMaintenanceTaskType = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { propertyId: 'prop_demo' },
  api: {
    getMaintenanceTaskTypes: (...a: unknown[]) => getMaintenanceTaskTypes(...a),
    createMaintenanceTaskType: (...a: unknown[]) => createMaintenanceTaskType(...a),
    updateMaintenanceTaskType: vi.fn(),
  },
  asClassified: () => ({
    class: 'server_error' as const,
    status: 500,
    body: {},
    retryAfterMs: null,
  }),
}));

import { SettingsScreen } from './SettingsScreen.js';
import { maintenanceTaskTypesQueryKey } from './settings-maintenance.js';

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/maintenance']}>
        <SettingsScreen tab="maintenance" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client };
}

describe('Settings maintenance task types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMaintenanceTaskTypes.mockResolvedValue({ taskTypes: [] });
  });

  afterEach(() => cleanup());

  it('shows the maintenance tab', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('Maintenance task types')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Maintenance' })).toBeTruthy();
  });

  it('saving the first task type refreshes the empty list without a reload', async () => {
    const saved = {
      taskTypeId: 'tt_ac',
      name: 'AC repair',
      category: 'hvac',
      defaultPriority: 'high',
      checklist: [],
      active: true,
      createdAt: 1,
      updatedAt: 1,
    };
    getMaintenanceTaskTypes.mockResolvedValueOnce({ taskTypes: [] });
    getMaintenanceTaskTypes.mockResolvedValue({ taskTypes: [saved] });
    createMaintenanceTaskType.mockResolvedValue({ ok: true, taskType: saved });
    const { client } = renderSettings();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await screen.findByText('No task types yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add task type' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), {
      target: { value: 'AC repair' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createMaintenanceTaskType).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: maintenanceTaskTypesQueryKey('prop_demo'),
      }),
    );
    expect(await screen.findByText('AC repair')).toBeTruthy();
    expect(screen.queryByText('No task types yet.')).toBeNull();
  });

  it('shows HVAC and sentence-case priority', async () => {
    getMaintenanceTaskTypes.mockResolvedValue({
      taskTypes: [
        {
          taskTypeId: 'tt_hvac',
          name: 'Filter',
          category: 'hvac',
          defaultPriority: 'emergency',
          checklist: [],
          active: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    renderSettings();
    await waitFor(() => expect(screen.getByText('HVAC')).toBeTruthy());
    expect(screen.getByText('Emergency')).toBeTruthy();
  });
});
