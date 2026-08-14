import { describe, expect, it } from 'vitest';
import {
  createClerkCredentials,
  getClerkSessionToken,
  registerClerkTokenGetter,
} from './clerk-credentials.js';

describe('createClerkCredentials', () => {
  it('returns empty headers when no getter registered', async () => {
    registerClerkTokenGetter(null);
    const headers = await createClerkCredentials().getCredentialHeaders();
    expect(headers).toEqual({});
  });

  it('returns Bearer header when getter returns a token', async () => {
    registerClerkTokenGetter(async () => 'session_jwt');
    const headers = await createClerkCredentials().getCredentialHeaders();
    expect(headers).toEqual({ authorization: 'Bearer session_jwt' });
    expect(headers).not.toHaveProperty('x-dev-actor');
  });

  it('returns empty headers when getter returns null', async () => {
    registerClerkTokenGetter(async () => null);
    const headers = await createClerkCredentials().getCredentialHeaders();
    expect(headers).toEqual({});
  });

  it('returns empty headers after registerClerkTokenGetter(null)', async () => {
    registerClerkTokenGetter(async () => 'session_jwt');
    registerClerkTokenGetter(null);
    const headers = await createClerkCredentials().getCredentialHeaders();
    expect(headers).toEqual({});
  });

  it('getClerkSessionToken returns null with no getter', async () => {
    registerClerkTokenGetter(null);
    expect(await getClerkSessionToken()).toBeNull();
  });
});
