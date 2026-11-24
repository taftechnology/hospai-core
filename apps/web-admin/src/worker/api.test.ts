import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { __setAuthenticateRequestForTest } from './auth.js';
import { fakePms, makeEnv } from './test-helpers.js';

const ORIGIN = 'https://ops.example.test';

function signIn() {
  __setAuthenticateRequestForTest((async () => ({
    isAuthenticated: true,
    toAuth: () => ({ userId: 'user_ops', sessionClaims: { fva: [1, 1] } }),
  })) as never);
}
afterEach(() => __setAuthenticateRequestForTest(null));

const post = (path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('mutating /api requests', () => {
  it('refuse a request with no Origin, and one from another origin', async () => {
    signIn();
    const env = makeEnv();
    const body = { clientKey: 'k', reason: 'r' };
    const none = await worker.fetch(post('/api/customers/org_a/suspend', body, {}), env);
    const foreign = await worker.fetch(post('/api/customers/org_a/suspend', body, { origin: 'https://evil.example' }), env);
    expect(none.status).toBe(403);
    expect(foreign.status).toBe(403);
    expect(env.PMS_OPS.suspendOrg).not.toHaveBeenCalled();
    expect(env.PMS_OPS.resolveOperator).not.toHaveBeenCalled();
  });

  it('malformed JSON is 400 invalid_json, once, without a PMS write', async () => {
    signIn();
    const env = makeEnv();
    const res = await worker.fetch(post('/api/customers', '{nope'), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
    const arr = await worker.fetch(post('/api/customers', '[1]'), env);
    expect(arr.status).toBe(400);
    expect(env.PMS_OPS.createOrg).not.toHaveBeenCalled();
  });

  it('an oversized body is 413', async () => {
    signIn();
    const res = await worker.fetch(post('/api/customers', JSON.stringify({ reason: 'x'.repeat(20_000) })), makeEnv());
    expect(res.status).toBe(413);
  });

  it('forwards only known fields with the resolved operator id', async () => {
    signIn();
    const env = makeEnv();
    const res = await worker.fetch(
      post('/api/customers', {
        clientKey: 'ck1',
        reason: 'New group',
        ticketRef: 'T-1',
        orgId: 'org_new',
        name: 'Group',
        planCode: 'starter',
        operatorId: 'op_attacker',
        extra: [1, 2, 3],
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.PMS_OPS.createOrg).toHaveBeenCalledWith({
      operatorId: 'op_1',
      clientKey: 'ck1',
      reason: 'New group',
      ticketRef: 'T-1',
      orgId: 'org_new',
      name: 'Group',
      planCode: 'starter',
    });
  });

  it('maps OpsFailure.status and carries the error code', async () => {
    signIn();
    const pms = fakePms({ suspendOrg: vi.fn(async () => ({ ok: false, error: 'invalid_status_transition', status: 409 })) });
    const res = await worker.fetch(post('/api/customers/org_a/suspend', { clientKey: 'k', reason: 'r' }), makeEnv({ PMS_OPS: pms }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invalid_status_transition' });
  });

  it('routes the ten writes to their entrypoint methods', async () => {
    signIn();
    const env = makeEnv();
    const w = { clientKey: 'k', reason: 'r' };
    const cases: Array<[string, Record<string, unknown>, keyof typeof env.PMS_OPS]> = [
      ['/api/customers', { ...w, orgId: 'o', name: 'n', planCode: 'p' }, 'createOrg'],
      ['/api/customers/o/properties', { ...w, propertyId: 'p', name: 'n', timeZone: 'UTC', currency: 'USD' }, 'addProperty'],
      ['/api/customers/o/owners', { ...w, email: 'a@b.test' }, 'addOrgOwner'],
      ['/api/customers/o/plan', { ...w, planCode: 'growth' }, 'setPlan'],
      ['/api/customers/o/addons', { ...w, addonCode: 'a', quantity: 1 }, 'setAddon'],
      ['/api/customers/o/suspend', w, 'suspendOrg'],
      ['/api/customers/o/reinstate', w, 'reinstateOrg'],
      ['/api/operators', { ...w, email: 'a@b.test', displayName: 'A', role: 'ops_viewer' }, 'addOperator'],
      ['/api/operators/op_9/status', { ...w, status: 'disabled' }, 'setOperatorStatus'],
      ['/api/operators/op_9/role', { ...w, role: 'ops_viewer' }, 'setOperatorRole'],
    ];
    for (const [path, body, method] of cases) {
      const res = await worker.fetch(post(path, body), env);
      expect(res.status, path).toBe(200);
      expect(env.PMS_OPS[method], method).toHaveBeenCalled();
    }
  });

  it('rejects a non-integer addon quantity and an unknown role before the entrypoint', async () => {
    signIn();
    const env = makeEnv();
    const q = await worker.fetch(post('/api/customers/o/addons', { clientKey: 'k', reason: 'r', addonCode: 'a', quantity: '2' }), env);
    const r = await worker.fetch(post('/api/operators/op_9/role', { clientKey: 'k', reason: 'r', role: 'root' }), env);
    expect(q.status).toBe(400);
    expect(r.status).toBe(400);
    expect(env.PMS_OPS.setAddon).not.toHaveBeenCalled();
    expect(env.PMS_OPS.setOperatorRole).not.toHaveBeenCalled();
  });
});

describe('reads', () => {
  it('pass query, page and filters through', async () => {
    signIn();
    const env = makeEnv();
    const get = (p: string) => worker.fetch(new Request(`${ORIGIN}${p}`, { headers: { authorization: 'Bearer t' } }), env);
    await get('/api/customers?query=grand&page=2');
    expect(env.PMS_OPS.listCustomers).toHaveBeenCalledWith({ operatorId: 'op_1', query: 'grand', page: 2 });
    await get('/api/operator-actions?orgId=org_a&operatorId=op_2&page=3');
    expect(env.PMS_OPS.listOperatorActions).toHaveBeenCalledWith({
      operatorId: 'op_1',
      orgId: 'org_a',
      filterOperatorId: 'op_2',
      page: 3,
    });
    await get('/api/properties/prop_a/health');
    expect(env.PMS_OPS.getPropertyHealth).toHaveBeenCalledWith({ operatorId: 'op_1', propertyId: 'prop_a' });
    expect((await get('/api/customers?page=abc')).status).toBe(400);
    expect((await get('/api/nope')).status).toBe(404);
  });

  it('a forbidden viewer read keeps the entrypoint status', async () => {
    signIn();
    const pms = fakePms({ listOperators: vi.fn(async () => ({ ok: false, error: 'forbidden', status: 403 })) });
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/operators`, { headers: { authorization: 'Bearer t' } }),
      makeEnv({ PMS_OPS: pms }),
    );
    expect(res.status).toBe(403);
  });
});

describe('copy setup (R7.5)', () => {
  const copyBody = {
    clientKey: 'ck-copy',
    reason: 'Hotel 2 onboarding',
    ticketRef: 'T-9',
    sourcePropertyId: 'prop_src',
    kinds: ['room_types', 'rate_plans'],
  };

  it('forwards only known fields: the target comes from the URL, the operator from the session', async () => {
    signIn();
    const env = makeEnv();
    const res = await worker.fetch(
      post('/api/properties/prop_tgt/copy-setup', {
        ...copyBody,
        targetPropertyId: 'prop_attacker',
        operatorId: 'op_attacker',
        extra: true,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.PMS_OPS.copySetup).toHaveBeenCalledWith({
      operatorId: 'op_1',
      clientKey: 'ck-copy',
      reason: 'Hotel 2 onboarding',
      ticketRef: 'T-9',
      sourcePropertyId: 'prop_src',
      targetPropertyId: 'prop_tgt',
      kinds: ['room_types', 'rate_plans'],
    });
    expect(((await res.json()) as { copyId: string }).copyId).toBe('opa_copy_1');
  });

  it('refuses kinds that are not an array, and more kinds than exist, before the binding', async () => {
    signIn();
    const env = makeEnv();
    expect((await worker.fetch(post('/api/properties/p/copy-setup', { ...copyBody, kinds: 'room_types' }), env)).status).toBe(400);
    const over = await worker.fetch(post('/api/properties/p/copy-setup', { ...copyBody, kinds: Array(8).fill('config') }), env);
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: 'limit_exceeded', detail: 'kinds' });
    expect(env.PMS_OPS.copySetup).not.toHaveBeenCalled();
  });

  it('needs the same origin like every write, and passes the entrypoint failure status through', async () => {
    signIn();
    const env = makeEnv();
    expect((await worker.fetch(post('/api/properties/p/copy-setup', copyBody, {}), env)).status).toBe(403);
    expect(env.PMS_OPS.copySetup).not.toHaveBeenCalled();
    const pms = fakePms({ copySetup: vi.fn(async () => ({ ok: false, error: 'org_mismatch', status: 409 })) });
    const refused = await worker.fetch(post('/api/properties/p/copy-setup', copyBody), makeEnv({ PMS_OPS: pms }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'org_mismatch' });
  });

  it('GET /api/copies/:id reads the status for the signed-in operator', async () => {
    signIn();
    const env = makeEnv();
    await worker.fetch(new Request(`${ORIGIN}/api/copies/opa_copy_1`, { headers: { authorization: 'Bearer t' } }), env);
    expect(env.PMS_OPS.getCopyStatus).toHaveBeenCalledWith({ operatorId: 'op_1', copyId: 'opa_copy_1' });
  });
});
