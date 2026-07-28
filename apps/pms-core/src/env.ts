import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';

/** RPC payload for `NightAuditWorkflow` — registry-resolved `propertyId` only, never a raw DO id. */
export type NightAuditWorkflowParams = { propertyId: string };

export type PmsEnv = {
  PROPERTY_DO: DurableObjectNamespace<PropertyDO>;
  ORG_DO: DurableObjectNamespace<OrgDO>;
  NIGHT_AUDIT_WORKFLOW: Workflow<NightAuditWorkflowParams>;
  PLATFORM_DB: D1Database;
  /**
   * Must be `1` for any local-only unsafe flags (simulate jurisdiction, dev actor).
   * Set only via `.dev.vars` / vitest bindings — never top-level wrangler `vars`.
   */
  HOSPAI_UNSAFE_LOCAL?: string;
  /** Local workerd lacks DO jurisdiction; requires HOSPAI_UNSAFE_LOCAL=1. */
  HOSPAI_JURISDICTION_MODE?: string;
  /** Allow X-Dev-Actor header auth; requires HOSPAI_UNSAFE_LOCAL=1. Absent in production. */
  HOSPAI_ALLOW_DEV_ACTOR?: string;
  /** Vitest-only: pin ledger property-test PRNG seed (`vitest.config.ts` → miniflare.bindings). */
  LEDGER_PROP_SEED?: string;
};

/** True only when both the local marker and simulate mode are set. */
export function isJurisdictionSimulate(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_JURISDICTION_MODE === 'simulate';
}

/** True only when both the local marker and allow-dev-actor are set. */
export function isDevActorAllowed(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL === '1' && env.HOSPAI_ALLOW_DEV_ACTOR === '1';
}

/**
 * Refuse to serve if dangerous flags are set without the local marker.
 * Prevents a mis-deployed `simulate` / `ALLOW_DEV_ACTOR` from going live.
 */
export function assertEnvSafeForRequest(env: PmsEnv): Response | null {
  const unsafe = env.HOSPAI_UNSAFE_LOCAL === '1';
  if (env.HOSPAI_JURISDICTION_MODE === 'simulate' && !unsafe) {
    return Response.json(
      {
        error: 'misconfigured',
        message:
          'HOSPAI_JURISDICTION_MODE=simulate requires HOSPAI_UNSAFE_LOCAL=1 (local only). Refusing to serve.',
      },
      { status: 500 },
    );
  }
  if (env.HOSPAI_ALLOW_DEV_ACTOR === '1' && !unsafe) {
    return Response.json(
      {
        error: 'misconfigured',
        message:
          'HOSPAI_ALLOW_DEV_ACTOR=1 requires HOSPAI_UNSAFE_LOCAL=1 (local only). Refusing to serve.',
      },
      { status: 500 },
    );
  }
  return null;
}
