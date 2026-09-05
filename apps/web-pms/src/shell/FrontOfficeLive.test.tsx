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

async function waitForOpenHandler(socket: FakeSocket) {
  await waitFor(() => {
    expect(socket.onopen).toEqual(expect.any(Function));
  });
}

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
    const { client } = renderLive({ createSocket: () => socket });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
    const tapeKey = ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate] as const;
    expect(client.getQueryData(tapeKey)).toMatchObject({ rooms: snapshot.rooms });
    socket.close();
    await waitFor(() => expect(screen.getByTestId('stale-watermark')).toBeTruthy());
    expect(client.getQueryData(tapeKey)).toMatchObject({ rooms: snapshot.rooms });
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
    await waitFor(() => expect(sockets[0]).toBeTruthy());
    await waitForOpenHandler(sockets[0]!);
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: JSON.stringify(snapshot) });
    sockets[0]!.close();
    await waitFor(() => expect(screen.getByTestId('stale-watermark')).toBeTruthy());
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1));
    await waitForOpenHandler(sockets[1]!);
    sockets[1]!.onopen?.();
    sockets[1]!.onmessage?.({ data: JSON.stringify({ ...snapshot, asOf: 1_700_000_000_100 }) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
  });

  it('hibernated-open with no messages is not stale', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const socket = createFakeSocket();
    renderLive({ createSocket: () => socket });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(screen.queryByTestId('stale-watermark')).toBeNull());
    await vi.advanceTimersByTimeAsync(35_000);
    expect(screen.queryByTestId('stale-watermark')).toBeNull();
  });

  it('snapshot and delta invalidate board only; snapshot uses full tape key', async () => {
    const socket = createFakeSocket();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setDataSpy = vi.spyOn(client, 'setQueryData');
    renderLive({ createSocket: () => socket, client });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify(snapshot) });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(setDataSpy).toHaveBeenCalledWith(
      ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate],
      expect.objectContaining({ ok: true, rooms: snapshot.rooms }),
    );
    const snapKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(snapKeys).toContainEqual(['board']);
    expect(snapKeys).not.toContainEqual(['front-desk-tape']);
    expect(snapKeys).not.toContainEqual(['front-desk-summary']);
    expect(snapKeys).not.toContainEqual(['front-desk-directory']);
    expect(snapKeys).not.toContainEqual(['front-desk-available']);
    invalidateSpy.mockClear();

    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 2, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const deltaKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(deltaKeys).toEqual([['board']]);
  });

  it('delta merges removedBlockIds into cached tape without tape invalidation', async () => {
    const socket = createFakeSocket();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tapeKey = ['front-desk-tape', 'prop_demo', snapshot.fromDate, snapshot.toDate] as const;
    client.setQueryData(tapeKey, {
      ok: true,
      fromDate: snapshot.fromDate,
      toDate: snapshot.toDate,
      asOf: 1,
      rooms: snapshot.rooms,
      blocks: [
        { reservationId: 'res_x', guestRef: 'g_x', status: 'checked_in', roomId: 'rm_101' },
        { reservationId: 'res_y', guestRef: 'g_y', status: 'confirmed', roomId: 'rm_101' },
      ],
      ooo: [],
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderLive({ createSocket: () => socket, client });
    await waitForOpenHandler(socket);
    socket.onopen?.();
    invalidateSpy.mockClear();
    socket.onmessage?.({
      data: JSON.stringify({ type: 'delta', asOf: 3, removedBlockIds: ['res_x'] }),
    });
    await waitFor(() => {
      const cached = client.getQueryData(tapeKey) as { blocks: Array<{ reservationId: string }> };
      expect(cached.blocks.map((b) => b.reservationId)).toEqual(['res_y']);
    });
    const deltaKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown })?.queryKey);
    expect(deltaKeys).toEqual([['board']]);
    expect(deltaKeys).not.toContainEqual(['front-desk-tape']);
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
    await waitForOpenHandler(socket);
    socket.onopen?.();
    await waitFor(() => expect(socket.sent.length).toBeGreaterThan(0));
    const msg = JSON.parse(socket.sent[0]!) as { fromDate: string; toDate: string };
    const today = propertyLocalToday('UTC');
    expect(msg.fromDate).toBe(today);
    expect(msg.toDate).toBe(addCalendarDays(today, 6));
  });
});
