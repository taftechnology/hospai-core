import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { noFetchInComponents } from './no-fetch-in-components.js';

type Report = { messageId: string };

function lint(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  });
  const reports: Report[] = [];
  const handlers = noFetchInComponents.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId });
    },
  });
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; callee?: unknown };
    if (n.type === 'CallExpression' && handlers.CallExpression) {
      handlers.CallExpression(n as never);
    }
    for (const v of Object.values(node as object)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(ast);
  return reports;
}

describe('no-fetch-in-components', () => {
  it('flags fetch in web-pms tsx', () => {
    expect(
      lint(`export function Board() { fetch('/v1'); return null; }`, '/repo/apps/web-pms/src/screens/Board.tsx'),
    ).toEqual([expect.objectContaining({ messageId: 'forbidden' })]);
  });

  it('allows fetch outside web-pms tsx', () => {
    expect(lint(`fetch('/v1');`, '/repo/packages/client-core/src/transport.ts')).toEqual([]);
    expect(lint(`fetch('/v1');`, '/repo/apps/web-pms/src/client.ts')).toEqual([]);
  });
});
