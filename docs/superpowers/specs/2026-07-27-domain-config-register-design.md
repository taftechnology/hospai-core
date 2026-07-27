# DOMAIN Config Register Design

**Date:** 2026-07-27  
**Status:** Approved for Phase 0 schema-freeze  
**Sources:** ARCHITECTURE.md §5.1; `/Users/iamabdus/ai-coding-2/hospai-pms-prototype`

## Purpose

Classify every prototype setting so PropertyDO schema can freeze `DOMAIN` keys. Gate: every key classified and all `DOMAIN` keys complete — not all 89 fully implemented in UI.

## Inventory basis

- **99** distinct `pms_*` localStorage keys in the prototype
- **10** excluded as operational/data bags (not settings):  
  `pms_email_delivery_logs`, `pms_email_templates`, `pms_maintenance_tickets`, `pms_hk_inventory`, `pms_hk_manager_priorities`, `pms_distribution_closeouts`, `pms_promo_catalog`, `pms_products_items`, `pms_products_categories`, `pms_products_addons`
- **89** config keys remain (+ platform-new `pms.availability.oversell_allowance`)

## Classes

| Class | Storage | Read path |
|-------|---------|-----------|
| `DOMAIN` | PropertyDO `property_config` | Inside DO transaction |
| `OPERATIONAL` | OrgDO → KV projection | Version-keyed KV |
| `PRESENTATION` | OrgDO or user-scoped | KV; stale OK |
| `SECRET` | payments Worker secret store only | Never readable by pms-core |

## Consumer flags (`config.changed`)

`invalidatesAri` | `reschedulesNightAudit` | `affectsTaxMoney` | `rematerializesRates`

## DOMAIN keys (freeze-critical)

| Platform key | Prototype source | Default | Consumers |
|--------------|------------------|---------|-----------|
| `pms.availability.allow_overbooking` | `pms_sys_allow_overbooking` | `false` | ARI |
| `pms.availability.oversell_allowance` | *(new — int companion)* | `0` | ARI |
| `pms.time.time_zone` | `pms_sys_time_zone` | `America/New_York` | ARI, night audit, rates |
| `pms.night_audit.audit_time` | `pms_sys_audit_time` | `02:00` | night audit |
| `pms.night_audit.auto_no_show` | `pms_sys_auto_no_show` | `true` | ARI, night audit |
| `pms.booking.same_day_bookings` | `pms_sys_same_day_bookings` | `true` | ARI |
| `pms.booking.same_day_cutoff` | `pms_sys_same_day_cutoff` | `22:00` | ARI |
| `pms.booking.require_prepayment` | `pms_sys_require_prepayment` | `false` | ARI |
| `pms.money.currency_code` | `pms_sys_currency_code` | `USD` | tax, rates |
| `pms.money.tax_registry` | `pms_tax_registry` | `[]` | tax |
| `pms.money.payment_alloc` | `pms_sys_payment_alloc` | `true` | tax |
| `pms.folio.breakfast_rule` | `pms_sys_breakfast_rule` | `EXCLUDED_FROM_ROOM` | night audit, tax, rates |
| `pms.folio.configs` | `pms_folio_configs` | `{}` | tax |
| `pms.night_audit.auto_extend` | `pms_sys_auto_extend` | `true` | night audit |

## OPERATIONAL (sample — full list in `packages/contracts`)

Property policies, guest settings, amenities, marketplace connection *flags* (not credentials), finance AVS/CC brand preferences, invoice numbering, booking-engine engine rules (non-analytics), tickets settings, notifications, tags, named lists (sources, segments), channel routings (non-secret), custom pay method *names*, gateway active *reference*, PayPal *enabled/mode* (client id is SECRET).

## PRESENTATION

`app_language`, `date_format`, `time_format`, `currency_format`, `week_start`, `calendar_name_format`, `show_eta`, `show_departures`, invoice layout/show flags, BE customization (colors, copy, CSS), opt-in copy strings.

## SECRET (rejected by config API)

| Prototype key | Destination |
|---------------|-------------|
| `pms_finance_bank_*` (name, inst, routing, acct, swift) | payments store |
| `pms_finance_paypal_clientid`, `paypal_merchant` | payments store |
| `pms_finance_terminals` (serial/IP) | payments store |
| BE `analyticsConfig` ga4/meta/gtm | payments or analytics secret store |
| `pms_invoice_logo` data-URL | R2 object ref, not config value |

## Rules

1. Undeclared keys cannot be written.
2. `SECRET` writes return a pointer to the payments admin flow.
3. Every `DOMAIN` key declares ≥1 consumer or is explicitly flagged `consumersExempt`.
4. Defaults live in code; tenant rows store overrides only.

Canonical implementation: `packages/contracts/src/config/register.ts`.
