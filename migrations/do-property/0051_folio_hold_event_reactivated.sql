-- PropertyDO folio_hold_event reactivated kind — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

CREATE TABLE folio_hold_event_v51 (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed','reactivated')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);

INSERT INTO folio_hold_event_v51 (
     event_id, hold_id, kind, reason, before_json, after_json, actor, at)
   SELECT event_id, hold_id, kind, reason, before_json, after_json, actor, at
   FROM folio_hold_event;

DROP TABLE folio_hold_event;

ALTER TABLE folio_hold_event_v51 RENAME TO folio_hold_event;
