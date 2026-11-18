import { DurableObject } from 'cloudflare:workers';
import {
  FEATURE_KEYS,
  LIMIT_EXCEEDED,
  type EntitlementSnapshot,
  type FeatureKey,
  type FeatureValue,
} from '@hospai/contracts';
import { ORG_ENTITLEMENT_MIGRATIONS, migrateSql } from '@hospai/do-runtime';
import { parseFeatureValue } from '@hospai/entitlement-client';
import type { PmsEnv } from './env.js';

type PlanFeatureRow = {
  feature_key: string;
  value: string;
  type: string;
};

type AddonRow = {
  feature_key: string;
  kind: string;
  amount: number | null;
  quantity: number;
  type: string;
};

const FEATURE_KEY_SET: ReadonlySet<string> = new Set(FEATURE_KEYS);
const UNLIMITED_LIMIT = Number.MAX_SAFE_INTEGER;
const PROPERTY_SLOT_KEY = 'pms.properties.limit';

function isFeatureKey(key: string): key is FeatureKey {
  return FEATURE_KEY_SET.has(key);
}

function limitFromParsed(val: FeatureValue): number {
  if (val === 'unlimited') return UNLIMITED_LIMIT;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export class OrgEntitlementDO extends DurableObject<PmsEnv> {
  private schemaVersionRpcFailureForTest = false;

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    // DO constructor: blockConcurrencyWhile bootstraps schema before first request.
    void ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...ORG_ENTITLEMENT_MIGRATIONS]);
    });
  }

  async getSchemaVersion(): Promise<number> {
    if (this.schemaVersionRpcFailureForTest) {
      throw new Error('schema_version_rpc_failed');
    }
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async purgeStorageForTenant(): Promise<{ ok: true; deletedApprox: number }> {
    const deletedApprox = await this.countNonBookkeepingRows();
    await this.ctx.storage.deleteAll();
    return { ok: true, deletedApprox };
  }

  async countNonBookkeepingRows(): Promise<number> {
    const schemaPresent =
      (
        this.ctx.storage.sql
          .exec(`SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name = 'schema_version'`)
          .toArray() as Array<{ one: number }>
      ).length > 0;
    if (!schemaPresent) return 0;

    const tables = this.ctx.storage.sql
      .exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .toArray() as Array<{ name: string }>;
    const allow = new Set(['schema_version', '__cf_kv']);
    let total = 0;
    for (const { name } of tables) {
      if (allow.has(name)) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`unexpected_table_name:${name}`);
      }
      const rows = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${name}`).toArray() as Array<{
        n: number;
      }>;
      total += Number(rows[0]?.n ?? 0);
    }
    return total;
  }

  /** Test helper (unsafe-local only): force `getSchemaVersion` to throw. */
  async setSchemaVersionRpcFailureForTest(fail: boolean): Promise<void> {
    if (this.env.HOSPAI_UNSAFE_LOCAL !== '1') {
      throw new Error('setSchemaVersionRpcFailureForTest requires HOSPAI_UNSAFE_LOCAL=1 (local only)');
    }
    this.schemaVersionRpcFailureForTest = fail;
  }

  async resolveEntitlements(orgId: string): Promise<EntitlementSnapshot> {
    const sub = await this.env.PLATFORM_DB.prepare(
      `SELECT plan_code, entitlement_version, status FROM subscription WHERE org_id = ?`,
    )
      .bind(orgId)
      .first<{ plan_code: string; entitlement_version: number; status: string }>();

    if (!sub || sub.status !== 'active') {
      return {
        orgId,
        version: 0,
        features: {},
        limits: {},
        computedAt: new Date().toISOString(),
      };
    }

    const { results } = await this.env.PLATFORM_DB.prepare(
      `SELECT pf.feature_key, pf.value, f.type
       FROM plan_feature pf
       JOIN feature f ON f.key = pf.feature_key
       WHERE pf.plan_code = ?`,
    )
      .bind(sub.plan_code)
      .all<PlanFeatureRow>();

    const features: Partial<Record<FeatureKey, FeatureValue>> = {};
    const limits: EntitlementSnapshot['limits'] = {};
    const period = currentPeriod();

    for (const row of results ?? []) {
      if (!isFeatureKey(row.feature_key)) continue;
      const key = row.feature_key;
      const val = parseFeatureValue(row.type, row.value);
      features[key] = val;
      if (row.type === 'LIMIT') {
        limits[key] = {
          limit: limitFromParsed(val),
          used: this.meterUsed(key, period),
          behavior: 'hard',
        };
      }
    }

    const { results: addonRows } = await this.env.PLATFORM_DB.prepare(
      `SELECT a.feature_key AS feature_key, a.kind AS kind, a.amount AS amount,
              sa.quantity AS quantity, f.type AS type
       FROM subscription_addon sa
       JOIN addon a ON a.code = sa.addon_code
       JOIN feature f ON f.key = a.feature_key
       WHERE sa.org_id = ?`,
    )
      .bind(orgId)
      .all<AddonRow>();

    for (const row of addonRows ?? []) {
      if (!isFeatureKey(row.feature_key)) continue;
      const key = row.feature_key;
      if (row.kind === 'grant') {
        features[key] = true;
        continue;
      }
      if (row.kind === 'increment') {
        const current = features[key];
        const currentLimit = limits[key]?.limit;
        if (current === 'unlimited' || currentLimit === UNLIMITED_LIMIT) continue;
        const base = typeof current === 'number' ? current : 0;
        const next = base + Number(row.amount ?? 0) * Number(row.quantity);
        features[key] = next;
        limits[key] = {
          limit: next,
          used: limits[key]?.used ?? this.meterUsed(key, period),
          behavior: 'hard',
        };
        continue;
      }
      if (row.kind === 'metered') {
        features[key] = 'unlimited';
        limits[key] = {
          limit: UNLIMITED_LIMIT,
          used: this.meterUsed(key, period),
          behavior: 'soft',
        };
      }
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES ('last_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(sub.entitlement_version),
    );

    return {
      orgId,
      version: sub.entitlement_version,
      features,
      limits,
      computedAt: new Date().toISOString(),
    };
  }

  async checkHardLimit(
    orgId: string,
    meterKey: string,
    delta: number,
  ): Promise<{ ok: true; used: number } | { ok: false; error: typeof LIMIT_EXCEEDED }> {
    const snap = await this.resolveEntitlements(orgId);
    const meter = snap.limits[meterKey];
    if (!meter) return { ok: false, error: LIMIT_EXCEEDED };

    const period = currentPeriod();
    try {
      let used = 0;
      this.ctx.storage.transactionSync(() => {
        const rows = this.ctx.storage.sql
          .exec(`SELECT value FROM meter_counter WHERE meter_key = ? AND period = ?`, meterKey, period)
          .toArray() as Array<{ value: number }>;
        used = Number(rows[0]?.value ?? 0);
        const next = used + delta;
        if (next > meter.limit) {
          throw new LimitExceededError();
        }
        if (rows.length === 0) {
          this.ctx.storage.sql.exec(
            `INSERT INTO meter_counter (meter_key, period, value) VALUES (?, ?, ?)`,
            meterKey,
            period,
            next,
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE meter_counter SET value = ? WHERE meter_key = ? AND period = ?`,
            next,
            meterKey,
            period,
          );
        }
        used = next;
      });
      return { ok: true, used };
    } catch (e) {
      if (e instanceof LimitExceededError) return { ok: false, error: LIMIT_EXCEEDED };
      throw e;
    }
  }

  /**
   * Hard property ceiling. Reads the limit from a fresh D1 resolve (not KV),
   * then checks and increments the standing counter in one transaction.
   * The counter is initialised from the org's D1 property count on first use.
   */
  async reservePropertySlot(
    orgId: string,
  ): Promise<{ ok: true } | { ok: false; error: typeof LIMIT_EXCEEDED; featureKey: 'pms.properties.limit' }> {
    const snap = await this.resolveEntitlements(orgId);
    const limit = snap.limits[PROPERTY_SLOT_KEY]?.limit ?? 0;
    const propertyCount = await this.countOrgProperties(orgId);
    try {
      this.ctx.storage.transactionSync(() => {
        const rows = this.ctx.storage.sql
          .exec(`SELECT value FROM standing_counter WHERE counter_key = ?`, PROPERTY_SLOT_KEY)
          .toArray() as Array<{ value: number }>;
        const current = rows.length === 0 ? propertyCount : Number(rows[0]?.value ?? 0);
        if (current >= limit) throw new LimitExceededError();
        const next = current + 1;
        if (rows.length === 0) {
          this.ctx.storage.sql.exec(
            `INSERT INTO standing_counter (counter_key, value) VALUES (?, ?)`,
            PROPERTY_SLOT_KEY,
            next,
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE standing_counter SET value = ? WHERE counter_key = ?`,
            next,
            PROPERTY_SLOT_KEY,
          );
        }
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof LimitExceededError) {
        return { ok: false, error: LIMIT_EXCEEDED, featureKey: 'pms.properties.limit' };
      }
      throw e;
    }
  }

  /** Undo a reservation when the registry insert that followed it fails. */
  async releasePropertySlot(_orgId: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE standing_counter SET value = value - 1 WHERE counter_key = ? AND value > 0`,
        PROPERTY_SLOT_KEY,
      );
    });
  }

  private meterUsed(meterKey: string, period: string): number {
    const usedRows = this.ctx.storage.sql
      .exec(`SELECT value FROM meter_counter WHERE meter_key = ? AND period = ?`, meterKey, period)
      .toArray() as Array<{ value: number }>;
    return Number(usedRows[0]?.value ?? 0);
  }

  private async countOrgProperties(orgId: string): Promise<number> {
    const row = await this.env.PLATFORM_DB.prepare(`SELECT COUNT(*) AS n FROM property WHERE org_id = ?`)
      .bind(orgId)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
}

class LimitExceededError extends Error {
  constructor() {
    super('Limit exceeded');
    this.name = 'LimitExceededError';
  }
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
