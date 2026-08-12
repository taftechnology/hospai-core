/** Declared purge_certificate columns — must stay free of PII-shaped names. */
export const PURGE_CERTIFICATE_COLUMNS = [
  'certificate_id',
  'workflow_id',
  'kind',
  'org_id',
  'subject_json',
  'stores_json',
  'limitations_json',
  'operator_user_id',
  'outcome',
  'halt_reason',
  'started',
  'recorded_at',
  'certified',
] as const;

export type PurgeCertificateColumn = (typeof PURGE_CERTIFICATE_COLUMNS)[number];
