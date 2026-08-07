import type { CredentialProvider } from '@hospai/client-core';

/** Same-origin Clerk session — cookies sent automatically; no extra headers. */
export function createClerkCredentials(): CredentialProvider {
  return {
    getCredentialHeaders: () => ({}),
  };
}
