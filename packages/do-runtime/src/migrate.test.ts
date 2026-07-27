import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FREEZE_GATE_SQL, ORG_MIGRATIONS, ORG_SPINE_SQL, freeAvailability, migrateSql, PROPERTY_MIGRATIONS, type SqlStorageLike } from './index.js';

class MemorySql implements SqlStorageLike {
  schemaVersion: Array<{ version: number; name: string; applied_at: number }> = [];
  tables = new Set<string>();
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
    if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE UNIQUE INDEX') || q.startsWith('CREATE INDEX')) {
      this.tables.add(q.slice(0, 80));
      return { toArray: () => [] };
    }
    throw new Error(`Unhandled SQL in MemorySql: ${q}`);
  }
}

describe('migrateSql', () => {
  it('applies freeze gate once via statements', () => {
    const sql = new MemorySql();
    const v1 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v1).toBe(1);
    const v2 = migrateSql(sql, [...PROPERTY_MIGRATIONS]);
    expect(v2).toBe(1);
    expect(sql.schemaVersion).toHaveLength(1);
    expect(sql.tables.size).toBeGreaterThanOrEqual(8);
  });
});

describe('freeze DDL single source', () => {
  it('migrations/do-property/0001_freeze_gate.sql matches FREEZE_GATE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0001_freeze_gate.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(FREEZE_GATE_SQL.trim());
  });

  it('migrations/do-org/0001_org_spine.sql matches ORG_SPINE_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-org/0001_org_spine.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(ORG_SPINE_SQL.trim());
  });

  it('applies org spine migrations', () => {
    const sql = new MemorySql();
    expect(migrateSql(sql, [...ORG_MIGRATIONS])).toBe(1);
    expect(sql.tables.size).toBeGreaterThanOrEqual(2);
  });
});

describe('freeAvailability', () => {
  it('matches ledger formula', () => {
    expect(freeAvailability({ physical: 10, blocked: 1, held: 0, sold: 3, oversell: 1 })).toBe(7);
  });
});
