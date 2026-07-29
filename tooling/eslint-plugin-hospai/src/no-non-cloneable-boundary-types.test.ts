import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { boundarySurface, noNonCloneableBoundaryTypes } from './no-non-cloneable-boundary-types.js';

const moduleFile = '/repo/modules/pms/inventory/src/index.ts';
const doFile = '/repo/apps/pms-core/src/property-do.ts';

type Report = { messageId: string; data?: Record<string, string> };

function lintTypes(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
  const reports: Report[] = [];
  const handlers = noNonCloneableBoundaryTypes.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId, data: r.data });
    },
    getSourceCode() {
      return { ast };
    },
  });
  for (const stmt of ast.body as Array<{ type: string; declaration?: { type?: string; body?: { body?: unknown[] } } }>) {
    if (stmt.type === 'ExportNamedDeclaration' && handlers.ExportNamedDeclaration) {
      handlers.ExportNamedDeclaration(stmt);
      const decl = stmt.declaration;
      if (decl?.type === 'ClassDeclaration' && handlers.MethodDefinition) {
        for (const member of decl.body?.body ?? []) {
          const m = member as { type?: string };
          if (m.type === 'MethodDefinition') handlers.MethodDefinition(member as never);
        }
      }
    }
    if (stmt.type === 'ClassDeclaration' && handlers.MethodDefinition) {
      for (const member of (stmt as { body?: { body?: unknown[] } }).body?.body ?? []) {
        const m = member as { type?: string };
        if (m.type === 'MethodDefinition') handlers.MethodDefinition(member as never);
      }
    }
  }
  return reports;
}

describe('boundarySurface', () => {
  it('matches module barrels and DO RPC files', () => {
    expect(boundarySurface('/repo/modules/pms/inventory/src/index.ts')).toBe('module export');
    expect(boundarySurface('/repo/apps/pms-core/src/property-do.ts')).toBe('DO RPC signature');
    expect(boundarySurface('/repo/apps/pms-core/src/auth.ts')).toBeNull();
  });
});

describe('no-non-cloneable-boundary-types', () => {
  it('allows bare re-exports and plain alias types on module surface', () => {
    expect(
      lintTypes(`export type { OutboxRow } from '@hospai/do-runtime';`, moduleFile),
    ).toEqual([]);
    expect(lintTypes(`export type Row = { code: string; idem: IdempotencyKey };`, moduleFile)).toEqual(
      [],
    );
  });

  it('flags hard failures and denylisted classes on module surface', () => {
    expect(lintTypes(`export type Cache = { m: WeakMap<string, string> };`, moduleFile)).toEqual([
      expect.objectContaining({ messageId: 'hardNonCloneable', data: expect.objectContaining({ typeName: 'WeakMap' }) }),
    ]);
    expect(
      lintTypes(
        `import type { PiiVault } from '@hospai/crypto-shredding';\nexport type GuestStore = { vault: PiiVault };`,
        moduleFile,
      ),
    ).toEqual([
      expect.objectContaining({ messageId: 'classType', data: expect.objectContaining({ typeName: 'PiiVault' }) }),
    ]);
    expect(lintTypes(`export type Handler = () => void;`, moduleFile)).toEqual([
      expect.objectContaining({ messageId: 'hardNonCloneable' }),
    ]);
  });

  it('allows DO RPC callbacks and Date; flags WeakMap and denylisted classes', () => {
    const code = `
      export class PropertyDO {
        async flushOutbox(deliver?: (batch: OutboxRow[]) => Promise<void>): Promise<void> {}
        async ensureNightAuditSchedule(timeZone: string, instant: Date): Promise<void> {}
        private async helper(x: WeakMap<string, string>): Promise<void> {}
        async resetLaneGuardForTest(): Promise<void> {}
      }
    `;
    expect(lintTypes(code, doFile)).toEqual([]);

    expect(
      lintTypes(
        `export class PropertyDO { async bad(x: WeakMap<string, string>): Promise<void> {} }`,
        doFile,
      ),
    ).toEqual([
      expect.objectContaining({ messageId: 'hardNonCloneable', data: expect.objectContaining({ typeName: 'WeakMap' }) }),
    ]);

    expect(
      lintTypes(`export class PropertyDO { async bad(vault: PiiVault): Promise<void> {} }`, doFile),
    ).toEqual([
      expect.objectContaining({ messageId: 'classType', data: expect.objectContaining({ typeName: 'PiiVault' }) }),
    ]);
  });
});
