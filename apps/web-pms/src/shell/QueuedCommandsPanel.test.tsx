import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const entriesRef = {
  current: [] as Array<{ commandId: string; idempotencyKey: string; issuedAt: string }>,
};

vi.mock('../client.js', () => ({
  queuedCommands: { entries: () => entriesRef.current },
}));

import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueuedCommandsPanel />
    </QueryClientProvider>,
  );
  return { client };
}

describe('QueuedCommandsPanel poll gate (P10)', () => {
  afterEach(() => {
    entriesRef.current = [];
    cleanup();
  });

  it('T-P10a: empty queue uses refetchInterval false', async () => {
    entriesRef.current = [];
    const { client } = renderPanel();
    await waitFor(() => {
      const obs = client.getQueryCache().find({ queryKey: ['queued-commands'] });
      expect(obs?.options.refetchInterval).toBeFalsy();
    });
  });
});
