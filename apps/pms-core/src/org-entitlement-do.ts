import { DurableObject } from 'cloudflare:workers';
import type { EntitlementSnapshot, FeatureKey, FeatureValue } from '@hospai/contracts';
import { ORG_ENTITLEMENT_MIGRATIONS, migrateSql } from '@hospai/do-runtime';
import { parseFeatureValue } from '@hospai/entitlement-client';
import type { PmsEnv } from './env.js';

type PlanFeatureRow = {
  feature_key: string;
  value: string;
  type: string;
};

export class OrgEntitlementDO extends DurableObject<PmsEnv> {
  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...ORG_ENTITLEMENT_MIGRATIONS]);
    });
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
  ): Promise<{ ok: true; used: number } | { ok: false; error: 'limit_exceeded' }> {
    const snap = await this.resolveEntitlements(orgId);
    const meter = snap.limits[meterKey];
    if (!meter) return { ok: false, error: 'limit_exceeded' };

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
      if (e instanceof LimitExceededError) return { ok: false, error: 'limit_exceeded' };
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
