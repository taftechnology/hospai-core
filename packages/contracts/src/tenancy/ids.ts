/** Tenant-supplied identifiers flow into DO names, KV keys, and Queue envelopes — bound at provision. */

export const TENANT_ID_MAX_UTF8_BYTES = 64;

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class InvalidTenantIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTenantIdError';
  }
}

/** Validates orgId / propertyId shape and UTF-8 byte length. */
export function validateTenantId(id: string): void {
  if (!id || !TENANT_ID_PATTERN.test(id)) {
    throw new InvalidTenantIdError('tenant id must match [a-zA-Z0-9_-]+');
  }
  const bytes = new TextEncoder().encode(id).length;
  if (bytes > TENANT_ID_MAX_UTF8_BYTES) {
    throw new InvalidTenantIdError(
      `tenant id exceeds ${TENANT_ID_MAX_UTF8_BYTES} UTF-8 bytes (${bytes})`,
    );
  }
}
