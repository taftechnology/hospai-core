/** OrgDO spine DDL — membership stub + property registry mirror (not routing SoR). */

export const ORG_SPINE_STATEMENTS: string[] = [
  `CREATE TABLE member (
  user_id     TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (role IN ('owner', 'admin', 'staff'))
)`,

  `CREATE TABLE property_ref (
  property_id   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
)`,
];

export const ORG_SPINE_SQL = ORG_SPINE_STATEMENTS.join(';\n\n') + ';\n';

export const ORG_MIGRATIONS = [
  {
    version: 1,
    name: '0001_org_spine',
    statements: ORG_SPINE_STATEMENTS,
  },
] as const;
