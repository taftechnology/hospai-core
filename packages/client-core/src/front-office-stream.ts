export type FrontOfficeRoom = {
  roomId: string;
  roomTypeId: string;
  code: string;
  status: string;
  floor: string | null;
};

export type FrontOfficeOoo = {
  oooId: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

export type FrontOfficeSnapshot = {
  type: 'snapshot';
  asOf: number;
  fromDate: string;
  toDate: string;
  rooms: FrontOfficeRoom[];
  blocks: Array<Record<string, unknown>>;
  ooo: FrontOfficeOoo[];
};

export type FrontOfficeDelta = {
  type: 'delta';
  asOf: number;
  rooms?: FrontOfficeRoom[];
  blocks?: Array<Record<string, unknown>>;
  ooo?: FrontOfficeOoo[];
  removedBlockIds?: string[];
  removedOooIds?: string[];
};

export type FrontOfficePong = { type: 'pong'; asOf: number };
export type FrontOfficeError = { type: 'error'; error: string };

export type FrontOfficeStreamMessage =
  | FrontOfficeSnapshot
  | FrontOfficeDelta
  | FrontOfficePong
  | FrontOfficeError;

export function serializeSubscribe(fromDate: string, toDate: string): string {
  return JSON.stringify({ type: 'subscribe', fromDate, toDate });
}

export function frontOfficeStreamUrl(propertyId: string, fromDate?: string, toDate?: string): string {
  const path = `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/stream`;
  if (!fromDate || !toDate) return path;
  const qs = new URLSearchParams({ fromDate, toDate });
  return `${path}?${qs.toString()}`;
}

export function isFrontOfficeDelta(msg: FrontOfficeStreamMessage | null): msg is FrontOfficeDelta {
  return msg?.type === 'delta';
}

export function parseFrontOfficeStreamMessage(raw: string): FrontOfficeStreamMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const msg = parsed as { type?: unknown; asOf?: unknown; error?: unknown };
  if (msg.type === 'pong' && typeof msg.asOf === 'number') {
    return { type: 'pong', asOf: msg.asOf };
  }
  if (msg.type === 'error' && typeof msg.error === 'string') {
    return { type: 'error', error: msg.error };
  }
  if (msg.type === 'delta' && typeof msg.asOf === 'number') {
    return parsed as FrontOfficeDelta;
  }
  if (msg.type === 'snapshot' && typeof msg.asOf === 'number') {
    const snap = parsed as FrontOfficeSnapshot;
    if (!Array.isArray(snap.rooms) || !Array.isArray(snap.blocks) || !Array.isArray(snap.ooo)) return null;
    return snap;
  }
  return null;
}
