import { describe, expect, it } from 'vitest';
import { frontOfficeAuthProtocol } from './front-office-auth-protocol.js';

describe('frontOfficeAuthProtocol', () => {
  it('returns dev-actor protocol when useDevActor is true', () => {
    expect(
      frontOfficeAuthProtocol({
        useDevActor: true,
        devActor: 'user_owner',
        clerkToken: 'jwt.abc',
      }),
    ).toEqual(['hospai.dev-actor.user_owner', 'front-office']);
  });

  it('returns clerk protocol when not dev-actor and token present', () => {
    expect(
      frontOfficeAuthProtocol({
        useDevActor: false,
        devActor: 'user_owner',
        clerkToken: 'jwt.abc',
      }),
    ).toEqual(['hospai.clerk.jwt.abc', 'front-office']);
  });

  it('returns undefined when not dev-actor and token is null', () => {
    expect(
      frontOfficeAuthProtocol({
        useDevActor: false,
        devActor: 'user_owner',
        clerkToken: null,
      }),
    ).toBeUndefined();
  });
});
