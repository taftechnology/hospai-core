#!/usr/bin/env node
/**
 * Staging HTTP smoke: provision → book → check-in → check-out.
 *
 *   BASE=https://hospai-pms-core-staging.<subdomain>.workers.dev \
 *   CLERK_SESSION_JWT=<jwt> \
 *   pnpm smoke:staging
 */

const BASE = process.env.BASE?.replace(/\/$/, '');
const CLERK_SESSION_JWT = process.env.CLERK_SESSION_JWT;

if (!BASE) {
  console.error('BASE is required (staging origin, no trailing slash)');
  process.exit(1);
}
if (!CLERK_SESSION_JWT) {
  console.error('CLERK_SESSION_JWT is required');
  process.exit(1);
}

const suffix = `smoke_${Date.now()}`;
const orgId = `org_${suffix}`;
const propertyId = `prop_${suffix}`;
const roomTypeId = `rt_${suffix}`;
const guestId = `guest_${suffix}`;
const roomId = `room_${suffix}`;
const reservationId = `res_${suffix}`;

const authHeaders = {
  authorization: `Bearer ${CLERK_SESSION_JWT}`,
  'content-type': 'application/json',
};

function fail(step, status, bodySnippet) {
  console.error(`step ${step} failed: HTTP ${status}`);
  if (bodySnippet) console.error(bodySnippet);
  process.exit(1);
}

function addCalendarDays(isoDate, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`invalid date: ${isoDate}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function snippet(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.slice(0, 500);
}

async function main() {
  // Step 1: POST /v1/orgs
  const orgRes = await fetch(`${BASE}/v1/orgs`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ orgId, name: 'Smoke Org' }),
  });
  const orgBody = await readJson(orgRes);
  if (orgRes.status !== 201) fail(1, orgRes.status, snippet(orgBody));
  console.log('✓ step 1: POST /v1/orgs');

  // Step 2: POST /v1/orgs/{orgId}/properties
  const propRes = await fetch(`${BASE}/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      propertyId,
      name: 'Smoke Hotel',
      timeZone: 'UTC',
      currency: 'USD',
    }),
  });
  const propBody = await readJson(propRes);
  if (propRes.status !== 201) fail(2, propRes.status, snippet(propBody));
  console.log('✓ step 2: POST /v1/orgs/{orgId}/properties');

  // Step 3: POST /v1/properties/{propertyId}/room-types
  const rtRes = await fetch(`${BASE}/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      roomTypeId,
      code: 'SMK',
      name: 'Smoke King',
      roomCount: 1,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-rt-${suffix}`,
    }),
  });
  const rtBody = await readJson(rtRes);
  if (rtRes.status !== 201) fail(3, rtRes.status, snippet(rtBody));
  const fromDate = rtBody?.fromDate;
  if (typeof fromDate !== 'string') {
    fail(3, rtRes.status, 'missing fromDate in room-type response');
  }
  console.log('✓ step 3: POST /v1/properties/{propertyId}/room-types');

  // Step 4: PUT /v1/properties/{propertyId}/rate-days
  const rateRes = await fetch(`${BASE}/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      roomTypeId,
      stayDate: fromDate,
      amountMinor: 10000,
      currency: 'USD',
      idempotencyKey: `idem-rate-${suffix}`,
    }),
  });
  const rateBody = await readJson(rateRes);
  if (rateRes.status !== 200) fail(4, rateRes.status, snippet(rateBody));
  console.log('✓ step 4: PUT /v1/properties/{propertyId}/rate-days');

  // Step 5: POST /v1/properties/{propertyId}/guests
  const guestRes = await fetch(`${BASE}/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      guestId,
      displayName: 'Smoke Guest',
      idempotencyKey: `idem-guest-${suffix}`,
    }),
  });
  const guestBody = await readJson(guestRes);
  if (guestRes.status !== 200) fail(5, guestRes.status, snippet(guestBody));
  console.log('✓ step 5: POST /v1/properties/{propertyId}/guests');

  // Step 6: POST /v1/properties/{propertyId}/rooms
  const roomRes = await fetch(`${BASE}/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      roomId,
      roomTypeId,
      code: '101',
      idempotencyKey: `idem-room-${suffix}`,
    }),
  });
  const roomBody = await readJson(roomRes);
  if (roomRes.status !== 201) fail(6, roomRes.status, snippet(roomBody));
  console.log('✓ step 6: POST /v1/properties/{propertyId}/rooms');

  const departureDate = addCalendarDays(fromDate, 1);

  // Step 7: POST /v1/properties/{propertyId}/reservations
  const bookRes = await fetch(`${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      reservationId,
      roomTypeId,
      guestRef: guestId,
      arrivalDate: fromDate,
      departureDate,
      idempotencyKey: `idem-res-${suffix}`,
    }),
  });
  const bookBody = await readJson(bookRes);
  if (bookRes.status !== 201) fail(7, bookRes.status, snippet(bookBody));
  console.log('✓ step 7: POST /v1/properties/{propertyId}/reservations');

  // Step 8: POST …/reservations/{id}/assign-room
  const assignRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/assign-room`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        roomId,
        idempotencyKey: `idem-assign-${suffix}`,
      }),
    },
  );
  const assignBody = await readJson(assignRes);
  if (assignRes.status !== 200) fail(8, assignRes.status, snippet(assignBody));
  console.log('✓ step 8: POST …/reservations/{id}/assign-room');

  const bearerOnly = { authorization: `Bearer ${CLERK_SESSION_JWT}` };

  // Step 9: POST …/reservations/{id}/check-in
  const checkInRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
    {
      method: 'POST',
      headers: {
        ...bearerOnly,
        'x-idempotency-key': `idem-ci-${suffix}`,
      },
    },
  );
  const checkInBody = await readJson(checkInRes);
  if (checkInRes.status !== 200) fail(9, checkInRes.status, snippet(checkInBody));
  console.log('✓ step 9: POST …/reservations/{id}/check-in');

  const accountName = `Smoke Direct ${suffix}`;

  // Step 9b: POST city-ledger account
  const claRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: accountName,
        creditLimitMinor: 500_000,
        idempotencyKey: `idem-cla-${suffix}`,
      }),
    },
  );
  const claBody = await readJson(claRes);
  if (claRes.status !== 201) fail('9b', claRes.status, snippet(claBody));
  const accountId = claBody?.accountId;
  if (!accountId) fail('9b', claRes.status, 'missing accountId');
  console.log('✓ step 9b: POST city-ledger account');

  // Step 9b2: POST folio line (ROOM) — desk charge, no night audit
  const roomLineRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        chargeCode: 'ROOM',
        amountMinor: 10000,
        idempotencyKey: `idem-folio-room-${suffix}`,
      }),
    },
  );
  const roomLineBody = await readJson(roomLineRes);
  if (roomLineRes.status !== 201) fail('9b2', roomLineRes.status, snippet(roomLineBody));
  console.log('✓ step 9b2: POST folio line (ROOM)');

  // Step 9c: GET folio — find ROOM line on GUEST window
  const folioRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio`,
    { headers: bearerOnly },
  );
  const folioBody = await readJson(folioRes);
  if (folioRes.status !== 200) fail('9c', folioRes.status, snippet(folioBody));
  const guestLine = (folioBody?.lines ?? []).find(
    (l) => l.chargeCode === 'ROOM' && l.folioWindowId === `${reservationId}:GUEST`,
  );
  if (!guestLine?.folioLineId) fail('9c', folioRes.status, 'missing GUEST ROOM folio line');

  // Step 9d: POST folio window (COMPANY)
  const fwRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/windows`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        kind: 'COMPANY',
        billedParty: accountName,
        idempotencyKey: `idem-fw-co-${suffix}`,
      }),
    },
  );
  const fwBody = await readJson(fwRes);
  if (fwRes.status !== 201 && fwRes.status !== 200) fail('9d', fwRes.status, snippet(fwBody));
  const companyWindowId = fwBody?.folioWindowId;
  if (!companyWindowId) fail('9d', fwRes.status, 'missing company folioWindowId');
  console.log('✓ step 9d: POST folio window (COMPANY)');

  // Step 9e: POST folio transfer GUEST → COMPANY
  const xferRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(guestLine.folioLineId)}/transfer`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        destinationFolioWindowId: companyWindowId,
        idempotencyKey: `idem-xfer-${suffix}`,
      }),
    },
  );
  const xferBody = await readJson(xferRes);
  if (xferRes.status !== 200) fail('9e', xferRes.status, snippet(xferBody));
  console.log('✓ step 9e: POST folio transfer to COMPANY');

  // Step 9f: POST folio window close (COMPANY)
  const closeRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/folio/windows/${encodeURIComponent(companyWindowId)}/close`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ idempotencyKey: `idem-close-co-${suffix}` }),
    },
  );
  const closeBody = await readJson(closeRes);
  if (closeRes.status !== 200) fail('9f', closeRes.status, snippet(closeBody));
  console.log('✓ step 9f: POST folio window close (COMPANY)');

  // Step 9g: GET city-ledger account — openBalanceMinor > 0
  const clDetailRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts?accountId=${encodeURIComponent(accountId)}`,
    { headers: bearerOnly },
  );
  const clDetailBody = await readJson(clDetailRes);
  if (clDetailRes.status !== 200) fail('9g', clDetailRes.status, snippet(clDetailBody));
  if (!(clDetailBody?.openBalanceMinor > 0)) {
    fail('9g', clDetailRes.status, `expected openBalanceMinor > 0, got ${clDetailBody?.openBalanceMinor}`);
  }
  console.log('✓ step 9g: GET city-ledger account (AR posted)');

  // Step 10: POST /v1/properties/{id}/invoices — invoice.generate gates check-out
  const invoiceRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/invoices`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reservationId, idempotencyKey: `idem-inv-${suffix}` }),
    },
  );
  const invoiceBody = await readJson(invoiceRes);
  if (invoiceRes.status !== 201) fail(10, invoiceRes.status, snippet(invoiceBody));
  console.log('✓ step 10: POST …/invoices (invoice.generate)');

  // Step 11: POST …/reservations/{id}/check-out
  const checkOutRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-out`,
    {
      method: 'POST',
      headers: {
        ...bearerOnly,
        'x-idempotency-key': `idem-co-${suffix}`,
      },
    },
  );
  const checkOutBody = await readJson(checkOutRes);
  if (checkOutRes.status !== 200) fail(11, checkOutRes.status, snippet(checkOutBody));
  console.log('✓ step 11: POST …/reservations/{id}/check-out');

  // Step 12: GET …/reservations/{id}
  const getRes = await fetch(
    `${BASE}/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}`,
    { headers: bearerOnly },
  );
  const getBody = await readJson(getRes);
  if (getRes.status !== 200) fail(12, getRes.status, snippet(getBody));
  if (getBody?.status !== 'checked_out') {
    fail(12, getRes.status, `expected status checked_out, got ${JSON.stringify(getBody?.status)}`);
  }
  console.log('✓ step 12: GET …/reservations/{id} (checked_out)');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
