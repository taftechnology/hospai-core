/** §4.8 — staff scope reserved; shredding one scope must not touch the other. */
export type KeyScope = 'guest' | 'staff';

export type GuestProfile = {
  displayName: string;
  email?: string;
  phone?: string;
};

export type WrappedKeyRecord = {
  piiKeyId: string;
  scope: KeyScope;
  subjectId: string;
  wrappedKey: Uint8Array;
  shredded: boolean;
};

export interface KeyStore {
  get(piiKeyId: string): WrappedKeyRecord | null;
  insert(record: { piiKeyId: string; scope: KeyScope; subjectId: string; wrappedKey: Uint8Array }): void;
  shred(piiKeyId: string): boolean;
}
