import { describe, expect, it } from 'vitest';
import {
  deriveOrgBlindIndexKeyHex,
  deriveOrgWrapKeyHex,
  HKDF_SALT,
  importPlatformIkmHex,
} from './org-derive.js';
import { blindIndexHash, normalizeBlindIndexValue } from './blind-index.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const ORG_A = 'org_a_test_uuid';
const ORG_B = 'org_b_test_uuid';

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('org-derive', () => {
  it('T1: same hex + different orgId → different wrap output for same data key', async () => {
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const wrapA = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_A);
    const wrapB = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_B);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedA = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, wrapA, { name: 'AES-GCM', iv }),
    );
    const wrappedB = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, wrapB, { name: 'AES-GCM', iv }),
    );
    expect(hexOf(wrappedA)).not.toBe(hexOf(wrappedB));
  });

  it('T2: same hex + different orgId → different email blind hash', async () => {
    const keyA = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_A);
    const keyB = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_B);
    const email = normalizeBlindIndexValue('email', 'same@example.com')!;
    const ha = await blindIndexHash(keyA, 'email', email);
    const hb = await blindIndexHash(keyB, 'email', email);
    expect(hexOf(ha)).not.toBe(hexOf(hb));
  });

  it('wrap key ≠ blind key for same org', async () => {
    const wrap = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_A);
    const blind = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_A);
    expect(wrap.algorithm.name).toBe('AES-GCM');
    expect(blind.algorithm.name).toBe('HMAC');
  });

  it('HKDF_SALT is 32 zero bytes', () => {
    expect(HKDF_SALT.byteLength).toBe(32);
    expect([...HKDF_SALT].every((b) => b === 0)).toBe(true);
  });

  it('importPlatformIkmHex rejects short hex like master-key import', async () => {
    await expect(importPlatformIkmHex('nope')).rejects.toThrow(
      /HOSPAI_ORG_MASTER_KEY must be 64 hex characters/,
    );
  });
});
