-- PropertyDO card display token — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl
-- ORDER: ALTER payment ADD card_last4, card_brand.

ALTER TABLE payment ADD COLUMN card_last4 TEXT;

ALTER TABLE payment ADD COLUMN card_brand TEXT;
