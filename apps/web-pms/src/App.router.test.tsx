/** @vitest-environment jsdom */
import { isValidElement } from 'react';
import { Navigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { router } from './App.js';
import { HomeRedirect } from './auth/HomeRedirect.js';

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

describe('App router reports', () => {
  it('redirects /reports to the Dashboard until the operational report set ships', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    const reports = shell?.children?.find((c) => c.path === 'reports');
    const element = reports?.element;
    expect(isValidElement(element) && element.type === Navigate).toBe(true);
    expect(isValidElement(element) ? element.props : null).toEqual({ to: '/dashboard', replace: true });
  });
});

describe('App router home', () => {
  it('the index route is the permission-aware home (R2.6), not a fixed redirect', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    const index = shell?.children?.find((c) => c.index === true);
    expect(isValidElement(index?.element) && index?.element.type === HomeRedirect).toBe(true);
  });
});
