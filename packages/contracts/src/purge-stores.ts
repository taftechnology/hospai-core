/**
 * Certificate `stores[]` names. `r2` is the event log (retained).
 * `r2_guest_documents` is the guest-document bucket (deleted on guest purge).
 */
export const PURGE_STORE_NAMES = [
  'key_store',
  'property_do',
  'org_do',
  'org_do_tax_invoice_buyer',
  'r2',
  'r2_guest_documents',
  'iceberg',
] as const;

export type PurgeStoreName = (typeof PURGE_STORE_NAMES)[number];
