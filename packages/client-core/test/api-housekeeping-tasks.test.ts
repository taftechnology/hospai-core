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

describe('housekeeping tasks and status history client methods', () => {
  it('getHousekeepingTasks sends date and only the filters that are set', async () => {
    const seen: Seen[] = [];
    await testClient(seen).getHousekeepingTasks('p', {
      date: '2026-11-20',
      status: 'pending',
      search: '101',
    });
    expect(seen[0]!.path).toBe('/v1/properties/p/housekeeping/tasks?date=2026-11-20&status=pending&search=101');
  });

  it('getHousekeepingDashboard sends the room search only when it is set', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.getHousekeepingDashboard('p');
    await client.getHousekeepingDashboard('p', { room: '1 2' });
    expect(seen[0]!.path).toBe('/v1/properties/p/housekeeping/dashboard');
    expect(seen[1]!.path).toBe('/v1/properties/p/housekeeping/dashboard?room=1+2');
  });

  it('create, update and transition carry the idempotency key in x-idempotency-key, not the body', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.createHousekeepingTask(
      'p',
      { businessDate: '2026-11-20', taskType: 'turndown', roomId: 'rm_1' },
      'op-create',
    );
    await client.updateHousekeepingTask('p', 'task_1', { priority: 'high' }, 'op-update');
    await client.transitionHousekeepingTask('p', 'task_1', { action: 'cancel', reason: 'No show' }, 'op-cancel');
    expect(seen.map((s) => [s.init?.method, s.path])).toEqual([
      ['POST', '/v1/properties/p/housekeeping/tasks'],
      ['PATCH', '/v1/properties/p/housekeeping/tasks/task_1'],
      ['POST', '/v1/properties/p/housekeeping/tasks/task_1/transition'],
    ]);
    for (const s of seen) {
      expect(headerOf(s.init, 'x-idempotency-key')).toBeTruthy();
      expect(String(s.init?.body)).not.toContain('idempotencyKey');
    }
    expect(JSON.parse(String(seen[2]!.init?.body))).toEqual({ action: 'cancel', reason: 'No show' });
    // Distinct operations get distinct keys; the same operation id keeps its key.
    expect(headerOf(seen[0]!.init, 'x-idempotency-key')).not.toBe(headerOf(seen[1]!.init, 'x-idempotency-key'));
  });

  it('updateRoomStatus and bulkUpdateRoomStatus send reason and comment only when given', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen);
    await client.updateRoomStatus('p', 'rm_1', 'dirty', 'op-1', { reason: 'Spill', comment: 'Wine' });
    await client.updateRoomStatus('p', 'rm_1', 'clean', 'op-2');
    await client.bulkUpdateRoomStatus(
      'p',
      { updates: [{ roomId: 'rm_1', status: 'dirty' }], reason: 'Drill' },
      'op-3',
    );
    const bodies = seen.map((s) => JSON.parse(String(s.init?.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ status: 'dirty', reason: 'Spill', comment: 'Wine' });
    expect(bodies[1]).not.toHaveProperty('reason');
    expect(bodies[1]).not.toHaveProperty('comment');
    expect(seen[2]!.path).toBe('/v1/properties/p/rooms/bulk-status');
    expect(bodies[2]).toMatchObject({ reason: 'Drill', updates: [{ roomId: 'rm_1', status: 'dirty' }] });
  });

  it('history reads hit the per-room paths', async () => {
    const seen: Seen[] = [];
    const client = testClient(seen, { ok: true, roomId: 'rm_1', history: [], events: [] });
    await client.getRoomStatusHistory('p', 'rm_1');
    await client.getRoomOooHistory('p', 'rm_1');
    expect(seen.map((s) => s.path)).toEqual([
      '/v1/properties/p/rooms/rm_1/status-history',
      '/v1/properties/p/rooms/rm_1/ooo-history',
    ]);
  });

  it('setOooRange passes block details and the release reason through', async () => {
    const seen: Seen[] = [];
    await testClient(seen).setOooRange('p', 'rm_1', {
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      blockType: 'renovation',
      startTime: '09:00',
      endTime: null,
      inspectionNotes: 'Tiles',
      releaseReason: 'Done',
      idempotencyKey: 'k',
    });
    expect(JSON.parse(String(seen[0]!.init?.body))).toMatchObject({
      blockType: 'renovation',
      startTime: '09:00',
      endTime: null,
      inspectionNotes: 'Tiles',
      releaseReason: 'Done',
    });
  });
});
