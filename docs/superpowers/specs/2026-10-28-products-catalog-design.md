# Products catalog — design

**Roadmap:** R1.5 · **Status:** accepted 2026-10-28, shipped · **Date:** 2026-10-28

**Sources:** roadmap R1.5 lock; `ARCHITECTURE.md` §7.9 (product class), §11 (modules), §16.6 (POS is *Integrate*); [charge-code registry](2026-08-07-charge-code-registry-design.md); [tax posting](2026-08-07-tax-posting-design.md) (`charge_code.tax_group` is the tax carrier); [housekeeping module mechanism](2026-08-11-housekeeping-module-mechanism-design.md) (`moduleTxnCtx`, manifests, sync contract); prototype `ProductsSettings.tsx`.

## 1. Context

Today the only catalog is `charge_code`: a code, a name and a `tax_group`. The desk types an amount every time it posts an incidental, and the prototype's Settings → Products (categories, items with a price, add-ons) has no home. R1.5 adds a products catalog as its own module so that the folio's *Post charge* picker offers named, priced items instead of raw codes. It is also the list R1.4 (booking add-ons), R4.11 (minibar and amenities) and R4.13 (packages) build on.

### 1.1 Scope in

- Module `modules/pms/products` with `src/module.manifest.ts`.
- Two PropertyDO tables: categories and items (migration v35).
- Four commands and five routes (create / update for each entity, one list read).
- Settings → **Products** tab: categories and items, create, edit, archive.
- *Post charge* pickers (Folio screen, Front Desk board dialog) offer active products and prefill code and amount.

### 1.2 Scope out

- Stock, reorder levels, recipes, depletion (§16.6 — *Integrate*).
- Restaurant POS menus (R4.21 connector).
- Channel-only pricing (R4.3).
- A per-product tax group (§2.3).
- Stamping `product_id` on folio lines (§6 follow-on).
- Add-on scheduling rules — full stay, arrival, weekends (R4.13).

## 2. Decisions locked

### 2.1 Module, not a Settings dump

`modules/pms/products`, manifest id `pms.products`, entitlement `pms.core` (front office is *Core*, §16.6), so `lifecycle` is omitted, as for housekeeping. The write path follows the housekeeping mechanism exactly: the DO preamble validates and gates, then `transactionSync(() => runIdempotent(...))` calls the module's sync use case with `this.moduleTxnCtx(...)`. Reads are `(sql, filters) => Sync<Out>`.

```ts
const manifest = {
  id: 'pms.products',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: { prefix: 'products_', tables: ['products_category', 'products_item'] },
  writes: ['products_category', 'products_item'],
  publishes: ['products.changed'],
  subscribes: [],
  permissions: ['settings:configure', 'folio:read'],
  meters: [],
} as const satisfies ModuleManifest;
```

### 2.2 Schema — v35

```sql
CREATE TABLE products_category (
  category_id  TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE products_item (
  product_id            TEXT PRIMARY KEY,
  category_id           TEXT NOT NULL REFERENCES products_category(category_id),
  sku                   TEXT NULL,
  name                  TEXT NOT NULL,
  charge_code           TEXT NOT NULL REFERENCES charge_code(code),
  default_amount_minor  INTEGER NOT NULL CHECK (default_amount_minor >= 0),
  status                TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX products_item_sku ON products_item (sku) WHERE sku IS NOT NULL;
CREATE INDEX products_item_category ON products_item (category_id, status);
```

- Money is integer minor units in the property's ledger currency (§7.3). No currency column: a property has one ledger currency.
- Rows are never deleted — archive only, so a past posting's code still resolves.
- No `property_id` column: the DO is the tenancy boundary (housekeeping §2.5).

### 2.3 Tax group comes from the charge code — not stored on the product

The roadmap lock lists *tax group* among a product's fields and requires it to be the §7.9 **product class** key, never a rate. Tax posting already resolves by **`charge_code.tax_group`** (tax-posting spec §2.4). A second `tax_group` on the product would mean either a second tax path on folio lines (a `folio_line` column, engine changes, transfer and split rules) or a stored value pms-core ignores — and AGENTS forbids config the SPA can save that pms-core does not read.

**Lock:** a product's tax group **is** its charge code's `tax_group`. The list read returns it as `taxGroup` (read-only), and the Settings form shows it next to the chosen code. A product that needs a different class uses a different charge code — for example `MINIBAR` in `GOODS` and `RESTAURANT` in an F&B class once R3.6 defines one. This keeps one tax carrier and still lets two jurisdictions tax the same product differently, because the rate resolves from `(jurisdiction, date, base, product class)` (§7.9 requirement 2). The roadmap R1.5 text is amended in the same change.

### 2.4 Which charge codes a product may use

A product's code must exist, be `active`, and be **postable by an operator**: not in `SYSTEM_CHARGE_CODES` (do-runtime) and not the `output_charge_code` of any `tax_rule` (`TAX` and jurisdiction outputs). Otherwise `422 { error: 'charge_code_not_postable' }`.

Archiving a charge code that active products use is **not** blocked (the charge-code registry owns its own lifecycle). The list read marks those products `postable: false`, and pickers hide them; Settings shows them with a warning.

### 2.5 Ids, idempotency, limits

- Client-chosen ids, first writer wins: `categoryId` and `productId` match `^[A-Za-z0-9_-]{1,64}$`. A create with an id that already exists is `409 { error: 'product_exists' }` / `category_exists` (a retry with the same idempotency key replays the first result instead), with no other row's data in the body.
- Idempotency key in the JSON body (`idempotencyKey`), as for charge codes. Fingerprint `{ commandId, payload }`, key prefixed with the user — the existing `runIdempotent` contract.
- Names: trimmed, 1–80 characters. SKU: optional, 1–32 of `[A-Za-z0-9_-]`, unique per property (`409 sku_taken`).
- `defaultAmountMinor`: integer, `0 ≤ n ≤ 100_000_000` (`422 invalid_amount`).
- Caps: at most **200 categories** and **2,000 items** per property (`422 limit_exceeded`), so the single list read stays bounded. Bodies carry no arrays.

### 2.6 Commands and routes

| Command | Lane | Degraded | Permission | Event |
|---|---|---|---|---|
| `products.create_category` | INTERACTIVE | FAIL_CLOSED | `settings:configure` | `products.changed` |
| `products.update_category` | INTERACTIVE | FAIL_CLOSED | `settings:configure` | `products.changed` |
| `products.create_item` | INTERACTIVE | FAIL_CLOSED | `settings:configure` | `products.changed` |
| `products.update_item` | INTERACTIVE | FAIL_CLOSED | `settings:configure` | `products.changed` |

All `entitlement: 'pms.core'`, `idempotent: true`, and all four are audit writers (config changes, like the charge-code commands).

| Route id | Method + path | Permission | Command |
|---|---|---|---|
| `get_products` | `GET /v1/properties/:pid/products` | `folio:read` | — (`degradedRead: FAIL_CLOSED`) |
| `post_product_categories` | `POST /v1/properties/:pid/product-categories` | `settings:configure` | `products.create_category` |
| `patch_product_category` | `PATCH /v1/properties/:pid/product-categories/:categoryId` | `settings:configure` | `products.update_category` |
| `post_products` | `POST /v1/properties/:pid/products` | `settings:configure` | `products.create_item` |
| `patch_product` | `PATCH /v1/properties/:pid/products/:productId` | `settings:configure` | `products.update_item` |

- Update commands take any of `name`, `sortOrder` / `sku`, `chargeCode`, `defaultAmountMinor`, `categoryId`, and `status` (`active` \| `archived`). Archiving a category does not cascade; the read hides items whose category is archived from pickers.
- `get_products` returns `{ ok, categories: [...], items: [...] }` with `taxGroup` and `postable` on each item; `?status=active` (default) or `all`.
- Kill-switch: the four writes are ordinary entitled property mutations and stop with the tenant like charge-code writes. No lifecycle routes.
- Every handler calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`; JSON through the shared parse helper; errors through the one `commandErrorHttpStatus` table.

**Pins after this change:** `COMMAND_CATALOG` 90 → **94**; `V1_HTTP_ROUTE_AUDIT` 145 → **150**, last id **`patch_product`**; `PROPERTY_SCHEMA_HEAD` 34 → **35**; `NIGHT_AUDIT_STEPS` unchanged. AGENTS.md's pin table is updated in the same commit.

### 2.7 Posting — the folio contract is unchanged

A product is a **default** for a posting, not a new money path. The *Post charge* pickers send exactly what they send today — `folio.add_item` with `chargeCode` and `amountMinor` — prefilled from the chosen product; the clerk may change the amount. Tax, `no_post`, window routing and idempotency behave as they do now.

- Pickers list active, postable products in active categories, grouped by category. With **no** products configured they fall back to today's list of operator charge codes, so an unconfigured property is not stuck.
- System and tax-output codes never appear in either list.

### 2.8 SPA

- **Settings → Products** tab, behind `settings:configure`, lazy like the other Settings tabs. A categories list and an items `DataTable` (name, SKU, category, charge code, tax group, default price, status), with create and edit in one `FormDialog` and archive behind `ConfirmDialog` (`intent=destructive`). Prices entered in major units and sent as minor through `parseMajorToMinor`.
- Query key `['products', propertyId, status]`; every mutation invalidates `['products', propertyId]`. The Folio screen and board dialog read the same key.
- Empty, error and "no items in this category" are three states. Copy through `classifiedUserMessage`.

## 3. Feature checklist (AGENTS §6)

- [x] Tenant: no body ids name another tenant; the DO is the boundary.
- [x] Authz: `settings:configure` writes, `folio:read` list; `pms.core`; kill-switch as for charge codes.
- [x] Catalog with a true lane (INTERACTIVE, single-row writes); routes in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency `{ commandId, payload }`, user-prefixed key.
- [x] No arrays in bodies; row caps; JSON via the parse helper.
- [x] `resolvePropertyContext(..., ctx.tenantProperty)`.
- [x] Money: integer minor units; no new money calculation.
- [x] Inventory: not touched.
- [x] Errors: existing table; `{ ok: false, error }`; no foreign row on 409.
- [x] SPA: key includes property and status; local invalidate; `classifiedUserMessage`; ui-kit.
- [x] Pins updated in the same commit.
- [x] No Settings control pms-core does not read (§2.3).

## 4. Tests

**Module (unit, `MemorySql`):** create category and item; update fields; archive; first-writer-wins `409` without the other row's data; system code and tax-output code rejected `charge_code_not_postable`; archived charge code → `postable: false`; caps → `limit_exceeded`; duplicate SKU → `sku_taken`; amount bounds.

**pms-core (HTTP):** each route's permission (`folio:read` can list, cannot write); replaying the same idempotency key returns the first result; a different command with the same payload shape does not alias; migration v35 applies on a v34 store; `check:ddl` matches.

**SPA:** Settings Products tab renders, creates, edits and archives (invalidating `['products', propertyId]`); price entry → minor units; pickers on Folio and board list active postable products by category, prefill code and amount, and fall back to charge codes when none exist.

## 5. Risks

- **Tax class granularity moves to charge codes.** A hotel that wants twenty products in five tax classes needs five charge codes. That is the honest model while tax resolves by charge code; revisit only if R3.6 needs product-level classes, and then as a tax-model change, not a products change.
- **No product id on folio lines** means no "sales by product" report from the folio. R4.14's POS section uses day-close totals; R4.11 minibar posts through the folio contract. If a report needs product-level sales, add the column then, with its own migration.

## 6. Follow-ons

- `product_id` on `folio_line` if a named report needs product-level sales.
- Add-on scheduling (R4.13) and booking add-ons (R1.4) consume this catalog.
- Minibar and amenity stock movement against products (R4.11) — operational list only, no stores inventory.
