-- PropertyDO folio routing rules — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: CREATE folio_routing_rule → partial unique index on active charge_code.

CREATE TABLE folio_routing_rule (
  rule_id           TEXT PRIMARY KEY,
  charge_code       TEXT NOT NULL REFERENCES charge_code(code),
  dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX folio_routing_rule_active_code_uniq
  ON folio_routing_rule (charge_code)
  WHERE status = 'active';
