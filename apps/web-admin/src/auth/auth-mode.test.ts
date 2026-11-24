import { describe, expect, it } from 'vitest';
import { devOperatorEmail, opsAuthMode } from './auth-mode.js';

describe('opsAuthMode', () => {
  it('uses the dev header only when VITE_USE_DEV_OPERATOR is 1', () => {
    expect(opsAuthMode({ VITE_USE_DEV_OPERATOR: '1' })).toBe('dev');
    expect(opsAuthMode({ VITE_USE_DEV_OPERATOR: '1', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' })).toBe('dev');
    expect(opsAuthMode({ VITE_USE_DEV_OPERATOR: '0', VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x' })).toBe('clerk');
  });
  it('is clerk with a publishable key and misconfigured without one', () => {
    expect(opsAuthMode({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x' })).toBe('clerk');
    expect(opsAuthMode({ VITE_CLERK_PUBLISHABLE_KEY: 'sk_test_x' })).toBe('misconfigured');
    expect(opsAuthMode({})).toBe('misconfigured');
  });
  it('defaults the dev operator email', () => {
    expect(devOperatorEmail({})).toBe('dev-operator@example.test');
    expect(devOperatorEmail({ VITE_DEV_OPERATOR_EMAIL: ' me@example.test ' })).toBe('me@example.test');
  });
});
