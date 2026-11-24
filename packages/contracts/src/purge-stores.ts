/**
 * Certificate `stores[]` names. `r2` is the event log (retained).
 * `r2_guest_documents` is the guest-document bucket (deleted on guest purge).
 * `platform_user_org` is the platform D1 user-to-org discovery index (R4.4); org purge deletes the
 * org's rows, guest purge does not touch it.
 */
export const PURGE_STORE_NAMES = [
  'key_store',
  'property_do',
  'org_do',
  'org_do_tax_invoice_buyer',
  'org_do_form_c',
  'r2',
  'r2_guest_documents',
  'platform_user_org',
  'iceberg',
] as const;

export type PurgeStoreName = (typeof PURGE_STORE_NAMES)[number];
