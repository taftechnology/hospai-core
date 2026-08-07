import { classifyResponse, type ClassifiedResponse } from './classify.js';
import type { Transport } from './transport.js';

export class ClassifiedError extends Error {
  readonly classified: ClassifiedResponse;
  constructor(classified: ClassifiedResponse) {
    super(`client_core:${classified.class}:${classified.status}`);
    this.name = 'ClassifiedError';
    this.classified = classified;
  }
}

export async function requestJson(opts: {
  transport: Transport;
  path: string;
  init?: RequestInit;
  onEntitlementRequired?: () => Promise<void>;
}): Promise<{ classified: ClassifiedResponse; body: unknown }> {
  const res = await opts.transport.fetch(opts.path, opts.init);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
  }
  const classified = classifyResponse({ status: res.status, headers: res.headers, body });
  if (classified.class === 'entitlement_required' && opts.onEntitlementRequired) {
    await opts.onEntitlementRequired();
  }
  return { classified, body };
}
