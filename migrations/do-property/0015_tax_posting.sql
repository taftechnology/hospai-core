-- PropertyDO tax_rule + charge_code.tax_group + folio_line tax columns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: tax_rule table → charge_code.tax_group → seed TAX output → folio_line columns → indexes.

CREATE TABLE tax_rule (
  tax_rule_id         TEXT PRIMARY KEY,
  rule_key            TEXT NOT NULL,
  name                TEXT NOT NULL,
  rule_type           TEXT NOT NULL
    CHECK (rule_type IN ('PERCENTAGE', 'PER_PERSON_PER_NIGHT', 'FLAT')),
  rate                TEXT NOT NULL,
  tax_group           TEXT NOT NULL,
  output_charge_code  TEXT NOT NULL
    REFERENCES charge_code(code),
  valid_from          TEXT NOT NULL,
  valid_to            TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

ALTER TABLE charge_code ADD COLUMN tax_group TEXT;

INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('TAX', 'Tax', 'active', 0, 0);

UPDATE charge_code SET tax_group = 'ROOM' WHERE code = 'ROOM';

UPDATE charge_code SET tax_group = 'GOODS' WHERE code = 'MISC';

ALTER TABLE folio_line ADD COLUMN tax_of TEXT REFERENCES folio_line(folio_line_id);

ALTER TABLE folio_line ADD COLUMN tax_rule_id TEXT;

CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX';

CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL;
