import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDomainConfig = vi.fn();
const putDomainConfig = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    putDomainConfig: (...a: unknown[]) => putDomainConfig(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

const PROFORMA_DEFAULT = {
  template: 'STANDARD' as const,
  headerText: '',
  footerText: '',
  show: { perNight: true, taxSummary: true, advances: true, warnings: true },
};

const CARD_DEFAULT = {
  template: 'STANDARD' as const,
  headerText: '',
  footerText: '',
  show: {
    ratePlan: true,
    inclusions: true,
    specialRequests: true,
    idDocument: true,
    signature: true,
  },
};

function domain(key: string, value: unknown) {
  return { key, value, source: 'stored' as const, version: 1, permission: 'settings:configure' };
}

function renderDocuments() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/documents']}>
        <Routes>
          <Route path="/settings/documents" element={<SettingsScreen tab="documents" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('Settings → Documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDomainConfig.mockResolvedValue({
      ok: true,
      keys: [
        domain('pms.documents.proforma', PROFORMA_DEFAULT),
        domain('pms.documents.registration_card', CARD_DEFAULT),
      ],
    });
    putDomainConfig.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Hotel', timeZone: 'UTC' },
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'admin',
      permissions: ['settings:configure'],
      orgPermissions: [],
    });
  });

  afterEach(() => cleanup());

  it('Settings Documents saves proforma presentation with reason', async () => {
    const { invalidateSpy } = renderDocuments();

    expect(await screen.findByRole('link', { name: 'Documents' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const template = await screen.findByLabelText('Proforma template');
    fireEvent.change(template, { target: { value: 'DETAILED' } });

    fireEvent.change(screen.getByPlaceholderText('Why this change…'), {
      target: { value: 'ops:docs-proforma' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save proforma' }));

    await waitFor(() =>
      expect(putDomainConfig).toHaveBeenCalledWith(
        'prop_demo',
        expect.objectContaining({
          key: 'pms.documents.proforma',
          value: expect.objectContaining({ template: 'DETAILED' }),
          reason: expect.any(String),
        }),
      ),
    );

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['domain-config', 'prop_demo'],
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('documents-success')).toHaveTextContent(
        'Proforma settings saved.',
      ),
    );
  });
});
