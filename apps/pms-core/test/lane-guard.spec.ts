import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLogLine } from '@hospai/observability';
import { OUTBOX_BACKLOG_DELAY_MS } from '@hospai/do-runtime';
import { fingerprintPayload } from '@hospai/contracts';
import { provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';

async function configIdem(key: string, value: unknown, meta: { reason: string }) {
  const fingerprint = await fingerprintPayload({
    key,
    value,
        reason: meta.reason,
  });
  return { key: `idem-${key}-${fingerprint.slice(0, 12)}`, fingerprint };
}

function installLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === 'string') {
        lines.push(parseLogLine(arg));
      }
    }
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('LaneGuard (Phase 0)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cold start admits outbox flush without prior interactive work', async () => {
    const name = `lg_cold_${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    await stub.resetLaneGuardForTest();
    const backlogBefore = await stub.getOutboxBacklog();

    const capture = installLogCapture();
    const result = await stub.runOutboxAlarmForTest();
    capture.restore();

    expect(result).not.toBeNull();
    expect(capture.lines.some((l) => l.msg === 'outbox.deferred')).toBe(false);
    if (backlogBefore.unackedCount > 0) {
      expect(result!.flushed).toBeGreaterThan(0);
    } else {
      expect(result).toMatchObject({ flushed: 0, backlog: false });
    }
  });

  it('interactive command defers immediate outbox alarm with defer floor', async () => {
    const name = `lg_defer_${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    await stub.resetLaneGuardForTest({ quietMs: 250 });

    const meta = { reason: 'laneguard-defer' };
    const key = 'pms.availability.allow_overbooking';
    expect(
      await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, true, meta, await configIdem(key, true, meta)),
    ).toMatchObject({ ok: true });

    const unackedBefore = await stub.outboxUnackedCount();
    expect(unackedBefore).toBeGreaterThan(0);

    const before = Date.now();
    const capture = installLogCapture();
    const result = await stub.runOutboxAlarmForTest();
    capture.restore();

    expect(result).toBeNull();
    expect(await stub.outboxUnackedCount()).toBe(unackedBefore);

    const deferLog = capture.lines.find((l) => l.msg === 'outbox.deferred' && l.property_id === name);
    expect(deferLog).toMatchObject({
      level: 'info',
      module_id: 'pms.core',
      property_id: name,
      reason: 'background_not_admitted',
      defer_ms: expect.any(Number),
    });
    expect(deferLog?.defer_ms as number).toBeGreaterThanOrEqual(OUTBOX_BACKLOG_DELAY_MS);

    const schedule = await stub.getAlarmSchedule('outbox');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt - before).toBeGreaterThanOrEqual(OUTBOX_BACKLOG_DELAY_MS - 50);
    expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);
  });

  it('flushes after quiet window elapses with no further interactive touches', async () => {
    const name = `lg_quiet_${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', undefined, { flushOutbox: false });
    await stub.resetLaneGuardForTest({ quietMs: 50 });

    const meta = { reason: 'laneguard-quiet' };
    const key = 'pms.availability.allow_overbooking';
    expect(
      await stub.tryPutDomainConfig(TEST_OWNER_ACTOR, key, false, meta, await configIdem(key, false, meta)),
    ).toMatchObject({ ok: true });
    expect(await stub.outboxUnackedCount()).toBeGreaterThan(0);

    expect(await stub.runOutboxAlarmForTest()).toBeNull();

    await new Promise((r) => setTimeout(r, 60));

    const result = await stub.runOutboxAlarmForTest();
    expect(result?.flushed).toBeGreaterThan(0);
    expect(await stub.outboxUnackedCount()).toBe(0);
  });
});
