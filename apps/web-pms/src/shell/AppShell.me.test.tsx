import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';
import { propertyLocalToday } from '../status/property-local-today.js';

const getMe = vi.fn();
const getProperty = vi.fn();
const { tzForTest } = vi.hoisted(() => ({
  tzForTest: { current: 'UTC' as string | null },
}));

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    openShift: async () => ({ ok: true }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    getProvisionalExceptions: async () => ({ items: [] }),
    searchDesk: async () => ({ classified: { class: 'live' }, body: { ok: true, items: [] } }),
  },
  queuedCommands: (() => {
    const entries: never[] = [];
    return { entries: () => entries, subscribe: () => () => {} };
  })(),
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return {
      class: 'server_error' as const,
      status: 500,
      body: {},
      retryAfterMs: null,
    };
  },
}));

vi.mock('./PropertyFormat.js', async () => {
  const { propertyFormatTestModule } = await import('./property-format-test-stub.js');
  return propertyFormatTestModule(() => tzForTest.current);
});

import { AppShell } from './AppShell.js';

const liveOwner = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_owner',
  role: 'owner' as const,
  permissions: ['reservations:read', 'folio:read', 'folio:post'] as const,
  orgPermissions: ['org:read'] as const,
};

function renderShell(path = '/arrivals') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/arrivals" element={<div>board-outlet</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell /me states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tzForTest.current = 'UTC';
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
  });

  it('404 → no-access copy; board nav absent', async () => {
    getMe.mockRejectedValue(
      new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { error: 'not_found' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() => expect(screen.getByTestId('me-no-access')).toBeTruthy());
    expect(screen.getByText(/don't have access to this property/i)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: /hospai pms/i })).toBeNull();
    expect(screen.queryByText('board-outlet')).toBeNull();
  });

  it('unauthorized → assign /sign-in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    getMe.mockRejectedValue(
      new ClassifiedError({
        class: 'unauthorized',
        status: 401,
        body: { error: 'unauthorized' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'));
  });

  it('live owner paints role, property name, date chip; no role-swap or simulation chrome', async () => {
    getMe.mockResolvedValue(liveOwner);
    renderShell();

    await waitFor(() => expect(screen.getByTestId('shell-role').textContent).toBe('Owner'));
    expect(screen.getByRole('combobox', { name: 'Guest name, room or booking ID' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /role/i })).toBeNull();
    expect(screen.queryByText(/Simulation Active/i)).toBeNull();
    expect(screen.queryByText(/Whistle/i)).toBeNull();
    expect(screen.getByTestId('property-name').textContent).toBe('Demo');
    const chip = screen.getByTestId('business-date-chip');
    expect(chip.textContent).toMatch(/Business date/);
    const iso = propertyLocalToday('UTC');
    const [year, month, day] = iso.split('-');
    expect(chip.textContent).toContain(`${day}/${month}/${year}`);
  });

  it('theme switch sits in the sidebar footer and Dark stores data-theme', async () => {
    getMe.mockResolvedValue(liveOwner);
    renderShell();
    const group = await screen.findByRole('group', { name: 'Theme' });
    const system = screen.getByRole('button', { name: 'System theme' });
    const light = screen.getByRole('button', { name: 'Light theme' });
    const dark = screen.getByRole('button', { name: 'Dark theme' });
    expect(group.contains(system)).toBe(true);
    expect(group.contains(light)).toBe(true);
    expect(group.contains(dark)).toBe(true);
    expect(system.getAttribute('aria-pressed')).toBe('true');
    expect(light.getAttribute('aria-pressed')).toBe('false');
    expect(dark.getAttribute('aria-pressed')).toBe('false');
    expect(group.closest('.app-sidebar-footer')).toBeTruthy();
    expect(document.querySelector('.top-bar [role="group"][aria-label="Theme"]')).toBeNull();
    fireEvent.click(dark);
    expect(dark.getAttribute('aria-pressed')).toBe('true');
    expect(system.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hospai.theme')).toBe('dark');
  });

  it('every sidebar nav item carries an icon', async () => {
    getMe.mockResolvedValue(liveOwner);
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'HospAI PMS' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeTruthy());
    const links = within(nav).getAllByRole('link');
    const missing = links.filter((a) => !a.querySelector('svg')).map((a) => a.textContent);
    expect(missing).toEqual([]);
  });

  it('T3: sidebar brand is p not h1', async () => {
    getMe.mockResolvedValue(liveOwner);
    renderShell('/arrivals');
    await waitFor(() => expect(screen.getByText('board-outlet')).toBeTruthy());
    expect(document.querySelector('.app-sidebar-brand h1')).toBeNull();
    expect(document.querySelector('.app-sidebar-brand p.app-sidebar-title')).toBeTruthy();
  });

  it('fail_closed getProperty omits name and chip; wordmark remains', async () => {
    tzForTest.current = null;
    getMe.mockResolvedValue(liveOwner);
    getProperty.mockRejectedValue(
      new ClassifiedError({
        class: 'fail_closed',
        status: 503,
        body: { degraded: 'FAIL_CLOSED' },
        retryAfterMs: null,
      }),
    );
    renderShell();

    await waitFor(() =>
      expect(document.querySelector('.app-sidebar-brand p.app-sidebar-title')).toBeTruthy(),
    );
    expect(screen.queryByTestId('property-name')).toBeNull();
    expect(screen.queryByTestId('business-date-chip')).toBeNull();
  });
});
