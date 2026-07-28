import { ORG_ENTITLEMENT_MIGRATIONS } from './entitlement-migrations.js';
import { ORG_MIGRATIONS } from './org-migrations.js';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

export const PROPERTY_SCHEMA_HEAD = Math.max(...PROPERTY_MIGRATIONS.map((m) => m.version));
export const ORG_SCHEMA_HEAD = Math.max(...ORG_MIGRATIONS.map((m) => m.version));
export const ORG_ENTITLEMENT_SCHEMA_HEAD = Math.max(...ORG_ENTITLEMENT_MIGRATIONS.map((m) => m.version));
