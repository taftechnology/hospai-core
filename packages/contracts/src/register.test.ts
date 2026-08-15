import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_WRITER_COMMAND_IDS,
  AUDIT_WRITER_EXEMPTIONS,
  CONFIG_REGISTER,
  COMMAND_CATALOG,
  INVENTORY_FAIL_CLOSED_NOTES,
  ENTITLEMENT_FAIL_CLOSED_OPT_OUT,
  EXCLUDED_PROTOTYPE_KEYS,
  PLATFORM_GAPS,
  PROTOTYPE_ACTIONS,
  PROTOTYPE_ACTIONS_AS_SIDE_EFFECT,
  PROTOTYPE_CONFIG_KEYS,
  V1_HTTP_ROUTE_AUDIT,
  assertRegisterInvariants,
  domainConfigKeys,
  getConfigEntry,
  isStructuredCloneable,
  requiredPermissionForKey,
} from './index.js';

/** Expected prototype config keys (97) — must match register.prototypeKey set. */
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
  'pms_folio_auto_capture_checkout',
  'pms_folio_close_on_checkout',
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
  'pms_payments_auth_hold_hours',
  'pms_property_market_segments',
  'pms_property_policies',
  'pms_property_sources',
  'pms_property_split_inventory',
  'pms_res_allow_balance_override',
  'pms_res_allow_dirty_override',
  'pms_res_check_in_cleanliness',
  'pms_res_checkout_zero_bal',
  'pms_res_inquiry_ttl_days',
  'pms_res_pending_hold_hours',
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

  it('pms.ops.auto_assign_rooms is DOMAIN + consumersExempt (property-setup SPA)', () => {
    const entry = getConfigEntry('pms.ops.auto_assign_rooms');
    expect(entry?.class).toBe('DOMAIN');
    expect(entry?.consumersExempt).toBe(true);
    expect(entry?.default).toBe(true);
    expect(entry?.permission).toBe('settings:configure');
    expect(() => assertRegisterInvariants()).not.toThrow();

    const extend = getConfigEntry('pms.night_audit.auto_extend');
    expect(extend?.class).toBe('DOMAIN');
    expect(getConfigEntry('pms.ops.auto_assign_rule')?.class).toBe('OPERATIONAL');
    expect(getConfigEntry('pms.ops.auto_assign_rooming')?.class).toBe('OPERATIONAL');
  });

  it('classifies all 97 prototype config keys', () => {
    expect(EXPECTED_PROTOTYPE_KEYS).toHaveLength(97);
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
  it('covers all 35 prototype actions (catalog ∪ side-effect exemptions)', () => {
    expect(PROTOTYPE_ACTIONS).toHaveLength(35);
    expect(PROTOTYPE_ACTIONS).toContain('ADD_AUDIT_LOG');
    expect(PROTOTYPE_ACTIONS_AS_SIDE_EFFECT).toEqual([
      {
        action: 'ADD_AUDIT_LOG',
        reason: expect.stringMatching(/side effect|same-txn|not a dispatchable/i),
      },
    ]);
    const covered = [
      ...new Set(
        COMMAND_CATALOG.map((c) => c.prototypeAction).filter((a): a is string => a !== null),
      ),
    ];
    const side = PROTOTYPE_ACTIONS_AS_SIDE_EFFECT.map((s) => s.action);
    expect(covered).not.toContain('ADD_AUDIT_LOG');
    const union = [...new Set([...covered, ...side])].sort();
    expect(union).toEqual([...PROTOTYPE_ACTIONS].sort());
  });

  it('side-effect exemption does not swallow other missing prototype actions', () => {
    const covered = [
      ...new Set(
        COMMAND_CATALOG.map((c) => c.prototypeAction).filter((a): a is string => a !== null),
      ),
    ];
    const side = PROTOTYPE_ACTIONS_AS_SIDE_EFFECT.map((s) => s.action);
    const coveredMinusGuest = covered.filter((a) => a !== 'ADD_GUEST');
    const broken = [...new Set([...coveredMinusGuest, ...side])].sort();
    expect(broken).not.toEqual([...PROTOTYPE_ACTIONS].sort());
  });

  it('audit.append is retired from the catalog', () => {
    expect(COMMAND_CATALOG.find((c) => c.id === 'audit.append')).toBeUndefined();
    expect(COMMAND_CATALOG.flatMap((c) => c.events)).not.toContain('audit.recorded');
  });

  it('catalog has no housekeeping.staff_* and no staff.housekeeper_changed', () => {
    expect(COMMAND_CATALOG.map((c) => c.id)).not.toEqual(
      expect.arrayContaining([
        'housekeeping.staff_add',
        'housekeeping.staff_status',
        'housekeeping.staff_delete',
        'housekeeping.staff_update',
      ]),
    );
    expect(COMMAND_CATALOG.flatMap((c) => c.events)).not.toContain('staff.housekeeper_changed');
  });

  it('roster.* family records §4.8 notes; add/update/status share ROSTER_FAIL_CLOSED_NOTES', () => {
    const add = COMMAND_CATALOG.find((c) => c.id === 'roster.add');
    const update = COMMAND_CATALOG.find((c) => c.id === 'roster.update');
    const status = COMMAND_CATALOG.find((c) => c.id === 'roster.status');
    const exit = COMMAND_CATALOG.find((c) => c.id === 'roster.exit');
    for (const c of [add, update, status, exit]) {
      expect(c?.permission).toBe('roster:write');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.notes).toMatch(/Staff-class PII/i);
      expect(c?.notes).toMatch(/membership staff\.\*/i);
    }
    expect(add?.events).toEqual(['roster.created']);
    expect(update?.events).toEqual(['roster.updated']);
    expect(status?.events).toEqual(['roster.updated']);
    expect(exit?.events).toEqual(['roster.exited']);
    expect(add?.notes).toBe(update?.notes);
    expect(add?.notes).toBe(status?.notes);
    expect(add?.notes).toMatch(/KV permission projection/i);
    expect(add?.notes).toMatch(/minted staff_/i);
    expect(exit?.notes).toMatch(/pseudonymize/i);
    expect(exit?.notes).not.toBe(add?.notes);
  });

  it('HOUSEKEEPING_STAFF_FAMILY_NOTES is gone', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'commands/catalog.ts'), 'utf8');
    expect(src).not.toMatch(/HOUSEKEEPING_STAFF_FAMILY_NOTES/);
  });

  it('every entitled command has an audit writer or a reasoned exemption', () => {
    const entitled = COMMAND_CATALOG.filter((c) => c.entitlement).map((c) => c.id);
    const exemptIds = new Set(AUDIT_WRITER_EXEMPTIONS.map((e) => e.id));
    for (const id of entitled) {
      const inWriters = AUDIT_WRITER_COMMAND_IDS.has(id);
      const inExempt = exemptIds.has(id);
      expect(inWriters || inExempt, `missing writer/exemption for ${id}`).toBe(true);
      expect(inWriters && inExempt, `both writer and exemption for ${id}`).toBe(false);
    }
    for (const id of AUDIT_WRITER_COMMAND_IDS) {
      expect(entitled, `writer ${id} is not entitled`).toContain(id);
    }
    for (const e of AUDIT_WRITER_EXEMPTIONS) {
      expect(e.reason.length).toBeGreaterThan(10);
      expect(entitled, `exemption ${e.id} is not entitled`).toContain(e.id);
    }
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(56);
  });

  it('provisional workbench commands are entitled FAIL_CLOSED night_audit:run', () => {
    for (const id of [
      'provisional.retry_exception',
      'provisional.assign_exception',
      'provisional.add_exception_note',
    ] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.lane).toBe('INTERACTIVE');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('night_audit:run');
      expect(c?.idempotent).toBe(true);
      expect(c?.prototypeAction).toBeNull();
      expect(AUDIT_WRITER_COMMAND_IDS.has(id)).toBe(true);
    }
    expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.retry_exception')?.events).toEqual([
      'provisional.exception_retried',
      'provisional.exception_resolved',
    ]);
    expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.assign_exception')?.events).toEqual([
      'provisional.exception_assigned',
    ]);
    expect(COMMAND_CATALOG.find((c) => c.id === 'provisional.add_exception_note')?.events).toEqual([
      'provisional.exception_noted',
    ]);
    const resolve = COMMAND_CATALOG.find((c) => c.id === 'provisional.resolve_exception');
    expect(resolve?.events).toEqual(['provisional.exception_resolved']);
    expect(resolve?.notes).toMatch(/Not a replay/i);
  });

  it('night_audit operator commands are entitled FAIL_CLOSED; run opt-out stays', () => {
    const retry = COMMAND_CATALOG.find((c) => c.id === 'night_audit.retry_step');
    const halt = COMMAND_CATALOG.find((c) => c.id === 'night_audit.resolve_halt');
    const resolve = COMMAND_CATALOG.find((c) => c.id === 'provisional.resolve_exception');
    const run = COMMAND_CATALOG.find((c) => c.id === 'night_audit.run');
    for (const c of [retry, halt, resolve]) {
      expect(c?.lane).toBe('INTERACTIVE');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('night_audit:run');
      expect(c?.idempotent).toBe(true);
    }
    expect(retry?.events).toEqual(['night_audit.step_retried']);
    expect(halt?.events).toEqual(['night_audit.halt_resolved']);
    expect(resolve?.events).toEqual(['provisional.exception_resolved']);
    expect(run?.events).toEqual(['night_audit.started', 'night_audit.completed']);
    expect(run).not.toHaveProperty('entitlement');
    expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === 'night_audit.run')?.reason).toMatch(
      /background alarm path/i,
    );
    expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.retry_step')).toBe(true);
    expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.resolve_halt')).toBe(true);
    expect(AUDIT_WRITER_COMMAND_IDS.has('provisional.resolve_exception')).toBe(true);
    expect(AUDIT_WRITER_COMMAND_IDS.has('night_audit.run')).toBe(false);
  });

  it('PropertyDO source wires every AUDIT_WRITER_COMMAND_IDS literal', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, '../../../apps/pms-core/src/property-do.ts'),
      'utf8',
    );
    for (const id of AUDIT_WRITER_COMMAND_IDS) {
      expect(src.includes(`'${id}'`) || src.includes(`"${id}"`), `missing wire for ${id}`).toBe(
        true,
      );
    }
  });

  it('get_audit_log is route audit 61', () => {
    expect(V1_HTTP_ROUTE_AUDIT[61]?.id).toBe('get_audit_log');
    expect(V1_HTTP_ROUTE_AUDIT[61]).toMatchObject({
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[61] ?? {})).toBe(false);
  });

  it('front-desk read routes append at 62–67; exception count renamed at 19', () => {
    expect(V1_HTTP_ROUTE_AUDIT[19]?.id).toBe('get_provisional_exception_count');
    expect(V1_HTTP_ROUTE_AUDIT[19]).toMatchObject({
      scope: 'property',
      permission: 'property:read',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[19] ?? {})).toBe(false);

    expect(V1_HTTP_ROUTE_AUDIT[43]?.id).toBe('patch_property_details');
    expect(V1_HTTP_ROUTE_AUDIT[44]?.id).toBe('put_domain_config');

    expect(V1_HTTP_ROUTE_AUDIT[62]?.id).toBe('get_front_desk_arrivals');
    expect(V1_HTTP_ROUTE_AUDIT[62]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[62] ?? {})).toBe(false);

    expect(V1_HTTP_ROUTE_AUDIT[63]?.id).toBe('get_front_desk_departures');
    expect(V1_HTTP_ROUTE_AUDIT[64]?.id).toBe('get_front_desk_in_house');
    expect(V1_HTTP_ROUTE_AUDIT[65]?.id).toBe('post_guests_batch');
    expect(V1_HTTP_ROUTE_AUDIT[65]).toMatchObject({
      permission: 'guests:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect(V1_HTTP_ROUTE_AUDIT[66]?.id).toBe('get_org_entitlements');
    expect(V1_HTTP_ROUTE_AUDIT[66]).toMatchObject({
      scope: 'org',
      permission: 'org:read',
    });
    expect('degradedRead' in (V1_HTTP_ROUTE_AUDIT[66] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[67]?.id).toBe('get_front_desk_shift');
    expect(V1_HTTP_ROUTE_AUDIT[67]).toMatchObject({
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect(V1_HTTP_ROUTE_AUDIT[68]?.id).toBe('get_front_desk_recent_shifts');
    expect(V1_HTTP_ROUTE_AUDIT[68]).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[68] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[69]?.id).toBe('get_property_me');
    expect(V1_HTTP_ROUTE_AUDIT[69]).toMatchObject({
      scope: 'property',
      permission: 'property:read',
      degradedRead: 'FAIL_CLOSED',
    });
    expect(V1_HTTP_ROUTE_AUDIT[69]).not.toHaveProperty('entitlement');
    expect(V1_HTTP_ROUTE_AUDIT[69]).not.toHaveProperty('commandId');

    const membershipIds = [
      'list_org_members',
      'create_org_member',
      'update_org_member',
      'delete_org_member',
      'list_property_members',
      'create_property_member',
      'update_property_member',
      'delete_property_member',
    ] as const;
    for (let i = 0; i < membershipIds.length; i++) {
      const row = V1_HTTP_ROUTE_AUDIT[70 + i];
      expect(row?.id).toBe(membershipIds[i]);
      expect(row).not.toHaveProperty('entitlement');
      expect(row).not.toHaveProperty('commandId');
      expect(row).not.toHaveProperty('degradedRead');
    }
    expect(V1_HTTP_ROUTE_AUDIT[70]).toMatchObject({ scope: 'org', permission: 'org:manage' });
    expect(V1_HTTP_ROUTE_AUDIT[71]).toMatchObject({ scope: 'org', permission: 'org:manage' });
    expect(V1_HTTP_ROUTE_AUDIT[72]).toMatchObject({ scope: 'org', permission: 'org:manage' });
    expect(V1_HTTP_ROUTE_AUDIT[73]).toMatchObject({ scope: 'org', permission: 'org:manage' });
    expect(V1_HTTP_ROUTE_AUDIT[74]).toMatchObject({ scope: 'property', permission: 'staff:read' });
    expect(V1_HTTP_ROUTE_AUDIT[75]).toMatchObject({ scope: 'property', permission: 'staff:write' });
    expect(V1_HTTP_ROUTE_AUDIT[76]).toMatchObject({ scope: 'property', permission: 'staff:write' });
    expect(V1_HTTP_ROUTE_AUDIT[77]).toMatchObject({ scope: 'property', permission: 'staff:write' });
  });

  it('roster HTTP routes append at 80–85', () => {
    expect(V1_HTTP_ROUTE_AUDIT[80]?.id).toBe('get_roster');
    expect(V1_HTTP_ROUTE_AUDIT[81]?.id).toBe('get_roster_one');
    expect(V1_HTTP_ROUTE_AUDIT[82]?.id).toBe('post_roster');
    expect(V1_HTTP_ROUTE_AUDIT[83]?.id).toBe('patch_roster');
    expect(V1_HTTP_ROUTE_AUDIT[84]?.id).toBe('post_roster_status');
    expect(V1_HTTP_ROUTE_AUDIT[85]?.id).toBe('post_roster_exit');
    expect(V1_HTTP_ROUTE_AUDIT[80]).toMatchObject({
      scope: 'property',
      permission: 'roster:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[80] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[82]).toMatchObject({
      scope: 'property',
      permission: 'roster:write',
      commandId: 'roster.add',
      entitlement: 'pms.core',
    });
  });

  it('night-audit HTTP routes append at 86–91', () => {
    expect(V1_HTTP_ROUTE_AUDIT[85]?.id).toBe('post_roster_exit');
    expect(V1_HTTP_ROUTE_AUDIT[86]?.id).toBe('get_night_audit');
    expect(V1_HTTP_ROUTE_AUDIT[87]?.id).toBe('get_night_audit_report');
    expect(V1_HTTP_ROUTE_AUDIT[88]?.id).toBe('post_night_audit_run');
    expect(V1_HTTP_ROUTE_AUDIT[89]?.id).toBe('post_night_audit_retry');
    expect(V1_HTTP_ROUTE_AUDIT[90]?.id).toBe('post_night_audit_resolve_halt');
    expect(V1_HTTP_ROUTE_AUDIT[91]?.id).toBe('post_provisional_exception_resolve');
    expect(V1_HTTP_ROUTE_AUDIT[86]).toMatchObject({
      scope: 'property',
      permission: 'night_audit:run',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[86] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[88]).toMatchObject({
      commandId: 'night_audit.run',
      entitlement: 'pms.core',
      permission: 'night_audit:run',
    });
    expect(V1_HTTP_ROUTE_AUDIT[91]).toMatchObject({
      commandId: 'provisional.resolve_exception',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[92]?.id).toBe('post_reservation_confirm');
    expect(V1_HTTP_ROUTE_AUDIT[93]?.id).toBe('post_reservation_hold');
    expect(V1_HTTP_ROUTE_AUDIT[94]?.id).toBe('post_reservation_front_office');
    expect(V1_HTTP_ROUTE_AUDIT[95]?.id).toBe('post_folio_window');
    expect(V1_HTTP_ROUTE_AUDIT[103]?.id).toBe('post_folio_capture_due');
    expect(V1_HTTP_ROUTE_AUDIT[104]?.id).toBe('post_room_ooo_range');
    expect(V1_HTTP_ROUTE_AUDIT[104]).toMatchObject({
      permission: 'inventory:write',
      commandId: 'rooms.set_ooo_range',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[105]?.id).toBe('get_reservation_search');
    expect(V1_HTTP_ROUTE_AUDIT[105]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[105] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[106]?.id).toBe('post_fx_rates');
    expect(V1_HTTP_ROUTE_AUDIT[107]?.id).toBe('post_fx_rate_supersede');
    expect(V1_HTTP_ROUTE_AUDIT[108]?.id).toBe('get_fx_rates');
    expect(V1_HTTP_ROUTE_AUDIT[109]?.id).toBe('post_folio_chargeback');
    expect(V1_HTTP_ROUTE_AUDIT[110]?.id).toBe('post_folio_fx_adjustment');
    expect(V1_HTTP_ROUTE_AUDIT[111]?.id).toBe('get_room_types');
    expect(V1_HTTP_ROUTE_AUDIT[111]).toMatchObject({
      scope: 'property',
      permission: 'inventory:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[111] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[112]?.id).toBe('get_rate_days');
    expect(V1_HTTP_ROUTE_AUDIT[112]).toMatchObject({
      scope: 'property',
      permission: 'rates:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[112] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[113]?.id).toBe('get_restriction_days');
    expect(V1_HTTP_ROUTE_AUDIT[113]).toMatchObject({
      scope: 'property',
      permission: 'rates:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[113] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[114]?.id).toBe('get_domain_config');
    expect(V1_HTTP_ROUTE_AUDIT[114]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[114] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[115]?.id).toBe('get_front_desk_tape');
    expect(V1_HTTP_ROUTE_AUDIT[115]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[115] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[116]?.id).toBe('get_front_desk_directory');
    expect(V1_HTTP_ROUTE_AUDIT[116]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[116] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[117]?.id).toBe('get_front_desk_available_rooms');
    expect(V1_HTTP_ROUTE_AUDIT[117]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[117] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[118]?.id).toBe('get_front_desk_summary');
    expect(V1_HTTP_ROUTE_AUDIT[118]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[118] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[119]?.id).toBe('get_front_desk_stream');
    expect(V1_HTTP_ROUTE_AUDIT[119]).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[119] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[120]?.id).toBe('get_provisional_exception');
    expect(V1_HTTP_ROUTE_AUDIT[120]).toMatchObject({
      scope: 'property',
      permission: 'property:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[120] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[121]?.id).toBe('post_provisional_exception_retry');
    expect(V1_HTTP_ROUTE_AUDIT[121]).toMatchObject({
      scope: 'property',
      permission: 'night_audit:run',
      commandId: 'provisional.retry_exception',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[122]?.id).toBe('post_provisional_exception_assign');
    expect(V1_HTTP_ROUTE_AUDIT[122]).toMatchObject({
      scope: 'property',
      permission: 'night_audit:run',
      commandId: 'provisional.assign_exception',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[123]?.id).toBe('post_provisional_exception_note');
    expect(V1_HTTP_ROUTE_AUDIT[123]).toMatchObject({
      scope: 'property',
      permission: 'night_audit:run',
      commandId: 'provisional.add_exception_note',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[124]?.id).toBe('get_guests');
    expect(V1_HTTP_ROUTE_AUDIT[125]?.id).toBe('post_guests_search');
    expect(V1_HTTP_ROUTE_AUDIT[126]?.id).toBe('get_guest_stays');
    for (const i of [124, 125, 126] as const) {
      expect(V1_HTTP_ROUTE_AUDIT[i]).toMatchObject({
        scope: 'property',
        permission: 'guests:read',
        entitlement: 'pms.core',
        degradedRead: 'FAIL_CLOSED',
      });
      expect('commandId' in (V1_HTTP_ROUTE_AUDIT[i] ?? {})).toBe(false);
    }
    expect(V1_HTTP_ROUTE_AUDIT[126]?.id).toBe('get_guest_stays');
    expect(V1_HTTP_ROUTE_AUDIT[127]?.id).toBe('post_demo_seed');
    expect(V1_HTTP_ROUTE_AUDIT[127]).toMatchObject({ scope: 'dev' });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
    expect('permission' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
    expect('entitlement' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
    expect('degradedRead' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[101]?.id).toBe('post_folio_refund');
    expect(V1_HTTP_ROUTE_AUDIT[102]?.id).toBe('post_folio_discount');
    expect(V1_HTTP_ROUTE_AUDIT[102]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'folio.post_discount',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[128]?.id).toBe('post_folio_stay_discount');
    expect(V1_HTTP_ROUTE_AUDIT[128]).toMatchObject({
      scope: 'property',
      permission: 'folio:adjust',
      commandId: 'folio.post_discount',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[129]?.id).toBe('get_folio_routing_rules');
    expect(V1_HTTP_ROUTE_AUDIT[129]).toMatchObject({
      scope: 'property',
      permission: 'folio:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    expect('commandId' in (V1_HTTP_ROUTE_AUDIT[129] ?? {})).toBe(false);
    expect(V1_HTTP_ROUTE_AUDIT[130]?.id).toBe('put_folio_routing_rule');
    expect(V1_HTTP_ROUTE_AUDIT[130]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      commandId: 'folio.upsert_routing_rule',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[131]?.id).toBe('post_folio_routing_rule_archive');
    expect(V1_HTTP_ROUTE_AUDIT[131]).toMatchObject({
      scope: 'property',
      permission: 'settings:configure',
      commandId: 'folio.archive_routing_rule',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[132]?.id).toBe('delete_room');
    expect(V1_HTTP_ROUTE_AUDIT[132]).toMatchObject({
      scope: 'property',
      permission: 'inventory:write',
      commandId: 'rooms.delete',
      entitlement: 'pms.core',
    });
    expect(V1_HTTP_ROUTE_AUDIT[133]?.id).toBe('post_folio_reconcile_payment');
    expect(V1_HTTP_ROUTE_AUDIT[133]).toMatchObject({
      scope: 'property',
      permission: 'folio:post',
      commandId: 'folio.reconcile_payment',
      entitlement: 'pms.core',
    });
    expect(COMMAND_CATALOG.find((c) => c.id === 'demo.seed')).toBeUndefined();
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(56);
    expect(COMMAND_CATALOG).toHaveLength(81);
    expect(PLATFORM_GAPS).toEqual([]);
    for (const id of ['guests.search', 'guests.get_profile', 'guests.merge', 'guests.update_consent'] as const) {
      expect(COMMAND_CATALOG.find((c) => c.id === id)).toBeUndefined();
    }
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
    expect(COMMAND_CATALOG.find((c) => c.id === 'staff.update')?.degraded).toBe('FAIL_CLOSED');
  });

  it('staff.* FAIL_CLOSED commands share tenancy opt-out reason', () => {
    const STAFF_OPT_REASON =
      'Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership.';
    for (const id of ['staff.add', 'staff.update', 'staff.delete'] as const) {
      const row = ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === id);
      expect(row?.reason).toBe(STAFF_OPT_REASON);
    }
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
    expect(PLATFORM_GAPS).toEqual([]);
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

  it('inventory-affecting reservation commands share INVENTORY_FAIL_CLOSED_NOTES', () => {
    for (const id of [
      'reservations.create',
      'reservations.modify',
      'reservations.cancel',
      'reservations.no_show',
      'reservations.confirm',
      'reservations.hold',
    ] as const) {
      expect(COMMAND_CATALOG.find((c) => c.id === id)?.notes).toBe(INVENTORY_FAIL_CLOSED_NOTES);
    }
  });

  it('reservations.confirm / hold are entitled FAIL_CLOSED INTERACTIVE', () => {
    for (const id of ['reservations.confirm', 'reservations.hold'] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.lane).toBe('INTERACTIVE');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('reservations:write');
      expect(c?.events).toEqual(['reservation.status_changed', 'availability.changed']);
      expect(AUDIT_WRITER_COMMAND_IDS.has(id)).toBe(true);
    }
  });

  it('reservations.update_status and check_out emit the lifecycle events', () => {
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.update_status')?.notes).toMatch(/DND/i);
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.update_status')?.events).toEqual([
      'reservation.front_office_updated',
    ]);
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.check_out')?.events).toEqual([
      'reservation.status_changed',
      'room.status_changed',
      'folio.balance_due',
    ]);
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.check_in')?.events).toEqual([
      'reservation.status_changed',
      'reservation.room_assigned',
    ]);
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.cancel')?.events).toContain(
      'folio.line_posted',
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'reservations.no_show')?.events).toContain(
      'folio.line_posted',
    );
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
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.authorize')?.permission).toBe('folio:post');
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.permission).toBe('folio:post');
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.split_charge_payment')?.permission).toBe(
      'folio:adjust',
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.events).toEqual([
      'folio.payment_captured',
      'folio.line_posted',
      'payment.captured',
      'payment.failed',
    ]);
    expect(V1_HTTP_ROUTE_AUDIT[45]?.id).toBe('post_folio_authorize');
    expect(V1_HTTP_ROUTE_AUDIT[45]).toMatchObject({ permission: 'folio:post' });
    expect(V1_HTTP_ROUTE_AUDIT[46]?.id).toBe('post_folio_capture');
    expect(V1_HTTP_ROUTE_AUDIT[46]).toMatchObject({ permission: 'folio:post' });
    expect(V1_HTTP_ROUTE_AUDIT[47]?.id).toBe('post_folio_split_payment');
    expect(V1_HTTP_ROUTE_AUDIT[48]?.id).toBe('get_folio_payment');
    expect(V1_HTTP_ROUTE_AUDIT[49]?.id).toBe('get_folio_payments');
  });

  it('folio money-ops commands are entitled FAIL_CLOSED INTERACTIVE', () => {
    const rows: Array<{
      id: string;
      permission: 'folio:adjust' | 'folio:post';
      events: string[];
    }> = [
      { id: 'folio.open_window', permission: 'folio:adjust', events: ['folio.window_opened'] },
      { id: 'folio.close_window', permission: 'folio:adjust', events: ['folio.window_closed'] },
      { id: 'folio.reopen_window', permission: 'folio:adjust', events: ['folio.window_reopened'] },
      {
        id: 'folio.transfer_charge',
        permission: 'folio:adjust',
        events: ['folio.line_posted', 'folio.charge_transferred'],
      },
      { id: 'folio.split_charge_v2', permission: 'folio:adjust', events: ['folio.line_posted'] },
      { id: 'folio.void', permission: 'folio:post', events: ['folio.payment_voided'] },
      {
        id: 'folio.refund',
        permission: 'folio:adjust',
        events: ['folio.payment_refunded', 'folio.line_posted', 'payment.refunded'],
      },
      { id: 'folio.post_discount', permission: 'folio:adjust', events: ['folio.line_posted'] },
      {
        id: 'folio.capture_due',
        permission: 'folio:post',
        events: ['folio.payment_captured', 'folio.line_posted'],
      },
    ];
    for (const row of rows) {
      const c = COMMAND_CATALOG.find((x) => x.id === row.id);
      expect(c?.lane).toBe('INTERACTIVE');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.idempotent).toBe(true);
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe(row.permission);
      expect(c?.events).toEqual(row.events);
      expect(AUDIT_WRITER_COMMAND_IDS.has(row.id)).toBe(true);
      expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((e) => e.id === row.id)).toBe(false);
    }
  });

  it('multi-currency folio commands are entitled FAIL_CLOSED INTERACTIVE', () => {
    const rows = [
      { id: 'folio.create_fx_rate', permission: 'settings:configure', events: ['fx_rate.changed'] },
      { id: 'folio.supersede_fx_rate', permission: 'settings:configure', events: ['fx_rate.changed'] },
      {
        id: 'folio.post_fx_adjustment',
        permission: 'folio:adjust',
        events: ['folio.line_posted', 'folio.fx_adjusted'],
      },
      {
        id: 'folio.record_chargeback',
        permission: 'folio:adjust',
        events: ['payment.chargeback_received', 'folio.line_posted'],
      },
    ] as const;
    for (const row of rows) {
      const c = COMMAND_CATALOG.find((x) => x.id === row.id);
      expect(c?.lane).toBe('INTERACTIVE');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.idempotent).toBe(true);
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe(row.permission);
      expect(c?.events).toEqual([...row.events]);
      expect(AUDIT_WRITER_COMMAND_IDS.has(row.id)).toBe(true);
      expect(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.some((e) => e.id === row.id)).toBe(false);
    }
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.authorize')?.events).toEqual(
      expect.arrayContaining(['folio.payment_authorized', 'payment.authorized', 'payment.failed']),
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.capture')?.events).toEqual(
      expect.arrayContaining([
        'folio.payment_captured',
        'folio.line_posted',
        'payment.captured',
        'payment.failed',
      ]),
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.record_cash_payment')?.events).toEqual(
      expect.arrayContaining(['folio.payment_captured', 'folio.line_posted', 'payment.captured']),
    );
    expect(COMMAND_CATALOG.find((c) => c.id === 'folio.refund')?.events).toEqual(
      expect.arrayContaining(['folio.payment_refunded', 'folio.line_posted', 'payment.refunded']),
    );
  });

  it('PLATFORM_GAPS is empty after rooms.set_ooo_range promotion', () => {
    expect(PLATFORM_GAPS).toEqual([]);
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.transfer_charge');
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('folio.split_charge_v2');
    expect(PLATFORM_GAPS.map((g) => g.id)).not.toContain('rooms.set_ooo_range');
  });

  it('rooms.set_ooo_range is entitled FAIL_CLOSED INTERACTIVE inventory:write', () => {
    const c = COMMAND_CATALOG.find((x) => x.id === 'rooms.set_ooo_range');
    expect(c?.prototypeAction).toBeNull();
    expect(c?.lane).toBe('INTERACTIVE');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.idempotent).toBe(true);
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.permission).toBe('inventory:write');
    expect(c?.events).toEqual(['room.ooo_changed', 'availability.changed', 'room.status_changed']);
    expect(c?.notes).toMatch(/INVENTORY_FAIL_CLOSED_NOTES|Inventory-affecting/);
    expect(AUDIT_WRITER_COMMAND_IDS.has('rooms.set_ooo_range')).toBe(true);
  });

  it('require_inspection is DOMAIN bool default false consumersExempt', () => {
    const e = CONFIG_REGISTER.find((x) => x.key === 'pms.housekeeping.require_inspection');
    expect(e?.class).toBe('DOMAIN');
    expect(e?.default).toBe(false);
    expect(e?.consumersExempt).toBe(true);
  });

  it('folio money-ops config keys are DOMAIN bool default false', () => {
    for (const key of [
      'pms.folio.close_window_on_check_out',
      'pms.folio.auto_capture_on_check_out',
    ] as const) {
      const e = CONFIG_REGISTER.find((x) => x.key === key);
      expect(e?.class).toBe('DOMAIN');
      expect(e?.default).toBe(false);
      expect(e?.consumersExempt).toBe(true);
    }
  });

  it('cashiering commands are FAIL_CLOSED with folio:post and shift.changed / payment events', () => {
    for (const id of ['folio.open_shift', 'folio.close_shift'] as const) {
      const c = COMMAND_CATALOG.find((x) => x.id === id);
      expect(c?.entitlement).toBe('pms.core');
      expect(c?.permission).toBe('folio:post');
      expect(c?.degraded).toBe('FAIL_CLOSED');
      expect(c?.events).toEqual(['shift.changed']);
    }
    const cash = COMMAND_CATALOG.find((x) => x.id === 'folio.record_cash_payment');
    expect(cash?.permission).toBe('folio:post');
    expect(cash?.degraded).toBe('FAIL_CLOSED');
    expect(cash?.events).toEqual(['folio.payment_captured', 'folio.line_posted', 'payment.captured']);
    expect(V1_HTTP_ROUTE_AUDIT[57]?.id).toBe('post_shifts');
    expect(V1_HTTP_ROUTE_AUDIT[58]?.id).toBe('put_shift_close');
    expect(V1_HTTP_ROUTE_AUDIT[59]?.id).toBe('post_cash_payment');
    expect(V1_HTTP_ROUTE_AUDIT[60]?.id).toBe('get_shift');
    expect(V1_HTTP_ROUTE_AUDIT[60]).toMatchObject({
      permission: 'folio:read',
      degradedRead: 'FAIL_CLOSED',
    });
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
      'pms.reservations',
      'pms.housekeeping',
      'pms.ops.auto_assign_rooms',
    ];
    for (const e of domainConfigKeys()) {
      expect(
        prefixes.some((p) => e.key === p || e.key.startsWith(`${p}.`)),
        `${e.key} missing from eslint DOMAIN_KEY_PREFIXES`,
      ).toBe(true);
    }
  });
});
