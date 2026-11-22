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

describe('getManagerReport', () => {
  it('asks the manager route, with the date only when one is given', async () => {
    const seen: string[] = [];
    const client = testClient(seen);
    await client.getManagerReport('p 1');
    await client.getManagerReport('p 1', '2026-11-19');
    expect(seen).toEqual([
      '/v1/properties/p%201/reports/manager',
      '/v1/properties/p%201/reports/manager?date=2026-11-19',
    ]);
  });
});

describe('postCopilotMessage', () => {
  it('posts the visible conversation and nothing else to the property copilot route', async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const transport: Transport = {
      fetch: async (input, init) => {
        calls.push({
          path: new URL(input, 'http://test').pathname,
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        });
        return new Response(
          JSON.stringify({ ok: true, answer: 'A', sources: [], suggestedActions: [], toolsUsed: [], overSoftLimit: false }),
          { status: 200 },
        );
      },
    };
    const client = createClient({
      transport,
      queued: createQueuedCommandLog(),
      entitlements: createEntitlementStore({
        loadSnapshot: async () => ({ orgId: 'o', version: 1, features: {}, limits: {}, computedAt: new Date(0).toISOString() }),
      }),
      keyStore: new Map(),
    });
    const out = await client.postCopilotMessage('p 1', [{ role: 'user', content: 'Who arrives today?' }]);
    expect(out.answer).toBe('A');
    expect(calls).toEqual([
      {
        path: '/v1/properties/p%201/copilot/messages',
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'Who arrives today?' }] },
      },
    ]);
  });
});

describe('getAccountingJournal', () => {
  it('asks the accounting route, with the bounds only when they are given', async () => {
    const seen: string[] = [];
    const client = testClient(seen);
    await client.getAccountingJournal('p 1');
    await client.getAccountingJournal('p 1', { from: '2026-11-01', to: '2026-11-07' });
    await client.getAccountingJournal('p 1', { from: '2026-11-01' });
    expect(seen).toEqual([
      '/v1/properties/p%201/accounting/journal',
      '/v1/properties/p%201/accounting/journal?from=2026-11-01&to=2026-11-07',
      '/v1/properties/p%201/accounting/journal?from=2026-11-01',
    ]);
  });
});
