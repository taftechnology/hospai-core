import type { FeatureKey } from './entitlements.js';

/** Queue consumer. Runs in the Worker after commit. Not `subscribes` (in-transaction). */
export type ModuleConsumerDecl = {
  /** `${moduleId}.${name}`, snake_case after the dot. Unique across the registry. */
  consumer: string;
  /** Operator-facing name shown on the workbench. */
  label: string;
  /** Event types. Each must be published by a module or listed in COMMAND_CATALOG events[]. */
  events: string[];
  /** Export name in the module's src/index.ts. */
  handler: string;
  /** Defaults to the manifest's `entitlement`. Must be a FEATURE_KEYS key, or null with gateExempt. */
  entitlement?: FeatureKey | null;
  /** Required when entitlement is null. The only reason allowed today. */
  gateExempt?: 'legal_duty';
};

export type ModuleManifest = {
  id: string;
  version: string;
  entitlement: string;
  requires?: string[];
  schema: { prefix?: string | null; tables: string[] };
  writes: string[];
  publishes?: string[];
  subscribes?: Array<{ event: string; handler: string }>;
  /** Async queue consumers. Distinct from in-transaction `subscribes`. */
  consumes?: ModuleConsumerDecl[];
  permissions?: string[];
  meters?: string[];
  lifecycle?: {
    onActivate?: string;
    onDeactivate?: string;
    onPurge?: string;
  };
};
