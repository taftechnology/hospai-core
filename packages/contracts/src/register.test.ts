import { describe, expect, it } from 'vitest';
import {
  CONFIG_REGISTER,
  COMMAND_CATALOG,
  ENTITLEMENT_FAIL_CLOSED_OPT_OUT,
  EXCLUDED_PROTOTYPE_KEYS,
  PLATFORM_GAPS,
  PROTOTYPE_ACTIONS,
  PROTOTYPE_CONFIG_KEYS,
  V1_HTTP_ROUTE_AUDIT,
  assertRegisterInvariants,
  domainConfigKeys,
  isStructuredCloneable,
  requiredPermissionForKey,
} from './index.js';

/** Expected prototype config keys (88) — must match register.prototypeKey set. */
const EXPECTED_PROTOTYPE_KEYS = [
  'pms_amenities_checklist',
  'pms_booking_engine_settings',
  'pms_currencies_list',
  'pms_custom_amenities',
  'pms_email_schedules',
  'pms_finance_avs_be',
  'pms_finance_avs_direct',
  'pms_finance_avs_existing',
  'pms_finance_avs_fallback',
  'pms_finance_bank_acct',
  'pms_finance_bank_inst',
  'pms_finance_bank_name',
  'pms_finance_bank_notes',
  'pms_finance_bank_routing',
  'pms_finance_bank_swift',
  'pms_finance_cc_brands',
  'pms_finance_cc_matrix',
  'pms_finance_channel_routings',
  'pms_finance_custom_pay_methods',
  'pms_finance_gateway_active',
  'pms_finance_paypal_clientid',
  'pms_finance_paypal_enabled',
  'pms_finance_paypal_merchant',
  'pms_finance_paypal_mode',
  'pms_finance_statement_desc',
  'pms_finance_suggest_store_cc',
  'pms_finance_terminals',
  'pms_folio_configs',
  'pms_guest_settings',
  'pms_inv_allow_pending',
  'pms_inv_compact',
  'pms_inv_date_rule',
  'pms_inv_show_company',
  'pms_inv_show_duedate',
  'pms_inv_show_package',
  'pms_inv_show_room',
  'pms_inv_show_taxfee',
  'pms_inv_use_guest_doc',
  'pms_invoice_auto_trigger',
  'pms_invoice_footer',
  'pms_invoice_gen_mode',
  'pms_invoice_guest_lang',
  'pms_invoice_language',
  'pms_invoice_logo',
  'pms_invoice_prefix',
  'pms_invoice_starting_idx',
  'pms_invoice_suffix',
  'pms_invoice_title',
  'pms_invoice_title_lang',
  'pms_marketplace_connections',
  'pms_optin_booking_default',
  'pms_optin_disclaimer',
  'pms_optin_double',
  'pms_optin_headline',
  'pms_optin_thankyou',
  'pms_property_market_segments',
  'pms_property_policies',
  'pms_property_sources',
  'pms_property_split_inventory',
  'pms_sys_allow_overbooking',
  'pms_sys_app_language',
  'pms_sys_audit_time',
  'pms_sys_auto_assign_rooms',
  'pms_sys_auto_assign_rooming',
  'pms_sys_auto_assign_rule',
  'pms_sys_auto_extend',
  'pms_sys_auto_no_show',
  'pms_sys_booking_date_change',
  'pms_sys_breakfast_rule',
  'pms_sys_calendar_name_format',
  'pms_sys_currency_code',
  'pms_sys_currency_format',
  'pms_sys_date_format',
  'pms_sys_default_guest_country',
  'pms_sys_expedia_recon',
  'pms_sys_gdpr',
  'pms_sys_notifications',
  'pms_sys_payment_alloc',
  'pms_sys_require_prepayment',
  'pms_sys_same_day_bookings',
  'pms_sys_same_day_cutoff',
  'pms_sys_show_departures',
  'pms_sys_show_eta',
  'pms_sys_tags',
  'pms_sys_time_format',
  'pms_sys_time_zone',
  'pms_sys_week_start',
  'pms_tickets_settings',
] as const;

describe('config register', () => {
  it('passes invariants', () => {
    expect(() => assertRegisterInvariants()).not.toThrow();
  });

  it('classifies all 88 prototype config keys', () => {
    expect(EXPECTED_PROTOTYPE_KEYS).toHaveLength(88);
    expect(PROTOTYPE_CONFIG_KEYS).toEqual([...EXPECTED_PROTOTYPE_KEYS].sort());
    for (const k of EXPECTED_PROTOTYPE_KEYS) {
      expect(PROTOTYPE_CONFIG_KEYS).toContain(k);
    }
    for (const excluded of EXCLUDED_PROTOTYPE_KEYS) {
      expect(PROTOTYPE_CONFIG_KEYS).not.toContain(excluded);
    }
  });

  it('has DOMAIN keys with consumers', () => {
    const domain = domainConfigKeys();
    expect(domain.length).toBeGreaterThanOrEqual(10);
    for (const e of domain) {
      const c = e.consumers;
      expect(
        c.invalidatesAri || c.reschedulesNightAudit || c.rematerializesRates || e.consumersExempt,
      ).toBe(true);
    }
  });

  it('defaults are structured-cloneable', () => {
    for (const e of CONFIG_REGISTER) {
      expect(isStructuredCloneable(e.default)).toBe(true);
    }
  });
});

describe('command catalog', () => {
  it('covers all 35 prototype actions (splits may share or null the action)', () => {
    expect(PROTOTYPE_ACTIONS).toHaveLength(35);
    const covered = [
      ...new Set(
        COMMAND_CATALOG.map((c) => c.prototypeAction).filter((a): a is string => a !== null),
      ),
    ].sort();
    expect(covered).toEqual([...PROTOTYPE_ACTIONS].sort());
  });

  it('encodes degraded classes in the catalog — not prose notes (§4.6)', () => {
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.authorize')?.degraded).toBe('FAIL_CLOSED');
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.degraded).toBe('FAIL_CLOSED');
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.split_charge_payment')?.degraded).toBe(
      'FAIL_CLOSED',
    );
    // Check-in/out commute → QUEUE_PROVISIONAL per §4.6 table
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.check_in')?.degraded).toBe(
      'QUEUE_PROVISIONAL',
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.check_out')?.degraded).toBe(
      'QUEUE_PROVISIONAL',
    );
    // Inventory-affecting status paths fail closed
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.cancel')?.degraded).toBe(
      'FAIL_CLOSED',
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.no_show')?.degraded).toBe(
      'FAIL_CLOSED',
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.add_item')?.degraded).toBe(
      'QUEUE_PROVISIONAL',
    );
  });

  it('mutating non-shell commands are idempotent', () => {
    for (const c of COMMAND_CATALOG) {
      if (c.lane === 'SHELL') continue;
      expect(c.idempotent).toBe(true);
      expect(c.degraded).not.toBe('N/A');
    }
  });

  it('documents platform gaps', () => {
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('availability.book');
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('config.put_domain');
    expect(PLATFORM_GAPS.length).toBeGreaterThanOrEqual(3);
  });

  it('inventory.delete_room_type emits availability.changed', () => {
    const c = COMMAND_CATALOG.find((x) => x.id === 'inventory.delete_room_type');
    expect(c?.events).toEqual(['inventory.room_type_changed', 'availability.changed']);
  });

  it('room status commands declare only room.status_changed (no availability.changed)', () => {
    // Catalog events[] is documentation-only today (entitlements-check reads emptiness,
    // not names). This assertion is what makes the §2.1 honesty fix survive the next edit.
    for (const id of ['rooms.update_status', 'rooms.bulk_update_status'] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.events, id).toEqual(['room.status_changed']);
    }
  });

  it('reservations.assign_room is FAIL_CLOSED with pms.core', () => {
    const c = COMMAND_CATALOG.find((x) => x.id === 'reservations.assign_room');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
  });

  it('rooms.create and rooms.update are FAIL_CLOSED net-new surface', () => {
    for (const id of ['rooms.create', 'rooms.update'] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('inventory:write');
      expect(c?.prototypeAction).toBeNull();
      expect(c?.notes).toMatch(/net-new surface/i);
    }
  });

  it('rates plan commands are FAIL_CLOSED with pms.core and no opt-out', () => {
    const ids = [
      'rates.create_plan',
      'rates.update_plan',
      'rates.delete_plan',
      'rates.update_room_type_rate',
      'rates.bulk_update',
    ] as const;
    for (const id of ids) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('rates:write');
      expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((r) => r.id === id)).toBe(false);
    }
  });

  it('rates.update_room_type_rate and rates.bulk_update emit rate.changed', () => {
    for (const id of ['rates.update_room_type_rate', 'rates.bulk_update'] as const) {
      expect(COMMAND_CATALOG.find((x) => x.id === id)?.events).toEqual(['rate.changed']);
    }
  });

  it('rates.create_plan / update_plan / delete_plan emit rate_plan.changed', () => {
    for (const id of ['rates.create_plan', 'rates.update_plan', 'rates.delete_plan'] as const) {
      expect(COMMAND_CATALOG.find((x) => x.id === id)?.events).toEqual(['rate_plan.changed']);
    }
  });

  it('guests.create and guests.update are FAIL_CLOSED with identical revisit notes', () => {
    const create = COMMAND_CATALOG.find((c) => c.id === 'guests.create');
    const update = COMMAND_CATALOG.find((c) => c.id === 'guests.update');
    expect(create?.degraded).toBe('FAIL_CLOSED');
    expect(update?.degraded).toBe('FAIL_CLOSED');
    expect(create?.entitlement).toBe('pms.core');
    expect(update?.entitlement).toBe('pms.core');
    expect(create?.notes).toBe(update?.notes);
    expect(create?.notes).toMatch(/KV permission projection/i);
    expect(create?.notes).toMatch(/pre-handler permission gate/i);
  });

  it('guests.erase remains FAIL_CLOSED with guests:erase', () => {
    const c = COMMAND_CATALOG.find((x) => x.id === 'guests.erase');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.permission).toBe('guests:erase');
  });

  it('DOMAIN keys: exactly two inventory:configure; rest settings:configure', () => {
    const domain = domainConfigKeys();
    const inventory = domain
      .filter((e) => e.permission === 'inventory:configure')
      .map((e) => e.key)
      .sort();
    expect(inventory).toEqual([
      'pms.availability.allow_overbooking',
      'pms.availability.oversell_allowance',
    ]);
    for (const e of domain) {
      if (!inventory.includes(e.key)) {
        expect(e.permission, e.key).toBe('settings:configure');
      }
    }
  });

  it('requiredPermissionForKey mirrors register for inventory and settings keys', () => {
    expect(requiredPermissionForKey('pms.availability.allow_overbooking')).toBe('inventory:configure');
    expect(requiredPermissionForKey('pms.time.time_zone')).toBe('settings:configure');
  });

  it('property.update_details is FAIL_CLOSED with tenancy opt-out; config.put_domain uses settings:configure', () => {
    const details = COMMAND_CATALOG.find((c) => c.id === 'property.update_details');
    expect(details?.degraded).toBe('FAIL_CLOSED');
    expect(details?.permission).toBe('config:write');
    expect(details?.entitlement).toBeUndefined();
    expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((r) => r.id === 'property.update_details')).toBe(true);
    const opt = ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((r) => r.id === 'property.update_details');
    expect(opt?.reason).toMatch(/Tenancy metadata/i);
    expect(opt?.reason).not.toMatch(/not yet gated at a DO boundary/i);

    const put = COMMAND_CATALOG.find((c) => c.id === 'config.put_domain');
    expect(put?.permission).toBe('settings:configure');
    expect(put?.degraded).toBe('FAIL_CLOSED');
  });

  it('route audit 43–44 are patch_property_details then put_domain_config', () => {
    expect(V1_HTTP_ROUTE_AUDIT[43]?.id).toBe('patch_property_details');
    expect(V1_HTTP_ROUTE_AUDIT[44]?.id).toBe('put_domain_config');
    expect(V1_HTTP_ROUTE_AUDIT[43]).toMatchObject({
      scope: 'property',
      permission: 'config:write',
      commandId: 'property.update_details',
    });
    expect(V1_HTTP_ROUTE_AUDIT[44]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      commandId: 'config.put_domain',
    });
  });

  it('payment commands are entitled and route audit 45–49 are payment routes', () => {
    for (const id of ['folio.authorize', 'folio.capture', 'folio.split_charge_payment'] as const) {
      expect(COMMAND_CATALOG.find((c) => c.id === id)?.entitlement).toBe('pms.core');
      expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === id)).toBeUndefined();
    }
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.events).toEqual([
      'folio.payment_captured',
      'folio.line_posted',
    ]);
    expect(V1_HTTP_ROUTE_AUDIT[45]?.id).toBe('post_folio_authorize');
    expect(V1_HTTP_ROUTE_AUDIT[46]?.id).toBe('post_folio_capture');
    expect(V1_HTTP_ROUTE_AUDIT[47]?.id).toBe('post_folio_split_payment');
    expect(V1_HTTP_ROUTE_AUDIT[48]?.id).toBe('get_folio_payment');
    expect(V1_HTTP_ROUTE_AUDIT[49]?.id).toBe('get_folio_payments');
    expect(PLATFORM_GAPS.find((g) => g.id === 'folio.split_charge_v2')?.reason).toMatch(
      /window|transfer/i,
    );
  });

  it('charge code commands are FAIL_CLOSED with settings:configure and charge_code.changed', () => {
    for (const id of [
      'folio.create_charge_code',
      'folio.update_charge_code',
      'folio.set_charge_code_status',
    ] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('settings:configure');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.events).toEqual(['charge_code.changed']);
    }
    expect(V1_HTTP_ROUTE_AUDIT[50]?.id).toBe('post_charge_codes');
    expect(V1_HTTP_ROUTE_AUDIT[51]?.id).toBe('patch_charge_code');
    expect(V1_HTTP_ROUTE_AUDIT[52]?.id).toBe('put_charge_code_status');
    expect(V1_HTTP_ROUTE_AUDIT[53]?.id).toBe('get_charge_codes');
    expect(V1_HTTP_ROUTE_AUDIT[53]).toMatchObject({
      permission: 'folio:read',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[53] ?? {})).toBe(false);
  });

  it('tax rule commands are FAIL_CLOSED with settings:configure and tax_rule.changed', () => {
    for (const id of ['folio.create_tax_rule', 'folio.supersede_tax_rule'] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('settings:configure');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.events).toEqual(['tax_rule.changed']);
    }
    expect(V1_HTTP_ROUTE_AUDIT[54]?.id).toBe('post_tax_rules');
    expect(V1_HTTP_ROUTE_AUDIT[55]?.id).toBe('put_tax_rule_supersede');
    expect(V1_HTTP_ROUTE_AUDIT[56]?.id).toBe('get_tax_rules');
    expect(V1_HTTP_ROUTE_AUDIT[56]).toMatchObject({
      permission: 'folio:read',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[56] ?? {})).toBe(false);
  });
});

describe('DOMAIN keys vs eslint prefixes', () => {
  it('every DOMAIN key matches an eslint-plugin-hospai DOMAIN_KEY_PREFIX', () => {
    // Keep in sync with tooling/eslint-plugin-hospai/src/index.ts DOMAIN_KEY_PREFIXES
    const prefixes = [
      'pms.availability',
      'pms.time',
      'pms.night_audit',
      'pms.booking',
      'pms.money',
      'pms.folio',
    ];
    for (const e of domainConfigKeys()) {
      expect(
        prefixes.some((p) => e.key === p || e.key.startsWith(`${p}.`)),
        `${e.key} missing from eslint DOMAIN_KEY_PREFIXES`,
      ).toBe(true);
    }
  });
});
