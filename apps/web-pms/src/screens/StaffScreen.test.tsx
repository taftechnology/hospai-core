import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassifiedError } from '@hospai/client-core';

const getMe = vi.fn();
const listPropertyMembers = vi.fn();
const listOrgMembers = vi.fn();
const createPropertyMember = vi.fn();
const createOrgMember = vi.fn();
const updatePropertyMember = vi.fn();
const updateOrgMember = vi.fn();
const deletePropertyMember = vi.fn();
const deleteOrgMember = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    getMe: (...a: unknown[]) => getMe(...a),
    listPropertyMembers: (...a: unknown[]) => listPropertyMembers(...a),
    listOrgMembers: (...a: unknown[]) => listOrgMembers(...a),
    createPropertyMember: (...a: unknown[]) => createPropertyMember(...a),
    createOrgMember: (...a: unknown[]) => createOrgMember(...a),
    updatePropertyMember: (...a: unknown[]) => updatePropertyMember(...a),
    updateOrgMember: (...a: unknown[]) => updateOrgMember(...a),
    deletePropertyMember: (...a: unknown[]) => deletePropertyMember(...a),
    deleteOrgMember: (...a: unknown[]) => deleteOrgMember(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOpenShift: async () => ({ ok: true, shift: null }),
    getRecentShifts: async () => ({ ok: true, shifts: [] }),
    getProvisionalExceptionCount: async () => ({ propertyId: 'prop_demo', exceptionCount: 0 }),
    getProvisionalExceptions: async () => ({ items: [] }),
  },
  queuedCommands: { entries: () => [] },
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

vi.mock('../shell/PropertyTimeZone.js', () => ({
  PropertyTimeZoneProvider: ({ children }: { children: React.ReactNode }) => children,
  usePropertyTimeZone: () => 'UTC',
}));

import { AppShell } from '../shell/AppShell.js';
import { StaffScreen } from './StaffScreen.js';

const ownerMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_owner',
  role: 'owner' as const,
  permissions: [
    'reservations:read',
    'staff:read',
    'staff:write',
    'folio:post',
  ] as const,
  orgPermissions: ['org:read', 'org:manage'] as const,
};

const adminMe = {
  ok: true as const,
  orgId: 'org_demo',
  propertyId: 'prop_demo',
  userId: 'user_admin',
  role: 'admin' as const,
  permissions: ['reservations:read', 'staff:read', 'staff:write', 'folio:post'] as const,
  orgPermissions: ['org:read'] as const,
};

function renderStaff(me: typeof ownerMe | typeof adminMe = ownerMe) {
  getMe.mockResolvedValue(me);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <StaffScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('StaffScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', timeZone: 'UTC', name: 'Demo' },
    });
    listPropertyMembers.mockResolvedValue({
      ok: true,
      members: [
        {
          userId: 'user_owner',
          role: 'owner',
          createdAt: 1,
          updatedAt: null,
          displayName: 'Owner One',
          email: 'owner@example.com',
          hasOrgRole: true,
        },
        {
          userId: 'user_prop_only',
          role: 'staff',
          createdAt: 1,
          updatedAt: null,
          displayName: null,
          email: null,
          hasOrgRole: false,
        },
      ],
    });
    listOrgMembers.mockResolvedValue({
      ok: true,
      members: [
        {
          userId: 'user_owner',
          role: 'owner',
          createdAt: 1,
          updatedAt: null,
          displayName: 'Owner One',
          email: 'owner@example.com',
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('T5: subtitle uses live property name not hardcoded Meridian', async () => {
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Harbor Inn', timeZone: 'UTC' },
    });
    renderStaff();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Staff' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Harbor Inn/)).toBeTruthy());
    expect(screen.queryByText(/Meridian Seattle/)).toBeNull();
  });

  it('#9 admin: Org disabled with reason; property usable', async () => {
    renderStaff(adminMe);
    await waitFor(() => expect(screen.getByTestId('org-section-disabled')).toBeTruthy());
    expect(screen.getByText(/Requires/i)).toBeTruthy();
    expect(screen.queryByTestId('org-add-form')).toBeNull();
    expect(screen.queryByTestId('org-roster')).toBeNull();
    expect(listOrgMembers).not.toHaveBeenCalled();
    expect(screen.getByTestId('property-add-form')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('property-roster')).toBeTruthy());
  });

  it('#3 dangling row flagged when directory ok + null name/email', async () => {
    renderStaff(ownerMe);
    await waitFor(() => {
      expect(screen.getByTestId('dangling-user_prop_only').textContent).toMatch(
        /Account no longer exists/i,
      );
    });
  });

  it('#10 owner org DELETE confirm cascade; self-demote confirm', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    listOrgMembers.mockResolvedValue({
      ok: true,
      members: [
        {
          userId: 'user_other',
          role: 'admin',
          createdAt: 1,
          updatedAt: null,
          displayName: 'Other',
          email: 'o@example.com',
        },
        {
          userId: 'user_owner',
          role: 'owner',
          createdAt: 1,
          updatedAt: null,
          displayName: 'Owner One',
          email: 'owner@example.com',
        },
      ],
    });
    renderStaff(ownerMe);
    await waitFor(() => expect(screen.getByTestId('org-member-user_other')).toBeTruthy());

    fireEvent.click(screen.getByTestId('org-member-user_other').querySelector('button')!);
    expect(screen.getByText(/company and all property roles/i)).toBeTruthy();
    expect(deleteOrgMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    confirm.mockClear();
    fireEvent.change(screen.getByLabelText('Org role for user_owner'), {
      target: { value: 'admin' },
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/lose access to staff management/i),
    );
    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it('#11 self org-DELETE → harsh confirm → no-access shell', async () => {
    deleteOrgMember.mockResolvedValue({ ok: true, userId: 'user_owner' });

    let meCalls = 0;
    getMe.mockImplementation(async () => {
      meCalls += 1;
      if (meCalls === 1) return ownerMe;
      throw new ClassifiedError({
        class: 'client_error',
        status: 404,
        body: { error: 'not_found' },
        retryAfterMs: null,
      });
    });

    listPropertyMembers.mockResolvedValue({ ok: true, members: [] });
    listOrgMembers.mockResolvedValue({
      ok: true,
      members: [
        {
          userId: 'user_owner',
          role: 'owner',
          createdAt: 1,
          updatedAt: null,
          displayName: 'Owner One',
          email: 'owner@example.com',
        },
      ],
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/staff']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/staff" element={<StaffScreen />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('org-member-user_owner')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-member-user_owner').querySelector('button')!);
    expect(screen.getByText(/lose all access to this organization/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(deleteOrgMember).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('me-no-access')).toBeTruthy());
    expect(screen.queryByTestId('staff-screen')).toBeNull();
  });

  it('#12 no_such_user instructional; already_member focuses row by body userId', async () => {
    renderStaff(ownerMe);
    await waitFor(() => expect(screen.getByTestId('property-add-form')).toBeTruthy());

    createPropertyMember.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 422,
        body: { error: 'no_such_user' },
        retryAfterMs: null,
      }),
    );
    fireEvent.change(screen.getByLabelText('Property member email'), {
      target: { value: 'missing@example.com' },
    });
    fireEvent.submit(screen.getByTestId('property-add-form'));
    await waitFor(() => {
      expect(screen.getByTestId('staff-message').textContent).toMatch(/sign up/i);
    });

    createPropertyMember.mockRejectedValueOnce(
      new ClassifiedError({
        class: 'client_error',
        status: 409,
        body: { error: 'already_member', userId: 'user_prop_only', role: 'staff' },
        retryAfterMs: null,
      }),
    );
    fireEvent.change(screen.getByLabelText('Property member email'), {
      target: { value: 'dup@example.com' },
    });
    fireEvent.submit(screen.getByTestId('property-add-form'));
    await waitFor(() => {
      expect(screen.getByTestId('staff-message').textContent).toMatch(
        /Already a member \(staff\)/i,
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('property-member-user_prop_only').getAttribute('data-focused')).toBe(
        'true',
      ),
    );
  });

  it('#15 window focus does not refetch member lists', async () => {
    renderStaff(ownerMe);
    await waitFor(() => expect(listPropertyMembers).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listOrgMembers).toHaveBeenCalledTimes(1));

    fireEvent(window, new Event('focus'));
    fireEvent(window, new Event('visibilitychange'));

    // Give RQ a tick; must remain single fetch (refetchOnWindowFocus: false).
    await new Promise((r) => setTimeout(r, 50));
    expect(listPropertyMembers).toHaveBeenCalledTimes(1);
    expect(listOrgMembers).toHaveBeenCalledTimes(1);
  });
});
