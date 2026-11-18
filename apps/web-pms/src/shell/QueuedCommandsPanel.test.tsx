import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Entry = { commandId: string; idempotencyKey: string; issuedAt: string };

const listeners = new Set<() => void>();
const entriesRef: { current: readonly Entry[] } = { current: [] };

vi.mock('../client.js', () => ({
  queuedCommands: {
    entries: () => entriesRef.current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
}));

import { QueuedCommandsPanel } from './QueuedCommandsPanel.js';

function notify() {
  for (const listener of listeners) listener();
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QueuedCommandsPanel />
    </QueryClientProvider>,
  );
}

describe('QueuedCommandsPanel', () => {
  afterEach(() => {
    entriesRef.current = [];
    listeners.clear();
    cleanup();
  });

  it('stays hidden while the log is empty and does not poll', () => {
    renderPanel();
    expect(screen.queryByText('Queued commands')).toBeNull();
    expect(listeners.size).toBe(1);
  });

  it('shows the first queued command when the log notifies', async () => {
    renderPanel();
    expect(screen.queryByText('Queued commands')).toBeNull();
    entriesRef.current = [
      {
        commandId: 'folio.add_line',
        idempotencyKey: 'k1',
        issuedAt: '2026-08-14T12:00:00.000Z',
      },
    ];
    notify();
    expect(await screen.findByText('Queued commands')).toBeTruthy();
    expect(screen.getByText(/Folio charge/)).toBeTruthy();
  });
});
