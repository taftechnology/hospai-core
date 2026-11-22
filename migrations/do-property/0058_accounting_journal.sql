-- PropertyDO accounting journal snapshots (R4.12 Part A) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE night_audit_journal_line (
  business_date TEXT NOT NULL,
  account_key   TEXT NOT NULL,
  debit_minor   INTEGER NOT NULL CHECK (debit_minor >= 0),
  credit_minor  INTEGER NOT NULL CHECK (credit_minor >= 0),
  CHECK (debit_minor = 0 OR credit_minor = 0),
  PRIMARY KEY (business_date, account_key)
);

CREATE TABLE night_audit_journal_day (
  business_date         TEXT PRIMARY KEY,
  currency              TEXT NOT NULL,
  advance_closing_minor INTEGER NOT NULL,
  balanced              INTEGER NOT NULL CHECK (balanced IN (0, 1)),
  recorded_at           INTEGER NOT NULL
);
