import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

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
        name: 'FX Routes Hotel',
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

async function provisionHotel(actor: string) {
  const orgId = `org_fx_${crypto.randomUUID()}`;
  const propertyId = `prop_fx_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'FX Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, arrival, stub: resolved!.stub, guestRef: guest.guestRef };
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

describe('folio FX HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('5 HTTP: GET /fx-rates returns the open EUR row', async () => {
    const actor = 'user_fx_get5';
    const { propertyId } = await provisionHotel(actor);
    const create = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/fx-rates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          quoteId: 'q_eur',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: '1.10',
          effectiveFrom: Date.now(),
          idempotencyKey: 'idem-fx-5',
        }),
      }),
      env,
    );
    expect(create.status).toBe(201);
    const listed = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/fx-rates`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      ledgerCurrency: string;
      rates: Array<{ fromCurrency: string; rate: string; effectiveTo: number | null }>;
    };
    expect(body.ledgerCurrency).toBe('USD');
    expect(body.rates).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromCurrency: 'EUR', rate: '1.10', effectiveTo: null })]),
    );
  });

  it('7: staff without settings:configure is 403 on POST create; kill-switch is 503', async () => {
    const owner = 'user_fx_owner7';
    const staff = 'user_fx_staff7';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');
    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/fx-rates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': staff },
        body: JSON.stringify({
          quoteId: 'q_staff',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: '1.10',
          effectiveFrom: Date.now(),
          idempotencyKey: 'idem-fx-staff',
        }),
      }),
      env,
    );
    expect(denied.status).toBe(403);

    await setKillSwitch(env, 'pms.core', true);
    const killed = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/fx-rates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
        body: JSON.stringify({
          quoteId: 'q_kill',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          rate: '1.10',
          effectiveFrom: Date.now(),
          idempotencyKey: 'idem-fx-kill',
        }),
      }),
      env,
    );
    expect(killed.status).toBe(503);
  });

  it('34: GET folio includes fx fields; authorize/cash accept currency; nested fx-rates path is not the list', async () => {
    const actor = 'user_fx_34';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const reservationId = 'res_fx_34';
    expect(
      (await postReservation(propertyId, actor, reservationId, arrival, addDays(arrival, 1), guestRef)).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/fx-rates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              quoteId: 'q_34',
              fromCurrency: 'EUR',
              toCurrency: 'USD',
              rate: '1.10',
              effectiveFrom: Date.now(),
              idempotencyKey: 'idem-fx-34',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const auth = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${reservationId}/folio/payments/authorize`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            paymentId: 'pay_34',
            amountMinor: 10000,
            currency: 'EUR',
            idempotencyKey: 'idem-auth-34',
          }),
        },
      ),
      env,
    );
    expect(auth.status).toBe(200);

    const cash = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${reservationId}/folio/payments/cash`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            paymentId: 'pay_cash_34',
            amountMinor: 2000,
            currency: 'EUR',
            idempotencyKey: 'idem-cash-34',
          }),
        },
      ),
      env,
    );
    expect(cash.status).toBe(201);

    const folio = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${reservationId}/folio`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(folio.status).toBe(200);
    const folioBody = (await folio.json()) as {
      ledgerCurrency: string;
      balanceAtRisk: boolean;
      txnBalances: Array<{ currency: string }>;
      lines: Array<{ fxRate: string; fxRateAt: number }>;
    };
    expect(folioBody.ledgerCurrency).toBe('USD');
    expect(folioBody.balanceAtRisk).toBe(false);
    expect(folioBody.txnBalances.some((b) => b.currency === 'EUR')).toBe(true);
    expect(folioBody.lines[0]).toEqual(expect.objectContaining({ fxRate: '1.10' }));
    expect(folioBody.lines[0]?.fxRateAt).toEqual(expect.any(Number));

    const nested = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/fx-rates`,
        { headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect([404, 422]).toContain(nested.status);
  });

  it('39 + staff 403: kill-switch on chargeback/capture is 503; staff chargeback is 403', async () => {
    const owner = 'user_fx_owner39';
    const staff = 'user_fx_staff39';
    const { orgId, propertyId, arrival, guestRef } = await provisionHotel(owner);
    const reservationId = 'res_fx_39';
    expect(
      (await postReservation(propertyId, owner, reservationId, arrival, addDays(arrival, 1), guestRef)).status,
    ).toBe(201);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${reservationId}/folio/payments/authorize`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({
                paymentId: 'pay_39',
                amountMinor: 5000,
                idempotencyKey: 'idem-auth-39',
              }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request(
            `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/pay_39/capture`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
              body: JSON.stringify({ amountMinor: 5000, idempotencyKey: 'idem-cap-39' }),
            },
          ),
          env,
        )
      ).status,
    ).toBe(200);

    const staffCb = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/pay_39/chargeback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': staff },
          body: JSON.stringify({ feeLedgerMinor: 0, reason: 'no', idempotencyKey: 'idem-cb-staff' }),
        },
      ),
      env,
    );
    expect(staffCb.status).toBe(403);

    await setKillSwitch(env, 'pms.core', true);
    const killCb = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/pay_39/chargeback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({ feeLedgerMinor: 0, reason: 'k', idempotencyKey: 'idem-cb-kill' }),
        },
      ),
      env,
    );
    expect(killCb.status).toBe(503);
    const killCap = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/payments/pay_39/capture`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': owner },
          body: JSON.stringify({ amountMinor: 5000, idempotencyKey: 'idem-cap-kill' }),
        },
      ),
      env,
    );
    expect(killCap.status).toBe(503);
  });
});
