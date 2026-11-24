import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AppRoutes, makeQueryClient } from '../App.js';

export type Call = { method: string; path: string; body: Record<string, unknown> | null };

export type Responder = (call: Call) => { status?: number; body: unknown } | undefined;

/** A fetch double: records every /api call and answers from `respond`, then from defaults. */
export function installFetch(role: 'ops_admin' | 'ops_viewer', respond: Responder = () => undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^\/api/, '');
    const call: Call = {
      method: init?.method ?? 'GET',
      path,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    calls.push(call);
    const custom = respond(call);
    const answer =
      custom ??
      (path === '/me'
        ? { body: { ok: true, operator: { operatorId: 'op_me', displayName: 'Test Operator', role } } }
        : call.method === 'POST'
          ? { body: { ok: true, actionId: 'act_1', replayed: false } }
          : { status: 404, body: { error: 'not_found' } });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderAt(path: string, client: QueryClient = makeQueryClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

export const customerRow = (n: number) => ({
  orgId: `org_${n}`,
  name: `Customer ${n}`,
  status: 'active',
  planCode: 'starter',
  addons: [{ addonCode: 'pos', quantity: 1 }],
  propertiesUsed: n,
  propertiesLimit: 5,
  createdAt: Date.UTC(2026, 10, 1, 9, 30),
});

export const customerDetail = (status = 'active') => ({
  ok: true,
  org: { orgId: 'org_a', name: 'Group A', status, createdAt: Date.UTC(2026, 10, 1) },
  subscription: { planCode: 'starter', status: 'active', entitlementVersion: 3 },
  addons: [],
  propertiesUsed: 1,
  propertiesLimit: 1,
  properties: [
    { propertyId: 'prop_a', name: 'Hotel A', timeZone: 'Asia/Kolkata', jurisdiction: null, status: 'active' },
  ],
  owners: [{ userId: 'user_1', role: 'owner' }],
  actions: [],
});
