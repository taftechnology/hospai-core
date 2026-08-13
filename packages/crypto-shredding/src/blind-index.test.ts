import { describe, expect, it } from 'vitest';
import { importMasterKeyHex } from './master-key.js';
import {
  blindIndexHash,
  blindIndexRows,
  importBlindIndexKeyHex,
  normalizeBlindIndexValue,
} from './blind-index.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('blind-index', () => {
  it('same normalized email yields the same 32-byte hash', async () => {
    const key = await importBlindIndexKeyHex(MASTER_HEX);
    const a = normalizeBlindIndexValue('email', 'Ada@Ex.com');
    const b = normalizeBlindIndexValue('email', 'ada@ex.com');
    expect(a).toBe('ada@ex.com');
    expect(b).toBe('ada@ex.com');
    const ha = await blindIndexHash(key, 'email', a!);
    const hb = await blindIndexHash(key, 'email', b!);
    expect(ha.byteLength).toBe(32);
    expect(hexOf(ha)).toBe(hexOf(hb));
  });

  it('name vs email for the same payload do not collide', async () => {
    const key = await importBlindIndexKeyHex(MASTER_HEX);
    const payload = 'a@b.c';
    const nameHash = await blindIndexHash(key, 'name', payload);
    const emailHash = await blindIndexHash(key, 'email', payload);
    expect(hexOf(nameHash)).not.toBe(hexOf(emailHash));
  });

  it('blindIndexRows emits name, two tokens, email, and digit-stripped phone', async () => {
    const key = await importBlindIndexKeyHex(MASTER_HEX);
    const rows = await blindIndexRows(key, {
      displayName: 'Ada Lovelace',
      email: 'ada@ex.com',
      phone: '555-0100',
    });
    expect(rows.map((r) => r.kind).sort()).toEqual(
      ['email', 'name', 'name_token', 'name_token', 'phone'].sort(),
    );
    const phone = rows.find((r) => r.kind === 'phone');
    const expectedPhone = await blindIndexHash(key, 'phone', '5550100');
    expect(hexOf(phone!.hash)).toBe(hexOf(expectedPhone));
    expect(rows.every((r) => r.hash.byteLength === 32)).toBe(true);
  });

  it('omits missing email/phone and one-letter name tokens', async () => {
    const key = await importBlindIndexKeyHex(MASTER_HEX);
    const rows = await blindIndexRows(key, { displayName: 'A' });
    expect(rows.map((r) => r.kind)).toEqual(['name']);
    const empty = await blindIndexRows(key, { displayName: 'Ada' });
    expect(empty.some((r) => r.kind === 'name')).toBe(true);
    expect(empty.filter((r) => r.kind === 'name_token')).toHaveLength(1);
    expect(empty.some((r) => r.kind === 'email' || r.kind === 'phone')).toBe(false);
  });

  it('two imports of the same hex sign identically', async () => {
    const a = await importBlindIndexKeyHex(MASTER_HEX);
    const b = await importBlindIndexKeyHex(MASTER_HEX);
    const ha = await blindIndexHash(a, 'name', 'ada lovelace');
    const hb = await blindIndexHash(b, 'name', 'ada lovelace');
    expect(hexOf(ha)).toBe(hexOf(hb));
  });

  it('HMAC key is not the AES-GCM wrap key', async () => {
    const hmac = await importBlindIndexKeyHex(MASTER_HEX);
    const aes = await importMasterKeyHex(MASTER_HEX);
    expect(hmac.algorithm.name).toBe('HMAC');
    expect(aes.algorithm.name).toBe('AES-GCM');
  });

  it('rejects a short hex the same way as the master-key import', async () => {
    await expect(importBlindIndexKeyHex('nope')).rejects.toThrow(
      /HOSPAI_ORG_MASTER_KEY must be 64 hex characters/,
    );
  });
});
