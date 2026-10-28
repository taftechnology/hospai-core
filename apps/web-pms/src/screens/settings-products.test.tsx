import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listProducts = vi.fn();
const createProductCategory = vi.fn();
const updateProductCategory = vi.fn();
const createProduct = vi.fn();
const updateProduct = vi.fn();
const listChargeCodes = vi.fn();
const listDomainConfig = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    listProducts: (...a: unknown[]) => listProducts(...a),
    createProductCategory: (...a: unknown[]) => createProductCategory(...a),
    updateProductCategory: (...a: unknown[]) => updateProductCategory(...a),
    createProduct: (...a: unknown[]) => createProduct(...a),
    updateProduct: (...a: unknown[]) => updateProduct(...a),
    listChargeCodes: (...a: unknown[]) => listChargeCodes(...a),
    listDomainConfig: (...a: unknown[]) => listDomainConfig(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
  asClassified: (err: unknown) => {
    if (err instanceof ClassifiedError) return err.classified;
    return { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null };
  },
}));

import { SettingsScreen } from './SettingsScreen.js';

const catalog = {
  ok: true,
  categories: [
    { categoryId: 'cat_minibar', name: 'Minibar', sortOrder: 0, status: 'active' },
    { categoryId: 'cat_old', name: 'Old', sortOrder: 1, status: 'archived' },
  ],
  items: [
    {
      productId: 'prod_water',
      categoryId: 'cat_minibar',
      sku: 'MB-WATER',
      name: 'Water 500ml',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 4000,
      status: 'active',
      taxGroup: 'GOODS',
      postable: true,
    },
    {
      productId: 'prod_stale',
      categoryId: 'cat_minibar',
      sku: null,
      name: 'Stale code',
      chargeCode: 'RETIRED',
      defaultAmountMinor: 100,
      status: 'active',
      taxGroup: null,
      postable: false,
    },
  ],
};

function renderProducts() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/products']}>
        <Routes>
          <Route path="/settings/products" element={<SettingsScreen tab="products" />} />
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

describe('Settings → Products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProducts.mockResolvedValue(catalog);
    listChargeCodes.mockResolvedValue({
      ok: true,
      codes: [
        { code: 'ROOM', name: 'Room', status: 'active' },
        { code: 'TAX', name: 'Tax', status: 'active' },
        { code: 'MINIBAR', name: 'Minibar', status: 'active' },
        { code: 'MISC', name: 'Misc', status: 'active' },
        { code: 'RETIRED', name: 'Retired', status: 'archived' },
      ],
    });
    listDomainConfig.mockResolvedValue({ ok: true, items: [] });
    getProperty.mockResolvedValue({ property: { propertyId: 'prop_demo', name: 'Hotel', timeZone: 'UTC' } });
    const ok = { classified: { class: 'live' }, body: { ok: true } };
    createProductCategory.mockResolvedValue(ok);
    updateProductCategory.mockResolvedValue(ok);
    createProduct.mockResolvedValue(ok);
    updateProduct.mockResolvedValue(ok);
  });

  afterEach(() => cleanup());

  it('has a Products tab and lists categories and items with the charge code tax group', async () => {
    renderProducts();
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(screen.getByText('Water 500ml')).toBeInTheDocument());
    expect(listProducts).toHaveBeenCalledWith('prop_demo', { status: 'all' });
    const water = rowFor('Water 500ml');
    expect(within(water).getByText('GOODS')).toBeInTheDocument();
    expect(within(water).getByText('40.00')).toBeInTheDocument();
    expect(within(rowFor('Stale code')).getByText('not postable')).toBeInTheDocument();
    expect(within(rowFor('Old')).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('adds a category and invalidates the products prefix', async () => {
    const { invalidateSpy } = renderProducts();
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    fireEvent.change(within(dialog).getByLabelText('Category name'), { target: { value: ' Laundry ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createProductCategory).toHaveBeenCalledTimes(1));
    const [pid, input] = createProductCategory.mock.calls[0]!;
    expect(pid).toBe('prop_demo');
    expect(input).toMatchObject({ name: 'Laundry' });
    expect((input as { categoryId: string }).categoryId).toMatch(/^cat_[A-Za-z0-9]+$/);
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products', 'prop_demo'] }));
  });

  it('adds a product in minor units and offers only operator-postable codes', async () => {
    renderProducts();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add product' });
    const code = within(dialog).getByLabelText('Charge code');
    const offered = within(code)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(offered).toEqual(['MINIBAR', 'MISC']);
    expect((code as HTMLSelectElement).value).toBe('MISC');
    const save = within(dialog).getByRole('button', { name: 'Save' });
    fireEvent.change(within(dialog).getByLabelText('Product name'), { target: { value: 'Juice' } });
    fireEvent.change(code, { target: { value: 'MINIBAR' } });
    fireEvent.change(within(dialog).getByLabelText('Default price'), { target: { value: '1.234' } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Default price'), { target: { value: '12.50' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
    expect(createProduct.mock.calls[0]![1]).toMatchObject({
      name: 'Juice',
      categoryId: 'cat_minibar',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 1250,
      sku: null,
    });
  });

  it('edits a product with its current values', async () => {
    renderProducts();
    await waitFor(() => expect(screen.getByText('Water 500ml')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Water 500ml')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit product' });
    expect(within(dialog).getByLabelText('Default price')).toHaveValue('40.00');
    fireEvent.change(within(dialog).getByLabelText('Default price'), { target: { value: '45' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1));
    expect(updateProduct.mock.calls[0]!.slice(1)).toEqual([
      'prod_water',
      expect.objectContaining({ defaultAmountMinor: 4500, sku: 'MB-WATER' }),
    ]);
  });

  it('archives a product only after a destructive confirm', async () => {
    renderProducts();
    await waitFor(() => expect(screen.getByText('Water 500ml')).toBeInTheDocument());
    fireEvent.click(within(rowFor('Water 500ml')).getByRole('button', { name: 'Archive' }));
    expect(updateProduct).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'));
    await waitFor(() =>
      expect(updateProduct).toHaveBeenCalledWith('prop_demo', 'prod_water', { status: 'archived' }),
    );
  });

  it('shows a server conflict inside the dialog with operator copy', async () => {
    createProductCategory.mockRejectedValue(
      new ClassifiedError({
        class: 'conflict',
        status: 409,
        body: { ok: false, error: 'category_exists' },
        retryAfterMs: null,
      } as never),
    );
    renderProducts();
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    fireEvent.change(within(dialog).getByLabelText('Category name'), { target: { value: 'Bar' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A category with that id already exists.',
    );
  });

  it('empty catalog says to add a category first and disables Add product', async () => {
    listProducts.mockResolvedValue({ ok: true, categories: [], items: [] });
    renderProducts();
    expect(await screen.findByText('No categories yet')).toBeInTheDocument();
    expect(screen.getByText('Add a category first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add product' })).toBeDisabled();
  });

  it('a failed list read is an Alert, not an empty catalog', async () => {
    listProducts.mockRejectedValue(
      new ClassifiedError({ class: 'fail_closed', status: 503, body: {}, retryAfterMs: null }),
    );
    renderProducts();
    expect(await screen.findByTestId('products-error')).toHaveTextContent('Property unreachable.');
    expect(screen.queryByText('No categories yet')).toBeNull();
  });
});
