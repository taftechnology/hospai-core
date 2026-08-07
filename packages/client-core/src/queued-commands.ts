export type QueuedCommandEntry = {
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  businessDate?: string;
};

export function createQueuedCommandLog(): {
  entries: () => readonly QueuedCommandEntry[];
  recordFromProvisionalBody: (body: unknown) => void;
} {
  const items: QueuedCommandEntry[] = [];
  return {
    entries: () => items,
    recordFromProvisionalBody: (body: unknown) => {
      if (body === null || typeof body !== 'object') return;
      const r = body as Record<string, unknown>;
      const commandId = typeof r.commandId === 'string' ? r.commandId : null;
      const idempotencyKey = typeof r.idempotencyKey === 'string' ? r.idempotencyKey : null;
      const issuedAt = typeof r.issuedAt === 'string' ? r.issuedAt : null;
      if (!commandId || !idempotencyKey || !issuedAt) return;
      const entry: QueuedCommandEntry = { commandId, idempotencyKey, issuedAt };
      if (typeof r.businessDate === 'string') entry.businessDate = r.businessDate;
      items.push(entry);
    },
  };
}
