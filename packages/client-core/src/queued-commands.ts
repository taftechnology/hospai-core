export type QueuedCommandEntry = {
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  businessDate?: string;
  reservationId?: string;
};

export function createQueuedCommandLog(): {
  entries: () => readonly QueuedCommandEntry[];
  recordFromProvisionalBody: (
    body: unknown,
    context?: { reservationId?: string },
  ) => void;
} {
  const items: QueuedCommandEntry[] = [];
  return {
    entries: () => items,
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
