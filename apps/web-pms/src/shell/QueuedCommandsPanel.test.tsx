import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const entriesRef = {
  current: [] as Array<{ commandId: string; idempotencyKey: string; issuedAt: string }>,
};

vi.mock('../client.js', () => ({
  queuedCommands: { entries: () => entriesRef.current },
}));

import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';

function resolveRefetchInterval(
  client: QueryClient,
): number | false | undefined {
  const obs = client.getQueryCache().find({ queryKey: ['queued-commands'] });
  const configured = (obs?.options as { refetchInterval?: number | false | ((query: Query) => number | false) })
    .refetchInterval;
  if (typeof configured === 'function') {
    return configured(obs as Query);
  }
  return configured;
}

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
      expect(resolveRefetchInterval(client)).toBeFalsy();
    });
  });

  it('T-P10b: non-empty queue uses refetchInterval 1000', async () => {
    entriesRef.current = [
      { commandId: 'folio.add_line', idempotencyKey: 'k1', issuedAt: '2026-08-14T12:00:00.000Z' },
    ];
    const { client } = renderPanel();
    await waitFor(() => {
      expect(resolveRefetchInterval(client)).toBe(1000);
    });
  });
});
