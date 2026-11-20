/** §4.8 — staff scope reserved; shredding one scope must not touch the other. */
export type KeyScope = 'guest' | 'staff';

export type GuestPreferences = {
  room?: Array<
    | 'HIGH_FLOOR'
    | 'LOW_FLOOR'
    | 'QUIET_ROOM'
    | 'NEAR_ELEVATOR'
    | 'AWAY_FROM_ELEVATOR'
    | 'CONNECTING_ROOM'
  >;
  bedding?: Array<'KING' | 'QUEEN' | 'TWIN' | 'EXTRA_BED' | 'CRIB' | 'FEATHER_FREE'>;
  dietary?: Array<
    | 'VEGETARIAN'
    | 'VEGAN'
    | 'JAIN'
    | 'HALAL'
    | 'KOSHER'
    | 'GLUTEN_FREE'
    | 'NUT_ALLERGY'
    | 'LACTOSE_FREE'
  >;
  accessibility?: Array<
    'WHEELCHAIR' | 'ACCESSIBLE_BATHROOM' | 'GROUND_FLOOR' | 'HEARING_SUPPORT' | 'VISUAL_SUPPORT'
  >;
  /** ≤ 200 chars. Not a second notes field. */
  other?: string;
};

/** Buyer GST block inside the encrypted profile. Never placed on the event bus. */
export type GuestGstBuyer = {
  gstin?: string;
  legalName?: string;
  tradeName?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  stateCode?: string;
};

export type GuestProfile = {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];
  vip?: boolean;
  notes?: string;
  preferences?: GuestPreferences;
  gstBuyer?: GuestGstBuyer;
};

export type StaffProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
  hourlyRateMinor?: number;
  hourlyRateCurrency?: string;
  rating?: number;
  skills?: string[];
};

export type StaffProfileCreate = StaffProfile & { displayName: string };

export type WrappedKeyRecord = {
  piiKeyId: string;
  scope: KeyScope;
  subjectId: string;
  wrappedKey: Uint8Array;
  shredded: boolean;
  keyVersion: 0 | 1;
};

export interface KeyStore {
  get(piiKeyId: string): WrappedKeyRecord | null;
  insert(record: {
    piiKeyId: string;
    scope: KeyScope;
    subjectId: string;
    wrappedKey: Uint8Array;
    keyVersion?: 0 | 1;
  }): void;
  shred(piiKeyId: string): boolean;
}
