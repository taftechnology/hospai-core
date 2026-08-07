/**
 * Explicit mapping from Cloudflare/workerd stub failures to degraded-mode transport
 * classification. Substring match on Error.message — intentionally brittle; unknown
 * shapes fail closed at HTTP (500), never queue.
 */
export const ORG_DO_TRANSPORT_BLOCKED_MESSAGE =
  'OrgDO transport blocked for test (degraded-mode fault injection)' as const;

export const ORG_DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  ORG_DO_TRANSPORT_BLOCKED_MESSAGE,
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
];

export function isOrgDoTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return ORG_DO_TRANSPORT_ALLOWLIST.some((fragment) => msg.includes(fragment));
}
