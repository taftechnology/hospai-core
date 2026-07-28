export type { GuestProfile, KeyScope, KeyStore, WrappedKeyRecord } from './types.js';
export { KeyNotFoundError, KeyShreddedError } from './errors.js';
export { generatePiiKeyId, importMasterKeyHex } from './master-key.js';
export { PiiVault } from './vault.js';
