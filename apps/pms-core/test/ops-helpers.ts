/** Shared fixtures for the R7.1 operations platform specs. */
import { env } from 'cloudflare:test';
import { PLATFORM_OPERATOR_STATEMENTS } from '@hospai/do-runtime';
import type { OpsRole } from '@hospai/contracts';
import type { PmsEnv } from '../src/env.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

/**
 * Empty the operator tables. The no-delete triggers exist to stop the product doing this, so a test
 * that needs an empty registry (bootstrap) drops them, clears the rows and puts them back.
 */
export async function resetOperatorRegistry(): Promise<void> {
  resetPlatformSchemaGate();
  await ensurePlatformSchema(env.PLATFORM_DB);
  await env.PLATFORM_DB.prepare(`DROP TRIGGER IF EXISTS operator_action_no_delete`).run();
  await env.PLATFORM_DB.prepare(`DROP TRIGGER IF EXISTS operator_no_delete`).run();
  await env.PLATFORM_DB.prepare(`DELETE FROM ops_copy_run`).run();
  await env.PLATFORM_DB.prepare(`DELETE FROM operator_action`).run();
  await env.PLATFORM_DB.prepare(`DELETE FROM operator`).run();
  for (const stmt of PLATFORM_OPERATOR_STATEMENTS) await env.PLATFORM_DB.prepare(stmt).run();
}

export async function seedOperator(
  role: OpsRole,
  opts?: { email?: string; clerkUserId?: string | null; status?: 'active' | 'disabled'; displayName?: string },
): Promise<{ operatorId: string; email: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const operatorId = `op_t_${crypto.randomUUID()}`;
  const email = opts?.email ?? `${operatorId}@hospai.test`;
  await env.PLATFORM_DB.prepare(
    `INSERT INTO operator (operator_id, email, display_name, role, status, clerk_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      operatorId,
      email,
      opts?.displayName ?? `HospAI support ${operatorId.slice(-4)}`,
      role,
      opts?.status ?? 'active',
      opts?.clerkUserId ?? null,
      Date.now(),
    )
    .run();
  return { operatorId, email };
}

export async function actionRows(where: string, ...binds: unknown[]) {
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT * FROM operator_action WHERE ${where} ORDER BY created_at, action_id`,
  )
    .bind(...binds)
    .all<Record<string, unknown>>();
  return results ?? [];
}

/** `env` with some bindings replaced (a Proxy: the real bindings are not enumerable). */
export function withEnv(overrides: Partial<Record<keyof PmsEnv, unknown>>): PmsEnv {
  return new Proxy(env as PmsEnv, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return (overrides as Record<string, unknown>)[prop];
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** A D1 whose `batch` also runs a statement that always aborts, so the whole batch rolls back. */
export function failingBatchDb(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) =>
          target.batch([
            ...stmts,
            // org_status_insert aborts any org inserted with a non-active status.
            target
              .prepare(`INSERT INTO org (org_id, name, status, created_at) VALUES (?, 'x', 'closing', 0)`)
              .bind(`org_force_fail_${crypto.randomUUID()}`),
          ]);
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export const uid = (prefix: string): string => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
