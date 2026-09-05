import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  api: {
    updateFrontOffice: vi.fn(),
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

describe('FrontOfficeEditor', () => {
  afterEach(() => cleanup());

  it('T29: VIP and DND flags render Badge components when enabled', () => {
    renderEditor({ vipFlag: true, dndFlag: true });
    expect(screen.getByTestId('vip-badge')).toBeTruthy();
    expect(screen.getByTestId('dnd-badge')).toBeTruthy();
  });
});
