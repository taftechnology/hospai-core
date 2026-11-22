import { describe, expect, it } from 'vitest';
import { createClient } from '../src/api.js';
import { createEntitlementStore } from '../src/entitlements-state.js';
import { createQueuedCommandLog } from '../src/queued-commands.js';
import type { Transport } from '../src/transport.js';

type Call = { path: string; method: string; body?: Record<string, unknown> };

function client() {
  const calls: Call[] = [];
  const transport: Transport = {
    fetch: async (input, init) => {
      const url = new URL(input, 'http://test');
      calls.push({
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
    },
  };
  const api = createClient({
    transport,
    queued: createQueuedCommandLog(),
    entitlements: createEntitlementStore({
      loadSnapshot: async () => ({
        orgId: 'org_1',
        version: 1,
        features: {},
        limits: {},
        computedAt: new Date(0).toISOString(),
      }),
    }),
    keyStore: new Map<string, string>(),
  });
  return { api, calls };
}

describe('Form C client', () => {
  it('reads the register with its filter, a stay, and one person', async () => {
    const { api, calls } = client();
    await api.getFormCRegister('prop 1', 'overdue');
    await api.getReservationFormC('prop 1', 'res/1');
    await api.getFormCPerson('prop 1', 'fcb_res_1');
    expect(calls).toEqual([
      { path: '/v1/properties/prop%201/form-c?filter=overdue', method: 'GET', body: undefined },
      { path: '/v1/properties/prop%201/reservations/res%2F1/form-c', method: 'GET', body: undefined },
      { path: '/v1/properties/prop%201/form-c/fcb_res_1', method: 'GET', body: undefined },
    ]);
  });

  it('writes carry a stable JSON idempotency key per operation', async () => {
    const { api, calls } = client();
    const fields = {
      surname: 'Mokoena',
      gender: 'F' as const,
      dateOfBirth: '1990-04-01',
      nationality: 'ZA',
      passportNumber: 'ZZ1',
    };
    await api.saveFormCPerson('p', 'res_1', { recordId: 'fca_1', kind: 'ADDITIONAL', fields }, 'op-save');
    await api.saveFormCPerson('p', 'res_1', { recordId: 'fca_1', kind: 'ADDITIONAL', fields }, 'op-save');
    await api.markFormCFiled('p', 'fca_1', 'FC-1', 'op-filed');
    await api.removeFormCPerson('p', 'fca_1', 'left early', 'op-remove');
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['POST', '/v1/properties/p/reservations/res_1/form-c'],
      ['POST', '/v1/properties/p/reservations/res_1/form-c'],
      ['POST', '/v1/properties/p/form-c/fca_1/filed'],
      ['POST', '/v1/properties/p/form-c/fca_1/remove'],
    ]);
    expect(calls[0]!.body).toMatchObject({ recordId: 'fca_1', kind: 'ADDITIONAL', fields });
    expect(calls[0]!.body!.idempotencyKey).toBe(calls[1]!.body!.idempotencyKey);
    expect(calls[2]!.body).toMatchObject({ reference: 'FC-1' });
    expect(calls[3]!.body).toMatchObject({ reason: 'left early' });
    expect(new Set(calls.map((c) => c.body!.idempotencyKey)).size).toBe(3);
  });
});
