import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  insertProperty,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';
import { createHousekeeper } from './roster-helpers.js';

type Json = Record<string, unknown>;

async function call(method: string, path: string, actor: string, body?: Json, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-dev-actor': actor };
  if (key) headers['x-idempotency-key'] = key;
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

let keySeq = 0;
const nextKey = (p: string) => `${p}-${++keySeq}-${crypto.randomUUID()}`;
const asUser = (userId: string) => ({ kind: 'user' as const, userId });

async function provisionHotel(actor: string) {
  const orgId = `org_hkc_${crypto.randomUUID()}`;
  const propertyId = `prop_hkc_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Depth C Org' })).status).toBe(201);
  const created = await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
    propertyId,
    name: 'Depth C Hotel',
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const p = `/v1/properties/${propertyId}`;
  const rt = await call('POST', `${p}/room-types`, actor, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 10,
    maxOccupancy: 4,
    maxAdults: 3,
    idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
  });
  expect(rt.status).toBe(201);
  const { fromDate } = (await rt.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  await resolved!.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Depth C Guest', asUser(actor));
  const bd = (await resolved!.stub.readBusinessDate())!;
  const attendant = await createHousekeeper(org, propertyId, 'Ada', undefined, asUser(actor));
  return {
    orgId,
    propertyId,
    p,
    actor,
    org,
    bd,
    guest,
    attendant,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string): Promise<string> {
  const roomId = `rm_${code}`;
  const res = await call('POST', `${h.p}/rooms`, h.actor, {
    roomId,
    roomTypeId: 'rt_king',
    code,
    idempotencyKey: `idem-room-${roomId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return roomId;
}

async function createStay(h: Hotel, roomId: string): Promise<string> {
  const reservationId = `res_${crypto.randomUUID()}`;
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 2),
    adults: 1,
    children: 0,
  };
  expect(
    await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  const ci = { reservationId, roomId };
  expect(
    await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${reservationId}`, ci)),
  ).toMatchObject({ ok: true });
  return reservationId;
}

const base = (h: Hotel) => `${h.p}/housekeeping`;
const write = (h: Hotel, method: string, path: string, body: Json, key = nextKey('k')) =>
  call(method, `${base(h)}${path}`, h.actor, body, key);
const read = async <T = Json>(h: Hotel, path: string): Promise<T> => {
  const res = await call('GET', `${base(h)}${path}`, h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as T;
};

async function createStock(h: Hotel, itemId: string, name: string, category: string, onHand: number, unit = 'each') {
  const res = await call('POST', `${base(h)}/inventory/items`, h.actor, {
    itemId,
    name,
    category,
    unit,
    parLevel: 0,
    onHand,
    idempotencyKey: `idem-stock-${itemId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

async function onHand(h: Hotel, itemId: string): Promise<number> {
  return runInDurableObject(h.stub, (_i, state) => {
    const rows = state.storage.sql
      .exec(`SELECT on_hand FROM housekeeping_inventory_item WHERE item_id = ?`, itemId)
      .toArray() as Array<{ on_hand: number }>;
    return rows[0]!.on_hand;
  });
}

async function count(h: Hotel, table: string): Promise<number> {
  return runInDurableObject(h.stub, (_i, state) => {
    return (state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray() as Array<{ n: number }>)[0]!.n;
  });
}

type LinenBody = {
  items: Array<{ itemId: string; onHand: number; inLaundry: number; category: string }>;
  movements: Array<{
    movementId: string;
    kind: string;
    quantity: number;
    onHandAfter: number;
    roomCode: string | null;
    attendantRef: string | null;
    note: string | null;
    itemName: string;
  }>;
  truncated: boolean;
};
type PickupBody = {
  pickup: {
    pickupId: string;
    status: string;
    lines: Array<{ lineId: string; productId: string; quantity: number; amountMinor: number; folioLineId: string | null }>;
  };
};
type ReconBody = {
  rows: Array<{
    lineId: string;
    productId: string;
    roomCode: string;
    quantity: number;
    unitAmountMinor: number;
    amountMinor: number;
    status: string;
    stockTracked: boolean;
    stockMovement: boolean;
    folioState: string;
    guestRef: string | null;
    attendantRef: string | null;
  }>;
  totals: Array<{ productId: string; quantity: number; complimentaryQuantity: number; postedAmountMinor: number }>;
};
type DispatchBody = {
  dispatchId: string;
  status: string;
  stockStatus: string;
  exceptionReason: string | null;
  supervisorRef: string | null;
  roomCode: string;
  lines: Array<{ lineId: string; amenityName: string; expectedQuantity: number; actualQuantity: number | null }>;
};

/** Charge code, tax rule, two products, two minibar stock items, and the minibar setup. */
async function setupMinibar(h: Hotel, opts: { enable?: boolean; link?: boolean } = {}) {
  const key = () => `idem-${crypto.randomUUID()}`;
  const post = async (path: string, body: Json) => {
    const res = await call('POST', `${h.p}${path}`, h.actor, { ...body, idempotencyKey: key() });
    expect(res.status, `${path} ${await res.clone().text()}`).toBe(201);
  };
  await post('/charge-codes', { code: 'MBAR', name: 'Minibar' });
  await post('/charge-codes', { code: 'VATM', name: 'VAT minibar' });
  expect(
    (await call('PATCH', `${h.p}/charge-codes/MBAR`, h.actor, { taxGroup: 'MBAR', idempotencyKey: key() })).status,
  ).toBe(200);
  await post('/tax-rules', {
    taxRuleId: `tr_mbar_${crypto.randomUUID().slice(0, 8)}`,
    ruleKey: `mbar_${crypto.randomUUID().slice(0, 8)}`,
    name: 'Minibar tax',
    ruleType: 'PERCENTAGE',
    rate: '0.10',
    taxGroup: 'MBAR',
    outputChargeCode: 'VATM',
    priceMode: 'EXCLUSIVE',
    validFrom: addCalendarDays(h.bd, -30),
  });
  await post('/product-categories', { categoryId: 'cat_mb', name: 'Minibar' });
  await post('/products', {
    productId: 'prod_water',
    categoryId: 'cat_mb',
    name: 'Water',
    chargeCode: 'MBAR',
    defaultAmountMinor: 400,
  });
  await post('/products', {
    productId: 'prod_cola',
    categoryId: 'cat_mb',
    name: 'Cola',
    chargeCode: 'MBAR',
    defaultAmountMinor: 600,
  });
  await createStock(h, 'stk_water', 'Water bottle', 'minibar', 10);
  await createStock(h, 'stk_cola', 'Cola can', 'minibar', 5);
  const link = opts.link !== false;
  const res = await call('PUT', `${h.p}/config/domain`, h.actor, {
    key: 'pms.housekeeping.minibar',
    value: {
      enabled: opts.enable !== false,
      items: [
        { productId: 'prod_water', inventoryItemId: link ? 'stk_water' : null },
        { productId: 'prod_cola', inventoryItemId: link ? 'stk_cola' : null },
      ],
    },
    reason: 'test:minibar',
    idempotencyKey: key(),
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

const pickup = (h: Hotel, roomId: string, reservationId: string, extra: Json = {}, key = nextKey('mb')) =>
  write(
    h,
    'POST',
    '/minibar-pickups',
    {
      businessDate: h.bd,
      roomId,
      reservationId,
      lines: [
        { productId: 'prod_water', quantity: 2 },
        { productId: 'prod_cola', quantity: 1 },
      ],
      ...extra,
    },
    key,
  );

describe('housekeeping depth C: linen, minibar, amenities [R4.11]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. linen: each kind moves on-hand as specified, in laundry is out minus in, notes and stock are enforced', async () => {
    const h = await provisionHotel('user_hkc_1');
    const room = await addRoom(h, '101');
    await createStock(h, 'lin_sheet', 'Sheet', 'linens', 20);
    await createStock(h, 'lin_soap', 'Soap', 'toiletries', 20);
    const move = (body: Json, key?: string) =>
      write(h, 'POST', '/linen-movements', { businessDate: h.bd, itemId: 'lin_sheet', ...body }, key);
    const mustMove = async (body: Json) => {
      const res = await move(body);
      expect(res.status, await res.clone().text()).toBe(201);
      return ((await res.json()) as { movement: LinenBody['movements'][number] }).movement;
    };

    expect(await mustMove({ kind: 'issue', quantity: 5, roomId: room, attendantRef: h.attendant.staffId })).toMatchObject({
      kind: 'issue',
      quantity: 5,
      onHandAfter: 15,
      roomCode: '101',
      attendantRef: h.attendant.staffId,
    });
    expect((await mustMove({ kind: 'laundry_out', quantity: 6 })).onHandAfter).toBe(9);
    expect((await mustMove({ kind: 'laundry_in', quantity: 2 })).onHandAfter).toBe(11);
    expect((await mustMove({ kind: 'return', quantity: 3, roomId: room })).onHandAfter).toBe(14);
    expect((await mustMove({ kind: 'discard', quantity: 1, note: 'Stained beyond use' })).onHandAfter).toBe(13);
    expect((await mustMove({ kind: 'adjust', quantity: -2, note: 'Count correction' })).onHandAfter).toBe(11);
    expect((await mustMove({ kind: 'adjust', quantity: 4, note: 'Found in store' })).onHandAfter).toBe(15);
    expect(await onHand(h, 'lin_sheet')).toBe(15);

    // In laundry = out - in = 6 - 2.
    const list = await read<LinenBody>(h, '/linen-movements');
    expect(list.items.find((i) => i.itemId === 'lin_sheet')).toMatchObject({ onHand: 15, inLaundry: 4, category: 'linens' });
    // Only linens and towels are listed.
    expect(list.items.map((i) => i.itemId)).toEqual(['lin_sheet']);
    // Seven movements plus the opening receive that creating the item recorded.
    expect(list.movements).toHaveLength(8);
    // Filters: kind, room, attendant, item and a date range.
    expect((await read<LinenBody>(h, '/linen-movements?kind=issue')).movements).toHaveLength(1);
    expect((await read<LinenBody>(h, `/linen-movements?roomId=${room}`)).movements).toHaveLength(2);
    expect(
      (await read<LinenBody>(h, `/linen-movements?attendantRef=${h.attendant.staffId}`)).movements.map((m) => m.kind),
    ).toEqual(['issue']);
    expect((await read<LinenBody>(h, '/linen-movements?itemId=nope')).movements).toHaveLength(0);
    expect((await read<LinenBody>(h, `/linen-movements?from=${addCalendarDays(h.bd, 1)}`)).movements).toHaveLength(0);
    expect((await call('GET', `${base(h)}/linen-movements?kind=bogus`, h.actor)).status).toBe(400);

    // A discard or an adjustment without a note is refused.
    for (const body of [
      { kind: 'discard', quantity: 1 },
      { kind: 'adjust', quantity: 1, note: '   ' },
    ]) {
      const res = await move(body);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, error: 'reason_required' });
    }

    // Going below zero is refused and nothing is written.
    const before = await count(h, 'housekeeping_inventory_movement');
    for (const body of [
      { kind: 'issue', quantity: 16 },
      { kind: 'laundry_out', quantity: 99 },
      { kind: 'discard', quantity: 16, note: 'too many' },
      { kind: 'adjust', quantity: -16, note: 'too many' },
    ]) {
      const res = await move(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, error: 'insufficient_stock' });
    }
    expect(await count(h, 'housekeeping_inventory_movement')).toBe(before);
    expect(await onHand(h, 'lin_sheet')).toBe(15);

    // Only linen and towel items; shape, note length and the attendant gate.
    expect((await move({ itemId: 'lin_soap', kind: 'issue', quantity: 1 })).status).toBe(422);
    expect((await move({ kind: 'issue', quantity: 0 })).status).toBe(422);
    expect((await move({ kind: 'adjust', quantity: 0, note: 'x' })).status).toBe(422);
    expect((await move({ kind: 'sell', quantity: 1 })).status).toBe(422);
    expect((await move({ kind: 'issue', quantity: 1.5 })).status).toBe(400);
    expect((await move({ kind: 'discard', quantity: 1, note: 'N'.repeat(201) })).status).toBe(422);
    expect((await move({ kind: 'issue', quantity: 1, roomId: 'rm_nope' })).status).toBe(404);
    expect((await move({ itemId: 'nope', kind: 'issue', quantity: 1 })).status).toBe(404);
    expect((await move({ kind: 'issue', quantity: 1, attendantRef: 'staff_not_on_roster' })).status).toBe(422);
    expect((await move({ kind: 'issue', quantity: 1, attendantRef: 'not-a-ref' })).status).toBe(400);

    // The RPC enforces the same cap on a quantity.
    const rpcInput = { businessDate: h.bd, itemId: 'lin_sheet', kind: 'laundry_in', quantity: 1_000_001 };
    expect(
      await h.stub.tryRecordHousekeepingLinenMovement(asUser(h.actor), rpcInput, await idemFor('linen-rpc', rpcInput)),
    ).toMatchObject({ ok: false, error: 'limit_exceeded' });

    // R1.9 desk movements keep their three kinds and still land in the same table.
    const desk = await call('POST', `${base(h)}/inventory/items/lin_sheet/adjust`, h.actor, {
      kind: 'receive',
      quantity: 5,
      idempotencyKey: 'idem-desk-receive',
    });
    expect(desk.status, await desk.clone().text()).toBe(200);
    expect(await onHand(h, 'lin_sheet')).toBe(20);
  });

  it('2. minibar pickup: two lines post two GUEST charges with tax at price x quantity, stock moves, replay is one pickup', async () => {
    const h = await provisionHotel('user_hkc_2');
    const room = await addRoom(h, '201');
    const stay = await createStay(h, room);
    await setupMinibar(h);

    const balance = async () => {
      const f = await h.stub.readFolio(stay);
      return f.ok ? f.balanceMinor : NaN;
    };
    const before = await balance();
    const key = nextKey('mb-main');
    const res = await pickup(h, room, stay, { attendantRef: h.attendant.staffId }, key);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as PickupBody;
    expect(body.pickup.status).toBe('posted');
    // Lines come back in product id order (they are sorted before they are hashed).
    expect(body.pickup.lines.map((l) => [l.productId, l.quantity, l.amountMinor])).toEqual([
      ['prod_cola', 1, 600],
      ['prod_water', 2, 800],
    ]);

    // Folio: one GUEST charge per line (source MINIBAR, ids derived from the pickup line) plus its tax.
    const lines = await h.stub.listFolioLinesForReservation(stay);
    const charges = lines.filter((l) => l.source === 'MINIBAR');
    expect(charges.map((l) => [l.folioLineId, l.chargeCode, l.amountMinor]).sort()).toEqual(
      body.pickup.lines.map((l) => [`fl_${l.lineId}`, 'MBAR', l.amountMinor]).sort(),
    );
    for (const l of body.pickup.lines) expect(l.folioLineId).toBe(`fl_${l.lineId}`);
    const taxes = lines.filter((l) => l.source === 'TAX' && charges.some((c) => c.folioLineId === l.taxOf));
    expect(taxes.map((t) => t.amountMinor).sort((a, b) => a - b)).toEqual([60, 80]);
    expect(await balance()).toBe(before + 800 + 80 + 600 + 60);
    // Same window as add_item: GUEST.
    const windowId = await runInDurableObject(h.stub, (_i, state) => {
      const rows = state.storage.sql
        .exec(`SELECT DISTINCT folio_window_id FROM folio_line WHERE source = 'MINIBAR'`)
        .toArray() as Array<{ folio_window_id: string }>;
      return rows.map((r) => r.folio_window_id);
    });
    expect(windowId).toEqual([`${stay}:GUEST`]);

    // Two stock movements: water -2, cola -1, with room and attendant.
    expect(await onHand(h, 'stk_water')).toBe(8);
    expect(await onHand(h, 'stk_cola')).toBe(4);
    const moves = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(
          `SELECT item_id, kind, quantity, on_hand_after, room_id, attendant_ref
           FROM housekeeping_inventory_movement WHERE kind = 'minibar' ORDER BY item_id`,
        )
        .toArray(),
    );
    expect(moves).toEqual([
      { item_id: 'stk_cola', kind: 'minibar', quantity: 1, on_hand_after: 4, room_id: room, attendant_ref: h.attendant.staffId },
      { item_id: 'stk_water', kind: 'minibar', quantity: 2, on_hand_after: 8, room_id: room, attendant_ref: h.attendant.staffId },
    ]);

    // The audit row records the folio line ids.
    const audit = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(
          `SELECT entity_type, reservation_id, after_json FROM audit_log
           WHERE command_id = 'housekeeping.record_minibar_pickup'`,
        )
        .toArray() as Array<{ entity_type: string; reservation_id: string; after_json: string }>,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entity_type: 'housekeeping_minibar_pickup', reservation_id: stay });
    const afterJson = JSON.parse(audit[0]!.after_json) as { lines: Array<{ folioLineId: string }> };
    expect(afterJson.lines.map((l) => l.folioLineId).sort()).toEqual(body.pickup.lines.map((l) => `fl_${l.lineId}`).sort());

    // Replay with the same key and body: one pickup, one set of lines, one set of charges.
    const replay = await pickup(h, room, stay, { attendantRef: h.attendant.staffId }, key);
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as PickupBody).pickup.pickupId).toBe(body.pickup.pickupId);
    expect(await count(h, 'housekeeping_minibar_pickup')).toBe(1);
    expect(await count(h, 'housekeeping_minibar_pickup_line')).toBe(2);
    expect((await h.stub.listFolioLinesForReservation(stay)).filter((l) => l.source === 'MINIBAR')).toHaveLength(2);
    expect(await balance()).toBe(before + 1540);
    expect(await onHand(h, 'stk_water')).toBe(8);
    // The same key with a different body is refused.
    const reused = await pickup(h, room, stay, { attendantRef: h.attendant.staffId, lines: [{ productId: 'prod_water', quantity: 1 }] }, key);
    expect(reused.status).toBe(409);
    // Lines in another order hash the same (sorted before hashing).
    const reordered = await write(
      h,
      'POST',
      '/minibar-pickups',
      {
        businessDate: h.bd,
        roomId: room,
        reservationId: stay,
        attendantRef: h.attendant.staffId,
        lines: [
          { productId: 'prod_water', quantity: 2 },
          { productId: 'prod_cola', quantity: 1 },
        ],
      },
      key,
    );
    expect(reordered.status).toBe(201);
    expect(await count(h, 'housekeeping_minibar_pickup')).toBe(1);

    // The same fingerprint rules at the RPC: the sorted array that is hashed is the array that runs.
    const rpc = {
      businessDate: h.bd,
      roomId: room,
      reservationId: stay,
      lines: [{ productId: 'prod_cola', quantity: 21 }],
    };
    expect(
      await h.stub.tryRecordHousekeepingMinibarPickup(asUser(h.actor), rpc, await idemFor('mb-rpc-qty', rpc)),
    ).toMatchObject({ ok: false, error: 'invalid_request' });
    const tooMany = {
      ...rpc,
      lines: Array.from({ length: 21 }, (_, i) => ({ productId: `prod_${i}`, quantity: 1 })),
    };
    expect(
      await h.stub.tryRecordHousekeepingMinibarPickup(asUser(h.actor), tooMany, await idemFor('mb-rpc-21', tooMany)),
    ).toMatchObject({ ok: false, error: 'limit_exceeded' });
    const overHttp = await pickup(h, room, stay, { lines: tooMany.lines });
    expect(overHttp.status).toBe(422);
    expect(await overHttp.json()).toMatchObject({ error: 'limit_exceeded' });
  });

  it('3. complimentary: no folio line, a stock movement, and a reason is required', async () => {
    const h = await provisionHotel('user_hkc_3');
    const room = await addRoom(h, '301');
    const stay = await createStay(h, room);
    await setupMinibar(h);
    const f0 = await h.stub.readFolio(stay);
    const balance0 = f0.ok ? f0.balanceMinor : NaN;

    const noReason = await pickup(h, room, stay, { complimentary: true });
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ ok: false, error: 'reason_required' });
    expect(await count(h, 'housekeeping_minibar_pickup')).toBe(0);
    expect(await onHand(h, 'stk_water')).toBe(10);

    const res = await pickup(h, room, stay, { complimentary: true, complimentaryReason: 'Birthday gift' });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as PickupBody;
    expect(body.pickup.status).toBe('complimentary');
    expect(body.pickup.lines.every((l) => l.folioLineId === null)).toBe(true);
    expect((await h.stub.listFolioLinesForReservation(stay)).filter((l) => l.source === 'MINIBAR')).toHaveLength(0);
    const f1 = await h.stub.readFolio(stay);
    expect(f1.ok && f1.balanceMinor).toBe(balance0);
    expect(await onHand(h, 'stk_water')).toBe(8);
    expect(await onHand(h, 'stk_cola')).toBe(4);

    const recon = await read<ReconBody>(h, '/minibar-reconciliation');
    expect(recon.rows.map((r) => [r.productId, r.status, r.folioState, r.stockMovement])).toEqual([
      ['prod_cola', 'complimentary', 'none', true],
      ['prod_water', 'complimentary', 'none', true],
    ]);
    expect(recon.totals.map((t) => [t.productId, t.quantity, t.complimentaryQuantity, t.postedAmountMinor])).toEqual([
      ['prod_cola', 1, 1, 0],
      ['prod_water', 2, 2, 0],
    ]);
  });

  it('4. refusals write nothing: disabled, not in setup, short stock, closed window, checked out without a hold', async () => {
    const h = await provisionHotel('user_hkc_4');
    const room = await addRoom(h, '401');
    const stay = await createStay(h, room);
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');

    // Not configured at all -> invalid_request.
    const unconfigured = await pickup(h, room, stay);
    expect(unconfigured.status).toBe(422);
    expect(await unconfigured.json()).toMatchObject({ ok: false, error: 'invalid_request' });

    await setupMinibar(h, { enable: false });
    const disabled = await pickup(h, room, stay);
    expect(disabled.status).toBe(422);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_request' });
    // Enable through the config alone; the catalogue and stock already exist.
    const enable = await call('PUT', `${h.p}/config/domain`, h.actor, {
      key: 'pms.housekeeping.minibar',
      value: {
        enabled: true,
        items: [
          { productId: 'prod_water', inventoryItemId: 'stk_water' },
          { productId: 'prod_cola', inventoryItemId: 'stk_cola' },
        ],
      },
      reason: 'test:enable',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(enable.status, await enable.clone().text()).toBe(200);

    const snapshot = async () => ({
      pickups: await count(h, 'housekeeping_minibar_pickup'),
      lines: await count(h, 'housekeeping_minibar_pickup_line'),
      movements: await count(h, 'housekeeping_inventory_movement'),
      folio: (await h.stub.listFolioLinesForReservation(stay)).length,
      water: await onHand(h, 'stk_water'),
      cola: await onHand(h, 'stk_cola'),
    });
    const start = await snapshot();
    const refused = async (res: Response, status: number, error: string) => {
      expect(res.status, await res.clone().text()).toBe(status);
      expect(await res.json()).toMatchObject({ ok: false, error });
      expect(await snapshot()).toEqual(start);
    };

    // A product that is not in the setup, or not in the catalogue.
    await refused(await pickup(h, room, stay, { lines: [{ productId: 'prod_water', quantity: 1 }, { productId: 'prod_other', quantity: 1 }] }), 422, 'invalid_request');
    // Stock short on the second line: the first line's movement and nothing else is rolled back too.
    await refused(await pickup(h, room, stay, { lines: [{ productId: 'prod_water', quantity: 2 }, { productId: 'prod_cola', quantity: 6 }] }), 422, 'insufficient_stock');
    // Bad quantities and duplicate lines.
    await refused(await pickup(h, room, stay, { lines: [{ productId: 'prod_water', quantity: 0 }] }), 422, 'invalid_request');
    await refused(await pickup(h, room, stay, { lines: [{ productId: 'prod_water', quantity: 1 }, { productId: 'prod_water', quantity: 1 }] }), 422, 'invalid_request');
    // The stay must be in that room.
    const otherRoom = await addRoom(h, '402');
    await refused(await pickup(h, otherRoom, stay), 422, 'invalid_request');
    await refused(await pickup(h, room, 'res_nope'), 404, 'not_found');
    // An attendant who is not on this property's roster.
    expect((await pickup(h, room, stay, { attendantRef: 'staff_not_on_roster' })).status).toBe(422);
    expect(await snapshot()).toEqual(start);

    // A closed GUEST window.
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE folio_window SET status = 'CLOSED' WHERE folio_window_id = ?`, `${stay}:GUEST`);
    });
    await refused(await pickup(h, room, stay), 422, 'window_closed');
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE folio_window SET status = 'OPEN' WHERE folio_window_id = ?`, `${stay}:GUEST`);
    });

    // Checked out without a hold.
    const charge = { folioLineId: `pre-${crypto.randomUUID()}`, reservationId: stay, chargeCode: 'MISC', amountMinor: 2500 };
    expect(await h.stub.tryAddFolioLine(asUser(h.actor), charge, await idemFor(`pre-${stay}`, charge))).toMatchObject({ ok: true });
    const out = { reservationId: stay, overrideBalance: true };
    const checkedOut = await h.stub.tryCheckOut(asUser(h.actor), out, await idemFor(`co-${stay}`, out));
    expect(checkedOut, JSON.stringify(checkedOut)).toMatchObject({ ok: true });
    const afterCharge = await snapshot();
    const noHold = await pickup(h, room, stay);
    expect(noHold.status, await noHold.clone().text()).toBe(422);
    expect(await noHold.json()).toMatchObject({ ok: false, error: 'checked_out_requires_hold' });
    expect(await snapshot()).toEqual(afterCharge);

    // With an active hold, a checked-out stay posts.
    const room2 = await addRoom(h, '403');
    const stay2 = await createStay(h, room2);
    await h.stub.writeConfigValueForTest('pms.folio.open_folio', {
      enabled: true,
      followUpDays: 3,
      closeByDays: 14,
      autoOpenOnDepartWithBalance: false,
      autoCloseAtZeroAfterDays: null,
    });
    const pre2 = { folioLineId: `pre-${crypto.randomUUID()}`, reservationId: stay2, chargeCode: 'MISC', amountMinor: 2500 };
    expect(await h.stub.tryAddFolioLine(asUser(h.actor), pre2, await idemFor(`pre-${stay2}`, pre2))).toMatchObject({ ok: true });
    const hold = { reservationId: stay2, reason: 'post-stay bill' };
    expect(await h.stub.tryPlaceFolioHold(asUser(h.actor), hold, await idemFor(`hold-${stay2}`, hold))).toMatchObject({ ok: true });
    const out2 = { reservationId: stay2 };
    expect(await h.stub.tryCheckOut(asUser(h.actor), out2, await idemFor(`co-${stay2}`, out2))).toMatchObject({ ok: true });
    expect(await h.stub.getReservationStatus(stay2)).toBe('checked_out');
    const withHold = await pickup(h, room2, stay2);
    expect(withHold.status, await withHold.clone().text()).toBe(201);
    expect((await h.stub.listFolioLinesForReservation(stay2)).filter((l) => l.source === 'MINIBAR')).toHaveLength(2);
  });

  it('5. reconciliation: posted, then moved after a transfer to a company window, missing when the line is gone', async () => {
    const h = await provisionHotel('user_hkc_5');
    const room = await addRoom(h, '501');
    const stay = await createStay(h, room);
    await setupMinibar(h);
    const created = (await (await pickup(h, room, stay, { attendantRef: h.attendant.staffId })).json()) as PickupBody;
    const waterLine = created.pickup.lines.find((l) => l.productId === 'prod_water')!;
    const colaLine = created.pickup.lines.find((l) => l.productId === 'prod_cola')!;

    let recon = await read<ReconBody>(h, '/minibar-reconciliation');
    expect(recon.rows.map((r) => [r.productId, r.folioState, r.stockMovement, r.stockTracked, r.status]).sort()).toEqual([
      ['prod_cola', 'posted', true, true, 'posted'],
      ['prod_water', 'posted', true, true, 'posted'],
    ]);
    expect(recon.rows[0]).toMatchObject({ roomCode: '501', guestRef: h.guest.guestRef, attendantRef: h.attendant.staffId });
    expect(recon.totals).toEqual([
      { productId: 'prod_cola', productName: 'Cola', quantity: 1, complimentaryQuantity: 0, postedAmountMinor: 600 },
      { productId: 'prod_water', productName: 'Water', quantity: 2, complimentaryQuantity: 0, postedAmountMinor: 800 },
    ]);

    // Transfer the water charge to a COMPANY window.
    expect(
      await h.stub.tryCreateCityLedgerAccount(asUser(h.actor), { name: 'Acme' }, await idemFor('cla-acme', { name: 'Acme' })),
    ).toMatchObject({ ok: true });
    const open = await h.stub.tryOpenFolioWindow(
      asUser(h.actor),
      { reservationId: stay, kind: 'COMPANY', billedParty: 'Acme' },
      await idemFor('open-acme', { reservationId: stay, kind: 'COMPANY', billedParty: 'Acme' }),
    );
    expect(open).toMatchObject({ ok: true });
    const xfer = { sourceFolioLineId: waterLine.folioLineId!, destinationFolioWindowId: open.ok ? open.folioWindowId : '' };
    expect(await h.stub.tryTransferCharge(asUser(h.actor), xfer, await idemFor('xfer-water', xfer))).toMatchObject({ ok: true });

    recon = await read<ReconBody>(h, '/minibar-reconciliation');
    expect(recon.rows.find((r) => r.lineId === waterLine.lineId)?.folioState).toBe('moved');
    expect(recon.rows.find((r) => r.lineId === colaLine.lineId)?.folioState).toBe('posted');

    // A charged line whose folio line is gone is flagged.
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`DELETE FROM folio_line WHERE tax_of = ?`, `fl_${colaLine.lineId}`);
      state.storage.sql.exec(`DELETE FROM folio_line WHERE folio_line_id = ?`, `fl_${colaLine.lineId}`);
    });
    recon = await read<ReconBody>(h, '/minibar-reconciliation');
    expect(recon.rows.find((r) => r.lineId === colaLine.lineId)?.folioState).toBe('missing');

    // Filters.
    expect((await read<ReconBody>(h, `/minibar-reconciliation?from=${addCalendarDays(h.bd, 1)}`)).rows).toHaveLength(0);
    expect((await read<ReconBody>(h, '/minibar-reconciliation?status=complimentary')).rows).toHaveLength(0);
    expect((await call('GET', `${base(h)}/minibar-reconciliation?status=bogus`, h.actor)).status).toBe(400);
  });

  it('6. amenities: master, rules, plan, confirm with an exception reason, stock movements, never the folio', async () => {
    const h = await provisionHotel('user_hkc_6');
    const r1 = await addRoom(h, '601');
    const r2 = await addRoom(h, '602');
    const stay = await createStay(h, r1);
    await createStock(h, 'am_soap', 'Soap bar', 'amenities', 10);
    await createStock(h, 'am_other', 'Not an amenity', 'toiletries', 10);

    const saveAmenity = (body: Json) => write(h, 'POST', '/amenities', body);
    const slippers = await saveAmenity({ name: 'Slippers', unit: 'pair', standardQuantity: 1 });
    expect(slippers.status, await slippers.clone().text()).toBe(200);
    const slippersId = ((await slippers.json()) as { amenity: { amenityId: string } }).amenity.amenityId;
    const soapRes = await saveAmenity({ name: 'Soap', unit: 'bar', standardQuantity: 2, inventoryItemId: 'am_soap' });
    const soapId = ((await soapRes.json()) as { amenity: { amenityId: string } }).amenity.amenityId;
    expect((await saveAmenity({ name: 'soap', unit: 'bar', standardQuantity: 1 })).status).toBe(422);
    expect((await saveAmenity({ name: 'Bad link', unit: 'bar', standardQuantity: 1, inventoryItemId: 'am_other' })).status).toBe(422);
    expect((await saveAmenity({ name: 'Zero', unit: 'bar', standardQuantity: 0 })).status).toBe(422);
    expect((await saveAmenity({ name: 'N'.repeat(81), unit: 'bar', standardQuantity: 1 })).status).toBe(422);
    expect((await saveAmenity({ amenityId: 'am_missing', name: 'X', unit: 'bar', standardQuantity: 1 })).status).toBe(404);
    const edited = await saveAmenity({ amenityId: slippersId, name: 'Slippers', unit: 'pair', standardQuantity: 1, active: true });
    expect(edited.status).toBe(200);

    const ruleBody = {
      name: 'Arrival kit',
      when: 'arrival',
      lines: [
        { amenityId: soapId, quantity: 2 },
        { amenityId: slippersId, quantity: 1 },
      ],
    };
    const rule = await write(h, 'POST', '/amenity-rules', ruleBody);
    expect(rule.status, await rule.clone().text()).toBe(200);
    const ruleId = ((await rule.json()) as { rule: { ruleId: string; lines: Array<{ amenityId: string }> } }).rule.ruleId;
    expect((await write(h, 'POST', '/amenity-rules', { ...ruleBody, name: 'arrival KIT' })).status).toBe(422);
    expect((await write(h, 'POST', '/amenity-rules', { ...ruleBody, name: 'Bad when', when: 'later' })).status).toBe(422);
    expect((await write(h, 'POST', '/amenity-rules', { ...ruleBody, name: 'No lines', lines: [] })).status).toBe(422);
    expect((await write(h, 'POST', '/amenity-rules', { ...ruleBody, name: 'Unknown', lines: [{ amenityId: 'nope', quantity: 1 }] })).status).toBe(422);
    const thirtyOne = Array.from({ length: 31 }, () => ({ amenityId: soapId, quantity: 1 }));
    expect((await write(h, 'POST', '/amenity-rules', { ...ruleBody, name: 'Many', lines: thirtyOne })).status).toBe(422);
    const listed = await read<{ amenities: Array<{ name: string; inventoryItemName: string | null }>; rules: Array<{ name: string }> }>(h, '/amenities');
    expect(listed.amenities.map((a) => [a.name, a.inventoryItemName])).toEqual([
      ['Slippers', null],
      ['Soap', 'Soap bar'],
    ]);
    expect(listed.rules.map((r) => r.name)).toEqual(['Arrival kit']);

    // Plan for two rooms; a second plan skips them.
    const plan = await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId, roomIds: [r2, r1] });
    expect(plan.status, await plan.clone().text()).toBe(201);
    const planned = (await plan.json()) as { created: DispatchBody[]; skippedRoomIds: string[] };
    expect(planned.created.map((d) => [d.roomCode, d.status, d.stockStatus]).sort()).toEqual([
      ['601', 'planned', 'pending'],
      ['602', 'planned', 'pending'],
    ]);
    expect(planned.created[0]!.lines.map((l) => [l.amenityName, l.expectedQuantity, l.actualQuantity]).sort()).toEqual([
      ['Slippers', 1, null],
      ['Soap', 2, null],
    ]);
    const again = await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId, roomIds: [r1] });
    expect(again.status).toBe(201);
    expect(((await again.json()) as { created: unknown[]; skippedRoomIds: string[] })).toMatchObject({ created: [], skippedRoomIds: [r1] });
    expect((await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId, roomIds: ['rm_nope'] })).status).toBe(404);
    expect((await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId: 'nope', roomIds: [r1] })).status).toBe(404);
    const manyRooms = Array.from({ length: 201 }, (_, i) => `rm_${i}`);
    const overRooms = await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId, roomIds: manyRooms });
    expect(overRooms.status).toBe(422);
    expect(await overRooms.json()).toMatchObject({ error: 'limit_exceeded' });
    const rpcPlan = { businessDate: h.bd, ruleId, roomIds: manyRooms };
    expect(
      await h.stub.tryPlanHousekeepingAmenityDispatches(asUser(h.actor), rpcPlan, await idemFor('plan-rpc', rpcPlan)),
    ).toMatchObject({ ok: false, error: 'limit_exceeded' });

    const forRoom = (rows: DispatchBody[], code: string) => rows.find((d) => d.roomCode === code)!;
    const dispatches = (await read<{ dispatches: DispatchBody[] }>(h, '/amenity-dispatches')).dispatches;
    const d1 = forRoom(dispatches, '601');
    const soapLine = d1.lines.find((l) => l.amenityName === 'Soap')!;
    const slipperLine = d1.lines.find((l) => l.amenityName === 'Slippers')!;
    const confirm = (d: DispatchBody, lines: Array<{ lineId: string; actualQuantity: number }>, extra: Json = {}) =>
      write(h, 'POST', `/amenity-dispatches/${d.dispatchId}/confirm`, { lines, ...extra });

    // A difference with no reason is refused; nothing moves.
    const diff = [
      { lineId: soapLine.lineId, actualQuantity: 1 },
      { lineId: slipperLine.lineId, actualQuantity: 1 },
    ];
    const noReason = await confirm(d1, diff);
    expect(noReason.status).toBe(422);
    expect(await noReason.json()).toMatchObject({ ok: false, error: 'reason_required' });
    expect(await onHand(h, 'am_soap')).toBe(10);
    expect(
      forRoom((await read<{ dispatches: DispatchBody[] }>(h, '/amenity-dispatches')).dispatches, '601').status,
    ).toBe('planned');
    // Partial lines are refused.
    expect((await confirm(d1, [diff[0]!], { exceptionReason: 'x' })).status).toBe(422);

    // With a reason and a supervisor: confirmed, one amenity movement for the linked line.
    const supervisor = (await createHousekeeper(h.org, h.propertyId, 'Sam', undefined, asUser(h.actor))).staffId;
    const ok = await confirm(d1, diff, { exceptionReason: 'Ran short of soap', supervisorRef: supervisor });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as { dispatch: DispatchBody }).dispatch).toMatchObject({
      status: 'confirmed',
      stockStatus: 'posted',
      exceptionReason: 'Ran short of soap',
      supervisorRef: supervisor,
    });
    expect(await onHand(h, 'am_soap')).toBe(9);
    const amenityMoves = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(`SELECT item_id, quantity, on_hand_after, room_id FROM housekeeping_inventory_movement WHERE kind = 'amenity'`)
        .toArray(),
    );
    expect(amenityMoves).toEqual([{ item_id: 'am_soap', quantity: 1, on_hand_after: 9, room_id: r1 }]);
    // A confirmed dispatch cannot be confirmed again.
    expect((await confirm(d1, diff, { exceptionReason: 'again' })).status).toBe(422);
    expect(await onHand(h, 'am_soap')).toBe(9);

    // Equal to expected needs no reason; stock short refuses and keeps the dispatch planned.
    const d2 = forRoom(dispatches, '602');
    const exact = d2.lines.map((l) => ({ lineId: l.lineId, actualQuantity: l.expectedQuantity }));
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE housekeeping_inventory_item SET on_hand = 1 WHERE item_id = 'am_soap'`);
    });
    const short = await confirm(d2, exact);
    expect(short.status).toBe(422);
    expect(await short.json()).toMatchObject({ error: 'insufficient_stock' });
    expect(forRoom((await read<{ dispatches: DispatchBody[] }>(h, '/amenity-dispatches')).dispatches, '602').status).toBe('planned');
    await runInDurableObject(h.stub, (_i, state) => {
      state.storage.sql.exec(`UPDATE housekeeping_inventory_item SET on_hand = 10 WHERE item_id = 'am_soap'`);
    });
    const exactOk = await confirm(d2, exact);
    expect(exactOk.status, await exactOk.clone().text()).toBe(200);
    expect(await onHand(h, 'am_soap')).toBe(8);

    // An amenity with no stock link reads not_linked.
    const bare = await write(h, 'POST', '/amenity-rules', {
      name: 'Slippers only',
      when: 'departure',
      lines: [{ amenityId: slippersId, quantity: 1 }],
    });
    const bareRuleId = ((await bare.json()) as { rule: { ruleId: string } }).rule.ruleId;
    const planBare = await write(h, 'POST', '/amenity-dispatches/plan', { businessDate: h.bd, ruleId: bareRuleId, roomIds: [r2] });
    const bareDispatch = ((await planBare.json()) as { created: DispatchBody[] }).created[0]!;
    const bareConfirm = await confirm(bareDispatch, [{ lineId: bareDispatch.lines[0]!.lineId, actualQuantity: 1 }]);
    expect(((await bareConfirm.json()) as { dispatch: DispatchBody }).dispatch).toMatchObject({ status: 'confirmed', stockStatus: 'not_linked' });

    // Ledger filters.
    const confirmed = await read<{ dispatches: DispatchBody[] }>(h, '/amenity-dispatches?status=confirmed');
    expect(confirmed.dispatches).toHaveLength(3);
    expect((await read<{ dispatches: DispatchBody[] }>(h, '/amenity-dispatches?status=planned')).dispatches).toHaveLength(0);
    expect((await read<{ dispatches: DispatchBody[] }>(h, `/amenity-dispatches?roomId=${r1}`)).dispatches).toHaveLength(1);
    expect((await call('GET', `${base(h)}/amenity-dispatches?status=nope`, h.actor)).status).toBe(400);

    // Amenities never write a folio line.
    expect((await h.stub.listFolioLinesForReservation(stay)).filter((l) => l.source !== 'NIGHT_AUDIT')).toHaveLength(0);
  });

  it('7. two properties in one org: hotel A reads show no hotel B rows, and ids do not cross', async () => {
    const actor = 'user_hkc_7';
    const a = await provisionHotel(actor);
    const propertyB = `prop_hkc_b_${crypto.randomUUID()}`;
    const { stub: stubB } = await provisionedPropertyStub(propertyB, 'UTC', 'USD', a.orgId);
    await insertProperty(env, {
      propertyId: propertyB,
      orgId: a.orgId,
      name: 'Second Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 4, maxAdults: 3 };
    const addedRt = await stubB.tryAddRoomType(asUser(actor), rt, await idemFor('rt-hkc7', rt));
    expect(addedRt.ok).toBe(true);
    await stubB.flushOutbox();
    await seedBarRatesForHorizon(stubB, 'rt_king', addedRt.ok ? addedRt.fromDate : a.bd);
    const guestB = await createGuest(a.org, propertyB, `guest_${crypto.randomUUID()}`, 'B Guest', asUser(actor));
    const attendantB = await createHousekeeper(a.org, propertyB, 'Bea', undefined, asUser(actor));
    const b: Hotel = {
      ...a,
      propertyId: propertyB,
      p: `/v1/properties/${propertyB}`,
      stub: stubB as DurableObjectStub<PropertyDO>,
      bd: (await stubB.readBusinessDate())!,
      guest: guestB,
      attendant: attendantB,
    };
    const roomA = await addRoom(a, '701');
    const roomB = await addRoom(b, '701');
    const stayB = await createStay(b, roomB);
    await createStock(b, 'lin_b', 'Sheet B', 'linens', 5);
    await createStock(a, 'lin_a', 'Sheet A', 'linens', 5);
    await setupMinibar(b);
    expect((await pickup(b, roomB, stayB)).status).toBe(201);
    expect((await write(b, 'POST', '/linen-movements', { businessDate: b.bd, itemId: 'lin_b', kind: 'issue', quantity: 1 })).status).toBe(201);
    const amen = await write(b, 'POST', '/amenities', { name: 'Slippers', unit: 'pair', standardQuantity: 1 });
    const amenityB = ((await amen.json()) as { amenity: { amenityId: string } }).amenity.amenityId;
    const rule = await write(b, 'POST', '/amenity-rules', { name: 'Kit', when: 'arrival', lines: [{ amenityId: amenityB, quantity: 1 }] });
    const ruleB = ((await rule.json()) as { rule: { ruleId: string } }).rule.ruleId;
    const plan = await write(b, 'POST', '/amenity-dispatches/plan', { businessDate: b.bd, ruleId: ruleB, roomIds: [roomB] });
    const dispatchB = ((await plan.json()) as { created: DispatchBody[] }).created[0]!;

    // Hotel A's only movement is the opening receive of its own item; none of B's issue or receive shows.
    expect((await read<LinenBody>(a, '/linen-movements')).movements.map((m) => m.itemName)).toEqual(['Sheet A']);
    expect((await read<LinenBody>(a, '/linen-movements')).items.map((i) => i.itemId)).toEqual(['lin_a']);
    expect((await read<ReconBody>(a, '/minibar-reconciliation')).rows).toHaveLength(0);
    expect((await read<{ amenities: unknown[]; rules: unknown[] }>(a, '/amenities'))).toEqual({ ok: true, amenities: [], rules: [] });
    expect((await read<{ dispatches: unknown[] }>(a, '/amenity-dispatches')).dispatches).toHaveLength(0);

    // Hotel B ids through hotel A's URL are not found.
    expect((await write(a, 'POST', '/linen-movements', { businessDate: a.bd, itemId: 'lin_b', kind: 'issue', quantity: 1 })).status).toBe(404);
    expect((await write(a, 'POST', '/amenity-dispatches/plan', { businessDate: a.bd, ruleId: ruleB, roomIds: [roomA] })).status).toBe(404);
    expect((await write(a, 'POST', `/amenity-dispatches/${dispatchB.dispatchId}/confirm`, { lines: [{ lineId: dispatchB.lines[0]!.lineId, actualQuantity: 1 }] })).status).toBe(404);
    expect((await pickup(a, roomB, stayB)).status).toBe(422);
    expect(await count(b, 'housekeeping_minibar_pickup')).toBe(1);
  });

  it('8. the kill-switch blocks the writes; permissions, pins, the config key and purge inventory', async () => {
    const h = await provisionHotel('user_hkc_8');
    await setKillSwitch(env, 'pms.core', true);
    expect((await write(h, 'POST', '/linen-movements', { businessDate: h.bd, itemId: 'x', kind: 'issue', quantity: 1 })).status).toBe(503);
    expect((await write(h, 'POST', '/amenities', { name: 'X', unit: 'u', standardQuantity: 1 })).status).toBe(503);
    await setKillSwitch(env, 'pms.core', false);

    expect(V1_HTTP_ROUTE_AUDIT.slice(-25, -15).map((r) => [r.id, 'permission' in r ? r.permission : null])).toEqual([
      ['post_linen_movement', 'housekeeping:write'],
      ['post_minibar_pickup', 'housekeeping:write'],
      ['post_amenity', 'settings:configure'],
      ['post_amenity_rule', 'settings:configure'],
      ['post_amenity_dispatch_plan', 'housekeeping:write'],
      ['post_amenity_dispatch_confirm', 'housekeeping:write'],
      ['get_linen_movements', 'housekeeping:read'],
      ['get_minibar_reconciliation', 'housekeeping:read'],
      ['get_amenities', 'housekeeping:read'],
      ['get_amenity_dispatches', 'housekeeping:read'],
    ]);

    // The minibar setup validates its products and stock link at write time.
    const put = (value: Json) =>
      call('PUT', `${h.p}/config/domain`, h.actor, {
        key: 'pms.housekeeping.minibar',
        value,
        reason: 'test:validate',
        idempotencyKey: `idem-${crypto.randomUUID()}`,
      });
    expect((await put({ enabled: true, items: [{ productId: 'prod_missing', inventoryItemId: null }] })).status).toBe(422);
    expect((await put({ enabled: true, items: [], extra: true })).status).toBe(422);
    await createStock(h, 'stk_towel', 'Towel', 'towels', 1);
    expect((await put({ enabled: false, items: [] })).status).toBe(200);
    const listed = await call('GET', `${h.p}/config/domain`, h.actor);
    const keys = ((await listed.json()) as { keys: Array<{ key: string; value: unknown }> }).keys;
    expect(keys.find((k) => k.key === 'pms.housekeeping.minibar')?.value).toEqual({ enabled: false, items: [] });

    const columns = await runInDurableObject(h.stub, (_instance, state) => {
      const out: Record<string, string[]> = {};
      for (const table of [
        'housekeeping_minibar_pickup',
        'housekeeping_minibar_pickup_line',
        'housekeeping_amenity',
        'housekeeping_amenity_rule',
        'housekeeping_amenity_dispatch',
      ]) {
        out[table] = (state.storage.sql.exec(`PRAGMA table_info(${table})`).toArray() as Array<{ name: string }>).map(
          (c) => c.name,
        );
      }
      return out;
    });
    for (const [table, names] of Object.entries(columns)) {
      expect(names.length, table).toBeGreaterThan(4);
      for (const name of names) {
        expect(name, `${table}.${name}`).not.toMatch(/guest_name|display_name|email|phone|passport|document_no/);
      }
    }
  });
});
