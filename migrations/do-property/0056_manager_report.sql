-- PropertyDO night-audit day statistics (Manager Report) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE night_audit_day_stats (
  business_date          TEXT PRIMARY KEY,
  currency               TEXT NOT NULL,
  physical               INTEGER NOT NULL CHECK (physical >= 0),
  blocked                INTEGER NOT NULL CHECK (blocked >= 0),
  sold                   INTEGER NOT NULL CHECK (sold >= 0),
  no_show_nights         INTEGER NOT NULL CHECK (no_show_nights >= 0),
  comp_nights            INTEGER NOT NULL DEFAULT 0 CHECK (comp_nights >= 0),
  arrivals               INTEGER NOT NULL CHECK (arrivals >= 0),
  departures             INTEGER NOT NULL CHECK (departures >= 0),
  no_shows               INTEGER NOT NULL CHECK (no_shows >= 0),
  cancellations          INTEGER NOT NULL CHECK (cancellations >= 0),
  in_house_adults        INTEGER NOT NULL CHECK (in_house_adults >= 0),
  in_house_children      INTEGER NOT NULL CHECK (in_house_children >= 0),
  room_revenue_minor     INTEGER NOT NULL,
  fnb_revenue_minor      INTEGER NOT NULL,
  other_revenue_minor    INTEGER NOT NULL,
  tax_minor              INTEGER NOT NULL,
  pay_card_minor         INTEGER NOT NULL,
  pay_cash_minor         INTEGER NOT NULL,
  pay_upi_minor          INTEGER NOT NULL,
  pay_other_minor        INTEGER NOT NULL,
  source_mix_json        TEXT NOT NULL DEFAULT '{}',
  recorded_at            INTEGER NOT NULL
);
