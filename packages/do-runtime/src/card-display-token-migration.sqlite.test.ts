import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PROPERTY_MIGRATIONS } from './property-migrations.js';

function execAll(db: DatabaseSync, statements: readonly string[]) {
  for (const s of statements) db.exec(s);
}

describe('card_display_token v26 real sqlite', () => {
  it('ALTERs card display columns onto a populated v25 payment row', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version <= 25)) {
      execAll(db, m.statements!);
    }

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO payment (
               payment_id, reservation_id, folio_window_id, amount_minor, currency, status,
               idempotency_key, request_fingerprint, created_at, updated_at, tender_type, purpose
             ) VALUES ('pay1', 'res1', 'fw1', 100, 'USD', 'captured', 'k1', 'fp1', 0, 0, 'CARD', 'STAY')`);

    for (const m of PROPERTY_MIGRATIONS.filter((m) => m.version === 26)) {
      execAll(db, m.statements!);
    }

    const row = db
      .prepare(`SELECT card_last4, card_brand FROM payment WHERE payment_id = 'pay1'`)
      .get() as { card_last4: string | null; card_brand: string | null };
    expect(row.card_last4).toBeNull();
    expect(row.card_brand).toBeNull();

    db.exec(
      `UPDATE payment SET card_last4 = '4242', card_brand = 'visa' WHERE payment_id = 'pay1'`,
    );
    const after = db
      .prepare(`SELECT card_last4, card_brand FROM payment WHERE payment_id = 'pay1'`)
      .get() as { card_last4: string; card_brand: string };
    expect(after.card_last4).toBe('4242');
    expect(after.card_brand).toBe('visa');
  });
});
