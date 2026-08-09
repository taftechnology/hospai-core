import { describe, expect, it } from 'vitest';
import { classifyResponse, retryDelay, shouldRetry } from '../src/classify.js';

function hdr(init?: Record<string, string>) {
  return new Headers(init);
}

describe('classifyResponse', () => {
  it('FAIL_CLOSED never retries', () => {
    const c = classifyResponse({
      status: 503,
      headers: hdr(),
      body: { degraded: 'FAIL_CLOSED' },
    });
    expect(c.class).toBe('fail_closed');
    expect(shouldRetry(c)).toBe(false);
  });

  it('queue_unavailable never retries', () => {
    const c = classifyResponse({
      status: 503,
      headers: hdr(),
      body: { error: 'queue_unavailable' },
    });
    expect(c.class).toBe('queue_unavailable');
    expect(shouldRetry(c)).toBe(false);
  });

  it('READ_STALE delay from Retry-After', () => {
    const c = classifyResponse({
      status: 503,
      headers: hdr({ 'Retry-After': '7' }),
      body: { degraded: 'READ_STALE' },
    });
    expect(c.class).toBe('read_stale');
    expect(shouldRetry(c)).toBe(true);
    expect(retryDelay(c, 0)).toBe(7000);
  });

  it('401 unauthorized never retries', () => {
    const c = classifyResponse({
      status: 401,
      headers: hdr(),
      body: { error: 'unauthorized' },
    });
    expect(c.class).toBe('unauthorized');
    expect(shouldRetry(c)).toBe(false);
  });

  it('422 is client_error never retry; 500 is server_error never retry', () => {
    const a = classifyResponse({ status: 422, headers: hdr(), body: { error: 'invalid' } });
    const b = classifyResponse({ status: 500, headers: hdr(), body: { error: 'boom' } });
    expect(a.class).toBe('client_error');
    expect(shouldRetry(a)).toBe(false);
    expect(b.class).toBe('server_error');
    expect(shouldRetry(b)).toBe(false);
  });

  it('402 is entitlement_required never retry', () => {
    const c = classifyResponse({
      status: 402,
      headers: hdr(),
      body: { error: 'entitlement_required' },
    });
    expect(c.class).toBe('entitlement_required');
    expect(shouldRetry(c)).toBe(false);
  });

  it('403 is forbidden never retry', () => {
    const c = classifyResponse({
      status: 403,
      headers: hdr(),
      body: { error: 'forbidden', permission: 'folio:adjust' },
    });
    expect(c.class).toBe('forbidden');
    expect(shouldRetry(c)).toBe(false);
  });

  it('501 psp_unavailable is not_configured never retry', () => {
    const c = classifyResponse({
      status: 501,
      headers: hdr(),
      body: { ok: false, error: 'psp_unavailable' },
    });
    expect(c.class).toBe('not_configured');
    expect(shouldRetry(c)).toBe(false);
  });

  it('501 without psp_unavailable stays server_error', () => {
    const c = classifyResponse({
      status: 501,
      headers: hdr(),
      body: { error: 'not_implemented' },
    });
    expect(c.class).toBe('server_error');
  });

  it('409 idempotency_key_reused is dedicated class; other 409 is client_error', () => {
    const a = classifyResponse({
      status: 409,
      headers: hdr(),
      body: { error: 'idempotency_key_reused' },
    });
    const b = classifyResponse({
      status: 409,
      headers: hdr(),
      body: { error: 'guest_exists' },
    });
    expect(a.class).toBe('idempotency_key_reused');
    expect(shouldRetry(a)).toBe(false);
    expect(b.class).toBe('client_error');
  });

  it('422 shift_not_open / shift_already_open are dedicated classes', () => {
    expect(
      classifyResponse({
        status: 422,
        headers: hdr(),
        body: { ok: false, error: 'shift_not_open' },
      }).class,
    ).toBe('shift_not_open');
    expect(
      classifyResponse({
        status: 422,
        headers: hdr(),
        body: { ok: false, error: 'shift_already_open' },
      }).class,
    ).toBe('shift_already_open');
    expect(
      classifyResponse({
        status: 422,
        headers: hdr(),
        body: { ok: false, error: 'money_invalid' },
      }).class,
    ).toBe('client_error');
  });
});
