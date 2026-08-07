-- PropertyDO front-desk list indexes — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- Additive indexes only: departure_date + partial in-house (checked_in).

CREATE INDEX reservation_departure_idx ON reservation (departure_date);

CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in';
