import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUEST_SETTINGS,
  ROOM_PREFERENCE_CODES,
  SCAN_MAX_BYTES,
  type DomainEventMessage,
  type EventSource,
} from '@hospai/contracts';
import { consumerIdempotencyKey, toQueueMessage } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { EventRetryMessage, PmsEnv } from '../src/env.js';
import { assertEventContract } from '../src/event-consumer.js';
import { listEventLogKeys } from '../src/event-log.js';
import { sha256Hex } from '../src/guest-documents.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { seedSubscription } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures.js';

const ACTOR = 'user_owner';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11]);
const JPEG_NEXT = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x22]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function postOrg(orgId: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({ orgId, name: 'Docs Org' }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({ propertyId, name: 'Docs Hotel', timeZone: 'UTC', currency: 'USD' }),
    }),
    env,
  );
}

async function provision(label: string) {
  const orgId = `org_${label}_${crypto.randomUUID().slice(0, 8)}`;
  const propertyId = `prop_${label}_${crypto.randomUUID().slice(0, 8)}`;
  expect((await postOrg(orgId)).status).toBe(201);
  expect((await postProperty(orgId, propertyId)).status).toBe(201);
  return { orgId, propertyId };
}

function orgOf(orgId: string) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

async function createGuest(propertyId: string, guestId: string, extra: Record<string, unknown> = {}) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        guestId,
        displayName: 'Ada Guest',
        idempotencyKey: `guest-${guestId}`,
        ...extra,
      }),
    }),
    env,
  );
}

function docUrl(propertyId: string, guestRef: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestRef)}${suffix}`;
}

async function addPassport(propertyId: string, guestRef: string, documentId: string, key: string, number = 'AB123456') {
  return worker.fetch(
    new Request(docUrl(propertyId, guestRef, '/documents'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        documentId,
        kind: 'PASSPORT',
        fields: { number, issuingCountry: 'US', nationality: 'US' },
        idempotencyKey: key,
      }),
    }),
    env,
  );
}

function queueRunner() {
  return worker.queue as (
    batch: MessageBatch<DomainEventMessage>,
    queueEnv: PmsEnv,
    ctx: ExecutionContext,
  ) => Promise<void>;
}

async function deliverMessages(messages: DomainEventMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const batch = createMessageBatch(
    'hospai-events',
    messages.map((body) => ({
      id: body.eventId,
      timestamp: new Date(body.createdAt),
      attempts: 1,
      body,
    })),
  );
  const ctx = createExecutionContext();
  await queueRunner()(batch as MessageBatch<DomainEventMessage>, env, ctx);
  await getQueueResult(batch, ctx);
}

async function dispatchOrgOutbox(org: DurableObjectStub<OrgDO>, source: EventSource): Promise<DomainEventMessage[]> {
  const rows = await org.drainOutboxBatch();
  if (rows.length === 0) return [];
  const messages = rows.map((row) => toQueueMessage(row, source));
  await deliverMessages(messages);
  return messages;
}

async function guestDocKeys(prefix: string): Promise<string[]> {
  if (!env.GUEST_DOCS_R2) throw new Error('GUEST_DOCS_R2 unbound');
  return listEventLogKeys(env.GUEST_DOCS_R2, prefix);
}

async function putScan(
  propertyId: string,
  guestRef: string,
  documentId: string,
  key: string,
  bytes: Uint8Array,
  contentType = 'image/jpeg',
) {
  return worker.fetch(
    new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/scan`), {
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-dev-actor': ACTOR, 'x-idempotency-key': key },
      body: bytes,
    }),
    env,
  );
}

async function bookConfirmed(propertyId: string, guestRef: string, reservationId: string) {
  const roomType = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 4,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `rt-${propertyId}`,
      }),
    }),
    env,
  );
  expect(roomType.status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  const businessDate = await resolved.stub.readBusinessDate();
  if (!businessDate) throw new Error('business date unset');
  await seedBarRatesForHorizon(resolved.stub, 'rt_king', businessDate);
  expect(
    await resolved.stub.tryCreateRoom(
      TEST_OWNER_ACTOR,
      { roomId: 'rm_1', roomTypeId: 'rt_king', code: '101' },
      await idemFor(`room-${propertyId}`, { roomId: 'rm_1' }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await resolved.stub.tryCreateReservation(
      TEST_OWNER_ACTOR,
      {
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: businessDate,
        departureDate: addCalendarDays(businessDate, 1),
      },
      await idemFor(`book-${reservationId}`, { reservationId }),
    ),
  ).toMatchObject({ ok: true });
  return resolved;
}

describe('guest documents, preferences, and consent', () => {
  it('records a passport, lists without the number, and logs one read', async () => {
    const { orgId, propertyId } = await provision('doc');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    const created = await addPassport(propertyId, guestRef, documentId, `add-${documentId}`);
    expect(created.status).toBe(200);
    const listed = await worker.fetch(new Request(docUrl(propertyId, guestRef, '/documents'), { headers: { 'x-dev-actor': ACTOR } }), env);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      documents: Array<{ id: string; kind: string }>;
      requireIdAtCheckIn: boolean;
    };
    expect(listBody.documents.map((row) => row.id)).toEqual([documentId]);
    expect(listBody.requireIdAtCheckIn).toBe(false);
    expect(JSON.stringify(listBody)).not.toContain('AB123456');
    const org = orgOf(orgId);
    expect(await org.countGuestDocumentAccessForTest(documentId)).toBe(0);
    const read = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}`), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { fields: { number: string } };
    expect(readBody.fields.number).toBe('AB123456');
    expect(await org.countGuestDocumentAccessForTest(documentId)).toBe(1);
    const again = await addPassport(propertyId, guestRef, documentId, `add-${documentId}`);
    expect(again.status).toBe(200);
    const clash = await addPassport(propertyId, guestRef, documentId, `other-${documentId}`, 'ZZ999');
    expect(clash.status).toBe(422);
  });

  it('hides a document recorded at the other property', async () => {
    const orgId = `org_iso_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_iso_${crypto.randomUUID().slice(0, 8)}`;
    const propertyB = `prop_b_${crypto.randomUUID().slice(0, 8)}`;
    expect((await postOrg(orgId)).status).toBe(201);
    await seedSubscription(env, orgId, 'group');
    expect((await postProperty(orgId, propertyId)).status).toBe(201);
    expect((await postProperty(orgId, propertyB)).status).toBe(201);
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const org = orgOf(orgId);
    expect(await org.upsertGuestPropertyAssociation(TEST_OWNER_ACTOR, propertyB, guestRef)).toEqual({ ok: true });
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    expect((await addPassport(propertyB, guestRef, documentId, `b-${documentId}`)).status).toBe(200);
    const fromA = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}`), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(fromA.status).toBe(404);
    const body = JSON.stringify(await fromA.json());
    expect(body).not.toContain(propertyB);
    expect(body).not.toContain('AB123456');
    const listA = await worker.fetch(new Request(docUrl(propertyId, guestRef, '/documents'), { headers: { 'x-dev-actor': ACTOR } }), env);
    const listABody = (await listA.json()) as { documents: unknown[] };
    expect(listABody.documents).toEqual([]);
    const listB = await worker.fetch(new Request(docUrl(propertyB, guestRef, '/documents'), { headers: { 'x-dev-actor': ACTOR } }), env);
    const listBBody = (await listB.json()) as { documents: Array<{ id: string }> };
    expect(listBBody.documents.map((row) => row.id)).toEqual([documentId]);
    expect((await putScan(propertyB, guestRef, documentId, `scan-b-${documentId}`, JPEG)).status).toBe(200);
    const scanA = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/scan`), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(scanA.status).toBe(404);
    const scanBody = JSON.stringify(await scanA.json());
    expect(scanBody).not.toContain(propertyB);
    expect(scanBody).not.toContain('AB123456');
    const removeA = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/remove`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ reason: 'wrong hotel', idempotencyKey: `rm-a-${documentId}` }),
      }),
      env,
    );
    expect(removeA.status).toBe(404);
    const removeBody = JSON.stringify(await removeA.json());
    expect(removeBody).not.toContain(propertyB);
    expect(removeBody).not.toContain('AB123456');
    expect(
      await org.tryPutGuestSettings(
        TEST_OWNER_ACTOR,
        { value: { ...DEFAULT_GUEST_SETTINGS, consentNoticeVersion: 'notice-2026.1' }, reason: 'publish notice' },
        await idemFor(`notice-${orgId}`, { notice: 'notice-2026.1' }),
      ),
    ).toMatchObject({ ok: true });
    const granted = await worker.fetch(
      new Request(docUrl(propertyB, guestRef, '/consent'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ purpose: 'MARKETING_EMAIL', status: 'GRANTED', source: 'DESK', idempotencyKey: `c-${documentId}` }),
      }),
      env,
    );
    expect(granted.status).toBe(200);
    const consentA = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/consent'), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(consentA.status).toBe(200);
    const consentBody = (await consentA.json()) as {
      current: { MARKETING_EMAIL: { status: string } | null };
      history: Array<{ recordedHere: boolean }>;
    };
    expect(consentBody.current.MARKETING_EMAIL).toMatchObject({ status: 'GRANTED' });
    expect(consentBody.history[0]).toMatchObject({ recordedHere: false });
    const consentJson = JSON.stringify(consentBody);
    expect(consentJson).not.toContain(propertyB);
    expect(consentJson).not.toContain('propertyId');
  });

  it('rejects an Aadhaar number and an Aadhaar scan', async () => {
    const { propertyId } = await provision('aad');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const full = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/documents'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          documentId: 'doc_aadhaar',
          kind: 'AADHAAR',
          fields: { number: '123412341234', numberLast4: '1234' },
          idempotencyKey: 'aad-full',
        }),
      }),
      env,
    );
    expect(full.status).toBe(422);
    expect(await full.json()).toMatchObject({ error: 'aadhaar_full_number_not_allowed' });
    const ok = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/documents'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          documentId: 'doc_aadhaar',
          kind: 'AADHAAR',
          fields: { numberLast4: '1234' },
          idempotencyKey: 'aad-ok',
        }),
      }),
      env,
    );
    expect(ok.status).toBe(200);
    const scan = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/documents/doc_aadhaar/scan'), {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-dev-actor': ACTOR, 'x-idempotency-key': 'aad-scan' },
        body: JPEG,
      }),
      env,
    );
    expect(scan.status).toBe(422);
    expect(await scan.json()).toMatchObject({ error: 'aadhaar_scan_not_allowed' });
  });

  it('stores a jpeg scan and downloads it under the document id', async () => {
    const { orgId, propertyId } = await provision('scan');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const documentId = 'doc_scan';
    expect((await addPassport(propertyId, guestRef, documentId, 'scan-add')).status).toBe(200);
    const put = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/scan`), {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-dev-actor': ACTOR, 'x-idempotency-key': 'scan-1' },
        body: JPEG,
      }),
      env,
    );
    expect(put.status).toBe(200);
    const bad = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/scan`), {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'x-dev-actor': ACTOR, 'x-idempotency-key': 'scan-bad' },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      env,
    );
    expect(bad.status).toBe(422);
    const got = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/scan`), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toContain('image/jpeg');
    expect(got.headers.get('content-disposition')).toContain(`document-${documentId}.jpg`);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(JPEG));
    expect(await orgOf(orgId).countGuestDocumentAccessForTest(documentId)).toBe(1);
  });

  it('removes a document only with a reason and keeps the access row', async () => {
    const { orgId, propertyId } = await provision('rm');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef, { notes: 'window seat' })).status).toBe(200);
    const documentId = 'doc_rm';
    expect((await addPassport(propertyId, guestRef, documentId, 'rm-add')).status).toBe(200);
    await worker.fetch(new Request(docUrl(propertyId, guestRef, `/documents/${documentId}`), { headers: { 'x-dev-actor': ACTOR } }), env);
    const removed = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/remove`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ reason: 'expired', idempotencyKey: 'rm-1' }),
      }),
      env,
    );
    expect(removed.status).toBe(200);
    const after = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}`), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(after.status).toBe(404);
    expect(await orgOf(orgId).countGuestDocumentAccessForTest(documentId)).toBe(1);
  });

  it('keeps notes when a preferences patch omits them', async () => {
    const { propertyId } = await provision('pref');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef, { notes: 'allergic to feathers' })).status).toBe(200);
    const patched = await worker.fetch(
      new Request(docUrl(propertyId, guestRef), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          displayName: 'Ada Guest',
          preferences: { bedding: ['FEATHER_FREE'] },
          idempotencyKey: 'pref-1',
        }),
      }),
      env,
    );
    expect(patched.status).toBe(200);
    const got = await worker.fetch(new Request(docUrl(propertyId, guestRef), { headers: { 'x-dev-actor': ACTOR } }), env);
    const body = (await got.json()) as { profile: { notes?: string; preferences?: { bedding?: string[] } } };
    expect(body.profile.notes).toBe('allergic to feathers');
    expect(body.profile.preferences?.bedding).toEqual(['FEATHER_FREE']);
  });

  it('refuses consent until a notice version is configured, then appends', async () => {
    const { orgId, propertyId } = await provision('consent');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const early = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/consent'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ purpose: 'MARKETING_EMAIL', status: 'GRANTED', source: 'DESK', idempotencyKey: 'c1' }),
      }),
      env,
    );
    expect(early.status).toBe(422);
    expect(await early.json()).toMatchObject({ error: 'consent_notice_not_configured' });
    const org = orgOf(orgId);
    const settings = await org.tryPutGuestSettings(
      TEST_OWNER_ACTOR,
      { value: { ...DEFAULT_GUEST_SETTINGS, consentNoticeVersion: 'notice-2026.1' }, reason: 'publish notice' },
      await idemFor('settings-consent', { notice: 'notice-2026.1' }),
    );
    expect(settings.ok).toBe(true);
    const granted = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/consent'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          purpose: 'MARKETING_EMAIL',
          status: 'GRANTED',
          source: 'DESK',
          noticeVersion: 'client',
          idempotencyKey: 'c2',
        }),
      }),
      env,
    );
    expect(granted.status).toBe(422);
    const ok = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/consent'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ purpose: 'MARKETING_EMAIL', status: 'GRANTED', source: 'DESK', idempotencyKey: 'c3' }),
      }),
      env,
    );
    expect(ok.status).toBe(200);
    const read = await worker.fetch(new Request(docUrl(propertyId, guestRef, '/consent'), { headers: { 'x-dev-actor': ACTOR } }), env);
    const body = (await read.json()) as { current: { MARKETING_EMAIL: { status: string; noticeVersion: string } } };
    expect(body.current.MARKETING_EMAIL).toMatchObject({ status: 'GRANTED', noticeVersion: 'notice-2026.1' });
  });

  it('blocks check-in without an ID when required, then the consumer sets the flag', async () => {
    const { orgId, propertyId } = await provision('gate');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const roomType = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          roomCount: 4,
          maxOccupancy: 2,
          maxAdults: 2,
          idempotencyKey: `rt-${propertyId}`,
        }),
      }),
      env,
    );
    expect(roomType.status).toBe(201);
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    if (!resolved) throw new Error('property missing');
    const businessDate = await resolved.stub.readBusinessDate();
    if (!businessDate) throw new Error('business date unset');
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', businessDate);
    expect(
      await resolved.stub.tryCreateRoom(
        TEST_OWNER_ACTOR,
        { roomId: 'rm_1', roomTypeId: 'rt_king', code: '101' },
        await idemFor(`room-${propertyId}`, { roomId: 'rm_1' }),
      ),
    ).toMatchObject({ ok: true });
    const reservationId = `res_${propertyId.slice(-6)}`;
    expect(
      await resolved.stub.tryCreateReservation(
        TEST_OWNER_ACTOR,
        {
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: businessDate,
          departureDate: addCalendarDays(businessDate, 1),
        },
        await idemFor(`book-${reservationId}`, { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    const org = orgOf(orgId);
    expect(
      await org.tryPutGuestSettings(
        TEST_OWNER_ACTOR,
        { value: { ...DEFAULT_GUEST_SETTINGS, requireIdAtCheckIn: true }, reason: 'require id' },
        await idemFor(`id-on-${propertyId}`, { on: true }),
      ),
    ).toMatchObject({ ok: true });
    const listed = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, '/documents'), { headers: { 'x-dev-actor': ACTOR } }),
      env,
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { requireIdAtCheckIn: boolean; documents: unknown[] };
    expect(listedBody.requireIdAtCheckIn).toBe(true);
    expect(listedBody.documents).toEqual([]);
    const idem = await idemFor(`ci-${reservationId}`, { reservationId, roomId: 'rm_1' });
    const blocked = await resolved.stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId, roomId: 'rm_1' }, idem);
    expect(blocked).toMatchObject({ ok: false, error: 'id_document_required' });
    expect((await addPassport(propertyId, guestRef, 'doc_gate', 'gate-doc')).status).toBe(200);
    await dispatchOrgOutbox(org, { do: 'org', id: orgId });
    const stay = await resolved.stub.readReservation(reservationId);
    expect(stay.ok).toBe(true);
    const checked = await resolved.stub.tryCheckIn(TEST_OWNER_ACTOR, { reservationId, roomId: 'rm_1' }, idem);
    expect(checked).toMatchObject({ ok: true, reservationId });
    const after = await resolved.stub.readReservation(reservationId);
    if (!after.ok) throw new Error('stay missing');
    expect(after.reservation.status).toBe('checked_in');
    const checks = await resolved.stub.readNightAuditStatus();
    if (!checks.ok) throw new Error('checks missing');
    const missing = checks.checks.find((row) => row.checkId === 'id_proof_missing');
    expect(missing).toMatchObject({ count: 0 });
  });

  it('fails closed when the org cannot be reached', async () => {
    const { orgId, propertyId } = await provision('down');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    if (!resolved) throw new Error('property missing');
    const businessDate = await resolved.stub.readBusinessDate();
    if (!businessDate) throw new Error('business date unset');
    const roomType = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({
          roomTypeId: 'rt_king',
          code: 'KNG',
          name: 'King',
          roomCount: 2,
          maxOccupancy: 2,
          maxAdults: 2,
          idempotencyKey: `rt-${propertyId}`,
        }),
      }),
      env,
    );
    expect(roomType.status).toBe(201);
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', businessDate);
    const reservationId = 'res_down';
    expect(
      await resolved.stub.tryCreateReservation(
        TEST_OWNER_ACTOR,
        {
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: businessDate,
          departureDate: addCalendarDays(businessDate, 1),
        },
        await idemFor('book-down', { reservationId }),
      ),
    ).toMatchObject({ ok: true });
    const org = orgOf(orgId);
    await org.setTransportBlockedForTest(true);
    try {
      const result = await resolved.stub.tryCheckIn(
        TEST_OWNER_ACTOR,
        { reservationId },
        await idemFor('ci-down', { reservationId }),
      );
      expect(result).toMatchObject({ ok: false, error: 'org_unreachable' });
    } finally {
      await org.setTransportBlockedForTest(false);
    }
  });

  it('rejects an oversized or mistyped scan and deletes the previous object on replace and remove', async () => {
    const { orgId, propertyId } = await provision('scanlim');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    expect((await addPassport(propertyId, guestRef, documentId, `add-${documentId}`)).status).toBe(200);
    const listed = async () => {
      const res = await worker.fetch(
        new Request(docUrl(propertyId, guestRef, '/documents'), { headers: { 'x-dev-actor': ACTOR } }),
        env,
      );
      return (await res.json()) as { documents: Array<{ hasScan: boolean; scanContentType: string | null }> };
    };
    const before = await listed();
    const prefix = `guest-docs/${orgId}/${documentId}/`;
    const big = new Uint8Array(SCAN_MAX_BYTES + 1);
    big.set(JPEG);
    const over = await putScan(propertyId, guestRef, documentId, 'scan-over', big);
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ ok: false, error: 'limit_exceeded' });
    expect(await guestDocKeys(prefix)).toEqual([]);
    expect(await listed()).toEqual(before);
    const mistyped = await putScan(propertyId, guestRef, documentId, 'scan-png', PNG, 'application/pdf');
    expect(mistyped.status).toBe(422);
    expect(await mistyped.json()).toMatchObject({ ok: false, error: 'scan_type_not_allowed' });
    expect(await guestDocKeys(prefix)).toEqual([]);
    expect(await listed()).toEqual(before);

    const first = await putScan(propertyId, guestRef, documentId, 'scan-1', JPEG);
    expect(first.status).toBe(200);
    const digest = await sha256Hex(JPEG);
    const firstKeys = await guestDocKeys(prefix);
    expect(firstKeys).toHaveLength(1);
    expect(firstKeys[0]).not.toContain(digest);
    const replay = await putScan(propertyId, guestRef, documentId, 'scan-1', JPEG);
    expect(replay.status).toBe(200);
    expect(await guestDocKeys(prefix)).toEqual(firstKeys);
    const replaced = await putScan(propertyId, guestRef, documentId, 'scan-2', JPEG_NEXT);
    expect(replaced.status).toBe(200);
    const nextKeys = await guestDocKeys(prefix);
    expect(nextKeys).toHaveLength(1);
    expect(nextKeys).not.toEqual(firstKeys);
    expect(await env.GUEST_DOCS_R2!.head(firstKeys[0]!)).toBeNull();
    const removed = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/remove`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ reason: 'replaced', idempotencyKey: `rm-${documentId}` }),
      }),
      env,
    );
    expect(removed.status).toBe(200);
    expect(await guestDocKeys(prefix)).toEqual([]);
  });

  it('replays an add with the same key and rejects a different payload', async () => {
    const { propertyId } = await provision('idem');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    const first = await addPassport(propertyId, guestRef, documentId, 'same-key');
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const replay = await addPassport(propertyId, guestRef, documentId, 'same-key');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    const clash = await addPassport(propertyId, guestRef, `doc_${crypto.randomUUID().slice(0, 8)}`, 'same-key', 'ZZ999999');
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ ok: false, error: 'idempotency_key_reused' });
  });

  it('rejects unknown and oversized preferences and keeps them off the outbox', async () => {
    const { orgId, propertyId } = await provision('prefbad');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const patch = (preferences: unknown, key: string) =>
      worker.fetch(
        new Request(docUrl(propertyId, guestRef), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
          body: JSON.stringify({ displayName: 'Ada Guest', preferences, idempotencyKey: key }),
        }),
        env,
      );
    const unknown = await patch({ room: ['PENTHOUSE'] }, 'pref-unknown');
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ ok: false, error: 'validation_error' });
    const over = await patch({ room: [...ROOM_PREFERENCE_CODES, 'HIGH_FLOOR'] }, 'pref-over');
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ ok: false, error: 'limit_exceeded' });
    const saved = await patch({ dietary: ['JAIN'], other: 'aisle-not-window-9' }, 'pref-ok');
    expect(saved.status).toBe(200);
    const payloads = await orgOf(orgId).listOutboxPayloads();
    const forGuest = payloads.filter((row) => row.payload.includes(guestRef));
    expect(forGuest.length).toBeGreaterThan(0);
    const blob = JSON.stringify(forGuest);
    expect(blob).not.toContain('JAIN');
    expect(blob).not.toContain('aisle-not-window-9');
    expect(blob).not.toContain('PENTHOUSE');
  });

  it('refuses check-in when the only document is at the other property, then checks in with the flag off', async () => {
    const orgId = `org_xci_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_xci_${crypto.randomUUID().slice(0, 8)}`;
    const propertyB = `prop_xcb_${crypto.randomUUID().slice(0, 8)}`;
    expect((await postOrg(orgId)).status).toBe(201);
    await seedSubscription(env, orgId, 'group');
    expect((await postProperty(orgId, propertyId)).status).toBe(201);
    expect((await postProperty(orgId, propertyB)).status).toBe(201);
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const org = orgOf(orgId);
    expect(await org.upsertGuestPropertyAssociation(TEST_OWNER_ACTOR, propertyB, guestRef)).toEqual({ ok: true });
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    expect((await addPassport(propertyB, guestRef, documentId, `b-${documentId}`)).status).toBe(200);
    const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`;
    const resolved = await bookConfirmed(propertyId, guestRef, reservationId);
    const before = await resolved.stub.readReservation(reservationId);
    if (!before.ok) throw new Error('stay missing');
    expect(
      await org.tryPutGuestSettings(
        TEST_OWNER_ACTOR,
        { value: { ...DEFAULT_GUEST_SETTINGS, requireIdAtCheckIn: true }, reason: 'require id' },
        await idemFor(`id-on-${propertyId}`, { on: true }),
      ),
    ).toMatchObject({ ok: true });
    const blocked = await resolved.stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId: 'rm_1' },
      await idemFor(`ci-block-${reservationId}`, { reservationId }),
    );
    expect(blocked).toMatchObject({ ok: false, error: 'id_document_required' });
    const held = await resolved.stub.readReservation(reservationId);
    if (!held.ok) throw new Error('stay missing');
    expect(held.reservation.status).toBe(before.reservation.status);
    expect(held.reservation.updatedAt).toBe(before.reservation.updatedAt);
    expect(
      await org.tryPutGuestSettings(
        TEST_OWNER_ACTOR,
        { value: { ...DEFAULT_GUEST_SETTINGS, requireIdAtCheckIn: false }, reason: 'id optional' },
        await idemFor(`id-off-${propertyId}`, { on: false }),
      ),
    ).toMatchObject({ ok: true });
    const checked = await resolved.stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId: 'rm_1' },
      await idemFor(`ci-ok-${reservationId}`, { reservationId }),
    );
    expect(checked).toMatchObject({ ok: true, reservationId });
    expect(await resolved.stub.readIdDocumentOnFileForTest(reservationId)).toBe(0);
  });

  it('replays a document event after the scan state changes without a dead letter', async () => {
    const { orgId, propertyId } = await provision('flag');
    const guestRef = `guest_${crypto.randomUUID().slice(0, 8)}`;
    expect((await createGuest(propertyId, guestRef)).status).toBe(200);
    const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`;
    const resolved = await bookConfirmed(propertyId, guestRef, reservationId);
    const documentId = `doc_${crypto.randomUUID().slice(0, 8)}`;
    expect((await addPassport(propertyId, guestRef, documentId, `add-${documentId}`)).status).toBe(200);
    const org = orgOf(orgId);
    const delivered = await dispatchOrgOutbox(org, { do: 'org', id: orgId });
    const recorded = delivered.find((message) => message.eventType === 'guest.document_recorded');
    if (!recorded) throw new Error('recorded event missing');
    expect(await resolved.stub.readIdDocumentOnFileForTest(reservationId)).toBe(1);
    const stamped = await resolved.stub.readReservation(reservationId);
    if (!stamped.ok) throw new Error('stay missing');
    const removed = await worker.fetch(
      new Request(docUrl(propertyId, guestRef, `/documents/${documentId}/remove`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR },
        body: JSON.stringify({ reason: 'guest left the card', idempotencyKey: `rm-${documentId}` }),
      }),
      env,
    );
    expect(removed.status).toBe(200);
    const pms = env as PmsEnv;
    await pms.EVENT_DEDUPE_KV.delete(`seen:${recorded.eventId}`);
    await pms.EVENT_DEDUPE_KV.delete(`seen:pms.guest_document_flag:${recorded.eventId}`);
    const retries: EventRetryMessage[] = [];
    const original = pms.EVENT_RETRY_QUEUE.send.bind(pms.EVENT_RETRY_QUEUE);
    pms.EVENT_RETRY_QUEUE.send = (async (body: EventRetryMessage) => {
      retries.push(body);
      return original(body);
    }) as typeof pms.EVENT_RETRY_QUEUE.send;
    try {
      await deliverMessages([recorded]);
    } finally {
      pms.EVENT_RETRY_QUEUE.send = original;
    }
    expect(retries).toEqual([]);
    const exceptions = await resolved.stub.listEventConsumerExceptions({ status: 'all' });
    expect(exceptions).toMatchObject({ ok: true, exceptions: [] });
    const replayed = await resolved.stub.readReservation(reservationId);
    if (!replayed.ok) throw new Error('stay missing');
    expect(replayed.reservation.updatedAt).toBe(stamped.reservation.updatedAt);
    expect(await resolved.stub.readIdDocumentOnFileForTest(reservationId)).toBe(1);
    const sameKey = await resolved.stub.trySetIdDocumentFlag({
      guestRef,
      hasDocument: false,
      consumerIdempotencyKey: consumerIdempotencyKey('pms.guest_document_flag', recorded.eventId),
    });
    expect(sameKey).toMatchObject({ ok: true });
    expect(await resolved.stub.readIdDocumentOnFileForTest(reservationId)).toBe(1);
    const removedEvents = await dispatchOrgOutbox(org, { do: 'org', id: orgId });
    expect(removedEvents.some((message) => message.eventType === 'guest.document_removed')).toBe(true);
    expect(await resolved.stub.readIdDocumentOnFileForTest(reservationId)).toBe(0);
  });

  it('accepts document events that carry ids and rejects a display name', async () => {
    const source = { do: 'org' as const, id: 'org_evt' };
    const base = {
      eventId: 'evt_doc',
      seq: 1,
      source,
      createdAt: 1,
      payload: {
        orgId: 'org_evt',
        guestRef: 'guest_evt',
        propertyId: 'prop_evt',
        documentId: 'doc_evt',
      },
    };
    await expect(assertEventContract({ ...base, eventType: 'guest.document_recorded' })).resolves.toBeUndefined();
    await expect(assertEventContract({ ...base, eventType: 'guest.document_removed' })).resolves.toBeUndefined();
    await expect(
      assertEventContract({
        ...base,
        eventType: 'guest.document_recorded',
        payload: { ...base.payload, displayName: 'Ada Guest' },
      }),
    ).rejects.toThrow(/displayName/);
  });
});
