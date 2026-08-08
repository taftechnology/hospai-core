import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { noInlineStylesInWebPms } from './no-inline-styles-in-web-pms.js';

type Report = { messageId: string };

function lint(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  });
  const reports: Report[] = [];
  const handlers = noInlineStylesInWebPms.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId });
    },
  });
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string };
    if (n.type === 'JSXAttribute' && handlers.JSXAttribute) {
      handlers.JSXAttribute(n as never);
    }
    for (const v of Object.values(node as object)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(ast);
  return reports;
}

const webPms = '/repo/apps/web-pms/src/screens/Board.tsx';

describe('no-inline-styles-in-web-pms', () => {
  it('flags layout inline styles in web-pms tsx', () => {
    expect(
      lint(`export function Board() { return <div style={{ margin: 0 }} />; }`, webPms),
    ).toEqual([expect.objectContaining({ messageId: 'forbidden' })]);
  });

  it('allows CSS custom property inline styles', () => {
    expect(
      lint(
        `export function Board() { return <div style={{ ['--gap']: '1rem' }} />; }`,
        webPms,
      ),
    ).toEqual([]);
    expect(
      lint(
        `export function Board() { return <div style={{ ['--x' as string]: '1rem' }} />; }`,
        webPms,
      ),
    ).toEqual([]);
  });

  it('ignores files outside web-pms tsx', () => {
    expect(
      lint(
        `export function X() { return <div style={{ margin: 0 }} />; }`,
        '/repo/packages/client-core/src/x.tsx',
      ),
    ).toEqual([]);
    expect(
      lint(`const style = { margin: 0 };`, '/repo/apps/web-pms/src/client.ts'),
    ).toEqual([]);
  });
});
