import type { CredentialHeaders, CredentialProvider } from '@hospai/client-core';

export type ClerkTokenGetter = () => Promise<string | null>;

let tokenGetter: ClerkTokenGetter | null = null;

export function registerClerkTokenGetter(getter: ClerkTokenGetter | null): void {
  tokenGetter = getter;
}

export async function getClerkSessionToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  const token = await tokenGetter();
  return token || null;
}

export function createClerkCredentials(): CredentialProvider {
  return {
    getCredentialHeaders: async (): Promise<CredentialHeaders> => {
      const token = await getClerkSessionToken();
      if (!token) return {};
      return { authorization: `Bearer ${token}` };
    },
  };
}
