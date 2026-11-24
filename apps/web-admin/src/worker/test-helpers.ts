import { vi } from 'vitest';
import type { AdminEnv, PmsOpsBinding } from './env.js';

export const OPERATOR = {
  operatorId: 'op_1',
  email: 'ops@example.test',
  displayName: 'Ops One',
  role: 'ops_admin' as const,
  status: 'active' as const,
};

export function fakePms(overrides: Partial<Record<keyof PmsOpsBinding, unknown>> = {}) {
  const ok = vi.fn(async () => ({ ok: true, actionId: 'act_1', replayed: false }));
  const pms = {
    resolveOperator: vi.fn(async () => ({ ok: true, operator: OPERATOR, via: 'clerk_user_id' })),
    listCustomers: vi.fn(async () => ({ ok: true, page: 1, hasMore: false, customers: [] })),
    getCustomer: vi.fn(async () => ({ ok: false, error: 'not_found', status: 404 })),
    getPropertyHealth: vi.fn(async () => ({ ok: false, error: 'not_found', status: 404 })),
    listOperatorActions: vi.fn(async () => ({ ok: true, page: 1, hasMore: false, actions: [] })),
    listOperators: vi.fn(async () => ({ ok: true, operators: [OPERATOR] })),
    createOrg: ok,
    addProperty: ok,
    addOrgOwner: ok,
    setPlan: ok,
    setAddon: ok,
    suspendOrg: ok,
    reinstateOrg: ok,
    addOperator: ok,
    setOperatorStatus: ok,
    setOperatorRole: ok,
    copySetup: vi.fn(async () => ({ ok: true, actionId: 'opa_copy_1', copyId: 'opa_copy_1', replayed: false })),
    getCopyStatus: vi.fn(async () => ({ ok: false, error: 'not_found', status: 404 })),
    ...overrides,
  };
  return pms as unknown as PmsOpsBinding & { [K in keyof typeof pms]: (typeof pms)[K] };
}

export function makeEnv(overrides: Partial<AdminEnv> = {}): AdminEnv {
  return {
    PMS_OPS: fakePms(),
    ASSETS: {
      fetch: async () => new Response('<!doctype html><title>HospAI Ops Console</title>', { headers: { 'content-type': 'text/html' } }),
    },
    CLERK_SECRET_KEY: 'sk_test_x',
    CLERK_PUBLISHABLE_KEY: 'pk_test_Y2FyaW5nLWRyYWtlLTgzMTcuY2xlcmsuYWNjb3VudHMuZGV2JA',
    CLERK_AUTHORIZED_PARTIES: 'https://ops.example.test',
    ...overrides,
  };
}
