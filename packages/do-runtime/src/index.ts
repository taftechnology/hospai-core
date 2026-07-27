export type SqlStorageLike = {
  exec(query: string, ...bindings: unknown[]): {
    toArray(): unknown[];
  };
};

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

/**
 * Apply pending SQL migrations. Version check is cheap — runs on every DO wake.
 * Statements are split on semicolons; empty chunks skipped.
 */
export function migrateSql(sql: SqlStorageLike, migrations: Migration[]): number {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = sql.exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`).toArray() as Array<{
    v: number;
  }>;
  let current = Number(rows[0]?.v ?? 0);

  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    for (const stmt of m.sql.split(';')) {
      const trimmed = stmt.trim();
      if (trimmed.length === 0) continue;
      sql.exec(trimmed);
    }
    sql.exec(`INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)`, m.version, m.name, Date.now());
    current = m.version;
  }
  return current;
}

export function freeAvailability(row: {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
}): number {
  return row.physical - row.blocked - row.held - row.sold + row.oversell;
}

export { PROPERTY_MIGRATIONS, FREEZE_GATE_SQL } from './property-migrations.js';
