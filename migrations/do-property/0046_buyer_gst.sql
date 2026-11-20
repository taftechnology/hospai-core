-- PropertyDO buyer GST columns — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/property-migrations.ts
-- Regenerate: pnpm generate:ddl

ALTER TABLE city_ledger_account ADD COLUMN gstin TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_legal_name TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_trade_name TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_address TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_city TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_state TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_pin TEXT;

ALTER TABLE city_ledger_account ADD COLUMN gst_state_code TEXT;

ALTER TABLE invoice ADD COLUMN buyer_type TEXT;

ALTER TABLE invoice ADD COLUMN buyer_gstin TEXT;

ALTER TABLE invoice ADD COLUMN buyer_snapshot_id TEXT;

ALTER TABLE invoice ADD COLUMN place_of_supply_state_code TEXT;

CREATE TRIGGER invoice_registered_requires_gstin
BEFORE INSERT ON invoice
WHEN NEW.buyer_type = 'REGISTERED' AND (NEW.buyer_gstin IS NULL OR length(NEW.buyer_gstin) = 0)
BEGIN
  SELECT RAISE(ABORT, 'buyer_gstin_required');
END;
