-- PropertyDO configurable tax engine — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE tax_rule ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE tax_rule ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tax_rule ADD COLUMN base TEXT NOT NULL DEFAULT 'NET';

ALTER TABLE tax_rule ADD COLUMN condition_key TEXT;

ALTER TABLE tax_rule ADD COLUMN condition_value TEXT;

ALTER TABLE tax_rule ADD COLUMN rebands_on_discount INTEGER NOT NULL DEFAULT 1;

CREATE TABLE tax_rule_band (
  tax_rule_id TEXT NOT NULL REFERENCES tax_rule(tax_rule_id),
  band_no     INTEGER NOT NULL,
  up_to_minor INTEGER,
  PRIMARY KEY (tax_rule_id, band_no)
);

CREATE TABLE tax_rule_component (
  tax_rule_id        TEXT NOT NULL,
  band_no            INTEGER NOT NULL,
  component_no       INTEGER NOT NULL,
  output_charge_code TEXT NOT NULL,
  rate               TEXT NOT NULL,
  PRIMARY KEY (tax_rule_id, band_no, component_no),
  FOREIGN KEY (tax_rule_id, band_no) REFERENCES tax_rule_band(tax_rule_id, band_no)
);

INSERT INTO tax_rule_band (tax_rule_id, band_no, up_to_minor)
SELECT tax_rule_id, 1, NULL FROM tax_rule;

INSERT INTO tax_rule_component (tax_rule_id, band_no, component_no, output_charge_code, rate)
SELECT tax_rule_id, 1, 1, output_charge_code, rate FROM tax_rule;

ALTER TABLE folio_line ADD COLUMN tax_component TEXT NOT NULL DEFAULT '';

DROP INDEX folio_line_tax_uniq;

CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id, tax_component) WHERE source = 'TAX';

CREATE TABLE tax_declaration (
  declaration_id  TEXT PRIMARY KEY,
  declaration_key TEXT NOT NULL,
  value           TEXT NOT NULL,
  valid_from      TEXT NOT NULL,
  valid_to        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX tax_declaration_key_idx ON tax_declaration (declaration_key, valid_from);
