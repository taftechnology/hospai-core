import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  commandFingerprint,
  gstinWithCheckDigit,
  INVALID_GSTIN,
  ROLE_GRANTS,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { OrgDO } from '../src/org-do.js';
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

const GSTIN = gstinWithCheckDigit('27AAPFU0939F1Z');
const HTTP_ACTOR = 'user_owner';

async function provisionedPropertyWithGuest(name: string, orgId?: string) {
  const { stub, orgId: resolvedOrg } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
  const org = orgStub(resolvedOrg);
  await org.ensureMetaOrgId(resolvedOrg);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef, propertyId: name, orgId: resolvedOrg, org };
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string) {
  const input = { roomTypeId, code: 'KING', name: 'King Room', roomCount: 4, maxOccupancy: 2, maxAdults: 2 };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, roomTypeId, result.fromDate);
  return result.fromDate;
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
  const create = { reservationId, roomTypeId: 'rt_king', guestRef, arrivalDate: arrival, departureDate: departure };
  const createdReservation = await stub.tryCreateReservation(
    TEST_OWNER_ACTOR,
    create,
    await idemFor(`c-${reservationId}`, create),
  );
  if (!createdReservation.ok) throw new Error(JSON.stringify(createdReservation));
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.flushOutbox();
}

async function postInvoice(propertyId: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
      body: JSON.stringify({ idempotencyKey: `idem-inv-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function patchGuest(propertyId: string, guestId: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
        body: JSON.stringify({
          displayName: 'Test Guest',
          idempotencyKey: `idem-gst-${crypto.randomUUID()}`,
          ...body,
        }),
      },
    ),
    env,
  );
}

async function getGuest(propertyId: string, guestId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      { headers: { 'x-dev-actor': HTTP_ACTOR } },
    ),
    env,
  );
}

async function bookedHotel(name: string, reservationId: string, roomId: string) {
  const ctx = await provisionedPropertyWithGuest(name);
  await insertProperty(env, {
    propertyId: ctx.propertyId,
    orgId: ctx.orgId,
    name: 'GST Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
  const arrival = await addRoomType(ctx.stub, 'rt_king');
  const departure = addCalendarDays(arrival, 1);
  await stayCheckedIn(ctx.stub, ctx.guestRef, reservationId, roomId, arrival, departure);
  return { ...ctx, arrival, departure };
}

describe('buyer GST', () => {
  it('stores a registered buyer in plaintext and leaves an individual out of the snapshot', async () => {
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest('prop_gst_reg');
    await insertProperty(env, { propertyId, orgId, name: 'GST Hotel', jurisdiction: null, timeZone: 'UTC' });
    const arrival = await addRoomType(stub, 'rt_king');
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_gst', 'rm_101', arrival, departure);

    const registered = await postInvoice(propertyId, {
      reservationId: 'res_gst',
      buyer: {
        type: 'REGISTERED',
        fields: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' },
      },
    });
    expect(registered.status).toBe(201);
    const created = (await registered.json()) as { invoiceId: string };
    const got = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(created.invoiceId)}`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    const body = (await got.json()) as { snapshot: { schemaVersion: number; buyer: { party: string; fields: { legalName: string } } } };
    expect(body.snapshot.schemaVersion).toBe(2);
    expect(body.snapshot.buyer.party).toBe('BUSINESS');
    expect((body.snapshot.buyer as { legalName?: string }).legalName).toBe('Harbour Hotels');

    await stub.tryVoidInvoice(
      TEST_OWNER_ACTOR,
      { invoiceId: created.invoiceId, reason: 'test-void' },
      await idemFor('void-gst', { invoiceId: created.invoiceId, reason: 'test-void' }),
    );
    const individual = await postInvoice(propertyId, {
      reservationId: 'res_gst',
      buyer: { type: 'UNREGISTERED', fields: { legalName: 'Private Person', address: '1 Lane' } },
    });
    expect(individual.status).toBe(201);
    const createdIndividual = (await individual.json()) as { invoiceId: string };
    const hidden = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(createdIndividual.invoiceId)}`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    const hiddenBody = (await hidden.json()) as {
      snapshot: { buyer: { party?: string; fields?: unknown; buyerSnapshotId?: string } };
    };
    expect(hiddenBody.snapshot.buyer.party).toBe('INDIVIDUAL');
    expect(hiddenBody.snapshot.buyer.fields).toBeUndefined();
    expect(JSON.stringify(hiddenBody.snapshot)).not.toContain('Private Person');
    const buyer = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/invoices/${encodeURIComponent(createdIndividual.invoiceId)}/buyer`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    expect(buyer.status).toBe(200);
    const buyerBody = (await buyer.json()) as { buyer: { fields: { legalName: string } } };
    expect(buyerBody.buyer.fields.legalName).toBe('Private Person');
  });

  it('rejects a bad GSTIN and fingerprints the object the invoice command receives', async () => {
    const { stub, guestRef, propertyId, orgId } = await provisionedPropertyWithGuest('prop_gst_fp');
    await insertProperty(env, { propertyId, orgId, name: 'GST Hotel', jurisdiction: null, timeZone: 'UTC' });
    const arrival = await addRoomType(stub, 'rt_king');
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_fp', 'rm_102', arrival, departure);

    const bad = await postInvoice(propertyId, {
      reservationId: 'res_fp',
      buyer: {
        type: 'REGISTERED',
        fields: {
          gstin: `${GSTIN.slice(0, -1)}${GSTIN.endsWith('A') ? 'B' : 'A'}`,
          legalName: 'Bad',
          stateCode: '27',
        },
      },
    });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ok: false, error: INVALID_GSTIN });

    const seen: unknown[] = [];
    const original = PropertyDO.prototype.tryGenerateInvoice;
    PropertyDO.prototype.tryGenerateInvoice = async function (actor, input, idem) {
      seen.push(input);
      return original.call(this, actor, input, idem);
    };
    try {
      const ok = await postInvoice(propertyId, { reservationId: 'res_fp' });
      expect(ok.status).toBe(201);
      expect(seen[0]).toEqual({ reservationId: 'res_fp', folioWindowId: 'res_fp:GUEST' });
      expect(await commandFingerprint('invoice.generate', seen[0])).toEqual(expect.any(String));
    } finally {
      PropertyDO.prototype.tryGenerateInvoice = original;
    }
  });

  it('keeps an issued buyer when the company account changes, and isolates the other property', async () => {
    const orgId = `org_gst_${crypto.randomUUID().slice(0, 8)}`;
    const a = await provisionedPropertyWithGuest('prop_gst_a', orgId);
    const b = await provisionedPropertyWithGuest('prop_gst_b', orgId);
    await insertProperty(env, { propertyId: a.propertyId, orgId, name: 'A', jurisdiction: null, timeZone: 'UTC' });
    await insertProperty(env, { propertyId: b.propertyId, orgId, name: 'B', jurisdiction: null, timeZone: 'UTC' });
    const arrival = await addRoomType(a.stub, 'rt_king');
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(a.stub, a.guestRef, 'res_a', 'rm_201', arrival, departure);
    const account = await a.stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      {
        name: 'Harbour',
        gst: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' },
      },
      await idemFor('cla-harbour', {
        commandId: 'city_ledger.create_account',
        payload: { name: 'Harbour', gst: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' } },
      }),
    );
    expect(account.ok).toBe(true);
    const opened = await a.stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_a', kind: 'COMPANY', billedParty: 'Harbour' },
      await idemFor('win-harbour', { reservationId: 'res_a', kind: 'COMPANY', billedParty: 'Harbour' }),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const generated = await a.stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_a', folioWindowId: opened.folioWindowId, generatedBy: 'checkout' },
      await idemFor('inv-co', { reservationId: 'res_a' }),
    );
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const index = await a.stub.readInvoiceIndex(generated.invoiceId);
    expect(index?.buyerGstin).toBe(GSTIN);
    await a.stub.tryUpdateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { accountId: account.ok ? account.accountId : '', gst: null },
      await idemFor('cla-clear', { gst: null }),
    );
    expect((await a.stub.readInvoiceIndex(generated.invoiceId))?.buyerGstin).toBe(GSTIN);
    const foreign = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(b.propertyId)}/invoices/${encodeURIComponent(generated.invoiceId)}/buyer`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    expect(foreign.status).toBe(404);
    const text = await foreign.text();
    expect(text).not.toContain(a.propertyId);
    expect(text).not.toContain(GSTIN);
  });

  it('retains an individual snapshot after guest blob clear and drops it on org purge', async () => {
    const { org, propertyId, guestRef, orgId } = await provisionedPropertyWithGuest('prop_gst_purge');
    const sealed = await org.sealInvoiceBuyerSnapshot(TEST_OWNER_ACTOR, {
      id: 'snap_keep',
      propertyId,
      guestRef,
      fields: { legalName: 'Kept Person' },
      createdBy: 'user_owner',
    });
    expect(sealed.ok).toBe(true);
    expect(await org.countInvoiceBuyerSnapshotsForGuest(guestRef)).toBe(1);
    await org.clearGuestProfileBlobs(guestRef);
    const still = await org.readInvoiceBuyerSnapshot(TEST_OWNER_ACTOR, { id: 'snap_keep', propertyId });
    expect(still.ok).toBe(true);
    if (still.ok) expect(still.fields.legalName).toBe('Kept Person');
    const other = await org.readInvoiceBuyerSnapshot(TEST_OWNER_ACTOR, { id: 'snap_keep', propertyId: 'prop_other' });
    expect(other).toMatchObject({ ok: false, error: 'not_found' });
    await org.resetLaneGuardForTest();
    const purged = await org.purgeStorageForTenant();
    expect(purged.ok).toBe(true);
    if (purged.ok) expect(purged.deletedApprox).toBeGreaterThan(0);
  });

  it('freezes HSN from the tax group onto the snapshot line', async () => {
    const { stub, guestRef } = await provisionedPropertyWithGuest('prop_gst_hsn');
    const arrival = await addRoomType(stub, 'rt_king');
    const departure = addCalendarDays(arrival, 1);
    await stayCheckedIn(stub, guestRef, 'res_hsn', 'rm_301', arrival, departure);
    await stub.writeConfigValueForTest('pms.tax.classification', { ROOM: '996311' });
    await stub.writeConfigValueForTest('pms.invoice.allow_pending', true);
    const parent = 'line_room';
    await stub.insertFolioLineRawForTest({
      folioLineId: parent,
      folioWindowId: 'res_hsn:GUEST',
      reservationId: 'res_hsn',
      chargeCode: 'ROOM',
      amountMinor: 10000,
      source: 'ROOM',
      businessDate: arrival,
    });
    await stub.insertFolioLineRawForTest({
      folioLineId: 'line_tax',
      folioWindowId: 'res_hsn:GUEST',
      reservationId: 'res_hsn',
      chargeCode: 'TAX',
      amountMinor: 1200,
      source: 'TAX',
      businessDate: arrival,
      taxOf: parent,
    });
    const generated = await stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_hsn', folioWindowId: 'res_hsn:GUEST' },
      await idemFor('inv-hsn', { reservationId: 'res_hsn' }),
    );
    if (!generated.ok) throw new Error(JSON.stringify(generated));
    const bucket = env.EVENT_LOG_R2;
    if (!bucket) throw new Error('EVENT_LOG_R2 unbound');
    const stored = await bucket.get(`invoices/prop_gst_hsn/${generated.invoiceNumber}.json`);
    const snapshot = JSON.parse(await stored!.text()) as { lines: Array<{ folioLineId: string; hsnSac: string | null }> };
    expect(snapshot.lines.find((line) => line.folioLineId === parent)?.hsnSac).toBe('996311');
    expect(snapshot.lines.find((line) => line.folioLineId === 'line_tax')?.hsnSac).toBe('996311');
  });

  it('round-trips guest gstBuyer, clears it, refuses a bad GSTIN, and hides it from the other hotel', async () => {
    const orgId = `org_gst_guest_${crypto.randomUUID().slice(0, 8)}`;
    const a = await provisionedPropertyWithGuest('prop_gst_guest_a', orgId);
    const b = await provisionedPropertyWithGuest('prop_gst_guest_b', orgId);
    await insertProperty(env, { propertyId: a.propertyId, orgId, name: 'A', jurisdiction: null, timeZone: 'UTC' });
    await insertProperty(env, { propertyId: b.propertyId, orgId, name: 'B', jurisdiction: null, timeZone: 'UTC' });

    const saved = await patchGuest(a.propertyId, a.guestRef, {
      gstBuyer: { gstin: GSTIN, legalName: 'Harbour Hotels', tradeName: 'Harbour', stateCode: '27' },
    });
    expect(saved.status).toBe(200);
    const got = await getGuest(a.propertyId, a.guestRef);
    expect(got.status).toBe(200);
    const profile = (await got.json()) as { profile: { gstBuyer?: { legalName?: string; gstin?: string } } };
    expect(profile.profile.gstBuyer).toMatchObject({ gstin: GSTIN, legalName: 'Harbour Hotels', tradeName: 'Harbour' });

    const cleared = await patchGuest(a.propertyId, a.guestRef, { gstBuyer: null });
    expect(cleared.status).toBe(200);
    const afterClear = (await (await getGuest(a.propertyId, a.guestRef)).json()) as {
      profile: { gstBuyer?: unknown };
    };
    expect(afterClear.profile.gstBuyer).toBeUndefined();

    const bad = await patchGuest(a.propertyId, a.guestRef, {
      gstBuyer: { gstin: `${GSTIN.slice(0, -1)}A`, legalName: 'Bad' },
    });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ok: false, error: INVALID_GSTIN });

    const onlyB = `guest_only_b_${crypto.randomUUID().slice(0, 8)}`;
    await createGuest(b.org, b.propertyId, onlyB, 'Only B');
    const onB = await patchGuest(b.propertyId, onlyB, {
      displayName: 'Only B',
      gstBuyer: { gstin: GSTIN, legalName: 'Only B Hotels', stateCode: '27' },
    });
    expect(onB.status).toBe(200);
    const foreign = await getGuest(a.propertyId, onlyB);
    expect(foreign.status).toBe(404);
    const foreignBody = await foreign.json();
    expect(foreignBody).toMatchObject({ ok: false, error: 'guest_not_found' });
    expect(JSON.stringify(foreignBody)).not.toContain(GSTIN);
    expect(JSON.stringify(foreignBody)).not.toContain('Only B Hotels');
  });

  it('keeps an issued individual snapshot when the guest gstBuyer changes later', async () => {
    const hotel = await bookedHotel('prop_gst_freeze', 'res_freeze', 'rm_401');
    const issued = await postInvoice(hotel.propertyId, {
      reservationId: 'res_freeze',
      buyer: { type: 'UNREGISTERED', fields: { legalName: 'Private Person', address: '1 Lane' } },
    });
    expect(issued.status).toBe(201);
    const { invoiceId } = (await issued.json()) as { invoiceId: string };
    const before = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/invoices/${encodeURIComponent(invoiceId)}/buyer`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      buyer: { fields: { legalName: 'Private Person', address: '1 Lane' } },
    });

    const edited = await patchGuest(hotel.propertyId, hotel.guestRef, {
      gstBuyer: { legalName: 'Changed Person', address: '9 Road' },
    });
    expect(edited.status).toBe(200);
    const after = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/invoices/${encodeURIComponent(invoiceId)}/buyer`,
        { headers: { 'x-dev-actor': HTTP_ACTOR } },
      ),
      env,
    );
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as { buyer: { fields: { legalName: string; address?: string } } };
    expect(afterBody.buyer.fields.legalName).toBe('Private Person');
    expect(afterBody.buyer.fields.address).toBe('1 Lane');
    expect(JSON.stringify(afterBody)).not.toContain('Changed Person');
  });

  it('refuses a registered buyer without a GSTIN or with a mismatched state, and the trigger blocks a null GSTIN', async () => {
    const hotel = await bookedHotel('prop_gst_val', 'res_val', 'rm_402');
    const missing = await postInvoice(hotel.propertyId, {
      reservationId: 'res_val',
      buyer: { type: 'REGISTERED', fields: { legalName: 'No GSTIN', stateCode: '27' } },
    });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ ok: false, error: 'buyer_gstin_required' });

    const mismatch = await postInvoice(hotel.propertyId, {
      reservationId: 'res_val',
      buyer: { type: 'REGISTERED', fields: { gstin: GSTIN, legalName: 'Wrong State', stateCode: '29' } },
    });
    expect(mismatch.status).toBe(422);
    expect(await mismatch.json()).toMatchObject({ ok: false, error: 'buyer_state_code_mismatch' });
    expect(await hotel.stub.countRegisteredInvoicesMissingGstinForTest()).toBe(0);

    await expect(
      hotel.stub.execSqlForTest(
        `INSERT INTO invoice (
           invoice_id, invoice_number, reservation_id, folio_window_id, r2_key, sha256,
           generated_at, generated_by, buyer_type, buyer_gstin
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REGISTERED', NULL)`,
        'inv_bad_gstin',
        'INV-BAD-GSTIN',
        'res_val',
        'res_val:GUEST',
        'invoices/bad',
        'abc',
        1,
        'test',
      ),
    ).rejects.toThrow(/buyer_gstin_required/);
    expect(await hotel.stub.countRegisteredInvoicesMissingGstinForTest()).toBe(0);
  });

  it('conflicts when the same invoice key carries a different buyer and replays when it matches', async () => {
    const hotel = await bookedHotel('prop_gst_idem', 'res_idem', 'rm_403');
    const key = `idem-buyer-${crypto.randomUUID()}`;
    const buyer = { type: 'REGISTERED', fields: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' } };
    const first = await postInvoice(hotel.propertyId, { idempotencyKey: key, reservationId: 'res_idem', buyer });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { invoiceId: string };

    const other = await postInvoice(hotel.propertyId, {
      idempotencyKey: key,
      reservationId: 'res_idem',
      buyer: { type: 'REGISTERED', fields: { gstin: GSTIN, legalName: 'Other Hotels', stateCode: '27' } },
    });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ ok: false, error: 'idempotency_key_reused' });

    const replay = await postInvoice(hotel.propertyId, { idempotencyKey: key, reservationId: 'res_idem', buyer });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ invoiceId: created.invoiceId });
  });

  it('checkout auto-invoice registers a company GSTIN and leaves a guest window without a buyer', async () => {
    const hotel = await bookedHotel('prop_gst_co', 'res_co', 'rm_404');
    const account = await hotel.stub.tryCreateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      { name: 'Harbour', gst: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' } },
      await idemFor('cla-co', {
        commandId: 'city_ledger.create_account',
        payload: { name: 'Harbour', gst: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' } },
      }),
    );
    expect(account.ok).toBe(true);
    const opened = await hotel.stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_co', kind: 'COMPANY', billedParty: 'Harbour' },
      await idemFor('win-co', { reservationId: 'res_co', kind: 'COMPANY', billedParty: 'Harbour' }),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const company = await hotel.stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_co', folioWindowId: opened.folioWindowId, generatedBy: 'checkout' },
      await idemFor('inv-co-co', { reservationId: 'res_co', folioWindowId: opened.folioWindowId }),
    );
    expect(company.ok).toBe(true);
    if (!company.ok) return;
    expect(await hotel.stub.readInvoiceIndex(company.invoiceId)).toMatchObject({
      buyerType: 'REGISTERED',
      buyerGstin: GSTIN,
    });

    const guest = await hotel.stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_co', folioWindowId: 'res_co:GUEST', generatedBy: 'checkout' },
      await idemFor('inv-co-guest', { reservationId: 'res_co', folioWindowId: 'res_co:GUEST' }),
    );
    expect(guest.ok).toBe(true);
    if (!guest.ok) return;
    const guestIndex = await hotel.stub.readInvoiceIndex(guest.invoiceId);
    expect(guestIndex?.buyerType).toBeNull();
    expect(guestIndex?.buyerGstin).toBeNull();
  });

  it('does not rewrite issued HSN when the classification map changes', async () => {
    const hotel = await bookedHotel('prop_gst_cls2', 'res_cls', 'rm_405');
    await hotel.stub.writeConfigValueForTest('pms.tax.classification', { ROOM: '996311' });
    await hotel.stub.writeConfigValueForTest('pms.invoice.allow_pending', true);
    await hotel.stub.insertFolioLineRawForTest({
      folioLineId: 'line_room_cls',
      folioWindowId: 'res_cls:GUEST',
      reservationId: 'res_cls',
      chargeCode: 'ROOM',
      amountMinor: 10000,
      source: 'ROOM',
      businessDate: hotel.arrival,
    });
    const generated = await hotel.stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      { reservationId: 'res_cls', folioWindowId: 'res_cls:GUEST' },
      await idemFor('inv-cls', { reservationId: 'res_cls' }),
    );
    if (!generated.ok) throw new Error(JSON.stringify(generated));
    await hotel.stub.writeConfigValueForTest('pms.tax.classification', { ROOM: '996312' });
    const bucket = env.EVENT_LOG_R2;
    if (!bucket) throw new Error('EVENT_LOG_R2 unbound');
    const stored = await bucket.get(`invoices/prop_gst_cls2/${generated.invoiceNumber}.json`);
    const snapshot = JSON.parse(await stored!.text()) as { lines: Array<{ folioLineId: string; hsnSac: string | null }> };
    expect(snapshot.lines.find((line) => line.folioLineId === 'line_room_cls')?.hsnSac).toBe('996311');
  });

  it('conflicts when the same city-ledger key is reused with different GST details', async () => {
    const hotel = await bookedHotel('prop_gst_cla', 'res_cla', 'rm_406');
    const key = `idem-cla-${crypto.randomUUID()}`;
    const first = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/city-ledger/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
        body: JSON.stringify({
          idempotencyKey: key,
          name: 'Harbour',
          gst: { gstin: GSTIN, legalName: 'Harbour Hotels', stateCode: '27' },
        }),
      }),
      env,
    );
    expect(first.status).toBe(201);
    const reused = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/city-ledger/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': HTTP_ACTOR },
        body: JSON.stringify({
          idempotencyKey: key,
          name: 'Harbour',
          gst: { gstin: GSTIN, legalName: 'Other Hotels', stateCode: '27' },
        }),
      }),
      env,
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
  });

  it('omits buyer fields from the invoice.generated outbox payload', async () => {
    const hotel = await bookedHotel('prop_gst_bus', 'res_bus', 'rm_407');
    await hotel.stub.flushOutbox();
    const generated = await hotel.stub.tryGenerateInvoice(
      TEST_OWNER_ACTOR,
      {
        reservationId: 'res_bus',
        folioWindowId: 'res_bus:GUEST',
        buyer: {
          type: 'REGISTERED',
          party: 'BUSINESS',
          fields: { gstin: GSTIN, legalName: 'Harbour Hotels', address: '1 Wharf', stateCode: '27' },
        },
      },
      await idemFor('inv-bus', { reservationId: 'res_bus' }),
    );
    if (!generated.ok) throw new Error(JSON.stringify(generated));
    const flushed = await hotel.stub.flushOutbox();
    const row = flushed.rows.find((event) => event.eventType === 'invoice.generated');
    expect(row).toBeTruthy();
    const payload = JSON.parse(row!.payload) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('buyer');
    expect(payload).not.toHaveProperty('gstin');
    expect(payload).not.toHaveProperty('legalName');
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('tradeName');
    const text = JSON.stringify(payload);
    expect(text).not.toContain(GSTIN);
    expect(text).not.toContain('Harbour Hotels');
    expect(text).not.toContain('1 Wharf');
  });

  it('returns 403 for get_invoice_buyer without folio:read and does not read OrgDO', async () => {
    const hotel = await bookedHotel('prop_gst_deny', 'res_deny', 'rm_408');
    const issued = await postInvoice(hotel.propertyId, {
      reservationId: 'res_deny',
      buyer: { type: 'UNREGISTERED', fields: { legalName: 'Hidden Person', address: '2 Lane' } },
    });
    expect(issued.status).toBe(201);
    const { invoiceId } = (await issued.json()) as { invoiceId: string };

    const reads: unknown[] = [];
    const original = OrgDO.prototype.readInvoiceBuyerSnapshot;
    OrgDO.prototype.readInvoiceBuyerSnapshot = async function (this: OrgDO, ...args) {
      reads.push(args[1]);
      return original.apply(this, args);
    };
    const staffId = `user_no_folio_read_${crypto.randomUUID()}`;
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const folioRead = grants.indexOf('folio:read');
    expect(folioRead).toBeGreaterThanOrEqual(0);
    grants.splice(folioRead, 1);
    try {
      await hotel.org.ensureMember(staffId, 'staff');
      const denied = await worker.fetch(
        new Request(
          `http://localhost/v1/properties/${encodeURIComponent(hotel.propertyId)}/invoices/${encodeURIComponent(invoiceId)}/buyer`,
          { headers: { 'x-dev-actor': staffId } },
        ),
        env,
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'folio:read' });
      expect(reads).toEqual([]);
    } finally {
      grants.splice(folioRead, 0, 'folio:read');
      OrgDO.prototype.readInvoiceBuyerSnapshot = original;
    }
  });

  it('denies an OrgDO buyer read without folio:read and a seal without folio:post', async () => {
    const { org, propertyId } = await provisionedPropertyWithGuest('prop_gst_do_gate');
    const staffId = `user_gst_gate_${crypto.randomUUID()}`;
    await org.ensureMember(staffId, 'staff');
    const actor = { kind: 'user' as const, userId: staffId };
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const folioRead = grants.indexOf('folio:read');
    const folioPost = grants.indexOf('folio:post');
    grants.splice(folioRead, 1);
    try {
      const opened = await org.readInvoiceBuyerSnapshot(actor, { id: 'missing_snap', propertyId });
      expect(opened).toEqual({ ok: false, error: 'forbidden' });
    } finally {
      grants.splice(folioRead, 0, 'folio:read');
    }
    grants.splice(folioPost, 1);
    try {
      const sealed = await org.sealInvoiceBuyerSnapshot(actor, {
        id: 'snap_denied',
        propertyId,
        fields: { legalName: 'Should Not Seal' },
        createdBy: staffId,
      });
      expect(sealed).toEqual({ ok: false, error: 'forbidden' });
      expect(await org.countInvoiceBuyerSnapshots()).toBe(0);
    } finally {
      grants.splice(folioPost, 0, 'folio:post');
    }
  });
});
