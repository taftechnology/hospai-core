import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHARGE_CODE_NOT_POSTABLE,
  IDEM_KEY_REUSED,
  PRODUCT_CATEGORY_EXISTS,
  PRODUCT_INVALID_AMOUNT,
  PRODUCT_NOT_FOUND,
  PRODUCT_SKU_TAKEN,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { orgStub as testOrgStub } from './guest-helpers.js';

function call(
  method: string,
  path: string,
  actor: string,
  body?: unknown,
  rawBody?: string,
): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(rawBody !== undefined
        ? { body: rawBody }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
    }),
    env,
  );
}

const key = () => `idem-prod-${crypto.randomUUID()}`;

async function provisionHotel(owner: string) {
  const orgId = `org_prod_${crypto.randomUUID()}`;
  const propertyId = `prop_prod_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', owner, { orgId, name: 'Products Org' })).status).toBe(201);
  expect(
    (
      await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
        propertyId,
        name: 'Products Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      })
    ).status,
  ).toBe(201);
  const p = `/v1/properties/${propertyId}`;
  expect(
    (await call('POST', `${p}/charge-codes`, owner, { code: 'MINIBAR', name: 'Minibar', idempotencyKey: key() }))
      .status,
  ).toBe(201);
  return { orgId, propertyId, p };
}

async function seedCatalog(p: string, owner: string) {
  const cat = await call('POST', `${p}/product-categories`, owner, {
    categoryId: 'cat_minibar',
    name: 'Minibar',
    idempotencyKey: key(),
  });
  expect(cat.status).toBe(201);
  const item = await call('POST', `${p}/products`, owner, {
    productId: 'prod_water',
    categoryId: 'cat_minibar',
    name: 'Water 500ml',
    sku: 'MB-WATER',
    chargeCode: 'MINIBAR',
    defaultAmountMinor: 4000,
    idempotencyKey: key(),
  });
  expect(item.status).toBe(201);
  return item;
}

type ProductsBody = {
  ok: true;
  categories: Array<{ categoryId: string; status: string }>;
  items: Array<{
    productId: string;
    chargeCode: string;
    defaultAmountMinor: number;
    taxGroup: string | null;
    postable: boolean;
    status: string;
  }>;
};

describe('products catalog routes (R1.5)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('creates a category and an item; the list carries the charge code tax group read-only', async () => {
    const owner = 'user_prod_owner1';
    const { p } = await provisionHotel(owner);
    expect(
      (await call('PATCH', `${p}/charge-codes/MINIBAR`, owner, { taxGroup: 'GOODS', idempotencyKey: key() }))
        .status,
    ).toBe(200);
    const created = await seedCatalog(p, owner);
    expect(await created.json()).toMatchObject({
      ok: true,
      item: { productId: 'prod_water', defaultAmountMinor: 4000, chargeCode: 'MINIBAR' },
    });
    const list = await call('GET', `${p}/products`, owner);
    expect(list.status).toBe(200);
    const body = (await list.json()) as ProductsBody;
    expect(body.categories.map((c) => c.categoryId)).toEqual(['cat_minibar']);
    expect(body.items).toEqual([
      expect.objectContaining({ productId: 'prod_water', taxGroup: 'GOODS', postable: true }),
    ]);
  });

  it('rejects system and tax-output charge codes as not postable', async () => {
    const owner = 'user_prod_owner2';
    const { p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    for (const chargeCode of ['ROOM', 'PAYMENT', 'DAMAGE']) {
      const res = await call('POST', `${p}/products`, owner, {
        productId: `prod_${chargeCode}`,
        categoryId: 'cat_minibar',
        name: chargeCode,
        chargeCode,
        defaultAmountMinor: 100,
        idempotencyKey: key(),
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error: CHARGE_CODE_NOT_POSTABLE });
    }
  });

  it('first writer wins on category id and SKU, with no other row in the body', async () => {
    const owner = 'user_prod_owner3';
    const { p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    const dupCat = await call('POST', `${p}/product-categories`, owner, {
      categoryId: 'cat_minibar',
      name: 'Other',
      idempotencyKey: key(),
    });
    expect(dupCat.status).toBe(409);
    expect(await dupCat.json()).toEqual({ ok: false, error: PRODUCT_CATEGORY_EXISTS });
    const dupSku = await call('POST', `${p}/products`, owner, {
      productId: 'prod_juice',
      categoryId: 'cat_minibar',
      name: 'Juice',
      sku: 'MB-WATER',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 500,
      idempotencyKey: key(),
    });
    expect(dupSku.status).toBe(409);
    expect(await dupSku.json()).toEqual({ ok: false, error: PRODUCT_SKU_TAKEN });
  });

  it('rejects a fractional amount, a bad body and malformed JSON', async () => {
    const owner = 'user_prod_owner4';
    const { p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    const frac = await call('POST', `${p}/products`, owner, {
      productId: 'prod_frac',
      categoryId: 'cat_minibar',
      name: 'Frac',
      chargeCode: 'MINIBAR',
      defaultAmountMinor: 12.5,
      idempotencyKey: key(),
    });
    expect(frac.status).toBe(422);
    expect(await frac.json()).toEqual({ ok: false, error: PRODUCT_INVALID_AMOUNT });
    const missing = await call('POST', `${p}/products`, owner, { productId: 'x', idempotencyKey: key() });
    expect(missing.status).toBe(400);
    const malformed = await call('POST', `${p}/products`, owner, undefined, '{not json');
    expect(malformed.status).toBe(400);
  });

  it('archives an item: active list hides it, status=all keeps it; unknown id is product_not_found', async () => {
    const owner = 'user_prod_owner5';
    const { p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    const archived = await call('PATCH', `${p}/products/prod_water`, owner, {
      status: 'archived',
      idempotencyKey: key(),
    });
    expect(archived.status).toBe(200);
    expect(((await (await call('GET', `${p}/products`, owner)).json()) as ProductsBody).items).toEqual([]);
    const all = (await (await call('GET', `${p}/products?status=all`, owner)).json()) as ProductsBody;
    expect(all.items.map((i) => i.status)).toEqual(['archived']);
    const missing = await call('PATCH', `${p}/products/prod_nope`, owner, { name: 'X', idempotencyKey: key() });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: PRODUCT_NOT_FOUND });
  });

  it('marks a product unpostable once its charge code is archived', async () => {
    const owner = 'user_prod_owner6';
    const { p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    expect(
      (
        await call('PUT', `${p}/charge-codes/MINIBAR/status`, owner, {
          status: 'archived',
          idempotencyKey: key(),
        })
      ).status,
    ).toBe(200);
    const body = (await (await call('GET', `${p}/products`, owner)).json()) as ProductsBody;
    expect(body.items[0]!.postable).toBe(false);
  });

  it('staff can list but not write; settings:configure is required', async () => {
    const owner = 'user_prod_owner7';
    const staff = 'user_prod_staff7';
    const { orgId, p } = await provisionHotel(owner);
    await seedCatalog(p, owner);
    await testOrgStub(orgId).ensureMember(staff, 'staff');
    expect((await call('GET', `${p}/products`, staff)).status).toBe(200);
    const denied = await call('POST', `${p}/product-categories`, staff, {
      categoryId: 'cat_spa',
      name: 'Spa',
      idempotencyKey: key(),
    });
    expect(denied.status).toBe(403);
  });

  it('replays the same key and body; the same key on a different command or body is IDEM_KEY_REUSED', async () => {
    const owner = 'user_prod_owner8';
    const { p } = await provisionHotel(owner);
    const k = key();
    const body = { categoryId: 'cat_bar', name: 'Bar', idempotencyKey: k };
    const first = await call('POST', `${p}/product-categories`, owner, body);
    expect(first.status).toBe(201);
    const replay = await call('POST', `${p}/product-categories`, owner, body);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    const otherBody = await call('POST', `${p}/product-categories`, owner, { ...body, name: 'Bar 2' });
    expect(otherBody.status).toBe(409);
    expect(await otherBody.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    const otherCommand = await call('PATCH', `${p}/product-categories/cat_bar`, owner, {
      name: 'Bar',
      idempotencyKey: k,
    });
    expect(otherCommand.status).toBe(409);
    expect(await otherCommand.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('kill-switch stops product writes with 503', async () => {
    const owner = 'user_prod_owner9';
    const { p } = await provisionHotel(owner);
    await setKillSwitch(env, 'pms.core', true);
    const res = await call('POST', `${p}/product-categories`, owner, {
      categoryId: 'cat_x',
      name: 'X',
      idempotencyKey: key(),
    });
    expect(res.status).toBe(503);
  });
});
