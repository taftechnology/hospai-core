import { DurableObject } from 'cloudflare:workers';
import {
  EMPTY_KINDS,
  FORBIDDEN,
  GUEST_ALREADY_ERASED,
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
  IDEM_KEY_REUSED,
  INVALID_KINDS,
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  ROLE_GRANTS,
  STAFF_EXITED,
  STAFF_NOT_ASSIGNABLE,
  STAFF_NOT_FOUND,
  ORG_ID_UNSET,
  NOT_MEMBER,
  SCOPE_MISMATCH,
  BULK_NOT_ADMITTED,
  INTERNAL_ERROR,
  PROPERTY_REF_NOT_FOUND,
  DECRYPT_UNRESOLVED,
  KEY_SHRED_FAILED,
  isCommandError,
  isOrgScopedPermission,
  isPropertyScopedPermission,
  type ActorContext,
  type CommandError,
  type EventSource,
  type IdempotencyKey,
  type OrgRole,
  type OrgScopedPermission,
  type Permission,
  type PropertyScopedPermission,
} from '@hospai/contracts';
import {
  ORG_MIGRATIONS,
  appendOutbox,
  ackOutboxThrough as ackOutboxThroughSql,
  AlarmScheduler,
  drainOutbox,
  migrateSql,
  LaneGuard,
  type LaneGuardOptions,
  outboxBacklogSnapshot,
  runIdempotent,
  IdempotencyKeyReused,
  toQueueBatchEntry,
  OUTBOX_BACKLOG_DELAY_MS,
  OUTBOX_SWEEP_INTERVAL_MS,
  type OutboxRow,
} from '@hospai/do-runtime';
import {
  blindIndexHash,
  blindIndexRows,
  importBlindIndexKeyHex,
  importMasterKeyHex,
  normalizeBlindIndexValue,
  PiiVault,
  type BlindIndexKind,
  type GuestProfile,
  type StaffProfile,
  type StaffProfileCreate,
} from '@hospai/crypto-shredding';
import { assertEntitled, EntitlementDoCache } from '@hospai/entitlement-client';
import type { PmsEnv } from './env.js';
import { runOutboxAlarmStep, type OutboxAlarmContext } from './outbox-observability.js';
import { SqlKeyStore } from './org-key-store.js';
import { ORG_DO_TRANSPORT_BLOCKED_MESSAGE } from './org-do-transport.js';

type MembershipError =
  | 'not_member'
  | 'forbidden'
  | 'already_member'
  | 'role_escalation'
  | 'last_owner'
  | 'invalid_role';

const ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, staff: 1 };

function isOrgRole(role: string): role is OrgRole {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

function wouldLeaveZeroOwners(
  sql: DurableObjectState['storage']['sql'],
  targetUserId: string,
): boolean {
  const rows = sql
    .exec(
      `SELECT COUNT(*) AS c FROM member WHERE role = 'owner' AND user_id != ?`,
      targetUserId,
    )
    .toArray() as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0) === 0;
}

type RankMembershipError = Exclude<MembershipError, 'already_member' | 'not_member'>;

/** Org writes: strictly-below, plus symmetric owner↔owner peer ops. Self-raise forbidden. */
function assertOrgRankAllowed(
  callerRole: OrgRole,
  requestedOrInvolved: OrgRole,
  currentRole: OrgRole | null,
  ctx: { actorUserId: string; targetUserId: string; removing?: boolean },
): RankMembershipError | null {
  if (
    ctx.actorUserId === ctx.targetUserId &&
    currentRole &&
    !ctx.removing &&
    ROLE_RANK[requestedOrInvolved] > ROLE_RANK[currentRole]
  ) {
    return 'role_escalation';
  }
  const rolesToCheck: OrgRole[] = [requestedOrInvolved];
  if (currentRole && currentRole !== requestedOrInvolved) rolesToCheck.push(currentRole);
  for (const role of rolesToCheck) {
    if (callerRole === 'owner' && role === 'owner') continue;
    if (ROLE_RANK[role] >= ROLE_RANK[callerRole]) return 'role_escalation';
  }
  return null;
}

/** Property writes: strictly-below only (no peer-owner). Roles admin|staff validated by caller. */
function assertPropertyRankAllowed(
  callerRole: OrgRole,
  requestedOrInvolved: OrgRole,
  currentRole: OrgRole | null,
  ctx: { actorUserId: string; targetUserId: string; removing?: boolean },
): RankMembershipError | null {
  if (
    ctx.actorUserId === ctx.targetUserId &&
    currentRole &&
    !ctx.removing &&
    ROLE_RANK[requestedOrInvolved] > ROLE_RANK[currentRole]
  ) {
    return 'role_escalation';
  }
  const rolesToCheck: OrgRole[] = [requestedOrInvolved];
  if (currentRole && currentRole !== requestedOrInvolved) rolesToCheck.push(currentRole);
  for (const role of rolesToCheck) {
    if (ROLE_RANK[role] >= ROLE_RANK[callerRole]) return 'role_escalation';
  }
  return null;
}

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

class StaffNotFoundError extends Error {
  constructor() {
    super('Staff not found');
    this.name = 'StaffNotFoundError';
  }
}

class StaffExitedError extends Error {
  constructor() {
    super('Staff exited');
    this.name = 'StaffExitedError';
  }
}

const PHASE1_ROSTER_KINDS = ['housekeeper'] as const;

function rosterKindsError(kinds: string[]): typeof EMPTY_KINDS | typeof INVALID_KINDS | null {
  if (kinds.length === 0) return EMPTY_KINDS;
  if (kinds.some((k) => !(PHASE1_ROSTER_KINDS as readonly string[]).includes(k))) return INVALID_KINDS;
  return null;
}

function profileHasCompensation(profile: Partial<StaffProfileCreate> | undefined): boolean {
  if (!profile) return false;
  return (
    profile.hourlyRateMinor !== undefined ||
    profile.hourlyRateCurrency !== undefined ||
    profile.rating !== undefined ||
    profile.skills !== undefined
  );
}

type RosterRow = {
  staff_id: string;
  pii_key_id: string;
  profile_cipher: Uint8Array;
  profile_iv: Uint8Array;
  status: 'active' | 'inactive';
  exited_at: number | null;
};

type RosterWriteOk = { ok: true; staffId: string; piiKeyId: string };
type RosterGateError =
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
  | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
  | { ok: false; error: typeof ORG_ID_UNSET }
  | NonNullable<ReturnType<typeof mapOrgCommandError>>;

function mapOrgCommandError(e: unknown): { ok: false; error: CommandError } | null {
  if (!(e instanceof Error)) return null;
  const msg = e.message;

  if (msg === 'key_shred_failed') {
    return { ok: false, error: KEY_SHRED_FAILED };
  }
  if (msg === 'org_id_unset') {
    return { ok: false, error: ORG_ID_UNSET };
  }

  if (isCommandError(msg)) {
    return { ok: false, error: msg };
  }

  return null;
}

/**
 * Pre-probe for the hybrid idempotency contract (see `runIdempotent` in `@hospai/do-runtime`).
 * `runIdempotent` itself checks-and-inserts atomically inside `transactionSync`, and the
 * `INSERT INTO data_key` for create/update happens inside that same `execute` callback, so
 * `runIdempotent` alone already prevents a replay from minting a second `data_key` — this
 * pre-probe is not what makes that correct. What this buys us is avoiding the vault `await`s
 * (key mint / seal, which run before `runIdempotent` is even called) on a replay: without it, a
 * replayed create/update would still burn crypto CPU on work whose result gets discarded once
 * `runIdempotent`'s in-transaction check finds the prior row. `runIdempotent` remains the sole
 * source of truth for not-inserting-twice; this is a latency/CPU optimization, not a substitute.
 */
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

const SEARCH_PHONE_RE = /^[+]?[\d\s().-]{7,}$/;

export class OrgDO extends DurableObject<PmsEnv> {
  private vaultPromise: Promise<PiiVault> | null = null;
  private blindIndexKeyPromise: Promise<CryptoKey> | null = null;
  private readonly entitlementCache = new EntitlementDoCache();
  private readonly scheduler: AlarmScheduler;
  private lanes = new LaneGuard();
  private transportBlockedForTest = false;
  private guestReadRpcCountForTest = 0;

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

  private async blindIndexKey(): Promise<CryptoKey> {
    if (!this.blindIndexKeyPromise) {
      this.blindIndexKeyPromise = (async () => {
        const hex = this.env.HOSPAI_ORG_MASTER_KEY;
        if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
        return importBlindIndexKeyHex(hex);
      })();
    }
    return this.blindIndexKeyPromise;
  }

  private replaceGuestBlindIndexSync(
    guestId: string,
    rows: Array<{ kind: BlindIndexKind; hash: Uint8Array }>,
  ): void {
    this.ctx.storage.sql.exec(`DELETE FROM guest_blind_index WHERE guest_id = ?`, guestId);
    for (const row of rows) {
      this.ctx.storage.sql.exec(
        `INSERT INTO guest_blind_index (guest_id, kind, index_hash) VALUES (?, ?, ?)`,
        guestId,
        row.kind,
        row.hash,
      );
    }
  }

  private deleteGuestBlindIndexSync(guestId: string): void {
    this.ctx.storage.sql.exec(`DELETE FROM guest_blind_index WHERE guest_id = ?`, guestId);
  }

  private async hashesForSearchQuery(
    q: string,
  ): Promise<Array<{ kind: BlindIndexKind; hash: Uint8Array }>> {
    const key = await this.blindIndexKey();
    if (q.includes('@')) {
      const email = normalizeBlindIndexValue('email', q);
      if (!email) return [];
      return [{ kind: 'email', hash: await blindIndexHash(key, 'email', email) }];
    }
    if (SEARCH_PHONE_RE.test(q)) {
      const phone = normalizeBlindIndexValue('phone', q);
      if (!phone) return [];
      return [{ kind: 'phone', hash: await blindIndexHash(key, 'phone', phone) }];
    }
    const rows: Array<{ kind: BlindIndexKind; hash: Uint8Array }> = [];
    const name = normalizeBlindIndexValue('name', q);
    if (name) {
      rows.push({ kind: 'name', hash: await blindIndexHash(key, 'name', name) });
      const seen = new Set<string>();
      for (const token of name.split(' ')) {
        const normalized = normalizeBlindIndexValue('name_token', token);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        rows.push({ kind: 'name_token', hash: await blindIndexHash(key, 'name_token', normalized) });
      }
    }
    return rows;
  }

  private async ensureGuestBlindIndex(scope: string | 'missing'): Promise<void> {
    const rows =
      scope === 'missing'
        ? (this.ctx.storage.sql
            .exec(
              `SELECT guest_id FROM guest
               WHERE erased_at IS NULL
                 AND guest_id NOT IN (SELECT DISTINCT guest_id FROM guest_blind_index)
               LIMIT 25`,
            )
            .toArray() as Array<{ guest_id: string }>)
        : (this.ctx.storage.sql
            .exec(
              `SELECT guest_id FROM guest
               WHERE erased_at IS NULL
                 AND guest_id = ?
                 AND guest_id NOT IN (SELECT DISTINCT guest_id FROM guest_blind_index)
               LIMIT 25`,
              scope,
            )
            .toArray() as Array<{ guest_id: string }>);

    if (rows.length === 0) return;
    const key = await this.blindIndexKey();
    for (const row of rows) {
      const entry = await this.readGuestEntry(row.guest_id);
      if (!entry.ok) continue;
      if (entry.erased) continue;
      const hashes = await blindIndexRows(key, entry.profile);
      this.ctx.storage.transactionSync(() => {
        this.replaceGuestBlindIndexSync(row.guest_id, hashes);
      });
    }
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

  private assertRpcAvailable(): void {
    if (this.transportBlockedForTest) {
      throw new Error(ORG_DO_TRANSPORT_BLOCKED_MESSAGE);
    }
  }

  async setTransportBlockedForTest(blocked: boolean): Promise<void> {
    this.assertUnsafeLocal('setTransportBlockedForTest');
    this.transportBlockedForTest = blocked;
  }

  async resetGuestReadRpcCountForTest(): Promise<void> {
    this.assertUnsafeLocal('resetGuestReadRpcCountForTest');
    this.guestReadRpcCountForTest = 0;
  }

  async getGuestReadRpcCountForTest(): Promise<number> {
    this.assertUnsafeLocal('getGuestReadRpcCountForTest');
    return this.guestReadRpcCountForTest;
  }

  private async readGuestEntry(
    guestId: string,
  ): Promise<
    | { ok: true; guestId: string; erased: false; profile: GuestProfile }
    | { ok: true; guestId: string; erased: true; profile: null }
    | { ok: false; guestId: string; error: typeof GUEST_NOT_FOUND }
    | { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
  > {
    const rows = this.ctx.storage.sql
      .exec(`SELECT pii_key_id, profile_cipher, profile_iv, erased_at FROM guest WHERE guest_id = ?`, guestId)
      .toArray() as unknown as Array<{
      pii_key_id: string;
      profile_cipher: Uint8Array;
      profile_iv: Uint8Array;
      erased_at: number | null;
    }>;
    const guest = rows[0];
    if (!guest) return { ok: false, guestId, error: GUEST_NOT_FOUND };
    if (guest.erased_at != null) return { ok: true, guestId, erased: true, profile: null };
    try {
      const vault = await this.vault();
      const profile = await vault.decryptGuestProfile(
        guest.pii_key_id,
        guest.profile_cipher,
        guest.profile_iv,
      );
      return { ok: true, guestId, erased: false, profile };
    } catch {
      return { ok: false, guestId, error: DECRYPT_UNRESOLVED };
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

  private outboxAlarmContext(): OutboxAlarmContext {
    return {
      sql: this.ctx.storage.sql,
      tags: { orgId: this.getOrgIdSync() ?? undefined },
      lanes: this.lanes,
      upsertOutboxSchedule: (nextRunAt) => this.scheduler.upsertSchedule('outbox', nextRunAt),
    };
  }

  private rescheduleOutboxAfterFlush(flushed: number, backlog: boolean): void {
    const delay =
      flushed === 0 ? OUTBOX_SWEEP_INTERVAL_MS : backlog ? OUTBOX_BACKLOG_DELAY_MS : OUTBOX_SWEEP_INTERVAL_MS;
    this.scheduler.upsertSchedule('outbox', Date.now() + delay);
  }

  private async flushOutboxToQueue(
    drainOpts?: { maxMessages?: number; maxBytes?: number },
  ): Promise<{ flushed: number; backlog: boolean; rows: OutboxRow[] }> {
    const source = this.outboxSourceSync();
    return this.flushOutbox(async (batch) => {
      await this.env.EVENTS_QUEUE.sendBatch(batch.map((row) => toQueueBatchEntry(row, source)));
    }, drainOpts);
  }

  async alarm(): Promise<void> {
    await this.scheduler.run({
      outbox: async () => {
        await runOutboxAlarmStep(
          this.outboxAlarmContext(),
          () => this.flushOutboxToQueue(),
          (flushed, backlog) => this.rescheduleOutboxAfterFlush(flushed, backlog),
        );
      },
    });
  }

  /** Test helper (unsafe-local only): replace LaneGuard (e.g. quietMs override or reset admission state). */
  async resetLaneGuardForTest(opts?: LaneGuardOptions): Promise<void> {
    this.assertUnsafeLocal('resetLaneGuardForTest');
    this.lanes = new LaneGuard(opts);
  }

  async getLaneGuardLastInteractiveAtForTest(): Promise<number> {
    this.assertUnsafeLocal('getLaneGuardLastInteractiveAtForTest');
    return this.lanes.getLastInteractiveAt();
  }

  async countGuestBlindIndexForTest(guestId: string): Promise<number> {
    this.assertUnsafeLocal('countGuestBlindIndexForTest');
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM guest_blind_index WHERE guest_id = ?`, guestId)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
  }

  async verifyGuestKeyShredded(
    guestId: string,
  ): Promise<{ ok: true; shredded: boolean } | { ok: false; error: typeof GUEST_NOT_FOUND }> {
    this.assertRpcAvailable();
    const guests = this.ctx.storage.sql
      .exec(`SELECT pii_key_id FROM guest WHERE guest_id = ?`, guestId)
      .toArray() as Array<{ pii_key_id: string }>;
    const guest = guests[0];
    if (!guest) return { ok: false, error: GUEST_NOT_FOUND };
    const keys = this.ctx.storage.sql
      .exec(
        `SELECT shredded_at, length(wrapped_key) AS key_len FROM data_key WHERE pii_key_id = ?`,
        guest.pii_key_id,
      )
      .toArray() as Array<{ shredded_at: number | null; key_len: number }>;
    const key = keys[0];
    if (!key) return { ok: true, shredded: false };
    const shredded = key.shredded_at != null && Number(key.key_len) === 0;
    return { ok: true, shredded };
  }

  async shredRemainingGuestKeys(): Promise<
    { ok: true; shredded: number } | { ok: false; error: typeof BULK_NOT_ADMITTED }
  > {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: BULK_NOT_ADMITTED };
    }
    const keyStore = new SqlKeyStore(this.ctx.storage.sql);
    const rows = this.ctx.storage.sql
      .exec(`SELECT pii_key_id FROM data_key WHERE shredded_at IS NULL`)
      .toArray() as Array<{ pii_key_id: string }>;
    let shredded = 0;
    for (const { pii_key_id } of rows) {
      if (keyStore.shred(pii_key_id)) shredded += 1;
    }
    return { ok: true, shredded };
  }

  async clearGuestProfileBlobs(
    guestId: string,
  ): Promise<{ ok: true } | { ok: false; error: typeof BULK_NOT_ADMITTED }> {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: BULK_NOT_ADMITTED };
    }
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.deleteGuestBlindIndexSync(guestId);
      this.ctx.storage.sql.exec(
        `UPDATE guest SET profile_cipher = x'', profile_iv = x'', updated_at = ? WHERE guest_id = ?`,
        now,
        guestId,
      );
    });
    return { ok: true };
  }

  async purgeStorageForTenant(): Promise<
    { ok: true; deletedApprox: number } | { ok: false; error: typeof BULK_NOT_ADMITTED }
  > {
    this.assertRpcAvailable();
    if (!this.lanes.admitBackground()) {
      return { ok: false, error: BULK_NOT_ADMITTED };
    }
    const deletedApprox = await this.countNonBookkeepingRows();
    await this.ctx.storage.deleteAll();
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // ignore
    }
    return { ok: true, deletedApprox };
  }

  async countNonBookkeepingRows(): Promise<number> {
    this.assertRpcAvailable();
    const schemaPresent =
      (
        this.ctx.storage.sql
          .exec(`SELECT 1 AS one FROM sqlite_master WHERE type='table' AND name = 'schema_version'`)
          .toArray() as Array<{ one: number }>
      ).length > 0;
    if (!schemaPresent) return 0;

    const tables = this.ctx.storage.sql
      .exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .toArray() as Array<{ name: string }>;
    const allow = new Set(['schema_version', '__cf_kv']);
    let total = 0;
    for (const { name } of tables) {
      if (allow.has(name)) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`unexpected_table_name:${name}`);
      }
      const rows = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${name}`).toArray() as Array<{
        n: number;
      }>;
      total += Number(rows[0]?.n ?? 0);
    }
    return total;
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

  async getOutboxBacklog(): Promise<{ unackedCount: number; oldestCreatedAt: number | null }> {
    return outboxBacklogSnapshot(this.ctx.storage.sql);
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
  ): Promise<{ flushed: number; backlog: boolean; rows: OutboxRow[] }> {
    const { rows: batch, backlog } = drainOutbox(this.ctx.storage.sql, {
      source: this.outboxSourceSync(),
      ...drainOpts,
    });
    if (batch.length === 0) return { flushed: 0, backlog: false, rows: [] };
    if (deliver) await deliver(batch);
    ackOutboxThroughSql(this.ctx.storage.sql, batch[batch.length - 1]!.seq);
    return { flushed: batch.length, backlog, rows: batch };
  }

  private async gateCoreEntitlement(
    orgId: string,
  ): Promise<{ ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE } | null> {
    const result = await assertEntitled(this.env, this.entitlementCache, orgId, 'pms.core');
    if (!result.ok) return result;
    return null;
  }

  /** System actor short-circuits (no replay path reaches guest commands today; kept for PropertyDO symmetry). */
  private async gatePermission(
    actor: ActorContext,
    propertyId: string,
    permission: Permission,
  ): Promise<{ ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH } | null> {
    if (actor.kind === 'system') return null;

    const result = await this.assertPermission({ userId: actor.userId, propertyId, permission });
    if (!result.ok) return { ok: false, error: result.error };
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

  async getMemberRole(userId: string): Promise<OrgRole | null> {
    const row = this.ctx.storage.sql
      .exec(`SELECT role FROM member WHERE user_id = ?`, userId)
      .toArray()[0] as { role: string } | undefined;
    if (!row) return null;
    return row.role as OrgRole;
  }

  async getEffectiveRole(userId: string, propertyId: string | null): Promise<OrgRole | null> {
    const orgRole = await this.getMemberRole(userId);
    // Org scope — never consult property_member overrides.
    if (!propertyId) return orgRole;

    const row = this.ctx.storage.sql
      .exec(`SELECT role FROM property_member WHERE user_id = ? AND property_id = ?`, userId, propertyId)
      .toArray()[0] as { role: string } | undefined;
    if (orgRole) return (row?.role as OrgRole | undefined) ?? orgRole;
    return (row?.role as OrgRole | undefined) ?? null;
  }

  async assertPermission(input: {
    userId: string;
    propertyId: string | null;
    permission: Permission;
  }): Promise<
    | { ok: true; role: OrgRole }
    | { ok: false; error: 'not_member' | 'forbidden' | 'scope_mismatch' }
  > {
    if (isOrgScopedPermission(input.permission) && input.propertyId !== null) {
      return { ok: false, error: SCOPE_MISMATCH };
    }
    if (isPropertyScopedPermission(input.permission) && input.propertyId === null) {
      return { ok: false, error: SCOPE_MISMATCH };
    }

    const role = await this.getEffectiveRole(input.userId, input.propertyId);
    if (!role) return { ok: false, error: NOT_MEMBER };
    if (!ROLE_GRANTS[role].includes(input.permission)) {
      return { ok: false, error: 'forbidden' };
    }
    return { ok: true, role };
  }

  async readPropertyMe(
    actor: ActorContext,
    propertyId: string,
  ): Promise<
    | {
        ok: true;
        role: OrgRole;
        permissions: PropertyScopedPermission[];
        orgPermissions: OrgScopedPermission[];
      }
    | { ok: false; error: 'not_member' }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };

    const role = await this.getEffectiveRole(actor.userId, propertyId);
    if (!role) return { ok: false, error: 'not_member' };

    const grants = ROLE_GRANTS[role];
    return {
      ok: true,
      role,
      permissions: grants.filter(isPropertyScopedPermission),
      orgPermissions: grants.filter(isOrgScopedPermission),
    };
  }

  async upsertPropertyMember(
    userId: string,
    propertyId: string,
    role: OrgRole,
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO property_member (user_id, property_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, property_id) DO UPDATE SET role = excluded.role`,
      userId,
      propertyId,
      role,
      Date.now(),
    );
  }

  async listOrgMembers(
    actor: ActorContext,
  ): Promise<
    | {
        ok: true;
        members: Array<{
          userId: string;
          role: OrgRole;
          createdAt: number;
          updatedAt: number | null;
        }>;
      }
    | { ok: false; error: MembershipError }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };
    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId: null,
      permission: 'org:manage',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT user_id, role, created_at, updated_at FROM member ORDER BY created_at ASC, user_id ASC`,
      )
      .toArray() as Array<{
      user_id: string;
      role: string;
      created_at: number;
      updated_at: number | null;
    }>;
    return {
      ok: true,
      members: rows.map((r) => ({
        userId: r.user_id,
        role: r.role as OrgRole,
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
      })),
    };
  }

  async setOrgMember(
    actor: ActorContext,
    input: { targetUserId: string; role: OrgRole; mode: 'create' | 'update' },
  ): Promise<
    | { ok: true; userId: string; role: OrgRole; previousRole?: OrgRole }
    | { ok: false; error: 'already_member'; role: OrgRole }
    | { ok: false; error: Exclude<MembershipError, 'already_member'> }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };
    if (!isOrgRole(input.role)) return { ok: false, error: 'invalid_role' };

    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId: null,
      permission: 'org:manage',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const callerRole = await this.getMemberRole(actor.userId);
    if (!callerRole) return { ok: false, error: 'not_member' };

    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'forbidden' };

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.ctx.storage.sql
          .exec(`SELECT role FROM member WHERE user_id = ?`, input.targetUserId)
          .toArray()[0] as { role: string } | undefined;

        if (input.mode === 'create') {
          if (existing) {
            return {
              ok: false as const,
              error: 'already_member' as const,
              role: existing.role as OrgRole,
            };
          }
          const rankErr = assertOrgRankAllowed(callerRole, input.role, null, {
            actorUserId: actor.userId,
            targetUserId: input.targetUserId,
          });
          if (rankErr) return { ok: false as const, error: rankErr };
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO member (user_id, role, created_at, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
            input.targetUserId,
            input.role,
            now,
            now,
            actor.userId,
          );
          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'staff.changed',
            payload: {
              orgId,
              actorUserId: actor.userId,
              targetUserId: input.targetUserId,
              action: 'added',
              role: input.role,
              propertyId: null,
              createdAt: now,
            },
          });
          return { ok: true as const, userId: input.targetUserId, role: input.role };
        }

        if (!existing) return { ok: false as const, error: 'not_member' as const };
        const previousRole = existing.role as OrgRole;
        if (previousRole === input.role) {
          return {
            ok: true as const,
            userId: input.targetUserId,
            role: input.role,
            previousRole,
          };
        }
        const rankErr = assertOrgRankAllowed(callerRole, input.role, previousRole, {
          actorUserId: actor.userId,
          targetUserId: input.targetUserId,
        });
        if (rankErr) return { ok: false as const, error: rankErr };
        if (previousRole === 'owner' && wouldLeaveZeroOwners(this.ctx.storage.sql, input.targetUserId)) {
          return { ok: false as const, error: 'last_owner' as const };
        }
        const now = Date.now();
        this.ctx.storage.sql.exec(
          `UPDATE member SET role = ?, updated_at = ?, updated_by = ? WHERE user_id = ?`,
          input.role,
          now,
          actor.userId,
          input.targetUserId,
        );
        this.appendOrgOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'staff.changed',
          payload: {
            orgId,
            actorUserId: actor.userId,
            targetUserId: input.targetUserId,
            action: 'updated',
            role: input.role,
            previousRole,
            propertyId: null,
            createdAt: now,
          },
        });
        return {
          ok: true as const,
          userId: input.targetUserId,
          role: input.role,
          previousRole,
        };
      });
    } catch {
      return { ok: false, error: 'forbidden' };
    }
  }

  async removeOrgMember(
    actor: ActorContext,
    targetUserId: string,
  ): Promise<{ ok: true; userId: string } | { ok: false; error: MembershipError }> {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };

    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId: null,
      permission: 'org:manage',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const callerRole = await this.getMemberRole(actor.userId);
    if (!callerRole) return { ok: false, error: 'not_member' };

    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'forbidden' };

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.ctx.storage.sql
          .exec(`SELECT role FROM member WHERE user_id = ?`, targetUserId)
          .toArray()[0] as { role: string } | undefined;
        if (!existing) return { ok: false as const, error: 'not_member' as const };
        const previousRole = existing.role as OrgRole;

        const rankErr = assertOrgRankAllowed(callerRole, previousRole, previousRole, {
          actorUserId: actor.userId,
          targetUserId,
          removing: true,
        });
        if (rankErr) return { ok: false as const, error: rankErr };

        if (previousRole === 'owner' && wouldLeaveZeroOwners(this.ctx.storage.sql, targetUserId)) {
          return { ok: false as const, error: 'last_owner' as const };
        }

        const overrides = this.ctx.storage.sql
          .exec(`SELECT property_id, role FROM property_member WHERE user_id = ?`, targetUserId)
          .toArray() as Array<{ property_id: string; role: string }>;

        const now = Date.now();
        this.ctx.storage.sql.exec(`DELETE FROM member WHERE user_id = ?`, targetUserId);
        this.ctx.storage.sql.exec(`DELETE FROM property_member WHERE user_id = ?`, targetUserId);

        this.appendOrgOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'staff.changed',
          payload: {
            orgId,
            actorUserId: actor.userId,
            targetUserId,
            action: 'removed',
            role: previousRole,
            previousRole,
            propertyId: null,
            createdAt: now,
          },
        });
        for (const o of overrides) {
          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'staff.changed',
            payload: {
              orgId,
              actorUserId: actor.userId,
              targetUserId,
              action: 'removed',
              role: o.role,
              previousRole: o.role,
              propertyId: o.property_id,
              createdAt: now,
            },
          });
        }
        return { ok: true as const, userId: targetUserId };
      });
    } catch {
      return { ok: false, error: 'forbidden' };
    }
  }

  async listPropertyMembers(
    actor: ActorContext,
    propertyId: string,
  ): Promise<
    | {
        ok: true;
        members: Array<{
          userId: string;
          role: OrgRole;
          createdAt: number;
          updatedAt: number | null;
          hasOrgRole: boolean;
        }>;
      }
    | { ok: false; error: MembershipError }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };
    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId,
      permission: 'staff:read',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT pm.user_id, pm.role, pm.created_at, pm.updated_at,
                CASE WHEN m.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_org_role
         FROM property_member pm
         LEFT JOIN member m ON m.user_id = pm.user_id
         WHERE pm.property_id = ?
         ORDER BY pm.created_at ASC, pm.user_id ASC`,
        propertyId,
      )
      .toArray() as Array<{
      user_id: string;
      role: string;
      created_at: number;
      updated_at: number | null;
      has_org_role: number;
    }>;
    return {
      ok: true,
      members: rows.map((r) => ({
        userId: r.user_id,
        role: r.role as OrgRole,
        createdAt: r.created_at,
        updatedAt: r.updated_at ?? r.created_at,
        hasOrgRole: Number(r.has_org_role) === 1,
      })),
    };
  }

  async setPropertyMember(
    actor: ActorContext,
    propertyId: string,
    input: { targetUserId: string; role: OrgRole; mode: 'create' | 'update' },
  ): Promise<
    | { ok: true; userId: string; role: OrgRole; previousRole?: OrgRole }
    | { ok: false; error: 'already_member'; role: OrgRole }
    | { ok: false; error: Exclude<MembershipError, 'already_member'> }
  > {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };
    // admin|staff only — `owner` (and any other value) → invalid_role
    if (input.role !== 'admin' && input.role !== 'staff') return { ok: false, error: 'invalid_role' };

    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId,
      permission: 'staff:write',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const callerRole = await this.getEffectiveRole(actor.userId, propertyId);
    if (!callerRole) return { ok: false, error: 'not_member' };

    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'forbidden' };

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.ctx.storage.sql
          .exec(
            `SELECT role FROM property_member WHERE user_id = ? AND property_id = ?`,
            input.targetUserId,
            propertyId,
          )
          .toArray()[0] as { role: string } | undefined;

        if (input.mode === 'create') {
          if (existing) {
            return {
              ok: false as const,
              error: 'already_member' as const,
              role: existing.role as OrgRole,
            };
          }
          const rankErr = assertPropertyRankAllowed(callerRole, input.role, null, {
            actorUserId: actor.userId,
            targetUserId: input.targetUserId,
          });
          if (rankErr) return { ok: false as const, error: rankErr };
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO property_member (user_id, property_id, role, created_at, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            input.targetUserId,
            propertyId,
            input.role,
            now,
            now,
            actor.userId,
          );
          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'staff.changed',
            payload: {
              orgId,
              actorUserId: actor.userId,
              targetUserId: input.targetUserId,
              action: 'added',
              role: input.role,
              propertyId,
              createdAt: now,
            },
          });
          return { ok: true as const, userId: input.targetUserId, role: input.role };
        }

        if (!existing) return { ok: false as const, error: 'not_member' as const };
        const previousRole = existing.role as OrgRole;
        if (previousRole === input.role) {
          return {
            ok: true as const,
            userId: input.targetUserId,
            role: input.role,
            previousRole,
          };
        }
        const rankErr = assertPropertyRankAllowed(callerRole, input.role, previousRole, {
          actorUserId: actor.userId,
          targetUserId: input.targetUserId,
        });
        if (rankErr) return { ok: false as const, error: rankErr };
        const now = Date.now();
        this.ctx.storage.sql.exec(
          `UPDATE property_member SET role = ?, updated_at = ?, updated_by = ?
           WHERE user_id = ? AND property_id = ?`,
          input.role,
          now,
          actor.userId,
          input.targetUserId,
          propertyId,
        );
        this.appendOrgOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'staff.changed',
          payload: {
            orgId,
            actorUserId: actor.userId,
            targetUserId: input.targetUserId,
            action: 'updated',
            role: input.role,
            previousRole,
            propertyId,
            createdAt: now,
          },
        });
        return {
          ok: true as const,
          userId: input.targetUserId,
          role: input.role,
          previousRole,
        };
      });
    } catch {
      return { ok: false, error: 'forbidden' };
    }
  }

  async removePropertyMember(
    actor: ActorContext,
    propertyId: string,
    targetUserId: string,
  ): Promise<{ ok: true; userId: string } | { ok: false; error: MembershipError }> {
    this.assertRpcAvailable();
    if (actor.kind !== 'user') return { ok: false, error: 'not_member' };

    const gate = await this.assertPermission({
      userId: actor.userId,
      propertyId,
      permission: 'staff:write',
    });
    if (!gate.ok) return { ok: false, error: gate.error === 'scope_mismatch' ? 'forbidden' : gate.error };

    const callerRole = await this.getEffectiveRole(actor.userId, propertyId);
    if (!callerRole) return { ok: false, error: 'not_member' };

    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: 'forbidden' };

    try {
      return this.ctx.storage.transactionSync(() => {
        const existing = this.ctx.storage.sql
          .exec(
            `SELECT role FROM property_member WHERE user_id = ? AND property_id = ?`,
            targetUserId,
            propertyId,
          )
          .toArray()[0] as { role: string } | undefined;
        if (!existing) return { ok: false as const, error: 'not_member' as const };
        const previousRole = existing.role as OrgRole;

        const rankErr = assertPropertyRankAllowed(callerRole, previousRole, previousRole, {
          actorUserId: actor.userId,
          targetUserId,
          removing: true,
        });
        if (rankErr) return { ok: false as const, error: rankErr };

        const now = Date.now();
        this.ctx.storage.sql.exec(
          `DELETE FROM property_member WHERE user_id = ? AND property_id = ?`,
          targetUserId,
          propertyId,
        );
        this.appendOrgOutbox({
          eventId: crypto.randomUUID(),
          eventType: 'staff.changed',
          payload: {
            orgId,
            actorUserId: actor.userId,
            targetUserId,
            action: 'removed',
            role: previousRole,
            previousRole,
            propertyId,
            createdAt: now,
          },
        });
        return { ok: true as const, userId: targetUserId };
      });
    } catch {
      return { ok: false, error: 'forbidden' };
    }
  }

  /** Test helper (unsafe-local only): remove property-scoped membership. */
  async removePropertyMemberForTest(userId: string, propertyId: string): Promise<void> {
    this.assertUnsafeLocal('removePropertyMemberForTest');
    this.ctx.storage.sql.exec(
      `DELETE FROM property_member WHERE user_id = ? AND property_id = ?`,
      userId,
      propertyId,
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

  /**
   * Update property display name in the OrgDO mirror. Implements catalog
   * `property.update_details` (OrgDO leg). Fingerprint: `{ propertyId, name }`.
   */
  async tryUpdatePropertyDetails(
    actor: ActorContext,
    propertyId: string,
    input: { name: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; propertyId: string; name: string }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ORG_ID_UNSET | typeof PROPERTY_REF_NOT_FOUND }
    | NonNullable<ReturnType<typeof mapOrgCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'config:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const existing = this.ctx.storage.sql
            .exec(
              `SELECT jurisdiction, time_zone, status FROM property_ref WHERE property_id = ?`,
              propertyId,
            )
            .toArray() as Array<{ jurisdiction: string | null; time_zone: string; status: string }>;
          if (!existing[0]) {
            return { ok: false as const, error: PROPERTY_REF_NOT_FOUND };
          }
          this.ctx.storage.sql.exec(
            `UPDATE property_ref SET name = ? WHERE property_id = ?`,
            input.name,
            propertyId,
          );
          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'property.updated',
            payload: { orgId, propertyId, name: input.name },
          });
          return { ok: true as const, propertyId, name: input.name };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
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
    this.assertRpcAvailable();
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
    actor: ActorContext,
    propertyId: string,
    input: { guestId: string; profile: GuestProfile },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_EXISTS | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapOrgCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    try {
      const replay = readIdempotentReplay<
        { ok: true; guestId: string; piiKeyId: string } | { ok: false; error: CommandError }
      >(this.ctx.storage.sql, idem);
      if (replay) return replay;

      const existing = this.ctx.storage.sql
        .exec(`SELECT erased_at FROM guest WHERE guest_id = ?`, input.guestId)
        .toArray() as Array<{ erased_at: number | null }>;
      if (existing[0]) return { ok: false, error: GUEST_EXISTS };

      const vault = await this.vault();
      const material = await vault.prepareGuestRecord('guest', input.guestId, input.profile);
      const indexRows = await blindIndexRows(await this.blindIndexKey(), input.profile);

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
          this.replaceGuestBlindIndexSync(input.guestId, indexRows);

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
      // Both erased and live existing rows collapse to GUEST_EXISTS on create — never un-erase.
      if (e instanceof GuestErasedError) return { ok: false, error: GUEST_EXISTS };
      if (e instanceof GuestExistsError) return { ok: false, error: GUEST_EXISTS };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryUpdateGuest(
    actor: ActorContext,
    propertyId: string,
    input: { guestId: string; profile: GuestProfile },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
    | NonNullable<ReturnType<typeof mapOrgCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    try {
      const replay = readIdempotentReplay<
        { ok: true; guestId: string; piiKeyId: string } | { ok: false; error: CommandError }
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
      const indexRows = await blindIndexRows(await this.blindIndexKey(), input.profile);

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
          this.replaceGuestBlindIndexSync(input.guestId, indexRows);

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
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryEraseGuest(
    actor: ActorContext,
    propertyId: string,
    input: { guestId: string },
    idem: IdempotencyKey,
  ): Promise<
    | { ok: true; guestId: string; piiKeyId: string }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof IDEM_KEY_REUSED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET | typeof KEY_SHRED_FAILED }
    | NonNullable<ReturnType<typeof mapOrgCommandError>>
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:erase');
    if (permDenied) return permDenied;

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
          this.deleteGuestBlindIndexSync(input.guestId);
          if (guest.erased_at != null) {
            return { ok: true as const, guestId: input.guestId, piiKeyId: guest.pii_key_id };
          }

          const keyStore = new SqlKeyStore(this.ctx.storage.sql);
          if (!keyStore.shred(guest.pii_key_id)) {
            throw new Error(KEY_SHRED_FAILED);
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
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  /**
   * Actor-less referential-integrity RPC — the caller (e.g. `PropertyDO.gateGuestRef`) is already
   * gated for its own operation, so this only answers "does this guestRef resolve, and to what key."
   */
  async assertGuestRef(
    guestRef: string,
  ): Promise<
    | { ok: true; piiKeyId: string }
    | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
  > {
    this.assertRpcAvailable();
    const rows = this.ctx.storage.sql
      .exec(`SELECT pii_key_id, erased_at FROM guest WHERE guest_id = ?`, guestRef)
      .toArray() as Array<{ pii_key_id: string; erased_at: number | null }>;
    const guest = rows[0];
    if (!guest) return { ok: false, error: GUEST_NOT_FOUND };
    if (guest.erased_at != null) return { ok: false, error: GUEST_ALREADY_ERASED };
    return { ok: true, piiKeyId: guest.pii_key_id };
  }

  private loadRosterRow(staffId: string): RosterRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT staff_id, pii_key_id, profile_cipher, profile_iv, status, exited_at FROM roster WHERE staff_id = ?`,
        staffId,
      )
      .toArray() as unknown as RosterRow[];
    return rows[0] ?? null;
  }

  private loadRosterKinds(staffId: string): string[] {
    const rows = this.ctx.storage.sql
      .exec(`SELECT kind FROM roster_kind WHERE staff_id = ? ORDER BY kind`, staffId)
      .toArray() as Array<{ kind: string }>;
    return rows.map((r) => r.kind);
  }

  private replaceRosterKinds(staffId: string, kinds: string[]): void {
    this.ctx.storage.sql.exec(`DELETE FROM roster_kind WHERE staff_id = ?`, staffId);
    for (const kind of [...new Set(kinds)]) {
      this.ctx.storage.sql.exec(`INSERT INTO roster_kind (staff_id, kind) VALUES (?, ?)`, staffId, kind);
    }
  }

  async tryCreateRoster(
    actor: ActorContext,
    propertyId: string,
    input: { profile: StaffProfileCreate; kinds: string[] },
    idem: IdempotencyKey,
  ): Promise<
    | RosterWriteOk
    | { ok: false; error: typeof EMPTY_KINDS | typeof INVALID_KINDS | typeof IDEM_KEY_REUSED }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:write');
    if (permDenied) return permDenied;
    if (profileHasCompensation(input.profile)) {
      const compensationDenied = await this.gatePermission(actor, propertyId, 'roster:compensation');
      if (compensationDenied) return compensationDenied;
    }

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const kindsErr = rosterKindsError(input.kinds);
    if (kindsErr) return { ok: false, error: kindsErr };

    try {
      const replay = readIdempotentReplay<RosterWriteOk | { ok: false; error: CommandError }>(
        this.ctx.storage.sql,
        idem,
      );
      if (replay) return replay;

      const staffId = `staff_${crypto.randomUUID()}`;
      const vault = await this.vault();
      const material = await vault.preparePiiRecord('staff', staffId, input.profile);

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const now = Date.now();
          this.ctx.storage.sql.exec(
            `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)`,
            material.piiKeyId,
            'staff',
            staffId,
            material.wrappedKey,
            now,
          );
          this.ctx.storage.sql.exec(
            `INSERT INTO roster (staff_id, pii_key_id, profile_cipher, profile_iv, status, exited_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'active', NULL, ?, ?)`,
            staffId,
            material.piiKeyId,
            material.profileCipher,
            material.profileIv,
            now,
            now,
          );
          this.replaceRosterKinds(staffId, input.kinds);

          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'roster.created',
            payload: { orgId, staffRef: staffId, piiKeyId: material.piiKeyId },
          });

          return { ok: true as const, staffId, piiKeyId: material.piiKeyId };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryUpdateRoster(
    actor: ActorContext,
    propertyId: string,
    input: { staffId: string; profile?: Partial<StaffProfileCreate>; kinds?: string[] },
    idem: IdempotencyKey,
  ): Promise<
    | RosterWriteOk
    | {
        ok: false;
        error:
          | typeof STAFF_NOT_FOUND
          | typeof STAFF_EXITED
          | typeof EMPTY_KINDS
          | typeof INVALID_KINDS
          | typeof IDEM_KEY_REUSED;
      }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:write');
    if (permDenied) return permDenied;
    if (profileHasCompensation(input.profile)) {
      const compensationDenied = await this.gatePermission(actor, propertyId, 'roster:compensation');
      if (compensationDenied) return compensationDenied;
    }

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    try {
      const replay = readIdempotentReplay<RosterWriteOk | { ok: false; error: CommandError }>(
        this.ctx.storage.sql,
        idem,
      );
      if (replay) return replay;

      const row = this.loadRosterRow(input.staffId);
      if (!row) return { ok: false, error: STAFF_NOT_FOUND };
      if (row.exited_at != null) return { ok: false, error: STAFF_EXITED };

      if (input.kinds) {
        const kindsErr = rosterKindsError(input.kinds);
        if (kindsErr) return { ok: false, error: kindsErr };
      }

      let sealed: { profileCipher: Uint8Array; profileIv: Uint8Array } | null = null;
      if (input.profile) {
        const vault = await this.vault();
        const current = await vault.decryptProfile<StaffProfile>(
          row.pii_key_id,
          row.profile_cipher,
          row.profile_iv,
        );
        sealed = await vault.prepareProfileSeal(row.pii_key_id, { ...current, ...input.profile });
      }

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const again = this.loadRosterRow(input.staffId);
          if (!again) throw new StaffNotFoundError();
          if (again.exited_at != null) throw new StaffExitedError();

          const now = Date.now();
          if (sealed) {
            this.ctx.storage.sql.exec(
              `UPDATE roster SET profile_cipher = ?, profile_iv = ?, updated_at = ? WHERE staff_id = ? AND exited_at IS NULL`,
              sealed.profileCipher,
              sealed.profileIv,
              now,
              input.staffId,
            );
          } else {
            this.ctx.storage.sql.exec(
              `UPDATE roster SET updated_at = ? WHERE staff_id = ? AND exited_at IS NULL`,
              now,
              input.staffId,
            );
          }
          if (input.kinds) this.replaceRosterKinds(input.staffId, input.kinds);

          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'roster.updated',
            payload: { orgId, staffRef: input.staffId, piiKeyId: row.pii_key_id },
          });

          return { ok: true as const, staffId: input.staffId, piiKeyId: row.pii_key_id };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof StaffNotFoundError) return { ok: false, error: STAFF_NOT_FOUND };
      if (e instanceof StaffExitedError) return { ok: false, error: STAFF_EXITED };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async trySetRosterStatus(
    actor: ActorContext,
    propertyId: string,
    input: { staffId: string; status: 'active' | 'inactive' },
    idem: IdempotencyKey,
  ): Promise<
    | RosterWriteOk
    | { ok: false; error: typeof STAFF_NOT_FOUND | typeof STAFF_EXITED | typeof IDEM_KEY_REUSED }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    try {
      const replay = readIdempotentReplay<RosterWriteOk | { ok: false; error: CommandError }>(
        this.ctx.storage.sql,
        idem,
      );
      if (replay) return replay;

      const row = this.loadRosterRow(input.staffId);
      if (!row) return { ok: false, error: STAFF_NOT_FOUND };
      if (row.exited_at != null) return { ok: false, error: STAFF_EXITED };

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const again = this.loadRosterRow(input.staffId);
          if (!again) throw new StaffNotFoundError();
          if (again.exited_at != null) throw new StaffExitedError();

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE roster SET status = ?, updated_at = ? WHERE staff_id = ? AND exited_at IS NULL`,
            input.status,
            now,
            input.staffId,
          );

          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'roster.updated',
            payload: { orgId, staffRef: input.staffId, piiKeyId: row.pii_key_id },
          });

          return { ok: true as const, staffId: input.staffId, piiKeyId: row.pii_key_id };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof StaffNotFoundError) return { ok: false, error: STAFF_NOT_FOUND };
      if (e instanceof StaffExitedError) return { ok: false, error: STAFF_EXITED };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async tryExitRoster(
    actor: ActorContext,
    propertyId: string,
    input: { staffId: string },
    idem: IdempotencyKey,
  ): Promise<
    | RosterWriteOk
    | { ok: false; error: typeof STAFF_NOT_FOUND | typeof IDEM_KEY_REUSED }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:write');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    try {
      const replay = readIdempotentReplay<RosterWriteOk | { ok: false; error: CommandError }>(
        this.ctx.storage.sql,
        idem,
      );
      if (replay) return replay;

      const row = this.loadRosterRow(input.staffId);
      if (!row) return { ok: false, error: STAFF_NOT_FOUND };
      if (row.exited_at != null) {
        return { ok: true, staffId: input.staffId, piiKeyId: row.pii_key_id };
      }

      const vault = await this.vault();
      const profile = await vault.decryptProfile<StaffProfile>(
        row.pii_key_id,
        row.profile_cipher,
        row.profile_iv,
      );
      const { displayName: _n, email: _e, phone: _p, ...employment } = profile;
      const sealed = await vault.prepareProfileSeal(row.pii_key_id, employment);

      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const again = this.loadRosterRow(input.staffId);
          if (!again) throw new StaffNotFoundError();
          if (again.exited_at != null) {
            return { ok: true as const, staffId: input.staffId, piiKeyId: again.pii_key_id };
          }

          const now = Date.now();
          this.ctx.storage.sql.exec(
            `UPDATE roster SET profile_cipher = ?, profile_iv = ?, exited_at = ?, status = 'inactive', updated_at = ?
             WHERE staff_id = ? AND exited_at IS NULL`,
            sealed.profileCipher,
            sealed.profileIv,
            now,
            now,
            input.staffId,
          );

          this.appendOrgOutbox({
            eventId: crypto.randomUUID(),
            eventType: 'roster.exited',
            payload: { orgId, staffRef: input.staffId, piiKeyId: row.pii_key_id },
          });

          return { ok: true as const, staffId: input.staffId, piiKeyId: row.pii_key_id };
        }),
      );
    } catch (e) {
      if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
      if (e instanceof StaffNotFoundError) return { ok: false, error: STAFF_NOT_FOUND };
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
  }

  async assertStaffAssignable(
    staffId: string,
  ): Promise<
    | { ok: true; staffId: string }
    | { ok: false; error: typeof STAFF_NOT_FOUND | typeof STAFF_EXITED | typeof STAFF_NOT_ASSIGNABLE }
  > {
    this.assertRpcAvailable();
    const row = this.loadRosterRow(staffId);
    if (!row) return { ok: false, error: STAFF_NOT_FOUND };
    if (row.exited_at != null) return { ok: false, error: STAFF_EXITED };
    const housekeeper = this.ctx.storage.sql
      .exec(`SELECT 1 AS one FROM roster_kind WHERE staff_id = ? AND kind = 'housekeeper' LIMIT 1`, staffId)
      .toArray() as Array<{ one: number }>;
    if (row.status !== 'active' || housekeeper.length === 0) {
      return { ok: false, error: STAFF_NOT_ASSIGNABLE };
    }
    return { ok: true, staffId };
  }

  async readRoster(
    actor: ActorContext,
    propertyId: string,
    staffId: string,
  ): Promise<
    | {
        ok: true;
        staffId: string;
        profile: StaffProfile;
        kinds: string[];
        status: 'active' | 'inactive';
        exitedAt: number | null;
      }
    | { ok: false; error: typeof STAFF_NOT_FOUND }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const row = this.loadRosterRow(staffId);
    if (!row) return { ok: false, error: STAFF_NOT_FOUND };
    const vault = await this.vault();
    const profile = await vault.decryptProfile<StaffProfile>(
      row.pii_key_id,
      row.profile_cipher,
      row.profile_iv,
    );
    return {
      ok: true,
      staffId: row.staff_id,
      profile,
      kinds: this.loadRosterKinds(staffId),
      status: row.status,
      exitedAt: row.exited_at,
    };
  }

  async listRoster(
    actor: ActorContext,
    propertyId: string,
  ): Promise<
    | {
        ok: true;
        staff: Array<{
          staffId: string;
          profile: StaffProfile;
          kinds: string[];
          status: 'active' | 'inactive';
          exitedAt: number | null;
        }>;
      }
    | RosterGateError
  > {
    this.assertRpcAvailable();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'roster:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT staff_id, pii_key_id, profile_cipher, profile_iv, status, exited_at FROM roster ORDER BY staff_id`,
      )
      .toArray() as unknown as RosterRow[];
    const vault = await this.vault();
    const staff = [];
    for (const row of rows) {
      const profile = await vault.decryptProfile<StaffProfile>(
        row.pii_key_id,
        row.profile_cipher,
        row.profile_iv,
      );
      staff.push({
        staffId: row.staff_id,
        profile,
        kinds: this.loadRosterKinds(row.staff_id),
        status: row.status,
        exitedAt: row.exited_at,
      });
    }
    return { ok: true, staff };
  }

  async readGuest(
    actor: ActorContext,
    propertyId: string,
    guestId: string,
  ): Promise<
    | { ok: true; guestId: string; erased: false; profile: GuestProfile }
    | { ok: true; guestId: string; erased: true; profile: null }
    | { ok: false; error: typeof GUEST_NOT_FOUND }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    this.assertRpcAvailable();
    this.guestReadRpcCountForTest += 1;
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const entry = await this.readGuestEntry(guestId);
    if (entry.ok === false && entry.error === GUEST_NOT_FOUND) {
      return { ok: false, error: GUEST_NOT_FOUND };
    }
    if (entry.ok === false && entry.error === DECRYPT_UNRESOLVED) {
      throw new Error('guests.read.decrypt_incident');
    }
    return entry;
  }

  async readGuests(
    actor: ActorContext,
    propertyId: string,
    guestIds: string[],
  ): Promise<
    | {
        ok: true;
        guests: Record<
          string,
          | { ok: true; guestId: string; erased: false; profile: GuestProfile }
          | { ok: true; guestId: string; erased: true; profile: null }
          | { ok: false; guestId: string; error: typeof GUEST_NOT_FOUND }
          | { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
        >;
      }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    this.assertRpcAvailable();
    this.guestReadRpcCountForTest += 1;
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    const guests: Record<
      string,
      | { ok: true; guestId: string; erased: false; profile: GuestProfile }
      | { ok: true; guestId: string; erased: true; profile: null }
      | { ok: false; guestId: string; error: typeof GUEST_NOT_FOUND }
      | { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
    > = {};
    for (const guestId of [...new Set(guestIds)]) {
      guests[guestId] = await this.readGuestEntry(guestId);
    }
    return { ok: true, guests };
  }

  async listGuests(
    actor: ActorContext,
    propertyId: string,
    input: { cursor?: { createdAt: number; guestId: string }; limit: number },
  ): Promise<
    | {
        ok: true;
        items: Array<{ guestId: string; erased: false; profile: GuestProfile; createdAt: number }>;
        nextCursor: { createdAt: number; guestId: string } | null;
      }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    await this.ensureGuestBlindIndex('missing');

    const limit = input.limit;
    const cursor = input.cursor;
    const rows = (
      cursor
        ? this.ctx.storage.sql.exec(
            `SELECT guest_id, created_at FROM guest
             WHERE erased_at IS NULL
               AND (created_at, guest_id) < (?, ?)
             ORDER BY created_at DESC, guest_id DESC
             LIMIT ?`,
            cursor.createdAt,
            cursor.guestId,
            limit,
          )
        : this.ctx.storage.sql.exec(
            `SELECT guest_id, created_at FROM guest
             WHERE erased_at IS NULL
             ORDER BY created_at DESC, guest_id DESC
             LIMIT ?`,
            limit,
          )
    ).toArray() as Array<{ guest_id: string; created_at: number }>;

    const items: Array<{ guestId: string; erased: false; profile: GuestProfile; createdAt: number }> = [];
    for (const row of rows) {
      const entry = await this.readGuestEntry(row.guest_id);
      if (!entry.ok) continue;
      if (entry.erased) continue;
      items.push({
        guestId: entry.guestId,
        erased: false,
        profile: entry.profile,
        createdAt: row.created_at,
      });
    }

    const lastReturned = items[items.length - 1];
    const nextCursor =
      rows.length < limit || !lastReturned
        ? null
        : { createdAt: lastReturned.createdAt, guestId: lastReturned.guestId };

    return { ok: true, items, nextCursor };
  }

  async searchGuests(
    actor: ActorContext,
    propertyId: string,
    input: { q: string; cursor?: { guestId: string }; limit: number },
  ): Promise<
    | {
        ok: true;
        items: Array<{ guestId: string; erased: false; profile: GuestProfile; createdAt: number }>;
        nextCursor: { guestId: string } | null;
      }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    this.assertRpcAvailable();
    this.lanes.touchInteractive();
    const orgId = this.getOrgIdSync();
    if (!orgId) return { ok: false, error: ORG_ID_UNSET };

    const permDenied = await this.gatePermission(actor, propertyId, 'guests:read');
    if (permDenied) return permDenied;

    const denied = await this.gateCoreEntitlement(orgId);
    if (denied) return denied;

    await this.ensureGuestBlindIndex('missing');

    const hashes = await this.hashesForSearchQuery(input.q);
    const hitIds = new Set<string>();
    for (const row of hashes) {
      const found = this.ctx.storage.sql
        .exec(
          `SELECT DISTINCT guest_id FROM guest_blind_index WHERE kind = ? AND index_hash = ?`,
          row.kind,
          row.hash,
        )
        .toArray() as Array<{ guest_id: string }>;
      for (const hit of found) hitIds.add(hit.guest_id);
    }

    const liveIds: string[] = [];
    for (const guestId of hitIds) {
      const guest = this.ctx.storage.sql
        .exec(`SELECT erased_at FROM guest WHERE guest_id = ?`, guestId)
        .toArray() as Array<{ erased_at: number | null }>;
      if (guest[0] && guest[0].erased_at == null) liveIds.push(guestId);
    }
    liveIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const capped = liveIds.slice(0, 50);
    const afterCursor = input.cursor
      ? capped.filter((id) => id > input.cursor!.guestId)
      : capped;
    const pageIds = afterCursor.slice(0, input.limit);

    const items: Array<{ guestId: string; erased: false; profile: GuestProfile; createdAt: number }> = [];
    for (const guestId of pageIds) {
      const created = this.ctx.storage.sql
        .exec(`SELECT created_at FROM guest WHERE guest_id = ?`, guestId)
        .toArray() as Array<{ created_at: number }>;
      const entry = await this.readGuestEntry(guestId);
      if (!entry.ok) continue;
      if (entry.erased) continue;
      items.push({
        guestId: entry.guestId,
        erased: false,
        profile: entry.profile,
        createdAt: created[0]?.created_at ?? 0,
      });
    }

    const lastReturned = items[items.length - 1];
    const nextCursor =
      afterCursor.length <= input.limit || !lastReturned ? null : { guestId: lastReturned.guestId };

    return { ok: true, items, nextCursor };
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

  async readRosterProfile(staffId: string): Promise<StaffProfile | null> {
    const row = this.loadRosterRow(staffId);
    if (!row) return null;
    const vault = await this.vault();
    return vault.decryptProfile<StaffProfile>(row.pii_key_id, row.profile_cipher, row.profile_iv);
  }

  async execSqlForTest(sql: string, ...binds: unknown[]): Promise<void> {
    this.assertUnsafeLocal('execSqlForTest');
    this.ctx.storage.sql.exec(sql, ...(binds as Array<string | number | Uint8Array | null>));
  }

  async countDataKeysForSubject(scope: string, subjectId: string): Promise<number> {
    const rows = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS c FROM data_key WHERE scope = ? AND subject_id = ?`, scope, subjectId)
      .toArray() as Array<{ c: number }>;
    return Number(rows[0]?.c ?? 0);
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

  /** Test hook — profile BLOB lengths after guest purge (`x''` → 0). */
  async testGuestProfileBlobLengths(
    guestId: string,
  ): Promise<{ cipherLen: number; ivLen: number } | null> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT length(profile_cipher) AS cipher_len, length(profile_iv) AS iv_len FROM guest WHERE guest_id = ?`,
        guestId,
      )
      .toArray() as Array<{ cipher_len: number | null; iv_len: number | null }>;
    const row = rows[0];
    if (!row) return null;
    return { cipherLen: Number(row.cipher_len ?? 0), ivLen: Number(row.iv_len ?? 0) };
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
