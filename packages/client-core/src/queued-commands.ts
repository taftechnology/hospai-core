export type QueuedCommandEntry = {
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  businessDate?: string;
  reservationId?: string;
};

export function createQueuedCommandLog(): {
  entries: () => readonly QueuedCommandEntry[];
  subscribe: (listener: () => void) => () => void;
  /** Drop every entry (the active hotel changed, R4.4). */
  clear: () => void;
  recordFromProvisionalBody: (
    body: unknown,
    context?: { reservationId?: string },
  ) => void;
} {
  const items: QueuedCommandEntry[] = [];
  let snapshot: readonly QueuedCommandEntry[] = items;
  const listeners = new Set<() => void>();

  function emit() {
    snapshot = items.slice();
    for (const listener of listeners) listener();
  }

  return {
    entries: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => {
      items.length = 0;
      emit();
    },
    recordFromProvisionalBody: (body: unknown, context?: { reservationId?: string }) => {
      if (body === null || typeof body !== 'object') return;
      const r = body as Record<string, unknown>;
      const commandId = typeof r.commandId === 'string' ? r.commandId : null;
      const idempotencyKey = typeof r.idempotencyKey === 'string' ? r.idempotencyKey : null;
      const issuedAt = typeof r.issuedAt === 'string' ? r.issuedAt : null;
      if (!commandId || !idempotencyKey || !issuedAt) return;
      const entry: QueuedCommandEntry = { commandId, idempotencyKey, issuedAt };
      if (typeof r.businessDate === 'string') entry.businessDate = r.businessDate;
      if (typeof context?.reservationId === 'string' && context.reservationId.length > 0) {
        entry.reservationId = context.reservationId;
      }
      items.push(entry);
      emit();
    },
  };
}

export function partitionQueuedByReservation(
  entries: readonly QueuedCommandEntry[],
  reservationId: string,
): { forReservation: QueuedCommandEntry[]; other: QueuedCommandEntry[] } {
  const forReservation: QueuedCommandEntry[] = [];
  const other: QueuedCommandEntry[] = [];
  for (const e of entries) {
    if (e.reservationId === reservationId) forReservation.push(e);
    else other.push(e);
  }
  return { forReservation, other };
}
