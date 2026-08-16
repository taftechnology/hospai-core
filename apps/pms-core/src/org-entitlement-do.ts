import { DurableObject } from 'cloudflare:workers';
import {
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

export class OrgEntitlementDO extends DurableObject<PmsEnv> {
  private schemaVersionRpcFailureForTest = false;

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
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
      const val = parseFeatureValue(row.type, row.value);
      if (row.feature_key === 'pms.core' || row.feature_key === 'pms.units.limit') {
        features[row.feature_key] = val as FeatureValue;
      }
      if (row.type === 'LIMIT') {
        const usedRows = this.ctx.storage.sql
          .exec(`SELECT value FROM meter_counter WHERE meter_key = ? AND period = ?`, row.feature_key, period)
          .toArray() as Array<{ value: number }>;
        const used = Number(usedRows[0]?.value ?? 0);
        limits[row.feature_key] = {
          limit: typeof val === 'number' ? val : Number(val),
          used,
          behavior: 'hard',
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
