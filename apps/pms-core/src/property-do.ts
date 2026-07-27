import { DurableObject } from 'cloudflare:workers';
import { domainConfigKeys, getConfigEntry } from '@hospai/contracts';
import { PROPERTY_MIGRATIONS, freeAvailability, migrateSql } from '@hospai/do-runtime';
import { UndeclaredConfigError, validateConfigWrite } from '@hospai/kernel';
import { assertJurisdictionMatch, type Jurisdiction } from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';

export class PropertyDO extends DurableObject<PmsEnv> {
  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...PROPERTY_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
      const rows = ctx.storage.sql
        .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
        .toArray() as Array<{ value_json: string }>;
      if (rows[0]) {
        const expected = JSON.parse(rows[0].value_json) as Jurisdiction | null;
        const actual = (ctx.id as { jurisdiction?: string | null }).jurisdiction ?? null;
        // Local workerd has no DO jurisdiction on ids — skip mismatch when simulating.
        if (!(env.HOSPAI_JURISDICTION_MODE === 'simulate' && expected !== null && actual === null)) {
          assertJurisdictionMatch(actual, expected);
        }
      }
    });
  }

  async setRecordedJurisdiction(jurisdiction: Jurisdiction | null): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_config (key, value_json, version, updated_at)
       VALUES ('__meta.jurisdiction', ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      JSON.stringify(jurisdiction),
      Date.now(),
    );
  }

  async getRecordedJurisdiction(): Promise<Jurisdiction | null | undefined> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, '__meta.jurisdiction')
      .toArray() as Array<{ value_json: string }>;
    if (!rows[0]) return undefined;
    return JSON.parse(rows[0].value_json) as Jurisdiction | null;
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async putDomainConfig(
    key: string,
    value: unknown,
    meta: { actor: string; reason: string; effectiveFrom?: string } = {
      actor: 'system',
      reason: 'unspecified',
    },
  ): Promise<{ key: string; version: number }> {
    const result = await this.tryPutDomainConfig(key, value, meta);
    if (!result.ok) throw new Error(result.error);
    return { key: result.key, version: result.version };
  }

  async tryPutDomainConfig(
    key: string,
    value: unknown,
    meta: { actor: string; reason: string; effectiveFrom?: string } = {
      actor: 'system',
      reason: 'unspecified',
    },
  ): Promise<
    | { ok: true; key: string; version: number; events: string[] }
    | { ok: false; error: string }
  > {
    const entry = getConfigEntry(key);
    if (!entry) return { ok: false, error: `undeclared:${key}` };
    if (entry.class !== 'DOMAIN') {
      return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
    }
    try {
      const parsed = validateConfigWrite(key, value);
      const existing = this.ctx.storage.sql
        .exec(`SELECT version, value_json FROM property_config WHERE key = ?`, key)
        .toArray() as Array<{ version: number; value_json: string }>;
      const previous = existing[0]?.value_json ?? null;
      const version = (existing[0]?.version ?? 0) + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO property_config (key, value_json, version, effective_from, updated_at, updated_by, reason, previous_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           version = excluded.version,
           effective_from = excluded.effective_from,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           reason = excluded.reason,
           previous_json = excluded.previous_json`,
        key,
        JSON.stringify(parsed),
        version,
        meta.effectiveFrom ?? null,
        Date.now(),
        meta.actor,
        meta.reason,
        previous,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO property_config_audit (key, actor, reason, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        key,
        meta.actor,
        meta.reason,
        previous,
        JSON.stringify(parsed),
        Date.now(),
      );
      const eventId = crypto.randomUUID();
      this.ctx.storage.sql.exec(
        `INSERT INTO outbox (event_id, event_type, payload, acked, created_at)
         VALUES (?, 'config.changed', ?, 0, ?)`,
        eventId,
        JSON.stringify({
          key,
          version,
          consumers: entry.consumers,
          actor: meta.actor,
        }),
        Date.now(),
      );
      return { ok: true, key, version, events: ['config.changed'] };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async readConfig(key: string): Promise<unknown> {
    const entry = getConfigEntry(key);
    if (!entry) throw new UndeclaredConfigError(key);
    const rows = this.ctx.storage.sql
      .exec(`SELECT value_json FROM property_config WHERE key = ?`, key)
      .toArray() as Array<{ value_json: string }>;
    if (rows.length === 0) return entry.default;
    return JSON.parse(rows[0]!.value_json);
  }

  async seedAvailabilityDay(row: {
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked?: number;
    held?: number;
    sold?: number;
    oversell?: number;
  }): Promise<number> {
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT version FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        row.roomTypeId,
        row.stayDate,
      )
      .toArray() as Array<{ version: number }>;
    const version = (existing[0]?.version ?? 0) + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO availability_day
        (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_type_id, stay_date) DO UPDATE SET
         physical = excluded.physical,
         blocked = excluded.blocked,
         held = excluded.held,
         sold = excluded.sold,
         oversell = excluded.oversell,
         version = excluded.version`,
      row.roomTypeId,
      row.stayDate,
      row.physical,
      row.blocked ?? 0,
      row.held ?? 0,
      row.sold ?? 0,
      row.oversell ?? 0,
      version,
    );
    return version;
  }

  async readAvailabilityDay(
    roomTypeId: string,
    stayDate: string,
  ): Promise<{
    room_type_id: string;
    stay_date: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    version: number;
    free: number;
  } | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, physical, blocked, held, sold, oversell, version
         FROM availability_day WHERE room_type_id = ? AND stay_date = ?`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
      version: number;
    }>;
    const row = rows[0];
    if (!row) return null;
    return { ...row, free: freeAvailability(row) };
  }

  async upsertRestrictionDay(input: {
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    minLos?: number | null;
  }): Promise<void> {
    const ratePlanId = input.ratePlanId ?? '*';
    this.ctx.storage.sql.exec(
      `INSERT INTO restriction_day (room_type_id, rate_plan_id, stay_date, min_los, version)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
         min_los = excluded.min_los,
         version = restriction_day.version + 1`,
      input.roomTypeId,
      ratePlanId,
      input.stayDate,
      input.minLos ?? null,
    );
  }

  async countRestrictionDays(roomTypeId: string, stayDate: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS c FROM restriction_day WHERE room_type_id = ? AND stay_date = ? AND rate_plan_id = '*'`,
        roomTypeId,
        stayDate,
      )
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async createFolioWindow(input: {
    folioWindowId: string;
    reservationId: string;
    kind: 'GUEST' | 'COMPANY' | 'MASTER';
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
       VALUES (?, ?, ?, 'OPEN')`,
      input.folioWindowId,
      input.reservationId,
      input.kind,
    );
  }

  async addFolioLine(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    amountMinor: number;
    txnCurrency: string;
    ledgerAmountMinor: number;
    fxRate: string;
    fxRateAt?: number;
    source?: string;
    businessDate?: string;
  }): Promise<void> {
    const result = await this.tryAddFolioLine(input);
    if (!result.ok) throw new Error(result.error);
  }

  async tryAddFolioLine(input: {
    folioLineId: string;
    folioWindowId: string;
    reservationId: string;
    chargeCode: string;
    amountMinor: number;
    txnCurrency: string;
    ledgerAmountMinor: number;
    fxRate: string;
    fxRateAt?: number;
    source?: string;
    businessDate?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO folio_line (
           folio_line_id, folio_window_id, reservation_id, charge_code,
           amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
           source, business_date, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.folioLineId,
        input.folioWindowId,
        input.reservationId,
        input.chargeCode,
        input.amountMinor,
        input.txnCurrency,
        input.ledgerAmountMinor,
        input.fxRate,
        input.fxRateAt ?? Date.now(),
        input.source ?? null,
        input.businessDate ?? null,
        Date.now(),
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listDomainKeys(): Promise<string[]> {
    return domainConfigKeys().map((e) => e.key);
  }

  async outboxUnackedCount(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }
}
