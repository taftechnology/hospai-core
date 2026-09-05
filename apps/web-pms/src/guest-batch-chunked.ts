import type { GuestRowState } from '@hospai/client-core';

export const GUEST_BATCH_MAX = 50 as const;

type BatchResult =
  | { ok: true; states: Record<string, GuestRowState> }
  | { ok: false; wholesaleFailure: true; states: Record<string, GuestRowState> };

export function chunkGuestRefs(refs: string[]): string[][] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    deduped.push(ref);
  }
  if (deduped.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < deduped.length; i += GUEST_BATCH_MAX) {
    chunks.push(deduped.slice(i, i + GUEST_BATCH_MAX));
  }
  return chunks;
}

export async function fetchGuestStatesChunked(
  postGuestsBatch: (propertyId: string, refs: string[]) => Promise<BatchResult>,
  propertyId: string,
  refs: string[],
): Promise<{ states: Record<string, GuestRowState> }> {
  const chunks = chunkGuestRefs(refs);
  if (chunks.length === 0) return { states: {} };
  const merged: Record<string, GuestRowState> = {};
  for (const chunk of chunks) {
    const result = await postGuestsBatch(propertyId, chunk);
    if (!result.ok) throw new Error('guest_batch_failed');
    Object.assign(merged, result.states);
  }
  return { states: merged };
}
