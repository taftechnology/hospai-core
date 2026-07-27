import { describe, expect, it } from 'vitest';
import {
  JurisdictionUnavailableError,
  assertJurisdictionMatch,
  JurisdictionMismatchError,
  resolvePropertyStub,
  TENANT_ROUTER_PACKAGE,
} from './index.js';

describe('tenant-router', () => {
  it('exports package sentinel', () => {
    expect(TENANT_ROUTER_PACKAGE).toBe('@hospai/tenant-router');
  });

  it('resolves via idFromName on the namespace when jurisdiction is null', () => {
    const calls: string[] = [];
    const stub = { kind: 'stub' };
    const ns = {
      idFromName(name: string) {
        calls.push(`DEFAULT::${name}`);
        return { id: name };
      },
      get() {
        return stub;
      },
    };
    expect(resolvePropertyStub(ns, { orgId: 'o1', propertyId: 'p1', jurisdiction: null })).toBe(stub);
    expect(calls).toEqual(['DEFAULT::p1']);
  });

  it('fails closed when jurisdiction is required but ns.jurisdiction is missing', () => {
    const ns = {
      idFromName(name: string) {
        return { id: `DEFAULT-NAMESPACE::${name}` };
      },
      get(id: unknown) {
        return { opened: id };
      },
    };
    expect(() =>
      resolvePropertyStub(ns, { orgId: 'o1', propertyId: 'prop_123', jurisdiction: 'eu' }),
    ).toThrow(JurisdictionUnavailableError);
  });

  it('uses jurisdictional subnamespace when available', () => {
    const opened: string[] = [];
    const euNs = {
      idFromName(name: string) {
        opened.push(`eu::${name}`);
        return { id: `eu-${name}` };
      },
      get(id: unknown) {
        return { stub: id };
      },
    };
    const ns = {
      idFromName(name: string) {
        opened.push(`DEFAULT::${name}`);
        return { id: name };
      },
      jurisdiction(j: string) {
        expect(j).toBe('eu');
        return euNs;
      },
      get() {
        throw new Error('should not get on default ns');
      },
    };
    resolvePropertyStub(ns, { orgId: 'o1', propertyId: 'prop_123', jurisdiction: 'eu' });
    expect(opened).toEqual(['eu::prop_123']);
  });

  it('assertJurisdictionMatch refuses mismatch', () => {
    expect(() => assertJurisdictionMatch(undefined, 'eu')).toThrow(JurisdictionMismatchError);
    expect(() => assertJurisdictionMatch('us', 'eu')).toThrow(JurisdictionMismatchError);
    expect(() => assertJurisdictionMatch('eu', 'eu')).not.toThrow();
    expect(() => assertJurisdictionMatch(null, null)).not.toThrow();
    // undefined expected = not yet wired
    expect(() => assertJurisdictionMatch(null, undefined)).not.toThrow();
  });

  it('§11: jurisdictional tenant is unreachable via the non-jurisdictional namespace', () => {
    const ns = {
      idFromName(name: string) {
        return { id: `DEFAULT-NAMESPACE::${name}` };
      },
      get(id: unknown) {
        return { opened: id };
      },
      // deliberately no jurisdiction()
    };
    expect(() =>
      resolvePropertyStub(ns, { orgId: 'o1', propertyId: 'prop_123', jurisdiction: 'eu' }),
    ).toThrow(/Refusing to open the default namespace/);
  });
});
