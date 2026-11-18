import { classifiedUserMessage } from './classified-user-message.js';

/** A 202 provisional write: `getJson` returns it instead of throwing. */
export function isQueuedResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result != null &&
    (result as { classified?: { class?: string } }).classified?.class === 'provisional'
  );
}

/** Same sentence as the `provisional` class in `classifiedUserMessage`. */
export function queuedWriteCopy(): string {
  return classifiedUserMessage(
    { class: 'provisional', status: 202, body: {}, retryAfterMs: null },
    {},
  );
}
