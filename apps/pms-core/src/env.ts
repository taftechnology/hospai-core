import type { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';

export type PmsEnv = {
  PROPERTY_DO: DurableObjectNamespace<PropertyDO>;
  ORG_DO: DurableObjectNamespace<OrgDO>;
  PLATFORM_DB: D1Database;
  /** `simulate` = local workerd lacks DO jurisdiction; never set in production. */
  HOSPAI_JURISDICTION_MODE?: string;
};
