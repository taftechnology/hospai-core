-- PropertyDO products catalog — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

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
