import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  FOLIO_BALANCE_DUE,
  INVOICE_ALREADY_EXISTS,
  INVOICE_R2_UNBOUND,
  INVOICE_VOIDED,
} from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
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

async function sha256HexFromBody(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function provisionedPropertyWithGuest(
  name: string,
): Promise<{
  stub: DurableObjectStub<PropertyDO>;
  guestRef: string;
  propertyId: string;
  orgId: string;
}> {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef, propertyId: name, orgId };
}

async function registerPropertyForHttp(propertyId: string, orgId: string): Promise<void> {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'Invoice Test Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result;
}

async function stayCheckedIn(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  departure: string,
) {
  const room = { roomId, roomTypeId: 'rt_king', code: roomId.replace('rm_', '') };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.flushOutbox();
}

async function writeConfigValueForTest(
  stub: DurableObjectStub<PropertyDO>,
  key: string,
  value: unknown,
): Promise<void> {
  await stub.writeConfigValueForTest(key, value);
}

const HTTP_ACTOR = TEST_OWNER_ACTOR.userId;

async function postInvoice(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-inv-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getInvoiceHttp(propertyId: string, actor: string, invoiceId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(invoiceId)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function postInvoiceVoid(
  propertyId: string,
  actor: string,
  invoiceId: string,
  body?: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-void-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

describe('invoice generation DO engine', () => {
  it('case 1: manual generate — index row + R2 object; sha256 matches body', async () => {
    const name = `inv-1-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_inv1', 'rm_inv1', arrival, departure);
    const reservationId = 'res_inv1';
    const guestWindowId = `${reservationId}:GUEST`;
    const gen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId, generatedBy: 'desk' },
      await idemFor('gen1', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(gen).toMatchObject({ ok: true });
    if (!gen.ok) return;
    const obj = await env.EVENT_LOG_R2!.get(gen.r2Key);
    expect(obj).toBeTruthy();
    const body = new Uint8Array(await obj!.arrayBuffer());
    const digest = await sha256HexFromBody(body);
    expect(gen.sha256).toBe(digest);
    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.some((r) => r.invoiceId === gen.invoiceId && r.voidedAt == null)).toBe(true);
  });

  it('case 2: duplicate active window → INVOICE_ALREADY_EXISTS', async () => {
    const name = `inv-2-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv2', 'rm_inv2', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv2';
    const guestWindowId = `${reservationId}:GUEST`;
    const fp = { reservationId, folioWindowId: guestWindowId };
    expect(
      await stub.tryGenerateInvoice(
        TEST_OWNER_ACTOR,
        { reservationId, folioWindowId: guestWindowId },
        await idemFor('gen2a', fp),
      ),
    ).toMatchObject({ ok: true });
    const dup = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen2b', fp),
    );
    expect(dup).toMatchObject({ ok: false, error: INVOICE_ALREADY_EXISTS });
  });

  it('case 3: idempotent replay same key → same invoiceId; counter not bumped twice', async () => {
    const name = `inv-3-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv3', 'rm_inv3', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv3';
    const guestWindowId = `${reservationId}:GUEST`;
    const fp = { reservationId, folioWindowId: guestWindowId };
    const idem = await idemFor('gen3', fp);
    const first = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      idem,
    );
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    const replay = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      idem,
    );
    expect(replay).toMatchObject({ ok: true, invoiceId: first.invoiceId, invoiceNumber: first.invoiceNumber });
    await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: first.invoiceId },
      await idemFor('void3', { invoiceId: first.invoiceId }),
    );
    const afterVoid = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen3b', fp),
    );
    expect(afterVoid).toMatchObject({ ok: true, invoiceNumber: 'INV-000002' });
  });

  it('case 4: balance due + allow_pending false → FOLIO_BALANCE_DUE', async () => {
    const name = `inv-4-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv4', 'rm_inv4', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv4';
    const line = {
      folioLineId: 'fl_inv4',
      reservationId,
      chargeCode: 'MISC',
      amountMinor: 2500,
    };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('fl4', line))).toMatchObject({
      ok: true,
    });
    const guestWindowId = `${reservationId}:GUEST`;
    const result = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen4', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(result).toMatchObject({ ok: false, error: FOLIO_BALANCE_DUE });
  });

  it('case 5: void sets voided_at; second void → INVOICE_VOIDED', async () => {
    const name = `inv-5-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv5', 'rm_inv5', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv5';
    const guestWindowId = `${reservationId}:GUEST`;
    const gen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen5', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(gen).toMatchObject({ ok: true });
    if (!gen.ok) return;
    const voided = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: gen.invoiceId },
      await idemFor('void5', { invoiceId: gen.invoiceId }),
    );
    expect(voided).toMatchObject({ ok: true });
    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.find((r) => r.invoiceId === gen.invoiceId)?.voidedAt).not.toBeNull();
    const again = await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: gen.invoiceId },
      await idemFor('void5b', { invoiceId: gen.invoiceId }),
    );
    expect(again).toMatchObject({ ok: false, error: INVOICE_VOIDED });
  });

  it('case 6: after void, new generate → new invoice_number (monotonic)', async () => {
    const name = `inv-6-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv6', 'rm_inv6', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv6';
    const guestWindowId = `${reservationId}:GUEST`;
    const fp = { reservationId, folioWindowId: guestWindowId };
    const first = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen6a', fp),
    );
    expect(first).toMatchObject({ ok: true, invoiceNumber: 'INV-000001' });
    if (!first.ok) return;
    await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: first.invoiceId },
      await idemFor('void6', { invoiceId: first.invoiceId }),
    );
    const second = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen6b', fp),
    );
    expect(second).toMatchObject({ ok: true, invoiceNumber: 'INV-000002' });
  });

  it('case 8: unbound R2 → INVOICE_R2_UNBOUND', async () => {
    const name = `inv-8-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv8', 'rm_inv8', added.fromDate, addCalendarDays(added.fromDate, 1));
    await stub.setReportsR2UnboundForTest(true);
    const reservationId = 'res_inv8';
    const guestWindowId = `${reservationId}:GUEST`;
    const result = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen8', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(result).toMatchObject({ ok: false, error: INVOICE_R2_UNBOUND });
  });

  it('case 7: GET returns snapshot from R2; unknown id → 404', async () => {
    const name = `inv-7-${crypto.randomUUID()}`;
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest(name);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv7', 'rm_inv7', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv7';
    const genRes = await postInvoice(propertyId, HTTP_ACTOR, { reservationId });
    expect(genRes.status).toBe(201);
    const genBody = (await genRes.json()) as { ok: true; invoiceId: string; r2Key: string; sha256: string };
    expect(genBody.ok).toBe(true);

    const getRes = await getInvoiceHttp(propertyId, HTTP_ACTOR, genBody.invoiceId);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as {
      invoiceId: string;
      snapshot: { lines: unknown[]; totals: Record<string, unknown> };
      sha256: string;
    };
    expect(got.invoiceId).toBe(genBody.invoiceId);
    expect(Array.isArray(got.snapshot.lines)).toBe(true);
    expect(got.snapshot.totals).toBeTruthy();
    expect(got.sha256).toBe(genBody.sha256);

    const missing = await getInvoiceHttp(propertyId, HTTP_ACTOR, crypto.randomUUID());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'not_found' });
  });

  it('case 11: first invoice honours starting_idx (42 → INV-000042)', async () => {
    const name = `inv-11-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    await writeConfigValueForTest(stub, 'pms.invoice.starting_idx', 42);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_inv11', 'rm_inv11', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_inv11';
    const guestWindowId = `${reservationId}:GUEST`;
    const gen = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId, folioWindowId: guestWindowId },
      await idemFor('gen11', { reservationId, folioWindowId: guestWindowId }),
    );
    expect(gen).toMatchObject({ ok: true, invoiceNumber: 'INV-000042' });
  });
});

describe('invoice generation HTTP wire', () => {
  it('HTTP generate mirrors case 1: index row + R2 object; sha256 matches body', async () => {
    const name = `inv-http-1-${crypto.randomUUID()}`;
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest(name);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_http1', 'rm_http1', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_http1';
    const genRes = await postInvoice(propertyId, HTTP_ACTOR, { reservationId });
    expect(genRes.status).toBe(201);
    const gen = (await genRes.json()) as {
      ok: true;
      invoiceId: string;
      r2Key: string;
      sha256: string;
    };
    expect(gen.ok).toBe(true);
    const obj = await env.EVENT_LOG_R2!.get(gen.r2Key);
    expect(obj).toBeTruthy();
    const body = new Uint8Array(await obj!.arrayBuffer());
    const digest = await sha256HexFromBody(body);
    expect(gen.sha256).toBe(digest);
    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.some((r) => r.invoiceId === gen.invoiceId && r.voidedAt == null)).toBe(true);
  });

  it('HTTP void mirrors case 5: void sets voided_at; second void → INVOICE_VOIDED', async () => {
    const name = `inv-http-5-${crypto.randomUUID()}`;
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest(name);
    await registerPropertyForHttp(propertyId, orgId);
    const added = await addRoomType(stub, 'rt_king', 5);
    await stayCheckedIn(stub, guestRef, 'res_http5', 'rm_http5', added.fromDate, addCalendarDays(added.fromDate, 1));
    const reservationId = 'res_http5';
    const genRes = await postInvoice(propertyId, HTTP_ACTOR, { reservationId });
    expect(genRes.status).toBe(201);
    const gen = (await genRes.json()) as { ok: true; invoiceId: string };
    const voidRes = await postInvoiceVoid(propertyId, HTTP_ACTOR, gen.invoiceId);
    expect(voidRes.status).toBe(200);
    expect(await voidRes.json()).toMatchObject({ ok: true, invoiceId: gen.invoiceId });
    const rows = await stub.readInvoicesForReservation(reservationId);
    expect(rows.find((r) => r.invoiceId === gen.invoiceId)?.voidedAt).not.toBeNull();
    const again = await postInvoiceVoid(propertyId, HTTP_ACTOR, gen.invoiceId);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, error: INVOICE_VOIDED });
  });
});
