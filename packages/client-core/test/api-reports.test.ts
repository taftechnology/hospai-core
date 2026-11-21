import { describe, expect, it } from 'vitest';
import { reportDefinition } from '@hospai/contracts';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

function testClient(seen: string[]) {
  const transport: Transport = {
    fetch: async (input) => {
      const url = new URL(input, 'http://test');
      seen.push(url.pathname + url.search);
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    },
  };
  return createClient({
    transport,
    queued: createQueuedCommandLog(),
    entitlements: createEntitlementStore({
      loadSnapshot: async () => ({
        orgId: 'o',
        version: 1,
        features: {},
        limits: {},
        computedAt: new Date(0).toISOString(),
      }),
    }),
    keyStore: new Map(),
  });
}

describe('getReport', () => {
  it('routes by the definition and sends only the params that are set', async () => {
    const seen: string[] = [];
    const client = testClient(seen);
    await client.getReport('p 1', reportDefinition('front_office_arrivals')!, {
      from: '2026-11-20',
      to: '2026-11-22',
      status: '',
    });
    await client.getReport('p 1', reportDefinition('front_office_in_house')!, { date: '2026-11-20' });
    expect(seen).toEqual([
      '/v1/properties/p%201/reports/front-office/front_office_arrivals?from=2026-11-20&to=2026-11-22',
      '/v1/properties/p%201/reports/front-office/front_office_in_house?date=2026-11-20',
    ]);
  });
});

describe('getReport: Part C routes', () => {
  it('sends night-audit reports to the audit group and housekeeping reports to theirs, with their filters', async () => {
    const seen: string[] = [];
    const client = testClient(seen);
    await client.getReport('p1', reportDefinition('night_audit_revenue')!, { date: '2026-11-19' });
    await client.getReport('p1', reportDefinition('housekeeping_room_status')!, {});
    await client.getReport('p1', reportDefinition('housekeeping_inspection_scores')!, {
      from: '2026-11-20',
      to: '2026-11-20',
      inspector: 'staff_1',
      room: 'rm_1',
    });
    expect(seen).toEqual([
      '/v1/properties/p1/reports/night-audit/night_audit_revenue?date=2026-11-19',
      '/v1/properties/p1/reports/housekeeping/housekeeping_room_status',
      '/v1/properties/p1/reports/housekeeping/housekeeping_inspection_scores?from=2026-11-20&to=2026-11-20&inspector=staff_1&room=rm_1',
    ]);
  });
});
