import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { noDomInClientCore } from './no-dom-in-client-core.js';

type Report = { messageId: string; data?: Record<string, string> };

function lint(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
  const reports: Report[] = [];
  const handlers = noDomInClientCore.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId, data: r.data });
    },
  });
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; name?: string };
    if (n.type === 'Identifier' && handlers.Identifier) {
      handlers.Identifier(n as never);
    }
    for (const v of Object.values(node as object)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(ast);
  return reports;
}

describe('no-dom-in-client-core', () => {
  it('flags window in client-core', () => {
    expect(lint(`export const x = window.localStorage;`, '/repo/packages/client-core/src/x.ts')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageId: 'forbidden', data: { name: 'window' } }),
        expect.objectContaining({ messageId: 'forbidden', data: { name: 'localStorage' } }),
      ]),
    );
  });

  it('ignores the same code outside client-core', () => {
    expect(lint(`export const x = window.localStorage;`, '/repo/apps/web-pms/src/x.ts')).toEqual([]);
  });
});
