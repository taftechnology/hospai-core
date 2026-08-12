import type { DomainEventMessage, EventSource } from '@hospai/contracts';

export const SEQ_PAD_WIDTH = 20;

export function padSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) throw new Error(`invalid seq: ${seq}`);
  return String(seq).padStart(SEQ_PAD_WIDTH, '0');
}

export function eventLogPrefix(source: EventSource): string {
  return `events/${source.do}/${source.id}/`;
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
