import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_REGISTER,
  LINE_NOT_SPLITTABLE,
  TAX_OUTPUT_CODE_TAXABLE,
  TAX_RULE_KEY_EXISTS,
  TAX_RULE_TYPE_UNSUPPORTED,
  fingerprintPayload,
  type PendingCommandMessage,
} from '@hospai/contracts';
import { allocate, computeTax } from '@hospai/money';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';
import { idemFor, seedBarRatesForHorizon } from './fixtures.js';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
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
        name: 'Tax Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

async function postFolioLine(
  propertyId: string,
  actor: string,
  reservationId: string,
  body: { chargeCode: string; amountMinor: number; idempotencyKey: string },
) {
  const folioLineId = `${reservationId}:item:${body.idempotencyKey}`;
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
  return { res, folioLineId };
}

async function postFolioSplit(
  propertyId: string,
  actor: string,
  folioLineId: string,
  body: { splits: Array<{ folioLineId: string; amountMinor: number }>; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(folioLineId)}/split`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postTaxRule(
  propertyId: string,
  actor: string,
  body: {
    taxRuleId: string;
    ruleKey: string;
    name: string;
    ruleType: string;
    rate: string;
    taxGroup: string;
    outputChargeCode: string;
    validFrom: string;
    validTo?: string | null;
    idempotencyKey?: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/tax-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-tr-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function putTaxRuleSupersede(
  propertyId: string,
  actor: string,
  ruleKey: string,
  body: {
    taxRuleId: string;
    name: string;
    ruleType: string;
    rate: string;
    taxGroup: string;
    outputChargeCode: string;
    validFrom: string;
    validTo?: string | null;
    idempotencyKey?: string;
  },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/tax-rules/${encodeURIComponent(ruleKey)}/supersede`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: body.idempotencyKey ?? `idem-sup-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function patchChargeCode(
  propertyId: string,
  actor: string,
  code: string,
  body: { taxGroup?: string | null; name?: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/charge-codes/${encodeURIComponent(code)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          ...body,
          idempotencyKey: body.idempotencyKey ?? `idem-cc-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_tax_${crypto.randomUUID()}`;
  const propertyId = `prop_tax_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Tax Org', owner)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, owner);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Guest', {
    kind: 'user',
    userId: owner,
  });
  return { orgId, propertyId, owner, guestRef: guest.guestRef, arrival, stub: resolved!.stub };
}

async function seedGoodsTaxRule(
  propertyId: string,
  actor: string,
  arrival: string,
  taxRuleId: string,
  ruleKey: string,
  rate: string,
) {
  expect(
    (
      await postTaxRule(propertyId, actor, {
        taxRuleId,
        ruleKey,
        name: 'Goods tax',
        ruleType: 'PERCENTAGE',
        rate,
        taxGroup: 'GOODS',
        outputChargeCode: 'TAX',
        validFrom: arrival,
      })
    ).status,
  ).toBe(201);
}

async function seedRoomTaxRule(
  propertyId: string,
  actor: string,
  arrival: string,
  taxRuleId: string,
  ruleKey: string,
  rate: string,
) {
  expect(
    (
      await postTaxRule(propertyId, actor, {
        taxRuleId,
        ruleKey,
        name: 'Room tax',
        ruleType: 'PERCENTAGE',
        rate,
        taxGroup: 'ROOM',
        outputChargeCode: 'TAX',
        validFrom: arrival,
      })
    ).status,
  ).toBe(201);
}

async function getFolio(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function dispatchPendingBatch(messages: PendingCommandMessage[]): Promise<void> {
  const batch = createMessageBatch(
    'hospai-pending-commands',
    messages.map((body, i) => ({
      id: `pending-${i}-${body.provisional.idempotencyKey}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })),
  );
  await worker.queue(batch, env);
}

describe('tax posting matrix', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: post taxable code stamps charge + tax line', async () => {
    const owner = 'user_tax_1';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_1';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.0825');

    const idemKey1 = `idem-1-${crypto.randomUUID()}`;
    const { res: postRes, folioLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 10_000,
      idempotencyKey: idemKey1,
    });
    expect(postRes.status).toBe(201);

    const lines = await stub.listFolioLinesForReservation(reservationId);
    const taxLine = lines.find((l) => l.source === 'TAX');
    expect(taxLine).toMatchObject({
      chargeCode: 'TAX',
      amountMinor: computeTax(10_000, '0.0825'),
      taxOf: folioLineId,
      taxRuleId: 'tr_v1',
    });

    const folio = await stub.readFolio(reservationId);
    expect(folio.ok).toBe(true);
    if (!folio.ok) return;
    const wireTax = folio.lines.find((l) => l.source === 'TAX');
    expect(wireTax).toBeTruthy();
    expect(wireTax!.taxOf).toBe(folioLineId);
    expect(wireTax!.taxRuleId).toBe('tr_v1');
  });

  it('Test 2: tax_group NULL code posts no tax line', async () => {
    const owner = 'user_tax_2';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_2';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.0825');
    expect(
      (await patchChargeCode(propertyId, owner, 'MISC', { taxGroup: null })).status,
    ).toBe(200);

    const { res: postRes2 } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 5000,
      idempotencyKey: `idem-2-${crypto.randomUUID()}`,
    });
    expect(postRes2.status).toBe(201);

    expect((await stub.listFolioLinesForReservation(reservationId)).some((l) => l.source === 'TAX')).toBe(
      false,
    );
  });

  it('Test 3: stacked rules same group produce two tax lines', async () => {
    const owner = 'user_tax_3';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_3';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    expect(
      (
        await postTaxRule(propertyId, owner, {
          taxRuleId: 'tr_state',
          ruleKey: 'state',
          name: 'State',
          ruleType: 'PERCENTAGE',
          rate: '0.06',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: arrival,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postTaxRule(propertyId, owner, {
          taxRuleId: 'tr_city',
          ruleKey: 'city',
          name: 'City',
          ruleType: 'PERCENTAGE',
          rate: '0.02',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: arrival,
        })
      ).status,
    ).toBe(201);

    const { res: postRes3 } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 10_000,
      idempotencyKey: `idem-3-${crypto.randomUUID()}`,
    });
    expect(postRes3.status).toBe(201);

    const taxLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'TAX',
    );
    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((l) => l.taxRuleId).sort()).toEqual(['tr_city', 'tr_state']);
  });

  it('Test 4: split taxed charge 60/40 allocates parent tax across children', async () => {
    const owner = 'user_tax_4';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_4';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');

    const idemKey4 = `idem-4-${crypto.randomUUID()}`;
    const { res: postRes4, folioLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: idemKey4,
    });
    expect(postRes4.status).toBe(201);

    const parentTax = computeTax(1000, '0.10');
    const childA = `${folioLineId}:a`;
    const childB = `${folioLineId}:b`;
    expect(
      (
        await postFolioSplit(propertyId, owner, folioLineId, {
          splits: [
            { folioLineId: childA, amountMinor: 600 },
            { folioLineId: childB, amountMinor: 400 },
          ],
          idempotencyKey: `idem-split-4-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const taxLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'TAX' && l.amountMinor > 0 && l.splitOf === folioLineId,
    );
    expect(taxLines).toHaveLength(2);
    expect(allocate(parentTax, [600, 400], { policy: 'LAST' })).toEqual([60, 40]);
    const byChild = new Map(taxLines.map((l) => [l.taxOf!, l.amountMinor]));
    expect(byChild.get(childA)).toBe(60);
    expect(byChild.get(childB)).toBe(40);
    expect(taxLines.reduce((s, l) => s + l.amountMinor, 0)).toBe(parentTax);
  });

  it('Test 5: split after rate change uses allocated stamped tax not new rate', async () => {
    const owner = 'user_tax_5';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_5';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const idemKey5 = `idem-5-${crypto.randomUUID()}`;
    const { res: postRes5, folioLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: idemKey5,
    });
    expect(postRes5.status).toBe(201);
    const stampedTax = computeTax(1000, '0.10');

    expect(
      (
        await putTaxRuleSupersede(propertyId, owner, 'goods_sales', {
          taxRuleId: 'tr_v2',
          name: 'Goods tax v2',
          ruleType: 'PERCENTAGE',
          rate: '0.20',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: addDays(arrival, 1),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await postFolioSplit(propertyId, owner, folioLineId, {
          splits: [
            { folioLineId: `${folioLineId}:a`, amountMinor: 500 },
            { folioLineId: `${folioLineId}:b`, amountMinor: 500 },
          ],
          idempotencyKey: `idem-split-5-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const childTax = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'TAX' && l.amountMinor > 0 && l.taxOf !== folioLineId,
    );
    expect(childTax.reduce((s, l) => s + l.amountMinor, 0)).toBe(stampedTax);
    expect(stampedTax).not.toBe(computeTax(1000, '0.20'));
  });

  it('Test 6: direct split of tax line returns line_not_splittable', async () => {
    const owner = 'user_tax_6';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_6';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const idemKey6 = `idem-6-${crypto.randomUUID()}`;
    const { res: postRes6 } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: idemKey6,
    });
    expect(postRes6.status).toBe(201);

    const taxLineId = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX',
    )!.folioLineId;

    const res = await postFolioSplit(propertyId, owner, taxLineId, {
      splits: [
        { folioLineId: `${taxLineId}:a`, amountMinor: 50 },
        { folioLineId: `${taxLineId}:b`, amountMinor: 50 },
      ],
      idempotencyKey: `idem-split-6-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: LINE_NOT_SPLITTABLE });
  });

  it('Test 7: night audit room + tax in one step; retry blocked by tax uniq', async () => {
    const owner = 'user_tax_7';
    const { propertyId, stub } = await provisionHotel(owner);
    const businessDate = (await stub.readBusinessDate())!;
    await seedRoomTaxRule(propertyId, owner, businessDate, 'tr_room', 'room_sales', '0.0825');

    const rateInput = {
      roomTypeId: 'rt_king',
      stayDate: businessDate,
      amountMinor: 10_000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(
        { kind: 'user', userId: owner },
        rateInput,
        await idemFor('rate-7', rateInput),
      ),
    ).toEqual({ ok: true });

    await stub.insertReservationForTest({
      reservationId: 'res_na_tax',
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: businessDate,
      departureDate: addDays(businessDate, 2),
      status: 'confirmed',
    });

    await stub.setPostRoomChargesFailureAfterCountForTest(1);
    const failed = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(failed.status).toBe('FAILED');
    expect(await stub.countFolioLinesForReservation('res_na_tax')).toBe(0);
    await stub.setPostRoomChargesFailureAfterCountForTest(null);

    const retry = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(retry.status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_na_tax');
    expect(lines.some((l) => l.source === 'NIGHT_AUDIT' && l.chargeCode === 'ROOM')).toBe(true);
    expect(lines.some((l) => l.source === 'TAX')).toBe(true);

    const rerun = await stub.runAuditStep(businessDate, 'POST_ROOM_CHARGES');
    expect(rerun.status).toBe('COMPLETED');
    expect((await stub.listFolioLinesForReservation('res_na_tax')).filter((l) => l.source === 'TAX')).toHaveLength(
      1,
    );
  });

  it('Test 8: PAYMENT and TAX parent sources never get tax children', async () => {
    const owner = 'user_tax_8';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_8';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const payLineId = `${reservationId}:pay:8`;
    expect(
      await stub.tryAddFolioLine(
        { kind: 'user', userId: owner },
        {
          folioLineId: payLineId,
          reservationId,
          chargeCode: 'PAYMENT',
          amountMinor: -500,
          source: 'PAYMENT',
        },
        await idemFor('pay-8', {
          folioLineId: payLineId,
          reservationId,
          chargeCode: 'PAYMENT',
          amountMinor: -500,
        }),
      ),
    ).toMatchObject({ ok: true });

    const miscIdem = `idem-8-misc-${crypto.randomUUID()}`;
    const { res: miscRes, folioLineId: miscId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: miscIdem,
    });
    expect(miscRes.status).toBe(201);

    const taxLineId = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX' && l.taxOf === miscId,
    )!.folioLineId;

    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter((l) => l.taxOf === payLineId),
    ).toHaveLength(0);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).filter((l) => l.taxOf === taxLineId),
    ).toHaveLength(0);

    const folioLineId = miscId;
    expect(
      (
        await postFolioSplit(propertyId, owner, folioLineId, {
          splits: [
            { folioLineId: `${folioLineId}:a`, amountMinor: 500 },
            { folioLineId: `${folioLineId}:b`, amountMinor: 500 },
          ],
          idempotencyKey: `idem-split-8-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);

    const reversalIds = (await stub.listFolioLinesForReservation(reservationId))
      .filter((l) => l.source === 'SPLIT_REVERSAL')
      .map((l) => l.folioLineId);
    for (const revId of reversalIds) {
      expect(
        (await stub.listFolioLinesForReservation(reservationId)).filter((l) => l.taxOf === revId),
      ).toHaveLength(0);
    }
  });

  it('Test 9: supersede closes old rule; new posts use new rule id', async () => {
    const owner = 'user_tax_9';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_9';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const { res: postRes9a } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: `idem-9a-${crypto.randomUUID()}`,
    });
    expect(postRes9a.status).toBe(201);
    expect(
      (await stub.listFolioLinesForReservation(reservationId)).find((l) => l.source === 'TAX')?.taxRuleId,
    ).toBe('tr_v1');

    expect(
      (
        await putTaxRuleSupersede(propertyId, owner, 'goods_sales', {
          taxRuleId: 'tr_v2',
          name: 'Goods tax v2',
          ruleType: 'PERCENTAGE',
          rate: '0.20',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: arrival,
        })
      ).status,
    ).toBe(200);

    const { res: postRes9b } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: `idem-9b-${crypto.randomUUID()}`,
    });
    expect(postRes9b.status).toBe(201);

    const taxRuleIds = (await stub.listFolioLinesForReservation(reservationId))
      .filter((l) => l.source === 'TAX')
      .map((l) => l.taxRuleId);
    expect(taxRuleIds).toContain('tr_v1');
    expect(taxRuleIds).toContain('tr_v2');
  });

  it('Test 10: duplicate rule_key create rejected', async () => {
    const owner = 'user_tax_10';
    const { propertyId, arrival } = await provisionHotel(owner);
    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const dup = await postTaxRule(propertyId, owner, {
      taxRuleId: 'tr_dup',
      ruleKey: 'goods_sales',
      name: 'Dup',
      ruleType: 'PERCENTAGE',
      rate: '0.05',
      taxGroup: 'GOODS',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    });
    expect(dup.status).toBe(422);
    expect(await dup.json()).toMatchObject({ error: TAX_RULE_KEY_EXISTS });
  });

  it('Test 11: non-PERCENTAGE rule create returns tax_rule_type_unsupported', async () => {
    const owner = 'user_tax_11';
    const { propertyId, arrival } = await provisionHotel(owner);
    const res = await postTaxRule(propertyId, owner, {
      taxRuleId: 'tr_flat',
      ruleKey: 'flat_fee',
      name: 'Flat',
      ruleType: 'FLAT',
      rate: '500',
      taxGroup: 'ROOM',
      outputChargeCode: 'TAX',
      validFrom: arrival,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: TAX_RULE_TYPE_UNSUPPORTED });
  });

  it('Test 12: output code with non-null tax_group rejected', async () => {
    const owner = 'user_tax_12';
    const { propertyId, arrival } = await provisionHotel(owner);
    const res = await postTaxRule(propertyId, owner, {
      taxRuleId: 'tr_bad_out',
      ruleKey: 'bad_out',
      name: 'Bad output',
      ruleType: 'PERCENTAGE',
      rate: '0.10',
      taxGroup: 'ROOM',
      outputChargeCode: 'MISC',
      validFrom: arrival,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: TAX_OUTPUT_CODE_TAXABLE });
  });

  it('Test 15: every TAX line has tax_of and tax_rule_id', async () => {
    const owner = 'user_tax_15';
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_15';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);
    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');
    const { res: postRes15 } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 1000,
      idempotencyKey: `idem-15-${crypto.randomUUID()}`,
    });
    expect(postRes15.status).toBe(201);

    for (const line of (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'TAX',
    )) {
      expect(line.taxOf).toBeTruthy();
      expect(line.taxRuleId).toBeTruthy();
    }
  });

  it('Test 16: rule selection uses posting business date when superseded rate not yet effective', async () => {
    const owner = 'user_tax_16';
    const { orgId, propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_16';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');

    const folioLineId = `${reservationId}:item:16`;
    const payload = {
      reservationId,
      folioLineId,
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    const fingerprint = await fingerprintPayload(payload);
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-folio-16',
        requestFingerprint: fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: owner },
        command: { type: 'folio.add_item', payload },
        routeId: 'post_folio_lines',
      },
    };

    expect(
      (
        await putTaxRuleSupersede(propertyId, owner, 'goods_sales', {
          taxRuleId: 'tr_v2',
          name: 'Goods tax v2',
          ruleType: 'PERCENTAGE',
          rate: '0.20',
          taxGroup: 'GOODS',
          outputChargeCode: 'TAX',
          validFrom: addDays(arrival, 1),
        })
      ).status,
    ).toBe(200);

    await dispatchPendingBatch([msg]);

    const taxLine = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX',
    );
    expect(taxLine?.taxRuleId).toBe('tr_v1');
    expect(taxLine?.amountMinor).toBe(computeTax(1000, '0.10'));
  });

  it('Test 16a: stale provisional folio.add_item rejected after business date rolled', async () => {
    const owner = 'user_tax_16a';
    const { orgId, propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = 'res_tax_16a';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, 'tr_v1', 'goods_sales', '0.10');

    const folioLineId = `${reservationId}:item:16a`;
    const payload = {
      reservationId,
      folioLineId,
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    const fingerprint = await fingerprintPayload(payload);
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-folio-16a',
        requestFingerprint: fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: owner },
        command: { type: 'folio.add_item', payload },
        routeId: 'post_folio_lines',
      },
    };

    await stub.setBusinessDateForTest(addDays(arrival, 1));
    await dispatchPendingBatch([msg]);

    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: Array<{ reason: string }>;
    };
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe('business_date_closed');
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });

  it('Test 17: config register has no tax_registry or affectsTaxMoney', () => {
    expect(CONFIG_REGISTER.some((e) => e.key === 'pms.money.tax_registry')).toBe(false);
    for (const entry of CONFIG_REGISTER) {
      expect('affectsTaxMoney' in entry.consumers).toBe(false);
    }
  });

  it('Test 18: percent discount on taxable ROOM restamps negative tax on discount line', async () => {
    const owner = `user_tax_disc_pct_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_pct_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const roomRuleId = `tr_room_${crypto.randomUUID()}`;
    await seedRoomTaxRule(
      propertyId,
      owner,
      arrival,
      roomRuleId,
      `room_sales_${crypto.randomUUID()}`,
      '0.10',
    );

    const { res: roomRes, folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'ROOM',
      amountMinor: 10_000,
      idempotencyKey: `idem-room-${crypto.randomUUID()}`,
    });
    expect(roomRes.status).toBe(201);

    const roomTaxBefore = (await stub.listFolioLinesForReservation(reservationId)).find(
      (l) => l.source === 'TAX' && l.taxOf === roomLineId,
    );
    expect(roomTaxBefore).toMatchObject({
      amountMinor: computeTax(10_000, '0.10'),
      taxRuleId: roomRuleId,
    });

    const discountLineId = `disc_${crypto.randomUUID()}`;
    const discountInput = {
      sourceFolioLineId: roomLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'comp night',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(
        { kind: 'user', userId: owner },
        discountInput,
        await idemFor(`disc-${discountLineId}`, discountInput),
      ),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -1000,
      splitOf: roomLineId,
    });

    const discountTax = lines.find((l) => l.source === 'TAX' && l.taxOf === discountLineId);
    expect(discountTax).toMatchObject({
      amountMinor: computeTax(-1000, '0.10'),
      taxRuleId: roomRuleId,
    });

    const roomTaxAfter = lines.find((l) => l.source === 'TAX' && l.taxOf === roomLineId);
    expect(roomTaxAfter).toEqual(roomTaxBefore);
  });

  it('Test 19: fixed discount on taxable ROOM restamps negative tax on discount line', async () => {
    const owner = `user_tax_disc_fix_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_fix_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const roomRuleId = `tr_room_fix_${crypto.randomUUID()}`;
    await seedRoomTaxRule(
      propertyId,
      owner,
      arrival,
      roomRuleId,
      `room_sales_fix_${crypto.randomUUID()}`,
      '0.10',
    );

    const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'ROOM',
      amountMinor: 8000,
      idempotencyKey: `idem-room-fix-${crypto.randomUUID()}`,
    });

    const discountLineId = `disc_fix_${crypto.randomUUID()}`;
    const discountInput = {
      sourceFolioLineId: roomLineId,
      kind: 'fixed' as const,
      amountMinor: 2500,
      reason: 'fixed comp',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(
        { kind: 'user', userId: owner },
        discountInput,
        await idemFor(`disc-fix-${discountLineId}`, discountInput),
      ),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -2500,
    });
    expect(lines.find((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toMatchObject({
      amountMinor: computeTax(-2500, '0.10'),
      taxRuleId: roomRuleId,
    });
  });

  it('Test 20: exempt MISC (taxGroup null) discount posts DISCOUNT only', async () => {
    const owner = `user_tax_disc_exempt_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_exempt_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedGoodsTaxRule(propertyId, owner, arrival, `tr_goods_${crypto.randomUUID()}`, `goods_${crypto.randomUUID()}`, '0.0825');
    expect((await patchChargeCode(propertyId, owner, 'MISC', { taxGroup: null })).status).toBe(200);

    const { folioLineId: miscLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'MISC',
      amountMinor: 5000,
      idempotencyKey: `idem-misc-${crypto.randomUUID()}`,
    });

    const discountLineId = `disc_exempt_${crypto.randomUUID()}`;
    const discountInput = {
      sourceFolioLineId: miscLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'exempt comp',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(
        { kind: 'user', userId: owner },
        discountInput,
        await idemFor(`disc-exempt-${discountLineId}`, discountInput),
      ),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.some((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toBe(false);
    expect(lines.find((l) => l.folioLineId === discountLineId)).toMatchObject({
      chargeCode: 'DISCOUNT',
      amountMinor: -500,
    });
  });

  it('Test 21: stacked ROOM tax rules produce two negative tax lines on discount', async () => {
    const owner = `user_tax_disc_stack_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_stack_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    const stateRuleId = `tr_state_${crypto.randomUUID()}`;
    const cityRuleId = `tr_city_${crypto.randomUUID()}`;
    expect(
      (
        await postTaxRule(propertyId, owner, {
          taxRuleId: stateRuleId,
          ruleKey: `state_${crypto.randomUUID()}`,
          name: 'State room',
          ruleType: 'PERCENTAGE',
          rate: '0.06',
          taxGroup: 'ROOM',
          outputChargeCode: 'TAX',
          validFrom: arrival,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postTaxRule(propertyId, owner, {
          taxRuleId: cityRuleId,
          ruleKey: `city_${crypto.randomUUID()}`,
          name: 'City room',
          ruleType: 'PERCENTAGE',
          rate: '0.02',
          taxGroup: 'ROOM',
          outputChargeCode: 'TAX',
          validFrom: arrival,
        })
      ).status,
    ).toBe(201);

    const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'ROOM',
      amountMinor: 10_000,
      idempotencyKey: `idem-room-stack-${crypto.randomUUID()}`,
    });

    const discountLineId = `disc_stack_${crypto.randomUUID()}`;
    const discountInput = {
      sourceFolioLineId: roomLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'stack comp',
      folioLineId: discountLineId,
    };
    expect(
      await stub.tryPostDiscount(
        { kind: 'user', userId: owner },
        discountInput,
        await idemFor(`disc-stack-${discountLineId}`, discountInput),
      ),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const discountTaxLines = (await stub.listFolioLinesForReservation(reservationId)).filter(
      (l) => l.source === 'TAX' && l.taxOf === discountLineId,
    );
    expect(discountTaxLines).toHaveLength(2);
    expect(discountTaxLines.map((l) => l.taxRuleId).sort()).toEqual([cityRuleId, stateRuleId].sort());
    expect(discountTaxLines.every((l) => l.amountMinor < 0)).toBe(true);
  });

  it('Test 22: idempotent discount replay returns same folioLineId without duplicate tax', async () => {
    const owner = `user_tax_disc_idem_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef, stub } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_idem_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedRoomTaxRule(
      propertyId,
      owner,
      arrival,
      `tr_idem_${crypto.randomUUID()}`,
      `room_idem_${crypto.randomUUID()}`,
      '0.10',
    );

    const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'ROOM',
      amountMinor: 6000,
      idempotencyKey: `idem-room-idem-${crypto.randomUUID()}`,
    });

    const discountLineId = `disc_idem_${crypto.randomUUID()}`;
    const discountInput = {
      sourceFolioLineId: roomLineId,
      kind: 'percent' as const,
      bps: 1000,
      reason: 'idem comp',
      folioLineId: discountLineId,
    };
    const idem = await idemFor(`disc-idem-${crypto.randomUUID()}`, discountInput);
    expect(
      await stub.tryPostDiscount({ kind: 'user', userId: owner }, discountInput, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });
    expect(
      await stub.tryPostDiscount({ kind: 'user', userId: owner }, discountInput, idem),
    ).toMatchObject({ ok: true, folioLineId: discountLineId });

    const lines = await stub.listFolioLinesForReservation(reservationId);
    expect(lines.filter((l) => l.folioLineId === discountLineId)).toHaveLength(1);
    expect(lines.filter((l) => l.source === 'TAX' && l.taxOf === discountLineId)).toHaveLength(1);
  });

  it('Test 23: HTTP POST discount then GET folio includes tax child on discount line', async () => {
    const owner = `user_tax_disc_http_${crypto.randomUUID()}`;
    const { propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = `res_tax_disc_http_${crypto.randomUUID()}`;
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 2), guestRef))
        .status,
    ).toBe(201);

    await seedRoomTaxRule(
      propertyId,
      owner,
      arrival,
      `tr_http_${crypto.randomUUID()}`,
      `room_http_${crypto.randomUUID()}`,
      '0.10',
    );

    const { folioLineId: roomLineId } = await postFolioLine(propertyId, owner, reservationId, {
      chargeCode: 'ROOM',
      amountMinor: 10_000,
      idempotencyKey: `idem-room-http-${crypto.randomUUID()}`,
    });

    const discountLineId = `disc_http_${crypto.randomUUID()}`;
    const discountRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(roomLineId)}/discount`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({
            kind: 'percent',
            bps: 1000,
            reason: 'http comp',
            folioLineId: discountLineId,
            idempotencyKey: `idem-disc-http-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(discountRes.status).toBe(200);
    const posted = (await discountRes.json()) as { ok: true; folioLineId: string };
    expect(posted).toMatchObject({ ok: true, folioLineId: discountLineId });

    const folioRes = await getFolio(propertyId, owner, reservationId);
    expect(folioRes.status).toBe(200);
    const body = (await folioRes.json()) as {
      ok: true;
      lines: Array<{ source: string; taxOf?: string; amountMinor: number }>;
    };
    const taxChild = body.lines.find((l) => l.source === 'TAX' && l.taxOf === posted.folioLineId);
    expect(taxChild).toMatchObject({ amountMinor: computeTax(-1000, '0.10') });
  });
});
