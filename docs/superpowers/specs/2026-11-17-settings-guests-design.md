# Settings → Guests (profile rules) — design

**Slice:** roadmap R1.17. **Date:** 2026-11-17. **Status:** accepted for build.

Binds the existing org-scoped OPERATIONAL key `pms.guests.settings` to a Settings section and makes pms-core read every control it shows. Guest records stay in the guest directory (R1.8); this is rules only.

## 1. Decisions (locked)

1. **Shown controls — four, all read by OrgDO `tryCreateGuest`:**

   | Field | Effect on a **new** guest profile |
   |---|---|
   | `requireEmail` | Create without an email → `422 guest_email_required`. |
   | `requirePhone` | Create without a phone → `422 guest_phone_required`. |
   | `matchOnEmail` | Create whose email matches a live guest **linked to this property** → `409 guest_duplicate`. |
   | `matchOnPhone` | Same for phone (digits-only match, the blind-index normalisation). |

   All default `false`, so today's behaviour is unchanged until an owner turns one on.

2. **Create only.** PATCH stays a full replace with no rule checks (guest CRM depth spec §1.3). Existing guests without an email or phone stay editable. The Settings copy says "new guest profiles".

3. **Duplicate match is property-scoped.** The lookup joins `guest_blind_index` → `guest` (`erased_at IS NULL`) → `guest_property` for the URL property. A guest who has only stayed at a sibling hotel neither blocks the create nor appears in the response — the clerk at hotel A cannot find hotel B's guests (property-scoped roster lists spec), so blocking on them would be a dead end and returning their ref would leak them. The 409 body is `{ ok: false, error: 'guest_duplicate', match: 'email' | 'phone', guestRef }`; `guestRef` is a guest this property can already read. Email is checked before phone.

4. **Hidden, with the slice that owns the consumer:**

   | Prototype control | Why hidden | Owner |
   |---|---|---|
   | Require ID / passport at check-in | No document can be recorded until R4.15; a toggle now would block every check-in. | **R4.15** adds it, failing check-in closed when on and no document is recorded (R4.15 "Also locked"). |
   | Store stay preferences, match on passport / ID | No preference or document fields on `GuestProfile`. | R4.15 |
   | Default country, default language | `GuestProfile` has neither field. | none yet |
   | Auto-suggest merge, allow explicit duplicates, share profiles across properties | No overnight merge job; the two match toggles are the duplicate policy; cross-property sharing has no consumer. | none yet |
   | VIP / loyalty thresholds and later prototype sections | Outside "profile defaults". | not scheduled |

5. **Storage.** One org-wide row in OrgDO `operational_config` with `property_id = '*'` (`ORG_CONFIG_ROW`), audited in `operational_config_audit` the same way. No migration; purge already covers both tables. `listOperationalConfig(propertyId)` never returns it (allowlist is per-property keys).

6. **Value schema** (replaces `json` in the registry): strict object `{ requireEmail, requirePhone, matchOnEmail, matchOnPhone }`, all boolean, all required on write. Unknown or missing fields → `422 validation_error`. A stored value is read through the same schema with defaults, so a missing row means all `false`.

7. **Routes and command** (org URL, org permission — org-wide data does not go on a property route):

   | Route id | Method + path | Permission | Command |
   |---|---|---|---|
   | `get_org_guest_settings` | `GET /v1/orgs/:orgId/guest-settings` | `org:manage` | — |
   | `put_org_guest_settings` | `PUT /v1/orgs/:orgId/guest-settings` | `org:manage` | `config.put_guest_settings` (INTERACTIVE) |

   PUT body `{ value, reason, idempotencyKey }` — idempotency key in **JSON**, like `put_operational_config`. Fingerprint `{ commandId, payload: { value, reason } }`, key per user via `runIdempotent(…, actor)`. Entitlement `pms.core`; the kill-switch applies (same as `put_operational_config`). GET is a read of the org URL's own DO; no body ids.

8. **SPA.** `/settings/guests`, a Settings nav item shown only with `org:manage` (owner). Four checkboxes in two groups ("Required on new profiles", "Duplicate check at this property"), a required reason, Save. Booking: `guest_email_required`, `guest_phone_required` and `guest_duplicate` get `classifiedUserMessage` copy; no settings fetch on the booking screen.

## 2. Tests (acceptance)

- Defaults: no row → GET returns all `false`; create with no email/phone succeeds.
- `requireEmail` on: create without email → 422 `guest_email_required`; with email → 200. Same for phone.
- `matchOnEmail` on: second create at the same property with the same email (case/space-insensitive) → 409 `guest_duplicate`, `match: 'email'`, the first `guestRef`; no guest row, no blind-index row, no `guest.created` event for the second id.
- **Two properties, same org:** a guest linked only to hotel B does not block a create at hotel A, and no 409 at hotel A carries hotel B's ref.
- Erased guest does not match.
- Replay of a successful create (same key) after the rule turns on still returns the stored 200.
- PUT: unknown field / non-boolean → 422; reason blank → 400 `invalid_body`; same key + different value → 409 `idempotency_key_reused`; `staff` → 403; another org's URL → 404 with no foreign fields.
- PATCH of an existing guest without email while `requireEmail` is on → still 200.
- SPA: nav item hidden without `org:manage`; Save sends the full object with a reason and invalidates `['org-guest-settings', orgId]`; booking shows each new error's copy.

## 3. AGENTS §6 checklist

- [x] Tenant: org from URL only; body has no ids.
- [x] Authz: `org:manage`; entitlement `pms.core`; kill-switch applies; guest-create checks are property-scoped.
- [x] `config.put_guest_settings` in `COMMAND_CATALOG` (INTERACTIVE); both routes in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency: `{ commandId, payload }`, per user, JSON key.
- [x] No arrays in the body.
- [x] Property routes untouched; guest create keeps `resolvePropertyContext`.
- [x] Money / inventory: n/a.
- [x] Errors: `guest_email_required` / `guest_phone_required` 422, `guest_duplicate` 409, via `commandErrorHttpStatus`.
- [x] SPA: key includes `orgId`; local invalidate; `classifiedUserMessage`; ui-kit.
- [x] Tests: two-property same-org case.
- [x] Pins: catalog 105; audit 170, last id `put_org_guest_settings`; schema heads unchanged.
- [x] Every shown control is read by pms-core.
