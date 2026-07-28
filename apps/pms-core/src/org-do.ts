import { DurableObject } from 'cloudflare:workers';
import {
  GUEST_ALREADY_ERASED,
  GUEST_NOT_FOUND,
  IDEM_KEY_REUSED,
  type IdempotencyKey,
} from '@hospai/contracts';
import {
  ORG_MIGRATIONS,
  appendOutbox,
  migrateSql,
  runIdempotent,
  IdempotencyKeyReused,
} from '@hospai/do-runtime';
import {
  importMasterKeyHex,
  KeyShreddedError,
  PiiVault,
  type GuestProfile,
} from '@hospai/crypto-shredding';
import type { PmsEnv } from './env.js';
import { SqlKeyStore } from './org-key-store.js';

class GuestExistsError extends Error {
  constructor() {
    super('Guest already exists');
    this.name = 'GuestExistsError';
  }
}

class GuestErasedError extends Error {
  constructor() {
    super('Guest already erased');
    this.name = 'GuestErasedError';
  }
}

class GuestNotFoundError extends Error {
  constructor() {
    super('Guest not found');
    this.name = 'GuestNotFoundError';
  }
}

function readIdempotentReplay<T>(sql: DurableObjectState['storage']['sql'], idem: IdempotencyKey): T | null {
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;
  if (prior.length === 0) return null;
  if (prior[0]!.request_fingerprint !== idem.fingerprint) {
    throw new IdempotencyKeyReused(idem.key);
  }
  return JSON.parse(prior[0]!.response) as T;
}

export class OrgDO extends DurableObject<PmsEnv> {
  private vaultPromise: Promise<PiiVault> | null = null;

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrateSql(ctx.storage.sql, [...ORG_MIGRATIONS]);
      ctx.storage.sql.exec(`PRAGMA foreign_keys = ON`);
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS __meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      );
    });
  }

  private async vault(): Promise<PiiVault> {
    if (!this.vaultPromise) {
      this.vaultPromise = (async () => {
        const hex = this.env.HOSPAI_ORG_MASTER_KEY;
        if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
        const master = await importMasterKeyHex(hex);
        return new PiiVault(master, new SqlKeyStore(this.ctx.storage.sql));
      })();
    }
    return this.vaultPromise;
  }

  private getOrgIdSync(): string | null {
    const rows = this.ctx.storage.sql.exec(`SELECT value FROM __meta WHERE key = 'org_id'`).toArray() as Array<{
      value: string;
    }>;
    return rows[0]?.value ?? null;
  }

  async ensureMetaOrgId(orgId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO __meta (key, value) VALUES ('org_id', ?) ON CONFLICT(key) DO NOTHING`,
      orgId,
    );
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  async ensureMember(userId: string, role: 'owner' | 'admin' | 'staff' = 'owner'): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO member (user_id, role, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      userId,
      role,
      Date.now(),
    );
  }

  async upsertPropertyRef(input: {
    propertyId: string;
    name: string;
    jurisdiction: string | null;
    timeZone: string;
    status?: string;
  }): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_ref (property_id, name, jurisdiction, time_zone, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(property_id) DO UPDATE SET
         name = excluded.name,
         jurisdiction = excluded.jurisdiction,
         time_zone = excluded.time_zone,
         status = excluded.status`,
      input.propertyId,
      input.name,
      input.jurisdiction,
      input.timeZone,
      input.status ?? 'active',
    );
  }

  async listPropertyRefs(): Promise<
    Array<{
      propertyId: string;
      name: string;
      jurisdiction: string | null;
      timeZone: string;
      status: string;
    }>
  > {
    const rows = this.ctx.storage.sql
      .exec(`SELECT property_id, name, jurisdiction, time_zone, status FROM property_ref ORDER BY property_id`)
      .toArray() as Array<{
      property_id: string;
      name: string;
      jurisdiction: string | null;
      time_zone: string;
      status: string;
    }>;
    return rows.map((r) => ({
      propertyId: r.property_id,
      name: r.name,
      jurisdiction: r.jurisdiction,
      timeZone: r.time_zone,
      status: r.status,
    }));
  }

  async listMembers(): Promise<Array<{ userId: string; role: 'owner' | 'admin' | 'staff' }>> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT user_id, role FROM member ORDER BY user_id`)
      .toArray() as Array<{ user_id: string; role: string }>;
    return rows.map((r) => ({ userId: r.user_id, role: r.role as 'owner' | 'admin' | 'staff' }));
  }

  async tryCreateGuest(
    input: { guestId: string; profile: GuestProfile },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_ALREADY_ERASED | typeof IDEM_KEY_REUSED | string }
  > {
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    try {
      const replay = readIdempotentReplay<
        { ok: true; guestId: string; piiKeyId: string } | { ok: false; error: string }
      >(this.ctx.storage.sql, idem);
      if (replay) return replay;

      const existing = this.ctx.storage.sql
        .exec(`SELECT erased_at FROM guest WHERE guest_id = ?`, input.guestId)
        .toArray() as Array<{ erased_at: number | null }>;
      if (existing[0]?.erased_at != null) return { ok: false, error: GUEST_ALREADY_ERASED };
      if (existing[0]) return { ok: false, error: 'guest_exists' };

      const vault = await this.vault();
      const material = await vault.prepareGuestRecord('guest', input.guestId, input.profile);

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const again = this.ctx.storage.sql
            .exec(`SELECT erased_at FROM guest WHERE guest_id = ?`, input.guestId)
            .toArray() as Array<{ erased_at: number | null }>;
          if (again[0]?.erased_at != null) throw new GuestErasedError();
          if (again[0]) throw new GuestExistsError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)`,
            material.piiKeyId,
            'guest',
            input.guestId,
            material.wrappedKey,
            now,
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO guest (guest_id, pii_key_id, profile_cipher, profile_iv, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            input.guestId,
            material.piiKeyId,
            material.profileCipher,
            material.profileIv,
            now,
            now,
          );

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'guest.created',
            payload: { orgId, guestRef: input.guestId, piiKeyId: material.piiKeyId },
          });

          return { ok: true as const, guestId: input.guestId, piiKeyId: material.piiKeyId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof GuestErasedError) return { ok: false, error: GUEST_ALREADY_ERASED };
      if (e instanceof GuestExistsError) return { ok: false, error: 'guest_exists' };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryUpdateGuest(
    input: { guestId: string; profile: GuestProfile },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED | typeof IDEM_KEY_REUSED | string }
  > {
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    try {
      const replay = readIdempotentReplay<
        { ok: true; guestId: string; piiKeyId: string } | { ok: false; error: string }
      >(this.ctx.storage.sql, idem);
      if (replay) return replay;

      const rows = this.ctx.storage.sql
        .exec(`SELECT pii_key_id, erased_at FROM guest WHERE guest_id = ?`, input.guestId)
        .toArray() as Array<{ pii_key_id: string; erased_at: number | null }>;
      const guest = rows[0];
      if (!guest) return { ok: false, error: GUEST_NOT_FOUND };
      if (guest.erased_at != null) return { ok: false, error: GUEST_ALREADY_ERASED };

      const vault = await this.vault();
      const sealed = await vault.prepareProfileSeal(guest.pii_key_id, input.profile);

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE guest SET profile_cipher = ?, profile_iv = ?, updated_at = ? WHERE guest_id = ? AND erased_at IS NULL`,
            sealed.profileCipher,
            sealed.profileIv,
            now,
            input.guestId,
          );

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'guest.updated',
            payload: { orgId, guestRef: input.guestId, piiKeyId: guest.pii_key_id },
          });

          return { ok: true as const, guestId: input.guestId, piiKeyId: guest.pii_key_id };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryEraseGuest(
    input: { guestId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof IDEM_KEY_REUSED | string }
  > {
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'org_id_unset' };

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const rows = this.ctx.storage.sql
            .exec(`SELECT pii_key_id, erased_at FROM guest WHERE guest_id = ?`, input.guestId)
            .toArray() as Array<{ pii_key_id: string; erased_at: number | null }>;
          const guest = rows[0];
          if (!guest) throw new GuestNotFoundError();
          if (guest.erased_at != null) {
            return { ok: true as const, guestId: input.guestId, piiKeyId: guest.pii_key_id };
          }

          const keyRows = this.ctx.storage.sql
            .exec(`SELECT shredded_at, wrapped_key FROM data_key WHERE pii_key_id = ?`, guest.pii_key_id)
            .toArray() as Array<{ shredded_at: number | null; wrapped_key: Uint8Array | null }>;
          const keyRow = keyRows[0];
          if (
            !keyRow ||
            keyRow.shredded_at != null ||
            keyRow.wrapped_key == null ||
            keyRow.wrapped_key.length === 0
          ) {
            throw new Error('key_shred_failed');
          }

          this.ctx.storage.sql.exec(
            `UPDATE data_key SET wrapped_key = NULL, shredded_at = ? WHERE pii_key_id = ? AND shredded_at IS NULL`,
            Date.now(),
            guest.pii_key_id,
          );

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE guest SET erased_at = ?, updated_at = ? WHERE guest_id = ?`,
            now,
            now,
            input.guestId,
          );

          appendOutbox(this.ctx.storage.sql, {
            eventId: crypto.randomUUID(),
            eventType: 'guest.erased',
            payload: { orgId, guestRef: input.guestId, piiKeyId: guest.pii_key_id },
          });

          return { ok: true as const, guestId: input.guestId, piiKeyId: guest.pii_key_id };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof GuestNotFoundError) return { ok: false, error: GUEST_NOT_FOUND };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async readGuestProfile(guestId: string): Promise<GuestProfile | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT pii_key_id, profile_cipher, profile_iv FROM guest WHERE guest_id = ?`, guestId)
      .toArray() as unknown as Array<{
      pii_key_id: string;
      profile_cipher: Uint8Array;
      profile_iv: Uint8Array;
    }>;
    const guest = rows[0];
    if (!guest) return null;
    const vault = await this.vault();
    return vault.decryptGuestProfile(guest.pii_key_id, guest.profile_cipher, guest.profile_iv);
  }

  async getGuestPiiKeyId(guestId: string): Promise<string | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT pii_key_id FROM guest WHERE guest_id = ?`, guestId)
      .toArray() as Array<{ pii_key_id: string }>;
    return rows[0]?.pii_key_id ?? null;
  }

  async listOutboxEventTypes(): Promise<string[]> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT event_type FROM outbox WHERE acked = 0 ORDER BY seq`)
      .toArray() as Array<{ event_type: string }>;
    return rows.map((r) => r.event_type);
  }

  async listOutboxPayloads(): Promise<Array<{ eventType: string; payload: string }>> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT event_type, payload FROM outbox WHERE acked = 0 ORDER BY seq`)
      .toArray() as Array<{ event_type: string; payload: string }>;
    return rows.map((r) => ({ eventType: r.event_type, payload: r.payload }));
  }

  async testProvisionStaffKey(staffId: string): Promise<{ piiKeyId: string }> {
    const vault = await this.vault();
    const material = await vault.prepareGuestRecord('staff', staffId, { displayName: 'staff-placeholder' });
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)`,
      material.piiKeyId,
      'staff',
      staffId,
      material.wrappedKey,
      now,
    );
    return { piiKeyId: material.piiKeyId };
  }

  async testStaffRoundTrip(piiKeyId: string, plaintext: string): Promise<string> {
    const vault = await this.vault();
    const sealed = await vault.encrypt(piiKeyId, new TextEncoder().encode(plaintext));
    const plain = await vault.decrypt(piiKeyId, sealed.ciphertext, sealed.iv);
    return new TextDecoder().decode(plain);
  }

  async testShredGuestKey(piiKeyId: string): Promise<boolean> {
    const vault = await this.vault();
    return vault.shredKey(piiKeyId);
  }

  /** Test hook — true when wrapped_key column is NULL (material destroyed, not just flagged). */
  async testDataKeyHasMaterial(piiKeyId: string): Promise<boolean> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT wrapped_key FROM data_key WHERE pii_key_id = ?`, piiKeyId)
      .toArray() as Array<{ wrapped_key: Uint8Array | null }>;
    const row = rows[0];
    if (!row) return false;
    return row.wrapped_key != null && row.wrapped_key.length > 0;
  }
}
