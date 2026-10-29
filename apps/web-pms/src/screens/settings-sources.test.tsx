import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listOperationalConfig = vi.fn();
const putOperationalConfig = vi.fn();
const listDomainConfig = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listOperationalConfig: (...a: unknown[]) => listOperationalConfig(...a),
    putOperationalConfig: (...a: unknown[]) => putOperationalConfig(...a),
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

const config = {
  ok: true as const,
  items: [
    {
      key: 'pms.property.sources' as const,
      value: [{ code: 'OTA', name: 'Online', status: 'active' as const }],
      version: 3,
      source: 'stored' as const,
    },
    {
      key: 'pms.property.market_segments' as const,
      value: [{ code: 'GOV', name: 'Government', status: 'archived' as const }],
      version: 2,
      source: 'stored' as const,
    },
  ],
};

function renderSources() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/sources']}>
        <Routes>
          <Route path="/settings/sources" element={<SettingsScreen tab="sources" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function rowFor(text: string): HTMLElement {
  const row = screen.getByText(text).closest('tr');
  if (!row) throw new Error(`no row for ${text}`);
  return row;
}

describe('Settings → Sources & segments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOperationalConfig.mockResolvedValue(config);
    putOperationalConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listDomainConfig.mockResolvedValue({ ok: true, keys: [] });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Demo Inn', timeZone: 'UTC' },
    });
  });

  afterEach(() => cleanup());

  it('renders the Sources & segments tab with code, name, and status', async () => {
    renderSources();
    expect(screen.getByRole('link', { name: 'Sources & segments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(screen.getByText('OTA')).toBeInTheDocument());
    expect(listOperationalConfig).toHaveBeenCalledWith('prop_demo');
    expect(within(rowFor('OTA')).getByText('Online')).toBeInTheDocument();
    expect(within(rowFor('OTA')).getByText('active')).toBeInTheDocument();
    expect(within(rowFor('GOV')).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('adds a source by putting the whole list and invalidates the query', async () => {
    const { invalidateSpy } = renderSources();
    const card = await screen.findByTestId('booking-sources');
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add source' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'walkin' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Walk-in ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putOperationalConfig).toHaveBeenCalledTimes(1));
    expect(putOperationalConfig).toHaveBeenCalledWith(
      'prop_demo',
      'pms.property.sources',
      [
        { code: 'OTA', name: 'Online', status: 'active' },
        { code: 'WALKIN', name: 'Walk-in', status: 'active' },
      ],
      'Add source WALKIN',
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['operational-config', 'prop_demo'],
      }),
    );
  });

  it('keeps Save disabled for an invalid code', async () => {
    renderSources();
    const card = await screen.findByTestId('booking-sources');
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add source' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'bad code' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bad' } });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(putOperationalConfig).not.toHaveBeenCalled();
  });

  it('archives only after confirm and keeps the code on the list', async () => {
    renderSources();
    await waitFor(() => expect(screen.getByText('OTA')).toBeInTheDocument());
    fireEvent.click(within(rowFor('OTA')).getByRole('button', { name: 'Archive' }));
    expect(putOperationalConfig).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(putOperationalConfig).toHaveBeenCalledTimes(1));
    expect(putOperationalConfig).toHaveBeenCalledWith(
      'prop_demo',
      'pms.property.sources',
      [{ code: 'OTA', name: 'Online', status: 'archived' }],
      'Archive source OTA',
    );
  });

  it('restores an archived segment in a whole-list write', async () => {
    renderSources();
    await waitFor(() => expect(screen.getByText('GOV')).toBeInTheDocument());
    fireEvent.click(within(rowFor('GOV')).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(putOperationalConfig).toHaveBeenCalledWith(
        'prop_demo',
        'pms.property.market_segments',
        [{ code: 'GOV', name: 'Government', status: 'active' }],
        'Restore segment GOV',
      ),
    );
  });

  it('shows a 422 inside the dialog with operator copy', async () => {
    putOperationalConfig.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { ok: false, error: 'config_code_removed' },
        retryAfterMs: null,
      }),
    );
    renderSources();
    const card = await screen.findByTestId('booking-sources');
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add source' });
    fireEvent.change(within(dialog).getByLabelText('Code'), { target: { value: 'WALKIN' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Walk-in' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Archive a code instead of removing it.',
    );
  });

  it('empty lists are an empty state, and a failed read is an Alert', async () => {
    listOperationalConfig.mockResolvedValue({
      ok: true,
      items: [
        { key: 'pms.property.sources', value: [], version: 0, source: 'default' },
        { key: 'pms.property.market_segments', value: [], version: 0, source: 'default' },
      ],
    });
    renderSources();
    expect(await screen.findByText('No booking sources')).toBeInTheDocument();
    expect(screen.getByText('No market segments')).toBeInTheDocument();
    expect(screen.queryByTestId('sources-error')).toBeNull();

    cleanup();
    listOperationalConfig.mockRejectedValue(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    renderSources();
    expect(await screen.findByTestId('sources-error')).toHaveTextContent('Property unreachable.');
    expect(screen.queryByText('No booking sources')).toBeNull();
  });
});
