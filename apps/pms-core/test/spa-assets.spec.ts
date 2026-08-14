import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

describe('same-origin SPA assets', () => {
  it('unmatched non-/v1 path serves SPA shell via ASSETS', async () => {
    const res = await worker.fetch(new Request('http://localhost/arrivals'), env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain('html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('GET / serves SPA index (banner retired)', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('HospAI PMS');
  });
});
