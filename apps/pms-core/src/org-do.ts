import { DurableObject } from 'cloudflare:workers';
import {
  GUEST_ALREADY_ERASED,
  GUEST_NOT_FOUND,
  IDEM_KEY_REUSED,
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  type EventSource,
  type IdempotencyKey,
} from '@hospai/contracts';
import {
  ORG_MIGRATIONS,
  appendOutbox,
  ackOutboxThrough as ackOutboxThroughSql,
  AlarmScheduler,
  drainOutbox,
  migrateSql,
  runIdempotent,
  IdempotencyKeyReused,
  toQueueBatchEntry,
  OUTBOX_BACKLOG_DELAY_MS,
  OUTBOX_SWEEP_INTERVAL_MS,
  type OutboxRow,
} from '@hospai/do-runtime';
import {
  importMasterKeyHex,
  KeyShreddedError,
  PiiVault,
  type GuestProfile,
} from '@hospai/crypto-shredding';
import { assertEntitled, EntitlementDoCache } from '@hospai/entitlement-client';
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
  private readonly entitlementCache = new EntitlementDoCache();
  private readonly scheduler: AlarmScheduler;

  constructor(ctx: DurableObjectState, env: PmsEnv) {
    super(ctx, env);
    this.scheduler = new AlarmScheduler(ctx.storage.sql, ctx.storage);
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
    await this.ensureOutboxScheduleIfAbsent();
  }

  async getSchemaVersion(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_version`)
      .toArray() as Array<{ v: number }>;
    return Number(rows[0]?.v ?? 0);
  }

  /** First-write outbox sweep schedule — idempotent. */
  async ensureOutboxScheduleIfAbsent(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM alarm_schedule WHERE name = 'outbox' LIMIT 1`)
      .toArray() as Array<{ one: number }>;
    if (rows.length > 0) return;
    this.scheduler.upsertSchedule('outbox', Date.now() + OUTBOX_SWEEP_INTERVAL_MS);
    await this.scheduler.armFromTable();
  }

  private assertUnsafeLocal(helper: string): void {
    if (this.env.HOSPAI_UNSAFE_LOCAL !== '1') {
      throw new Error(`${helper} requires HOSPAI_UNSAFE_LOCAL=1 (local only)`);
    }
  }

  private outboxSourceSync(): EventSource {
    const id = this.getOrgIdSync();
    if (!id) throw new Error('org_id_unset');
    return { do: 'org', id };
  }

  private appendOrgOutbox(row: {
    eventId: string;
    eventType: string;
    payload: unknown;
  }): void {
    appendOutbox(this.ctx.storage.sql, { ...row, source: this.outboxSourceSync() });
  }

  private rescheduleOutboxAfterFlush(flushed: number, backlog: boolean): void {
    const delay =
      flushed === 0 ? OUTBOX_SWEEP_INTERVAL_MS : backlog ? OUTBOX_BACKLOG_DELAY_MS : OUTBOX_SWEEP_INTERVAL_MS;
    this.scheduler.upsertSchedule('outbox', Date.now() + delay);
  }

  private async flushOutboxToQueue(
    drainOpts?: { maxMessages?: number; maxBytes?: number },
  ): Promise<{ flushed: number; backlog: boolean }> {
    const source = this.outboxSourceSync();
    return this.flushOutbox(async (batch) => {
      await this.env.EVENTS_QUEUE.sendBatch(batch.map((row) => toQueueBatchEntry(row, source)));
    }, drainOpts);
  }

  async alarm(): Promise<void> {
    await this.scheduler.run({
      outbox: async () => {
        const { flushed, backlog } = await this.flushOutboxToQueue();
        this.rescheduleOutboxAfterFlush(flushed, backlog);
      },
    });
  }

  /** Test helper (unsafe-local only): invoke `alarm()` directly. */
  async triggerAlarmForTest(): Promise<void> {
    this.assertUnsafeLocal('triggerAlarmForTest');
    return this.alarm();
  }

  /** Test helper: read a raw `alarm_schedule` row. */
  async getAlarmSchedule(name: string): Promise<{ nextRunAt: number; lastError: string | null } | null> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT next_run_at, last_error FROM alarm_schedule WHERE name = ?`, name)
      .toArray() as Array<{ next_run_at: number; last_error: string | null }>;
    const row = rows[0];
    if (!row) return null;
    return { nextRunAt: row.next_run_at, lastError: row.last_error };
  }

  /** Test helper (unsafe-local only): force a raw `alarm_schedule.next_run_at`. */
  async setAlarmScheduleForTest(name: string, nextRunAt: number): Promise<void> {
    this.assertUnsafeLocal('setAlarmScheduleForTest');
    this.scheduler.upsertSchedule(name, nextRunAt);
  }

  async outboxUnackedCount(): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM outbox WHERE acked = 0`)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async drainOutboxBatch(opts?: { maxMessages?: number; maxBytes?: number }): Promise<OutboxRow[]> {
    return drainOutbox(this.ctx.storage.sql, { ...opts, source: this.outboxSourceSync() }).rows;
  }

  async ackOutboxThrough(seq: number): Promise<void> {
    ackOutboxThroughSql(this.ctx.storage.sql, seq);
  }

  async flushOutbox(
    deliver?: (batch: OutboxRow[]) => Promise<void>,
    drainOpts?: { maxMessages?: number; maxBytes?: number },
  ): Promise<{ flushed: number; backlog: boolean }> {
    const { rows: batch, backlog } = drainOutbox(this.ctx.storage.sql, {
      source: this.outboxSourceSync(),
      ...drainOpts,
    });
    if (batch.length === 0) return { flushed: 0, backlog: false };
    if (deliver) await deliver(batch);
    ackOutboxThroughSql(this.ctx.storage.sql, batch[batch.length - 1]!.seq);
    return { flushed: batch.length, backlog };
  }

  private async gateCoreEntitlement(
    orgId: string,
  ): Promise<{ ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE } | null> {
    const result = await assertEntitled(this.env, this.entitlementCache, orgId, 'pms.core');
    if (!result.ok) return result;
    return null;
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

  async getMemberRole(userId: string): Promise<'owner' | 'admin' | 'staff' | null> {
    const row = this.ctx.storage.sql
      .exec(`SELECT role FROM member WHERE user_id = ?`, userId)
      .toArray()[0] as { role: string } | undefined;
    if (!row) return null;
    return row.role as 'owner' | 'admin' | 'staff';
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
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

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

          this.appendOrgOutbox({
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
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

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

          this.appendOrgOutbox({
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
    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

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

          const keyStore = new SqlKeyStore(this.ctx.storage.sql);
          if (!keyStore.shred(guest.pii_key_id)) {
            throw new Error('key_shred_failed');
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE guest SET erased_at = ?, updated_at = ? WHERE guest_id = ?`,
            now,
            now,
            input.guestId,
          );

          this.appendOrgOutbox({
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

  /** Test hook — true when wrapped_key blob has decryptable material. */
  async testDataKeyHasMaterial(piiKeyId: string): Promise<boolean> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT length(wrapped_key) AS key_len FROM data_key WHERE pii_key_id = ?`, piiKeyId)
      .toArray() as Array<{ key_len: number | null }>;
    return (rows[0]?.key_len ?? 0) > 0;
  }

  /** Test hook — read via SqlKeyStore.get() (ArrayBuffer → Uint8Array normalization path). */
  async testGetDataKeyRecord(
    piiKeyId: string,
  ): Promise<{ wrappedKeyByteLength: number; shredded: boolean; wrappedKeyIsUint8Array: boolean } | null> {
    const record = new SqlKeyStore(this.ctx.storage.sql).get(piiKeyId);
    if (!record) return null;
    return {
      wrappedKeyByteLength: record.wrappedKey.byteLength,
      shredded: record.shredded,
      wrappedKeyIsUint8Array: record.wrappedKey instanceof Uint8Array,
    };
  }
}
