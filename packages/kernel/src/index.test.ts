import { describe, expect, it } from 'vitest';
import { SecretConfigRejectedError, UndeclaredConfigError, validateConfigWrite } from './index.js';

describe('validateConfigWrite', () => {
  it('accepts DOMAIN boolean', () => {
    expect(validateConfigWrite('pms.availability.allow_overbooking', true)).toBe(true);
  });

  it('rejects SECRET', () => {
    expect(() => validateConfigWrite('pms.finance.paypal_clientid', 'x')).toThrow(SecretConfigRejectedError);
  });

  it('rejects undeclared', () => {
    expect(() => validateConfigWrite('pms.unknown', 1)).toThrow(UndeclaredConfigError);
  });
});
