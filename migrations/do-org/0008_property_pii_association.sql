-- OrgDO guest/roster property PII association — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE guest_property (
  guest_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guest_id, property_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
);

CREATE INDEX guest_property_by_property
  ON guest_property (property_id, guest_id);

CREATE TABLE roster_property (
  staff_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (staff_id, property_id),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);

CREATE INDEX roster_property_by_property
  ON roster_property (property_id, staff_id);
