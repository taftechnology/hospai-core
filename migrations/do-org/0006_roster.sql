-- OrgDO staff roster + kinds + freeze triggers — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE roster (
  staff_id        TEXT PRIMARY KEY,
  pii_key_id      TEXT NOT NULL,
  profile_cipher  BLOB NOT NULL,
  profile_iv      BLOB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  exited_at       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
);

CREATE TABLE roster_kind (
  staff_id TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('housekeeper')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);

CREATE TRIGGER roster_insert
BEFORE INSERT ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster insert must be active and not exited')
  WHERE NEW.status != 'active' OR NEW.exited_at IS NOT NULL;
END;

CREATE TRIGGER roster_update
BEFORE UPDATE ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster cannot be active and exited')
  WHERE NEW.status = 'active' AND NEW.exited_at IS NOT NULL;
  SELECT RAISE(ABORT, 'roster exited is terminal')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.exited_at IS NOT OLD.exited_at OR NEW.status IS NOT 'inactive'
  );
  SELECT RAISE(ABORT, 'roster cipher frozen after exit')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.profile_cipher IS NOT OLD.profile_cipher
    OR NEW.profile_iv IS NOT OLD.profile_iv
  );
  SELECT RAISE(ABORT, 'roster exit requires inactive')
  WHERE OLD.exited_at IS NULL AND NEW.exited_at IS NOT NULL AND NEW.status IS NOT 'inactive';
END;

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
