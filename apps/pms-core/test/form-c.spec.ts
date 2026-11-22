import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  commandFingerprint,
  fingerprintPayload,
  FORM_C_DEADLINE_MS,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { seedSubscription } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures.js';

const ACTOR = 'user_owner';
const DAY_MS = 24 * 60 * 60 * 1000;

type Stub = DurableObjectStub<PropertyDO>;

function orgOf(orgId: string) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

async function call(method: string, url: string, body?: unknown, actor = ACTOR) {
  return worker.fetch(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}

function propUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}${suffix}`;
}

type Hotel = { orgId: string; propertyId: string; stub: Stub; businessDate: string; label: string };

async function newOrg(label: string): Promise<string> {
  const orgId = `org_fc_${label}_${crypto.randomUUID().slice(0, 8)}`;
  expect((await call('POST', 'http://localhost/v1/orgs', { orgId, name: 'Form C Org' })).status).toBe(201);
  await seedSubscription(env, orgId, 'group');
  return orgId;
}

async function addHotel(orgId: string, label: string, opts: { india?: boolean } = {}): Promise<Hotel> {
  const india = opts.india ?? true;
  const propertyId = `prop_fc_${label}_${crypto.randomUUID().slice(0, 8)}`;
  const created = await call('POST', `http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
    propertyId,
    name: `Hotel ${label}`,
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(created.status).toBe(201);
  const rt = await call('POST', propUrl(propertyId, '/room-types'), {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 12,
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: `rt-${propertyId}`,
  });
  expect(rt.status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  const stub = resolved.stub as Stub;
  const businessDate = await stub.readBusinessDate();
  if (!businessDate) throw new Error('business date unset');
  await seedBarRatesForHorizon(stub, 'rt_king', businessDate);
  for (let i = 1; i <= 4; i += 1) {
    expect(
      await stub.tryCreateRoom(
        TEST_OWNER_ACTOR,
        { roomId: `rm_${i}`, roomTypeId: 'rt_king', code: `10${i}` },
        await idemFor(`room-${propertyId}-${i}`, { roomId: `rm_${i}` }),
      ),
    ).toMatchObject({ ok: true });
  }
  if (india) await setCountry(stub, 'IN');
  return { orgId, propertyId, stub, businessDate, label };
}

async function setCountry(stub: Stub, country: string) {
  const value = { country, region: null, locality: null };
  const reason = 'tax location';
  expect(
    await stub.tryPutDomainConfig(
      TEST_OWNER_ACTOR,
      'pms.tax.location',
      value,
      { reason },
      await idemFor(`loc-${country}-${crypto.randomUUID().slice(0, 6)}`, { key: 'pms.tax.location', value, reason }),
    ),
  ).toMatchObject({ ok: true });
}

async function guest(h: Hotel, nationality: string | null, name = 'Zanele Mokoena'): Promise<string> {
  const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
  const made = await call('POST', propUrl(h.propertyId, '/guests'), {
    guestId: guestRef,
    displayName: name,
    idempotencyKey: `guest-${guestRef}`,
  });
  expect(made.status).toBe(200);
  if (nationality) {
    const doc = await call('POST', propUrl(h.propertyId, `/guests/${guestRef}/documents`), {
      documentId: `doc_${guestRef}`,
      kind: 'PASSPORT',
      fields: { number: 'ZZ9988776', issuingCountry: nationality, nationality },
      idempotencyKey: `doc-${guestRef}`,
    });
    expect(doc.status).toBe(200);
  }
  return guestRef;
}

let sequence = 0;

async function book(h: Hotel, guestRef: string, opts: { checkIn?: boolean; nights?: number } = {}) {
  sequence += 1;
  const reservationId = `res_fc_${sequence}_${crypto.randomUUID().slice(0, 6)}`;
  expect(
    await h.stub.tryCreateReservation(
      TEST_OWNER_ACTOR,
      {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: h.businessDate,
        departureDate: addCalendarDays(h.businessDate, opts.nights ?? 2),
      },
      await idemFor(`book-${reservationId}`, { reservationId }),
    ),
  ).toMatchObject({ ok: true });
  if (opts.checkIn !== false) await checkIn(h, reservationId, `rm_${((sequence - 1) % 4) + 1}`);
  return reservationId;
}

async function checkIn(h: Hotel, reservationId: string, roomId: string, keySuffix = '') {
  const input = { reservationId, roomId };
  expect(
    await h.stub.tryCheckIn(TEST_OWNER_ACTOR, input, await idemFor(`ci-${reservationId}${keySuffix}`, input)),
  ).toMatchObject({
    ok: true,
  });
}

function person(overrides: Record<string, unknown> = {}) {
  return {
    surname: 'Mokoena',
    givenNames: 'Zanele',
    gender: 'F',
    dateOfBirth: '1990-04-01',
    nationality: 'ZA',
    passportNumber: 'zz9988776',
    portOfArrival: 'Delhi',
    ...overrides,
  };
}

async function save(
  h: Hotel,
  reservationId: string,
  recordId: string,
  kind: 'BOOKED_GUEST' | 'ADDITIONAL',
  fields: unknown = person(),
  key = `save-${recordId}-${crypto.randomUUID().slice(0, 6)}`,
) {
  return call('POST', propUrl(h.propertyId, `/reservations/${reservationId}/form-c`), {
    recordId,
    kind,
    fields,
    idempotencyKey: key,
  });
}

type Row = {
  recordId: string;
  reservationId: string;
  kind: string;
  status: string;
  detailsSaved: boolean;
  deadlineAt: number;
  overdue: boolean;
  filedReference: string | null;
  displayName: string | null;
  nationality: string | null;
};

async function stayRows(h: Hotel, reservationId: string): Promise<Row[]> {
  const res = await call('GET', propUrl(h.propertyId, `/reservations/${reservationId}/form-c`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { rows: Row[] }).rows;
}

async function register(h: Hotel, filter?: string): Promise<Row[]> {
  const res = await call('GET', propUrl(h.propertyId, `/form-c${filter ? `?filter=${filter}` : ''}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { rows: Row[] }).rows;
}

async function readPerson(h: Hotel, recordId: string) {
  return call('GET', propUrl(h.propertyId, `/form-c/${recordId}`));
}

async function markFiled(h: Hotel, recordId: string, reference: string, key = `filed-${recordId}`) {
  return call('POST', propUrl(h.propertyId, `/form-c/${recordId}/filed`), { reference, idempotencyKey: key });
}

async function remove(h: Hotel, recordId: string, reason: string, key = `rm-${recordId}`) {
  return call('POST', propUrl(h.propertyId, `/form-c/${recordId}/remove`), { reason, idempotencyKey: key });
}

describe('Form C: check-in creates the booked guest row', () => {
  it('creates one TO_FILE row at check-in + 24h for a foreign passport; none for an Indian passport, no passport, or outside India', async () => {
    const orgId = await newOrg('ci');
    const india = await addHotel(orgId, 'in');
    const abroad = await addHotel(orgId, 'out', { india: false });

    const foreign = await guest(india, 'ZA');
    const reservationId = await book(india, foreign);
    const rows = await stayRows(india, reservationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recordId: `fcb_${reservationId}`,
      kind: 'BOOKED_GUEST',
      status: 'TO_FILE',
      detailsSaved: false,
      overdue: false,
      displayName: null,
      nationality: null,
    });
    const read = await readPerson(india, `fcb_${reservationId}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { checkedInAt: number; deadlineAt: number; fields: unknown };
    expect(body.fields).toBeNull();
    expect(body.deadlineAt).toBe(body.checkedInAt + FORM_C_DEADLINE_MS);
    expect(await orgOf(orgId).countFormCAccessForTest(`fcb_${reservationId}`)).toBe(0);

    // A replayed check-in creates no second row.
    const input = { reservationId, roomId: `rm_${((sequence - 1) % 4) + 1}` };
    expect(
      await india.stub.tryCheckIn(TEST_OWNER_ACTOR, input, await idemFor(`ci-${reservationId}`, input)),
    ).toMatchObject({ ok: true });
    expect(await stayRows(india, reservationId)).toHaveLength(1);

    const indian = await guest(india, 'IN', 'Asha Rao');
    expect(await stayRows(india, await book(india, indian))).toEqual([]);
    const noPassport = await guest(india, null, 'Plain Guest');
    expect(await stayRows(india, await book(india, noPassport))).toEqual([]);

    const abroadGuest = await guest(abroad, 'ZA');
    const abroadStay = await book(abroad, abroadGuest);
    expect(await abroad.stub.listFormCRowsForTest(abroadStay)).toEqual([]);
  });

  it('cancelling a check-in drops the unfiled row, and a re-check-in makes a fresh one', async () => {
    const orgId = await newOrg('cancel');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    expect((await save(h, reservationId, `fcb_${reservationId}`, 'BOOKED_GUEST')).status).toBe(200);
    const cancel = { reservationId };
    expect(
      await h.stub.tryCancelCheckIn(TEST_OWNER_ACTOR, cancel, await idemFor(`cancel-${reservationId}`, cancel)),
    ).toMatchObject({ ok: true });
    expect(await h.stub.listFormCRowsForTest(reservationId)).toEqual([]);
    expect(await orgOf(orgId).readFormCPersonRowForTest(`fcb_${reservationId}`)).toMatchObject({ removed: true, cipherBytes: 0 });
    await checkIn(h, reservationId, 'rm_1', '-again');
    const rows = await stayRows(h, reservationId);
    expect(rows).toMatchObject([{ recordId: `fcb_${reservationId}`, status: 'TO_FILE', detailsSaved: false }]);
    expect((await save(h, reservationId, `fcb_${reservationId}`, 'BOOKED_GUEST')).status).toBe(200);
    expect((await stayRows(h, reservationId))[0]).toMatchObject({ detailsSaved: true, displayName: 'Zanele Mokoena' });
  });
});

describe('Form C: one clock per stay', () => {
  it('gives two foreign nationals separate rows with the same deadline, and a late third the stay deadline', async () => {
    const orgId = await newOrg('clock');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    expect((await save(h, reservationId, `fcb_${reservationId}`, 'BOOKED_GUEST')).status).toBe(200);
    expect(
      (await save(h, reservationId, 'fca_one', 'ADDITIONAL', person({ surname: 'Ndlovu', givenNames: 'Thabo', passportNumber: 'AA1' }))).status,
    ).toBe(200);
    const rows = await stayRows(h, reservationId);
    expect(rows.map((r) => r.recordId)).toEqual([`fcb_${reservationId}`, 'fca_one']);
    expect(rows[0]!.deadlineAt).toBe(rows[1]!.deadlineAt);
    expect(rows.map((r) => r.displayName)).toEqual(['Zanele Mokoena', 'Thabo Ndlovu']);

    // The legal clock runs from arrival, not from data entry: a row added after the 24 hours
    // carries the stay's own deadline and is already overdue.
    const checkedInAt = Date.now() - 30 * 60 * 60 * 1000;
    await h.stub.setReservationCheckedInAtForTest(reservationId, checkedInAt);
    expect(
      (await save(h, reservationId, 'fca_late', 'ADDITIONAL', person({ surname: 'Dube', givenNames: 'Sipho', passportNumber: 'AA2' }))).status,
    ).toBe(200);
    const late = (await stayRows(h, reservationId)).find((r) => r.recordId === 'fca_late')!;
    expect(late.deadlineAt).toBe(checkedInAt + DAY_MS);
    expect(late.overdue).toBe(true);
    expect(rows[0]!.overdue).toBe(false);
  });
});

describe('Form C: tenancy (two properties, same org)', () => {
  it("keeps hotel B's records out of hotel A's register, stay reads and writes", async () => {
    const orgId = await newOrg('iso');
    const a = await addHotel(orgId, 'a');
    const b = await addHotel(orgId, 'b');
    const resA = await book(a, await guest(a, 'ZA', 'Alice Anders'));
    const resB = await book(b, await guest(b, 'ZA', 'Bruno Berg'));
    const recordB = `fcb_${resB}`;
    expect(
      (await save(b, resB, recordB, 'BOOKED_GUEST', person({ surname: 'Berg', givenNames: 'Bruno', passportNumber: 'BB777' }))).status,
    ).toBe(200);
    expect((await save(a, resA, `fcb_${resA}`, 'BOOKED_GUEST', person({ surname: 'Anders', givenNames: 'Alice' }))).status).toBe(200);
    const orgStub = orgOf(orgId);

    const registerA = await register(a, 'all');
    expect(registerA.map((r) => r.recordId)).toEqual([`fcb_${resA}`]);
    expect(JSON.stringify(registerA)).not.toContain('Berg');
    expect(await stayRows(b, resB)).toHaveLength(1);

    // The stay of hotel B does not exist at hotel A.
    const foreignStay = await call('GET', propUrl(a.propertyId, `/reservations/${resB}/form-c`));
    expect(foreignStay.status).toBe(404);

    const checkNoLeak = async (res: Response) => {
      expect(res.status).toBe(404);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(b.propertyId);
      expect(text).not.toContain('Berg');
      expect(text).not.toContain('BB777');
    };
    await checkNoLeak(await readPerson(a, recordB));
    await checkNoLeak(await markFiled(a, recordB, 'FC-1'));
    await checkNoLeak(await remove(a, recordB, 'wrong hotel'));
    // Saving over B's record id from A: A has no such row, so it would be a new row, and OrgDO
    // refuses an id that belongs to another property.
    await checkNoLeak(await save(a, resA, recordB, 'ADDITIONAL', person({ surname: 'Overwrite' })));

    // OrgDO side: a summary or an audited read for another property is a miss.
    expect(await orgStub.readFormCSummaries({ propertyId: a.propertyId, ids: [recordB] })).toEqual({
      ok: true,
      summaries: {},
    });
    expect(await orgStub.readFormCPerson({ id: recordB, propertyId: a.propertyId, actorUserId: ACTOR })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await orgStub.clearFormCPerson({ id: recordB, propertyId: a.propertyId })).toEqual({ ok: true, cleared: false });
    expect(await orgStub.countFormCAccessForTest(recordB)).toBe(0);

    // B's record is untouched.
    const stillB = await readPerson(b, recordB);
    expect(stillB.status).toBe(200);
    expect(((await stillB.json()) as { fields: { surname: string } }).fields.surname).toBe('Berg');
  });
});

describe('Form C: save rules', () => {
  it('refuses an Indian national, unknown keys, a second booked guest, a ninth row and a stay that is not in house', async () => {
    const orgId = await newOrg('save');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const bookedId = `fcb_${reservationId}`;

    const indian = await save(h, reservationId, 'fca_in', 'ADDITIONAL', person({ nationality: 'IN' }));
    expect(indian.status).toBe(422);
    expect(await indian.json()).toMatchObject({ error: 'form_c_not_foreign' });

    const unknown = await save(h, reservationId, 'fca_unknown', 'ADDITIONAL', person({ nickname: 'Z' }));
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ error: 'validation_error' });
    const tooLong = await save(h, reservationId, 'fca_long', 'ADDITIONAL', person({ remarks: 'x'.repeat(201) }));
    expect(tooLong.status).toBe(422);

    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST')).status).toBe(200);
    const second = await save(h, reservationId, 'fcb_second', 'BOOKED_GUEST');
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({ error: 'form_c_booked_guest_exists' });

    for (let i = 1; i <= 7; i += 1) {
      const res = await save(h, reservationId, `fca_${i}`, 'ADDITIONAL', person({ passportNumber: `P${i}` }));
      expect(res.status).toBe(200);
    }
    const ninth = await save(h, reservationId, 'fca_9', 'ADDITIONAL');
    expect(ninth.status).toBe(422);
    expect(await ninth.json()).toMatchObject({ error: 'limit_exceeded' });

    // Same id, other kind or other stay: a miss.
    const wrongKind = await save(h, reservationId, 'fca_1', 'BOOKED_GUEST');
    expect(wrongKind.status).toBe(404);

    const confirmed = await book(h, await guest(h, null, 'Not Yet'), { checkIn: false });
    const notInHouse = await save(h, confirmed, 'fca_pre', 'ADDITIONAL');
    expect(notInHouse.status).toBe(422);
    expect(await notInHouse.json()).toMatchObject({ error: 'form_c_not_in_house' });
    const missingStay = await save(h, 'res_missing', 'fca_x', 'ADDITIONAL');
    expect(missingStay.status).toBe(404);
  });

  it('lets an unfiled row be edited after checkout, but not a new row added', async () => {
    const orgId = await newOrg('late');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'), { nights: 1 });
    const bookedId = `fcb_${reservationId}`;
    const out = { reservationId };
    await h.stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
    expect(await h.stub.tryCheckOut(TEST_OWNER_ACTOR, out, await idemFor(`co-${reservationId}`, out))).toMatchObject({
      ok: true,
    });
    const edit = await save(h, reservationId, bookedId, 'BOOKED_GUEST', person({ portOfArrival: 'Mumbai' }));
    expect(edit.status).toBe(200);
    const read = await readPerson(h, bookedId);
    expect(((await read.json()) as { fields: { portOfArrival: string } }).fields.portOfArrival).toBe('Mumbai');
    const added = await save(h, reservationId, 'fca_after', 'ADDITIONAL');
    expect(added.status).toBe(422);
    expect(await added.json()).toMatchObject({ error: 'form_c_not_in_house' });
    // Late filing still works.
    expect((await markFiled(h, bookedId, 'FC 2026/11')).status).toBe(200);
  });

  it('replaces the details of a TO_FILE row and refuses an edit once it is filed', async () => {
    const orgId = await newOrg('edit');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const bookedId = `fcb_${reservationId}`;
    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST')).status).toBe(200);
    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST', person({ surname: 'Khumalo' }))).status).toBe(200);
    expect((await stayRows(h, reservationId))[0]).toMatchObject({ displayName: 'Zanele Khumalo' });
    expect((await markFiled(h, bookedId, 'FC-77')).status).toBe(200);
    const after = await save(h, reservationId, bookedId, 'BOOKED_GUEST', person({ surname: 'Late' }));
    expect(after.status).toBe(422);
    expect(await after.json()).toMatchObject({ error: 'form_c_already_filed' });
  });
});

describe('Form C: mark filed and remove', () => {
  it('needs saved details, files once, and cannot remove a filed row', async () => {
    const orgId = await newOrg('filed');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const bookedId = `fcb_${reservationId}`;

    const early = await markFiled(h, bookedId, 'FC-1');
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ error: 'form_c_details_missing' });
    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST')).status).toBe(200);

    const badRef = await markFiled(h, bookedId, '-bad ref!', 'bad-ref');
    expect(badRef.status).toBe(422);
    expect(await badRef.json()).toMatchObject({ error: 'validation_error' });

    const filed = await markFiled(h, bookedId, 'FC-2026/11-0042', 'filed-1');
    expect(filed.status).toBe(200);
    expect((await stayRows(h, reservationId))[0]).toMatchObject({
      status: 'FILED',
      filedReference: 'FC-2026/11-0042',
      overdue: false,
    });
    const again = await markFiled(h, bookedId, 'FC-OTHER', 'filed-2');
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({ error: 'form_c_already_filed' });
    const removeFiled = await remove(h, bookedId, 'oops', 'rm-filed');
    expect(removeFiled.status).toBe(422);
    expect(await removeFiled.json()).toMatchObject({ error: 'form_c_already_filed' });
    expect((await register(h, 'filed')).map((r) => r.recordId)).toEqual([bookedId]);
    expect(await register(h, 'to_file')).toEqual([]);
  });

  it('removes an unfiled row with a reason, clears the sealed details, and then it is a 404', async () => {
    const orgId = await newOrg('rm');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    expect((await save(h, reservationId, 'fca_rm', 'ADDITIONAL')).status).toBe(200);
    const noReason = await remove(h, 'fca_rm', '   ', 'rm-empty');
    expect(noReason.status).toBe(422);
    expect((await remove(h, 'fca_rm', 'left before arrival', 'rm-ok')).status).toBe(200);
    expect(await orgOf(orgId).readFormCPersonRowForTest('fca_rm')).toMatchObject({ removed: true, cipherBytes: 0 });
    expect((await stayRows(h, reservationId)).map((r) => r.recordId)).not.toContain('fca_rm');
    expect((await readPerson(h, 'fca_rm')).status).toBe(404);
    expect((await markFiled(h, 'fca_rm', 'FC-1', 'filed-removed')).status).toBe(404);
    expect(await h.stub.listFormCRowsForTest(reservationId)).toContainEqual(
      expect.objectContaining({ id: 'fca_rm', status: 'REMOVED', removedReason: 'left before arrival' }),
    );
  });
});

describe('Form C: audited reads', () => {
  it('writes one form_c_access row per person read and none for the register or the stay list', async () => {
    const orgId = await newOrg('audit');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const bookedId = `fcb_${reservationId}`;
    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST')).status).toBe(200);
    const org = orgOf(orgId);
    await register(h);
    await register(h, 'all');
    await stayRows(h, reservationId);
    expect(await org.countFormCAccessForTest(bookedId)).toBe(0);
    const read = await readPerson(h, bookedId);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { fields: { passportNumber: string } }).fields.passportNumber).toBe('ZZ9988776');
    expect(await org.countFormCAccessForTest(bookedId)).toBe(1);
    await readPerson(h, bookedId);
    expect(await org.countFormCAccessForTest(bookedId)).toBe(2);
    // A row with no details has nothing to read, so nothing is logged.
    const second = await book(h, await guest(h, 'ZA', 'Second Guest'));
    await readPerson(h, `fcb_${second}`);
    expect(await org.countFormCAccessForTest(`fcb_${second}`)).toBe(0);
  });
});

describe('Form C: not a guest profile', () => {
  it('adds no guest directory row or search hit, no event carries a Form C field, and ADDITIONAL has no guest_ref', async () => {
    const orgId = await newOrg('dir');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA', 'Host Guest'));
    const org = orgOf(orgId);
    const before = await org.listGuests(TEST_OWNER_ACTOR, h.propertyId, { limit: 50 });
    if (!before.ok) throw new Error('list failed');
    expect(
      (
        await save(
          h,
          reservationId,
          'fca_dir',
          'ADDITIONAL',
          person({ surname: 'Quenzelmann', givenNames: 'Bartholomew', passportNumber: 'QQ4242', remarks: 'quiet room' }),
        )
      ).status,
    ).toBe(200);
    expect((await save(h, reservationId, `fcb_${reservationId}`, 'BOOKED_GUEST')).status).toBe(200);
    const after = await org.listGuests(TEST_OWNER_ACTOR, h.propertyId, { limit: 50 });
    if (!after.ok) throw new Error('list failed');
    expect(after.items.map((i) => i.guestId)).toEqual(before.items.map((i) => i.guestId));
    for (const q of ['Quenzelmann', 'Bartholomew', 'QQ4242']) {
      const hit = await org.searchGuests(TEST_OWNER_ACTOR, h.propertyId, { q, limit: 20 });
      if (!hit.ok) throw new Error('search failed');
      expect(hit.items).toEqual([]);
    }
    expect(await org.readFormCPersonRowForTest('fca_dir')).toMatchObject({ guestRef: null, removed: false });
    expect((await org.readFormCPersonRowForTest(`fcb_${reservationId}`))?.guestRef).not.toBeNull();

    const outbox = JSON.stringify([
      ...(await org.listOutboxPayloads()),
      ...(await h.stub.listOutboxPayloads()),
    ]);
    for (const needle of ['Quenzelmann', 'Bartholomew', 'QQ4242', 'ZZ9988776', 'quiet room', 'fca_dir']) {
      expect(outbox).not.toContain(needle);
    }
    const types = [...(await org.listOutboxEventTypes()), ...(await h.stub.listOutboxEventTypes())];
    expect(types.some((t) => /form_?c/i.test(t))).toBe(false);
  });
});

describe('Form C: idempotency', () => {
  it('replays the first result, rejects the key with other fields, and keys on the command', async () => {
    const orgId = await newOrg('idem');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const first = await save(h, reservationId, 'fca_idem', 'ADDITIONAL', person(), 'same-key');
    expect(first.status).toBe(200);
    const replay = await save(h, reservationId, 'fca_idem', 'ADDITIONAL', person(), 'same-key');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const clash = await save(h, reservationId, 'fca_idem', 'ADDITIONAL', person({ surname: 'Other' }), 'same-key');
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: 'idempotency_key_reused' });
    expect(await h.stub.listFormCRowsForTest(reservationId)).toHaveLength(2);

    const payload = { recordId: 'fca_idem', reference: 'X' };
    expect(await commandFingerprint('form_c.mark_filed', payload)).not.toBe(await fingerprintPayload(payload));
    expect(await commandFingerprint('form_c.mark_filed', payload)).not.toBe(
      await commandFingerprint('form_c.remove_person', payload),
    );
    expect((await markFiled(h, 'fca_idem', 'FC-9', 'shared')).status).toBe(200);
    const crossCommand = await remove(h, 'fca_idem', 'FC-9', 'shared');
    expect(crossCommand.status).toBe(409);
  });

  it('keys per user: another user with the same key does not replay the first result', async () => {
    const orgId = await newOrg('user');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const first = await save(h, reservationId, 'fca_u1', 'ADDITIONAL', person(), 'shared-key');
    expect(first.status).toBe(200);
    const input = { recordId: 'fca_u2', reservationId, kind: 'ADDITIONAL' as const, fields: person() };
    const other = await h.stub.trySaveFormCPerson(
      { kind: 'user', userId: 'someone_else' },
      input as never,
      await idemFor('shared-key', input),
    );
    // Not a member of the org: never the first user's cached response.
    expect(other).not.toEqual(await first.clone().json());
    expect(other.ok).toBe(false);
  });
});

describe('Form C: night audit check', () => {
  it('counts only TO_FILE rows past their deadline, and the severity is configurable', async () => {
    const orgId = await newOrg('audit');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    const bookedId = `fcb_${reservationId}`;
    expect((await save(h, reservationId, bookedId, 'BOOKED_GUEST')).status).toBe(200);
    expect((await save(h, reservationId, 'fca_a', 'ADDITIONAL', person({ passportNumber: 'A1' }))).status).toBe(200);
    expect((await save(h, reservationId, 'fca_b', 'ADDITIONAL', person({ passportNumber: 'A2' }))).status).toBe(200);
    const countOf = async () => {
      const status = await h.stub.readNightAuditStatus();
      if (!status.ok) throw new Error('status');
      return status.checks.find((c) => c.checkId === 'form_c_overdue');
    };
    expect(await countOf()).toMatchObject({ severity: 'warn', count: 0 });

    await h.stub.setFormCDeadlineForTest(bookedId, Date.now() - 1000);
    await h.stub.setFormCDeadlineForTest('fca_a', Date.now() - 1000);
    expect(await countOf()).toMatchObject({ count: 2 });
    expect((await register(h, 'overdue')).map((r) => r.recordId).sort()).toEqual([bookedId, 'fca_a'].sort());

    expect((await markFiled(h, bookedId, 'FC-1')).status).toBe(200);
    expect(await countOf()).toMatchObject({ count: 1 });
    expect((await remove(h, 'fca_a', 'duplicate entry')).status).toBe(200);
    expect(await countOf()).toMatchObject({ count: 0 });

    await h.stub.setFormCDeadlineForTest('fca_b', Date.now() - 1000);
    await h.stub.writeConfigValueForTest('pms.night_audit.checks', { form_c_overdue: 'fail' });
    expect(await countOf()).toMatchObject({ severity: 'fail', count: 1 });
    await h.stub.writeConfigValueForTest('pms.night_audit.checks', { form_c_overdue: 'off' });
    expect(await countOf()).toMatchObject({ severity: 'off', count: null });
  });
});

describe('Form C: not India', () => {
  it('every write is form_c_not_applicable and reads show nothing', async () => {
    const orgId = await newOrg('abroad');
    const h = await addHotel(orgId, 'out', { india: false });
    const reservationId = await book(h, await guest(h, 'ZA'));
    const saved = await save(h, reservationId, 'fca_x', 'ADDITIONAL');
    expect(saved.status).toBe(422);
    expect(await saved.json()).toMatchObject({ error: 'form_c_not_applicable' });
    const filed = await markFiled(h, 'fca_x', 'FC-1');
    expect(filed.status).toBe(422);
    expect(await filed.json()).toMatchObject({ error: 'form_c_not_applicable' });
    const removed = await remove(h, 'fca_x', 'no');
    expect(removed.status).toBe(422);
    expect(await removed.json()).toMatchObject({ error: 'form_c_not_applicable' });
    expect(await register(h, 'all')).toEqual([]);
    expect(await orgOf(orgId).readFormCPersonRowForTest('fca_x')).toBeNull();

    // The property read is what the SPA uses to show or hide every Form C surface.
    const read = async (hotel: Hotel) =>
      ((await (await call('GET', propUrl(hotel.propertyId))).json()) as { formCApplicable: boolean }).formCApplicable;
    expect(await read(h)).toBe(false);
    const india = await addHotel(orgId, 'in');
    expect(await read(india)).toBe(true);
  });
});

describe('Form C: route guards', () => {
  it('rejects a bad filter, a bad body and a malformed JSON body', async () => {
    const orgId = await newOrg('guard');
    const h = await addHotel(orgId, 'in');
    const reservationId = await book(h, await guest(h, 'ZA'));
    expect((await call('GET', propUrl(h.propertyId, '/form-c?filter=nope'))).status).toBe(422);
    const extra = await call('POST', propUrl(h.propertyId, `/reservations/${reservationId}/form-c`), {
      recordId: 'fca_g',
      kind: 'ADDITIONAL',
      fields: person(),
      idempotencyKey: 'g1',
      extra: true,
    });
    expect(extra.status).toBe(422);
    const badKind = await save(h, reservationId, 'fca_g', 'GUEST' as never);
    expect(badKind.status).toBe(422);
    const badId = await save(h, reservationId, 'bad id!', 'ADDITIONAL');
    expect(badId.status).toBe(400);
    const malformed = await worker.fetch(
      new Request(propUrl(h.propertyId, `/reservations/${reservationId}/form-c`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: '{not json',
      }),
      env,
    );
    expect(malformed.status).toBe(400);
  });
});
