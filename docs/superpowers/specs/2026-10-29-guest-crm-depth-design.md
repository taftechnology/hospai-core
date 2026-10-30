# Guest CRM depth — tags, guest VIP, notes (R1.8)

**Status:** Accepted · 2026-10-29
**Roadmap:** R1.8 Guest CRM depth
**Builds on:** [guest CRM directory](./2026-08-13-guest-crm-directory-design.md) (§1.3 and leftover 17 deferred tags / guest-level VIP / guest notes to this slice), [guests + crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md), [property-scoped lists](./2026-09-05-property-scoped-guest-roster-lists-design.md).
**Prototype:** `hospai-pms-prototype/src/components/GuestsCRM.tsx` — tags labelled "Profile Flags & Preferences" / "Preference / Allergen Flags" (free text, e.g. "Feather Allergy", "Likes High Floor"), a VIP checkbox with a VIP badge in the directory, `notes?: string` on the guest.

---

## 1. Decisions (locked)

1. **Where the data lives: inside the encrypted guest profile.** `GuestProfile` gains three optional fields. No new table, no plaintext column, **no OrgDO migration** (`ORG_SCHEMA_HEAD` stays **10**).
   - Why: the prototype's tags are allergy and preference flags, which are health and personal data; notes are free text that will hold personal data. Both must be crypto-shredded on `guests.erase` like the name and contact. One encrypted blob gives that for free.
   - VIP rides in the same blob. It is a fact about a person, it is tiny, and it keeps one storage rule for all three fields.
   - Cost accepted: tags cannot be filtered or searched in SQL. Tag search would need a blind index; it is out (§5).
2. **No new commands, routes or permissions.** `guests.create` (`post_guests`) and `guests.update` (`patch_guest`) accept the new fields. Writes stay `guests:write`, reads `guests:read`. Pins unchanged: `COMMAND_CATALOG` 95, `V1_HTTP_ROUTE_AUDIT` 152 / last `put_operational_config`, `PROPERTY_SCHEMA_HEAD` 36, `ORG_SCHEMA_HEAD` 10.
3. **PATCH stays a full replace**, as it is today for `email` / `phone`. An omitted `tags` / `vip` / `notes` means "none". No read-before-write merge inside the DO.
   - The only first-party caller (`GuestProfileScreen`) sends every field from one edit form. The client `updateGuest` input type gains the three fields so a caller cannot silently drop them.
4. **Org-wide, like the rest of the profile.** Guest profiles live in OrgDO and are shared across the org's properties (ARCHITECTURE §7.6). A tag added at hotel A shows at hotel B for the same guest. Reads stay property-scoped by `guest_property` (unchanged).
5. **Guest VIP is separate from stay VIP.** `reservation.vip_flag` (stay) is untouched. Guest VIP does not copy onto new stays in this slice (leftover §6).
6. **Loyalty = tag or VIP**, not a points ledger. No lifetime spend, no stays-count sort (warehouse, ARCHITECTURE §7.8).

## 2. Wire shape and validation (normative)

```ts
type GuestProfile = {
  displayName: string;
  email?: string;
  phone?: string;
  tags?: string[];   // new
  vip?: boolean;     // new
  notes?: string;    // new
};
```

Constants in `@hospai/contracts`, shared by the HTTP handler and the `try*` RPC:

| Constant | Value |
|---|---|
| `GUEST_TAGS_MAX` | 20 tags |
| `GUEST_TAG_LENGTH_MAX` | 40 characters |
| `GUEST_NOTES_LENGTH_MAX` | 2000 characters |

**Normalisation** (one helper, `normalizeGuestCrmFields`, in contracts; used before fingerprinting):

- Each tag is trimmed and inner whitespace collapsed to one space. Empty tags are dropped.
- Duplicates are dropped case-insensitively; the first spelling wins; order is preserved.
- `tags: []` after normalisation is stored as absent. `vip: false` is stored as absent. `notes` is trimmed; empty is stored as absent.
- The **normalised** object is what is fingerprinted **and** what is sent to the DO (AGENTS §1 idempotency).

**Errors:**

| Case | HTTP | Body |
|---|---|---|
| `tags` not an array of strings, `vip` not boolean, `notes` not string | 400 | `{ error: 'invalid_body' }` |
| More than `GUEST_TAGS_MAX` tags after normalisation, a tag over `GUEST_TAG_LENGTH_MAX`, notes over `GUEST_NOTES_LENGTH_MAX` | 422 | `{ ok: false, error: 'limit_exceeded' }` |

The RPC (`tryCreateGuest` / `tryUpdateGuest`) re-checks the same caps and returns `limit_exceeded`, so a direct RPC caller cannot store more than HTTP allows.

**Fingerprint:** `commandFingerprint('guests.update', { guestId, ...normalisedProfile })` — the new fields are part of the payload, so two edits that differ only in tags never alias.

**Blind index:** unchanged. `blindIndexRows` reads only `displayName` / `email` / `phone`. Tags and notes are never indexed.

**Events:** unchanged. `guest.updated` carries `guestRef` + `piiKeyId` only — no tags, VIP or notes on the bus.

## 3. Reads

| Read | Returns |
|---|---|
| `get_guest` | full profile, including `tags`, `vip`, `notes` |
| `get_guests` (directory list) and `post_guests_search` | profile **without `notes`**: `displayName`, `email`, `phone`, `tags`, `vip`. Notes are dropped to keep list payloads small and to show free text only on the profile page. |
| `post_guests_batch` | unchanged (it already returns only what guest-row needs) |

Erased guests keep returning `profile: null` — the new fields go with the shredded key.

## 4. SPA

**Directory (`/guests`):** a `VIP` badge next to the name when `profile.vip`. No tag column (the prototype's list shows only VIP).

**Profile (`/guests/:guestRef`):**

- Header: a `VIP` badge beside the name when `profile.vip`.
- **Preferences** card: tags as `Badge`s (wrap, never stretch). Empty state: "No preferences recorded."
- **Notes** card: notes as text with preserved line breaks. Empty state: "No notes."
- **Edit** (the existing edit mode, one form, one Save): adds a `Checkbox` "VIP guest", a tag `Input` with an **Add** button (Enter also adds) and each tag shown with a remove button (`aria-label="Remove tag <tag>"`), and a `Textarea` for notes with a character count against 2000. The tag input disables Add at 20 tags and says why.
- `dirty` (unsaved-changes guard) includes tags, VIP and notes.
- Save sends the full profile. On success, invalidate `['guest', propertyId, guestRef]` **and** `['guests-directory', propertyId]` (VIP shows in the list). A `limit_exceeded` reply shows an `Alert` via `classifiedUserMessage`.

All controls from `ui-kit`; layout per the R1.7a §10 rules (cards with `CardHeader`/`CardTitle`, `StatField`, no card in a card).

## 5. Out (do not build here)

- Tag filter or tag search in the directory (needs a tag blind index — a later slice if asked).
- Sort by lifetime spend or stays count; LTV (warehouse §7.8).
- `guests.merge`; passport / ID documents and consent (R4.15); points ledger.
- A shared tag vocabulary or tag admin in Settings. Tags are free text per guest.
- Sales pipeline: leads, opportunities, quotes, campaigns, portal (§16.6 *Integrate*).

## 6. Leftovers (named, not folded)

1. Prefill stay VIP in the booking wizard when the chosen guest is VIP.
2. Show allergy / preference tags on the board, arrival rows or the housekeeping room card.
3. Tag blind index for "all guests tagged X".

## 7. Tests (acceptance)

pms-core (OrgDO and HTTP):

1. Create and update round-trip `tags` / `vip` / `notes`; `get_guest` returns them.
2. Normalisation: `[' High floor ', 'high  FLOOR', '']` stores `['High floor']`; `vip:false` and `notes:'  '` are stored as absent.
3. Full replace: update without `tags` after an update with tags leaves no tags.
4. Caps at HTTP: 21 tags, a 41-character tag, 2001-character notes → 422 `limit_exceeded`; wrong types → 400 `invalid_body`.
5. Caps at RPC: calling `tryUpdateGuest` directly with 21 tags → `limit_exceeded`, nothing written.
6. Fingerprint: same idempotency key, payloads differing only in tags → `idempotency_key_reused`.
7. List and search rows carry `tags` and `vip` but no `notes`.
8. Erase: after `guests.erase`, `get_guest` returns `profile: null`; the new fields are not readable.
9. Two properties, same org: a tag written at property A is returned by `get_guest` at property B **only** when the guest is associated with B (existing `guest_property` rule); B's directory does not list A-only guests.
10. `guest.updated` outbox payload has no `tags` / `vip` / `notes` keys.

web-pms:

11. Profile shows the VIP badge, tag badges and notes; empty states use the two sentences in §4.
12. Edit: add a tag by button and by Enter, remove a tag, toggle VIP, edit notes; Save sends the full normalised profile; Add is disabled at 20 tags.
13. Save invalidates `['guest', propertyId, guestRef]` and `['guests-directory', propertyId]` (asserted against the consumer keys).
14. Directory shows the VIP badge for a VIP row.

## 8. AGENTS §6 checklist

- [x] Tenant: no new body ids; URL property scopes the write as today.
- [x] Authz: `guests:write` / `guests:read`, unchanged; kill-switch unchanged (existing routes).
- [x] Catalog / routes: none added; pins unchanged.
- [x] Idempotency: `{ commandId, payload }` fingerprint over the normalised object that is sent.
- [x] Arrays capped at HTTP **and** RPC (`GUEST_TAGS_MAX`); JSON through the parse helper.
- [x] `resolvePropertyContext(..., ctx.tenantProperty)` already on both handlers.
- [x] Money / inventory: not touched.
- [x] Errors: existing table (`invalid_body` 400, `limit_exceeded` 422).
- [x] SPA: consumer keys invalidated; `classifiedUserMessage`; ui-kit; no inline styles.
- [x] Tests: two-property case for OrgDO PII (test 9).
- [x] No Settings control added.
- [x] Existing spec searched: this closes the CRM directory spec's leftover 17.

## 9. As built (2026-10-29)

- Shipped as specified. `normalizeGuestCrmFields`, `guestCrmExceedsCaps` and `guestCrmBodyTypesValid` live in `packages/contracts/src/guest-crm.ts`.
- Fixed in passing: the profile save used one idempotency op id per guest (`guest-update:<guestRef>`), and the client never clears keys, so a second edit in the same session returned `idempotency_key_reused`. Each save now gets its own op id (`guest-update:<guestRef>:<uuid>`), the same pattern as the folio screen. This is safe because PATCH is a full replace.
- `ui-kit` `Input` and `Textarea` now pass `maxLength` through to the element, so the tag field stops at 40 characters and notes at 2000.
- Tag editing uses removable chips (`Button size="sm"`, `aria-label="Remove tag <tag>"`) with Add beside the input in a `ui-row`.
