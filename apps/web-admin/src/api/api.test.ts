import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, isApiError, opsErrorMessage, registerTokenGetter, setDevOperator } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  registerTokenGetter(null);
  setDevOperator(null);
});

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('api client', () => {
  it('sends the Clerk token as Bearer', async () => {
    const f = answer(200, { ok: true });
    vi.stubGlobal('fetch', f);
    registerTokenGetter(async () => 'tok');
    await apiGet('/me');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/me');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('sends the dev header instead of a token in dev mode', async () => {
    const f = answer(200, { ok: true });
    vi.stubGlobal('fetch', f);
    setDevOperator('dev@example.test');
    await apiPost('/customers', { a: 1 });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ 'x-dev-operator': 'dev@example.test', 'content-type': 'application/json' });
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('turns an error body into an ApiError with a code, and a network failure into network_error', async () => {
    vi.stubGlobal('fetch', answer(409, { error: 'org_exists' }));
    const err = await apiPost('/customers', {}).catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ status: 409, code: 'org_exists' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const net = await apiGet('/me').catch((e: unknown) => e);
    expect(net).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('maps codes to copy and never prints a code or a status line', () => {
    const e = (code: string, detail?: string) => Object.assign(new Error(code), { status: 400, code, detail });
    expect(opsErrorMessage(e('org_exists'))).toMatch(/already exists/);
    expect(opsErrorMessage(e('invalid_request', 'unknown_plan'))).toBe('That plan code does not exist.');
    expect(opsErrorMessage(e('invalid_request', 'something_new'))).not.toContain('something_new');
    expect(opsErrorMessage(e('totally_unknown'))).toBe('That did not work. Try again.');
    expect(opsErrorMessage(new Error('boom'))).toBe('That did not work. Try again.');
    expect(opsErrorMessage(e('totally_unknown'))).not.toMatch(/Request failed/);
  });
});
