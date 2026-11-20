-- PropertyDO open folio (bill on hold) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE folio_hold (
  hold_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  folio_window_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CLOSED')),
  reason TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT NOT NULL,
  close_by_date TEXT NOT NULL,
  expected_settlement TEXT,
  approved_by TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_reason TEXT
);

CREATE UNIQUE INDEX folio_hold_one_active ON folio_hold (folio_window_id) WHERE status = 'ACTIVE';

CREATE TABLE folio_hold_event (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
