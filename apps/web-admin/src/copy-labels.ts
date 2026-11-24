import type { OpsCopyKind } from '@hospai/contracts';

/** Plain words for the seven kinds a copy can carry (ops-platform spec §11 C4). */
export const COPY_KIND_LABELS: Record<OpsCopyKind, string> = {
  charge_codes: 'Charge codes',
  tax_rules: 'Tax rules',
  room_types: 'Room types (definitions only, no rooms)',
  products: 'Product categories and items',
  rate_plans: 'Rate plans and their nightly rates',
  packages: 'Packages',
  config: 'Hotel policies (an approved list of settings)',
};

/** Short names for result tables and messages. */
export const COPY_KIND_SHORT: Record<OpsCopyKind, string> = {
  charge_codes: 'Charge codes',
  tax_rules: 'Tax rules',
  room_types: 'Room types',
  products: 'Products',
  rate_plans: 'Rate plans and rates',
  packages: 'Packages',
  config: 'Hotel policies',
};

const REASONS: Record<string, string> = {
  archived: 'Archived at the source hotel',
  default_plan_exists: 'Every hotel already has this plan',
  dependency_not_copied: 'Needs something that was not copied',
  superseded_version: 'An older version of a tax rule',
  not_domain_class: 'Not a setting that can be copied',
  charge_code_exists: 'Already on this hotel',
  room_type_code_exists: 'That code is already in use here',
  rate_plan_code_exists: 'That code is already in use here',
  package_code_exists: 'That code is already in use here',
  internal_error: 'Could not be created',
};

/** Why an item was skipped, in words. An unknown code is shown as is, so nothing is hidden. */
export function skipReasonLabel(reason: string): string {
  return REASONS[reason] ?? reason;
}

/** `charge_codes,room_types` as "charge codes, room types". */
export function kindList(detail: string): string {
  return detail
    .split(',')
    .map((k) => (COPY_KIND_SHORT[k as OpsCopyKind] ?? k).toLowerCase())
    .join(', ');
}
