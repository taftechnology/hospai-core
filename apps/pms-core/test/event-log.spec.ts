import { describe, expect, it } from 'vitest';
import type { DomainEventMessage } from '@hospai/contracts';
import {
  eventLogObjectKey,
  eventLogPrefix,
  groupMessagesBySource,
  padSeq,
  parseSegment,
  serializeSegment,
  SEQ_PAD_WIDTH,
} from '../src/event-log.js';

function msg(
  partial: Pick<DomainEventMessage, 'eventId' | 'seq' | 'source'> & { eventType?: string },
): DomainEventMessage {
  return {
    eventType: partial.eventType ?? 'config.changed',
    payload: { key: 'k', version: 1 },
    createdAt: 1,
    ...partial,
  };
}

describe('event-log keys', () => {
  it('pads seq to 20 digits (SQLite INTEGER / uint64)', () => {
    expect(SEQ_PAD_WIDTH).toBe(20);
    expect(padSeq(1)).toBe('00000000000000000001');
    expect(padSeq(49)).toBe('00000000000000000049');
    expect(padSeq(50)).toBe('00000000000000000050');
  });

  it('prefix is events/{do}/{id}/', () => {
    expect(eventLogPrefix({ do: 'property', id: 'prop_a' })).toBe('events/property/prop_a/');
    expect(eventLogPrefix({ do: 'org', id: 'org_a' })).toBe('events/org/org_a/');
  });

  it('lex order recovers seq order for out-of-order writes (spec §3.2 example)', () => {
    const src = { do: 'property' as const, id: 'p' };
    const nonce = 'n';
    const written = [
      eventLogObjectKey(src, 50, 100, nonce),
      eventLogObjectKey(src, 1, 49, nonce),
      eventLogObjectKey(src, 10, 20, nonce),
    ];
    const lex = [...written].sort();
    expect(lex).toEqual([
      eventLogObjectKey(src, 1, 49, nonce),
      eventLogObjectKey(src, 10, 20, nonce),
      eventLogObjectKey(src, 50, 100, nonce),
    ]);
  });
});

describe('groupMessagesBySource', () => {
  it('groups mixed batch by source and sorts each group by seq', () => {
    const a = { do: 'property' as const, id: 'p1' };
    const b = { do: 'org' as const, id: 'o1' };
    const grouped = groupMessagesBySource([
      msg({ eventId: 'e3', seq: 3, source: a }),
      msg({ eventId: 'e1', seq: 1, source: b }),
      msg({ eventId: 'e2', seq: 2, source: a }),
    ]);
    expect([...grouped.keys()]).toEqual(['property:p1', 'org:o1']);
    expect(grouped.get('property:p1')!.map((m) => m.seq)).toEqual([2, 3]);
    expect(grouped.get('org:o1')!.map((m) => m.seq)).toEqual([1]);
  });
});

describe('NDJSON round-trip', () => {
  it('preserves full DomainEventMessage', () => {
    const events = [
      msg({ eventId: 'a', seq: 1, source: { do: 'property', id: 'p' } }),
      msg({ eventId: 'b', seq: 2, source: { do: 'property', id: 'p' } }),
    ];
    expect(parseSegment(serializeSegment(events))).toEqual(events);
  });
});
