export type {
  GuestProfile,
  KeyScope,
  KeyStore,
  StaffProfile,
  StaffProfileCreate,
  WrappedKeyRecord,
} from './types.js';
export { KeyNotFoundError, KeyShreddedError } from './errors.js';
export { importMasterKeyHex } from './master-key.js';
export {
  HKDF_SALT,
  deriveOrgBlindIndexKeyHex,
  deriveOrgWrapKeyHex,
  importPlatformIkmHex,
} from './org-derive.js';
export {
  type BlindIndexKind,
  blindIndexHash,
  blindIndexRows,
  importBlindIndexKeyHex,
  normalizeBlindIndexValue,
} from './blind-index.js';
export { PiiVault, type VaultMasters } from './vault.js';
