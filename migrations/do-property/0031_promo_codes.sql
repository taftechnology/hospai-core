-- PropertyDO promo codes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE promo → partial unique index → reservation.promo_id.

CREATE TABLE promo (
  promo_id       TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived')),
  kind           TEXT NOT NULL
                 CHECK (kind IN ('percent', 'fixed_per_night')),
  bps            INTEGER,
  amount_minor   INTEGER,
  valid_from     TEXT,
  valid_to       TEXT,
  rate_plan_id   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (
    (kind = 'percent' AND bps IS NOT NULL AND bps >= 1 AND bps <= 10000
     AND amount_minor IS NULL)
    OR
    (kind = 'fixed_per_night' AND amount_minor IS NOT NULL AND amount_minor > 0
     AND bps IS NULL)
  ),
  CHECK (
    (valid_from IS NULL AND valid_to IS NULL)
    OR (valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_from <= valid_to)
  )
);

CREATE UNIQUE INDEX promo_code_active ON promo(code) WHERE status = 'active';

ALTER TABLE reservation ADD COLUMN promo_id TEXT;
