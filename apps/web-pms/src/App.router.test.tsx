/** @vitest-environment jsdom */
import { isValidElement } from 'react';
import { Navigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { router } from './App.js';
import { HomeRedirect } from './auth/HomeRedirect.js';
import { ReportRunnerGate } from './reports/ReportRunnerGate.js';
import { ReportRunnerScreen } from './screens/ReportRunnerScreen.js';
import { ReportsCatalogScreen } from './screens/ReportsCatalogScreen.js';

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
  it('/reports is the report catalogue, not a redirect to the Dashboard (R4.14)', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    const reports = shell?.children?.find((c) => c.path === 'reports');
    const element = reports?.element;
    expect(isValidElement(element) && element.type === Navigate).toBe(false);
    expect(isValidElement(element) && element.type === ReportsCatalogScreen).toBe(true);
  });

  it('/reports/:reportId runs a report behind the group permission gate', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    const run = shell?.children?.find((c) => c.path === 'reports/:reportId');
    expect(isValidElement(run?.element) && run?.element.type === ReportRunnerGate).toBe(true);
    const index = run?.children?.find((c) => c.index === true);
    expect(isValidElement(index?.element) && index?.element.type === ReportRunnerScreen).toBe(true);
  });
});

describe('App router home', () => {
  it('the index route is the permission-aware home (R2.6), not a fixed redirect', () => {
    const shell = router.routes.find((r) => r.children?.some((c) => c.path === 'dashboard'));
    const index = shell?.children?.find((c) => c.index === true);
    expect(isValidElement(index?.element) && index?.element.type === HomeRedirect).toBe(true);
  });
});
