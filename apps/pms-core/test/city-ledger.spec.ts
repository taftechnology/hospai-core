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
import type { PropertyDO } from '../src/property-do';
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
    if (!first.ok) return;
    expect(first.r2Key).toContain(`city-ledger-statements/${propertyId}/${created.accountId}/`);
    expect(first.sha256).toBeTruthy();
    expect(first.snapshot.totals.openMinor).toBe(4_000);
    expect(Array.isArray(first.snapshot.entries)).toBe(true);

    const obj = await env.EVENT_LOG_R2.get(first.r2Key);
    expect(obj).not.toBeNull();
    const body = new Uint8Array(await obj!.arrayBuffer());
    expect(await sha256HexFromBody(body)).toBe(first.sha256);

    const replay = await stub.tryGenerateCityLedgerStatement(TEST_OWNER_ACTOR, genFp, idem);
    expect(replay).toMatchObject({
      ok: true,
      statementId: first.statementId,
      r2Key: first.r2Key,
      sha256: first.sha256,
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
    if (!generated.ok) return;

    const got = await stub.readCityLedgerStatement({
      accountId: created.accountId,
      statementId: generated.statementId,
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.statementId).toBe(generated.statementId);
    expect(got.snapshot.totals.openMinor).toBeDefined();

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
