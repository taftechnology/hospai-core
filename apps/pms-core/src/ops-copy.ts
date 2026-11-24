/**
 * R7.5 Copy setup from another hotel (ops-platform spec §11). `ops.copy_setup` is accepted here in one
 * Platform D1 batch (the `ops_copy_run` row and its single `operator_action` row), then `OpsCopyWorkflow`
 * runs it: one Workflow step per kind, every item replayed on the target PropertyDO through the same
 * command a hotel admin would use, with the operator as the actor.
 *
 * Where the run state lives (C7): `ops_copy_run` in Platform D1, not the Workflow instance. A Workflow
 * instance only exposes its final output, and the console needs per-kind counts and every skipped item
 * while the copy is still running and long after the instance is gone. The row also carries the
 * source-to-target id map, so a restarted instance (a new `attempt`) resumes from the same truth.
 *
 * Re-running is safe at two levels. Every target id is a pure function of (copy id, kind, source id), so a
 * retried step sends the same payload; and every item carries the idempotency key
 * `copy:<copyId>:<kind>:<sourceId>`, which the PropertyDO scopes to `operator:<operatorId>:` (so the stored
 * key is `operator:<operatorId>:copy:<copyId>:<kind>:<sourceId>`, spec C6). A replay of an item that
 * already ran returns the cached result; it never inserts a second row.
 */
import {
  INTERNAL_ERROR,
  INVALID_REQUEST,
  LIMIT_EXCEEDED,
  NOT_FOUND,
  ORG_MISMATCH,
  ORG_UNREACHABLE,
  OPS_COPY_KINDS,
  OPS_COPY_KINDS_MAX,
  OPS_COPY_NOT_COPIED,
  OPS_COPY_SKIPPED_MAX,
  TARGET_NOT_EMPTY,
  TENANT_NOT_ACTIVE,
  commandFingerprint,
  getConfigEntry,
  type ActorContext,
  type IdempotencyKey,
  type OpsCopyAccepted,
  type OpsCopyCensus,
  type OpsCopyKind,
  type OpsCopyKindResult,
  type OpsCopyRunState,
  type OpsCopyStatus,
  type OpsFailure,
  type OperatorActor,
  type PackageComponentInput,
  type RatePlanInclusionInput,
  type PropertyRecord,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID, SYSTEM_CHARGE_CODES } from '@hospai/do-runtime';
import { logError } from '@hospai/observability';
import { isPropertyDoTransportFailure } from './do-transport-failure.js';
import type { OpsCopyWorkflowParams, PmsEnv } from './env.js';
import {
  actionStatement,
  authorize,
  findPrior,
  newActionId,
  opsFail,
  parseJson,
  prepareWrite,
  replayCheck,
  runBatch,
  tenantIdOk,
  type WriteInput,
} from './ops-platform.js';
import { resolvePropertyFromRegistry } from './provision.js';
import { ensurePlatformSchema, getOrg, getProperty } from './registry.js';

// ---------------------------------------------------------------------------------------------
// C4 / C5: what a copy may carry
// ---------------------------------------------------------------------------------------------

/**
 * The DOMAIN config keys a copy may carry (spec C4: "an explicit allowlist"). A key is here only when it
 * is a hotel *policy* that a second hotel of the same owner usually shares and that cannot identify,
 * bill or schedule the first hotel. Nothing is allowed by default: a key added to the register later is
 * NOT copied until someone adds it here, and a test asserts no entry is SECRET, none is in the C5 set,
 * and every entry is a DOMAIN key a copy-scoped operator may write.
 *
 * Left out on purpose, with the reason (spec C5 unless noted):
 * - `pms.time.time_zone`, `pms.money.currency_code`: set when the hotel was created; the target has its own.
 * - `pms.money.currencies_list`: the foreign-currency list follows the hotel's own market and ledger currency.
 * - `pms.night_audit.audit_time`: the night-audit schedule (C5). The other night-audit keys are policy and stay in.
 * - `pms.tax.registrations`: the GSTIN and tax numbers (C5). `pms.tax.location`: the hotel's own place of supply.
 * - `pms.invoice.prefix`, `starting_idx`, `suffix`, `series`: invoice series and counters (C5).
 * - `pms.invoice.title`, `pms.invoice.footer`: free text that routinely carries the legal name, address and bank details (C5).
 * - `pms.report.manager` (MANAGER_REPORT_KEY): report recipients are per hotel. `accounting.ledger_map`: the hotel's own ledger names.
 * SECRET-class keys (bank, PayPal, terminals, logo) are not DOMAIN keys, so `tryPutDomainConfig` refuses them
 * as well (C5: bank details, POS credentials). E-invoicing credentials are not in the DOMAIN class at all.
 */
export const COPY_CONFIG_ALLOWLIST: readonly string[] = [
  // Availability policy: overbooking and the oversell allowance a group sells with.
  'pms.availability.allow_overbooking',
  'pms.availability.oversell_allowance',
  // Night-audit policy (not the schedule): what the audit does with no-shows, extensions and checks.
  'pms.night_audit.auto_no_show',
  'pms.night_audit.auto_extend',
  'pms.night_audit.checks',
  // Booking rules.
  'pms.booking.same_day_bookings',
  'pms.booking.same_day_cutoff',
  'pms.booking.require_prepayment',
  'pms.booking.booking_date_change',
  // How a payment is allocated across folio windows.
  'pms.money.payment_alloc',
  // Folio behaviour at check-out and for open folios.
  'pms.folio.breakfast_rule',
  'pms.folio.configs',
  'pms.folio.close_window_on_check_out',
  'pms.folio.auto_capture_on_check_out',
  'pms.folio.open_folio',
  // Reservation and payment holds, check-in and check-out rules.
  'pms.reservations.pending_hold_hours',
  'pms.payments.auth_hold_hours',
  'pms.reservations.inquiry_ttl_days',
  'pms.reservations.check_in_cleanliness',
  'pms.reservations.check_out_require_zero_balance',
  'pms.reservations.allow_dirty_check_in_override',
  'pms.reservations.allow_balance_override',
  // Housekeeping policy.
  'pms.housekeeping.require_inspection',
  'pms.housekeeping.task_types',
  'pms.housekeeping.request_types',
  'pms.housekeeping.minibar',
  'pms.ops.auto_assign_rooms',
  // How invoices are generated and shown (not their numbering, title or footer).
  'pms.invoice.gen_mode',
  'pms.invoice.show_taxfee',
  'pms.invoice.date_rule',
  'pms.invoice.allow_pending',
  // Tax group to HSN/SAC classification: the catalogue behind the copied tax rules, not the hotel's tax number.
  'pms.tax.classification',
];

/** Config keys the copy refuses even if someone adds them to the allowlist by mistake (C5). */
export const COPY_CONFIG_NEVER: readonly string[] = [
  'pms.tax.registrations',
  'pms.tax.location',
  'pms.invoice.prefix',
  'pms.invoice.starting_idx',
  'pms.invoice.suffix',
  'pms.invoice.series',
  'pms.invoice.title',
  'pms.invoice.footer',
  'pms.night_audit.audit_time',
  'pms.time.time_zone',
  'pms.money.currency_code',
];

/** Kinds that carry money amounts: the ledger currency of source and target must agree to copy them. */
const MONEY_KINDS: readonly OpsCopyKind[] = ['products', 'rate_plans', 'packages'];

/** Source rate days are copied from the target's business date for this many days. */
const RATE_HORIZON_DAYS = 365;
/** Rate-day jobs (plan x room type) per Workflow step: one job is at most `RATE_HORIZON_DAYS + 1` DO calls. */
export const COPY_RATE_JOBS_PER_STEP = 2;
/** More jobs than this and the rest are reported as skipped `over_cap` (a Workflow holds 1,024 steps). */
const COPY_RATE_JOBS_MAX = 1800;

// ---------------------------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------------------------

type RunRow = {
  copy_id: string;
  operator_id: string;
  org_id: string;
  source_property_id: string;
  target_property_id: string;
  kinds_json: string;
  status: OpsCopyRunState;
  result_json: string;
  id_map_json: string;
  error: string | null;
  attempt: number;
  created_at: number;
  updated_at: number;
};

type RateJobLedger = Record<string, { created: number; skipped: OpsCopyKindResult['skipped'] }>;

type IdMap = {
  roomTypes: Record<string, string>;
  ratePlans: Record<string, string>;
  categories: Record<string, string>;
  products: Record<string, string>;
  /** The `rate_plans` step's own result (plans only). The rate sub-steps add to it through `rateJobs`. */
  planBase: OpsCopyKindResult | null;
  /** Per rate sub-step: nights created and skipped. Overwritten, never added to, so a retry cannot double count. */
  rateJobs: RateJobLedger;
};

const EMPTY_MAP = (): IdMap => ({
  roomTypes: {},
  ratePlans: {},
  categories: {},
  products: {},
  planBase: null,
  rateJobs: {},
});

function readMap(raw: string): IdMap {
  const parsed = parseJson(raw) as Partial<IdMap> | null;
  return { ...EMPTY_MAP(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
}

function readResults(raw: string): Partial<Record<OpsCopyKind, OpsCopyKindResult>> {
  const parsed = parseJson(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<OpsCopyKind, OpsCopyKindResult>>) : {};
}

function readKinds(raw: string): OpsCopyKind[] {
  const parsed = parseJson(raw);
  const set = new Set(Array.isArray(parsed) ? parsed : []);
  return OPS_COPY_KINDS.filter((k) => set.has(k));
}

async function loadRun(env: PmsEnv, copyId: string): Promise<RunRow | null> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  return env.PLATFORM_DB.prepare(`SELECT * FROM ops_copy_run WHERE copy_id = ?`).bind(copyId).first<RunRow>();
}

// ---------------------------------------------------------------------------------------------
// Workflow start
// ---------------------------------------------------------------------------------------------

function instanceId(copyId: string, attempt: number): string {
  return `${copyId}-${attempt}`;
}

/** Get-or-create the Workflow instance for this attempt. A real failure to create it propagates. */
async function ensureCopyWorkflow(env: PmsEnv, row: Pick<RunRow, 'copy_id' | 'operator_id' | 'attempt'>): Promise<void> {
  const id = instanceId(row.copy_id, row.attempt);
  try {
    await env.OPS_COPY_WORKFLOW.get(id);
    return;
  } catch {
    // Absent: create below. A broken binding makes `create` throw, and that is rethrown.
  }
  const params: OpsCopyWorkflowParams = { copyId: row.copy_id, operatorId: row.operator_id, attempt: row.attempt };
  try {
    await env.OPS_COPY_WORKFLOW.create({ id, params });
  } catch (e) {
    try {
      await env.OPS_COPY_WORKFLOW.get(id);
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

async function markFailed(env: PmsEnv, copyId: string, error: string): Promise<void> {
  await env.PLATFORM_DB.prepare(
    `UPDATE ops_copy_run SET status = 'failed', error = ?, updated_at = ? WHERE copy_id = ? AND status IN ('pending', 'running')`,
  )
    .bind(error, Date.now(), copyId)
    .run();
}

// ---------------------------------------------------------------------------------------------
// ops.copy_setup
// ---------------------------------------------------------------------------------------------

/** Census count per kind, or 0: the rows of that kind a target must not already hold (C3). */
function nonEmptyKinds(census: OpsCopyCensus, kinds: OpsCopyKind[]): OpsCopyKind[] {
  const count: Record<OpsCopyKind, number> = {
    charge_codes: census.chargeCodes,
    tax_rules: census.taxRules,
    room_types: census.roomTypes,
    products: census.productCategories + census.products,
    rate_plans: census.ratePlans + census.rateDays,
    packages: census.packages,
    config: census.configKeys.length,
  };
  return kinds.filter((k) => count[k] > 0);
}

export async function copySetup(
  env: PmsEnv,
  input: WriteInput & { sourcePropertyId: string; targetPropertyId: string; kinds: OpsCopyKind[] },
): Promise<OpsCopyAccepted | OpsFailure> {
  const rawKinds: unknown = input?.kinds;
  // `kinds` is hashed as the canonical list that is executed: de-duplicated, in run order. An oversized
  // or unknown list is hashed as a bounded raw view and refused below, after the operator checks.
  const rawList = Array.isArray(rawKinds) ? (rawKinds as unknown[]) : null;
  const wellFormed =
    rawList !== null &&
    rawList.length > 0 &&
    rawList.length <= OPS_COPY_KINDS_MAX &&
    rawList.every((k) => typeof k === 'string' && (OPS_COPY_KINDS as readonly string[]).includes(k));
  const kinds: OpsCopyKind[] = wellFormed ? OPS_COPY_KINDS.filter((k) => rawList.includes(k)) : [];
  const p = await prepareWrite(env, 'ops.copy_setup', input, {
    sourcePropertyId: input?.sourcePropertyId,
    targetPropertyId: input?.targetPropertyId,
    kinds: wellFormed ? kinds : rawList === null ? null : rawList.slice(0, OPS_COPY_KINDS_MAX + 1),
  });
  if ('ok' in p) return p;

  if (rawList === null) return opsFail(INVALID_REQUEST, 'kinds');
  if (rawList.length > OPS_COPY_KINDS_MAX) return opsFail(LIMIT_EXCEEDED, 'kinds');
  if (!wellFormed) return opsFail(INVALID_REQUEST, 'kinds');
  const sourceId = input.sourcePropertyId;
  const targetId = input.targetPropertyId;
  if (!tenantIdOk(sourceId) || !tenantIdOk(targetId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  if (sourceId === targetId) return opsFail(INVALID_REQUEST, 'same_property');

  // Replay of an accepted copy: same key and payload. A failed or half-started run restarts as the
  // next attempt of the SAME copy, so its ids and per-item keys are unchanged and nothing doubles.
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    if (bad) return bad;
    const run = await loadRun(env, prior.action_id);
    if (!run) return opsFail(INTERNAL_ERROR);
    return resumeRun(env, run, prior.action_id);
  }

  const [source, target] = await Promise.all([getProperty(env, sourceId), getProperty(env, targetId)]);
  if (!source || !target) return opsFail(NOT_FOUND);
  // C2: the registry decides. No field of either property goes in this failure.
  if (source.orgId !== target.orgId) return opsFail(ORG_MISMATCH);
  const org = await getOrg(env, target.orgId);
  if (!org) return opsFail(NOT_FOUND);
  if (org.status !== 'active' || source.status !== 'active' || target.status !== 'active') {
    return opsFail(TENANT_NOT_ACTIVE);
  }

  // C3: the target must be empty of everything being copied, and must never have held a reservation.
  const gate = await checkTarget(env, source, target, kinds);
  if (gate) return gate;

  const copyId = newActionId();
  const now = Date.now();
  const outcome = await runBatch(
    env,
    p,
    [
      env.PLATFORM_DB.prepare(
        `INSERT INTO ops_copy_run
           (copy_id, operator_id, org_id, source_property_id, target_property_id, kinds_json, status,
            result_json, id_map_json, attempt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', '{}', '{}', 1, ?, ?)`,
      ).bind(copyId, p.operator.operator_id, target.orgId, source.propertyId, target.propertyId, JSON.stringify(kinds), now, now),
      actionStatement(
        env,
        copyId,
        p,
        {
          commandId: 'ops.copy_setup',
          orgId: target.orgId,
          propertyId: target.propertyId,
          before: null,
          after: { copyId, sourcePropertyId: source.propertyId, targetPropertyId: target.propertyId, kinds },
        },
        false,
      ),
    ],
    (m) => (m.includes('ops_copy_run.target_property_id') ? opsFail(TARGET_NOT_EMPTY, 'copy_in_progress') : null),
  );
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    const bad = replayCheck(p, outcome.prior);
    if (bad) return bad;
    const run = await loadRun(env, outcome.prior.action_id);
    if (!run) return opsFail(INTERNAL_ERROR);
    return resumeRun(env, run, outcome.prior.action_id);
  }

  const run = await loadRun(env, copyId);
  if (!run) return opsFail(INTERNAL_ERROR);
  try {
    await ensureCopyWorkflow(env, run);
  } catch (e) {
    // Accepted and recorded, but the Workflow did not start: release the target and tell the operator.
    // Sending the same request again restarts this copy (attempt 2).
    logError({ moduleId: 'pms.core' }, { msg: 'ops.copy_setup_workflow_start_failed', copyId, error: String(e) });
    await markFailed(env, copyId, 'workflow_unavailable');
    return opsFail(INTERNAL_ERROR, 'workflow_unavailable');
  }
  return { ok: true, actionId: copyId, copyId, replayed: false };
}

async function resumeRun(env: PmsEnv, run: RunRow, actionId: string): Promise<OpsCopyAccepted | OpsFailure> {
  let current = run;
  if (run.status === 'failed') {
    try {
      const res = await env.PLATFORM_DB.prepare(
        `UPDATE ops_copy_run SET status = 'pending', error = NULL, attempt = attempt + 1, updated_at = ?
         WHERE copy_id = ? AND status = 'failed'`,
      )
        .bind(Date.now(), run.copy_id)
        .run();
      if ((res.meta?.changes ?? 0) > 0) current = { ...run, status: 'pending', attempt: run.attempt + 1 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('ops_copy_run.target_property_id')) return opsFail(TARGET_NOT_EMPTY, 'copy_in_progress');
      throw e;
    }
  }
  if (current.status === 'pending' || current.status === 'running') {
    const latest = (await loadRun(env, run.copy_id)) ?? current;
    try {
      await ensureCopyWorkflow(env, latest);
    } catch (e) {
      logError({ moduleId: 'pms.core' }, { msg: 'ops.copy_setup_workflow_restart_failed', copyId: run.copy_id, error: String(e) });
      await markFailed(env, run.copy_id, 'workflow_unavailable');
      return opsFail(INTERNAL_ERROR, 'workflow_unavailable');
    }
  }
  return { ok: true, actionId, copyId: run.copy_id, replayed: true };
}

async function checkTarget(
  env: PmsEnv,
  source: PropertyRecord,
  target: PropertyRecord,
  kinds: OpsCopyKind[],
): Promise<OpsFailure | null> {
  const [src, tgt] = await Promise.all([
    resolvePropertyFromRegistry(env, source.propertyId, source),
    resolvePropertyFromRegistry(env, target.propertyId, target),
  ]);
  if (!src || !tgt) return opsFail(NOT_FOUND);
  try {
    const [targetCensus, sourceCensus] = await Promise.all([
      tgt.stub.readCopyCensus([...COPY_CONFIG_ALLOWLIST]),
      src.stub.readCopyCensus([]),
    ]);
    if (targetCensus.reservations > 0) return opsFail(TARGET_NOT_EMPTY, 'reservations');
    const taken = nonEmptyKinds(targetCensus, kinds);
    if (taken.length > 0) return opsFail(TARGET_NOT_EMPTY, taken.join(','));
    if (
      kinds.some((k) => MONEY_KINDS.includes(k)) &&
      sourceCensus.ledgerCurrency !== targetCensus.ledgerCurrency
    ) {
      return opsFail(INVALID_REQUEST, 'currency_mismatch');
    }
    return null;
  } catch (e) {
    if (isPropertyDoTransportFailure(e, env)) return opsFail(ORG_UNREACHABLE, 'property_unreachable');
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Status read (C7)
// ---------------------------------------------------------------------------------------------

export async function getCopyStatus(
  env: PmsEnv,
  input: { operatorId: string; copyId: string },
): Promise<OpsCopyStatus | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  if (typeof input.copyId !== 'string' || input.copyId.length === 0 || input.copyId.length > 128) {
    return opsFail(INVALID_REQUEST, 'copy_id');
  }
  const row = await loadRun(env, input.copyId);
  if (!row) return opsFail(NOT_FOUND);
  const kinds = readKinds(row.kinds_json);
  const stored = readResults(row.result_json);
  const results: OpsCopyStatus['results'] = {};
  let runningAssigned = false;
  for (const kind of kinds) {
    const done = stored[kind];
    if (done) {
      results[kind] = done;
      continue;
    }
    let state: OpsCopyKindResult['state'] = 'pending';
    if (!runningAssigned) {
      runningAssigned = true;
      if (row.status === 'running') state = 'running';
      if (row.status === 'failed') state = 'failed';
    }
    results[kind] = { state, created: 0, skipped: [], skippedMore: 0 };
  }
  return {
    ok: true,
    copyId: row.copy_id,
    state: row.status,
    orgId: row.org_id,
    sourcePropertyId: row.source_property_id,
    targetPropertyId: row.target_property_id,
    kinds,
    results,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notCopied: OPS_COPY_NOT_COPIED,
  };
}

// ---------------------------------------------------------------------------------------------
// Workflow-side: run a kind
// ---------------------------------------------------------------------------------------------

export type CopyStepOutcome = { ok: true; created: number } | { ok: false; error: string };

type Stub = DurableObjectStub<import('./property-do.js').PropertyDO>;

type RunCtx = {
  env: PmsEnv;
  run: RunRow;
  copyId: string;
  actor: OperatorActor & ActorContext;
  source: Stub;
  target: Stub;
  map: IdMap;
  sourceBusinessDate: string | null;
  targetBusinessDate: string | null;
};

class Acc {
  created = 0;
  parts: Record<string, number> = {};
  skipped: OpsCopyKindResult['skipped'] = [];
  skippedMore = 0;

  add(part?: string, n = 1): void {
    this.created += n;
    if (part) this.parts[part] = (this.parts[part] ?? 0) + n;
  }

  skip(sourceId: string, label: string, reason: string): void {
    if (this.skipped.length < OPS_COPY_SKIPPED_MAX) this.skipped.push({ sourceId, label, reason });
    else this.skippedMore += 1;
  }

  result(state: OpsCopyKindResult['state'] = 'done'): OpsCopyKindResult {
    return {
      state,
      created: this.created,
      ...(Object.keys(this.parts).length > 0 ? { parts: this.parts } : {}),
      skipped: this.skipped,
      skippedMore: this.skippedMore,
    };
  }
}

/** Deterministic target id: a pure function of (copy, kind, source), so a retried step sends the same payload. */
async function targetIdFor(prefix: string, copyId: string, kind: string, sourceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${copyId}\u0000${kind}\u0000${sourceId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return `${prefix}_${hex.slice(0, 24)}`;
}

/** Idempotency key and fingerprint for one replayed item (spec C6). The DO adds the `operator:<id>:` scope. */
async function itemIdem(
  ctx: RunCtx,
  kind: string,
  sourceId: string,
  commandId: string,
  payload: unknown,
): Promise<IdempotencyKey> {
  return { key: `copy:${ctx.copyId}:${kind}:${sourceId}`, fingerprint: await commandFingerprint(commandId, payload) };
}

function reasonOf(res: { ok: boolean; error?: unknown }): string | null {
  return res.ok ? null : String(res.error ?? INTERNAL_ERROR);
}

async function buildCtx(env: PmsEnv, run: RunRow): Promise<RunCtx | OpsFailure> {
  const [sourceProp, targetProp] = await Promise.all([
    getProperty(env, run.source_property_id),
    getProperty(env, run.target_property_id),
  ]);
  if (!sourceProp || !targetProp) return opsFail(NOT_FOUND);
  if (sourceProp.orgId !== run.org_id || targetProp.orgId !== run.org_id) return opsFail(ORG_MISMATCH);
  const org = await getOrg(env, run.org_id);
  if (!org || org.status !== 'active' || sourceProp.status !== 'active' || targetProp.status !== 'active') {
    return opsFail(TENANT_NOT_ACTIVE);
  }
  const [src, tgt] = await Promise.all([
    resolvePropertyFromRegistry(env, sourceProp.propertyId, sourceProp),
    resolvePropertyFromRegistry(env, targetProp.propertyId, targetProp),
  ]);
  if (!src || !tgt) return opsFail(NOT_FOUND);
  return {
    env,
    run,
    copyId: run.copy_id,
    actor: {
      kind: 'operator',
      operatorId: run.operator_id,
      scope: 'copy_setup',
      targetPropertyId: run.target_property_id,
    },
    source: src.stub,
    target: tgt.stub,
    map: readMap(run.id_map_json),
    sourceBusinessDate: await src.stub.readBusinessDate(),
    targetBusinessDate: await tgt.stub.readBusinessDate(),
  };
}

/** Mark the run `running` (once) and hand the Workflow what it needs. `null` means nothing to do. */
export async function startCopyRun(
  env: PmsEnv,
  copyId: string,
): Promise<{ kinds: OpsCopyKind[] } | null> {
  const row = await loadRun(env, copyId);
  if (!row || row.status === 'completed' || row.status === 'failed') return null;
  await env.PLATFORM_DB.prepare(
    `UPDATE ops_copy_run SET status = 'running', updated_at = ? WHERE copy_id = ? AND status IN ('pending', 'running')`,
  )
    .bind(Date.now(), copyId)
    .run();
  return { kinds: readKinds(row.kinds_json) };
}

export async function finishCopyRun(
  env: PmsEnv,
  copyId: string,
  state: 'completed' | 'failed',
  error?: string,
): Promise<void> {
  await env.PLATFORM_DB.prepare(
    `UPDATE ops_copy_run SET status = ?, error = ?, updated_at = ? WHERE copy_id = ? AND status IN ('pending', 'running')`,
  )
    .bind(state, error ?? null, Date.now(), copyId)
    .run();
}

/**
 * Read-modify-write the run's `result_json` / `id_map_json` as a compare-and-swap on the two columns just read.
 * Workflow steps are at-least-once, so a retried or overlapping step can write the same row between this
 * writer's read and its write; a plain overwrite would drop that writer's entries (the `rateJobs` ledger).
 * D1 has no multi-statement transaction here and the maps are one JSON blob, so the swap is the atomic unit:
 * a lost race re-reads and re-applies `change` to the fresh row, so nothing another writer stored is lost.
 */
async function updateRun(
  env: PmsEnv,
  copyId: string,
  change: (map: IdMap, results: Partial<Record<OpsCopyKind, OpsCopyKindResult>>) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await loadRun(env, copyId);
    if (!row) return;
    const map = readMap(row.id_map_json);
    const results = readResults(row.result_json);
    change(map, results);
    const res = await env.PLATFORM_DB.prepare(
      `UPDATE ops_copy_run SET result_json = ?, id_map_json = ?, updated_at = ?
       WHERE copy_id = ? AND result_json = ? AND id_map_json = ?`,
    )
      .bind(JSON.stringify(results), JSON.stringify(map), Date.now(), copyId, row.result_json, row.id_map_json)
      .run();
    if ((res.meta?.changes ?? 1) > 0) return;
  }
  throw new Error('ops_copy_run_contended');
}

/**
 * Persist a finished kind. `ctx.map` was loaded when the step started, so it is merged into the stored map
 * (keys unioned; both writers derive the same deterministic target ids from `targetIdFor`, so a shared key
 * carries the same value) and the stored `rateJobs` entries win over the stale ones.
 */
async function saveKind(ctx: RunCtx, kind: OpsCopyKind, acc: Acc): Promise<void> {
  await updateRun(ctx.env, ctx.copyId, (map, results) => {
    map.roomTypes = { ...map.roomTypes, ...ctx.map.roomTypes };
    map.ratePlans = { ...map.ratePlans, ...ctx.map.ratePlans };
    map.categories = { ...map.categories, ...ctx.map.categories };
    map.products = { ...map.products, ...ctx.map.products };
    map.planBase = ctx.map.planBase ?? map.planBase;
    map.rateJobs = { ...ctx.map.rateJobs, ...map.rateJobs };
    results[kind] = kind === 'rate_plans' ? composeRatePlans(acc.result('done'), map.rateJobs) : acc.result('done');
  });
}

/** Run one kind to the end. Every item is an idempotent replay, so the whole step is safe to retry. */
export async function executeCopyKind(env: PmsEnv, copyId: string, kind: OpsCopyKind): Promise<CopyStepOutcome> {
  const run = await loadRun(env, copyId);
  if (!run) return { ok: false, error: NOT_FOUND };
  const ctx = await buildCtx(env, run);
  if ('ok' in ctx) return { ok: false, error: ctx.error };
  const acc = new Acc();
  try {
    await KIND_RUNNERS[kind](ctx, acc);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, env)) throw e; // the Workflow retries the step
    logError({ moduleId: 'pms.core' }, { msg: 'ops.copy_setup_kind_failed', copyId, kind, error: String(e) });
    return { ok: false, error: INTERNAL_ERROR };
  }
  await saveKind(ctx, kind, acc);
  return { ok: true, created: acc.created };
}

const KIND_RUNNERS: Record<OpsCopyKind, (ctx: RunCtx, acc: Acc) => Promise<void>> = {
  charge_codes: copyChargeCodes,
  tax_rules: copyTaxRules,
  room_types: copyRoomTypes,
  products: copyProducts,
  rate_plans: copyRatePlans,
  packages: copyPackages,
  config: copyConfig,
};

// --- charge codes ---------------------------------------------------------------------------

async function copyChargeCodes(ctx: RunCtx, acc: Acc): Promise<void> {
  // Codes every hotel is born with (ROOM, MISC, TAX, the system codes) exist on the target already.
  const system = new Set<string>([...SYSTEM_CHARGE_CODES, ...(await ctx.target.readCopyCensus([])).seededChargeCodes]);
  const codes = await ctx.source.listChargeCodes('all');
  for (const c of codes) {
    // The system codes (ROOM, MISC, PAYMENT, ...) exist in every hotel already: not an item to copy.
    if (system.has(c.code)) continue;
    if (c.status !== 'active') {
      acc.skip(c.code, c.name, 'archived');
      continue;
    }
    const create = { code: c.code, name: c.name };
    const failed = reasonOf(
      await ctx.target.tryCreateChargeCode(ctx.actor, create, await itemIdem(ctx, 'charge_codes', c.code, 'folio.create_charge_code', create)),
    );
    if (failed) {
      acc.skip(c.code, c.name, failed);
      continue;
    }
    if (c.taxGroup) {
      // The tax group link is a second admin command, the same one a hotel admin uses.
      const link = { code: c.code, taxGroup: c.taxGroup };
      const linkFailed = reasonOf(
        await ctx.target.tryUpdateChargeCode(ctx.actor, link, await itemIdem(ctx, 'charge_codes', `${c.code}:tax_group`, 'folio.update_charge_code', link)),
      );
      if (linkFailed) acc.skip(`${c.code}:tax_group`, c.name, linkFailed);
    }
    acc.add();
  }
}

// --- tax rules ------------------------------------------------------------------------------

async function copyTaxRules(ctx: RunCtx, acc: Acc): Promise<void> {
  const today = ctx.sourceBusinessDate ?? new Date().toISOString().slice(0, 10);
  const rules = await ctx.source.listTaxRules();
  // `tax.create_rule` refuses a second version of one rule key, so each key contributes one version:
  // the one in force today, else the first one that starts later. Closed and superseded versions are history.
  type Rule = (typeof rules)[number];
  const byKey = new Map<string, Rule[]>();
  for (const r of rules) byKey.set(r.ruleKey, [...(byKey.get(r.ruleKey) ?? []), r]);
  for (const versions of byKey.values()) {
    const live = (r: Rule) => r.validTo === null || r.validTo > today;
    const current = versions.find((r) => r.validFrom <= today && live(r));
    const future = versions.filter((r) => r.validFrom > today).sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
    const chosen = current ?? future;
    for (const r of versions) {
      if (r !== chosen) acc.skip(r.taxRuleId, r.name, 'superseded_version');
    }
    if (!chosen) continue;
    const taxRuleId = await targetIdFor('txr', ctx.copyId, 'tax_rules', chosen.taxRuleId);
    const input = {
      taxRuleId,
      ruleKey: chosen.ruleKey,
      name: chosen.name,
      ruleType: chosen.ruleType,
      rate: chosen.rate,
      taxGroup: chosen.taxGroup,
      outputChargeCode: chosen.outputChargeCode,
      validFrom: chosen.validFrom,
      validTo: chosen.validTo,
      priceMode: chosen.priceMode,
      sequence: chosen.sequence,
      base: chosen.base,
      conditionKey: chosen.conditionKey,
      conditionValue: chosen.conditionValue,
      rebandsOnDiscount: chosen.rebandsOnDiscount,
      bands: chosen.bands.map((b) => ({
        upToMinor: b.upToMinor,
        components: b.components.map((c) => ({ outputChargeCode: c.outputChargeCode, rate: c.rate })),
      })),
    };
    const failed = reasonOf(
      await ctx.target.tryCreateTaxRule(ctx.actor, input, await itemIdem(ctx, 'tax_rules', chosen.taxRuleId, 'folio.create_tax_rule', input)),
    );
    if (failed) acc.skip(chosen.taxRuleId, chosen.name, failed);
    else acc.add();
  }
}

// --- room types -----------------------------------------------------------------------------

async function copyRoomTypes(ctx: RunCtx, acc: Acc): Promise<void> {
  const types = await ctx.source.listRoomTypes('all');
  // Physical before virtual: a virtual type names the physical ones it is built from.
  const ordered = [...types.filter((t) => t.kind === 'physical'), ...types.filter((t) => t.kind === 'virtual')];
  for (const t of ordered) {
    if (t.status !== 'active') {
      acc.skip(t.roomTypeId, t.name, 'archived');
      continue;
    }
    const roomTypeId = await targetIdFor('rt', ctx.copyId, 'room_types', t.roomTypeId);
    let constituents: string[] | undefined;
    if (t.kind === 'virtual') {
      const mapped = t.constituentRoomTypeIds.map((id) => ctx.map.roomTypes[id]);
      if (mapped.some((m) => !m)) {
        acc.skip(t.roomTypeId, t.name, 'dependency_not_copied');
        continue;
      }
      constituents = (mapped as string[]).sort((a, b) => a.localeCompare(b));
    }
    // Definitions only (C4): no rooms, physical count 0. `inventory.add_room_type` writes the availability
    // rows for the new type itself, in its own transaction; nothing here touches the ledger.
    const input = {
      roomTypeId,
      code: t.code,
      name: t.name,
      kind: t.kind,
      ...(t.kind === 'physical' ? { roomCount: 0 } : {}),
      maxOccupancy: t.maxOccupancy,
      maxAdults: t.maxAdults,
      ...(constituents ? { constituentRoomTypeIds: constituents } : {}),
    };
    const failed = reasonOf(
      await ctx.target.tryAddRoomType(ctx.actor, input, await itemIdem(ctx, 'room_types', t.roomTypeId, 'inventory.add_room_type', input)),
    );
    if (failed) acc.skip(t.roomTypeId, t.name, failed);
    else {
      ctx.map.roomTypes[t.roomTypeId] = roomTypeId;
      acc.add();
    }
  }
}

// --- products -------------------------------------------------------------------------------

async function copyProducts(ctx: RunCtx, acc: Acc): Promise<void> {
  const read = await ctx.source.listProducts('all');
  for (const c of read.categories) {
    if (c.status !== 'active') {
      acc.skip(c.categoryId, c.name, 'archived');
      continue;
    }
    const categoryId = await targetIdFor('cat', ctx.copyId, 'products', c.categoryId);
    const input = { categoryId, name: c.name, sortOrder: c.sortOrder };
    const failed = reasonOf(
      await ctx.target.tryCreateProductCategory(ctx.actor, input, await itemIdem(ctx, 'products', c.categoryId, 'products.create_category', input)),
    );
    if (failed) acc.skip(c.categoryId, c.name, failed);
    else {
      ctx.map.categories[c.categoryId] = categoryId;
      acc.add('categories');
    }
  }
  for (const item of read.items) {
    if (item.status !== 'active') {
      acc.skip(item.productId, item.name, 'archived');
      continue;
    }
    const categoryId = ctx.map.categories[item.categoryId];
    if (!categoryId) {
      acc.skip(item.productId, item.name, 'dependency_not_copied');
      continue;
    }
    const productId = await targetIdFor('prd', ctx.copyId, 'products', item.productId);
    const input = {
      productId,
      categoryId,
      name: item.name,
      sku: item.sku,
      chargeCode: item.chargeCode,
      defaultAmountMinor: item.defaultAmountMinor,
    };
    const failed = reasonOf(
      await ctx.target.tryCreateProduct(ctx.actor, input, await itemIdem(ctx, 'products', item.productId, 'products.create_item', input)),
    );
    if (failed) acc.skip(item.productId, item.name, failed);
    else {
      ctx.map.products[item.productId] = productId;
      acc.add('items');
    }
  }
}

// --- rate plans (plans here; their rates are the `rates` sub-steps) --------------------------

async function copyRatePlans(ctx: RunCtx, acc: Acc): Promise<void> {
  const plans = await ctx.source.listRatePlans();
  // Parents before the plans derived from them.
  const ordered = [...plans.filter((p) => !p.parentRatePlanId), ...plans.filter((p) => p.parentRatePlanId)];
  for (const plan of ordered) {
    if (plan.ratePlanId === DEFAULT_RATE_PLAN_ID) {
      // Every hotel is created with the default plan; the id maps to itself so its rates still copy.
      ctx.map.ratePlans[plan.ratePlanId] = plan.ratePlanId;
      acc.skip(plan.ratePlanId, plan.name, 'default_plan_exists');
      continue;
    }
    const parent = plan.parentRatePlanId ? ctx.map.ratePlans[plan.parentRatePlanId] : null;
    if (plan.parentRatePlanId && !parent) {
      acc.skip(plan.ratePlanId, plan.name, 'dependency_not_copied');
      continue;
    }
    const inclusions: RatePlanInclusionInput[] = [];
    let missing = false;
    for (const inc of plan.inclusions) {
      const productId = ctx.map.products[inc.productId];
      if (!productId) {
        missing = true;
        break;
      }
      inclusions.push({ inclusionNo: inc.inclusionNo, productId, amountMinor: inc.amountMinor, basis: inc.basis, priceMode: inc.priceMode });
    }
    if (missing) {
      acc.skip(plan.ratePlanId, plan.name, 'dependency_not_copied');
      continue;
    }
    const ratePlanId = await targetIdFor('rp', ctx.copyId, 'rate_plans', plan.ratePlanId);
    const input = {
      ratePlanId,
      code: plan.code,
      name: plan.name,
      cancelPenaltyType: plan.cancelPenaltyType,
      cancelGraceHours: plan.cancelGraceHours,
      cancelPenaltyNights: plan.cancelPenaltyNights,
      cancelPenaltyBps: plan.cancelPenaltyBps,
      cancelPolicyText: plan.cancelPolicyText,
      parentRatePlanId: parent ?? null,
      deriveBps: plan.deriveBps,
      inclusions,
      inclusionTax: plan.inclusionTax,
      inclusionBandJoin: plan.inclusionBandJoin,
    };
    const failed = reasonOf(
      await ctx.target.tryCreateRatePlan(ctx.actor, input, await itemIdem(ctx, 'rate_plans', plan.ratePlanId, 'rates.create_plan', input)),
    );
    if (failed) acc.skip(plan.ratePlanId, plan.name, failed);
    else {
      ctx.map.ratePlans[plan.ratePlanId] = ratePlanId;
      acc.add('plans');
    }
  }
  ctx.map.planBase = acc.result();
}

/** The (plan, room type) pairs whose nightly rates the `rates` sub-steps copy. Derived plans follow their parent. */
export async function listCopyRateJobs(env: PmsEnv, copyId: string): Promise<Array<[string, string]>> {
  const run = await loadRun(env, copyId);
  if (!run) return [];
  const ctx = await buildCtx(env, run);
  if ('ok' in ctx) return [];
  const plans = await ctx.source.listRatePlans();
  const jobs: Array<[string, string]> = [];
  const roomTypeIds = Object.keys(ctx.map.roomTypes).sort();
  const planIds = plans.map((p) => p.ratePlanId).sort();
  const parentless = new Set(plans.filter((p) => !p.parentRatePlanId).map((p) => p.ratePlanId));
  for (const ratePlanId of planIds) {
    if (!parentless.has(ratePlanId) || !ctx.map.ratePlans[ratePlanId]) continue;
    for (const roomTypeId of roomTypeIds) jobs.push([ratePlanId, roomTypeId]);
  }
  return jobs.slice(0, COPY_RATE_JOBS_MAX);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Copy the nightly rates of the given (plan, room type) pairs from the target's business date for a year.
 * Each night is `rates.update_room_type_rate` with its own idempotency key. Adds to the `rate_plans`
 * result (`parts.rateDays`) without touching the plans already counted there.
 */
export async function executeCopyRates(
  env: PmsEnv,
  copyId: string,
  jobs: Array<[string, string]>,
): Promise<CopyStepOutcome> {
  const run = await loadRun(env, copyId);
  if (!run) return { ok: false, error: NOT_FOUND };
  const ctx = await buildCtx(env, run);
  if ('ok' in ctx) return { ok: false, error: ctx.error };
  const from = ctx.targetBusinessDate;
  if (!from) return { ok: false, error: INTERNAL_ERROR };
  const to = addDays(from, RATE_HORIZON_DAYS);
  let created = 0;
  const perJob: Array<{ key: string; created: number; skipped: OpsCopyKindResult['skipped'] }> = [];
  try {
    for (const [sourcePlan, sourceRoomType] of jobs) {
      const entry = { key: `${sourcePlan}/${sourceRoomType}`, created: 0, skipped: [] as OpsCopyKindResult['skipped'] };
      perJob.push(entry);
      const skipped = entry.skipped;
      const ratePlanId = ctx.map.ratePlans[sourcePlan];
      const roomTypeId = ctx.map.roomTypes[sourceRoomType];
      if (!ratePlanId || !roomTypeId) {
        skipped.push({ sourceId: `${sourcePlan}:${sourceRoomType}`, label: sourcePlan, reason: 'dependency_not_copied' });
        continue;
      }
      const days = await ctx.source.listRateDays({ fromDate: from, toDate: to, roomTypeId: sourceRoomType, ratePlanId: sourcePlan });
      for (const d of days) {
        const input = {
          roomTypeId,
          ratePlanId,
          stayDate: d.stayDate,
          amountMinor: d.amountMinor,
          currency: d.currency,
          auditCommandId: 'rates.update_room_type_rate' as const,
        };
        const sourceId = `${sourcePlan}:${sourceRoomType}:${d.stayDate}`;
        const failed = reasonOf(
          await ctx.target.tryUpsertRateDay(ctx.actor, input, await itemIdem(ctx, 'rate_day', sourceId, 'rates.update_room_type_rate', input)),
        );
        if (failed) skipped.push({ sourceId, label: sourcePlan, reason: failed });
        else {
          created += 1;
          entry.created += 1;
        }
      }
    }
  } catch (e) {
    if (isPropertyDoTransportFailure(e, env)) throw e;
    logError({ moduleId: 'pms.core' }, { msg: 'ops.copy_setup_rates_failed', copyId, error: String(e) });
    return { ok: false, error: INTERNAL_ERROR };
  }
  await recordRates(env, copyId, perJob);
  return { ok: true, created };
}

/** The `rate_plans` result: the plans step's own result plus what the rate sub-steps recorded. */
function composeRatePlans(base: OpsCopyKindResult, ledger: RateJobLedger): OpsCopyKindResult {
  const jobs = Object.values(ledger);
  if (jobs.length === 0) return base;
  const rateDays = jobs.reduce((n, j) => n + j.created, 0);
  const plans = base.parts?.plans ?? 0;
  const acc = new Acc();
  acc.skipped = [...base.skipped];
  acc.skippedMore = base.skippedMore;
  for (const j of jobs) for (const s of j.skipped) acc.skip(s.sourceId, s.label, s.reason);
  return { ...acc.result(), created: plans + rateDays, parts: { plans, rateDays } };
}

/** One ledger entry per (plan, room type) job, so any chunking or order of the same jobs converges on one total. */
async function recordRates(
  env: PmsEnv,
  copyId: string,
  perJob: Array<{ key: string; created: number; skipped: OpsCopyKindResult['skipped'] }>,
): Promise<void> {
  await updateRun(env, copyId, (map, results) => {
    for (const j of perJob) map.rateJobs[j.key] = { created: j.created, skipped: j.skipped };
    results.rate_plans = composeRatePlans(map.planBase ?? results.rate_plans ?? new Acc().result(), map.rateJobs);
  });
}

// --- packages -------------------------------------------------------------------------------

async function copyPackages(ctx: RunCtx, acc: Acc): Promise<void> {
  const read = await ctx.source.listPackages('all');
  for (const pkg of read.packages) {
    if (pkg.status !== 'active') {
      acc.skip(pkg.packageId, pkg.name, 'archived');
      continue;
    }
    const roomTypeId = ctx.map.roomTypes[pkg.roomTypeId];
    const ratePlanId = ctx.map.ratePlans[pkg.ratePlanId];
    const components: PackageComponentInput[] = [];
    for (const c of pkg.components) {
      const productId = ctx.map.products[c.productId];
      if (productId) {
        components.push({ componentNo: c.componentNo, productId, amountMinor: c.amountMinor, schedule: c.schedule, setNight: c.setNight });
      }
    }
    if (!roomTypeId || !ratePlanId || components.length !== pkg.components.length) {
      acc.skip(pkg.packageId, pkg.name, 'dependency_not_copied');
      continue;
    }
    const packageId = await targetIdFor('pkg', ctx.copyId, 'packages', pkg.packageId);
    const input = {
      packageId,
      code: pkg.code,
      name: pkg.name,
      roomTypeId,
      ratePlanId,
      nights: pkg.nights,
      priceMinor: pkg.priceMinor,
      componentTax: pkg.componentTax,
      components,
    };
    const failed = reasonOf(
      await ctx.target.tryCreatePackage(ctx.actor, input, await itemIdem(ctx, 'packages', pkg.packageId, 'rates.create_package', input)),
    );
    if (failed) acc.skip(pkg.packageId, pkg.name, failed);
    else acc.add();
  }
}

// --- config ---------------------------------------------------------------------------------

async function copyConfig(ctx: RunCtx, acc: Acc): Promise<void> {
  const allowed = new Set(COPY_CONFIG_ALLOWLIST.filter((k) => !COPY_CONFIG_NEVER.includes(k)));
  // `value` is `unknown`, which the RPC result type collapses to `never`: name the shape we read.
  const entries = (await ctx.source.listDomainConfig()) as unknown as Array<{
    key: string;
    value: unknown;
    source: 'stored' | 'default' | 'unset';
  }>;
  for (const e of entries) {
    if (e.source !== 'stored' || !allowed.has(e.key)) continue;
    // Belt and braces: the register must still call it DOMAIN, and never SECRET.
    if (getConfigEntry(e.key)?.class !== 'DOMAIN') {
      acc.skip(e.key, e.key, 'not_domain_class');
      continue;
    }
    const meta = { reason: `Copied from ${ctx.run.source_property_id} (copy ${ctx.copyId})` };
    const payload = { key: e.key, value: e.value, reason: meta.reason };
    const failed = reasonOf(
      await ctx.target.tryPutDomainConfig(ctx.actor, e.key, e.value, meta, await itemIdem(ctx, 'config', e.key, 'config.put_domain', payload)),
    );
    if (failed) acc.skip(e.key, e.key, failed);
    else acc.add();
  }
}
