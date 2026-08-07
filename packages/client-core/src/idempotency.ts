export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Generate once per logical operation; reuse across retries of that operation. */
export function stableKeyForOperation(opId: string, store: Map<string, string>): string {
  const existing = store.get(opId);
  if (existing) return existing;
  const key = createIdempotencyKey();
  store.set(opId, key);
  return key;
}
