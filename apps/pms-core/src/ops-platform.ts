/**
 * R7.1 HospAI operations platform: the operator registry, the ten `ops.*` writes, the console
 * reads, and the operator log. Called only through `OpsEntrypoint` (a service binding), never from
 * `/v1`. See docs/superpowers/specs/2026-11-22-ops-platform-design.md.
 *
 * Rules every write follows (spec D4 to D9, §15):
 * - The operator is re-read from Platform D1 on every call: unknown or disabled is `not_an_operator`,
 *   a viewer is `forbidden`. The Worker's own role check is for the screens only.
 * - `kill:ops.write` refuses the write (`ops_writes_disabled`) before anything else changes.
 * - A reason of 1 to 500 characters is required.
 * - Idempotency: key `operator:<operatorId>:<clientKey>`, fingerprint `{ commandId, payload }`, the
 *   same payload that is executed. Stored on the `operator_action` row, so the change and its record
 *   are one `db.batch()` and a replay is one lookup.
 * - Where a command also calls a Durable Object, the D1 batch runs first and the DO calls are
 *   idempotent, and they run again on a replay.
 * - No method takes SQL or a table name (D8).
 */
import {
  ALREADY_MEMBER,
  IDEM_KEY_REUSED,
  INTERNAL_ERROR,
  INVALID_REQUEST,
  INVALID_STATUS_TRANSITION,
  InvalidTenantIdError,
  JURISDICTION_CONFLICT,
  LAST_OPS_ADMIN,
  LIMIT_EXCEEDED,
  NOT_AN_OPERATOR,
  NOT_FOUND,
  OPERATOR_EXISTS,
  OPS_PAGE_SIZE,
  OPS_REASON_MAX,
  OPS_ROLES,
  OPS_TICKET_REF_MAX,
  OPS_WRITE_KILL_KEY,
  ORG_EXISTS,
  OPS_WRITES_DISABLED,
  PLAN_BELOW_USAGE,
  PROPERTY_EXISTS,
  REASON_REQUIRED,
  TENANT_NOT_ACTIVE,
  USER_NOT_FOUND,
  FORBIDDEN,
  ORG_UNREACHABLE,
  CLERK_UNREACHABLE,
  commandFingerprint,
  isCommandError,
  validateTenantId,
  type CommandError,
  type Jurisdiction,
  type CustomerDetail,
  type CustomerPage,
  type CustomerRow,
  type OperatorActionPage,
  type OperatorActionRow,
  type OperatorView,
  type OpsAddPropertyOk,
  type OpsFailure,
  type OpsPropertyView,
  type OpsWriteOk,
  type PropertyHealthView,
  type ResolveOperatorResult,
  type OpsCommandId,
  type OpsRole,
  type OperatorStatus,
  type PropertyRecord,
} from '@hospai/contracts';
import { logError } from '@hospai/observability';
import { resolveOrgStub } from '@hospai/tenant-router';
import { commandErrorHttpStatus } from './command-error-http.js';
import { lookupUserIdByEmail } from './clerk-lookup.js';
import { isPropertyDoTransportFailure } from './do-transport-failure.js';
import type { PmsEnv } from './env.js';
import type { OrgDO } from './org-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { ensurePlatformSchema, getOrg, getProperty } from './registry.js';
import { indexUserOrg } from './user-org-index.js';

// ---------------------------------------------------------------------------------------------
// Result shapes (plain data: they cross the service-binding RPC boundary)
// ---------------------------------------------------------------------------------------------

export type {
  CustomerDetail,
  CustomerPage,
  CustomerRow,
  OperatorActionPage,
  OperatorActionRow,
  OperatorView,
  OpsAddPropertyOk,
  OpsFailure,
  OpsPropertyView,
  OpsWriteOk,
  PropertyHealthView,
  ResolveOperatorResult,
} from '@hospai/contracts';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function opsFail(error: string, detail?: string, extra?: { featureKey?: string }): OpsFailure {
  const status = isCommandError(error) ? commandErrorHttpStatus(error as CommandError) : 400;
  return { ok: false, error, status, ...(detail ? { detail } : {}), ...(extra ?? {}) };
}

export type OperatorRow = {
  operator_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  clerk_user_id: string | null;
  created_at: number;
};

function toOperatorView(row: OperatorRow): OperatorView {
  return {
    operatorId: row.operator_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as OpsRole,
    status: row.status as OperatorStatus,
  };
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function cleanText(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text.length >= min && text.length <= max ? text : null;
}

export function newActionId(): string {
  return `opa_${crypto.randomUUID()}`;
}

export function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pageOffset(page: unknown): { page: number; offset: number } | null {
  if (page === undefined || page === null) return { page: 1, offset: 0 };
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000) return null;
  return { page, offset: (page - 1) * OPS_PAGE_SIZE };
}

async function loadOperator(env: PmsEnv, operatorId: unknown): Promise<OperatorRow | null> {
  if (typeof operatorId !== 'string' || operatorId.length === 0) return null;
  await ensurePlatformSchema(env.PLATFORM_DB);
  return env.PLATFORM_DB.prepare(`SELECT * FROM operator WHERE operator_id = ?`)
    .bind(operatorId)
    .first<OperatorRow>();
}

/** Re-checks the operator against D1: `not_an_operator` if unknown or disabled, `forbidden` for a viewer on a write. */
export async function authorize(
  env: PmsEnv,
  operatorId: unknown,
  need: 'read' | 'write' | 'admin_read',
): Promise<OperatorRow | OpsFailure> {
  const row = await loadOperator(env, operatorId);
  if (!row || row.status !== 'active') return opsFail(NOT_AN_OPERATOR);
  if ((need === 'write' || need === 'admin_read') && row.role !== 'ops_admin') return opsFail(FORBIDDEN);
  return row;
}

async function writesKilled(env: PmsEnv): Promise<boolean> {
  // Uncached: operator writes are rare, and the key exists for a suspected credential compromise.
  const v = await env.ENTITLEMENT_KV.get(OPS_WRITE_KILL_KEY);
  return v !== null && v !== '';
}

// ---------------------------------------------------------------------------------------------
// Write core
// ---------------------------------------------------------------------------------------------

export type WriteInput = {
  operatorId: string;
  /** Client-chosen idempotency token: the same token and payload twice is one change. */
  clientKey: string;
  reason: string;
  ticketRef?: string | null;
};

export type Prepared = {
  operator: OperatorRow;
  reason: string;
  ticketRef: string | null;
  idempotencyKey: string;
  fingerprint: string;
};

/**
 * Operator, kill-switch, reason and idempotency header checks shared by all ten writes.
 * `payload` is the whole command payload (including reason and ticketRef): it is hashed and it is
 * what the command then executes.
 */
export async function prepareWrite(
  env: PmsEnv,
  commandId: OpsCommandId,
  input: WriteInput,
  payload: Record<string, unknown>,
): Promise<Prepared | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'write');
  if ('ok' in operator) return operator;
  if (await writesKilled(env)) return opsFail(OPS_WRITES_DISABLED);
  const reason = cleanText(input.reason, 1, OPS_REASON_MAX);
  if (reason === null) return opsFail(REASON_REQUIRED);
  let ticketRef: string | null = null;
  if (input.ticketRef !== undefined && input.ticketRef !== null && input.ticketRef !== '') {
    ticketRef = cleanText(input.ticketRef, 1, OPS_TICKET_REF_MAX);
    if (ticketRef === null) return opsFail(INVALID_REQUEST, 'ticket_ref');
  }
  const clientKey = cleanText(input.clientKey, 1, 128);
  if (clientKey === null) return opsFail(INVALID_REQUEST, 'client_key');
  const fingerprint = await commandFingerprint(commandId, { ...payload, reason, ticketRef });
  return {
    operator,
    reason,
    ticketRef,
    idempotencyKey: `operator:${operator.operator_id}:${clientKey}`,
    fingerprint,
  };
}

export type PriorAction = { action_id: string; request_fingerprint: string | null; after_json: string | null };

export async function findPrior(env: PmsEnv, p: Prepared): Promise<PriorAction | null> {
  return env.PLATFORM_DB.prepare(
    `SELECT action_id, request_fingerprint, after_json FROM operator_action WHERE idempotency_key = ?`,
  )
    .bind(p.idempotencyKey)
    .first<PriorAction>();
}

export type ActionSpec = {
  commandId: OpsCommandId | 'operator.link' | 'operator.bootstrap';
  orgId: string | null;
  propertyId?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * The `operator_action` insert. With `guarded`, the row is written only if the statement just before
 * it in the batch changed a row (SQLite `changes()`), so a refused UPDATE leaves no record either.
 */
export function actionStatement(
  env: PmsEnv,
  actionId: string,
  p: Prepared,
  spec: ActionSpec,
  guarded: boolean,
): D1PreparedStatement {
  const cols = `(action_id, operator_id, command_id, org_id, property_id, reason, ticket_ref,
      before_json, after_json, created_at, idempotency_key, request_fingerprint)`;
  const values = [
    actionId,
    p.operator.operator_id,
    spec.commandId,
    spec.orgId,
    spec.propertyId ?? null,
    p.reason,
    p.ticketRef,
    spec.before === undefined ? null : JSON.stringify(spec.before),
    spec.after === undefined ? null : JSON.stringify(spec.after),
    Date.now(),
    p.idempotencyKey,
    p.fingerprint,
  ];
  const sql = guarded
    ? `INSERT INTO operator_action ${cols} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`
    : `INSERT INTO operator_action ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return env.PLATFORM_DB.prepare(sql).bind(...values);
}

export type BatchOutcome =
  | { kind: 'ok'; changedFirst: number }
  | { kind: 'replayed'; prior: PriorAction }
  | { kind: 'failed'; failure: OpsFailure };

/**
 * Runs `[...change statements, action row]` as one `db.batch()` (one D1 transaction). A unique
 * violation on the idempotency key is a concurrent replay; `onConflict` maps any other constraint
 * failure (existing org, existing email) to its code.
 */
export async function runBatch(
  env: PmsEnv,
  p: Prepared,
  statements: D1PreparedStatement[],
  onConflict?: (message: string) => OpsFailure | null,
): Promise<BatchOutcome> {
  try {
    const results = await env.PLATFORM_DB.batch(statements);
    return { kind: 'ok', changedFirst: Number(results[0]?.meta?.changes ?? 0) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('operator_action.idempotency_key')) {
      const prior = await findPrior(env, p);
      if (prior) return { kind: 'replayed', prior };
    }
    const mapped = onConflict?.(message);
    if (mapped) return { kind: 'failed', failure: mapped };
    throw e;
  }
}

export function replayCheck(p: Prepared, prior: PriorAction): OpsFailure | null {
  return prior.request_fingerprint === p.fingerprint ? null : opsFail(IDEM_KEY_REUSED);
}

export function tenantIdOk(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  try {
    validateTenantId(id);
    return true;
  } catch (e) {
    if (e instanceof InvalidTenantIdError) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Plan / limit arithmetic
// ---------------------------------------------------------------------------------------------

const PROPERTY_LIMIT_KEY = 'pms.properties.limit';

async function planExists(env: PmsEnv, planCode: string): Promise<boolean> {
  const row = await env.PLATFORM_DB.prepare(`SELECT code FROM plan WHERE code = ?`).bind(planCode).first();
  return row !== null;
}

type LimitTables = {
  /** plan code -> base `pms.properties.limit` (`null` = unlimited). */
  plan: Map<string, number | null>;
  /** add-on code -> properties added per unit. */
  addon: Map<string, number>;
};

async function loadLimitTables(env: PmsEnv): Promise<LimitTables> {
  const [plans, addons] = await Promise.all([
    env.PLATFORM_DB.prepare(`SELECT plan_code, value FROM plan_feature WHERE feature_key = ?`)
      .bind(PROPERTY_LIMIT_KEY)
      .all<{ plan_code: string; value: string }>(),
    env.PLATFORM_DB.prepare(`SELECT code, amount FROM addon WHERE feature_key = ? AND kind = 'increment'`)
      .bind(PROPERTY_LIMIT_KEY)
      .all<{ code: string; amount: number | null }>(),
  ]);
  const plan = new Map<string, number | null>();
  for (const r of plans.results ?? []) {
    const n = Number(r.value);
    plan.set(r.plan_code, r.value === 'unlimited' ? null : Number.isFinite(n) ? n : 0);
  }
  const addon = new Map<string, number>();
  for (const r of addons.results ?? []) addon.set(r.code, Number(r.amount ?? 0));
  return { plan, addon };
}

/** The hard property ceiling for a plan plus add-on increments. `null` = unlimited. */
function computeLimit(
  tables: LimitTables,
  planCode: string,
  addons: ReadonlyArray<{ addonCode: string; quantity: number }>,
): number | null {
  const base = tables.plan.get(planCode);
  if (base === null) return null;
  let total = base ?? 0;
  for (const a of addons) total += (tables.addon.get(a.addonCode) ?? 0) * a.quantity;
  return total;
}

async function propertiesLimit(
  env: PmsEnv,
  planCode: string,
  addons: ReadonlyArray<{ addonCode: string; quantity: number }>,
): Promise<number | null> {
  return computeLimit(await loadLimitTables(env), planCode, addons);
}

async function propertiesUsed(env: PmsEnv, orgId: string): Promise<number> {
  const row = await env.PLATFORM_DB.prepare(`SELECT COUNT(*) AS n FROM property WHERE org_id = ?`)
    .bind(orgId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function orgAddons(env: PmsEnv, orgId: string): Promise<Array<{ addonCode: string; quantity: number }>> {
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT addon_code, quantity FROM subscription_addon WHERE org_id = ? ORDER BY addon_code`,
  )
    .bind(orgId)
    .all<{ addon_code: string; quantity: number }>();
  return (results ?? []).map((r) => ({ addonCode: r.addon_code, quantity: r.quantity }));
}

/** An org a customer-facing change may target: `active` or `suspended`. */
async function liveOrg(env: PmsEnv, orgId: unknown): Promise<{ orgId: string; name: string; status: string } | OpsFailure> {
  if (!tenantIdOk(orgId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  const org = await getOrg(env, orgId);
  if (!org) return opsFail(NOT_FOUND);
  if (org.status !== 'active' && org.status !== 'suspended') return opsFail(TENANT_NOT_ACTIVE);
  return org;
}

// ---------------------------------------------------------------------------------------------
// Operators: resolve, link, bootstrap
// ---------------------------------------------------------------------------------------------

function bootstrapEmails(env: PmsEnv): Set<string> {
  return new Set(
    (env.OPS_BOOTSTRAP_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Maps a verified Clerk session to an operator row (spec §15 A5).
 * 1. By `clerk_user_id`.
 * 2. Else, with a **verified** email, link an `active` row with that email and no Clerk id
 *    (`operator.link`). An unverified (null) email never links.
 * 3. Else, while the table is empty and the verified email is listed in `OPS_BOOTSTRAP_EMAILS`,
 *    create the first `ops_admin` (`operator.bootstrap`). Ignored once any row exists.
 * 4. Else `not_an_operator`.
 */
export async function resolveOperator(
  env: PmsEnv,
  input: { clerkUserId: string; verifiedEmail: string | null; displayName?: string | null },
): Promise<ResolveOperatorResult> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const clerkUserId = cleanText(input?.clerkUserId, 1, 200);
  if (clerkUserId === null) return opsFail(NOT_AN_OPERATOR);

  const byClerk = await env.PLATFORM_DB.prepare(`SELECT * FROM operator WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .first<OperatorRow>();
  if (byClerk) {
    return byClerk.status === 'active'
      ? { ok: true, operator: toOperatorView(byClerk), via: 'clerk_user_id' }
      : opsFail(NOT_AN_OPERATOR);
  }

  const email = input.verifiedEmail === null ? null : normalizeEmail(input.verifiedEmail);
  if (email === null) return opsFail(NOT_AN_OPERATOR);

  const byEmail = await env.PLATFORM_DB.prepare(`SELECT * FROM operator WHERE email = ?`)
    .bind(email)
    .first<OperatorRow>();
  if (byEmail) {
    if (byEmail.status !== 'active' || byEmail.clerk_user_id !== null) return opsFail(NOT_AN_OPERATOR);
    try {
      await env.PLATFORM_DB.batch([
        env.PLATFORM_DB.prepare(
          `UPDATE operator SET clerk_user_id = ? WHERE operator_id = ? AND clerk_user_id IS NULL AND status = 'active'`,
        ).bind(clerkUserId, byEmail.operator_id),
        selfActionStatement(env, byEmail.operator_id, 'operator.link', 'Linked to a verified sign-in', {
          operatorId: byEmail.operator_id,
        }, true),
      ]);
    } catch {
      // The Clerk id is already linked to another row.
      return opsFail(NOT_AN_OPERATOR);
    }
    const linked = await loadOperator(env, byEmail.operator_id);
    return linked && linked.clerk_user_id === clerkUserId
      ? { ok: true, operator: toOperatorView(linked), via: 'link' }
      : opsFail(NOT_AN_OPERATOR);
  }

  if (!bootstrapEmails(env).has(email)) return opsFail(NOT_AN_OPERATOR);
  const operatorId = `op_${crypto.randomUUID()}`;
  const displayName = cleanText(input.displayName, 1, 80) ?? email.split('@')[0]!.slice(0, 80);
  try {
    await env.PLATFORM_DB.batch([
      env.PLATFORM_DB.prepare(
        `INSERT INTO operator (operator_id, email, display_name, role, status, clerk_user_id, created_at)
         SELECT ?, ?, ?, 'ops_admin', 'active', ?, ? WHERE NOT EXISTS (SELECT 1 FROM operator)`,
      ).bind(operatorId, email, displayName, clerkUserId, Date.now()),
      selfActionStatement(env, operatorId, 'operator.bootstrap', 'First operator, from OPS_BOOTSTRAP_EMAILS', {
        operatorId,
        role: 'ops_admin',
      }, true),
    ]);
  } catch {
    return opsFail(NOT_AN_OPERATOR);
  }
  const created = await loadOperator(env, operatorId);
  return created ? { ok: true, operator: toOperatorView(created), via: 'bootstrap' } : opsFail(NOT_AN_OPERATOR);
}

/** `operator.link` / `operator.bootstrap` rows: the operator is the actor and the subject. */
function selfActionStatement(
  env: PmsEnv,
  operatorId: string,
  commandId: 'operator.link' | 'operator.bootstrap',
  reason: string,
  after: unknown,
  guarded: boolean,
): D1PreparedStatement {
  const cols = `(action_id, operator_id, command_id, org_id, property_id, reason, ticket_ref,
      before_json, after_json, created_at, idempotency_key, request_fingerprint)`;
  const args = [newActionId(), operatorId, commandId, null, null, reason, null, null, JSON.stringify(after), Date.now(), null, null];
  return env.PLATFORM_DB.prepare(
    guarded
      ? `INSERT INTO operator_action ${cols} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`
      : `INSERT INTO operator_action ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(...args);
}

// ---------------------------------------------------------------------------------------------
// The ten writes
// ---------------------------------------------------------------------------------------------

export async function createOrg(
  env: PmsEnv,
  input: WriteInput & { orgId: string; name: string; planCode: string },
): Promise<OpsWriteOk | OpsFailure> {
  const orgId = input?.orgId;
  const name = cleanText(input?.name, 1, 200);
  const planCode = typeof input?.planCode === 'string' ? input.planCode : '';
  const p = await prepareWrite(env, 'ops.create_org', input, { orgId, name, planCode });
  if ('ok' in p) return p;
  if (!tenantIdOk(orgId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  if (name === null) return opsFail(INVALID_REQUEST, 'name');

  const afterCommit = async (): Promise<void> => {
    const stub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await stub.ensureMetaOrgId(orgId);
  };

  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    if (bad) return bad;
    await afterCommit();
    return { ok: true, actionId: prior.action_id, replayed: true };
  }
  if (!(await planExists(env, planCode))) return opsFail(INVALID_REQUEST, 'unknown_plan');
  // 409 carries no field of the existing org.
  if (await getOrg(env, orgId)) return opsFail(ORG_EXISTS);

  const actionId = newActionId();
  const outcome = await runBatch(
    env,
    p,
    [
      env.PLATFORM_DB.prepare(
        `INSERT INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
      ).bind(orgId, name, Date.now()),
      env.PLATFORM_DB.prepare(
        `INSERT INTO subscription (org_id, plan_code, status, entitlement_version, trial_ends_at, current_period_end)
         VALUES (?, ?, 'active', 1, NULL, NULL)`,
      ).bind(orgId, planCode),
      actionStatement(env, actionId, p, { commandId: 'ops.create_org', orgId, after: { name, planCode } }, false),
    ],
    (m) => (m.includes('org.org_id') ? opsFail(ORG_EXISTS) : null),
  );
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    const bad = replayCheck(p, outcome.prior);
    if (bad) return bad;
    await afterCommit();
    return { ok: true, actionId: outcome.prior.action_id, replayed: true };
  }
  await afterCommit();
  return { ok: true, actionId, replayed: false };
}

export async function addProperty(
  env: PmsEnv,
  input: WriteInput & {
    orgId: string;
    propertyId: string;
    name: string;
    jurisdiction?: Jurisdiction | null;
    timeZone: string;
    currency: string;
  },
): Promise<OpsAddPropertyOk | OpsFailure> {
  const orgId = input?.orgId;
  const propertyId = input?.propertyId;
  const name = cleanText(input?.name, 1, 200);
  const jurisdiction = input?.jurisdiction ?? null;
  const timeZone = cleanText(input?.timeZone, 1, 64);
  const currency = cleanText(input?.currency, 3, 3);
  const p = await prepareWrite(env, 'ops.add_property', input, {
    orgId,
    propertyId,
    name,
    jurisdiction,
    timeZone,
    currency,
  });
  if ('ok' in p) return p;
  if (!tenantIdOk(orgId) || !tenantIdOk(propertyId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  if (name === null) return opsFail(INVALID_REQUEST, 'name');
  if (timeZone === null) return opsFail(INVALID_REQUEST, 'invalid_timezone');
  if (currency === null) return opsFail(INVALID_REQUEST, 'invalid_currency');
  if (jurisdiction !== null && jurisdiction !== 'eu' && jurisdiction !== 'us' && jurisdiction !== 'fedramp') {
    return opsFail(INVALID_REQUEST, 'jurisdiction');
  }

  const org = await getOrg(env, orgId);
  if (!org) return opsFail(NOT_FOUND);

  const provisionInput = {
    orgId,
    propertyId,
    name,
    jurisdiction,
    timeZone,
    currency,
    actor: { kind: 'operator' as const, operatorId: p.operator.operator_id },
  };

  const toView = (property: PropertyRecord): OpsPropertyView => ({
    propertyId: property.propertyId,
    orgId: property.orgId,
    name: property.name,
    jurisdiction: property.jurisdiction,
    timeZone: property.timeZone,
    status: property.status,
    createdAt: property.createdAt,
  });

  const mapFailure = (result: { error: string; featureKey?: string }): OpsFailure => {
    switch (result.error) {
      case 'property_exists':
        return opsFail(PROPERTY_EXISTS);
      case 'jurisdiction_conflict':
        return opsFail(JURISDICTION_CONFLICT);
      case 'tenant_not_active':
        return opsFail(TENANT_NOT_ACTIVE);
      case 'limit_exceeded':
        return opsFail(LIMIT_EXCEEDED, undefined, { featureKey: result.featureKey ?? PROPERTY_LIMIT_KEY });
      case 'invalid_tenant_id':
      case 'invalid_timezone':
      case 'invalid_currency':
        return opsFail(INVALID_REQUEST, result.error);
      default:
        return opsFail(INTERNAL_ERROR);
    }
  };

  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    if (bad) return bad;
    // Replay: re-run the idempotent DO sync, record nothing.
    const again = await provisionProperty(env, provisionInput);
    if (!again.ok) return mapFailure(again);
    return { ok: true, actionId: prior.action_id, replayed: true, property: toView(again.property) };
  }

  const actionId = newActionId();
  let recorded = false;
  try {
    const result = await provisionProperty(env, provisionInput, {
      withRegistryInsert: (created) => {
        recorded = true;
        return [
          actionStatement(
            env,
            actionId,
            p,
            {
              commandId: 'ops.add_property',
              orgId,
              propertyId,
              after: {
                propertyId,
                name: created.name,
                timeZone: created.timeZone,
                jurisdiction: created.jurisdiction,
              },
            },
            false,
          ),
        ];
      },
    });
    if (!result.ok) return mapFailure(result);
    return { ok: true, actionId: recorded ? actionId : null, replayed: false, property: toView(result.property) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('operator_action.idempotency_key')) {
      const raced = await findPrior(env, p);
      if (raced && !replayCheck(p, raced)) {
        const again = await provisionProperty(env, provisionInput);
        if (again.ok) {
          return { ok: true, actionId: raced.action_id, replayed: true, property: toView(again.property) };
        }
      }
    }
    logError({ moduleId: 'pms.core' }, { msg: 'ops.add_property_failed', orgId, propertyId, error: message });
    return opsFail(INTERNAL_ERROR);
  }
}

export async function addOrgOwner(
  env: PmsEnv,
  input: WriteInput & { orgId: string; email: string },
): Promise<OpsWriteOk | OpsFailure> {
  const email = normalizeEmail(input?.email);
  const p = await prepareWrite(env, 'ops.add_org_owner', input, { orgId: input?.orgId, email });
  if ('ok' in p) return p;
  if (email === null) return opsFail(INVALID_REQUEST, 'email');
  const org = await liveOrg(env, input.orgId);
  if ('ok' in org) return org;
  const orgId = org.orgId;

  const grant = async (userId: string): Promise<OpsFailure | null> => {
    try {
      const stub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
      await stub.ensureMetaOrgId(orgId);
      await stub.ensureMember(userId, 'owner');
      await indexUserOrg(env, userId, orgId);
      return null;
    } catch (e) {
      logError({ moduleId: 'pms.core' }, { msg: 'ops.add_org_owner_failed', orgId, error: e instanceof Error ? e.message : String(e) });
      return opsFail(ORG_UNREACHABLE);
    }
  };

  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    if (bad) return bad;
    const userId = (parseJson(prior.after_json) as { userId?: string } | null)?.userId;
    if (userId) {
      const failed = await grant(userId);
      if (failed) return failed;
    }
    return { ok: true, actionId: prior.action_id, replayed: true };
  }

  const found = await lookupUserIdByEmail(env, email);
  if (!found.ok) {
    if (found.error === 'no_such_user') return opsFail(USER_NOT_FOUND);
    if (found.error === 'email_ambiguous') return opsFail(INVALID_REQUEST, 'email_ambiguous');
    return opsFail(CLERK_UNREACHABLE);
  }
  try {
    const stub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    if ((await stub.getMemberRole(found.userId)) !== null) return opsFail(ALREADY_MEMBER);
  } catch {
    return opsFail(ORG_UNREACHABLE);
  }

  const actionId = newActionId();
  const outcome = await runBatch(env, p, [
    // The user id, not the email, goes in the record.
    actionStatement(env, actionId, p, { commandId: 'ops.add_org_owner', orgId, after: { userId: found.userId, role: 'owner' } }, false),
  ]);
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    const bad = replayCheck(p, outcome.prior);
    if (bad) return bad;
  }
  const failed = await grant(found.userId);
  if (failed) return failed;
  return outcome.kind === 'replayed'
    ? { ok: true, actionId: outcome.prior.action_id, replayed: true }
    : { ok: true, actionId, replayed: false };
}

export async function setPlan(
  env: PmsEnv,
  input: WriteInput & { orgId: string; planCode: string },
): Promise<OpsWriteOk | OpsFailure> {
  const planCode = typeof input?.planCode === 'string' ? input.planCode : '';
  const p = await prepareWrite(env, 'ops.set_plan', input, { orgId: input?.orgId, planCode });
  if ('ok' in p) return p;
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  const org = await liveOrg(env, input.orgId);
  if ('ok' in org) return org;
  if (!(await planExists(env, planCode))) return opsFail(INVALID_REQUEST, 'unknown_plan');
  const sub = await env.PLATFORM_DB.prepare(`SELECT plan_code FROM subscription WHERE org_id = ?`)
    .bind(org.orgId)
    .first<{ plan_code: string }>();
  if (!sub) return opsFail(NOT_FOUND);
  if (sub.plan_code === planCode) return opsFail(INVALID_REQUEST, 'plan_unchanged');

  const [used, limit] = await Promise.all([
    propertiesUsed(env, org.orgId),
    orgAddons(env, org.orgId).then((a) => propertiesLimit(env, planCode, a)),
  ]);
  if (limit !== null && used > limit) return opsFail(PLAN_BELOW_USAGE);

  const actionId = newActionId();
  const outcome = await runBatch(env, p, [
    // The trigger demands an entitlement_version bump when the plan changes: exactly one.
    env.PLATFORM_DB.prepare(
      `UPDATE subscription SET plan_code = ?, entitlement_version = entitlement_version + 1
       WHERE org_id = ? AND plan_code = ?`,
    ).bind(planCode, org.orgId, sub.plan_code),
    actionStatement(
      env,
      actionId,
      p,
      { commandId: 'ops.set_plan', orgId: org.orgId, before: { planCode: sub.plan_code }, after: { planCode } },
      true,
    ),
  ]);
  return finishGuarded(p, outcome, actionId);
}

export async function setAddon(
  env: PmsEnv,
  input: WriteInput & { orgId: string; addonCode: string; quantity: number },
): Promise<OpsWriteOk | OpsFailure> {
  const addonCode = typeof input?.addonCode === 'string' ? input.addonCode : '';
  const quantity = input?.quantity;
  const p = await prepareWrite(env, 'ops.set_addon', input, { orgId: input?.orgId, addonCode, quantity });
  if ('ok' in p) return p;
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  const org = await liveOrg(env, input.orgId);
  if ('ok' in org) return org;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000) {
    return opsFail(INVALID_REQUEST, 'quantity');
  }
  const addon = await env.PLATFORM_DB.prepare(`SELECT code, kind, feature_key FROM addon WHERE code = ?`)
    .bind(addonCode)
    .first<{ code: string; kind: string; feature_key: string }>();
  if (!addon) return opsFail(INVALID_REQUEST, 'unknown_addon');
  if (addon.kind !== 'increment' && quantity > 1) return opsFail(INVALID_REQUEST, 'quantity');
  const sub = await env.PLATFORM_DB.prepare(`SELECT plan_code FROM subscription WHERE org_id = ?`)
    .bind(org.orgId)
    .first<{ plan_code: string }>();
  if (!sub) return opsFail(NOT_FOUND);

  const current = await orgAddons(env, org.orgId);
  const existing = current.find((a) => a.addonCode === addonCode)?.quantity ?? 0;
  if (existing === quantity) return opsFail(INVALID_REQUEST, 'addon_unchanged');

  if (addon.feature_key === PROPERTY_LIMIT_KEY) {
    const next = [...current.filter((a) => a.addonCode !== addonCode), { addonCode, quantity }];
    const limit = await propertiesLimit(env, sub.plan_code, next);
    if (limit !== null && (await propertiesUsed(env, org.orgId)) > limit) return opsFail(PLAN_BELOW_USAGE);
  }

  const change =
    quantity === 0
      ? env.PLATFORM_DB.prepare(`DELETE FROM subscription_addon WHERE org_id = ? AND addon_code = ? AND quantity = ?`).bind(
          org.orgId,
          addonCode,
          existing,
        )
      : existing === 0
        ? env.PLATFORM_DB.prepare(
            `INSERT INTO subscription_addon (org_id, addon_code, quantity) VALUES (?, ?, ?)`,
          ).bind(org.orgId, addonCode, quantity)
        : env.PLATFORM_DB.prepare(
            `UPDATE subscription_addon SET quantity = ? WHERE org_id = ? AND addon_code = ? AND quantity = ?`,
          ).bind(quantity, org.orgId, addonCode, existing);

  const actionId = newActionId();
  const outcome = await runBatch(
    env,
    p,
    [
      change,
      actionStatement(
        env,
        actionId,
        p,
        {
          commandId: 'ops.set_addon',
          orgId: org.orgId,
          before: { addonCode, quantity: existing },
          after: { addonCode, quantity },
        },
        true,
      ),
    ],
    (m) => (m.includes('subscription_addon') ? opsFail(INVALID_REQUEST, 'conflict') : null),
  );
  return finishGuarded(p, outcome, actionId);
}

async function setOrgStatus(
  env: PmsEnv,
  commandId: 'ops.suspend_org' | 'ops.reinstate_org',
  from: 'active' | 'suspended',
  to: 'active' | 'suspended',
  input: WriteInput & { orgId: string },
): Promise<OpsWriteOk | OpsFailure> {
  const p = await prepareWrite(env, commandId, input, { orgId: input?.orgId });
  if ('ok' in p) return p;
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  if (!tenantIdOk(input.orgId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  const org = await getOrg(env, input.orgId);
  if (!org) return opsFail(NOT_FOUND);
  if (org.status !== from) return opsFail(INVALID_STATUS_TRANSITION);

  const actionId = newActionId();
  const outcome = await runBatch(env, p, [
    env.PLATFORM_DB.prepare(`UPDATE org SET status = ? WHERE org_id = ? AND status = ?`).bind(to, org.orgId, from),
    actionStatement(env, actionId, p, { commandId, orgId: org.orgId, before: { status: from }, after: { status: to } }, true),
  ]);
  const done = finishGuarded(p, outcome, actionId);
  return !done.ok && done.detail === 'conflict' ? opsFail(INVALID_STATUS_TRANSITION) : done;
}

export function suspendOrg(env: PmsEnv, input: WriteInput & { orgId: string }) {
  return setOrgStatus(env, 'ops.suspend_org', 'active', 'suspended', input);
}

export function reinstateOrg(env: PmsEnv, input: WriteInput & { orgId: string }) {
  return setOrgStatus(env, 'ops.reinstate_org', 'suspended', 'active', input);
}

/** Result of a batch whose first statement is a guarded UPDATE/DELETE: 0 changed rows means refused. */
function finishGuarded(p: Prepared, outcome: BatchOutcome, actionId: string): OpsWriteOk | OpsFailure {
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    return replayCheck(p, outcome.prior) ?? { ok: true, actionId: outcome.prior.action_id, replayed: true };
  }
  if (outcome.changedFirst === 0) return opsFail(INVALID_REQUEST, 'conflict');
  return { ok: true, actionId, replayed: false };
}

export async function addOperator(
  env: PmsEnv,
  input: WriteInput & { email: string; displayName: string; role: OpsRole },
): Promise<(OpsWriteOk & { operatorId?: string }) | OpsFailure> {
  const email = normalizeEmail(input?.email);
  const displayName = cleanText(input?.displayName, 1, 80);
  const role = input?.role;
  const p = await prepareWrite(env, 'ops.add_operator', input, { email, displayName, role });
  if ('ok' in p) return p;
  if (email === null) return opsFail(INVALID_REQUEST, 'email');
  if (displayName === null) return opsFail(INVALID_REQUEST, 'display_name');
  if (!(OPS_ROLES as readonly string[]).includes(role)) return opsFail(INVALID_REQUEST, 'role');

  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  const exists = await env.PLATFORM_DB.prepare(`SELECT 1 AS one FROM operator WHERE email = ?`).bind(email).first();
  if (exists) return opsFail(OPERATOR_EXISTS);

  const operatorId = `op_${crypto.randomUUID()}`;
  const actionId = newActionId();
  const outcome = await runBatch(
    env,
    p,
    [
      env.PLATFORM_DB.prepare(
        `INSERT INTO operator (operator_id, email, display_name, role, status, clerk_user_id, created_at)
         VALUES (?, ?, ?, ?, 'active', NULL, ?)`,
      ).bind(operatorId, email, displayName, role, Date.now()),
      // ids, role and status only: the registry's email never goes in the log.
      actionStatement(
        env,
        actionId,
        p,
        { commandId: 'ops.add_operator', orgId: null, after: { operatorId, role, status: 'active' } },
        false,
      ),
    ],
    (m) => (m.includes('operator.email') ? opsFail(OPERATOR_EXISTS) : null),
  );
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    return replayCheck(p, outcome.prior) ?? { ok: true, actionId: outcome.prior.action_id, replayed: true };
  }
  return { ok: true, actionId, replayed: false, operatorId };
}

async function activeAdminCount(env: PmsEnv): Promise<number> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT COUNT(*) AS n FROM operator WHERE role = 'ops_admin' AND status = 'active'`,
  ).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

const LAST_ADMIN_GUARD = `AND NOT (role = 'ops_admin' AND status = 'active'
  AND (SELECT COUNT(*) FROM operator WHERE role = 'ops_admin' AND status = 'active') <= 1)`;

export async function setOperatorStatus(
  env: PmsEnv,
  input: WriteInput & { targetOperatorId: string; status: OperatorStatus },
): Promise<OpsWriteOk | OpsFailure> {
  const targetOperatorId = input?.targetOperatorId;
  const status = input?.status;
  const p = await prepareWrite(env, 'ops.set_operator_status', input, { targetOperatorId, status });
  if ('ok' in p) return p;
  if (status !== 'active' && status !== 'disabled') return opsFail(INVALID_REQUEST, 'status');
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  const target = await loadOperator(env, targetOperatorId);
  if (!target) return opsFail(NOT_FOUND);
  if (target.status === status) return opsFail(INVALID_REQUEST, 'status_unchanged');
  if (status === 'disabled' && target.role === 'ops_admin' && (await activeAdminCount(env)) <= 1) {
    return opsFail(LAST_OPS_ADMIN);
  }
  const actionId = newActionId();
  const outcome = await runBatch(env, p, [
    env.PLATFORM_DB.prepare(
      status === 'disabled'
        ? `UPDATE operator SET status = 'disabled' WHERE operator_id = ? AND status = 'active' ${LAST_ADMIN_GUARD}`
        : `UPDATE operator SET status = 'active' WHERE operator_id = ? AND status = 'disabled'`,
    ).bind(target.operator_id),
    actionStatement(
      env,
      actionId,
      p,
      {
        commandId: 'ops.set_operator_status',
        orgId: null,
        before: { operatorId: target.operator_id, status: target.status },
        after: { operatorId: target.operator_id, status },
      },
      true,
    ),
  ]);
  const done = finishGuarded(p, outcome, actionId);
  return !done.ok && done.detail === 'conflict' ? opsFail(LAST_OPS_ADMIN) : done;
}

export async function setOperatorRole(
  env: PmsEnv,
  input: WriteInput & { targetOperatorId: string; role: OpsRole },
): Promise<OpsWriteOk | OpsFailure> {
  const targetOperatorId = input?.targetOperatorId;
  const role = input?.role;
  const p = await prepareWrite(env, 'ops.set_operator_role', input, { targetOperatorId, role });
  if ('ok' in p) return p;
  if (!(OPS_ROLES as readonly string[]).includes(role)) return opsFail(INVALID_REQUEST, 'role');
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    return bad ?? { ok: true, actionId: prior.action_id, replayed: true };
  }
  const target = await loadOperator(env, targetOperatorId);
  if (!target) return opsFail(NOT_FOUND);
  if (target.role === role) return opsFail(INVALID_REQUEST, 'role_unchanged');
  if (
    role === 'ops_viewer' &&
    target.role === 'ops_admin' &&
    target.status === 'active' &&
    (await activeAdminCount(env)) <= 1
  ) {
    return opsFail(LAST_OPS_ADMIN);
  }
  const actionId = newActionId();
  const outcome = await runBatch(env, p, [
    env.PLATFORM_DB.prepare(
      role === 'ops_viewer'
        ? `UPDATE operator SET role = 'ops_viewer' WHERE operator_id = ? AND role = 'ops_admin' ${LAST_ADMIN_GUARD}`
        : `UPDATE operator SET role = 'ops_admin' WHERE operator_id = ? AND role = 'ops_viewer'`,
    ).bind(target.operator_id),
    actionStatement(
      env,
      actionId,
      p,
      {
        commandId: 'ops.set_operator_role',
        orgId: null,
        before: { operatorId: target.operator_id, role: target.role },
        after: { operatorId: target.operator_id, role },
      },
      true,
    ),
  ]);
  const done = finishGuarded(p, outcome, actionId);
  return !done.ok && done.detail === 'conflict' ? opsFail(LAST_OPS_ADMIN) : done;
}

// ---------------------------------------------------------------------------------------------
// Reads (any active operator; the operator list is ops_admin only)
// ---------------------------------------------------------------------------------------------

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Customers from the registry only: no Durable Object is called. */
export async function listCustomers(
  env: PmsEnv,
  input: { operatorId: string; query?: string | null; page?: number },
): Promise<CustomerPage | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  const paging = pageOffset(input.page);
  if (!paging) return opsFail(INVALID_REQUEST, 'page');
  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 100) : '';
  const like = query ? `%${escapeLike(query)}%` : null;

  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT o.org_id, o.name, o.status, o.created_at, s.plan_code,
            (SELECT COUNT(*) FROM property p WHERE p.org_id = o.org_id) AS used
     FROM org o LEFT JOIN subscription s ON s.org_id = o.org_id
     WHERE (? IS NULL OR o.name LIKE ? ESCAPE '\\' OR o.org_id LIKE ? ESCAPE '\\')
     ORDER BY o.created_at DESC, o.org_id ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(like, like, like, OPS_PAGE_SIZE + 1, paging.offset)
    .all<{ org_id: string; name: string; status: string; created_at: number; plan_code: string | null; used: number }>();
  const rows = results ?? [];
  const pageRows = rows.slice(0, OPS_PAGE_SIZE);

  const addonByOrg = new Map<string, Array<{ addonCode: string; quantity: number }>>();
  if (pageRows.length > 0) {
    const marks = pageRows.map(() => '?').join(',');
    const addons = await env.PLATFORM_DB.prepare(
      `SELECT org_id, addon_code, quantity FROM subscription_addon WHERE org_id IN (${marks}) ORDER BY addon_code`,
    )
      .bind(...pageRows.map((r) => r.org_id))
      .all<{ org_id: string; addon_code: string; quantity: number }>();
    for (const a of addons.results ?? []) {
      const list = addonByOrg.get(a.org_id) ?? [];
      list.push({ addonCode: a.addon_code, quantity: a.quantity });
      addonByOrg.set(a.org_id, list);
    }
  }

  const tables = await loadLimitTables(env);
  const customers: CustomerRow[] = [];
  for (const r of pageRows) {
    const addons = addonByOrg.get(r.org_id) ?? [];
    customers.push({
      orgId: r.org_id,
      name: r.name,
      status: r.status,
      planCode: r.plan_code,
      addons,
      propertiesUsed: Number(r.used),
      propertiesLimit: r.plan_code ? computeLimit(tables, r.plan_code, addons) : 0,
      createdAt: r.created_at,
    });
  }
  return { ok: true, page: paging.page, hasMore: rows.length > OPS_PAGE_SIZE, customers };
}

async function readActions(
  env: PmsEnv,
  filter: { orgId?: string | null; operatorId?: string | null },
  offset: number,
): Promise<{ rows: OperatorActionRow[]; hasMore: boolean }> {
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT a.action_id, a.operator_id, o.display_name, a.command_id, a.org_id, a.property_id, a.reason,
            a.ticket_ref, a.before_json, a.after_json, a.created_at
     FROM operator_action a JOIN operator o ON o.operator_id = a.operator_id
     WHERE (? IS NULL OR a.org_id = ?) AND (? IS NULL OR a.operator_id = ?)
     ORDER BY a.created_at DESC, a.rowid DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(
      filter.orgId ?? null,
      filter.orgId ?? null,
      filter.operatorId ?? null,
      filter.operatorId ?? null,
      OPS_PAGE_SIZE + 1,
      offset,
    )
    .all<{
      action_id: string;
      operator_id: string;
      display_name: string;
      command_id: string;
      org_id: string | null;
      property_id: string | null;
      reason: string;
      ticket_ref: string | null;
      before_json: string | null;
      after_json: string | null;
      created_at: number;
    }>();
  const all = results ?? [];
  return {
    hasMore: all.length > OPS_PAGE_SIZE,
    rows: all.slice(0, OPS_PAGE_SIZE).map((r) => ({
      actionId: r.action_id,
      operatorId: r.operator_id,
      operatorName: r.display_name,
      commandId: r.command_id,
      orgId: r.org_id,
      propertyId: r.property_id,
      reason: r.reason,
      ticketRef: r.ticket_ref,
      before: parseJson(r.before_json),
      after: parseJson(r.after_json),
      createdAt: r.created_at,
    })),
  };
}

export async function getCustomer(
  env: PmsEnv,
  input: { operatorId: string; orgId: string },
): Promise<CustomerDetail | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  if (!tenantIdOk(input.orgId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  const org = await getOrg(env, input.orgId);
  if (!org) return opsFail(NOT_FOUND);

  const sub = await env.PLATFORM_DB.prepare(
    `SELECT plan_code, status, entitlement_version FROM subscription WHERE org_id = ?`,
  )
    .bind(org.orgId)
    .first<{ plan_code: string; status: string; entitlement_version: number }>();
  const addons = await orgAddons(env, org.orgId);
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT property_id, name, time_zone, jurisdiction, status FROM property WHERE org_id = ? ORDER BY created_at, property_id`,
  )
    .bind(org.orgId)
    .all<{ property_id: string; name: string; time_zone: string; jurisdiction: string | null; status: string }>();
  const properties = (results ?? []).map((r) => ({
    propertyId: r.property_id,
    name: r.name,
    timeZone: r.time_zone,
    jurisdiction: r.jurisdiction as Jurisdiction | null,
    status: r.status,
  }));

  let owners: CustomerDetail['owners'] = [];
  try {
    const stub = resolveOrgStub(env.ORG_DO, { orgId: org.orgId }) as DurableObjectStub<OrgDO>;
    owners = (await stub.listMembers())
      .filter((m) => m.role === 'owner')
      .map((m) => ({ userId: m.userId, role: 'owner' as const }));
  } catch {
    owners = [];
  }

  const actions = await readActions(env, { orgId: org.orgId }, 0);
  return {
    ok: true,
    org: { orgId: org.orgId, name: org.name, status: org.status, createdAt: org.createdAt },
    subscription: sub
      ? { planCode: sub.plan_code, status: sub.status, entitlementVersion: sub.entitlement_version }
      : null,
    addons,
    propertiesUsed: properties.length,
    propertiesLimit: sub ? await propertiesLimit(env, sub.plan_code, addons) : 0,
    properties,
    owners,
    actions: actions.rows,
  };
}

/** Reads ONE PropertyDO. Counts, dates and statuses only. */
export async function getPropertyHealth(
  env: PmsEnv,
  input: { operatorId: string; propertyId: string },
): Promise<PropertyHealthView | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  if (!tenantIdOk(input.propertyId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  const property = await getProperty(env, input.propertyId);
  if (!property) return opsFail(NOT_FOUND);
  const resolved = await resolvePropertyFromRegistry(env, property.propertyId, property);
  if (!resolved) return opsFail(NOT_FOUND);
  try {
    const org = resolveOrgStub(env.ORG_DO, { orgId: property.orgId }) as DurableObjectStub<OrgDO>;
    const [health, activeMemberCount] = await Promise.all([
      resolved.stub.readConsoleHealth(Date.now()),
      org.countMembersForProperty(property.propertyId),
    ]);
    return {
      ok: true,
      propertyId: property.propertyId,
      orgId: property.orgId,
      businessDate: health.businessDate,
      lastNightAudit: health.lastNightAudit,
      oldestOutboxAgeMs: health.oldestOutboxAgeMs,
      roomCount: health.roomCount,
      roomTypeCount: health.roomTypeCount,
      activeMemberCount,
      schemaVersion: health.schemaVersion,
    };
  } catch (e) {
    if (isPropertyDoTransportFailure(e, env)) return opsFail(ORG_UNREACHABLE, 'property_unreachable');
    throw e;
  }
}

export async function listOperatorActions(
  env: PmsEnv,
  input: { operatorId: string; orgId?: string | null; filterOperatorId?: string | null; page?: number },
): Promise<OperatorActionPage | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  const paging = pageOffset(input.page);
  if (!paging) return opsFail(INVALID_REQUEST, 'page');
  const { rows, hasMore } = await readActions(
    env,
    { orgId: input.orgId ?? null, operatorId: input.filterOperatorId ?? null },
    paging.offset,
  );
  return { ok: true, page: paging.page, hasMore, actions: rows };
}

export async function listOperators(
  env: PmsEnv,
  input: { operatorId: string },
): Promise<{ ok: true; operators: OperatorView[] } | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'admin_read');
  if ('ok' in operator) return operator;
  const { results } = await env.PLATFORM_DB.prepare(`SELECT * FROM operator ORDER BY created_at, operator_id`).all<OperatorRow>();
  return { ok: true, operators: (results ?? []).map(toOperatorView) };
}
