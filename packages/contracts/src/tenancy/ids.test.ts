import { describe, expect, it } from 'vitest';
import { InvalidTenantIdError, TENANT_ID_MAX_UTF8_BYTES, validateTenantId } from './ids.js';

describe('validateTenantId', () => {
  it('accepts alphanumeric ids with underscore and hyphen', () => {
    expect(() => validateTenantId('org_1-test')).not.toThrow();
  });

  it('rejects empty, spaces, and punctuation', () => {
    expect(() => validateTenantId('')).toThrow(InvalidTenantIdError);
    expect(() => validateTenantId('org id')).toThrow(InvalidTenantIdError);
    expect(() => validateTenantId('org.id')).toThrow(InvalidTenantIdError);
  });

  it('rejects ids over UTF-8 byte limit', () => {
    const over = 'a'.repeat(TENANT_ID_MAX_UTF8_BYTES + 1);
    expect(() => validateTenantId(over)).toThrow(InvalidTenantIdError);
    expect(() => validateTenantId('a'.repeat(TENANT_ID_MAX_UTF8_BYTES))).not.toThrow();
  });

  it('counts UTF-8 bytes, not JS string length', () => {
    const cjk = '組'.repeat(TENANT_ID_MAX_UTF8_BYTES / 3 + 1);
    expect(() => validateTenantId(cjk)).toThrow(InvalidTenantIdError);
  });
});
