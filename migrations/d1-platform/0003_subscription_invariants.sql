-- Platform D1 subscription invariants (§6.3) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- entitlement_version is monotonic per org; rows are never deleted.

CREATE TRIGGER IF NOT EXISTS subscription_no_delete
BEFORE DELETE ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription rows are retained; update status instead');
END;

CREATE TRIGGER IF NOT EXISTS subscription_entitlement_version_never_decreases
BEFORE UPDATE OF entitlement_version ON subscription
WHEN NEW.entitlement_version < OLD.entitlement_version
BEGIN
  SELECT RAISE(ABORT, 'entitlement_version is monotonic per org');
END;

CREATE TRIGGER IF NOT EXISTS subscription_entitlement_version_bump_on_change
BEFORE UPDATE ON subscription
WHEN (NEW.plan_code IS NOT OLD.plan_code OR NEW.status IS NOT OLD.status)
  AND NEW.entitlement_version <= OLD.entitlement_version
BEGIN
  SELECT RAISE(ABORT, 'entitlement_version must increase when plan or status changes');
END;
