import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import {
  addCalendarDays,
  frontOfficeStreamUrl,
  parseFrontOfficeStreamMessage,
  serializeSubscribe,
  type FrontOfficeDelta,
  type FrontOfficeSnapshot,
} from '@hospai/client-core';
import { hasPropertyPermission, type Authority } from '../auth/me.js';
import { tenant } from '../client.js';
import { frontDeskTapeKey } from '../front-office-query-keys.js';
import { getClerkSessionToken } from '../providers/clerk-credentials.js';
import { propertyLocalToday } from '../status/property-local-today.js';
import { usePropertyTimeZone } from './PropertyFormat.js';
import { frontOfficeAuthProtocol } from './front-office-auth-protocol.js';
import { StaleWatermark } from './StaleWatermark.js';

export { frontOfficeAuthProtocol } from './front-office-auth-protocol.js';

export type FrontOfficeSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

export function nextReconnectMs(attempt: number): number {
  return Math.min(10_000, 250 * 2 ** Math.max(0, attempt));
}

type TapeCache = {
  ok: true;
  fromDate: string;
  toDate: string;
  asOf: number;
  rooms: FrontOfficeSnapshot['rooms'];
  blocks: Array<Record<string, unknown>>;
  ooo: FrontOfficeSnapshot['ooo'];
};

function mergeTapeDelta(existing: TapeCache, msg: FrontOfficeDelta): TapeCache {
  const removedBlocks = new Set(msg.removedBlockIds ?? []);
  const removedOoo = new Set(msg.removedOooIds ?? []);
  let blocks = existing.blocks.filter(
    (b) => !removedBlocks.has(String((b as { reservationId?: string }).reservationId ?? '')),
  );
  let rooms = existing.rooms.filter((r) => true);
  let ooo = existing.ooo.filter((o) => !removedOoo.has(o.oooId));

  const upsertById = <T extends { roomId?: string; oooId?: string; reservationId?: string }>(
    list: T[],
    incoming: T[],
    idKey: keyof T,
  ) => {
    const map = new Map(list.map((row) => [String(row[idKey]), row]));
    for (const row of incoming) map.set(String(row[idKey]), row);
    return [...map.values()];
  };

  if (msg.rooms?.length) rooms = upsertById(rooms, msg.rooms, 'roomId');
  if (msg.blocks?.length) {
    blocks = upsertById(
      blocks as Array<{ reservationId: string } & Record<string, unknown>>,
      msg.blocks as Array<{ reservationId: string } & Record<string, unknown>>,
      'reservationId',
    );
  }
  if (msg.ooo?.length) ooo = upsertById(ooo, msg.ooo, 'oooId');

  return { ...existing, asOf: msg.asOf, rooms, blocks, ooo };
}

function dateParam(raw: string | null): string | null {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function subscribeWindow(
  pathname: string,
  search: string,
  timeZone: string | null,
): { fromDate: string; toDate: string } {
  const today = propertyLocalToday(timeZone ?? 'UTC');
  let fromDate = today;
  let toDate = addCalendarDays(today, 6);
  const params = new URLSearchParams(search);
  if (pathname === '/board' || pathname.startsWith('/board/')) {
    const from = dateParam(params.get('from'));
    const to = dateParam(params.get('to'));
    if (from && to) {
      if (from < fromDate) fromDate = from;
      if (to > toDate) toDate = to;
    }
  }
  if (pathname === '/arrivals' || pathname === '/departures') {
    const date = dateParam(params.get('date'));
    if (date) {
      if (date < fromDate) fromDate = date;
      if (date > toDate) toDate = date;
    }
  }
  return { fromDate, toDate };
}

function productionCreateSocket(url: string, protocols?: string | string[]): FrontOfficeSocket | null {
  try {
    const ws =
      protocols !== undefined ? new WebSocket(url, protocols) : new WebSocket(url);
    return ws as unknown as FrontOfficeSocket;
  } catch {
    return null;
  }
}

export function FrontOfficeLive({
  authority,
  createSocket = productionCreateSocket,
}: {
  authority: Authority;
  createSocket?: (url: string, protocols?: string | string[]) => FrontOfficeSocket | null;
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const timeZone = usePropertyTimeZone();
  const [stale, setStale] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const enabled =
    authority.kind === 'live' && hasPropertyPermission(authority.me, 'reservations:read');
  const windowRef = useRef(subscribeWindow(location.pathname, location.search, timeZone));
  windowRef.current = subscribeWindow(location.pathname, location.search, timeZone);
  const socketRef = useRef<FrontOfficeSocket | null>(null);
  const seenSnapshot = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = (protocols: string | string[] | undefined) => {
      if (cancelled) return;
      const socket = createSocket(frontOfficeStreamUrl(tenant.propertyId), protocols);
      if (!socket) return;
      socketRef.current = socket;
      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        const { fromDate, toDate } = windowRef.current;
        socket.send(serializeSubscribe(fromDate, toDate));
      };
      socket.onmessage = (ev) => {
        if (cancelled) return;
        const data = typeof ev.data === 'string' ? ev.data : '';
        const msg = parseFrontOfficeStreamMessage(data);
        if (!msg || (msg.type !== 'snapshot' && msg.type !== 'delta')) return;
        seenSnapshot.current = true;
        setAsOf(msg.asOf);
        setStale(false);

        if (msg.type === 'snapshot') {
          const key = frontDeskTapeKey(tenant.propertyId, msg.fromDate, msg.toDate);
          queryClient.setQueryData(key, {
            ok: true,
            fromDate: msg.fromDate,
            toDate: msg.toDate,
            asOf: msg.asOf,
            rooms: msg.rooms,
            blocks: msg.blocks,
            ooo: msg.ooo,
          });
        } else {
          const { fromDate, toDate } = windowRef.current;
          const key = frontDeskTapeKey(tenant.propertyId, fromDate, toDate);
          const cached = queryClient.getQueryData<TapeCache>(key);
          if (cached) {
            queryClient.setQueryData(key, mergeTapeDelta(cached, msg));
          }
        }

        void queryClient.invalidateQueries({ queryKey: ['board'] });
      };
      socket.onclose = () => {
        if (cancelled) return;
        if (seenSnapshot.current) setStale(true);
        timer = setTimeout(() => {
          attempt += 1;
          connect();
        }, nextReconnectMs(attempt));
      };
      socket.onerror = () => {
        if (cancelled) return;
        if (seenSnapshot.current) setStale(true);
      };
    };

    const connect = () => {
      if (cancelled) return;
      if (import.meta.env.VITE_USE_DEV_ACTOR === '1') {
        open(
          frontOfficeAuthProtocol({
            useDevActor: true,
            devActor: import.meta.env.VITE_DEV_ACTOR || 'user_owner',
            clerkToken: null,
          }),
        );
        return;
      }
      void (async () => {
        const clerkToken = await getClerkSessionToken();
        if (cancelled) return;
        open(
          frontOfficeAuthProtocol({
            useDevActor: false,
            devActor: 'user_owner',
            clerkToken,
          }),
        );
      })();
    };

    connect();
    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
      const ws = socketRef.current;
      socketRef.current = null;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, createSocket, queryClient]);

  useEffect(() => {
    if (!enabled) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    const { fromDate, toDate } = windowRef.current;
    socket.send(serializeSubscribe(fromDate, toDate));
  }, [enabled, location.pathname, location.search, timeZone]);

  if (!enabled) return null;
  return <StaleWatermark asOf={asOf} stale={stale} />;
}
