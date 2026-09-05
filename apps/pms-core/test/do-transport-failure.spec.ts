import { describe, expect, it } from 'vitest';
import {
  DO_TRANSPORT_ALLOWLIST,
  isDoTransportFailure,
  isOrgDoTransportFailure,
  isPropertyDoTransportFailure,
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
} from '../src/do-transport-failure.js';

describe('do-transport-failure (N7)', () => {
  it.each([...DO_TRANSPORT_ALLOWLIST])('T8: fragment %s matches synthetic Error', (fragment) => {
    expect(isDoTransportFailure(new Error(`prefix ${fragment} suffix`))).toBe(true);
  });

  it('T9: harness blocked message excluded in production mode', () => {
    expect(isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
    expect(isOrgDoTransportFailure(new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
  });

  it('T10: harness blocked message with includeTestSentinel → true', () => {
    expect(
      isDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE), {
        kind: 'property',
        includeTestSentinel: true,
      }),
    ).toBe(true);
    expect(
      isDoTransportFailure(new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE), {
        kind: 'org',
        includeTestSentinel: true,
      }),
    ).toBe(true);
  });

  it('negative control: simulated_internal_bug → false', () => {
    expect(isDoTransportFailure(new Error('simulated_internal_bug'))).toBe(false);
  });
});
