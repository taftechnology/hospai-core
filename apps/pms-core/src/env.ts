import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';
import { applySecurityHeaders } from './security-headers.js';

/** RPC payload for `NightAuditWorkflow` — registry-resolved `propertyId` only, never a raw DO id. */
export type NightAuditWorkflowParams = { propertyId: string };

/** RPC payload for `MigrationSweepWorkflow` — dev-actor userId for audit trail. */
export type MigrationSweepParams = { triggeredBy: string; pageLimit?: number };

/** RPC payload for `PurgeWorkflow` — caller-computed `workflowId` always. */
export type PurgeWorkflowParams =
  | {
      kind: 'guest';
      /** Caller-computed: `guestPurgeWorkflowId(guestRef)` — never derive from `event.id`. */
      workflowId: string;
      orgId: string;
      guestRef: string;
      piiKeyId: string;
      operatorUserId: string | null;
      started: number;
    }
  | {
      kind: 'org';
      /** Caller-computed: `nextOrgPurgeWorkflowId(env, orgId)`. */
      workflowId: string;
      orgId: string;
      operatorUserId: string;
      started: number;
      /** Injectable clocks — production omits. */
      nowMs?: number;
      retentionMs?: number;
    };

export type PmsEnv = {
  PROPERTY_DO: DurableObjectNamespace<PropertyDO>;
  ORG_DO: DurableObjectNamespace<OrgDO>;
  ORG_ENTITLEMENT_DO: DurableObjectNamespace;
  ENTITLEMENT_KV: KVNamespace;
  /** Domain event bus — outbox drain target. */
  EVENTS_QUEUE: Queue<import('@hospai/contracts').DomainEventMessage>;
  /** Tier-1 degraded mode — provisional command replay queue. */
  PENDING_COMMANDS_QUEUE: Queue<import('@hospai/contracts').PendingCommandMessage>;
  /** Advisory consumer dedupe — side-effect handlers must also use DO idempotency. */
  EVENT_DEDUPE_KV: KVNamespace;
  NIGHT_AUDIT_WORKFLOW: Workflow<NightAuditWorkflowParams>;
  MIGRATION_SWEEP_WORKFLOW: Workflow<MigrationSweepParams>;
  /** §4.8 cross-store purge — guest erase + org cancel/purge. */
  PURGE_WORKFLOW: Workflow<PurgeWorkflowParams>;
  PLATFORM_DB: D1Database;
  /** ARI projection — availability_day rows projected by the event consumer. */
  ARI_KV: KVNamespace;
  /** Durable event log — tenant-prefixed segments. Optional so skip can be derived. */
  EVENT_LOG_R2?: R2Bucket;
  /**
   * Must be `1` for any local-only unsafe flags (simulate jurisdiction, dev actor).
   * Set only via `.dev.vars` / vitest bindings — never top-level wrangler `vars`.
   */
  HOSPAI_UNSAFE_LOCAL?: string;
  /** Local workerd lacks DO jurisdiction; requires HOSPAI_UNSAFE_LOCAL=1. */
  HOSPAI_JURISDICTION_MODE?: string;
  /** Simulated PSP only; requires HOSPAI_UNSAFE_LOCAL=1. Absent in production. */
  HOSPAI_PSP_MODE?: string;
  /** Allow X-Dev-Actor header auth; requires HOSPAI_UNSAFE_LOCAL=1. Absent in production. */
  HOSPAI_ALLOW_DEV_ACTOR?: string;
  /** Clerk secret key — production auth. Never in top-level wrangler vars. */
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  /** PEM public key for networkless JWT verification on Workers. */
  CLERK_JWT_KEY?: string;
  /** Comma-separated azp allowlist for session tokens (SPA origins). */
  CLERK_AUTHORIZED_PARTIES?: string;
  /** Vitest-only: 64-char hex org master key for guest PII envelope encryption. */
  HOSPAI_ORG_MASTER_KEY?: string;
  /** Vitest-only: pin ledger property-test PRNG seed (`vitest.config.ts` → miniflare.bindings). */
  LEDGER_PROP_SEED?: string;
  /** Workers Assets binding for same-origin SPA (`apps/web-pms/dist`). */
  ASSETS?: Fetcher;
};

/** True only when both the local marker and simulate mode are set. */
export function isJurisdictionSimulate(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_JURISDICTION_MODE === 'simulate';
}

/** True only when both the local marker and PSP simulate mode are set. */
export function isPspSimulate(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_PSP_MODE === 'simulate';
}

/** True only when both the local marker and allow-dev-actor are set. */
export function isDevActorAllowed(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_ALLOW_DEV_ACTOR === '1';
}

/**
 * Refuse to serve if dangerous flags are set without the local marker.
 * Prevents a mis-deployed `simulate` / `ALLOW_DEV_ACTOR` from going live.
 */
export function assertEnvSafeForRequest(env: PmsEnv, request: Request): Response | null {
  const unsafe = env.HOSPAI_UNSAFE_LOCAL === '1';
  if (env.HOSPAI_JURISDICTION_MODE === 'simulate' && !unsafe) {
    return applySecurityHeaders(
      Response.json(
        {
          error: 'misconfigured',
          message:
            'HOSPAI_JURISDICTION_MODE=simulate requires HOSPAI_UNSAFE_LOCAL=1 (local only). Refusing to serve.',
        },
        { status: 500 },
      ),
      request,
    );
  }
  if (env.HOSPAI_PSP_MODE === 'simulate' && !unsafe) {
    return applySecurityHeaders(
      Response.json(
        {
          error: 'misconfigured',
          message:
            'HOSPAI_PSP_MODE=simulate requires HOSPAI_UNSAFE_LOCAL=1 (local only). Refusing to serve.',
        },
        { status: 500 },
      ),
      request,
    );
  }
  if (env.HOSPAI_ALLOW_DEV_ACTOR === '1' && !unsafe) {
    return applySecurityHeaders(
      Response.json(
        {
          error: 'misconfigured',
          message:
            'HOSPAI_ALLOW_DEV_ACTOR=1 requires HOSPAI_UNSAFE_LOCAL=1 (local only). Refusing to serve.',
        },
        { status: 500 },
      ),
      request,
    );
  }
  return null;
}
