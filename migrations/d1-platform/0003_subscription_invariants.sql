-- Platform D1 subscription invariants (§6.3) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/platform-migrations.ts
-- Regenerate: pnpm generate:ddl
-- entitlement_version is monotonic per org; rows are never deleted.

CREATE TRIGGER IF NOT EXISTS subscription_no_delete
BEFORE DELETE ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription rows are retained; update status instead');
END;

CREATE TRIGGER IF NOT EXISTS subscription_insert_invariants
BEFORE INSERT ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription status must be active or cancelled')
  WHERE NEW.status NOT IN ('active', 'cancelled');
  SELECT RAISE(ABORT, 'entitlement_version must be >= 1')
  WHERE NEW.entitlement_version < 1;
END;

CREATE TRIGGER IF NOT EXISTS subscription_update_invariants
BEFORE UPDATE ON subscription
BEGIN
  SELECT RAISE(ABORT, 'subscription status must be active or cancelled')
  WHERE NEW.status NOT IN ('active', 'cancelled');
  SELECT RAISE(ABORT, 'entitlement_version must be >= 1')
  WHERE NEW.entitlement_version < 1;
  SELECT RAISE(ABORT, 'entitlement_version is monotonic per org')
  WHERE NEW.entitlement_version < OLD.entitlement_version;
  SELECT RAISE(ABORT, 'entitlement_version must increase when plan or status changes')
  WHERE (NEW.plan_code IS NOT OLD.plan_code OR NEW.status IS NOT OLD.status)
    AND NEW.entitlement_version <= OLD.entitlement_version;
END;
