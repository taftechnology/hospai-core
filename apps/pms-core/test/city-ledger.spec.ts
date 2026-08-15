import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CITY_LEDGER_ACCOUNT_ARCHIVED,
  CITY_LEDGER_ACCOUNT_EXISTS,
  CITY_LEDGER_ACCOUNT_NOT_FOUND,
  CITY_LEDGER_BILLED_PARTY_INVALID,
  CITY_LEDGER_CREDIT_LIMIT_EXCEEDED,
  CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE,
  CITY_LEDGER_R2_UNBOUND,
  CITY_LEDGER_STATEMENT_NOT_FOUND,
} from '@hospai/contracts';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';

async function createCityLedgerAccount(
  stub: DurableObjectStub<PropertyDO>,
  input: { name: string; creditLimitMinor?: number; termsDays?: number },
  idemSuffix = input.name,
) {
  return stub.tryCreateCityLedgerAccount(
    TEST_OWNER_ACTOR,
    input,
    await idemFor(`cla-create-${idemSuffix}`, { name: input.name.trim() }),
  );
}

async function sha256HexFromBody(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function setupCompanyWindowAtZeroBalance(
  stub: DurableObjectStub<PropertyDO>,
  opts: {
    reservationId: string;
    accountName: string;
    receivableMinor: number;
    creditLimitMinor?: number;
  },
) {
  const account = await createCityLedgerAccount(stub, {
    name: opts.accountName,
    creditLimitMinor: opts.creditLimitMinor ?? 1_000_000,
  });
  if (!account.ok) throw new Error(`create account failed: ${account.error}`);

  const openFp = {
    reservationId: opts.reservationId,
    kind: 'COMPANY' as const,
    billedParty: opts.accountName,
  };
  const open = await stub.tryOpenFolioWindow(
    TEST_OWNER_ACTOR,
    openFp,
    await idemFor(`open-co-${opts.reservationId}`, openFp),
  );
  if (!open.ok) throw new Error(`open company window failed: ${open.error}`);

  const businessDate = (await stub.readBusinessDate())!;
  if (opts.receivableMinor > 0) {
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: open.folioWindowId,
      reservationId: opts.reservationId,
      chargeCode: 'ROOM',
      amountMinor: opts.receivableMinor,
      source: 'desk',
      businessDate,
    });
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: open.folioWindowId,
      reservationId: opts.reservationId,
      chargeCode: 'PAYMENT',
      amountMinor: -opts.receivableMinor,
      source: 'desk',
      businessDate,
    });
  }

  return { account, folioWindowId: open.folioWindowId, businessDate };
}

async function seedReservation(
  stub: DurableObjectStub<PropertyDO>,
  reservationId: string,
  businessDate: string,
) {
  await stub.insertReservationForTest({
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: 'guest',
    piiKeyId: 'pii',
    arrivalDate: businessDate,
    departureDate: addCalendarDays(businessDate, 1),
  });
}

describe('city ledger account CRUD', () => {
  it('creates account on happy path', async () => {
    const { stub } = await provisionedPropertyStub(`cl-create-${crypto.randomUUID()}`, 'UTC', 'USD');
    const result = await createCityLedgerAccount(stub, {
      name: 'Acme Corp',
      creditLimitMinor: 500_000,
      termsDays: 30,
    });
    expect(result).toMatchObject({
      ok: true,
      name: 'Acme Corp',
      status: 'active',
      creditLimitMinor: 500_000,
      termsDays: 30,
    });
    if (!result.ok) return;
    expect(result.accountId).toBeTruthy();
  });

  it('rejects duplicate account name with city_ledger_account_exists', async () => {
    const { stub } = await provisionedPropertyStub(`cl-dup-${crypto.randomUUID()}`, 'UTC', 'USD');
    const first = await createCityLedgerAccount(stub, { name: 'Acme Corp' });
    expect(first.ok).toBe(true);
    const dup = await createCityLedgerAccount(stub, { name: 'Acme Corp' }, 'dup');
    expect(dup).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_EXISTS });
  });

  it('lists accounts with open balance and aging buckets', async () => {
    const { stub } = await provisionedPropertyStub(`cl-list-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'List Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-01');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 10_000,
      businessDate: '2026-07-01',
    });

    const list = await stub.readCityLedgerAccounts({ status: 'active' });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0]).toMatchObject({
      accountId: created.accountId,
      name: 'List Co',
      openBalanceMinor: 10_000,
    });
    expect(list.accounts[0]!.aging.totalOpenMinor).toBe(10_000);
    expect(list.accounts[0]!.aging.days30Minor).toBe(10_000);
  });

  it('reads account detail with open entries and derived aging', async () => {
    const { stub } = await provisionedPropertyStub(`cl-detail-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Detail Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-15');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 5_000,
      businessDate: '2026-08-01',
    });
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 3_000,
      businessDate: addCalendarDays('2026-08-01', -45),
    });

    const detail = await stub.readCityLedgerAccount(created.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.entries).toHaveLength(2);
    expect(detail.openBalanceMinor).toBe(8_000);
    expect(detail.aging.totalOpenMinor).toBe(8_000);
    expect(detail.aging.currentMinor).toBe(5_000);
    expect(detail.aging.days30Minor).toBe(3_000);
  });
});

describe('city ledger account update and archive', () => {
  it('updates account name, terms, and credit limit', async () => {
    const { stub } = await provisionedPropertyStub(`cl-update-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Before Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const patch = {
      accountId: created.accountId,
      name: 'After Co',
      creditLimitMinor: 999_000,
      termsDays: 45,
    };
    const updated = await stub.tryUpdateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      patch,
      await idemFor('cla-update', patch),
    );
    expect(updated).toMatchObject({
      ok: true,
      name: 'After Co',
      creditLimitMinor: 999_000,
      termsDays: 45,
    });

    const detail = await stub.readCityLedgerAccount(created.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.name).toBe('After Co');
    expect(detail.creditLimitMinor).toBe(999_000);
    expect(detail.termsDays).toBe(45);
  });

  it('rejects update on archived account with city_ledger_account_archived', async () => {
    const { stub } = await provisionedPropertyStub(`cl-arch-upd-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Archive Upd Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const archiveFp = { accountId: created.accountId };
    expect(
      await stub.tryArchiveCityLedgerAccount(
        TEST_OWNER_ACTOR,
        archiveFp,
        await idemFor('cla-archive', archiveFp),
      ),
    ).toMatchObject({ ok: true });

    const patch = { accountId: created.accountId, name: 'Nope' };
    const updated = await stub.tryUpdateCityLedgerAccount(
      TEST_OWNER_ACTOR,
      patch,
      await idemFor('cla-arch-upd', patch),
    );
    expect(updated).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED });
  });

  it('blocks archive when open balance is non-zero', async () => {
    const { stub } = await provisionedPropertyStub(`cl-arch-bal-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Open Bal Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 1_000,
      businessDate: '2026-08-01',
    });

    const archiveFp = { accountId: created.accountId };
    const blocked = await stub.tryArchiveCityLedgerAccount(
      TEST_OWNER_ACTOR,
      archiveFp,
      await idemFor('cla-arch-block', archiveFp),
    );
    expect(blocked).toMatchObject({ ok: false, error: CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE });
  });

  it('archives account idempotently when open balance is zero', async () => {
    const { stub } = await provisionedPropertyStub(`cl-arch-ok-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Zero Bal Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const archiveFp = { accountId: created.accountId };
    const idem = await idemFor('cla-arch-zero', archiveFp);
    const first = await stub.tryArchiveCityLedgerAccount(TEST_OWNER_ACTOR, archiveFp, idem);
    expect(first).toMatchObject({ ok: true, status: 'archived' });
    const replay = await stub.tryArchiveCityLedgerAccount(TEST_OWNER_ACTOR, archiveFp, idem);
    expect(replay).toMatchObject({ ok: true, status: 'archived' });

    const detail = await stub.readCityLedgerAccount(created.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.status).toBe('archived');
  });
});

describe('city ledger payments', () => {
  it('receives payment, reduces open balance, and replays idempotently', async () => {
    const { stub } = await provisionedPropertyStub(`cl-pay-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Pay Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 5_000,
      businessDate: '2026-08-01',
    });

    const payFp = {
      accountId: created.accountId,
      amountMinor: 2_000,
      businessDate: '2026-08-01',
      reference: null,
    };
    const idem = await idemFor('cla-pay', payFp);
    const first = await stub.tryReceiveCityLedgerPayment(TEST_OWNER_ACTOR, payFp, idem);
    expect(first).toMatchObject({ ok: true, openBalanceMinor: 3_000 });
    if (!first.ok) return;
    expect(first.entryId).toBeTruthy();

    const replay = await stub.tryReceiveCityLedgerPayment(TEST_OWNER_ACTOR, payFp, idem);
    expect(replay).toMatchObject({ ok: true, entryId: first.entryId, openBalanceMinor: 3_000 });
  });

  it('rejects overpayment with city_ledger_payment_exceeds_balance', async () => {
    const { stub } = await provisionedPropertyStub(`cl-overpay-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Overpay Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 1_000,
      businessDate: '2026-08-01',
    });

    const payFp = {
      accountId: created.accountId,
      amountMinor: 2_000,
      businessDate: '2026-08-01',
      reference: null,
    };
    const result = await stub.tryReceiveCityLedgerPayment(
      TEST_OWNER_ACTOR,
      payFp,
      await idemFor('cla-overpay', payFp),
    );
    expect(result).toMatchObject({ ok: false, error: CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE });
  });
});

describe('city ledger statements', () => {
  it('generates statement in R2 with rows and totals; idempotent replay returns same key', async () => {
    const propertyId = `cl-stmt-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Stmt Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-15');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 4_000,
      businessDate: '2026-08-01',
    });

    const genFp = { accountId: created.accountId, asOfDate: '2026-08-15' };
    const idem = await idemFor('cla-stmt', genFp);
    const first = await stub.tryGenerateCityLedgerStatement(TEST_OWNER_ACTOR, genFp, idem);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error(`generate statement failed: ${first.error}`);
    const firstOk = first as unknown as {
      ok: true;
      statementId: string;
      r2Key: string;
      sha256: string;
      snapshot: { totals: { openMinor: number }; entries: unknown[] };
    };
    expect(firstOk.r2Key).toContain(`city-ledger-statements/${propertyId}/${created.accountId}/`);
    expect(firstOk.sha256).toBeTruthy();
    expect(firstOk.snapshot.totals.openMinor).toBe(4_000);
    expect(Array.isArray(firstOk.snapshot.entries)).toBe(true);

    const obj = await env.EVENT_LOG_R2!.get(firstOk.r2Key);
    expect(obj).not.toBeNull();
    const body = new Uint8Array(await obj!.arrayBuffer());
    expect(await sha256HexFromBody(body)).toBe(firstOk.sha256);

    const replay = await stub.tryGenerateCityLedgerStatement(TEST_OWNER_ACTOR, genFp, idem);
    expect(replay).toMatchObject({
      ok: true,
      statementId: firstOk.statementId,
      r2Key: firstOk.r2Key,
      sha256: firstOk.sha256,
    });
  });

  it('reads statement snapshot from R2; missing returns city_ledger_statement_not_found', async () => {
    const { stub } = await provisionedPropertyStub(`cl-get-stmt-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Get Stmt Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const genFp = { accountId: created.accountId, asOfDate: '2026-08-15' };
    const generated = await stub.tryGenerateCityLedgerStatement(
      TEST_OWNER_ACTOR,
      genFp,
      await idemFor('cla-get-stmt', genFp),
    );
    expect(generated.ok).toBe(true);
    if (generated.ok) {
      const generatedOk = generated as unknown as { ok: true; statementId: string };
      const got = await stub.readCityLedgerStatement({
        accountId: created.accountId,
        statementId: generatedOk.statementId,
      });
      expect(got.ok).toBe(true);
      if (got.ok) {
        const gotOk = got as unknown as {
          ok: true;
          statementId: string;
          snapshot: { totals: { openMinor: number } };
        };
        expect(gotOk.statementId).toBe(generatedOk.statementId);
        expect(gotOk.snapshot.totals.openMinor).toBeDefined();
      } else {
        throw new Error(`read statement failed: ${got.error}`);
      }
    } else {
      throw new Error(`generate statement failed: ${generated.error}`);
    }

    const missing = await stub.readCityLedgerStatement({
      accountId: created.accountId,
      statementId: crypto.randomUUID(),
    });
    expect(missing).toMatchObject({ ok: false, error: CITY_LEDGER_STATEMENT_NOT_FOUND });
  });

  it('returns city_ledger_r2_unbound when R2 is unbound on generate', async () => {
    const { stub } = await provisionedPropertyStub(`cl-r2-unbound-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'R2 Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setReportsR2UnboundForTest(true);
    const genFp = { accountId: created.accountId, asOfDate: '2026-08-15' };
    const result = await stub.tryGenerateCityLedgerStatement(
      TEST_OWNER_ACTOR,
      genFp,
      await idemFor('cla-r2-unbound', genFp),
    );
    expect(result).toMatchObject({ ok: false, error: CITY_LEDGER_R2_UNBOUND });
  });
});

describe('city ledger billed_party validation RPC', () => {
  it('accepts active account by name or id and returns canonical name', async () => {
    const { stub } = await provisionedPropertyStub(`cl-bp-active-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Canonical Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const byName = await stub.validateCityLedgerBilledParty({ billedParty: 'Canonical Co' });
    expect(byName).toMatchObject({ ok: true, billedParty: 'Canonical Co', accountId: created.accountId });

    const byId = await stub.validateCityLedgerBilledParty({ billedParty: created.accountId });
    expect(byId).toMatchObject({ ok: true, billedParty: 'Canonical Co', accountId: created.accountId });
  });

  it('rejects archived account with city_ledger_account_archived', async () => {
    const { stub } = await provisionedPropertyStub(`cl-bp-arch-${crypto.randomUUID()}`, 'UTC', 'USD');
    const created = await createCityLedgerAccount(stub, { name: 'Archived Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const archiveFp = { accountId: created.accountId };
    expect(
      await stub.tryArchiveCityLedgerAccount(
        TEST_OWNER_ACTOR,
        archiveFp,
        await idemFor('cla-bp-arch', archiveFp),
      ),
    ).toMatchObject({ ok: true });

    const result = await stub.validateCityLedgerBilledParty({ billedParty: 'Archived Co' });
    expect(result).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED });
  });

  it('grandfathers legacy COMPANY billed_party labels', async () => {
    const { stub } = await provisionedPropertyStub(`cl-bp-legacy-${crypto.randomUUID()}`, 'UTC', 'USD');
    await stub.seedLegacyCompanyWindowForTest('res_legacy', 'Legacy Co');

    const legacy = await stub.validateCityLedgerBilledParty({ billedParty: 'Legacy Co' });
    expect(legacy).toMatchObject({ ok: true, billedParty: 'Legacy Co', grandfathered: true });

    const unknown = await stub.validateCityLedgerBilledParty({ billedParty: 'Unknown Label' });
    expect(unknown).toMatchObject({ ok: false, error: CITY_LEDGER_BILLED_PARTY_INVALID });
  });
});

describe('city ledger account not found', () => {
  it('returns city_ledger_account_not_found for missing account reads', async () => {
    const { stub } = await provisionedPropertyStub(`cl-missing-${crypto.randomUUID()}`, 'UTC', 'USD');
    const detail = await stub.readCityLedgerAccount(crypto.randomUUID());
    expect(detail).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_NOT_FOUND });
  });
});

describe('city ledger charge posting', () => {
  it('postCityLedgerChargeSync inserts one charge row with source window_close on close', async () => {
    const { stub } = await provisionedPropertyStub(`cl-charge-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Charge Co',
      receivableMinor: 12_000,
    });

    const closeFp = { folioWindowId };
    const closed = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      closeFp,
      await idemFor('close-co-charge', closeFp),
    );
    expect(closed).toMatchObject({ ok: true });

    const charge = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(charge).toMatchObject({
      accountId: account.accountId,
      kind: 'charge',
      source: 'window_close',
      amountMinor: 12_000,
      reservationId,
      folioWindowId,
    });

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBe(12_000);
    expect(detail.entries.filter((e) => e.kind === 'charge')).toHaveLength(1);
  });

  it('replay same folioWindowId is idempotent — single charge row', async () => {
    const { stub } = await provisionedPropertyStub(`cl-charge-idem-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Idem Co',
      receivableMinor: 5_000,
    });

    const closeFp = { folioWindowId };
    const idem = await idemFor('close-co-idem', closeFp);
    expect(await stub.tryCloseFolioWindow(TEST_OWNER_ACTOR, closeFp, idem)).toMatchObject({ ok: true });
    const first = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(first?.entryId).toBeTruthy();

    expect(
      await stub.tryCloseFolioWindow(
        TEST_OWNER_ACTOR,
        closeFp,
        await idemFor('close-co-idem-replay', closeFp),
      ),
    ).toMatchObject({
      ok: true,
      alreadyClosed: true,
    });
    const second = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(second?.entryId).toBe(first?.entryId);

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.entries.filter((e) => e.kind === 'charge')).toHaveLength(1);
  });

  it('rejects when credit limit exceeded with city_ledger_credit_limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`cl-charge-limit-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Limit Co',
      receivableMinor: 3_000,
      creditLimitMinor: 5_000,
    });
    await stub.seedCityLedgerEntryForTest({
      accountId: account.accountId,
      kind: 'charge',
      amountMinor: 3_000,
      businessDate,
    });

    const closeFp = { folioWindowId };
    const closed = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      closeFp,
      await idemFor('close-co-limit', closeFp),
    );
    expect(closed).toMatchObject({ ok: false, error: CITY_LEDGER_CREDIT_LIMIT_EXCEEDED });

    const win = await stub.readFolioWindowForTest(folioWindowId);
    expect(win?.status).toBe('OPEN');
    expect(await stub.readCityLedgerChargeForWindowForTest(folioWindowId)).toBeNull();
  });

  it('rejects archived account with city_ledger_account_archived', async () => {
    const { stub } = await provisionedPropertyStub(`cl-charge-arch-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Arch Post Co',
      receivableMinor: 2_000,
    });
    await stub.setCityLedgerAccountArchivedForTest(account.accountId);

    const closeFp = { folioWindowId };
    const closed = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      closeFp,
      await idemFor('close-co-arch', closeFp),
    );
    expect(closed).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_ARCHIVED });

    const win = await stub.readFolioWindowForTest(folioWindowId);
    expect(win?.status).toBe('OPEN');
    expect(await stub.readCityLedgerChargeForWindowForTest(folioWindowId)).toBeNull();
  });
});

describe('city ledger close hook', () => {
  it('posts charge only for COMPANY windows at zero balance, not GUEST or MASTER', async () => {
    const { stub } = await provisionedPropertyStub(`cl-hook-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId: companyWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Hook Co',
      receivableMinor: 4_000,
    });

    const masterOpenFp = { reservationId, kind: 'MASTER' as const };
    const masterOpen = await stub.tryOpenFolioWindow(
      TEST_OWNER_ACTOR,
      masterOpenFp,
      await idemFor('open-master', masterOpenFp),
    );
    expect(masterOpen).toMatchObject({ ok: true });
    if (!masterOpen.ok) return;

    const closeCompany = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: companyWindowId },
      await idemFor('close-co-hook', { folioWindowId: companyWindowId }),
    );
    expect(closeCompany).toMatchObject({ ok: true });
    expect(await stub.readCityLedgerChargeForWindowForTest(companyWindowId)).toMatchObject({
      source: 'window_close',
      amountMinor: 4_000,
    });

    const closeMaster = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: masterOpen.folioWindowId },
      await idemFor('close-master', { folioWindowId: masterOpen.folioWindowId }),
    );
    expect(closeMaster).toMatchObject({ ok: true });
    expect(await stub.readCityLedgerChargeForWindowForTest(masterOpen.folioWindowId)).toBeNull();

    const guestResId = `res_guest_${crypto.randomUUID()}`;
    await stub.insertReservationForTest({
      reservationId: guestResId,
      roomTypeId: 'rt_king',
      guestRef: 'guest',
      piiKeyId: 'pii',
      arrivalDate: businessDate,
      departureDate: addCalendarDays(businessDate, 1),
      status: 'checked_out',
    });
    const guestLineId = crypto.randomUUID();
    expect(
      await stub.tryAddFolioLine(
        TEST_OWNER_ACTOR,
        {
          folioLineId: guestLineId,
          reservationId: guestResId,
          chargeCode: 'MISC',
          amountMinor: 100,
          businessDate,
        },
        await idemFor('guest-misc-hook', { folioLineId: guestLineId }),
      ),
    ).toMatchObject({ ok: true });
    await stub.insertFolioLineRawForTest({
      folioLineId: crypto.randomUUID(),
      folioWindowId: `${guestResId}:GUEST`,
      reservationId: guestResId,
      chargeCode: 'PAYMENT',
      amountMinor: -100,
      source: 'desk',
      businessDate,
    });
    const closeGuest = await stub.tryCloseFolioWindow(
      TEST_OWNER_ACTOR,
      { folioWindowId: `${guestResId}:GUEST` },
      await idemFor('close-guest', { folioWindowId: `${guestResId}:GUEST` }),
    );
    expect(closeGuest).toMatchObject({ ok: true });
    expect(await stub.readCityLedgerChargeForWindowForTest(`${guestResId}:GUEST`)).toBeNull();

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.entries.filter((e) => e.kind === 'charge')).toHaveLength(1);
  });
});

describe('city ledger night-audit catch-up', () => {
  it('postPendingCityLedgerChargesForBusinessDateSync posts missed charges with source night_audit', async () => {
    const { stub } = await provisionedPropertyStub(`cl-catchup-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Catchup Co',
      receivableMinor: 7_500,
    });

    const closedAtMs = Date.parse(`${businessDate}T12:00:00.000Z`);
    await stub.stampFolioWindowClosedForTest(folioWindowId, closedAtMs);
    expect(await stub.readCityLedgerChargeForWindowForTest(folioWindowId)).toBeNull();

    expect((await stub.runAuditStep(businessDate, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');

    const charge = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(charge).toMatchObject({
      accountId: account.accountId,
      kind: 'charge',
      source: 'night_audit',
      amountMinor: 7_500,
      folioWindowId,
    });

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.openBalanceMinor).toBe(7_500);
  });

  it('night-audit catch-up re-run for same business date is idempotent', async () => {
    const { stub } = await provisionedPropertyStub(`cl-catchup-idem-${crypto.randomUUID()}`, 'UTC', 'USD');
    const reservationId = `res_${crypto.randomUUID()}`;
    const businessDate = (await stub.readBusinessDate())!;
    await seedReservation(stub, reservationId, businessDate);

    const { account, folioWindowId } = await setupCompanyWindowAtZeroBalance(stub, {
      reservationId,
      accountName: 'Catchup Idem Co',
      receivableMinor: 1_500,
    });

    const closedAtMs = Date.parse(`${businessDate}T12:00:00.000Z`);
    await stub.stampFolioWindowClosedForTest(folioWindowId, closedAtMs);

    expect((await stub.runAuditStep(businessDate, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');
    const first = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(first?.entryId).toBeTruthy();

    expect((await stub.runAuditStep(businessDate, 'SNAPSHOT_REPORTS')).status).toBe('COMPLETED');
    const second = await stub.readCityLedgerChargeForWindowForTest(folioWindowId);
    expect(second?.entryId).toBe(first?.entryId);

    const detail = await stub.readCityLedgerAccount(account.accountId);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.entries.filter((e) => e.kind === 'charge')).toHaveLength(1);
  });
});

const HTTP_ACTOR = 'user_owner';

async function registerPropertyForHttp(propertyId: string, orgId: string): Promise<void> {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'City Ledger Test Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

async function provisionedPropertyForHttp(name: string) {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  await registerPropertyForHttp(name, orgId);
  return { stub, propertyId: name, orgId };
}

async function postCityLedgerAccountHttp(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-cla-${crypto.randomUUID()}`, ...body }),
    }),
    env,
  );
}

async function getCityLedgerAccountsHttp(propertyId: string, actor: string, query = '') {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts${query}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function patchCityLedgerAccountHttp(
  propertyId: string,
  actor: string,
  accountId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts/${encodeURIComponent(accountId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-cla-patch-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

async function postCityLedgerPaymentHttp(
  propertyId: string,
  actor: string,
  accountId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts/${encodeURIComponent(accountId)}/payments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-cla-pay-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

async function getCityLedgerStatementHttp(
  propertyId: string,
  actor: string,
  accountId: string,
  statementId: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/city-ledger/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

describe('city ledger HTTP dispatch', () => {
  it('POST create returns 201 with account body', async () => {
    const propertyId = `cl-http-create-${crypto.randomUUID()}`;
    await provisionedPropertyForHttp(propertyId);
    const res = await postCityLedgerAccountHttp(propertyId, HTTP_ACTOR, {
      name: 'Http Acme Corp',
      creditLimitMinor: 500_000,
      termsDays: 30,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ok: true,
      name: 'Http Acme Corp',
      status: 'active',
      creditLimitMinor: 500_000,
      termsDays: 30,
    });
  });

  it('POST duplicate name returns 409 city_ledger_account_exists', async () => {
    const propertyId = `cl-http-dup-${crypto.randomUUID()}`;
    await provisionedPropertyForHttp(propertyId);
    expect(
      await postCityLedgerAccountHttp(propertyId, HTTP_ACTOR, { name: 'Dup Co' }),
    ).toMatchObject({ status: 201 });
    const dup = await postCityLedgerAccountHttp(propertyId, HTTP_ACTOR, { name: 'Dup Co' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ ok: false, error: CITY_LEDGER_ACCOUNT_EXISTS });
  });

  it('GET list returns 200 with aging buckets', async () => {
    const propertyId = `cl-http-list-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'List Http Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-01');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 10_000,
      businessDate: '2026-07-01',
    });

    const res = await getCityLedgerAccountsHttp(propertyId, HTTP_ACTOR);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accounts: Array<{ accountId: string; aging: { totalOpenMinor: number; days30Minor: number } }>;
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({
      accountId: created.accountId,
      name: 'List Http Co',
    });
    expect(body.accounts[0]!.aging.totalOpenMinor).toBe(10_000);
    expect(body.accounts[0]!.aging.days30Minor).toBe(10_000);
  });

  it('GET account detail returns 200 with entries and aging', async () => {
    const propertyId = `cl-http-detail-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Detail Http Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-15');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 5_000,
      businessDate: '2026-08-01',
    });

    const res = await getCityLedgerAccountsHttp(
      propertyId,
      HTTP_ACTOR,
      `?accountId=${encodeURIComponent(created.accountId)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accountId: string;
      entries: unknown[];
      aging: { totalOpenMinor: number };
      openBalanceMinor: number;
    };
    expect(body.accountId).toBe(created.accountId);
    expect(body.entries).toHaveLength(1);
    expect(body.openBalanceMinor).toBe(5_000);
    expect(body.aging.totalOpenMinor).toBe(5_000);
  });

  it('PATCH update returns 200 with name, terms, and credit limit', async () => {
    const propertyId = `cl-http-patch-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Patch Before Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await patchCityLedgerAccountHttp(propertyId, HTTP_ACTOR, created.accountId, {
      name: 'Patch After Co',
      creditLimitMinor: 888_000,
      termsDays: 45,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      name: 'Patch After Co',
      creditLimitMinor: 888_000,
      termsDays: 45,
    });
  });

  it('PATCH archive with open balance returns 422 city_ledger_payment_exceeds_balance', async () => {
    const propertyId = `cl-http-arch-bal-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Arch Bal Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 2_000,
      businessDate: '2026-08-01',
    });

    const res = await patchCityLedgerAccountHttp(propertyId, HTTP_ACTOR, created.accountId, {
      status: 'archived',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE });
  });

  it('POST payment returns 201 with payment entry', async () => {
    const propertyId = `cl-http-pay-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Pay Http Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 5_000,
      businessDate: '2026-08-01',
    });

    const res = await postCityLedgerPaymentHttp(propertyId, HTTP_ACTOR, created.accountId, {
      amountMinor: 2_000,
      businessDate: '2026-08-01',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: true; entryId: string; openBalanceMinor: number };
    expect(body.ok).toBe(true);
    expect(body.entryId).toBeTruthy();
    expect(body.openBalanceMinor).toBe(3_000);
  });

  it('POST overpayment returns 422 city_ledger_payment_exceeds_balance', async () => {
    const propertyId = `cl-http-overpay-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Overpay Http Co' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 1_000,
      businessDate: '2026-08-01',
    });

    const res = await postCityLedgerPaymentHttp(propertyId, HTTP_ACTOR, created.accountId, {
      amountMinor: 2_000,
      businessDate: '2026-08-01',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE });
  });

  it('case 13: GET statement returns snapshot from R2; unknown returns 404', async () => {
    const propertyId = `cl-http-stmt-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyForHttp(propertyId);
    const created = await createCityLedgerAccount(stub, { name: 'Stmt Http Co', termsDays: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await stub.setBusinessDateForTest('2026-08-15');
    await stub.seedCityLedgerEntryForTest({
      accountId: created.accountId,
      kind: 'charge',
      amountMinor: 4_000,
      businessDate: '2026-08-01',
    });

    const genFp = { accountId: created.accountId, asOfDate: '2026-08-15' };
    const generated = await stub.tryGenerateCityLedgerStatement(
      TEST_OWNER_ACTOR,
      genFp,
      await idemFor('cla-http-stmt', genFp),
    );
    expect(generated.ok).toBe(true);
    if (generated.ok) {
      const generatedOk = generated as unknown as { ok: true; statementId: string };
      const got = await getCityLedgerStatementHttp(
        propertyId,
        HTTP_ACTOR,
        created.accountId,
        generatedOk.statementId,
      );
      expect(got.status).toBe(200);
      const body = (await got.json()) as {
        statementId: string;
        accountId: string;
        snapshot: { totals: { openMinor: number } };
      };
      expect(body.statementId).toBe(generatedOk.statementId);
      expect(body.accountId).toBe(created.accountId);
      expect(body.snapshot.totals.openMinor).toBe(4_000);
    } else {
      throw new Error(`generate statement failed: ${generated.error}`);
    }

    const missing = await getCityLedgerStatementHttp(
      propertyId,
      HTTP_ACTOR,
      created.accountId,
      crypto.randomUUID(),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, error: CITY_LEDGER_STATEMENT_NOT_FOUND });
  });
});
