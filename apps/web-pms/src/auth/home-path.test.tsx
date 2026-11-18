import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropertyScopedPermission } from '@hospai/contracts';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: { getMe: (...a: unknown[]) => getMe(...a) },
  asClassified: () => ({ class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null }),
}));

import { deniedFallbackFor, homePathFor } from './home-path.js';
import { HomeRedirect } from './HomeRedirect.js';
import { PermissionRoute } from './PermissionRoute.js';

function me(permissions: readonly PropertyScopedPermission[]) {
  return {
    ok: true as const,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_test',
    role: 'staff' as const,
    permissions,
    orgPermissions: ['org:read'] as const,
  };
}

const PAGES = [
  ['/dashboard', 'dashboard'],
  ['/arrivals', 'arrivals'],
  ['/housekeeping', 'housekeeping'],
  ['/maintenance', 'maintenance'],
] as const;

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/folios" element={<PermissionRoute permission="folio:read" />}>
            <Route index element={<div data-testid="folios">folios</div>} />
          </Route>
          {PAGES.map(([p, id]) => (
            <Route key={p} path={p} element={<div data-testid={id}>{id}</div>} />
          ))}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('home by permission (R2.6)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('homePathFor: desk → Dashboard, housekeeping-only → Housekeeping, maintenance-only → Maintenance', () => {
    expect(homePathFor(me(['reservations:read', 'housekeeping:read']))).toBe('/dashboard');
    expect(homePathFor(me(['housekeeping:read', 'housekeeping:write']))).toBe('/housekeeping');
    expect(homePathFor(me(['maintenance:read']))).toBe('/maintenance');
    expect(homePathFor(me([]))).toBe('/dashboard');
    expect(homePathFor(null)).toBe('/dashboard');
  });

  it('deniedFallbackFor: the desk keeps Arrivals; housekeeping-only goes home', () => {
    expect(deniedFallbackFor(me(['reservations:read']))).toBe('/arrivals');
    expect(deniedFallbackFor(me(['housekeeping:read']))).toBe('/housekeeping');
  });

  it('/ sends a housekeeping-only member to Housekeeping', async () => {
    getMe.mockResolvedValue(me(['housekeeping:read', 'housekeeping:write']));
    renderAt('/');
    expect(await screen.findByTestId('housekeeping')).toBeTruthy();
    expect(screen.queryByTestId('dashboard')).toBeNull();
  });

  it('/ keeps the desk on the Dashboard', async () => {
    getMe.mockResolvedValue(me(['reservations:read', 'housekeeping:read']));
    renderAt('/');
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('/ falls open to the Dashboard when /me fails', async () => {
    getMe.mockRejectedValue(new Error('down'));
    renderAt('/');
    expect(await screen.findByTestId('dashboard')).toBeTruthy();
  });

  it('a denied page sends a housekeeping-only member home, not to Arrivals', async () => {
    getMe.mockResolvedValue(me(['housekeeping:read']));
    renderAt('/folios');
    expect(await screen.findByTestId('housekeeping')).toBeTruthy();
    expect(screen.queryByTestId('arrivals')).toBeNull();
  });

  it('a denied page still sends the desk to Arrivals', async () => {
    getMe.mockResolvedValue(me(['reservations:read']));
    renderAt('/folios');
    expect(await screen.findByTestId('arrivals')).toBeTruthy();
  });
});
