import { env, runInDurableObject } from 'cloudflare:test';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG_REGISTER,
  COMMAND_BY_ID,
  OPERATOR_COPY_PERMISSIONS,
  OPS_COPY_KINDS,
  OPS_COPY_NOT_COPIED,
  OPS_WRITE_KILL_KEY,
  type ActorContext,
  type OpsCopyKind,
  type OpsCopyStatus,
} from '@hospai/contracts';
import { HORIZON_DAYS } from '@hospai/pms-inventory';
import type { OpsCopyWorkflowParams, PmsEnv } from '../src/env.js';
import * as copy from '../src/ops-copy.js';
import { COPY_CONFIG_ALLOWLIST, COPY_CONFIG_NEVER } from '../src/ops-copy.js';
import { OpsCopyWorkflow } from '../src/ops-copy-workflow.js';
import { OpsEntrypoint } from '../src/ops-entrypoint.js';
import * as ops from '../src/ops-platform.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { trySetOrgStatus } from '../src/registry.js';
import { actionRows, resetOperatorRegistry, seedOperator, uid } from './ops-helpers.js';
import { idemFor } from './fixtures.js';

let admin: { operatorId: string; email: string };
let viewer: { operatorId: string; email: string };

const SYS: ActorContext = { kind: 'system', reason: 'provision' };

beforeAll(async () => {
  await resetOperatorRegistry();
  admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
  viewer = await seedOperator('ops_viewer');
});

afterEach(async () => {
  await env.ENTITLEMENT_KV.delete(OPS_WRITE_KILL_KEY);
});

let keyCounter = 0;
const w = (operatorId: string, reason: string | null = 'Hotel 2 onboarding') => ({
  operatorId,
  clientKey: `copy-k${++keyCounter}-${crypto.randomUUID()}`,
  reason: reason as string,
});

async function newOrg(plan: 'growth' | 'group' = 'group') {
  const orgId = uid('org_cp');
  expect(await ops.createOrg(env, { ...w(admin.operatorId), orgId, name: `Customer ${orgId}`, planCode: plan })).toMatchObject({ ok: true });
  return orgId;
}

async function addHotel(orgId: string, tag: string) {
  const propertyId = uid(`prop_${tag}`);
  const res = await ops.addProperty(env, {
    ...w(admin.operatorId),
    orgId,
    propertyId,
    name: `Hotel ${propertyId}`,
    jurisdiction: null,
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(res).toMatchObject({ ok: true });
  return propertyId;
}

async function stubFor(propertyId: string) {
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  expect(resolved).not.toBeNull();
  return resolved!.stub;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Put raw rows in property_config: values the product never lets a copy carry (SECRET, GSTIN, series). */
async function putRawConfig(stub: Awaited<ReturnType<typeof stubFor>>, key: string, value: unknown) {
  await runInDurableObject(stub, (_i, state) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO property_config (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)`,
      key,
      JSON.stringify(value),
      Date.now(),
    );
  });
}

async function storedConfigKeys(stub: Awaited<ReturnType<typeof stubFor>>): Promise<string[]> {
  return runInDurableObject(stub, (_i, state) =>
    (state.storage.sql.exec(`SELECT key FROM property_config`).toArray() as Array<{ key: string }>).map((r) => r.key),
  );
}

const SOURCE_SECRETS = {
  'pms.finance.bank_acct': '000123456789',
  'pms.finance.bank_routing': '021000021',
  'pms.finance.paypal_clientid': 'client-id-secret',
  'pms.tax.registrations': [{ label: 'GSTIN', number: '27AAPFU0939F1ZV' }],
  'pms.invoice.prefix': 'SRC-INV',
  'pms.invoice.series': 'SRC-SERIES',
  'pms.invoice.footer': 'Source Hotel Pvt Ltd, A/c 000123456789',
} as const;

/** A well-stocked source hotel: every kind a copy carries, and the things it must never carry. */
async function seedSource(propertyId: string) {
  const stub = await stubFor(propertyId);
  const bd = (await stub.readBusinessDate())!;
  const ok = (r: { ok: boolean }, what: string) => expect(r, what).toMatchObject({ ok: true });

  // Charge codes: a custom one with a tax group, and the output codes for a tax rule.
  for (const cc of [{ code: 'FNB', name: 'Food and beverage' }, { code: 'CGST', name: 'CGST' }]) {
    ok(await stub.tryCreateChargeCode(SYS, cc, await idemFor(`cc-${cc.code}`, cc)), `charge code ${cc.code}`);
  }
  const link = { code: 'FNB', taxGroup: 'GOODS' };
  ok(await stub.tryUpdateChargeCode(SYS, link, await idemFor('cc-fnb-tax', link)), 'charge code tax group');

  const rule = {
    taxRuleId: 'tr_src_cgst',
    ruleKey: 'room_cgst',
    name: 'Room CGST',
    ruleType: 'PERCENTAGE' as const,
    rate: '0.06',
    taxGroup: 'ROOM',
    outputChargeCode: 'CGST',
    sequence: 1,
    validFrom: addDays(bd, -30),
  };
  ok(await stub.tryCreateTaxRule(SYS, rule, await idemFor('tax-src', rule)), 'tax rule');

  // Room types: definitions with a real physical count (10, 6), and one virtual type over both.
  const rooms = [
    { roomTypeId: 'rt_src_king', code: 'KING', name: 'King', roomCount: 10, maxOccupancy: 2, maxAdults: 2 },
    { roomTypeId: 'rt_src_queen', code: 'QUEEN', name: 'Queen', roomCount: 6, maxOccupancy: 2, maxAdults: 2 },
  ];
  for (const rt of rooms) ok(await stub.tryAddRoomType(SYS, rt, await idemFor(`rt-${rt.roomTypeId}`, rt)), 'room type');
  const virtual = {
    roomTypeId: 'rt_src_flex',
    code: 'FLEX',
    name: 'Flex',
    kind: 'virtual' as const,
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_src_king', 'rt_src_queen'],
  };
  ok(await stub.tryAddRoomType(SYS, virtual, await idemFor('rt-flex', virtual)), 'virtual room type');
  // A real room: rooms are never copied.
  const room = { roomId: 'rm_src_101', roomTypeId: 'rt_src_king', code: '101' };
  ok(await stub.tryCreateRoom(SYS, room, await idemFor('rm-101', room)), 'room');

  // Products and a rate plan with an inclusion, then a plan derived from it.
  const category = { categoryId: 'cat_src_fnb', name: 'Food', sortOrder: 1 };
  ok(await stub.tryCreateProductCategory(SYS, category, await idemFor('cat-src', category)), 'category');
  const product = { productId: 'prod_src_bf', categoryId: 'cat_src_fnb', name: 'Breakfast', sku: 'BF', chargeCode: 'FNB', defaultAmountMinor: 3000 };
  ok(await stub.tryCreateProduct(SYS, product, await idemFor('prod-src', product)), 'product');
  const plan = {
    ratePlanId: 'rp_src_cp',
    code: 'CP',
    name: 'Continental plan',
    inclusions: [{ inclusionNo: 1, productId: 'prod_src_bf', amountMinor: 3000, basis: 'PER_ADULT' as const, priceMode: 'INCLUDED' as const }],
  };
  ok(await stub.tryCreateRatePlan(SYS, plan, await idemFor('plan-src', plan)), 'rate plan');
  const child = { ratePlanId: 'rp_src_cpd', code: 'CPD', name: 'Continental discount', parentRatePlanId: 'rp_src_cp', deriveBps: -1000 };
  ok(await stub.tryCreateRatePlan(SYS, child, await idemFor('plan-src-child', child)), 'derived rate plan');

  // Three nights of rates on the default plan and on CP, for the King and the Queen.
  for (const ratePlanId of ['BAR', 'rp_src_cp']) {
    for (const roomTypeId of ['rt_src_king', 'rt_src_queen']) {
      for (let i = 0; i < 3; i++) {
        const cell = { roomTypeId, ratePlanId, stayDate: addDays(bd, i), amountMinor: 10_000 + i, currency: 'USD' };
        ok(await stub.tryUpsertRateDay(SYS, cell, await idemFor(`rate-${roomTypeId}-${ratePlanId}-${i}`, cell)), 'rate day');
      }
    }
  }

  const pkg = {
    packageId: 'pkg_src_1',
    code: 'BNB',
    name: 'Bed and breakfast',
    roomTypeId: 'rt_src_king',
    ratePlanId: 'BAR',
    nights: 2,
    priceMinor: 25_000,
    components: [{ componentNo: 1, productId: 'prod_src_bf', amountMinor: 3000, schedule: 'EVERY_NIGHT' as const }],
  };
  ok(await stub.tryCreatePackage(SYS, pkg, await idemFor('pkg-src', pkg)), 'package');

  // Config: one allowlisted policy, and the values a copy must never carry.
  const cutoff = ['pms.booking.same_day_cutoff', '21:15', { reason: 'seed' }] as const;
  ok(await stub.tryPutDomainConfig(SYS, cutoff[0], cutoff[1], cutoff[2], await idemFor('cfg-cutoff', cutoff)), 'config');
  for (const [key, value] of Object.entries(SOURCE_SECRETS)) await putRawConfig(stub, key, value);
  return { stub, businessDate: bd };
}

/** `listAuditLog` collapses to `never` over RPC because of its `unknown` columns: name the shape we read. */
async function auditRows(stub: Awaited<ReturnType<typeof stubFor>>, filters: { actor?: string }) {
  const res = (await stub.listAuditLog(SYS, { ...filters, limit: 500 })) as unknown as {
    ok: boolean;
    rows?: Array<{ actor: string; commandId: string }>;
  };
  expect(res.ok).toBe(true);
  return res.rows ?? [];
}

function fakeStep(opts?: { failAt?: string; names?: string[] }): WorkflowStep {
  return {
    do: async (name: string, ...rest: unknown[]) => {
      opts?.names?.push(name);
      if (opts?.failAt === name) throw new Error(`killed at ${name}`);
      const callback = rest[rest.length - 1] as () => Promise<unknown>;
      return callback();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
    waitForEvent: async () => {
      throw new Error('waitForEvent is not supported by fakeStep');
    },
  } as unknown as WorkflowStep;
}

/** Run the real `OpsCopyWorkflow.run()` body against real bindings (the pool does not drive instances). */
function runWorkflow(copyId: string, step: WorkflowStep = fakeStep()): Promise<void> {
  const receiver = { env: env as PmsEnv } as unknown as OpsCopyWorkflow;
  const event = {
    payload: { copyId, operatorId: admin.operatorId, attempt: 1 },
    timestamp: new Date(),
    instanceId: `test-${copyId}`,
  } as WorkflowEvent<OpsCopyWorkflowParams>;
  return OpsCopyWorkflow.prototype.run.call(receiver, event, step);
}

async function statusOf(copyId: string): Promise<OpsCopyStatus> {
  const res = await copy.getCopyStatus(env, { operatorId: viewer.operatorId, copyId });
  expect(res.ok).toBe(true);
  return res as OpsCopyStatus;
}

async function hotels() {
  const orgId = await newOrg('group');
  const sourceId = await addHotel(orgId, 'src');
  const targetId = await addHotel(orgId, 'tgt');
  return { orgId, sourceId, targetId };
}

const ALL_KINDS = [...OPS_COPY_KINDS] as OpsCopyKind[];

describe('R7.5 ops.copy_setup: refusals', () => {
  it('cross-org copy is 409 org_mismatch and carries no field of either property (fail-first)', async () => {
    const orgA = await newOrg('growth');
    const orgB = await newOrg('growth');
    const sourceId = await addHotel(orgA, 'xa');
    const targetId = await addHotel(orgB, 'xb');
    const before = await actionRows(`command_id = 'ops.copy_setup'`);
    const res = await ops.getCustomer(env, { operatorId: admin.operatorId, orgId: orgA });
    expect(res.ok).toBe(true);

    const refused = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] });
    expect(refused).toEqual({ ok: false, error: 'org_mismatch', status: 409 });
    const text = JSON.stringify(refused);
    for (const secret of [sourceId, targetId, orgA, orgB, 'Hotel', 'Customer']) expect(text).not.toContain(secret);
    expect(await actionRows(`command_id = 'ops.copy_setup'`)).toHaveLength(before.length);

    // The unknown-property case reveals nothing either.
    const missing = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: uid('prop_none'), kinds: ['room_types'] });
    expect(missing).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('a target that has ever held a reservation is 409 target_not_empty, even a cancelled one', async () => {
    const { sourceId, targetId } = await hotels();
    await seedSource(sourceId);
    const target = await stubFor(targetId);
    const rt = { roomTypeId: 'rt_tgt_own', code: 'OWN', name: 'Own', roomCount: 1, maxOccupancy: 2, maxAdults: 2 };
    expect(await target.tryAddRoomType(SYS, rt, await idemFor('rt-own', rt))).toMatchObject({ ok: true });
    await target.insertReservationForTest({
      reservationId: uid('res_old'),
      roomTypeId: 'rt_tgt_own',
      guestRef: 'guest_ref_x',
      piiKeyId: 'pii_x',
      arrivalDate: '2020-01-01',
      departureDate: '2020-01-02',
      status: 'cancelled',
    });
    // Copy only charge codes (the target has none of those): the reservation alone refuses it.
    const res = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['charge_codes'] });
    expect(res).toMatchObject({ ok: false, error: 'target_not_empty', status: 409, detail: 'reservations' });
    expect(await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] })).toMatchObject({
      error: 'target_not_empty',
    });
  });

  it('a target that already has rows of a kind being copied is refused, naming the kind; other kinds are not blocked', async () => {
    const { sourceId, targetId } = await hotels();
    await seedSource(sourceId);
    const target = await stubFor(targetId);
    const cc = { code: 'LAUNDRY', name: 'Laundry' };
    expect(await target.tryCreateChargeCode(SYS, cc, await idemFor('cc-l', cc))).toMatchObject({ ok: true });
    const blocked = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['charge_codes', 'room_types'] });
    expect(blocked).toMatchObject({ ok: false, error: 'target_not_empty', detail: 'charge_codes' });
    const allowed = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] });
    expect(allowed).toMatchObject({ ok: true });
  });

  it('ops_viewer is forbidden, a missing reason is refused, and kinds over the cap are refused', async () => {
    const { sourceId, targetId } = await hotels();
    const base = { sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] as OpsCopyKind[] };
    expect(await copy.copySetup(env, { ...w(viewer.operatorId), ...base })).toMatchObject({ ok: false, error: 'forbidden', status: 403 });
    expect(await copy.copySetup(env, { ...w(admin.operatorId, null), ...base })).toMatchObject({ ok: false, error: 'reason_required', status: 422 });
    expect(await copy.copySetup(env, { ...w(admin.operatorId, '   '), ...base })).toMatchObject({ ok: false, error: 'reason_required' });
    const over = [...ALL_KINDS, 'room_types'] as OpsCopyKind[];
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base, kinds: over })).toMatchObject({ ok: false, error: 'limit_exceeded', status: 422 });
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base, kinds: [] })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base, kinds: ['rooms' as OpsCopyKind] })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base, targetPropertyId: sourceId })).toMatchObject({ ok: false, error: 'invalid_request', detail: 'same_property' });
    expect(await actionRows(`command_id = 'ops.copy_setup' AND property_id = ?`, targetId)).toHaveLength(0);
  });

  it('kill:ops.write refuses it, and a suspended org is refused with the tenant code', async () => {
    const { orgId, sourceId, targetId } = await hotels();
    const base = { sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] as OpsCopyKind[] };
    await env.ENTITLEMENT_KV.put(OPS_WRITE_KILL_KEY, '1');
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base })).toMatchObject({ ok: false, error: 'ops_writes_disabled', status: 503 });
    await env.ENTITLEMENT_KV.delete(OPS_WRITE_KILL_KEY);
    expect((await trySetOrgStatus(env, orgId, 'suspended')).ok).toBe(true);
    expect(await copy.copySetup(env, { ...w(admin.operatorId), ...base })).toMatchObject({ ok: false, error: 'tenant_not_active' });
    expect((await trySetOrgStatus(env, orgId, 'active')).ok).toBe(true);
  });

  it('the same key with a different payload is 409, and a second copy into the same target while one is open is refused', async () => {
    const { sourceId, targetId } = await hotels();
    await seedSource(sourceId);
    const first = w(admin.operatorId);
    const a = await copy.copySetup(env, { ...first, sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] });
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(await copy.copySetup(env, { ...first, sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['packages'] })).toMatchObject({
      ok: false,
      error: 'idempotency_key_reused',
    });
    expect(await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['tax_rules'] })).toMatchObject({
      ok: false,
      error: 'target_not_empty',
      detail: 'copy_in_progress',
    });
  });
});

describe('R7.5 ops.copy_setup: the copy', () => {
  it('copies every kind through the existing commands with new ids, and never copies what C5 forbids', async () => {
    const { orgId, sourceId, targetId } = await hotels();
    const { stub: source, businessDate } = await seedSource(sourceId);
    const target = await stubFor(targetId);

    const accepted = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ALL_KINDS });
    expect(accepted, JSON.stringify(accepted)).toMatchObject({ ok: true, replayed: false });
    if (!accepted.ok) return;
    const copyId = accepted.copyId;
    expect(accepted.actionId).toBe(copyId);

    // Accepted: one operator_action row, a pending run, nothing on the target yet.
    const rows = await actionRows(`command_id = 'ops.copy_setup' AND property_id = ?`, targetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action_id: copyId, org_id: orgId, operator_id: admin.operatorId });
    expect((await statusOf(copyId)).state).toBe('pending');
    expect(await target.listRoomTypes('all')).toHaveLength(0);

    const names: string[] = [];
    await runWorkflow(copyId, fakeStep({ names }));
    expect(names.slice(0, 2)).toEqual(['start', 'charge_codes']);
    expect(names).toContain('rate_plans:jobs');
    expect(names[names.length - 1]).toBe('finish');
    expect(names.indexOf('room_types')).toBeLessThan(names.indexOf('rate_plans'));
    expect(names.indexOf('products')).toBeLessThan(names.indexOf('rate_plans'));
    expect(names.indexOf('rate_plans')).toBeLessThan(names.indexOf('packages'));

    const status = await statusOf(copyId);
    expect(status.state).toBe('completed');
    expect(status.notCopied).toEqual(OPS_COPY_NOT_COPIED);
    expect(status.results.room_types).toMatchObject({ state: 'done', created: 3 });
    expect(status.results.charge_codes).toMatchObject({ state: 'done', created: 2 });
    expect(status.results.tax_rules).toMatchObject({ state: 'done', created: 1 });
    expect(status.results.products).toMatchObject({ state: 'done', created: 2, parts: { categories: 1, items: 1 } });
    // Plans CP and CPD (BAR already exists), and 2 plans' worth of rate days: 2 room types x 3 nights each.
    expect(status.results.rate_plans).toMatchObject({ state: 'done', parts: { plans: 2, rateDays: 12 } });
    expect(status.results.rate_plans!.skipped).toEqual([{ sourceId: 'BAR', label: expect.any(String), reason: 'default_plan_exists' }]);
    expect(status.results.packages).toMatchObject({ state: 'done', created: 1 });
    expect(status.results.config).toMatchObject({ state: 'done', created: 1 });

    // Room types: new ids, same codes, physical count 0, and a consistent availability ledger.
    const srcTypes = await source.listRoomTypes('all');
    const tgtTypes = await target.listRoomTypes('all');
    expect(tgtTypes.map((t) => t.code).sort()).toEqual(['FLEX', 'KING', 'QUEEN']);
    for (const t of tgtTypes) {
      expect(srcTypes.map((s) => s.roomTypeId)).not.toContain(t.roomTypeId);
      expect(t.roomCount).toBe(0);
    }
    const king = tgtTypes.find((t) => t.code === 'KING')!;
    const flex = tgtTypes.find((t) => t.code === 'FLEX')!;
    expect(await target.countAvailabilityDays(king.roomTypeId)).toBe(HORIZON_DAYS);
    expect(flex.kind).toBe('virtual');
    expect(flex.constituentRoomTypeIds.sort()).toEqual(tgtTypes.filter((t) => t.kind === 'physical').map((t) => t.roomTypeId).sort());
    expect(await target.readCopyCensus([])).toMatchObject({ reservations: 0 });

    // Rooms are never copied.
    expect((await source.readConsoleHealth(Date.now())).roomCount).toBe(1);
    expect((await target.readConsoleHealth(Date.now())).roomCount).toBe(0);

    // A copied rate plan points at the TARGET's room types, products and parent plan.
    const plans = await target.listRatePlans();
    const cp = plans.find((p) => p.code === 'CP')!;
    const cpd = plans.find((p) => p.code === 'CPD')!;
    expect(cp.ratePlanId).not.toBe('rp_src_cp');
    expect(cpd.parentRatePlanId).toBe(cp.ratePlanId);
    const targetProducts = await target.listProducts('all');
    expect(targetProducts.items).toHaveLength(1);
    expect(targetProducts.items[0]!.productId).not.toBe('prod_src_bf');
    expect(cp.inclusions.map((i) => i.productId)).toEqual([targetProducts.items[0]!.productId]);
    const days = await target.listRateDays({ fromDate: businessDate, toDate: addDays(businessDate, 10), roomTypeId: king.roomTypeId, ratePlanId: cp.ratePlanId });
    expect(days.map((d) => d.amountMinor)).toEqual([10_000, 10_001, 10_002]);
    const barDays = await target.listRateDays({ fromDate: businessDate, toDate: addDays(businessDate, 10), roomTypeId: king.roomTypeId, ratePlanId: 'BAR' });
    expect(barDays).toHaveLength(3);
    expect(days.every((d) => d.roomTypeId === king.roomTypeId)).toBe(true);

    // Package, charge codes, tax rule.
    const pkg = (await target.listPackages('all')).packages;
    expect(pkg).toHaveLength(1);
    expect(pkg[0]).toMatchObject({ code: 'BNB', roomTypeId: king.roomTypeId, ratePlanId: 'BAR' });
    expect(pkg[0]!.packageId).not.toBe('pkg_src_1');
    expect(pkg[0]!.components.map((c) => c.productId)).toEqual([targetProducts.items[0]!.productId]);
    const codes = await target.listChargeCodes('all');
    expect(codes.find((c) => c.code === 'FNB')).toMatchObject({ taxGroup: 'GOODS', status: 'active' });
    const rules = await target.listTaxRules();
    expect(rules.map((r) => r.ruleKey)).toEqual(['room_cgst']);
    expect(rules[0]!.taxRuleId).not.toBe('tr_src_cgst');

    // C5: no SECRET key, GSTIN, invoice series, bank text; and the cutoff policy did arrive.
    const keys = await storedConfigKeys(target);
    expect(keys).toContain('pms.booking.same_day_cutoff');
    for (const key of Object.keys(SOURCE_SECRETS)) expect(keys, key).not.toContain(key);
    const secretKeys = CONFIG_REGISTER.filter((e) => e.class === 'SECRET').map((e) => e.key);
    for (const key of secretKeys) expect(keys, key).not.toContain(key);
    const configNow = (await target.listDomainConfig()) as unknown as Array<{ key: string; source: string; value: unknown }>;
    expect(configNow.find((c) => c.key === 'pms.tax.registrations')!.source).not.toBe('stored');
    expect(JSON.stringify(configNow)).not.toContain('27AAPFU0939F1ZV');
    expect(JSON.stringify(configNow)).not.toContain('SRC-INV');
    expect(JSON.stringify(configNow)).not.toContain('Source Hotel Pvt Ltd');
    // The business date and the night-audit schedule are the target's own.
    expect(keys).not.toContain('pms.night_audit.audit_time');

    // The target's audit log shows every replayed command with the operator actor.
    const operatorRows = await auditRows(target, { actor: `operator:${admin.operatorId}` });
    const commandIds = new Set(operatorRows.map((r) => r.commandId));
    for (const id of [
      'inventory.add_room_type',
      'rates.create_plan',
      'rates.update_room_type_rate',
      'rates.create_package',
      'folio.create_charge_code',
      'folio.update_charge_code',
      'folio.create_tax_rule',
      'products.create_category',
      'products.create_item',
    ]) {
      expect(commandIds, id).toContain(id);
    }
    expect(operatorRows.every((r) => r.actor === `operator:${admin.operatorId}`)).toBe(true);
    const everyRow = await auditRows(target, {});
    expect(everyRow.filter((r) => r.actor.startsWith('operator:'))).toHaveLength(operatorRows.length);
    // `config.put_domain` keeps its own audit table (property_config_audit); its actor is the operator too.
    const configAudit = await runInDurableObject(target, (_i, state) =>
      state.storage.sql.exec(`SELECT key, actor FROM property_config_audit WHERE actor LIKE 'operator:%'`).toArray() as Array<{ key: string; actor: string }>,
    );
    expect(configAudit).toEqual([{ key: 'pms.booking.same_day_cutoff', actor: `operator:${admin.operatorId}` }]);

    // Still exactly one operator_action row for the whole copy.
    expect(await actionRows(`command_id = 'ops.copy_setup' AND property_id = ?`, targetId)).toHaveLength(1);
  });

  it('a run killed half-way and sent again ends with exactly one copy of each item', async () => {
    const { sourceId, targetId } = await hotels();
    await seedSource(sourceId);
    const target = await stubFor(targetId);
    const request = { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ALL_KINDS };
    const accepted = await copy.copySetup(env, request);
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok) return;

    // Killed at the rate plans: charge codes, tax rules, room types and products are already on the target.
    await expect(runWorkflow(accepted.copyId, fakeStep({ failAt: 'rate_plans' }))).rejects.toThrow(/killed at rate_plans/);
    const halfway = await statusOf(accepted.copyId);
    expect(halfway.state).toBe('failed');
    expect(halfway.error).toBe('step_failed');
    expect(halfway.results.room_types).toMatchObject({ state: 'done', created: 3 });
    expect(halfway.results.rate_plans).toMatchObject({ state: 'failed', created: 0 });
    expect(await target.listRoomTypes('all')).toHaveLength(3);
    expect(await target.listRatePlans()).toHaveLength(1);

    // Another copy cannot start while the half-done one still owns the target's contents.
    const other = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types'] });
    expect(other).toMatchObject({ ok: false, error: 'target_not_empty' });

    // Same request again: the SAME copy, attempt 2. Then the body runs to the end, every step replaying.
    const resumed = await copy.copySetup(env, request);
    expect(resumed).toMatchObject({ ok: true, replayed: true, copyId: accepted.copyId });
    expect((await statusOf(accepted.copyId)).state).toBe('pending');
    await runWorkflow(accepted.copyId);
    const done = await statusOf(accepted.copyId);
    expect(done.state).toBe('completed');
    expect(done.results.room_types!.created).toBe(3);
    expect(done.results.rate_plans).toMatchObject({ parts: { plans: 2, rateDays: 12 } });

    expect(await target.listRoomTypes('all')).toHaveLength(3);
    expect((await target.listRatePlans()).map((p) => p.code).sort()).toEqual(['BAR', 'CP', 'CPD']);
    expect((await target.listPackages('all')).packages).toHaveLength(1);
    expect((await target.listProducts('all')).items).toHaveLength(1);
    expect((await target.listProducts('all')).categories).toHaveLength(1);
    expect((await target.listTaxRules()).length).toBe(1);
    expect((await target.listChargeCodes('all')).filter((c) => c.code === 'FNB' || c.code === 'CGST')).toHaveLength(2);
    expect(await actionRows(`command_id = 'ops.copy_setup' AND property_id = ?`, targetId)).toHaveLength(1);

    // And running the finished body a third time changes nothing: every item is an idempotent replay.
    await runWorkflow(accepted.copyId).catch(() => undefined);
    expect(await target.listRoomTypes('all')).toHaveLength(3);
    expect((await target.listPackages('all')).packages).toHaveLength(1);
  });

  it('the same request sent again after completion is a replay and starts nothing', async () => {
    const { sourceId, targetId } = await hotels();
    await seedSource(sourceId);
    const request = { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['charge_codes'] as OpsCopyKind[] };
    const first = await copy.copySetup(env, request);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) return;
    await runWorkflow(first.copyId);
    const again = await copy.copySetup(env, request);
    expect(again).toMatchObject({ ok: true, replayed: true, copyId: first.copyId });
    expect((await statusOf(first.copyId)).state).toBe('completed');
    expect(await actionRows(`command_id = 'ops.copy_setup' AND property_id = ?`, targetId)).toHaveLength(1);
  });

  it('an item the target refuses is a skipped item with its reason, not a failed copy', async () => {
    const { sourceId, targetId } = await hotels();
    const { stub: source } = await seedSource(sourceId);
    // An archived room type and a rate plan that depends on a kind that was not selected.
    const archived = { roomTypeId: 'rt_src_old', code: 'OLD', name: 'Old', roomCount: 1, maxOccupancy: 2, maxAdults: 2 };
    expect(await source.tryAddRoomType(SYS, archived, await idemFor('rt-old', archived))).toMatchObject({ ok: true });
    expect(await source.tryDeleteRoomType(SYS, { roomTypeId: 'rt_src_old' }, await idemFor('rt-old-arch', { roomTypeId: 'rt_src_old' }))).toMatchObject({ ok: true });

    const accepted = await copy.copySetup(env, { ...w(admin.operatorId), sourcePropertyId: sourceId, targetPropertyId: targetId, kinds: ['room_types', 'rate_plans', 'packages'] });
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok) return;
    await runWorkflow(accepted.copyId);
    const status = await statusOf(accepted.copyId);
    expect(status.state).toBe('completed');
    expect(status.kinds).toEqual(['room_types', 'rate_plans', 'packages']);
    expect(status.results.room_types!.skipped).toEqual([{ sourceId: 'rt_src_old', label: 'Old', reason: 'archived' }]);
    // CP needs its product, and products were not selected.
    const reasons = Object.fromEntries(status.results.rate_plans!.skipped.map((s) => [s.sourceId, s.reason]));
    expect(reasons).toMatchObject({ rp_src_cp: 'dependency_not_copied', rp_src_cpd: 'dependency_not_copied', BAR: 'default_plan_exists' });
    expect(status.results.packages!.skipped).toEqual([{ sourceId: 'pkg_src_1', label: 'Bed and breakfast', reason: 'dependency_not_copied' }]);
    expect(status.results.config).toBeUndefined();
  });
});

describe('R7.5 status read and the entrypoint', () => {
  it('getCopyStatus is readable by a viewer, unknown copies are 404, and OpsEntrypoint exposes both methods', async () => {
    expect(await copy.getCopyStatus(env, { operatorId: viewer.operatorId, copyId: 'opa_nope' })).toMatchObject({ ok: false, error: 'not_found', status: 404 });
    expect(await copy.getCopyStatus(env, { operatorId: 'op_ghost', copyId: 'opa_nope' })).toMatchObject({ ok: false, error: 'not_an_operator' });
    expect(typeof OpsEntrypoint.prototype.copySetup).toBe('function');
    expect(typeof OpsEntrypoint.prototype.getCopyStatus).toBe('function');
  });

  it('ops.copy_setup is the one BACKGROUND catalog entry, backed by a real Workflow binding', () => {
    const entry = COMMAND_BY_ID.get('ops.copy_setup')!;
    expect(entry.lane).toBe('BACKGROUND');
    expect(entry.permission).toBe('shell:internal');
    expect(typeof env.OPS_COPY_WORKFLOW.create).toBe('function');
    expect(typeof OpsCopyWorkflow.prototype.run).toBe('function');
  });
});

describe('R7.5 copy-scoped operator and the allowlist', () => {
  it('an operator passes only the setup permissions, only with the copy scope', async () => {
    const { sourceId } = await hotels();
    const stub = await stubFor(sourceId);
    const plain: ActorContext = { kind: 'operator', operatorId: admin.operatorId };
    const scoped: ActorContext = {
      kind: 'operator',
      operatorId: admin.operatorId,
      scope: 'copy_setup',
      targetPropertyId: sourceId,
    };
    const elsewhere: ActorContext = {
      kind: 'operator',
      operatorId: admin.operatorId,
      scope: 'copy_setup',
      targetPropertyId: 'prop_some_other_hotel',
    };
    const unbound: ActorContext = { kind: 'operator', operatorId: admin.operatorId, scope: 'copy_setup' };
    const cc = { code: 'SCOPE', name: 'Scope test' };
    expect(await stub.tryCreateChargeCode(plain, cc, await idemFor('scope-plain', cc))).toMatchObject({ ok: false, error: 'forbidden' });
    // The scope is bound to one hotel: aimed at another hotel, or at none, it opens nothing here.
    expect(await stub.tryCreateChargeCode(elsewhere, cc, await idemFor('scope-elsewhere', cc))).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await stub.tryCreateChargeCode(unbound, cc, await idemFor('scope-unbound', cc))).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await stub.tryCreateChargeCode(scoped, cc, await idemFor('scope-ok', cc))).toMatchObject({ ok: true });
    // The idempotency key is the operator's own, never the shared system namespace.
    const stored = await runInDurableObject(stub, (_i, state) =>
      (state.storage.sql.exec(`SELECT key FROM idempotency WHERE key LIKE '%scope-ok'`).toArray() as Array<{ key: string }>).map((r) => r.key),
    );
    expect(stored).toEqual([`operator:${admin.operatorId}:scope-ok`]);
    // A permission outside the setup set (folio:read on the audit log) is still refused.
    expect(await stub.listAuditLog(scoped)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(OPERATOR_COPY_PERMISSIONS).toEqual(['inventory:write', 'inventory:configure', 'rates:write', 'settings:configure']);
  });

  it('the config allowlist holds no SECRET key and none of the C5 items, and every entry is writable by a copy', () => {
    const byKey = new Map(CONFIG_REGISTER.map((e) => [e.key, e]));
    for (const key of COPY_CONFIG_ALLOWLIST) {
      const entry = byKey.get(key);
      expect(entry, key).toBeDefined();
      expect(entry!.class, key).toBe('DOMAIN');
      expect((OPERATOR_COPY_PERMISSIONS as readonly string[]).includes(entry!.permission), `${key} needs ${entry!.permission}`).toBe(true);
      expect(COPY_CONFIG_NEVER, key).not.toContain(key);
    }
    for (const entry of CONFIG_REGISTER.filter((e) => e.class === 'SECRET')) expect(COPY_CONFIG_ALLOWLIST).not.toContain(entry.key);
    for (const key of COPY_CONFIG_NEVER) expect(COPY_CONFIG_ALLOWLIST).not.toContain(key);
    for (const key of COPY_CONFIG_ALLOWLIST) {
      expect(key).not.toMatch(/registrations|invoice\.(prefix|suffix|series|starting_idx|title|footer)|bank|paypal|terminal|logo|audit_time|time_zone|currency_code|gstin|legal/);
    }
  });
});
