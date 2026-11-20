import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

type Seen = { path: string; init?: RequestInit };

function testClient(seen: Seen[], body: unknown = { ok: true }) {
  const transport: Transport = {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      seen.push({ path: url.pathname + url.search, init });
      return new Response(JSON.stringify(body), { status: 200 });
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

const headerOf = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('housekeeping depth B client methods [R4.11]', () => {
  it('the reads send only the filters that are set', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.getInspectionTemplates('p');
    await client.getInspections('p', { from: '2026-11-01', result: 'fail', roomId: 'rm_1' });
    await client.getInspections('p');
    await client.getHousekeepingTaskStages('p', 'task_1');
    await client.getGuestAudits('p', { from: '2026-11-01', status: 'closed' });
    await client.getGuestAudit('p', 'gas_1');
    expect(seen.map((s) => s.path)).toEqual([
      '/v1/properties/p/housekeeping/inspection-templates',
      '/v1/properties/p/housekeeping/inspections?from=2026-11-01&roomId=rm_1&result=fail',
      '/v1/properties/p/housekeeping/inspections',
      '/v1/properties/p/housekeeping/tasks/task_1/stages',
      '/v1/properties/p/housekeeping/guest-audits?from=2026-11-01&status=closed',
      '/v1/properties/p/housekeeping/guest-audits/gas_1',
    ]);
  });

  it('the five writes carry the key in x-idempotency-key, never in the body', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.saveInspectionTemplate('p', { name: 'T', items: [] }, 'op-1');
    await client.recordInspection(
      'p',
      { businessDate: '2026-11-20', roomId: 'rm_1', templateId: 't', inspectorRef: 'staff_1', answers: [] },
      'op-2',
    );
    await client.startGuestAudit('p', { businessDate: '2026-11-20' }, 'op-3');
    await client.recordGuestAuditCount('p', 'gas_1', { lines: [{ roomId: 'rm_1', adults: 1, children: 0 }] }, 'op-4');
    await client.closeGuestAudit('p', 'gas_1', {}, 'op-5');
    expect(seen.map((s) => [s.init?.method, s.path])).toEqual([
      ['POST', '/v1/properties/p/housekeeping/inspection-templates'],
      ['POST', '/v1/properties/p/housekeeping/inspections'],
      ['POST', '/v1/properties/p/housekeeping/guest-audits'],
      ['POST', '/v1/properties/p/housekeeping/guest-audits/gas_1/counts'],
      ['POST', '/v1/properties/p/housekeeping/guest-audits/gas_1/close'],
    ]);
    for (const s of seen) {
      expect(headerOf(s.init, 'x-idempotency-key')).toBeTruthy();
      expect(String(s.init?.body)).not.toContain('idempotencyKey');
    }
    expect(new Set(seen.map((s) => headerOf(s.init, 'x-idempotency-key'))).size).toBe(5);
  });
});
