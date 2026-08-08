import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { noDomInClientCore } from './no-dom-in-client-core.js';

type Report = { messageId: string; data?: Record<string, string> };
type AstNode = {
  type?: string;
  name?: string;
  parent?: AstNode;
  key?: AstNode;
  property?: AstNode;
  computed?: boolean;
};

function lint(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, {
    ecmaVersion: 2022,
    sourceType: 'module',
  }) as AstNode;
  const reports: Report[] = [];
  const handlers = noDomInClientCore.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId, data: r.data });
    },
  });
  const visit = (node: unknown, parent: AstNode | undefined) => {
    if (!node || typeof node !== 'object') return;
    const n = node as AstNode;
    n.parent = parent;
    if (n.type === 'Identifier' && handlers.Identifier) {
      handlers.Identifier(n);
    }
    for (const [key, v] of Object.entries(node as object)) {
      if (key === 'parent') continue;
      if (Array.isArray(v)) v.forEach((child) => visit(child, n));
      else visit(v, n);
    }
  };
  visit(ast, undefined);
  return reports;
}

describe('no-dom-in-client-core', () => {
  it('flags window in client-core', () => {
    expect(lint(`export const x = window.localStorage;`, '/repo/packages/client-core/src/x.ts')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 'forbidden', data: { name: 'window' } }),
      ]),
    );
  });

  it('flags bare localStorage reference', () => {
    expect(lint(`export const x = localStorage;`, '/repo/packages/client-core/src/x.ts')).toEqual([
      expect.objectContaining({ messageId: 'forbidden', data: { name: 'localStorage' } }),
    ]);
  });

  it('ignores the same code outside client-core', () => {
    expect(lint(`export const x = window.localStorage;`, '/repo/apps/web-pms/src/x.ts')).toEqual([]);
  });

  it('allows window as a type property key (folio wire field)', () => {
    const code = `
      export type FolioRead = {
        window: { folioWindowId: string } | null;
        balanceMinor: number;
      };
    `;
    expect(lint(code, '/repo/packages/client-core/src/api.ts')).toEqual([]);
  });

  it('allows window as an object property key', () => {
    expect(
      lint(`export const x = { window: null };`, '/repo/packages/client-core/src/x.ts'),
    ).toEqual([]);
  });
});
