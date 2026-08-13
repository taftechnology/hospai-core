import { describe, expect, it } from 'vitest';
import {
  frontOfficeStreamUrl,
  isFrontOfficeDelta,
  parseFrontOfficeStreamMessage,
  serializeSubscribe,
} from '../src/front-office-stream.js';

describe('front-office stream protocol', () => {
  it('serializeSubscribe is JSON subscribe', () => {
    expect(JSON.parse(serializeSubscribe('2026-08-13', '2026-08-14'))).toEqual({
      type: 'subscribe',
      fromDate: '2026-08-13',
      toDate: '2026-08-14',
    });
  });

  it('frontOfficeStreamUrl omits query without dates and includes them when set', () => {
    expect(frontOfficeStreamUrl('prop_1')).toBe('/v1/properties/prop_1/front-desk/stream');
    expect(frontOfficeStreamUrl('prop_1', '2026-08-13', '2026-08-14')).toBe(
      '/v1/properties/prop_1/front-desk/stream?fromDate=2026-08-13&toDate=2026-08-14',
    );
  });

  it('parseFrontOfficeStreamMessage unknown JSON is null; snapshot has no displayName', () => {
    expect(parseFrontOfficeStreamMessage('not-json')).toBeNull();
    expect(parseFrontOfficeStreamMessage(JSON.stringify({ type: 'nope' }))).toBeNull();
    const snap = parseFrontOfficeStreamMessage(
      JSON.stringify({
        type: 'snapshot',
        asOf: 1,
        fromDate: '2026-08-13',
        toDate: '2026-08-14',
        rooms: [],
        blocks: [{ reservationId: 'res_1' }],
        ooo: [],
      }),
    );
    expect(snap?.type).toBe('snapshot');
    if (snap?.type === 'snapshot') {
      expect('displayName' in (snap.blocks[0] ?? {})).toBe(false);
    }
    const delta = parseFrontOfficeStreamMessage(JSON.stringify({ type: 'delta', asOf: 2, blocks: [] }));
    expect(isFrontOfficeDelta(delta)).toBe(true);
    expect(isFrontOfficeDelta(snap)).toBe(false);
  });
});
