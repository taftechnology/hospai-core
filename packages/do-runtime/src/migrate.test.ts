import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS, migrateSql, type SqlStorageLike } from './index.js';

class MemorySql implements SqlStorageLike {
  tables = new Map<string, unknown[]>();
  schemaVersion: Array<{ version: number; name: string; applied_at: number }> = [];
  availability: unknown[] = [];
  exec(query: string, ...bindings: unknown[]) {
    const q = query.replace(/\s+/g, ' ').trim();
    if (q.startsWith('CREATE TABLE IF NOT EXISTS schema_version')) {
      return { toArray: () => [] };
    }
    if (q.startsWith('SELECT COALESCE(MAX(version)')) {
      const max = this.schemaVersion.reduce((m, r) => Math.max(m, r.version), 0);
      return { toArray: () => [{ v: max }] };
    }
    if (q.startsWith('INSERT INTO schema_version')) {
      this.schemaVersion.push({
        version: bindings[0] as number,
        name: bindings[1] as string,
        applied_at: bindings[2] as number,
      });
      return { toArray: () => [] };
    }
    // Accept CREATE TABLE / INDEX statements as no-ops for unit test
    if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE UNIQUE INDEX')) {
      return { toArray: () => [] };
    }
    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

describe('migrateSql', () => {
  it('applies freeze gate once', () => {
    const sql = new MemorySql();
    const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v1).toBe(1);
    const v2 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v2).toBe(1);
    expect(sql.schemaVersion).toHaveLength(1);
  });
});
