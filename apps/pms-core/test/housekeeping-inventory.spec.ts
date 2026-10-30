import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'HK Inventory Org' }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Inventory Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionProperty(actor: string) {
  const orgId = `org_hki_${crypto.randomUUID()}`;
  const propertyId = `prop_hki_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  return { orgId, propertyId, actor };
}

async function provisionTwoHotels(actor: string) {
  const orgId = `org_hki2_${crypto.randomUUID()}`;
  const propertyA = `prop_hki_a_${crypto.randomUUID()}`;
  const propertyB = `prop_hki_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyB, actor)).status).toBe(201);
  return { orgId, propertyA, propertyB, actor };
}

function itemUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/inventory${suffix}`;
}

describe('housekeeping inventory routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('create → receive → issue → count keeps on_hand aligned with movements', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyId } = await provisionProperty(actor);
    const itemId = `item_${crypto.randomUUID()}`;
    const idem = crypto.randomUUID();

    const createRes = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId,
          name: 'Bath towels',
          category: 'towels',
          unit: 'each',
          parLevel: 20,
          onHand: 10,
          idempotencyKey: idem,
        }),
      }),
      env,
    );
    expect(createRes.status, await createRes.clone().text()).toBe(201);

    async function adjust(kind: 'receive' | 'issue' | 'count', quantity: number) {
      const res = await worker.fetch(
        new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/adjust`), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ kind, quantity, idempotencyKey: crypto.randomUUID() }),
        }),
        env,
      );
      expect(res.status, await res.clone().text()).toBe(200);
    }

    await adjust('receive', 5);
    await adjust('issue', 3);
    await adjust('count', 15);

    const listRes = await worker.fetch(
      new Request(itemUrl(propertyId), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    const list = (await listRes.json()) as {
      ok: true;
      items: Array<{ itemId: string; onHand: number }>;
    };
    expect(list.items.find((i) => i.itemId === itemId)?.onHand).toBe(15);

    const movRes = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/movements`), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    const mov = (await movRes.json()) as {
      ok: true;
      movements: Array<{ kind: string; quantity: number; onHandAfter: number }>;
    };
    expect(mov.movements.map((m) => [m.kind, m.quantity, m.onHandAfter])).toEqual([
      ['count', 15, 15],
      ['issue', 3, 12],
      ['receive', 5, 15],
      ['count', 10, 10],
    ]);
  });

  it('issue below zero returns 422 insufficient_stock without a new movement', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyId } = await provisionProperty(actor);
    const itemId = `item_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request(itemUrl(propertyId, '/items'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              itemId,
              name: 'Soap',
              category: 'toiletries',
              unit: 'each',
              parLevel: 5,
              onHand: 2,
              idempotencyKey: crypto.randomUUID(),
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const issueRes = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/adjust`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ kind: 'issue', quantity: 5, idempotencyKey: crypto.randomUUID() }),
      }),
      env,
    );
    expect(issueRes.status).toBe(422);
    expect(((await issueRes.json()) as { error: string }).error).toBe('insufficient_stock');

    const listRes = await worker.fetch(
      new Request(itemUrl(propertyId), { headers: { 'x-dev-actor': actor } }),
      env,
    );
    const list = (await listRes.json()) as { items: Array<{ itemId: string; onHand: number }> };
    expect(list.items.find((i) => i.itemId === itemId)?.onHand).toBe(2);

    const movRes = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/movements`), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    const mov = (await movRes.json()) as { movements: unknown[] };
    expect(mov.movements).toHaveLength(1);
  });

  it('duplicate live name, cap, archive name reuse, and two-property isolation', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    const itemA = `item_a_${crypto.randomUUID()}`;

    expect(
      (
        await worker.fetch(
          new Request(itemUrl(propertyA, '/items'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              itemId: itemA,
              name: 'Shared Name',
              category: 'linens',
              unit: 'each',
              parLevel: 1,
              onHand: 0,
              idempotencyKey: crypto.randomUUID(),
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const dupRes = await worker.fetch(
      new Request(itemUrl(propertyA, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: `item_dup_${crypto.randomUUID()}`,
          name: 'shared name',
          category: 'linens',
          unit: 'each',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(dupRes.status).toBe(409);
    expect(((await dupRes.json()) as { error: string }).error).toBe('inventory_item_exists');

    await worker.fetch(
      new Request(itemUrl(propertyA, `/items/${encodeURIComponent(itemA)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          name: 'Shared Name',
          category: 'linens',
          unit: 'each',
          parLevel: 1,
          archived: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );

    const reuseRes = await worker.fetch(
      new Request(itemUrl(propertyA, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: `item_reuse_${crypto.randomUUID()}`,
          name: 'shared name',
          category: 'linens',
          unit: 'each',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(reuseRes.status).toBe(201);

    const listB = await worker.fetch(new Request(itemUrl(propertyB), { headers: { 'x-dev-actor': actor } }), env);
    const bodyB = (await listB.json()) as { items: Array<{ itemId: string; name: string }> };
    expect(bodyB.items.some((i) => i.itemId === itemA)).toBe(false);
    expect(bodyB.items.some((i) => i.name.toLowerCase() === 'shared name')).toBe(false);
  });

  it('validates caps, archived adjust, idempotency, and invalid bodies', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyId } = await provisionProperty(actor);
    const itemId = `item_${crypto.randomUUID()}`;
    const idem = crypto.randomUUID();

    const longName = 'x'.repeat(81);
    const capRes = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId,
          name: longName,
          category: 'other',
          unit: 'each',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(capRes.status).toBe(422);
    expect(((await capRes.json()) as { error: string }).error).toBe('limit_exceeded');

    expect(
      (
        await worker.fetch(
          new Request(itemUrl(propertyId, '/items'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              itemId,
              name: 'Valid',
              category: 'other',
              unit: 'each',
              parLevel: 1,
              onHand: 0,
              idempotencyKey: idem,
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const retry = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId,
          name: 'Valid',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: idem,
        }),
      }),
      env,
    );
    expect(retry.status).toBe(201);
    const mov = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/movements`), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(((await mov.json()) as { movements: unknown[] }).movements).toHaveLength(1);

    await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          name: 'Valid',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          archived: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );

    const archivedAdjust = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}/adjust`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ kind: 'receive', quantity: 1, idempotencyKey: crypto.randomUUID() }),
      }),
      env,
    );
    expect(archivedAdjust.status).toBe(409);
    expect(((await archivedAdjust.json()) as { error: string }).error).toBe('inventory_item_archived');

    const badPatch = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(itemId)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: 'other',
          name: 'Valid',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          archived: false,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(badPatch.status).toBe(400);

    const badBody = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: 'x2',
          name: 'X',
          category: 'other',
          unit: 'each',
          parLevel: '1',
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(badBody.status).toBe(400);

    const reusedId = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId,
          name: 'Valid',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(reusedId.status).toBe(409);
    expect(((await reusedId.json()) as { error: string }).error).toBe('inventory_item_exists');
  });

  it('unknown item is 404 and over-cap fields are 422', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyId } = await provisionProperty(actor);
    const missing = `missing_${crypto.randomUUID()}`;

    const movements = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(missing)}/movements`), {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(movements.status).toBe(404);
    expect(((await movements.json()) as { error: string }).error).toBe('inventory_item_not_found');

    const patchMissing = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(missing)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          name: 'Nope',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          archived: false,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(patchMissing.status).toBe(404);
    expect(((await patchMissing.json()) as { error: string }).error).toBe('inventory_item_not_found');

    const adjustMissing = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(missing)}/adjust`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ kind: 'receive', quantity: 1, idempotencyKey: crypto.randomUUID() }),
      }),
      env,
    );
    expect(adjustMissing.status).toBe(404);
    expect(((await adjustMissing.json()) as { error: string }).error).toBe('inventory_item_not_found');

    async function expectCap(body: Record<string, unknown>) {
      const res = await worker.fetch(
        new Request(itemUrl(propertyId, '/items'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            itemId: `cap_${crypto.randomUUID()}`,
            name: 'Cap',
            category: 'other',
            unit: 'each',
            parLevel: 1,
            onHand: 0,
            idempotencyKey: crypto.randomUUID(),
            ...body,
          }),
        }),
        env,
      );
      expect(res.status, await res.clone().text()).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe('limit_exceeded');
    }

    await expectCap({ unit: 'u'.repeat(21) });
    await expectCap({ parLevel: 1_000_001 });
    await expectCap({ onHand: 1_000_001 });

    const created = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: `cap_ok_${crypto.randomUUID()}`,
          name: 'Within cap',
          category: 'other',
          unit: 'each',
          parLevel: 1,
          onHand: 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: { itemId: string } };

    const bigQty = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(item.itemId)}/adjust`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          kind: 'receive',
          quantity: 1_000_001,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(bigQty.status).toBe(422);
    expect(((await bigQty.json()) as { error: string }).error).toBe('limit_exceeded');

    const longNote = await worker.fetch(
      new Request(itemUrl(propertyId, `/items/${encodeURIComponent(item.itemId)}/adjust`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          kind: 'receive',
          quantity: 1,
          note: 'n'.repeat(201),
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(longNote.status).toBe(422);
    expect(((await longNote.json()) as { error: string }).error).toBe('limit_exceeded');
  });

  it('the 201st live item is limit_exceeded', async () => {
    const actor = `user_hki_${crypto.randomUUID()}`;
    const { propertyId } = await provisionProperty(actor);
    for (let n = 0; n < 200; n++) {
      const res = await worker.fetch(
        new Request(itemUrl(propertyId, '/items'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            itemId: `live_${n}_${crypto.randomUUID()}`,
            name: `Live ${n}`,
            category: 'other',
            unit: 'ea',
            parLevel: 1,
            onHand: 0,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
        env,
      );
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const over = await worker.fetch(
      new Request(itemUrl(propertyId, '/items'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          itemId: `live_over_${crypto.randomUUID()}`,
          name: 'Over the live cap',
          category: 'other',
          unit: 'ea',
          parLevel: 1,
          onHand: 0,
          idempotencyKey: crypto.randomUUID(),
        }),
      }),
      env,
    );
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: string }).error).toBe('limit_exceeded');
  }, 180_000);
});
