import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { DomainEventMessage } from '@hospai/contracts';
import {
  archiveBySource,
  assertEventLogPrefixEmpty,
  deleteEventLogPrefix,
  eventLogObjectKey,
  eventLogPrefix,
  groupMessagesBySource,
  hasEventLogR2,
  padSeq,
  parseSegment,
  putEventLogSegment,
  replayEventLog,
  serializeSegment,
  SEQ_PAD_WIDTH,
} from '../src/event-log.js';
import type { PmsEnv } from '../src/env.js';

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

describe('hasEventLogR2', () => {
  it('is true for vitest wrangler env and false when binding omitted', () => {
    expect(hasEventLogR2(env)).toBe(true);
    expect(hasEventLogR2({} as PmsEnv)).toBe(false);
  });
});

describe('R2 archive + replay', () => {
  it('put then replay round-trips and last-write-wins on duplicate eventId', async () => {
    const source = { do: 'property' as const, id: `prop_r2_${crypto.randomUUID().slice(0, 8)}` };
    const a = msg({ eventId: 'dup', seq: 1, source, eventType: 'config.changed' });
    const b = msg({ eventId: 'dup', seq: 10, source, eventType: 'config.changed' });
    b.payload = { key: 'second', version: 2 };
    await putEventLogSegment(env.EVENT_LOG_R2!, [a]);
    await putEventLogSegment(env.EVENT_LOG_R2!, [b]);
    const replayed = await replayEventLog(env.EVENT_LOG_R2!, source);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.payload).toEqual({ key: 'second', version: 2 });
  });

  it('archiveBySource isolates put failure to that source group', async () => {
    const p = { do: 'property' as const, id: `p_${crypto.randomUUID().slice(0, 8)}` };
    const o = { do: 'org' as const, id: `o_${crypto.randomUUID().slice(0, 8)}` };
    const orig = env.EVENT_LOG_R2!.put.bind(env.EVENT_LOG_R2!);
    const put = async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      opts?: R2PutOptions,
    ) => {
      if (String(key).includes('/org/')) throw new Error('org put failed');
      return orig(key, value, opts);
    };
    const bucket = new Proxy(env.EVENT_LOG_R2!, {
      get(target, prop, receiver) {
        if (prop === 'put') return put;
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = await archiveBySource(bucket, [
      msg({ eventId: 'ok', seq: 1, source: p }),
      msg({ eventId: 'bad', seq: 1, source: o }),
    ]);
    expect(result.ok.map((m) => m.eventId)).toEqual(['ok']);
    expect(result.failed.map((m) => m.eventId)).toEqual(['bad']);
  });

  it('bulk delete then list is empty (many keys, delete(keys[]) pages of 1000)', async () => {
    const source = { do: 'property' as const, id: `prop_bulk_${crypto.randomUUID().slice(0, 8)}` };
    const prefix = eventLogPrefix(source);
    const n = 1005;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        env.EVENT_LOG_R2!.put(`${prefix}obj-${String(i).padStart(5, '0')}`, 'x'),
      ),
    );
    const deleted = await deleteEventLogPrefix(env.EVENT_LOG_R2!, prefix);
    expect(deleted).toBe(n);
    await assertEventLogPrefixEmpty(env.EVENT_LOG_R2!, prefix);
  });

  it('assertEventLogPrefixEmpty throws when a key exists', async () => {
    const source = { do: 'property' as const, id: `prop_res_${crypto.randomUUID().slice(0, 8)}` };
    const prefix = eventLogPrefix(source);
    await env.EVENT_LOG_R2!.put(`${prefix}leftover`, 'x');
    await expect(assertEventLogPrefixEmpty(env.EVENT_LOG_R2!, prefix)).rejects.toThrow(
      'verify_r2_residue',
    );
  });
});
