-- PropertyDO derived rate plans — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ADD parent_rate_plan_id → ADD derive_bps CHECK → partial index on active parent.

ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT;

ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000));

CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = 'active';
