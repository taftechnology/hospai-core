import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listPackages = vi.fn();
const createPackage = vi.fn();
const updatePackage = vi.fn();
const setPackageStatus = vi.fn();
const listRoomTypes = vi.fn();
const listRatePlans = vi.fn();
const listProducts = vi.fn();
const listDomainConfig = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listPackages: (...a: unknown[]) => listPackages(...a),
    createPackage: (...a: unknown[]) => createPackage(...a),
    updatePackage: (...a: unknown[]) => updatePackage(...a),
    setPackageStatus: (...a: unknown[]) => setPackageStatus(...a),
    listRoomTypes: (...a: unknown[]) => listRoomTypes(...a),
    listRatePlans: (...a: unknown[]) => listRatePlans(...a),
    listProducts: (...a: unknown[]) => listProducts(...a),
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
    getMe: (...a: unknown[]) => getMe(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

const catalog = {
  ok: true,
  packages: [
    {
      packageId: 'pkg_bb',
      code: 'BB2',
      name: 'Bed & Breakfast',
      roomTypeId: 'rt_king',
      ratePlanId: 'BAR',
      nights: 2,
      priceMinor: 10_000,
      currency: 'INR',
      componentTax: 'SEPARATE' as const,
      status: 'active' as const,
      components: [
        {
          componentNo: 1,
          productId: 'prod_breakfast',
          amountMinor: 500,
          schedule: 'EVERY_NIGHT' as const,
          setNight: null,
        },
      ],
    },
  ],
};

function renderPackages() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/packages']}>
        <Routes>
          <Route path="/settings/packages" element={<SettingsScreen tab="packages" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('Settings → Packages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPackages.mockResolvedValue(catalog);
    listRoomTypes.mockResolvedValue({
      ok: true,
      roomTypes: [
        {
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          roomCount: 4,
          maxOccupancy: 2,
          maxAdults: 2,
          status: 'active',
        },
      ],
    });
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        {
          ratePlanId: 'BAR',
          code: 'BAR',
          name: 'Best Available',
          status: 'active',
          cancelPenaltyType: 'none',
          cancelGraceHours: 0,
          cancelPenaltyNights: null,
          cancelPenaltyBps: null,
          cancelPolicyText: null,
          parentRatePlanId: null,
          deriveBps: null,
          inclusions: [],
          inclusionTax: 'SEPARATE',
          inclusionBandJoin: false,
        },
      ],
    });
    listProducts.mockResolvedValue({
      ok: true,
      categories: [{ categoryId: 'cat_fb', name: 'Food', sortOrder: 0, status: 'active' }],
      items: [
        {
          productId: 'prod_breakfast',
          categoryId: 'cat_fb',
          sku: null,
          name: 'Breakfast',
          chargeCode: 'FB',
          defaultAmountMinor: 500,
          status: 'active',
          taxGroup: 'FOOD',
          postable: true,
        },
      ],
    });
    listDomainConfig.mockResolvedValue({ ok: true, items: [] });
    getProperty.mockResolvedValue({
      property: { propertyId: 'prop_demo', name: 'Hotel', timeZone: 'UTC' },
    });
    getMe.mockResolvedValue({
      ok: true,
      orgId: 'org_demo',
      propertyId: 'prop_demo',
      userId: 'user_x',
      role: 'admin',
      permissions: ['settings:configure', 'rates:write'],
      orgPermissions: [],
    });
    const ok = { classified: { class: 'live' }, body: { ok: true } };
    createPackage.mockResolvedValue(ok);
    updatePackage.mockResolvedValue(ok);
    setPackageStatus.mockResolvedValue(ok);
  });

  afterEach(() => cleanup());

  it('lists packages and shows the Packages tab', async () => {
    renderPackages();
    expect(await screen.findByRole('link', { name: 'Packages' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(screen.getByText('Bed & Breakfast')).toBeInTheDocument());
    expect(listPackages).toHaveBeenCalledWith('prop_demo', { status: 'all' });
  });

  it('shows live room portion and negative Alert; create invalidates packages key', async () => {
    const { invalidateSpy } = renderPackages();
    fireEvent.click(await screen.findByRole('button', { name: 'Add package' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add package' });
    fireEvent.change(within(dialog).getByLabelText('Package code'), {
      target: { value: 'SPA' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package name'), {
      target: { value: 'Spa stay' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package room type'), {
      target: { value: 'rt_king' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package rate plan'), {
      target: { value: 'BAR' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package nights'), {
      target: { value: '2' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package price'), {
      target: { value: '50.00' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add component' }));
    fireEvent.change(within(dialog).getByLabelText('Component 1 product'), {
      target: { value: 'prod_breakfast' },
    });
    fireEvent.change(within(dialog).getByLabelText('Component 1 amount'), {
      target: { value: '40.00' },
    });
    expect(screen.getByRole('option', { name: 'Every night' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Arrival night' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Set night' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Last night' })).toBeTruthy();
    expect((screen.getByRole('option', { name: 'Every night' }) as HTMLOptionElement).value).toBe(
      'EVERY_NIGHT',
    );
    await waitFor(() =>
      expect(screen.getByTestId('package-room-portion').textContent).toMatch(/Room portion/),
    );
    // 5000 − 2×4000 = −3000
    expect(screen.getByTestId('package-room-portion-alert')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Component 1 schedule'), {
      target: { value: 'SET_NIGHT' },
    });
    expect(screen.getByLabelText(/Night \(1–N\)/i)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Component 1 schedule'), {
      target: { value: 'EVERY_NIGHT' },
    });
    fireEvent.change(within(dialog).getByLabelText('Package price'), {
      target: { value: '100.00' },
    });
    await waitFor(() => expect(screen.queryByTestId('package-room-portion-alert')).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createPackage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages', 'prop_demo'] }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('packages-success')).toHaveTextContent('Package saved.'),
    );
    expect(screen.getByTestId('packages-success').className).toMatch(/ui-alert/);
  });

  it('archives via status and invalidates packages key', async () => {
    const { invalidateSpy } = renderPackages();
    await waitFor(() => expect(screen.getByText('Bed & Breakfast')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(setPackageStatus).toHaveBeenCalledTimes(1));
    expect(setPackageStatus.mock.calls[0]![0]).toBe('prop_demo');
    expect(setPackageStatus.mock.calls[0]![1]).toBe('pkg_bb');
    expect(setPackageStatus.mock.calls[0]![2]).toBe('archived');
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages', 'prop_demo'] }),
    );
  });
});
