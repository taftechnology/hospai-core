import type { QueuedCommandEntry } from '@hospai/client-core';

export function queuedCommandLine(entry: QueuedCommandEntry): string {
  const date = entry.businessDate ?? entry.issuedAt.slice(0, 10);
  return `Queued action · ${date}`;
}
