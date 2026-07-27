import { DurableObject } from 'cloudflare:workers';
import type { Jurisdiction, MemberRole } from '@hospai/contracts';
import { ORG_MIGRATIONS, migrateSql } from '@hospai/do-runtime';
import type { PmsEnv } from './env.js';

export class OrgDO extends DurableObject<PmsEnv> {
  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...ORG_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
    });
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async ensureMember(userId: string, role: MemberRole = 'owner'): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO member (user_id, role, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      userId,
      role,
      Date.now(),
    );
  }

  async upsertPropertyRef(input: {
    propertyId: string;
    name: string;
    jurisdiction: Jurisdiction | null;
    timeZone: string;
    status?: string;
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_ref (property_id, name, jurisdiction, time_zone, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(property_id) DO UPDATE SET
         name = excluded.name,
         jurisdiction = excluded.jurisdiction,
         time_zone = excluded.time_zone,
         status = excluded.status`,
      input.propertyId,
      input.name,
      input.jurisdiction,
      input.timeZone,
      input.status ?? 'active',
    );
  }

  async listPropertyRefs(): Promise<
    Array<{
      propertyId: string;
      name: string;
      jurisdiction: Jurisdiction | null;
      timeZone: string;
      status: string;
    }>
  > {
    const rows = this.ctx.storage.sql
      .exec(`SELECT property_id, name, jurisdiction, time_zone, status FROM property_ref ORDER BY property_id`)
      .toArray() as Array<{
      property_id: string;
      name: string;
      jurisdiction: string | null;
      time_zone: string;
      status: string;
    }>;
    return rows.map((r) => ({
      propertyId: r.property_id,
      name: r.name,
      jurisdiction: r.jurisdiction as Jurisdiction | null,
      timeZone: r.time_zone,
      status: r.status,
    }));
  }

  async listMembers(): Promise<Array<{ userId: string; role: MemberRole }>> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT user_id, role FROM member ORDER BY user_id`)
      .toArray() as Array<{ user_id: string; role: string }>;
    return rows.map((r) => ({ userId: r.user_id, role: r.role as MemberRole }));
  }
}
