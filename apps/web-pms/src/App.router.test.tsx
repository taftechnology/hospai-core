/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { router } from './App.js';

describe('App router', () => {
  it('createRoutesFromElements registers routes without a Routes wrapper', () => {
    expect(router.routes.length).toBeGreaterThan(0);
  });
});

describe('App router fallbacks', () => {
  it('matches unknown paths inside the shell to the not-found page', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    expect(shell?.errorElement).toBeTruthy();
    expect(shell?.children?.some((c) => c.path === '*')).toBe(true);
  });
});
