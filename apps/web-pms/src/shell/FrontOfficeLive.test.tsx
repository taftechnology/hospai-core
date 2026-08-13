import { addCalendarDays } from '@hospai/client-core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Authority } from '../auth/me.js';
import { propertyLocalToday } from '../status/property-local-today.js';

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
}));

const tzState: { current: string | null } = { current: 'UTC' };
vi.mock('./PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => tzState.current,
}));

import { FrontOfficeLive, nextReconnectMs } from './FrontOfficeLive.js';

const OPEN = 1;
const CLOSED = 3;

type FakeSocket = {
  readyState: number;
  sent: string[];
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: OPEN,
    sent: [],
    send(data: string) {
      socket.sent.push(data);
    },
    close() {
      socket.readyState = CLOSED;
      socket.onclose?.({});
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return socket;
}

const liveAuth: Authority = {
  kind: 'live',
  me: {
    ok: true,
    orgId: 'org_demo',
    propertyId: 'prop_demo',
    userId: 'user_x',
    role: 'staff',
    permissions: ['reservations:read', 'folio:read'],
    orgPermissions: ['org:read'],
  },
};

const snapshot = {
  type: 'snapshot' as const,
  asOf: 1_700_000_000_000,
  fromDate: '2026-08-13',
  toDate: '2026-08-19',
  rooms: [{ roomId: 'rm_101', roomTypeId: 'rt', code: '101', status: 'clean', floor: '1' }],
  blocks: [],
  ooo: [],
};

function renderLive(opts: {
  authority?: Authority;
  createSocket: (url: string, protocols?: string | string[]) => FakeSocket;
  path?: string;
  client?: QueryClient;
}) {
  const client =
    opts.client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[opts.path ?? '/board']}>
          <FrontOfficeLive authority={opts.authority ?? liveAuth} createSocket={opts.createSocket} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('FrontOfficeLive', () => {
  beforeEach(() => {
    tzState.current = 'UTC';
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('nextReconnectMs caps at 10s', () => {
    expect(nextReconnectMs(0)).toBeGreaterThan(0);
    expect(nextReconnectMs(20)).toBe(10_000);
    expect(nextReconnectMs(20)).toBeLessThanOrEqual(10_000);
  });

  it('snapshot then close shows watermark and keeps tape cache', async () => {
    const socket = createFakeSocket();
    const { client } = renderLive({
      createSocket: () => socket,
    });
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
    expect(client.getQueryData(['front-desk-tape'])).toMatchObject({ rooms: snapshot.rooms });
    socket.close();
    await waitFor(() => expect(screen.getByTestId('stale-watermark')).toBeTruthy());
    expect(client.getQueryData(['front-desk-tape'])).toMatchObject({ rooms: snapshot.rooms });
  });

  it('snapshot after reconnect hides watermark', async () => {
    const sockets: FakeSocket[] = [];
    renderLive({
      createSocket: () => {
        const s = createFakeSocket();
        sockets.push(s);
        return s;
      },
    });
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: JSON.stringify(snapshot) });
    sockets[0]!.close();
    await waitFor(() => expect(screen.getByTestId('stale-watermark')).toBeTruthy());
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    sockets[1]!.onopen?.();
    sockets[1]!.onmessage?.({ data: JSON.stringify({ ...snapshot, asOf: 1_700_000_000_100 }) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
  });

  it('hibernated-open with no messages is not stale', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const socket = createFakeSocket();
    renderLive({ createSocket: () => socket });
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
    await vi.advanceTimersByTimeAsync(35_000);
    expect(screen.queryByTestId('stale-watermark')).toBeNull();
  });

  it('delta and snapshot invalidate front-office query keys', async () => {
    const socket = createFakeSocket();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderLive({ createSocket: () => socket, client });
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(keys).toContainEqual(['board']);
    expect(keys).toContainEqual(['front-desk-summary']);
    expect(keys).toContainEqual(['front-desk-directory']);
    expect(keys).toContainEqual(['front-desk-available']);
    expect(keys).toContainEqual(['front-desk-tape']);
    spy.mockClear();
    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 2, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const deltaKeys = spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(deltaKeys).toContainEqual(['board']);
    expect(deltaKeys).toContainEqual(['front-desk-tape']);
  });

  it('does not connect without live reservations:read', () => {
    const createSocket = vi.fn(() => createFakeSocket());
    renderLive({
      authority: { kind: 'pending' },
      createSocket,
    });
    expect(createSocket).not.toHaveBeenCalled();
    cleanup();
    renderLive({
      authority: {
        kind: 'live',
        me: { ...liveAuth.me, permissions: ['folio:read'] },
      },
      createSocket,
    });
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('subscribe window covers today through today+6', async () => {
    const socket = createFakeSocket();
    renderLive({ createSocket: () => socket, path: '/in-house' });
    socket.onopen?.();
    await waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    const msg = JSON.parse(socket.sent[0]!) as { fromDate: string; toDate: string };
    const today = propertyLocalToday('UTC');
    expect(msg.fromDate).toBe(today);
    expect(msg.toDate).toBe(addCalendarDays(today, 6));
  });
});
