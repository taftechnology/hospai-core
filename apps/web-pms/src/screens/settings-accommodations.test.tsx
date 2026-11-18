import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
  api: { getMe: (...a: unknown[]) => getMe(...a) },
}));

import { SettingsAccommodationsTab } from './settings-accommodations.js';

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsAccommodationsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function me(permissions: string[]) {
  getMe.mockResolvedValue({
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_1',
    role: 'admin',
    permissions,
    orgPermissions: [],
  });
}

function linkIn(id: string): HTMLAnchorElement | null {
  return within(screen.getByTestId(`accommodations-${id}`)).queryByRole('link') as HTMLAnchorElement | null;
}

describe('Settings → Accommodations', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('links to the existing Inventory and Housekeeping screens, with no editor of its own', async () => {
    me(['settings:configure', 'inventory:write', 'housekeeping:read']);
    renderTab();
    await screen.findByRole('link', { name: 'Open room types' });
    expect(linkIn('types')?.getAttribute('href')).toBe('/inventory');
    expect(linkIn('rooms')?.getAttribute('href')).toBe('/inventory/rooms');
    expect(linkIn('ooo')?.getAttribute('href')).toBe('/housekeeping');
    for (const link of screen.getAllByRole('link')) expect(link.className).toContain('ui-link-btn');
    // Not a second editor: no inputs, selects or buttons on the tab.
    const card = screen.getByTestId('settings-accommodations');
    expect(card.querySelectorAll('input, select, textarea, button').length).toBe(0);
    // Track 4 areas stay hidden.
    expect(card.textContent).not.toMatch(/amenit|spaces|split/i);
  });

  it('without inventory:write, says which access is missing instead of linking', async () => {
    me(['settings:configure', 'housekeeping:read']);
    renderTab();
    await screen.findByTestId('accommodations-types');
    await screen.findAllByText(/Needs inventory access/);
    expect(linkIn('types')).toBeNull();
    expect(linkIn('rooms')).toBeNull();
    expect(linkIn('ooo')).toBeNull();
    expect(screen.getByTestId('accommodations-ooo').textContent).toMatch(
      /Needs housekeeping and inventory access/,
    );
  });

  it('housekeeping link needs housekeeping:read as well as inventory:write', async () => {
    me(['settings:configure', 'inventory:write']);
    renderTab();
    await screen.findByRole('link', { name: 'Open room types' });
    expect(linkIn('ooo')).toBeNull();
    expect(linkIn('rooms')?.getAttribute('href')).toBe('/inventory/rooms');
  });

  it('unknown authority shows the links and leaves the decision to the route', async () => {
    getMe.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderTab();
    expect(await screen.findByRole('link', { name: 'Open room types' })).toBeTruthy();
  });
});
