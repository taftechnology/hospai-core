import { env, createMessageBatch } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage, ProvisionalCommand } from '@hospai/contracts';
import { enqueueProvisionalCommand } from '../src/provisional-queue.js';
import { countPendingOpen, insertPendingOpen } from '../src/night-audit-census.js';
import { handlePendingCommandsBatch } from '../src/pending-commands-consumer.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

function sampleCommand(propertyId: string, idempotencyKey: string): ProvisionalCommand {
  return {
    idempotencyKey,
    requestFingerprint: 'fp',
    propertyId,
    orgId: 'org_x',
    issuedAt: new Date().toISOString(),
    businessDate: '2026-03-01',
    actor: { userId: 'u1' },
    command: { type: 'folio.add_item', payload: {} },
    routeId: 'post_folio_add_item',
  };
}

describe('pending_command_open census', () => {
  it('4: enqueue writes D1 then queue; send failure deletes D1', async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_census_${crypto.randomUUID()}`;
    const cmd = sampleCommand(propertyId, `idem_${crypto.randomUUID()}`);

    await enqueueProvisionalCommand(env, cmd);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);

    vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockRejectedValueOnce(new Error('queue down'));
    const cmd2 = sampleCommand(propertyId, `idem_${crypto.randomUUID()}`);
    await expect(enqueueProvisionalCommand(env, cmd2)).rejects.toThrow('queue down');
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);
  });

  it('5: consumer terminal ack deletes D1 row', async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    const propertyId = `prop_gone_${crypto.randomUUID()}`;
    const idempotencyKey = `idem_${crypto.randomUUID()}`;
    await insertPendingOpen(env.PLATFORM_DB, {
      propertyId,
      idempotencyKey,
      businessDate: '2026-03-01',
      commandId: 'folio.add_item',
    });
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(1);

    const body: PendingCommandMessage = {
      v: 1,
      provisional: sampleCommand(propertyId, idempotencyKey),
      enqueuedAt: new Date().toISOString(),
    };
    const batch = createMessageBatch('hospai-pending-commands', [
      {
        id: `pending-${idempotencyKey}`,
        timestamp: new Date(),
        attempts: 1,
        body,
      },
    ]);
    await handlePendingCommandsBatch(batch as MessageBatch<PendingCommandMessage>, env);
    expect(await countPendingOpen(env.PLATFORM_DB, propertyId)).toBe(0);
  });
});
