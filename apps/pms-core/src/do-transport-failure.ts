/**
 * Shared Cloudflare/workerd stub failure classification for PropertyDO and OrgDO.
 * Substring match on Error.message — intentionally brittle; unknown shapes fail closed.
 */
/** Substrings matched against Error.message — intentionally brittle across workerd versions. */
export const DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
  'overloaded',
  'Durable Object is overloaded',
  'evicted',
  'object evicted',
  'Durable Object storage operation failed',
  'internal error in Durable Object storage',
  'cannot resolve Durable Object',
  'Could not resolve Durable Object',
];

export const PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE =
  'PropertyDO transport blocked for test (degraded-mode fault injection)' as const;
export const ORG_DO_TRANSPORT_BLOCKED_MESSAGE =
  'OrgDO transport blocked for test (degraded-mode fault injection)' as const;

export type DoTransportKind = 'property' | 'org';

export function isDoTransportFailure(
  error: unknown,
  opts?: { kind?: DoTransportKind; includeTestSentinel?: boolean },
): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  const list = opts?.includeTestSentinel
    ? [
        ...DO_TRANSPORT_ALLOWLIST,
        opts.kind === 'org'
          ? ORG_DO_TRANSPORT_BLOCKED_MESSAGE
          : PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
      ]
    : DO_TRANSPORT_ALLOWLIST;
  return list.some((fragment) => msg.includes(fragment));
}

export function isPropertyDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'property',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}

export function isOrgDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'org',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}
