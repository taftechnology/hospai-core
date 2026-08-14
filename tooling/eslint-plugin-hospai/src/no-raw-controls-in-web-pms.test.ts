import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { noRawControlsInWebPms } from './no-raw-controls-in-web-pms.js';

type Report = { messageId: string; data?: Record<string, string> };

function lint(code: string, filename: string): Report[] {
  const ast = tsParser.parse(code, {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  });
  const reports: Report[] = [];
  const handlers = noRawControlsInWebPms.create({
    filename,
    report(r) {
      reports.push({ messageId: r.messageId, data: r.data });
    },
  });
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string };
    if (n.type === 'JSXOpeningElement' && handlers.JSXOpeningElement) {
      handlers.JSXOpeningElement(n as never);
    }
    for (const v of Object.values(node as object)) {
      if (Array.isArray(v)) v.forEach(visit);
      else visit(v);
    }
  };
  visit(ast);
  return reports;
}

const webPms = '/repo/apps/web-pms/src/screens/BoardScreen.tsx';
const uiKit = '/repo/packages/ui-kit/src/Button.tsx';
const moduleUi = '/repo/modules/pms/housekeeping/src/ui/HousekeepingApp.tsx';

describe('no-raw-controls-in-web-pms', () => {
  it('reports on a raw button in web-pms screens', () => {
    expect(
      lint(`export function Board() { return <button type="button">Save</button>; }`, webPms),
    ).toEqual([
      expect.objectContaining({
        messageId: 'forbidden',
        data: expect.objectContaining({ tag: 'button' }),
      }),
    ]);
  });

  it('does not report inside packages/ui-kit', () => {
    expect(
      lint(`export function X() { return <button type="button">Save</button>; }`, uiKit),
    ).toEqual([]);
  });

  it('reports in modules/pms/housekeeping/src/ui', () => {
    expect(
      lint(`export function X() { return <input aria-label="x" />; }`, moduleUi),
    ).toEqual([
      expect.objectContaining({
        messageId: 'forbidden',
        data: expect.objectContaining({ tag: 'input' }),
      }),
    ]);
  });

  it('allows option inside NativeSelect', () => {
    expect(
      lint(
        `export function X() { return <select><option value="a">A</option></select>; }`,
        webPms,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      lint(`export function X() { return <form><option value="a">A</option></form>; }`, webPms),
    ).toEqual([]);
  });
});
