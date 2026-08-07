import type { CredentialProvider } from '@hospai/client-core';

export function createDevActorCredentials(userId: string): CredentialProvider {
  return {
    getCredentialHeaders: () => ({ 'x-dev-actor': userId }),
  };
}
