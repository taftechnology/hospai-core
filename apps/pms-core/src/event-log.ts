import type { DomainEventMessage, EventSource } from '@hospai/contracts';

export const SEQ_PAD_WIDTH = 20;

export function padSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`invalid seq: ${seq}`);
  return String(seq).padStart(SEQ_PAD_WIDTH, '0');
}

export function eventLogPrefix(source: EventSource): string {
  return `events/${source.do}/${source.id}/`;
}

export function eventLogPrefixesForOrg(orgId: string, propertyIds: string[]): string[] {
  return [
    eventLogPrefix({ do: 'org', id: orgId }),
    ...propertyIds.map((id) => eventLogPrefix({ do: 'property', id })),
  ];
}

export function eventLogObjectKey(
  source: EventSource,
  seqStart: number,
  seqEnd: number,
  nonce: string,
): string {
  return `${eventLogPrefix(source)}${padSeq(seqStart)}-${padSeq(seqEnd)}-${nonce}.ndjson`;
}

export function sourceGroupKey(source: EventSource): string {
  return `${source.do}:${source.id}`;
}

export function groupMessagesBySource(
  messages: DomainEventMessage[],
): Map<string, DomainEventMessage[]> {
  const groups = new Map<string, DomainEventMessage[]>();
  for (const m of messages) {
    const k = sourceGroupKey(m.source);
    const list = groups.get(k);
    if (list) list.push(m);
    else groups.set(k, [m]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.seq - b.seq);
  }
  return groups;
}

export function serializeSegment(events: DomainEventMessage[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
}

export function parseSegment(body: string): DomainEventMessage[] {
  const lines = body.split('\n').filter((l) => l.length > 0);
  return lines.map((l) => JSON.parse(l) as DomainEventMessage);
}

export function hasEventLogR2(env: { EVENT_LOG_R2?: R2Bucket }): boolean {
  return env.EVENT_LOG_R2 != null;
}

export async function putEventLogSegment(
  bucket: R2Bucket,
  events: DomainEventMessage[],
): Promise<string> {
  if (events.length === 0) throw new Error('empty event-log segment');
  const source = events[0]!.source;
  const seqStart = events[0]!.seq;
  const seqEnd = events[events.length - 1]!.seq;
  const key = eventLogObjectKey(source, seqStart, seqEnd, crypto.randomUUID());
  await bucket.put(key, serializeSegment(events));
  return key;
}

export async function archiveBySource(
  bucket: R2Bucket,
  messages: DomainEventMessage[],
): Promise<{ ok: DomainEventMessage[]; failed: DomainEventMessage[] }> {
  const ok: DomainEventMessage[] = [];
  const failed: DomainEventMessage[] = [];
  for (const group of groupMessagesBySource(messages).values()) {
    try {
      await putEventLogSegment(bucket, group);
      ok.push(...group);
    } catch {
      failed.push(...group);
    }
  }
  return { ok, failed };
}

export async function listEventLogKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const obj of page.objects) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function replayEventLog(
  bucket: R2Bucket,
  source: EventSource,
): Promise<DomainEventMessage[]> {
  const keys = (await listEventLogKeys(bucket, eventLogPrefix(source))).sort();
  const byId = new Map<string, DomainEventMessage>();
  for (const key of keys) {
    const obj = await bucket.get(key);
    if (!obj) continue;
    for (const event of parseSegment(await obj.text())) {
      byId.set(event.eventId, event);
    }
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export async function deleteEventLogPrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const keys = await listEventLogKeys(bucket, prefix);
    if (keys.length === 0) return deleted;
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await bucket.delete(chunk);
      deleted += chunk.length;
    }
  }
}

export async function assertEventLogPrefixEmpty(bucket: R2Bucket, prefix: string): Promise<void> {
  const keys = await listEventLogKeys(bucket, prefix);
  if (keys.length > 0) {
    const err = new Error('verify_r2_residue');
    err.name = 'verify_r2_residue';
    throw err;
  }
}

