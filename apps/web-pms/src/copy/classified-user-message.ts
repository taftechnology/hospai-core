import {
  type ClassifiedResponse,
  type ClientResultClass,
  permissionForForbidden,
} from '@hospai/client-core';

const UNKNOWN_MESSAGE = 'Something went wrong — try again or ask a manager.';

const CLASS_MESSAGES: Partial<Record<ClientResultClass, string>> = {
  fail_closed: 'Property unreachable.',
  read_stale: 'Data is stale — try again.',
  provisional: 'Request queued — will apply when the property is reachable.',
  queue_unavailable: 'Could not queue — queue unavailable.',
  not_configured: 'Card payments are not configured for this property.',
  idempotency_key_reused:
    'An earlier submission of this form already posted; refresh the folio to see it.',
  unauthorized: 'Sign in required.',
  entitlement_required: 'Subscription required for this feature.',
  shift_not_open: 'No open shift — open a shift first.',
};

export function classifiedUserMessage(
  classified: ClassifiedResponse,
  context: {
    fallback?: string;
    /** Screen-specific overrides already painted before calling helper */
    knownCode?: string | null;
  },
): string {

  if (classified.class === 'forbidden') {
    const perm = permissionForForbidden(classified.body);
    return perm
      ? `Requires permission ${perm}. Ask a manager.`
      : 'Forbidden — insufficient permission.';
  }

  const mapped = CLASS_MESSAGES[classified.class];
  if (mapped) return mapped;

  return context.fallback ?? UNKNOWN_MESSAGE;
}
