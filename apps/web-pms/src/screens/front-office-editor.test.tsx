import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateFrontOffice = vi.fn();
const listOperationalConfig = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    updateFrontOffice: (...args: unknown[]) => updateFrontOffice(...args),
    listOperationalConfig: (...args: unknown[]) => listOperationalConfig(...args),
  },
}));

import { FrontOfficeEditor } from './front-office-editor.js';

function renderEditor(props: Partial<Parameters<typeof FrontOfficeEditor>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FrontOfficeEditor
        reservationId="res_1"
        frontOfficeComment=""
        vipFlag={false}
        dndFlag={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const lists = {
  ok: true,
  items: [
    {
      key: 'pms.property.sources',
      value: [
        { code: 'WALKIN', name: 'Walk-in', status: 'active' },
        { code: 'OTA', name: 'Online', status: 'active' },
        { code: 'OLD', name: 'Old desk', status: 'archived' },
      ],
      version: 1,
      source: 'stored',
    },
    {
      key: 'pms.property.market_segments',
      value: [{ code: 'LEISURE', name: 'Leisure', status: 'active' }],
      version: 1,
      source: 'stored',
    },
  ],
};

describe('FrontOfficeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateFrontOffice.mockResolvedValue({ classified: { class: 'live' }, body: { ok: true } });
    listOperationalConfig.mockResolvedValue({ ok: true, items: [] });
  });

  afterEach(() => cleanup());

  it('T29: VIP and DND flags render Badge components when enabled', () => {
    renderEditor({ vipFlag: true, dndFlag: true });
    expect(screen.getByTestId('vip-badge')).toBeTruthy();
    expect(screen.getByTestId('dnd-badge')).toBeTruthy();
  });

  it('prefills source and segment, then a change and None send the new values', async () => {
    listOperationalConfig.mockResolvedValue(lists);
    renderEditor({ sourceCode: 'WALKIN', marketSegmentCode: 'LEISURE' });
    const source = (await screen.findByTestId('fo-source')) as HTMLSelectElement;
    const segment = screen.getByTestId('fo-segment') as HTMLSelectElement;
    expect(source.value).toBe('WALKIN');
    expect(segment.value).toBe('LEISURE');
    fireEvent.change(source, { target: { value: 'OTA' } });
    fireEvent.change(segment, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('front-office-save'));
    await waitFor(() => expect(updateFrontOffice).toHaveBeenCalled());
    expect(updateFrontOffice.mock.calls[0]![3]).toMatchObject({
      sourceCode: 'OTA',
      marketSegmentCode: null,
    });
  });

  it('shows an archived or unknown current code', async () => {
    listOperationalConfig.mockResolvedValue(lists);
    renderEditor({ sourceCode: 'OLD', marketSegmentCode: 'GONE' });
    const source = (await screen.findByTestId('fo-source')) as HTMLSelectElement;
    expect(source.value).toBe('OLD');
    expect(screen.getByRole('option', { name: 'OLD (archived)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'GONE (archived)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Old desk/ })).toBeNull();
  });

  it('hides the selects when the lists are empty and the stay has no codes', async () => {
    renderEditor();
    await waitFor(() => expect(listOperationalConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('fo-source')).toBeNull();
    expect(screen.queryByTestId('fo-segment')).toBeNull();
  });
});
