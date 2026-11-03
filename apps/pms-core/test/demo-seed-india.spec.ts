import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';

function devHeaders(actor: string): HeadersInit {
  return { 'content-type': 'application/json', 'x-dev-actor': actor };
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postPropertyInr(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({
        propertyId,
        name: 'Amaltas Residency Test',
        timeZone: 'Asia/Kolkata',
        currency: 'INR',
      }),
    }),
    env,
  );
}

async function postDemoSeed(actor: string, orgId: string, propertyId: string) {
  return worker.fetch(
    new Request('http://localhost/v1/admin/demo-seed', {
      method: 'POST',
      headers: devHeaders(actor),
      body: JSON.stringify({ orgId, propertyId }),
    }),
    env,
  );
}

async function getJson(path: string, actor: string) {
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { 'x-dev-actor': actor } }), env);
}

describe('POST /v1/admin/demo-seed (India)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // Seeds ~40 stays twice (seed + replay); the 5 s default is too tight on CI runners.
  it('seeds INR scenario with board, tax, city ledger, OOO, shift closed, idempotent replay', { timeout: 30_000 }, async () => {
    const owner = 'user_owner';
    const orgId = `org_in_seed_${crypto.randomUUID()}`;
    const propertyId = `prop_in_seed_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Amaltas Org', owner)).status).toBe(201);
    expect((await postPropertyInr(orgId, propertyId, owner)).status).toBe(201);
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    if (resolved) await resolved.stub.flushOutbox();

    const first = await postDemoSeed(owner, orgId, propertyId);
    expect(first.status).toBe(200);
    const seedBody = (await first.json()) as {
      ok: true;
      today: string;
      alreadySeeded: boolean;
      board: { inHouse: number; arrivals: number; departures: number };
    };
    expect(seedBody.alreadySeeded).toBe(false);
    const today = seedBody.today;

    const summaryRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/summary?date=${today}`,
      owner,
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as {
      inHouse: number;
      arrivals: number;
      departuresDue: number;
      overstay: number;
    };
    expect(summary.inHouse).toBe(14);
    expect(summary.arrivals).toBe(6);
    expect(summary.departuresDue).toBe(4);
    expect(summary.overstay).toBe(1);
    expect(seedBody.board.inHouse).toBe(summary.inHouse);
    expect(seedBody.board.arrivals).toBe(summary.arrivals);
    expect(seedBody.board.departures).toBe(summary.departuresDue);

    const inHouseRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/in-house?date=${today}`,
      owner,
    );
    const inHouse = (await inHouseRes.json()) as { items: Array<{ reservationId: string }> };
    const unpaidStay = inHouse.items.find((i) => i.reservationId === 'res_in_ih_04');
    expect(unpaidStay).toBeDefined();

    const stub = (await resolvePropertyFromRegistry(env, propertyId))!.stub;
    const folioRead = await stub.readFolio('res_in_ih_04');
    expect(folioRead.ok).toBe(true);
    if (!folioRead.ok) return;
    const guestWindow = folioRead.windows.find((w) => w.kind === 'GUEST');
    expect(guestWindow!.balanceMinor).toBeGreaterThan(0);
    const codes = folioRead.lines.map((l) => l.chargeCode);
    expect(codes).toContain('CGST');
    expect(codes).toContain('SGST');

    const fnbFolioRead = await stub.readFolio('res_in_ih_03');
    expect(fnbFolioRead.ok).toBe(true);
    if (!fnbFolioRead.ok) return;
    const fnbCodes = fnbFolioRead.lines.map((l) => l.chargeCode);
    expect(fnbCodes).toContain('FNB');
    expect(fnbCodes).toContain('CGST');
    expect(fnbCodes).toContain('SGST');

    const clRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`,
      owner,
    );
    expect(clRes.status).toBe(200);
    const clBody = (await clRes.json()) as {
      accounts: Array<{ name: string; openBalanceMinor: number }>;
    };
    const orion = clBody.accounts.find((a) => a.name === 'Orion Travels Pvt Ltd');
    expect(orion).toBeDefined();
    expect(orion!.openBalanceMinor).toBeGreaterThan(0);

    const roomsRes = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/rooms`, owner);
    const roomsBody = (await roomsRes.json()) as {
      rooms: Array<{ roomId: string; status: string }>;
    };
    const rm106 = roomsBody.rooms.find((r) => r.roomId === 'rm_106');
    expect(rm106?.status).toBe('out_of_order');

    const shiftRes = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/shift`,
      owner,
    );
    expect(shiftRes.status).toBe(200);
    const shiftBody = (await shiftRes.json()) as { shift: unknown };
    expect(shiftBody.shift).toBeNull();

    const unpaidBefore = guestWindow!.balanceMinor;
    const orionBefore = orion!.openBalanceMinor;
    const rm106StatusBefore = rm106!.status;

    const second = await postDemoSeed(owner, orgId, propertyId);
    expect(second.status).toBe(200);
    const replay = (await second.json()) as { alreadySeeded: boolean };
    expect(replay.alreadySeeded).toBe(true);

    const summary2 = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/front-desk/summary?date=${today}`,
      owner,
    );
    const summaryAfter = (await summary2.json()) as typeof summary;
    expect(summaryAfter.inHouse).toBe(summary.inHouse);
    expect(summaryAfter.arrivals).toBe(summary.arrivals);
    expect(summaryAfter.departuresDue).toBe(summary.departuresDue);

    const folioAfterRead = await stub.readFolio('res_in_ih_04');
    expect(folioAfterRead.ok).toBe(true);
    if (!folioAfterRead.ok) return;
    const guestAfter = folioAfterRead.windows.find((w) => w.kind === 'GUEST');
    expect(guestAfter!.balanceMinor).toBe(unpaidBefore);

    const cl2 = await getJson(
      `/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`,
      owner,
    );
    const orionAfter = ((await cl2.json()) as typeof clBody).accounts.find(
      (a) => a.name === 'Orion Travels Pvt Ltd',
    )!;
    expect(orionAfter.openBalanceMinor).toBe(orionBefore);

    const rooms2 = await getJson(`/v1/properties/${encodeURIComponent(propertyId)}/rooms`, owner);
    const rm106After = ((await rooms2.json()) as typeof roomsBody).rooms.find((r) => r.roomId === 'rm_106');
    expect(rm106After?.status).toBe(rm106StatusBefore);
  });
});
