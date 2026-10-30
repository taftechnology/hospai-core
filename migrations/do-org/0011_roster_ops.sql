-- OrgDO roster kind rebuild + per-property ops (R1.9c) — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE roster_kind_v11 (
  staff_id TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('housekeeper', 'maintenance')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);

INSERT INTO roster_kind_v11 (staff_id, kind)
SELECT staff_id, kind FROM roster_kind;

DROP TABLE roster_kind;

ALTER TABLE roster_kind_v11 RENAME TO roster_kind;

CREATE TRIGGER roster_kind_insert
BEFORE INSERT ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL);
END;

CREATE TRIGGER roster_kind_update
BEFORE UPDATE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END;

CREATE TRIGGER roster_kind_delete
BEFORE DELETE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END;

ALTER TABLE roster_property ADD COLUMN shift TEXT CHECK (shift IN ('morning', 'evening', 'night', 'any'));

ALTER TABLE roster_property ADD COLUMN max_rooms INTEGER CHECK (max_rooms BETWEEN 1 AND 50);

ALTER TABLE roster_property ADD COLUMN ops_skills TEXT;
