import { describe, expect, it } from 'vitest';
import { roomRulesInForce } from './tax-inclusion-note.js';

describe('roomRulesInForce', () => {
  const rules = [
    { name: 'CGST', validFrom: '2026-10-04', validTo: '2026-11-20' },
    { name: 'GST', validFrom: '2026-11-20', validTo: null },
  ];

  it('keeps only the versions in force on the day', () => {
    expect(roomRulesInForce(rules, '2026-11-19').map((r) => r.name)).toEqual(['CGST']);
    expect(roomRulesInForce(rules, '2026-11-20').map((r) => r.name)).toEqual(['GST']);
  });

  it('falls back to open versions before the date is known', () => {
    expect(roomRulesInForce(rules, null).map((r) => r.name)).toEqual(['GST']);
  });
});
