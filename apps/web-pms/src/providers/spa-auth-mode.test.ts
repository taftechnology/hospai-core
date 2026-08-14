import { describe, expect, it } from 'vitest';
import { demoGateEmail, demoGatePassword, spaAuthMode } from './spa-auth-mode.js';

describe('spaAuthMode', () => {
  it('engineer when VITE_USE_DEV_ACTOR=1 and no password', () => {
    expect(spaAuthMode({ VITE_USE_DEV_ACTOR: '1' })).toBe('engineer');
    expect(spaAuthMode({ VITE_USE_DEV_ACTOR: '1', VITE_DEMO_PASSWORD: '' })).toBe('engineer');
    expect(
      spaAuthMode({
        VITE_USE_DEV_ACTOR: '1',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
      }),
    ).toBe('engineer');
  });

  it('password-gate when VITE_USE_DEV_ACTOR=1 and password set', () => {
    expect(
      spaAuthMode({ VITE_USE_DEV_ACTOR: '1', VITE_DEMO_PASSWORD: 'secret' }),
    ).toBe('password-gate');
  });

  it('clerk when publishable key starts with pk_ and flag not 1', () => {
    expect(spaAuthMode({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x' })).toBe('clerk');
    expect(spaAuthMode({ VITE_USE_DEV_ACTOR: '0', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' })).toBe(
      'clerk',
    );
  });

  it('misconfigured when no valid publishable key and flag not 1', () => {
    expect(spaAuthMode({})).toBe('misconfigured');
    expect(spaAuthMode({ VITE_CLERK_PUBLISHABLE_KEY: 'not-a-key' })).toBe('misconfigured');
  });
});

describe('demoGate helpers', () => {
  it('defaults demoGateEmail to demo@hospai.local', () => {
    expect(demoGateEmail({})).toBe('demo@hospai.local');
  });

  it('defaults demoGatePassword to empty string', () => {
    expect(demoGatePassword({})).toBe('');
  });
});
