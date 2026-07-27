import { describe, expect, it } from 'vitest';
import { TENANT_ROUTER_PACKAGE, resolvePropertyStub } from './index.js';

describe('tenant-router', () => {
  it('exports package sentinel', () => {
    expect(TENANT_ROUTER_PACKAGE).toBe('@hospai/tenant-router');
  });

  it('resolves via idFromName on the namespace', () => {
    const calls: string[] = [];
    const stub = { kind: 'stub' };
    const ns = {
      idFromName(name: string) {
        calls.push(name);
        return { id: name };
      },
      get() {
        return stub;
      },
    };
    expect(resolvePropertyStub(ns, { orgId: 'o1', propertyId: 'p1', jurisdiction: null })).toBe(stub);
    expect(calls).toEqual(['p1']);
  });
});
