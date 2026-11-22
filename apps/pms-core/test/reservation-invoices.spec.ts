import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { PropertyDO } from '../src/property-do.js';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers';
import {
  createGuest,
  idemFor,
  orgStub,
  provisionedPropertyStub,
  seedBarRatesForHorizon,
  TEST_OWNER_ACTOR,
} from './guest-helpers';

const HTTP_ACTOR = 'user_owner';

async function hotelWithStay(name: string, orgId: string | undefined, reservationId: string, roomId: string) {
  const { stub, orgId: resolvedOrg } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
  const org = orgStub(resolvedOrg);
  await org.ensureMetaOrgId(resolvedOrg);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  await insertProperty(env, {
    propertyId: name,
    orgId: resolvedOrg,
    name: `Hotel ${name}`,
    jurisdiction: null,
    timeZone: 'UTC',
  });
  const roomTypeInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 4,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const added = await stub.tryAddRoomType(
    TEST_OWNER_ACTOR,
    roomTypeInput,
    await idemFor(`add-${name}`, roomTypeInput),
  );
  if (!added.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
  const room = { roomId: roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    arrivalDate: added.fromDate,
    departureDate: addCalendarDays(added.fromDate, 1),
  };
  const made = await stub.tryCreateReservation(
    TEST_OWNER_ACTOR,
    create,
    await idemFor(`c-${reservationId}`, create),
  );
  if (!made.ok) throw new Error(JSON.stringify(made));
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.flushOutbox();
  return { stub: stub as DurableObjectStub<PropertyDO>, propertyId: name, orgId: resolvedOrg };
}

function postInvoice(propertyId: string, reservationId: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
      body: JSON.stringify({ idempotencyKey: `idem-inv-${crypto.randomUUID()}`, reservationId }),
    }),
    env,
  );
}

function voidInvoice(propertyId: string, invoiceId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
        body: JSON.stringify({ idempotencyKey: `idem-void-${crypto.randomUUID()}`, reason: 'Wrong buyer' }),
      },
    ),
    env,
  );
}

function listInvoices(propertyId: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/invoices`,
      { headers: { 'x-dev-actor': HTTP_ACTOR } },
    ),
    env,
  );
}

type Listed = {
  ok: boolean;
  invoices: Array<{
    invoiceId: string;
    invoiceNumber: string;
    folioWindowId: string;
    generatedAt: number;
    voidedAt: number | null;
  }>;
};

describe('get_reservation_invoices', () => {
  it('lists active and voided invoices of the stay, newest first', async () => {
    const hotel = await hotelWithStay('prop_ri_list', undefined, 'res_ri_list', 'rm_ri1');

    const empty = await listInvoices(hotel.propertyId, 'res_ri_list');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true, invoices: [] });

    const first = await postInvoice(hotel.propertyId, 'res_ri_list');
    expect(first.status).toBe(201);
    const { invoiceId: firstId } = (await first.json()) as { invoiceId: string };
    expect((await voidInvoice(hotel.propertyId, firstId)).status).toBe(200);
    const second = await postInvoice(hotel.propertyId, 'res_ri_list');
    expect(second.status).toBe(201);
    const { invoiceId: secondId } = (await second.json()) as { invoiceId: string };

    const res = await listInvoices(hotel.propertyId, 'res_ri_list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Listed;
    expect(body.ok).toBe(true);
    expect(body.invoices.map((i) => i.invoiceId)).toEqual([secondId, firstId]);
    expect(body.invoices[0]).toMatchObject({
      folioWindowId: 'res_ri_list:GUEST',
      voidedAt: null,
    });
    expect(typeof body.invoices[0]?.invoiceNumber).toBe('string');
    expect(typeof body.invoices[0]?.generatedAt).toBe('number');
    expect(typeof body.invoices[1]?.voidedAt).toBe('number');
    expect(Object.keys(body.invoices[0]!).sort()).toEqual([
      'folioWindowId',
      'generatedAt',
      'invoiceId',
      'invoiceNumber',
      'voidedAt',
    ]);
  });

  it('answers 404 for a reservation this property does not have', async () => {
    const hotel = await hotelWithStay('prop_ri_404', undefined, 'res_ri_404', 'rm_ri2');
    const res = await listInvoices(hotel.propertyId, 'res_missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('does not list a sibling property\'s stay invoices (two properties, one org)', async () => {
    const a = await hotelWithStay('prop_ri_a', undefined, 'res_ri_a', 'rm_ria');
    const b = await hotelWithStay('prop_ri_b', a.orgId, 'res_ri_b', 'rm_rib');
    const issued = await postInvoice(b.propertyId, 'res_ri_b');
    expect(issued.status).toBe(201);
    const { invoiceId } = (await issued.json()) as { invoiceId: string };

    const own = await listInvoices(b.propertyId, 'res_ri_b');
    expect(((await own.json()) as Listed).invoices.map((i) => i.invoiceId)).toEqual([invoiceId]);

    const cross = await listInvoices(a.propertyId, 'res_ri_b');
    expect(cross.status).toBe(404);
    const text = await cross.text();
    expect(JSON.parse(text)).toEqual({ error: 'not_found' });
    expect(text).not.toContain(invoiceId);
    expect(text).not.toContain('prop_ri_b');
  });

  it('invoice_already_exists names the same property\'s existing invoice', async () => {
    const hotel = await hotelWithStay('prop_ri_409', undefined, 'res_ri_409', 'rm_ri4');
    const first = await postInvoice(hotel.propertyId, 'res_ri_409');
    expect(first.status).toBe(201);
    const { invoiceId } = (await first.json()) as { invoiceId: string };

    const again = await postInvoice(hotel.propertyId, 'res_ri_409');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      ok: false,
      error: 'invoice_already_exists',
      invoiceId,
    });
  });
});
