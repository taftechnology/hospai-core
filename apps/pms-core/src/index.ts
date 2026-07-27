import { DurableObject } from 'cloudflare:workers';
import { domainConfigKeys, getConfigEntry } from '@hospai/contracts';
import { PROPERTY_MIGRATIONS, freeAvailability, migrateSql } from '@hospai/do-runtime';
import { UndeclaredConfigError, validateConfigWrite } from '@hospai/kernel';

export type Env = {
  PROPERTY_DO: DurableObjectNamespace<PropertyDO>;
};

export class PropertyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...PROPERTY_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
    });
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async putDomainConfig(key: string, value: unknown): Promise<{ key: string; version: number }> {
    const result = await this.tryPutDomainConfig(key, value);
    if (!result.ok) throw new Error(result.error);
    return { key: result.key, version: result.version };
  }

  async tryPutDomainConfig(
    key: string,
    value: unknown,
  ): Promise<{ ok: true; key: string; version: number } | { ok: false; error: string }> {
    const entry = getConfigEntry(key);
    if (!entry) return { ok: false, error: `undeclared:${key}` };
    if (entry.class !== 'DOMAIN') {
      return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
    }
    try {
      const parsed = validateConfigWrite(key, value);
      const existing = this.ctx.storage.sql
        .exec(`SELECT version FROM property_config WHERE key = ?`, key)
        .toArray() as Array<{ version: number }>;
      const version = (existing[0]?.version ?? 0) + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO property_config (key, value_json, version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at`,
        key,
        JSON.stringify(parsed),
        version,
        Date.now(),
      );
      return { ok: true, key, version };
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
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO availability_day
        (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      row.roomTypeId,
      row.stayDate,
      row.physical,
      row.blocked ?? 0,
      row.held ?? 0,
      row.sold ?? 0,
      row.oversell ?? 0,
    );
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
    free: number;
  } | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, physical, blocked, held, sold, oversell
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
    }>;
    const row = rows[0];
    if (!row) return null;
    return { ...row, free: freeAvailability(row) };
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
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      this.ctx.storage.sql.exec(
        `INSERT INTO folio_line (
           folio_line_id, folio_window_id, reservation_id, charge_code,
           amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.folioLineId,
        input.folioWindowId,
        input.reservationId,
        input.chargeCode,
        input.amountMinor,
        input.txnCurrency,
        input.ledgerAmountMinor,
        input.fxRate,
        Date.now(),
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
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // Tenant resolution belongs in edge + @hospai/tenant-router — not here.
    return new Response('hospai-pms-core', { status: 200 });
  },
};
