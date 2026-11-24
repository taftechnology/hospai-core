import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantOrg } from '@hospai/client-core';
import type { Authority } from '../auth/me.js';

const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_1', propertyId: 'prop_a' },
  asClassified: () => ({ class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null }),
  api: {
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    openShift: async () => ({ ok: true }),
    searchDesk: async () => ({ classified: { class: 'live' }, body: { ok: true, items: [] } }),
  },
}));

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { TopBar } from './TopBar.js';
import { TenantSwitcherContext } from './tenant-context.js';

const authority: Authority = {
  kind: 'live',
  me: {
    ok: true,
    orgId: 'org_1',
    propertyId: 'prop_a',
    userId: 'user_x',
    role: 'owner',
    permissions: ['reservations:read', 'folio:read', 'folio:post'],
    orgPermissions: ['org:read'],
  },
};

function org(orgId: string, props: Array<[string, string]>, multiProperty: boolean): TenantOrg {
  return {
    orgId,
    name: `Org ${orgId}`,
    multiProperty,
    properties: props.map(([propertyId, name]) => ({ propertyId, name, timeZone: 'UTC' })),
  };
}

const switchTenant = vi.fn();

function renderTopBar(orgs: TenantOrg[] | null, active = { orgId: 'org_1', propertyId: 'prop_a' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bar = (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TopBar authority={authority} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    orgs ? (
      <TenantSwitcherContext.Provider value={{ orgs, active, switchTenant }}>
        {bar}
      </TenantSwitcherContext.Provider>
    ) : (
      bar
    ),
  );
}

describe('TopBar property switcher (R4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_a', timeZone: 'UTC', name: 'Hotel Alpha' },
      businessDate: '2026-11-23',
    });
  });
  afterEach(() => cleanup());

  it('without a TenantProvider the plain name stays', async () => {
    renderTopBar(null);
    await waitFor(() => expect(screen.getByTestId('property-name').textContent).toBe('Hotel Alpha'));
    expect(screen.queryByTestId('property-switcher')).toBeNull();
  });

  it('is hidden with one property, even on a multi-property plan', async () => {
    renderTopBar([org('org_1', [['prop_a', 'Hotel Alpha']], true)]);
    await waitFor(() => expect(screen.getByTestId('property-name').textContent).toBe('Hotel Alpha'));
    expect(screen.queryByTestId('property-switcher')).toBeNull();
    expect(screen.queryByTestId('org-switcher')).toBeNull();
  });

  it('is hidden when multiProperty is false, even with two properties', async () => {
    renderTopBar([org('org_1', [['prop_a', 'Hotel Alpha'], ['prop_b', 'Hotel Bravo']], false)]);
    await waitFor(() => expect(screen.getByTestId('property-name').textContent).toBe('Hotel Alpha'));
    expect(screen.queryByTestId('property-switcher')).toBeNull();
  });

  it('is shown with a labelled select when multiProperty and more than one property; choosing switches', async () => {
    renderTopBar([org('org_1', [['prop_a', 'Hotel Alpha'], ['prop_b', 'Hotel Bravo']], true)]);
    const select = (await screen.findByTestId('property-switcher')) as HTMLSelectElement;
    expect(screen.getByLabelText('Hotel')).toBe(select);
    expect(select.value).toBe('prop_a');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Hotel Alpha',
      'Hotel Bravo',
    ]);
    expect(screen.queryByTestId('property-name')).toBeNull();

    fireEvent.change(select, { target: { value: 'prop_b' } });
    expect(switchTenant).toHaveBeenCalledWith({ orgId: 'org_1', propertyId: 'prop_b' });
  });

  it('a user in two orgs gets an org select; choosing an org selects its first property', async () => {
    renderTopBar([
      org('org_1', [['prop_a', 'Hotel Alpha']], false),
      org('org_2', [['prop_z', 'Hotel Zulu'], ['prop_y', 'Hotel Yankee']], true),
    ]);
    const select = (await screen.findByTestId('org-switcher')) as HTMLSelectElement;
    expect(screen.getByLabelText('Organisation')).toBe(select);
    fireEvent.change(select, { target: { value: 'org_2' } });
    expect(switchTenant).toHaveBeenCalledWith({ orgId: 'org_2', propertyId: 'prop_z' });
  });
});
