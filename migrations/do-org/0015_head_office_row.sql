-- OrgDO head-office projection (R7.4) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE head_office_row (
  property_id TEXT PRIMARY KEY,
  property_name TEXT NOT NULL,
  business_date TEXT NOT NULL,
  audit_state TEXT NOT NULL CHECK (audit_state IN ('idle', 'running', 'halted')),
  audit_failed_step TEXT,
  last_completed_date TEXT,
  last_completed_at INTEGER,
  closed_date TEXT,
  currency TEXT,
  room_revenue_minor INTEGER,
  rooms_sold INTEGER,
  rooms_sellable INTEGER,
  arrivals INTEGER NOT NULL,
  departures_due INTEGER NOT NULL,
  in_house INTEGER NOT NULL,
  state_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
