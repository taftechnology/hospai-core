import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPILOT_MAX_TURN_CHARS,
  COPILOT_MAX_TURNS,
  COPILOT_NO_RECORDS_SENTENCE,
  COPILOT_POST_READ_ROUTE_IDS,
  COPILOT_TOOLS,
  ROLE_GRANTS,
  copilotToolRequestPath,
  type CopilotMessageResponse,
} from '@hospai/contracts';
import { resolveOrgEntitlementStub, resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import {
  CopilotModelError,
  FakeCopilotModel,
  OpenAiCompatibleModel,
  __setCopilotModelForTest,
  planFakeCopilotCalls,
  selectCopilotModel,
  toOpenAiMessages,
  validCopilotBaseUrl,
  type CopilotModel,
} from '../src/copilot-model.js';
import { compactToolResult, runCopilot } from '../src/copilot-run.js';
import type { OrgDO } from '../src/org-do.js';
import type { OrgEntitlementDO } from '../src/org-entitlement-do.js';
import { V1_ROUTES } from '../src/v1-dispatch.js';
import { ensurePlatformSchema, insertProperty, resetPlatformSchemaGate } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers.js';

/** R4.16: Copilot, read-only and permission-aware (spec 2026-11-21-copilot-read-only-design). */

const GUEST_NAME = 'Quentin Copilotsmith';

type Stub = Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'];

type Hotel = {
  propertyId: string;
  orgId: string;
  stub: Stub;
  bd: string;
  guestRef: string;
  arrival: string;
  inHouse: string;
};

async function addAddon(orgId: string, code: string): Promise<void> {
  await env.PLATFORM_DB.prepare(
    `INSERT OR IGNORE INTO subscription_addon (org_id, addon_code, quantity) VALUES (?, ?, 1)`,
  )
    .bind(orgId, code)
    .run();
}

/**
 * A registered, entitled hotel with one arrival today (confirmed) and one in-house stay with a
 * charge on the folio (12,345 minor units), both for the same named guest.
 */
async function hotel(
  label: string,
  opts: { entitled?: boolean; orgId?: string; uuidIds?: boolean } = {},
): Promise<Hotel> {
  const propertyId = `cp-${label}-${crypto.randomUUID()}`;
  const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD', opts.orgId);
  await insertProperty(env, {
    propertyId,
    orgId: p.orgId,
    name: `Copilot ${label}`,
    jurisdiction: null,
    timeZone: 'UTC',
  });
  if (opts.entitled !== false) await addAddon(p.orgId, 'ai_ops');
  const org = orgStub(p.orgId);
  await org.ensureMetaOrgId(p.orgId);
  const { stub } = p;
  const bd = (await stub.readBusinessDate())!;
  const add = { roomTypeId: 'rt_a', code: 'RTA', name: 'RTA', roomCount: 5, maxOccupancy: 2, maxAdults: 2 };
  expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, add, await idemFor('add-rt-a', add))).ok).toBe(true);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID().slice(0, 8)}`, GUEST_NAME);
  const arrival = opts.uuidIds ? crypto.randomUUID() : `res_arr_${crypto.randomUUID().slice(0, 8)}`;
  const inHouse = opts.uuidIds ? crypto.randomUUID() : `res_inh_${crypto.randomUUID().slice(0, 8)}`;
  for (const [reservationId, status] of [
    [arrival, 'confirmed'],
    [inHouse, 'checked_in'],
  ] as const) {
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_a',
      guestRef: guest.guestRef,
      piiKeyId: guest.piiKeyId,
      arrivalDate: bd,
      departureDate: addCalendarDays(bd, 2),
      status,
    });
  }
  const line = { folioLineId: `fl_${crypto.randomUUID().slice(0, 8)}`, reservationId: inHouse, chargeCode: 'MISC', amountMinor: 12345, businessDate: bd };
  const added = await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line));
  expect(added, JSON.stringify(added)).toMatchObject({ ok: true });
  // No cache clearing here on purpose: the DO's 60 s entitlement cache first looked before the add-on
  // above was bought, and the audit write must still go through (it re-reads once on a denial).
  return { propertyId, orgId: p.orgId, stub, bd, guestRef: guest.guestRef, arrival, inHouse };
}

function messageUrl(propertyId: string): string {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/copilot/messages`;
}

async function ask(
  propertyId: string,
  actor: string,
  question: string | { messages: unknown },
  extra?: { env?: typeof env },
) {
  const body = typeof question === 'string' ? { messages: [{ role: 'user', content: question }] } : question;
  return worker.fetch(
    new Request(messageUrl(propertyId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    extra?.env ?? env,
  );
}

async function answer(propertyId: string, actor: string, question: string): Promise<CopilotMessageResponse> {
  const res = await ask(propertyId, actor, question);
  const body = (await res.json()) as CopilotMessageResponse;
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function copilotAuditRows(stub: Stub) {
  return (await runInDurableObject(stub, (_i, state) =>
    state.storage.sql
      .exec(`SELECT actor, command_id, entity_type, entity_id, before_json, after_json FROM audit_log WHERE command_id = 'copilot.record_read'`)
      .toArray(),
  )) as Array<{ actor: string; command_id: string; entity_type: string; entity_id: string; before_json: string | null; after_json: string }>;
}

beforeEach(async () => {
  resetPlatformSchemaGate();
  await ensurePlatformSchema(env.PLATFORM_DB);
  __setCopilotModelForTest(null);
});

afterEach(() => {
  __setCopilotModelForTest(null);
  vi.restoreAllMocks();
});

describe('R4.16 copilot route', () => {
  it('1. "Who arrives today?" reads the arrivals report through dispatchV1 and links to it', async () => {
    const h = await hotel('arrivals');
    const out = await answer(h.propertyId, 'user_owner', 'Who arrives today?');
    expect(out.toolsUsed).toEqual([{ toolId: 'front_office_report', ok: true }]);
    // The report holds guest references; the copilot resolves them to names as the caller, so the
    // answer carries the name and never the reference.
    expect(out.answer).toContain('2 rows');
    expect(out.answer).toContain(h.arrival.slice(-8));
    expect(out.answer).toContain(GUEST_NAME);
    expect(out.answer).not.toContain(h.guestRef);
    expect(out.sources).toEqual([{ label: 'Arrivals report', href: '/reports/front_office_arrivals' }]);
    expect(out.suggestedActions).toEqual([{ label: 'Open arrivals', href: '/arrivals' }]);
    expect(out.answer).not.toContain(COPILOT_NO_RECORDS_SENTENCE);
    expect(out.overSoftLimit).toBe(false);
  });

  it('1b. names for a staff user; "Name hidden" and no reference without guests:read; the model never sees a reference', async () => {
    const h = await hotel('names');
    const seen: string[] = [];
    const spy: CopilotModel = {
      kind: 'fake',
      step: (messages) => {
        seen.push(JSON.stringify(messages));
        return new FakeCopilotModel().step(messages);
      },
    };
    __setCopilotModelForTest(spy);
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    const staffId = `user_names_staff_${crypto.randomUUID()}`;
    await org.ensureMember(staffId, 'staff');

    const named = await answer(h.propertyId, staffId, 'Who arrives today?');
    expect(named.answer).toContain(GUEST_NAME);
    expect(named.answer).not.toContain('Name hidden');
    const withNames = seen.join('\n');
    expect(withNames).toContain(GUEST_NAME);
    expect(withNames).not.toContain(h.guestRef);
    expect(withNames).not.toMatch(uuid);
    expect(JSON.stringify(named)).not.toMatch(uuid);
    expect(await copilotAuditRows(h.stub)).toHaveLength(1);

    seen.length = 0;
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const original = [...grants];
    grants.splice(0, grants.length, 'org:read', 'property:read', 'reservations:read', 'copilot:use');
    try {
      const hidden = await answer(h.propertyId, staffId, 'Who arrives today?');
      expect(hidden.answer).toContain('Name hidden');
      expect(hidden.answer).not.toContain(GUEST_NAME);
      expect(hidden.answer).not.toContain(h.guestRef);
      const sent = seen.join('\n');
      expect(sent).not.toContain(GUEST_NAME);
      expect(sent).not.toContain(h.guestRef);
      expect(sent).not.toMatch(uuid);
    } finally {
      grants.splice(0, grants.length, ...original);
    }
    // A name that was resolved still counts as a read; so does a hidden one.
    expect(await copilotAuditRows(h.stub)).toHaveLength(2);
  });

  it('1c. UUID-shaped reservation ids chain search to folio; the answer shows no UUID; the model sees no guestRef', async () => {
    const h = await hotel('uuid', { uuidIds: true });
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const seen: string[] = [];
    __setCopilotModelForTest({
      kind: 'fake',
      step: (messages) => {
        seen.push(JSON.stringify(messages));
        return new FakeCopilotModel().step(messages);
      },
    });
    const out = await answer(h.propertyId, 'user_owner', `Look up ${h.inHouse} and show the folio`);
    expect(out.toolsUsed).toEqual([
      { toolId: 'reservation_search', ok: true },
      { toolId: 'reservation_folio', ok: true },
    ]);
    expect(out.answer).toContain('12345');
    expect(out.answer).not.toMatch(uuid);
    const sent = seen.join('\n');
    // The id the model chains on is kept; the guest reference is not.
    expect(sent).toContain(h.inHouse);
    expect(sent).not.toContain(h.guestRef);
    expect(sent).toContain(GUEST_NAME);

    // A model that writes ids into its text: a stay it read gets its confirmation, any other "a booking".
    const stranger = crypto.randomUUID();
    __setCopilotModelForTest({
      kind: 'fake',
      async step(messages) {
        return messages.some((m) => m.role === 'tool')
          ? { text: `Stay ${h.inHouse.toUpperCase()} and ${stranger}.` }
          : { toolCalls: [{ id: 'c1', toolId: 'reservation_detail', args: { reservationId: h.inHouse } }] };
      },
    });
    const echoed = await answer(h.propertyId, 'user_owner', 'detail please');
    expect(echoed.answer.startsWith(`Stay ${h.inHouse.slice(-8)} and a booking.`)).toBe(true);
    expect(echoed.answer).not.toMatch(uuid);
    // Links may keep the id: they are not shown text.
    expect(echoed.sources[0]!.href).toContain(h.inHouse);
  });

  it('1d. "Show the folio for <guest name>" chains desk search by name to the folio', async () => {
    const h = await hotel('byname', { uuidIds: true });
    const org = orgStub(h.orgId);
    const rao = await createGuest(org, h.propertyId, `guest_${crypto.randomUUID().slice(0, 8)}`, 'Chetan Raoname');
    const stay = crypto.randomUUID();
    await h.stub.insertReservationForTest({
      reservationId: stay,
      roomTypeId: 'rt_a',
      guestRef: rao.guestRef,
      piiKeyId: rao.piiKeyId,
      arrivalDate: h.bd,
      departureDate: addCalendarDays(h.bd, 2),
      status: 'checked_in',
    });
    const line = { folioLineId: `fl_${crypto.randomUUID().slice(0, 8)}`, reservationId: stay, chargeCode: 'MISC', amountMinor: 43210, businessDate: h.bd };
    expect(await h.stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor(line.folioLineId, line))).toMatchObject({ ok: true });

    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const seen: string[] = [];
    __setCopilotModelForTest({
      kind: 'fake',
      step: (messages) => {
        seen.push(JSON.stringify(messages));
        return new FakeCopilotModel().step(messages);
      },
    });
    const out = await answer(h.propertyId, 'user_owner', 'Show the folio for Chetan Raoname');
    expect(out.toolsUsed).toEqual([
      { toolId: 'reservation_search', ok: true },
      { toolId: 'reservation_folio', ok: true },
    ]);
    expect(out.answer).toContain('43210');
    expect(out.answer).not.toMatch(uuid);
    expect(out.answer).not.toContain(rao.guestRef);
    const sent = seen.join('\n');
    expect(sent).toContain('Chetan Raoname');
    expect(sent).not.toContain(rao.guestRef);
    expect(sent).not.toContain(h.guestRef);
    expect(out.sources.map((s) => s.href)).toContain(`/reservations`);

    // (The name travels in the POST body: the contracts test pins that the request path has no query.)
    // A user without guests:read searching by name gets what the route gives them: no stays, no names.
    const staffId = `user_noguests_${crypto.randomUUID()}`;
    await (resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>).ensureMember(staffId, 'staff');
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const original = [...grants];
    grants.splice(0, grants.length, 'org:read', 'property:read', 'reservations:read', 'folio:read', 'copilot:use');
    seen.length = 0;
    try {
      const blind = await answer(h.propertyId, staffId, 'Show the folio for Chetan Raoname');
      expect(blind.toolsUsed).toEqual([{ toolId: 'reservation_search', ok: true }]);
      expect(blind.answer).not.toContain('43210');
      expect(JSON.stringify(blind)).not.toContain('Chetan');
      expect(seen.join('\n')).not.toContain(rao.guestRef);
    } finally {
      grants.splice(0, grants.length, ...original);
    }
  });

  it('2. a user who cannot read folios gets a refusal and no balance', async () => {
    const h = await hotel('refusal');
    const owner = await answer(h.propertyId, 'user_owner', `What is the folio balance for ${h.inHouse}?`);
    expect(owner.toolsUsed).toEqual([{ toolId: 'reservation_folio', ok: true }]);
    expect(owner.answer).toContain('12345');

    const staffId = `user_roster_only_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const original = [...grants];
    grants.splice(0, grants.length, 'org:read', 'property:read', 'roster:read', 'copilot:use');
    try {
      const refused = await answer(h.propertyId, staffId, `What is the folio balance for ${h.inHouse}?`);
      expect(refused.toolsUsed).toEqual([{ toolId: 'reservation_folio', ok: false }]);
      expect(refused.answer.toLowerCase()).toContain('do not have access');
      expect(refused.answer).not.toContain('12345');
      expect(refused.answer).not.toContain(h.guestRef);
      expect(refused.sources).toEqual([]);
      expect(refused.suggestedActions).toEqual([]);
      expect(JSON.stringify(refused)).not.toContain('12345');
    } finally {
      grants.splice(0, grants.length, ...original);
    }
  });

  it("3. hotel A's user gets nothing from hotel B", async () => {
    const a = await hotel('tenant-a');
    const b = await hotel('tenant-b');
    expect(a.orgId).not.toBe(b.orgId);

    // The same question, with B's reservation id, asked at A: the route is A's, so it is not found.
    const crossStay = await answer(a.propertyId, 'user_owner', `What is the folio balance for ${b.inHouse}?`);
    expect(crossStay.toolsUsed).toEqual([{ toolId: 'reservation_folio', ok: false }]);
    expect(crossStay.answer).toContain('could not find');
    for (const secret of ['12345', b.guestRef, b.inHouse, b.propertyId, GUEST_NAME]) {
      expect(JSON.stringify(crossStay)).not.toContain(secret);
    }

    // A user of A cannot open B's copilot at all: not a member there, so 404 and no body of B's.
    const org = resolveOrgStub(env.ORG_DO, { orgId: a.orgId }) as DurableObjectStub<OrgDO>;
    const userA = `user_hotel_a_${crypto.randomUUID()}`;
    await org.ensureMember(userA, 'staff');
    const denied = await ask(b.propertyId, userA, 'Who arrives today?');
    expect(denied.status).toBe(404);
    const text = await denied.text();
    expect(text).not.toContain(b.guestRef);
    expect(text).not.toContain(GUEST_NAME);

    // The model cannot name another property: a tool argument for one is rejected before any read.
    const rogue: CopilotModel = {
      kind: 'fake',
      async step(messages) {
        return messages.some((m) => m.role === 'tool')
          ? { text: 'done' }
          : { toolCalls: [{ id: 'c1', toolId: 'room_board', args: { propertyId: b.propertyId } }] };
      },
    };
    __setCopilotModelForTest(rogue);
    const rogueOut = await answer(a.propertyId, 'user_owner', 'show the board');
    expect(rogueOut.toolsUsed).toEqual([{ toolId: 'room_board', ok: false }]);
    expect(JSON.stringify(rogueOut)).not.toContain(b.guestRef);
  });

  it('4. every answer has a source link or says it has none', async () => {
    const h = await hotel('sources');
    for (const q of ['Who arrives today?', 'How is housekeeping doing?', 'Show the night audit status']) {
      const out = await answer(h.propertyId, 'user_owner', q);
      expect(out.sources.length, q).toBeGreaterThan(0);
      expect(out.answer).not.toContain(COPILOT_NO_RECORDS_SENTENCE);
      for (const s of out.sources) expect(s.href.startsWith('/')).toBe(true);
    }
    const none = await answer(h.propertyId, 'user_owner', 'hello there');
    expect(none.sources).toEqual([]);
    expect(none.toolsUsed).toEqual([]);
    expect(none.answer.endsWith(COPILOT_NO_RECORDS_SENTENCE)).toBe(true);

    // A tool that fails leaves no source, so the sentence is added.
    const failed = await answer(h.propertyId, 'user_owner', 'folio balance for res_does_not_exist');
    expect(failed.toolsUsed).toEqual([{ toolId: 'reservation_folio', ok: false }]);
    expect(failed.sources).toEqual([]);
    expect(failed.answer).toContain(COPILOT_NO_RECORDS_SENTENCE);

    // A model that already says it is not added twice.
    __setCopilotModelForTest({ kind: 'fake', step: async () => ({ text: `Nothing. ${COPILOT_NO_RECORDS_SENTENCE}` }) });
    const once = await answer(h.propertyId, 'user_owner', 'anything');
    expect(once.answer.split(COPILOT_NO_RECORDS_SENTENCE)).toHaveLength(2);
  });

  it('5. caps turns and characters; with no provider the route is 503 copilot_unavailable', async () => {
    const h = await hotel('limits');
    const turns = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ role: i % 2 === (n % 2 === 0 ? 1 : 0) ? 'user' : 'assistant', content: 'x' }));
    const tooMany = await ask(h.propertyId, 'user_owner', { messages: turns(COPILOT_MAX_TURNS + 1) });
    expect(tooMany.status).toBe(422);
    expect(await tooMany.json()).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'turns' });

    const longTurn = await ask(h.propertyId, 'user_owner', 'x'.repeat(COPILOT_MAX_TURN_CHARS + 1));
    expect(longTurn.status).toBe(422);
    expect(await longTurn.json()).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'chars' });

    const atLimit = await ask(h.propertyId, 'user_owner', 'x'.repeat(COPILOT_MAX_TURN_CHARS));
    expect(atLimit.status).toBe(200);

    const bad = await ask(h.propertyId, 'user_owner', { messages: [{ role: 'assistant', content: 'hi' }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_body' });
    const malformed = await worker.fetch(
      new Request(messageUrl(h.propertyId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_owner' },
        body: '{not json',
      }),
      env,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid_json' });

    __setCopilotModelForTest('none');
    const none = await ask(h.propertyId, 'user_owner', 'Who arrives today?');
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ ok: false, error: 'copilot_unavailable' });

    // A provider that fails is the same answer, and nothing of the provider's reaches the client.
    __setCopilotModelForTest({
      kind: 'openai_compatible',
      step: async () => {
        throw new CopilotModelError('provider_status_500');
      },
    });
    const broken = await ask(h.propertyId, 'user_owner', 'Who arrives today?');
    expect(broken.status).toBe(503);
    expect(await broken.json()).toEqual({ ok: false, error: 'copilot_unavailable' });
  });

  it('6. entitlement off is 402; without copilot:use is 403; a stranger is 404', async () => {
    const off = await hotel('unentitled', { entitled: false });
    const res = await ask(off.propertyId, 'user_owner', 'Who arrives today?');
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'entitlement_required', feature: 'ai_ops.enabled' });

    const h = await hotel('perm');
    const staffId = `user_no_copilot_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const idx = grants.indexOf('copilot:use');
    expect(idx).toBeGreaterThanOrEqual(0);
    grants.splice(idx, 1);
    try {
      const denied = await ask(h.propertyId, staffId, 'Who arrives today?');
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: 'forbidden', permission: 'copilot:use' });
    } finally {
      grants.splice(idx, 0, 'copilot:use');
    }

    const stranger = await ask(h.propertyId, `user_stranger_${crypto.randomUUID()}`, 'Who arrives today?');
    expect(stranger.status).toBe(404);
  });

  it('7. an answer that reads guests writes one audit row with counts only; others write none', async () => {
    const h = await hotel('audit');
    expect(await copilotAuditRows(h.stub)).toEqual([]);

    const question = 'Who arrives today? zq7marker';
    const out = await answer(h.propertyId, 'user_owner', question);
    expect(out.toolsUsed).toEqual([{ toolId: 'front_office_report', ok: true }]);
    const rows = await copilotAuditRows(h.stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'user_owner', command_id: 'copilot.record_read', entity_type: 'copilot' });
    expect(JSON.parse(rows[0]!.after_json)).toEqual({ toolIds: ['front_office_report'], guestRefCount: 1 });
    expect(rows[0]!.before_json).toBeNull();
    const raw = JSON.stringify(rows);
    for (const leaked of [GUEST_NAME, 'zq7marker', 'arrives', out.answer, h.arrival, h.guestRef]) {
      expect(raw).not.toContain(leaked);
    }

    // Two guests on one answer count once per distinct reference.
    await answer(h.propertyId, 'user_owner', 'Show in-house guests and arrivals');
    const after = await copilotAuditRows(h.stub);
    expect(after).toHaveLength(2);
    expect(JSON.parse(after[1]!.after_json)).toEqual({ toolIds: ['front_office_report'], guestRefCount: 1 });

    // A non-guest answer writes none.
    const nonGuest = await answer(h.propertyId, 'user_owner', 'What is the night audit status?');
    expect(nonGuest.toolsUsed).toEqual([{ toolId: 'night_audit_status', ok: true }]);
    expect(await copilotAuditRows(h.stub)).toHaveLength(2);
  });

  it('7b. a read that cannot be recorded is withheld, not answered', async () => {
    const h = await hotel('audit-fault');
    await h.stub.setAuditAppendFaultForTest(true);
    try {
      const res = await ask(h.propertyId, 'user_owner', 'Who arrives today?');
      expect(res.status).toBeGreaterThanOrEqual(500);
      const text = await res.text();
      expect(text).not.toContain(h.guestRef);
    } finally {
      await h.stub.setAuditAppendFaultForTest(false);
    }
    expect(await copilotAuditRows(h.stub)).toEqual([]);
  });

  it('8. the registry admits GET routes only, each matching its route id', () => {
    expect(COPILOT_TOOLS.length).toBeGreaterThan(0);
    for (const tool of COPILOT_TOOLS) {
      const route = V1_ROUTES.find((r) => r.id === tool.routeId);
      expect(route, `${tool.toolId} → ${tool.routeId}`).toBeDefined();
      const method = tool.method ?? 'GET';
      expect(route!.method, `${tool.toolId} method`).toBe(method);
      // A read route only: never a command, and a POST must be on the allow-list.
      expect('commandId' in route! && route.commandId, `${tool.toolId} must not be a command`).toBeFalsy();
      if (method === 'POST') expect(COPILOT_POST_READ_ROUTE_IDS).toContain(tool.routeId);
      const args: Record<string, string> = {};
      for (const p of tool.params) {
        args[p.name] =
          p.kind === 'date' ? '2026-11-21' : p.kind === 'enum' ? p.values![0]! : p.kind === 'id' ? 'res_x' : 'abc';
      }
      const path = copilotToolRequestPath(tool, 'prop_1', args);
      const matched = V1_ROUTES.find((r) => r.method === method && r.pattern.test(new URL(path, 'http://x').pathname));
      expect(matched?.id, `${tool.toolId}: ${path}`).toBe(tool.routeId);
    }
    // The route itself is the only copilot route, and it is registered last.
    expect(V1_ROUTES.at(-1)).toMatchObject({ id: 'post_copilot_message', method: 'POST', permission: 'copilot:use' });
    expect(V1_ROUTES.filter((r) => r.id.includes('copilot'))).toHaveLength(1);
  });

  it('9. nothing from the request appears in the logs; counts and durations do', async () => {
    const h = await hotel('logs');
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const secret = 'zq9-private-question-token';
    const out = await answer(h.propertyId, 'user_owner', `Who arrives today? ${secret} ${h.inHouse}`);
    expect(out.toolsUsed.length).toBeGreaterThan(0);
    await ask(h.propertyId, 'user_owner', { messages: [{ role: 'user', content: `${secret} ${'y'.repeat(COPILOT_MAX_TURN_CHARS)}` }] });
    const captured = lines.join('\n');
    expect(captured).not.toContain(secret);
    expect(captured).not.toContain(GUEST_NAME);
    expect(captured).not.toContain(h.guestRef);
    expect(captured).not.toContain(out.answer.slice(0, 40));
    const answered = lines.find((l) => l.includes('copilot.answered'));
    expect(answered, 'a counts-only line is logged').toBeDefined();
    expect(answered).toContain('tool_calls');
    expect(answered).toContain('duration_ms');
  });
});

describe('R4.16 copilot metering (D5)', () => {
  async function meterValue(orgId: string): Promise<number | null> {
    const stub = resolveOrgEntitlementStub(env.ORG_ENTITLEMENT_DO, orgId) as DurableObjectStub<OrgEntitlementDO>;
    return runInDurableObject(stub, (_i, state) => {
      const rows = state.storage.sql
        .exec(`SELECT value FROM meter_counter WHERE meter_key = 'ai_ops.messages.limit'`)
        .toArray() as Array<{ value: number }>;
      return rows.length === 0 ? null : Number(rows[0]!.value);
    });
  }

  it('counts each answer against the existing meter when the org has one; not otherwise', async () => {
    const unmetered = await hotel('meter-none');
    await answer(unmetered.propertyId, 'user_owner', 'Who arrives today?');
    expect(await meterValue(unmetered.orgId)).toBeNull();

    const metered = await hotel('meter-soft');
    await addAddon(metered.orgId, 'ai_ops_messages');
    const first = await answer(metered.propertyId, 'user_owner', 'Who arrives today?');
    const second = await answer(metered.propertyId, 'user_owner', 'hello');
    expect(first.overSoftLimit).toBe(false);
    expect(second.overSoftLimit).toBe(false);
    expect(await meterValue(metered.orgId)).toBe(2);
  });

  it('past the limit the answer still returns, flagged', async () => {
    await env.PLATFORM_DB.prepare(
      `INSERT OR REPLACE INTO plan_feature (plan_code, feature_key, value) VALUES ('starter', 'ai_ops.messages.limit', '1')`,
    ).run();
    try {
      const h = await hotel('meter-over');
      const first = await answer(h.propertyId, 'user_owner', 'Who arrives today?');
      expect(first.overSoftLimit).toBe(false);
      const second = await answer(h.propertyId, 'user_owner', 'Who arrives today?');
      expect(second.overSoftLimit).toBe(true);
      expect(second.answer).toContain('2 rows');
    } finally {
      await env.PLATFORM_DB.prepare(
        `DELETE FROM plan_feature WHERE plan_code = 'starter' AND feature_key = 'ai_ops.messages.limit'`,
      ).run();
    }
  });
});

describe('R4.16 copilot model adapter', () => {
  it('uses the fake model only under the local marker, and a real provider only with all three settings', () => {
    expect(selectCopilotModel({})).toBeNull();
    expect(selectCopilotModel({ HOSPAI_UNSAFE_LOCAL: '1' })).toBeInstanceOf(FakeCopilotModel);
    const all = { COPILOT_BASE_URL: 'https://models.example.test/v1', COPILOT_MODEL: 'm', COPILOT_API_KEY: 'k' };
    expect(selectCopilotModel(all)).toBeInstanceOf(OpenAiCompatibleModel);
    for (const missing of ['COPILOT_BASE_URL', 'COPILOT_MODEL', 'COPILOT_API_KEY'] as const) {
      const partial: Record<string, string> = { ...all };
      delete partial[missing];
      expect(selectCopilotModel(partial), `${missing} missing`).toBeNull();
      expect(selectCopilotModel({ ...partial, HOSPAI_UNSAFE_LOCAL: '1' })).toBeInstanceOf(FakeCopilotModel);
    }
    expect(selectCopilotModel({ ...all, COPILOT_BASE_URL: 'http://models.example.test/v1' })).toBeNull();
    expect(validCopilotBaseUrl('http://localhost:11434/v1', { HOSPAI_UNSAFE_LOCAL: '1' })).not.toBeNull();
    expect(validCopilotBaseUrl('http://localhost:11434/v1', {})).toBeNull();
    expect(validCopilotBaseUrl('https://user:pw@models.example.test/v1', {})).toBeNull();
    expect(validCopilotBaseUrl('not a url', {})).toBeNull();
  });

  it('the fake plans the same tools for the same words', () => {
    expect(planFakeCopilotCalls('Who arrives today?')).toEqual([
      { toolId: 'front_office_report', args: { reportId: 'front_office_arrivals' } },
    ]);
    expect(planFakeCopilotCalls('Which folios are still open?')).toEqual([{ toolId: 'open_folios', args: {} }]);
    expect(planFakeCopilotCalls("Show yesterday's manager report")).toEqual([{ toolId: 'manager_report', args: {} }]);
    expect(planFakeCopilotCalls('How is housekeeping doing?')).toEqual([{ toolId: 'housekeeping_dashboard', args: {} }]);
    expect(planFakeCopilotCalls('Why is this exception open?')).toEqual([{ toolId: 'night_audit_status', args: {} }]);
    expect(planFakeCopilotCalls('folio for res_abc123')).toEqual([
      { toolId: 'reservation_folio', args: { reservationId: 'res_abc123' } },
    ]);
    expect(planFakeCopilotCalls('find "Ada Lovelace"')).toEqual([{ toolId: 'reservation_search', args: { q: 'Ada Lovelace' } }]);
    expect(planFakeCopilotCalls('good morning')).toEqual([]);
  });

  it('speaks chat-completions with tool calling and reads tool calls back', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const replies = [
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'open_folios', arguments: '{}' } }] } }] },
      { choices: [{ message: { role: 'assistant', content: 'Two folios are open.' } }] },
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json(replies.shift()!);
    }) as unknown as typeof fetch;
    const model = new OpenAiCompatibleModel({
      baseUrl: 'https://models.example.test/v1/',
      model: 'm-1',
      apiKey: 'test-key-not-real',
      fetchImpl,
    });
    const tools = COPILOT_TOOLS.slice(0, 2).map((t) => ({
      toolId: t.toolId,
      description: t.description,
      parameters: { type: 'object' as const, properties: {}, required: [], additionalProperties: false as const },
    }));
    const first = await model.step([{ role: 'user', content: 'Which folios are open?' }], tools);
    expect(first).toEqual({ toolCalls: [{ id: 'call_1', toolId: 'open_folios', args: {} }] });
    const second = await model.step(
      [
        { role: 'user', content: 'Which folios are open?' },
        { role: 'assistant_tool_calls', calls: [{ id: 'call_1', toolId: 'open_folios', args: {} }] },
        { role: 'tool', callId: 'call_1', toolId: 'open_folios', content: '{"ok":true}' },
      ],
      [],
    );
    expect(second).toEqual({ text: 'Two folios are open.' });

    expect(seen[0]!.url).toBe('https://models.example.test/v1/chat/completions');
    const sent = JSON.parse(seen[0]!.init.body as string);
    expect(sent.model).toBe('m-1');
    expect(sent.tool_choice).toBe('auto');
    expect(sent.tools[0]).toMatchObject({ type: 'function', function: { name: tools[0]!.toolId } });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer test-key-not-real');
    const sent2 = JSON.parse(seen[1]!.init.body as string);
    expect(sent2.tools).toBeUndefined();
    expect(sent2.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(toOpenAiMessages([{ role: 'tool', callId: 'c', toolId: 't', content: 'x' }])).toEqual([
      { role: 'tool', tool_call_id: 'c', content: 'x' },
    ]);
  });

  it('turns every provider failure into a code, not provider text', async () => {
    const mk = (fetchImpl: typeof fetch) =>
      new OpenAiCompatibleModel({ baseUrl: 'https://models.example.test/v1', model: 'm', apiKey: 'k', fetchImpl });
    await expect(
      mk((async () => new Response('secret provider detail', { status: 500 })) as unknown as typeof fetch).step([], []),
    ).rejects.toThrow(/^provider_status_500$/);
    await expect(
      mk((async () => {
        throw new Error('socket detail');
      }) as unknown as typeof fetch).step([], []),
    ).rejects.toThrow(/^provider_unreachable$/);
    await expect(
      mk((async () => Response.json({ nope: true })) as unknown as typeof fetch).step([], []),
    ).rejects.toThrow(/^provider_bad_response$/);
  });
});

describe('R4.16 copilot loop', () => {
  const turns = [{ role: 'user' as const, content: 'go' }];
  const okTool = async () => ({ ok: true as const, data: { ok: true, rows: [] } });

  it('stops at six tool calls and then asks for text only', async () => {
    let toolCalls = 0;
    let finalWithoutTools = false;
    const greedy: CopilotModel = {
      kind: 'fake',
      async step(_messages, tools) {
        if (tools.length === 0) {
          finalWithoutTools = true;
          return { text: 'enough' };
        }
        return { toolCalls: [{ id: `c${toolCalls++}`, toolId: 'open_folios', args: {} }] };
      },
    };
    const out = await runCopilot({ model: greedy, systemPrompt: 's', turns, businessDate: '2026-11-21', runTool: okTool });
    expect(out.toolsUsed).toHaveLength(6);
    expect(finalWithoutTools).toBe(true);
    expect(out.answer.startsWith('enough')).toBe(true);
    expect(out.sources).toEqual([{ label: 'Open folios', href: '/folios' }]);
  });

  it('refuses extra calls in one round past the budget without running them', async () => {
    const ran: string[] = [];
    const burst: CopilotModel = {
      kind: 'fake',
      async step(messages) {
        if (messages.some((m) => m.role === 'tool')) return { text: 'done' };
        return {
          toolCalls: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, toolId: 'room_board', args: {} })),
        };
      },
    };
    const out = await runCopilot({
      model: burst,
      systemPrompt: 's',
      turns,
      businessDate: null,
      runTool: async (id) => {
        ran.push(id);
        return { ok: true, data: {} };
      },
    });
    expect(ran).toHaveLength(6);
    expect(out.toolsUsed).toHaveLength(6);
  });

  it('answers an unknown tool or bad arguments as a tool error, not a read', async () => {
    const calls: Array<{ toolId: string; args: unknown }> = [
      { toolId: 'delete_everything', args: {} },
      { toolId: 'reservation_detail', args: { reservationId: '../other' } },
    ];
    let sent = false;
    const out = await runCopilot({
      model: {
        kind: 'fake',
        async step(messages) {
          if (!sent) {
            sent = true;
            return { toolCalls: calls.map((c, i) => ({ id: `c${i}`, ...c })) };
          }
          expect(messages.filter((m) => m.role === 'tool')).toHaveLength(2);
          return { text: 'ok' };
        },
      },
      systemPrompt: 's',
      turns,
      businessDate: null,
      runTool: async () => {
        throw new Error('must not run');
      },
    });
    expect(out.toolsUsed).toEqual([{ toolId: 'reservation_detail', ok: false }]);
    expect(out.sources).toEqual([]);
  });

  it('gives up with a model error when the time budget is spent', async () => {
    let clock = 0;
    await expect(
      runCopilot({
        model: { kind: 'fake', step: async () => ({ text: 'late' }) },
        systemPrompt: 's',
        turns,
        businessDate: null,
        runTool: okTool,
        budgetMs: 100,
        now: () => (clock += 500),
      }),
    ).rejects.toThrow(/time_budget/);
  });

  it('cuts long tool results to fit, keeping the head and a count of the rest', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({ i, text: 'x'.repeat(40) }));
    const text = compactToolResult({ rows, other: 1 }, 5000);
    expect(text.length).toBeLessThanOrEqual(5000);
    const parsed = JSON.parse(text) as { rows: Array<Record<string, unknown>>; other: number };
    expect(parsed.other).toBe(1);
    expect(parsed.rows[0]).toMatchObject({ i: 0 });
    expect(parsed.rows.at(-1)).toHaveProperty('omittedRows');
    expect(compactToolResult({ a: 1 })).toBe('{"a":1}');
  });
});

describe('R4.16 guest scrub and UUID guard (units)', () => {
  it('keeps the ids a tool parameter consumes, whatever their format, and drops other UUID ids and refs', async () => {
    const { scrubGuestRefs, redactUuids, collectChainIds } = await import('../src/copilot-guests.js');
    const u1 = crypto.randomUUID();
    const u2 = crypto.randomUUID();
    const out = scrubGuestRefs(
      { items: [{ reservationId: u1, roomId: u2, guestRef: 'g_1', piiKeyId: 'k', roomCode: '101', confirmation: 'ABCD1234' }] },
      new Map([['g_1', 'Ada']]),
    );
    expect(out).toEqual({ items: [{ reservationId: u1, guestName: 'Ada', roomCode: '101', confirmation: 'ABCD1234' }] });
    expect([...collectChainIds(out)]).toEqual([u1]);
    expect(redactUuids(`a ${u1} b ${u2}`, new Set([u1]))).toBe(`a ${u1.slice(-8)} b a booking`);
  });
});
