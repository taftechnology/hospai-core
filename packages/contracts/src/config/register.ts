import { z } from 'zod';
import type { Permission } from '../permissions.js';

/* eslint-disable no-redeclare -- zod schema const shares name with inferred type */
export const ConfigClass = z.enum(['DOMAIN', 'OPERATIONAL', 'PRESENTATION', 'SECRET']);
export type ConfigClass = z.infer<typeof ConfigClass>;

export const ConfigScope = z.enum(['property', 'org', 'user']);
export type ConfigScope = z.infer<typeof ConfigScope>;

export type ConfigConsumers = {
  invalidatesAri: boolean;
  reschedulesNightAudit: boolean;
  rematerializesRates: boolean;
};

export type ConfigEntry = {
  key: string;
  prototypeKey: string | null;
  scope: ConfigScope;
  class: ConfigClass;
  schema: z.ZodTypeAny;
  default: unknown;
  permission: Permission;
  audited: boolean;
  entitlement?: string;
  consumers: ConfigConsumers;
  /** When true, DOMAIN key may have zero consumers (must be rare). */
  consumersExempt?: boolean;
  secretDestination?: 'payments' | 'analytics' | 'r2';
};

const none: ConfigConsumers = {
  invalidatesAri: false,
  reschedulesNightAudit: false,
  rematerializesRates: false,
};

const ari: ConfigConsumers = { ...none, invalidatesAri: true };
const night: ConfigConsumers = { ...none, reschedulesNightAudit: true };
const rates: ConfigConsumers = { ...none, rematerializesRates: true };

function entry(
  partial: Omit<ConfigEntry, 'consumers' | 'audited' | 'permission' | 'scope'> &
    Partial<Pick<ConfigEntry, 'consumers' | 'audited' | 'permission' | 'scope' | 'consumersExempt' | 'secretDestination' | 'entitlement'>>,
): ConfigEntry {
  return {
    scope: partial.scope ?? 'property',
    audited: partial.audited ?? true,
    permission: partial.permission ?? 'settings:configure',
    consumers: partial.consumers ?? none,
    ...partial,
  } as ConfigEntry;
}

/** Data bags served by module tables, excluded from the config register. */
export const EXCLUDED_PROTOTYPE_KEYS = [
  'pms_email_delivery_logs',
  'pms_email_templates',
  'pms_maintenance_tickets',
  'pms_hk_inventory',
  'pms_hk_manager_priorities',
  'pms_distribution_closeouts',
  'pms_promo_catalog',
  'pms_products_items',
  'pms_products_categories',
  'pms_products_addons',
] as const;

const bool = z.boolean();
const str = z.string();
const json = z.unknown();

/** R1.6 named list (booking sources, market segments): codes are never removed, only archived. */
export const NAMED_LIST_MAX_ENTRIES = 50;
export const NamedListEntry = z.object({
  code: z.string().regex(/^[A-Z0-9_]{1,32}$/),
  name: z.string().trim().min(1).max(60),
  status: z.enum(['active', 'archived']),
});
export type NamedListEntry = z.infer<typeof NamedListEntry>;
export const NamedList = z
  .array(NamedListEntry)
  .max(NAMED_LIST_MAX_ENTRIES)
  .refine((list) => new Set(list.map((e) => e.code)).size === list.length, {
    message: 'duplicate_code',
  });

export const CONFIG_REGISTER: ConfigEntry[] = [
  // —— DOMAIN (freeze-critical) ——
  entry({
    key: 'pms.availability.allow_overbooking',
    prototypeKey: 'pms_sys_allow_overbooking',
    class: 'DOMAIN',
    schema: bool,
    default: false,
    permission: 'inventory:configure',
    consumers: ari,
  }),
  entry({
    key: 'pms.availability.oversell_allowance',
    prototypeKey: null,
    class: 'DOMAIN',
    schema: z.number().int().nonnegative(),
    default: 0,
    permission: 'inventory:configure',
    consumers: ari,
  }),
  entry({
    key: 'pms.time.time_zone',
    prototypeKey: 'pms_sys_time_zone',
    class: 'DOMAIN',
    schema: str,
    default: 'America/New_York',
    consumers: { invalidatesAri: true, reschedulesNightAudit: true, rematerializesRates: true },
  }),
  entry({
    key: 'pms.night_audit.audit_time',
    prototypeKey: 'pms_sys_audit_time',
    class: 'DOMAIN',
    schema: str,
    default: '02:00',
    consumers: night,
  }),
  entry({
    key: 'pms.night_audit.auto_no_show',
    prototypeKey: 'pms_sys_auto_no_show',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumers: { invalidatesAri: true, reschedulesNightAudit: true, rematerializesRates: false },
  }),
  entry({
    key: 'pms.night_audit.auto_extend',
    prototypeKey: 'pms_sys_auto_extend',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumers: night,
  }),
  entry({
    key: 'pms.booking.same_day_bookings',
    prototypeKey: 'pms_sys_same_day_bookings',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumers: ari,
  }),
  entry({
    key: 'pms.booking.same_day_cutoff',
    prototypeKey: 'pms_sys_same_day_cutoff',
    class: 'DOMAIN',
    schema: str,
    default: '22:00',
    consumers: ari,
  }),
  entry({
    key: 'pms.booking.require_prepayment',
    prototypeKey: 'pms_sys_require_prepayment',
    class: 'DOMAIN',
    schema: bool,
    default: false,
    consumers: ari,
  }),
  entry({
    key: 'pms.booking.booking_date_change',
    prototypeKey: 'pms_sys_booking_date_change',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumers: ari,
  }),
  entry({
    key: 'pms.money.currency_code',
    prototypeKey: 'pms_sys_currency_code',
    class: 'DOMAIN',
    schema: z.string().length(3),
    default: 'USD',
    consumers: { invalidatesAri: false, reschedulesNightAudit: false, rematerializesRates: true },
  }),
  entry({
    key: 'pms.money.payment_alloc',
    prototypeKey: 'pms_sys_payment_alloc',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.money.currencies_list',
    prototypeKey: 'pms_currencies_list',
    class: 'DOMAIN',
    schema: z.array(json),
    default: [],
    consumers: { invalidatesAri: false, reschedulesNightAudit: false, rematerializesRates: true },
  }),
  entry({
    key: 'pms.folio.breakfast_rule',
    prototypeKey: 'pms_sys_breakfast_rule',
    class: 'DOMAIN',
    schema: str,
    default: 'EXCLUDED FROM ROOM/BED PRICE',
    consumers: { invalidatesAri: false, reschedulesNightAudit: true, rematerializesRates: true },
  }),
  entry({
    key: 'pms.folio.configs',
    prototypeKey: 'pms_folio_configs',
    class: 'DOMAIN',
    schema: json,
    default: {},
    consumersExempt: true,
  }),
  entry({
    key: 'pms.folio.close_window_on_check_out',
    prototypeKey: 'pms_folio_close_on_checkout',
    class: 'DOMAIN',
    schema: bool,
    default: false,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.folio.auto_capture_on_check_out',
    prototypeKey: 'pms_folio_auto_capture_checkout',
    class: 'DOMAIN',
    schema: bool,
    default: false,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.reservations.pending_hold_hours',
    prototypeKey: 'pms_res_pending_hold_hours',
    class: 'DOMAIN',
    schema: z.number().int().min(1).max(168),
    default: 24,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.payments.auth_hold_hours',
    prototypeKey: 'pms_payments_auth_hold_hours',
    class: 'DOMAIN',
    schema: z.number().int().min(1).max(720),
    default: 72,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.reservations.inquiry_ttl_days',
    prototypeKey: 'pms_res_inquiry_ttl_days',
    class: 'DOMAIN',
    schema: z.number().int().min(1).max(90),
    default: 7,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.reservations.check_in_cleanliness',
    prototypeKey: 'pms_res_check_in_cleanliness',
    class: 'DOMAIN',
    schema: z.enum(['strict', 'off']),
    default: 'strict',
    consumersExempt: true,
  }),
  entry({
    key: 'pms.housekeeping.require_inspection',
    prototypeKey: null,
    class: 'DOMAIN',
    schema: bool,
    default: false,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.reservations.check_out_require_zero_balance',
    prototypeKey: 'pms_res_checkout_zero_bal',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumersExempt: true,
  }),
  entry({
    key: 'pms.reservations.allow_dirty_check_in_override',
    prototypeKey: 'pms_res_allow_dirty_override',
    class: 'OPERATIONAL',
    schema: bool,
    default: true,
  }),
  entry({
    key: 'pms.reservations.allow_balance_override',
    prototypeKey: 'pms_res_allow_balance_override',
    class: 'OPERATIONAL',
    schema: bool,
    default: true,
  }),

  // —— PRESENTATION ——
  entry({ key: 'pms.ui.app_language', prototypeKey: 'pms_sys_app_language', class: 'PRESENTATION', schema: str, default: 'ENGLISH', audited: false }),
  entry({ key: 'pms.ui.date_format', prototypeKey: 'pms_sys_date_format', class: 'PRESENTATION', schema: str, default: 'MM/DD/YYYY', audited: false }),
  entry({ key: 'pms.ui.time_format', prototypeKey: 'pms_sys_time_format', class: 'PRESENTATION', schema: str, default: 'DEFAULT', audited: false }),
  entry({ key: 'pms.ui.currency_format', prototypeKey: 'pms_sys_currency_format', class: 'PRESENTATION', schema: str, default: 'DEFAULT', audited: false }),
  entry({ key: 'pms.ui.week_start', prototypeKey: 'pms_sys_week_start', class: 'PRESENTATION', schema: str, default: 'SUNDAY', audited: false }),
  entry({ key: 'pms.ui.calendar_name_format', prototypeKey: 'pms_sys_calendar_name_format', class: 'PRESENTATION', schema: str, default: 'NAME SURNAME', audited: false }),
  entry({ key: 'pms.ui.show_eta', prototypeKey: 'pms_sys_show_eta', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.ui.show_departures', prototypeKey: 'pms_sys_show_departures', class: 'PRESENTATION', schema: bool, default: true, audited: false }),

  // —— OPERATIONAL ——
  entry({
    key: 'pms.ops.auto_assign_rooms',
    prototypeKey: 'pms_sys_auto_assign_rooms',
    class: 'DOMAIN',
    schema: bool,
    default: true,
    consumersExempt: true,
  }),
  entry({ key: 'pms.ops.auto_assign_rule', prototypeKey: 'pms_sys_auto_assign_rule', class: 'OPERATIONAL', schema: str, default: 'ASSIGN_EXISTING_AND_FUTURE' }),
  entry({ key: 'pms.ops.auto_assign_rooming', prototypeKey: 'pms_sys_auto_assign_rooming', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.ops.default_guest_country', prototypeKey: 'pms_sys_default_guest_country', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.ops.expedia_recon', prototypeKey: 'pms_sys_expedia_recon', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.ops.gdpr', prototypeKey: 'pms_sys_gdpr', class: 'OPERATIONAL', schema: bool, default: false }),
  entry({ key: 'pms.ops.notifications', prototypeKey: 'pms_sys_notifications', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.ops.tags', prototypeKey: 'pms_sys_tags', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.property.policies', prototypeKey: 'pms_property_policies', class: 'OPERATIONAL', schema: json, default: {} }),
  entry({ key: 'pms.property.amenities_checklist', prototypeKey: 'pms_amenities_checklist', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.property.custom_amenities', prototypeKey: 'pms_custom_amenities', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.property.split_inventory', prototypeKey: 'pms_property_split_inventory', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.property.sources', prototypeKey: 'pms_property_sources', class: 'OPERATIONAL', schema: NamedList, default: [] }),
  entry({ key: 'pms.property.market_segments', prototypeKey: 'pms_property_market_segments', class: 'OPERATIONAL', schema: NamedList, default: [] }),
  entry({ key: 'pms.guests.settings', prototypeKey: 'pms_guest_settings', class: 'OPERATIONAL', schema: json, default: {}, scope: 'org' }),
  entry({ key: 'pms.marketplace.connections', prototypeKey: 'pms_marketplace_connections', class: 'OPERATIONAL', schema: json, default: {}, scope: 'org' }),
  entry({ key: 'pms.email.optin_headline', prototypeKey: 'pms_optin_headline', class: 'PRESENTATION', schema: str, default: '', audited: false }),
  entry({ key: 'pms.email.optin_disclaimer', prototypeKey: 'pms_optin_disclaimer', class: 'PRESENTATION', schema: str, default: '', audited: false }),
  entry({ key: 'pms.email.optin_thankyou', prototypeKey: 'pms_optin_thankyou', class: 'PRESENTATION', schema: str, default: '', audited: false }),
  entry({ key: 'pms.email.optin_double', prototypeKey: 'pms_optin_double', class: 'OPERATIONAL', schema: bool, default: false }),
  entry({ key: 'pms.email.optin_booking_default', prototypeKey: 'pms_optin_booking_default', class: 'OPERATIONAL', schema: str, default: 'OPT_OUT' }),
  entry({ key: 'pms.email.schedules', prototypeKey: 'pms_email_schedules', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.finance.cc_brands', prototypeKey: 'pms_finance_cc_brands', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.finance.suggest_store_cc', prototypeKey: 'pms_finance_suggest_store_cc', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.finance.cc_matrix', prototypeKey: 'pms_finance_cc_matrix', class: 'OPERATIONAL', schema: json, default: {} }),
  entry({ key: 'pms.finance.paypal_enabled', prototypeKey: 'pms_finance_paypal_enabled', class: 'OPERATIONAL', schema: bool, default: false }),
  entry({ key: 'pms.finance.paypal_mode', prototypeKey: 'pms_finance_paypal_mode', class: 'OPERATIONAL', schema: z.enum(['sandbox', 'live']), default: 'sandbox' }),
  entry({ key: 'pms.finance.custom_pay_methods', prototypeKey: 'pms_finance_custom_pay_methods', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.finance.gateway_active', prototypeKey: 'pms_finance_gateway_active', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.finance.avs_be', prototypeKey: 'pms_finance_avs_be', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.finance.avs_direct', prototypeKey: 'pms_finance_avs_direct', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.finance.avs_existing', prototypeKey: 'pms_finance_avs_existing', class: 'OPERATIONAL', schema: bool, default: false }),
  entry({ key: 'pms.finance.avs_fallback', prototypeKey: 'pms_finance_avs_fallback', class: 'OPERATIONAL', schema: bool, default: true }),
  entry({ key: 'pms.finance.statement_desc', prototypeKey: 'pms_finance_statement_desc', class: 'OPERATIONAL', schema: str, default: 'HOSPAI' }),
  entry({ key: 'pms.finance.channel_routings', prototypeKey: 'pms_finance_channel_routings', class: 'OPERATIONAL', schema: json, default: [] }),
  entry({ key: 'pms.finance.bank_notes', prototypeKey: 'pms_finance_bank_notes', class: 'OPERATIONAL', schema: str, default: '' }),

  // Invoice PRESENTATION / OPERATIONAL
  entry({ key: 'pms.invoice.language', prototypeKey: 'pms_invoice_language', class: 'PRESENTATION', schema: str, default: 'English', audited: false }),
  entry({ key: 'pms.invoice.guest_lang', prototypeKey: 'pms_invoice_guest_lang', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.gen_mode', prototypeKey: 'pms_invoice_gen_mode', class: 'OPERATIONAL', schema: str, default: 'Automatically' }),
  entry({ key: 'pms.invoice.auto_trigger', prototypeKey: 'pms_invoice_auto_trigger', class: 'OPERATIONAL', schema: str, default: 'All' }),
  entry({ key: 'pms.invoice.title', prototypeKey: 'pms_invoice_title', class: 'PRESENTATION', schema: str, default: 'Invoice', audited: false }),
  entry({ key: 'pms.invoice.title_lang', prototypeKey: 'pms_invoice_title_lang', class: 'PRESENTATION', schema: str, default: '', audited: false }),
  entry({ key: 'pms.invoice.prefix', prototypeKey: 'pms_invoice_prefix', class: 'OPERATIONAL', schema: str, default: 'INV-' }),
  entry({ key: 'pms.invoice.starting_idx', prototypeKey: 'pms_invoice_starting_idx', class: 'OPERATIONAL', schema: z.number().int(), default: 1 }),
  entry({ key: 'pms.invoice.suffix', prototypeKey: 'pms_invoice_suffix', class: 'OPERATIONAL', schema: str, default: '' }),
  entry({ key: 'pms.invoice.footer', prototypeKey: 'pms_invoice_footer', class: 'PRESENTATION', schema: str, default: '', audited: false }),
  entry({ key: 'pms.invoice.show_company', prototypeKey: 'pms_inv_show_company', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.show_room', prototypeKey: 'pms_inv_show_room', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.show_taxfee', prototypeKey: 'pms_inv_show_taxfee', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.show_duedate', prototypeKey: 'pms_inv_show_duedate', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.show_package', prototypeKey: 'pms_inv_show_package', class: 'PRESENTATION', schema: bool, default: true, audited: false }),
  entry({ key: 'pms.invoice.date_rule', prototypeKey: 'pms_inv_date_rule', class: 'OPERATIONAL', schema: str, default: 'CHECKOUT' }),
  entry({ key: 'pms.invoice.compact', prototypeKey: 'pms_inv_compact', class: 'PRESENTATION', schema: bool, default: false, audited: false }),
  entry({ key: 'pms.invoice.use_guest_doc', prototypeKey: 'pms_inv_use_guest_doc', class: 'OPERATIONAL', schema: bool, default: false }),
  entry({ key: 'pms.invoice.allow_pending', prototypeKey: 'pms_inv_allow_pending', class: 'OPERATIONAL', schema: bool, default: false }),

  entry({ key: 'pms.booking_engine.settings', prototypeKey: 'pms_booking_engine_settings', class: 'OPERATIONAL', schema: json, default: {} }),
  entry({ key: 'pms.tickets.settings', prototypeKey: 'pms_tickets_settings', class: 'OPERATIONAL', schema: json, default: {} }),

  // —— SECRET ——
  entry({
    key: 'pms.finance.bank_name',
    prototypeKey: 'pms_finance_bank_name',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.bank_inst',
    prototypeKey: 'pms_finance_bank_inst',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.bank_routing',
    prototypeKey: 'pms_finance_bank_routing',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.bank_acct',
    prototypeKey: 'pms_finance_bank_acct',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.bank_swift',
    prototypeKey: 'pms_finance_bank_swift',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.paypal_merchant',
    prototypeKey: 'pms_finance_paypal_merchant',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.paypal_clientid',
    prototypeKey: 'pms_finance_paypal_clientid',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.finance.terminals',
    prototypeKey: 'pms_finance_terminals',
    class: 'SECRET',
    schema: json,
    default: [],
    secretDestination: 'payments',
  }),
  entry({
    key: 'pms.invoice.logo',
    prototypeKey: 'pms_invoice_logo',
    class: 'SECRET',
    schema: str,
    default: '',
    secretDestination: 'r2',
  }),
];

/** Prototype keys that map into booking_engine.settings bag fields treated as SECRET analytics. */
export const SECRET_NESTED_PROTOTYPE_FIELDS = [
  'pms_booking_engine_settings.analyticsConfig.ga4Id',
  'pms_booking_engine_settings.analyticsConfig.metaPixelId',
  'pms_booking_engine_settings.analyticsConfig.gtmId',
] as const;

export const PROTOTYPE_CONFIG_KEYS: string[] = [
  ...new Set(
    CONFIG_REGISTER.map((e) => e.prototypeKey).filter((k): k is string => k !== null),
  ),
].sort();

export function getConfigEntry(key: string): ConfigEntry | undefined {
  return CONFIG_REGISTER.find((e) => e.key === key);
}

export function domainConfigKeys(): ConfigEntry[] {
  return CONFIG_REGISTER.filter((e) => e.class === 'DOMAIN');
}

export function requiredPermissionForKey(key: string): Permission {
  const entry = getConfigEntry(key);
  if (!entry) throw new Error(`undeclared:${key}`);
  return entry.permission;
}

export function assertRegisterInvariants(): void {
  const keys = new Set<string>();
  for (const e of CONFIG_REGISTER) {
    if (keys.has(e.key)) throw new Error(`Duplicate config key: ${e.key}`);
    keys.add(e.key);
    if (e.class === 'DOMAIN' && !e.consumersExempt) {
      const c = e.consumers;
      if (!c.invalidatesAri && !c.reschedulesNightAudit && !c.rematerializesRates) {
        throw new Error(`DOMAIN key ${e.key} has no consumers`);
      }
    }
  }
}

export function isStructuredCloneable(value: unknown): boolean {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}
