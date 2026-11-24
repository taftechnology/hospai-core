import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError, type TenantOrg } from '@hospai/client-core';
import type { Authority } from '../auth/me.js';

const getMeTenants = vi.fn();
const getMe = vi.fn();
const getArrivals = vi.fn();
const getDepartures = vi.fn();
const getInHouse = vi.fn();
const postGuestsBatch = vi.fn();
const getFrontOfficeSummary = vi.fn();
const listRooms = vi.fn();
const resetTenantBoundState = vi.fn();

vi.mock('../client.js', async () => {
  const { createTenantAccessor } = await import('../tenant-store.js');
  const { ClassifiedError: CE } = await import('@hospai/client-core');
  return {
    tenant: createTenantAccessor(),
    resetTenantBoundState: () => resetTenantBoundState(),
    asClassified: (err: unknown) =>
      err instanceof CE
        ? err.classified
        : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
    api: {
      getMeTenants: (...a: unknown[]) => getMeTenants(...a),
      getMe: (...a: unknown[]) => getMe(...a),
      getArrivals: (...a: unknown[]) => getArrivals(...a),
      getDepartures: (...a: unknown[]) => getDepartures(...a),
      getInHouse: (...a: unknown[]) => getInHouse(...a),
      postGuestsBatch: (...a: unknown[]) => postGuestsBatch(...a),
      getFrontOfficeSummary: (...a: unknown[]) => getFrontOfficeSummary(...a),
      listRooms: (...a: unknown[]) => listRooms(...a),
    },
  };
});

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => 'UTC');
});

import { BoardScreen } from '../screens/BoardScreen.js';
import {
  configureTenantDefault,
  readSavedTenant,
  saveTenant,
  setTenantSelection,
  TENANT_STORAGE_KEY,
} from '../tenant-store.js';
import { FrontOfficeLive } from './FrontOfficeLive.js';
import { TenantProvider } from './TenantProvider.js';
import { useTenantSwitcher } from './tenant-context.js';

function org(orgId: string, propertyIds: string[], multiProperty = true): TenantOrg {
  return {
    orgId,
    name: orgId,
    multiProperty,
    properties: propertyIds.map((propertyId) => ({ propertyId, name: propertyId, timeZone: 'UTC' })),
  };
}

const TENANTS = [org('org_1', ['prop_a', 'prop_b']), org('org_2', ['prop_c'])];

const liveAuth: Authority = {
  kind: 'live',
  me: {
    ok: true,
    orgId: 'org_1',
    propertyId: 'prop_a',
    userId: 'user_x',
    role: 'staff',
    permissions: ['reservations:read', 'folio:read'],
    orgPermissions: ['org:read'],
  },
};

let mounts = 0;

function Probe() {
  const switcher = useTenantSwitcher();
  const location = useLocation();
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <div>
      <span data-testid="active">
        {switcher ? `${switcher.active.orgId}/${switcher.active.propertyId}` : 'none'}
      </span>
      <span data-testid="path">{location.pathname}</span>
      <button
        type="button"
        onClick={() => switcher?.switchTenant({ orgId: 'org_1', propertyId: 'prop_b' })}
      >
        go-b
      </button>
    </div>
  );
}

function renderProvider(children: React.ReactNode, path = '/arrivals') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <TenantProvider>{children}</TenantProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('TenantProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mounts = 0;
    setTenantSelection(null);
    configureTenantDefault(null);
    getMeTenants.mockResolvedValue({ tenants: TENANTS });
    getMe.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setTenantSelection(null);
    configureTenantDefault({ orgId: 'org_demo', propertyId: 'prop_demo' });
  });

  it('shows the boot skeleton while the list loads', () => {
    getMeTenants.mockReturnValue(new Promise(() => {}));
    renderProvider(<Probe />);
    expect(screen.getByRole('status', { name: /loading your hotels/i })).toBeTruthy();
    expect(screen.queryByTestId('active')).toBeNull();
  });

  it('selection order: saved choice wins when still in the list', async () => {
    saveTenant({ orgId: 'org_2', propertyId: 'prop_c' });
    configureTenantDefault({ orgId: 'org_1', propertyId: 'prop_b' });
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_2/prop_c'));
  });

  it('selection order: a saved choice that left the list is ignored, then the env default, then the first property', async () => {
    saveTenant({ orgId: 'org_gone', propertyId: 'prop_gone' });
    configureTenantDefault({ orgId: 'org_1', propertyId: 'prop_b' });
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_1/prop_b'));
    cleanup();

    // default not in the list: first property of the first org
    configureTenantDefault({ orgId: 'org_demo', propertyId: 'prop_demo' });
    setTenantSelection(null);
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_1/prop_a'));
  });

  it('an empty list shows the no-access state, not a crash', async () => {
    getMeTenants.mockResolvedValue({ tenants: [] });
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('tenants-no-access')).toBeTruthy());
    expect(screen.getByText("You don't have access to any hotel")).toBeTruthy();
    expect(screen.queryByTestId('active')).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it('an empty list with an env default asks /me once (server back-fill) and lists again', async () => {
    configureTenantDefault({ orgId: 'org_1', propertyId: 'prop_a' });
    getMeTenants.mockResolvedValueOnce({ tenants: [] }).mockResolvedValueOnce({ tenants: TENANTS });
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_1/prop_a'));
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledWith('prop_a');
    expect(getMeTenants).toHaveBeenCalledTimes(2);
  });

  it('a failed list shows an error Alert; unreachable /me during back-fill keeps the empty state', async () => {
    getMeTenants.mockRejectedValue(
      new ClassifiedError({ class: 'server_error', status: 500, body: {}, retryAfterMs: null }),
    );
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('tenants-error')).toBeTruthy());
    cleanup();

    configureTenantDefault({ orgId: 'org_1', propertyId: 'prop_a' });
    getMeTenants.mockReset();
    getMeTenants.mockResolvedValue({ tenants: [] });
    getMe.mockRejectedValue(new Error('404'));
    renderProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('tenants-no-access')).toBeTruthy());
  });

  it('switching writes the choice, resets singletons, clears the cache, goes home and remounts', async () => {
    const { client } = renderProvider(<Probe />, '/reservations');
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_1/prop_a'));
    expect(mounts).toBe(1);
    expect(screen.getByTestId('path').textContent).toBe('/reservations');

    client.setQueryData(['me', 'prop_a'], { role: 'owner' });
    client.setQueryData(['board', 'arrivals', 'prop_a', '2026-11-23', null], { items: [] });

    fireEvent.click(screen.getByText('go-b'));

    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('org_1/prop_b'));
    expect(readSavedTenant()).toEqual({ orgId: 'org_1', propertyId: 'prop_b' });
    expect(JSON.parse(localStorage.getItem(TENANT_STORAGE_KEY)!)).toEqual({
      orgId: 'org_1',
      propertyId: 'prop_b',
    });
    expect(resetTenantBoundState).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['me', 'prop_a'])).toBeUndefined();
    expect(client.getQueryData(['board', 'arrivals', 'prop_a', '2026-11-23', null])).toBeUndefined();
    expect(screen.getByTestId('path').textContent).toBe('/');
    // Probe unmounted and mounted again: everything under the provider remounts.
    expect(mounts).toBe(2);
  });

  it('FrontOfficeLive reconnects to the new property after a switch', async () => {
    const urls: string[] = [];
    const createSocket = (url: string) => {
      urls.push(url);
      return {
        readyState: 1,
        send() {},
        close() {},
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
    };
    renderProvider(
      <>
        <Probe />
        <FrontOfficeLive authority={liveAuth} createSocket={createSocket} />
      </>,
    );
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]).toContain('prop_a');

    fireEvent.click(screen.getByText('go-b'));
    await waitFor(() => expect(urls.some((u) => u.includes('prop_b'))).toBe(true));
    expect(urls[urls.length - 1]).toContain('prop_b');
    expect(urls[urls.length - 1]).not.toContain('prop_a');
  });

  it('after switching A to B the board query key carries B and no A data renders', async () => {
    getArrivals.mockImplementation(async (propertyId: string) => ({
      ok: true,
      items: [
        {
          reservationId: propertyId === 'prop_a' ? 'res_only_in_a' : 'res_only_in_b',
          guestRef: 'g1',
          status: 'confirmed',
          arrivalDate: '2026-11-23',
          departureDate: '2026-11-24',
        },
      ],
      nextCursor: null,
    }));
    getDepartures.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    getInHouse.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    postGuestsBatch.mockResolvedValue({ ok: true, guests: {}, states: { g1: { kind: 'name_pending' } } });
    getFrontOfficeSummary.mockResolvedValue({
      ok: true,
      date: '2026-11-23',
      asOf: 1,
      arrivals: 1,
      departuresDue: 0,
      departed: 0,
      inHouse: 0,
      overstay: 0,
      occupancy: { occupiedRooms: 0, sellableRooms: 1 },
    });
    listRooms.mockResolvedValue({ ok: true, rooms: [] });

    const { client } = renderProvider(
      <>
        <Probe />
        <BoardScreen mode="arrivals" />
      </>,
    );
    await waitFor(() => {
      const hrefs = screen.getAllByRole('link', { name: /^Folio$/i }).map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/folio/res_only_in_a');
    });
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ['board'] })
        .every((q) => q.queryKey[2] === 'prop_a'),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText('go-b'));
    });

    await waitFor(() => {
      const hrefs = screen.getAllByRole('link', { name: /^Folio$/i }).map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/folio/res_only_in_b');
    });
    expect(document.body.innerHTML).not.toContain('res_only_in_a');
    const boardKeys = client.getQueryCache().findAll({ queryKey: ['board'] });
    expect(boardKeys.length).toBeGreaterThan(0);
    for (const q of boardKeys) expect(q.queryKey[2]).toBe('prop_b');
    expect(getArrivals.mock.calls.some((c) => c[0] === 'prop_b')).toBe(true);
  });
});
