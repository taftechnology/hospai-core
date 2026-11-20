import {
  AADHAAR_SCAN_NOT_ALLOWED,
  CONSENT_HISTORY_LIMIT,
  CONSENT_NOTICE_NOT_CONFIGURED,
  CONSENT_PURPOSES,
  DOCUMENT_REMOVE_REASON_MAX,
  GUEST_ALREADY_ERASED,
  GUEST_DOCUMENTS_MAX,
  GUEST_NOT_FOUND,
  IDEM_KEY_REUSED,
  INTERNAL_ERROR,
  LIMIT_EXCEEDED,
  NOT_FOUND,
  VALIDATION_ERROR,
  SCAN_MAX_BYTES,
  SCAN_TYPE_NOT_ALLOWED,
  isCommandError,
  parseGuestDocumentFields,
  type ActorContext,
  type CommandError,
  type ConsentPurpose,
  type ConsentSource,
  type ConsentStatus,
  type GuestDocumentFields,
  type GuestDocumentKind,
  type GuestDocumentList,
  type GuestSettings,
  type IdempotencyKey,
} from '@hospai/contracts';
import {
  IdempotencyKeyReused,
  runIdempotent,
  scopeIdempotencyKey,
} from '@hospai/do-runtime';
import type { PiiVault } from '@hospai/crypto-shredding';
import { logWarn } from '@hospai/observability';
import { guestDocObjectKey, isScanContentType, scanMagicMatches } from './guest-documents.js';

type Sql = {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
};

export type GuestDocCommandHost = {
  sql: Sql;
  transactionSync<T>(fn: () => T): T;
  vault: PiiVault;
  orgId: string;
  actor: ActorContext;
  r2: R2Bucket | undefined;
  settings: GuestSettings;
  appendEvent(eventType: string, payload: Record<string, string>): void;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: CommandError };

function actorId(actor: ActorContext): string {
  return actor.kind === 'user' ? actor.userId : 'system';
}

function blobToBytes(buf: unknown): Uint8Array {
  if (buf == null) return new Uint8Array(0);
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(0);
}

function readReplay<T>(sql: Sql, idem: IdempotencyKey, actor: ActorContext): T | null {
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, storageKey)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;
  if (prior.length === 0) return null;
  if (prior[0]!.request_fingerprint !== idem.fingerprint) throw new IdempotencyKeyReused(idem.key);
  return JSON.parse(prior[0]!.response) as T;
}

function mapErr(e: unknown): Err {
  if (e instanceof IdempotencyKeyReused) return { ok: false, error: IDEM_KEY_REUSED };
  if (e instanceof Error && isCommandError(e.message)) return { ok: false, error: e.message };
  return { ok: false, error: INTERNAL_ERROR };
}

type GuestRow = { pii_key_id: string; erased_at: number | null };

function loadGuest(sql: Sql, guestRef: string): GuestRow | null {
  const rows = sql
    .exec(`SELECT pii_key_id, erased_at FROM guest WHERE guest_id = ?`, guestRef)
    .toArray() as GuestRow[];
  return rows[0] ?? null;
}

function linked(sql: Sql, guestRef: string, propertyId: string): boolean {
  const rows = sql
    .exec(
      `SELECT 1 AS one FROM guest_property WHERE guest_id = ? AND property_id = ? LIMIT 1`,
      guestRef,
      propertyId,
    )
    .toArray();
  return rows.length > 0;
}

function requireGuest(sql: Sql, guestRef: string, propertyId: string): GuestRow {
  const guest = loadGuest(sql, guestRef);
  if (!guest) throw new Error(GUEST_NOT_FOUND);
  if (guest.erased_at != null) throw new Error(GUEST_ALREADY_ERASED);
  if (!linked(sql, guestRef, propertyId)) throw new Error(NOT_FOUND);
  return guest;
}

type DocRow = {
  id: string;
  guest_ref: string;
  property_id: string;
  kind: GuestDocumentKind;
  doc_cipher: unknown;
  doc_iv: unknown;
  scan_object_key: string | null;
  scan_content_type: string | null;
  scan_bytes: number | null;
  scan_iv: unknown;
  created_at: number;
  removed_at: number | null;
};

function loadDoc(sql: Sql, documentId: string): DocRow | null {
  const rows = sql
    .exec(
      `SELECT id, guest_ref, property_id, kind, doc_cipher, doc_iv, scan_object_key, scan_content_type, scan_bytes, scan_iv, created_at, removed_at
       FROM guest_document WHERE id = ?`,
      documentId,
    )
    .toArray() as DocRow[];
  return rows[0] ?? null;
}

/** Live document at this property, or a miss that reveals nothing about any other property. */
function requireLiveDoc(sql: Sql, documentId: string, guestRef: string, propertyId: string): DocRow {
  const row = loadDoc(sql, documentId);
  if (!row || row.guest_ref !== guestRef || row.property_id !== propertyId || row.removed_at != null) {
    throw new Error(NOT_FOUND);
  }
  return row;
}

function liveCount(sql: Sql, guestRef: string, propertyId: string): number {
  const rows = sql
    .exec(
      `SELECT COUNT(*) AS n FROM guest_document WHERE guest_ref = ? AND property_id = ? AND removed_at IS NULL`,
      guestRef,
      propertyId,
    )
    .toArray() as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

function scanKey(orgId: string, documentId: string): string {
  return `${guestDocObjectKey(orgId, documentId)}/${crypto.randomUUID()}`;
}

async function deleteObject(r2: R2Bucket | undefined, key: string, orgId: string, documentId: string): Promise<boolean> {
  if (!r2) {
    logWarn({ moduleId: 'pms.guests', orgId }, { msg: 'guest_document.scan_delete_skipped', documentId });
    return false;
  }
  try {
    await r2.delete(key);
    return true;
  } catch (e) {
    logWarn(
      { moduleId: 'pms.guests', orgId },
      {
        msg: 'guest_document.scan_delete_failed',
        documentId,
        error: e instanceof Error ? e.message : 'delete_failed',
      },
    );
    return false;
  }
}

function clearRemovedScanKey(host: GuestDocCommandHost, documentId: string, key: string): void {
  host.transactionSync(() => {
    host.sql.exec(
      `UPDATE guest_document
       SET scan_object_key = NULL, scan_content_type = NULL, scan_bytes = NULL, scan_iv = NULL
       WHERE id = ? AND removed_at IS NOT NULL AND scan_object_key = ?`,
      documentId,
      key,
    );
  });
}

async function sweepRemovedScan(host: GuestDocCommandHost, documentId: string): Promise<void> {
  const row = loadDoc(host.sql, documentId);
  if (!row?.removed_at || !row.scan_object_key) return;
  const key = row.scan_object_key;
  if (await deleteObject(host.r2, key, host.orgId, documentId)) {
    clearRemovedScanKey(host, documentId, key);
  }
}

export async function addGuestDocument(
  host: GuestDocCommandHost,
  propertyId: string,
  input: { guestRef: string; documentId: string; kind: GuestDocumentKind; fields: unknown },
  idem: IdempotencyKey,
): Promise<Ok<{ documentId: string }> | Err> {
  const parsed = parseGuestDocumentFields(input.kind, input.fields);
  if (!parsed.ok) return parsed;
  try {
    const replay = readReplay<Ok<{ documentId: string }> | Err>(host.sql, idem, host.actor);
    if (replay) return replay;
    const guest = requireGuest(host.sql, input.guestRef, propertyId);
    if (liveCount(host.sql, input.guestRef, propertyId) >= GUEST_DOCUMENTS_MAX) {
      return { ok: false, error: LIMIT_EXCEEDED };
    }
    const sealed = await host.vault.sealDocument(guest.pii_key_id, input.documentId, parsed.fields);
    const now = Date.now();
    return host.transactionSync(() =>
      runIdempotent(
        host.sql,
        idem,
        () => {
          requireGuest(host.sql, input.guestRef, propertyId);
          const again = loadDoc(host.sql, input.documentId);
          if (again) throw new Error(VALIDATION_ERROR);
          if (liveCount(host.sql, input.guestRef, propertyId) >= GUEST_DOCUMENTS_MAX) {
            throw new Error(LIMIT_EXCEEDED);
          }
          host.sql.exec(
            `INSERT INTO guest_document (
              id, guest_ref, property_id, kind, doc_cipher, doc_iv, created_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            input.documentId,
            input.guestRef,
            propertyId,
            input.kind,
            sealed.ciphertext,
            sealed.iv,
            now,
            actorId(host.actor),
          );
          host.appendEvent('guest.document_recorded', {
            orgId: host.orgId,
            guestRef: input.guestRef,
            propertyId,
            documentId: input.documentId,
          });
          return { ok: true as const, documentId: input.documentId };
        },
        host.actor,
      ),
    );
  } catch (e) {
    return mapErr(e);
  }
}

export function listGuestDocuments(
  host: Pick<GuestDocCommandHost, 'sql' | 'settings'>,
  propertyId: string,
  guestRef: string,
): Ok<GuestDocumentList> | Err {
  try {
    requireGuest(host.sql, guestRef, propertyId);
    const rows = host.sql
      .exec(
        `SELECT id, kind, scan_object_key, scan_content_type, created_at
         FROM guest_document
         WHERE guest_ref = ? AND property_id = ? AND removed_at IS NULL
         ORDER BY created_at DESC, id DESC`,
        guestRef,
        propertyId,
      )
      .toArray() as Array<{
      id: string;
      kind: GuestDocumentKind;
      scan_object_key: string | null;
      scan_content_type: string | null;
      created_at: number;
    }>;
    return {
      ok: true,
      documents: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        hasScan: row.scan_object_key != null,
        scanContentType: row.scan_content_type,
        createdAt: row.created_at,
      })),
      requireIdAtCheckIn: host.settings.requireIdAtCheckIn,
    };
  } catch (e) {
    return mapErr(e);
  }
}

export async function readGuestDocument(
  host: GuestDocCommandHost,
  propertyId: string,
  guestRef: string,
  documentId: string,
): Promise<
  | Ok<{ id: string; kind: GuestDocumentKind; fields: GuestDocumentFields; hasScan: boolean; createdAt: number }>
  | Err
> {
  try {
    const guest = requireGuest(host.sql, guestRef, propertyId);
    const row = requireLiveDoc(host.sql, documentId, guestRef, propertyId);
    const fields = await host.vault.openDocument<GuestDocumentFields>(
      guest.pii_key_id,
      documentId,
      blobToBytes(row.doc_cipher),
      blobToBytes(row.doc_iv),
    );
    const now = Date.now();
    host.transactionSync(() => {
      host.sql.exec(
        `INSERT INTO guest_document_access (id, document_id, guest_ref, property_id, actor_user_id, action, at)
         VALUES (?, ?, ?, ?, ?, 'read', ?)`,
        crypto.randomUUID(),
        documentId,
        guestRef,
        propertyId,
        actorId(host.actor),
        now,
      );
    });
    return {
      ok: true,
      id: row.id,
      kind: row.kind,
      fields,
      hasScan: row.scan_object_key != null,
      createdAt: row.created_at,
    };
  } catch (e) {
    return mapErr(e);
  }
}

export async function attachGuestDocumentScan(
  host: GuestDocCommandHost,
  propertyId: string,
  input: { guestRef: string; documentId: string; contentType: string; bytes: Uint8Array; sha256: string },
  idem: IdempotencyKey,
): Promise<Ok<{ documentId: string }> | Err> {
  if (input.bytes.byteLength > SCAN_MAX_BYTES) return { ok: false, error: LIMIT_EXCEEDED };
  if (!isScanContentType(input.contentType) || !scanMagicMatches(input.contentType, input.bytes)) {
    return { ok: false, error: SCAN_TYPE_NOT_ALLOWED };
  }
  if (!host.r2) return { ok: false, error: INTERNAL_ERROR };
  const bucket = host.r2;
  try {
    const replay = readReplay<Ok<{ documentId: string }> | Err>(host.sql, idem, host.actor);
    if (replay) return replay;
    const guest = requireGuest(host.sql, input.guestRef, propertyId);
    const existing = requireLiveDoc(host.sql, input.documentId, input.guestRef, propertyId);
    if (existing.kind === 'AADHAAR') return { ok: false, error: AADHAAR_SCAN_NOT_ALLOWED };
    const sealed = await host.vault.sealScan(guest.pii_key_id, input.documentId, input.bytes);
    // Nonce is chosen after the replay check above. sha256 stays on the idempotency payload only.
    const nextKey = scanKey(host.orgId, input.documentId);
    const previousKey = existing.scan_object_key;
    await bucket.put(nextKey, sealed.ciphertext);
    let dropNew = false;
    try {
      const result = host.transactionSync(() =>
        runIdempotent(
          host.sql,
          idem,
          () => {
            const row = loadDoc(host.sql, input.documentId);
            if (
              !row ||
              row.guest_ref !== input.guestRef ||
              row.property_id !== propertyId ||
              row.removed_at != null
            ) {
              dropNew = true;
              throw new Error(NOT_FOUND);
            }
            if (row.kind === 'AADHAAR') throw new Error(AADHAAR_SCAN_NOT_ALLOWED);
            host.sql.exec(
              `UPDATE guest_document
               SET scan_object_key = ?, scan_content_type = ?, scan_bytes = ?, scan_iv = ?
               WHERE id = ?`,
              nextKey,
              input.contentType,
              input.bytes.byteLength,
              sealed.iv,
              input.documentId,
            );
            return { ok: true as const, documentId: input.documentId };
          },
          host.actor,
        ),
      );
      if (previousKey && previousKey !== nextKey) await deleteObject(bucket, previousKey, host.orgId, input.documentId);
      return result;
    } catch (e) {
      if (dropNew) await deleteObject(bucket, nextKey, host.orgId, input.documentId);
      return mapErr(e);
    }
  } catch (e) {
    return mapErr(e);
  }
}

export async function readGuestDocumentScan(
  host: GuestDocCommandHost,
  propertyId: string,
  guestRef: string,
  documentId: string,
): Promise<Ok<{ bytes: Uint8Array; contentType: string }> | Err> {
  try {
    const guest = requireGuest(host.sql, guestRef, propertyId);
    const row = requireLiveDoc(host.sql, documentId, guestRef, propertyId);
    if (!row.scan_object_key || !row.scan_content_type || row.scan_iv == null) throw new Error(NOT_FOUND);
    if (!host.r2) return { ok: false, error: INTERNAL_ERROR };
    const object = await host.r2.get(row.scan_object_key);
    if (!object) throw new Error(NOT_FOUND);
    const cipher = new Uint8Array(await object.arrayBuffer());
    const bytes = await host.vault.openScan(guest.pii_key_id, documentId, cipher, blobToBytes(row.scan_iv));
    const now = Date.now();
    host.transactionSync(() => {
      host.sql.exec(
        `INSERT INTO guest_document_access (id, document_id, guest_ref, property_id, actor_user_id, action, at)
         VALUES (?, ?, ?, ?, ?, 'scan_read', ?)`,
        crypto.randomUUID(),
        documentId,
        guestRef,
        propertyId,
        actorId(host.actor),
        now,
      );
    });
    return { ok: true, bytes, contentType: row.scan_content_type };
  } catch (e) {
    return mapErr(e);
  }
}

export async function removeGuestDocument(
  host: GuestDocCommandHost,
  propertyId: string,
  input: { guestRef: string; documentId: string; reason: string },
  idem: IdempotencyKey,
): Promise<Ok<{ documentId: string }> | Err> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > DOCUMENT_REMOVE_REASON_MAX) {
    return { ok: false, error: VALIDATION_ERROR };
  }
  try {
    const replay = readReplay<Ok<{ documentId: string }> | Err>(host.sql, idem, host.actor);
    if (replay) {
      await sweepRemovedScan(host, input.documentId);
      return replay;
    }
    requireGuest(host.sql, input.guestRef, propertyId);
    requireLiveDoc(host.sql, input.documentId, input.guestRef, propertyId);
    const now = Date.now();
    const result = host.transactionSync(() =>
      runIdempotent(
        host.sql,
        idem,
        () => {
          const row = requireLiveDoc(host.sql, input.documentId, input.guestRef, propertyId);
          host.sql.exec(
            `UPDATE guest_document
             SET doc_cipher = ?, doc_iv = ?, removed_at = ?, removed_by = ?, removed_reason = ?
             WHERE id = ?`,
            new Uint8Array(0),
            new Uint8Array(0),
            now,
            actorId(host.actor),
            reason,
            input.documentId,
          );
          host.appendEvent('guest.document_removed', {
            orgId: host.orgId,
            guestRef: input.guestRef,
            propertyId,
            documentId: input.documentId,
          });
          return { ok: true as const, documentId: input.documentId };
        },
        host.actor,
      ),
    );
    await sweepRemovedScan(host, input.documentId);
    return result;
  } catch (e) {
    return mapErr(e);
  }
}

export type ConsentCurrent = {
  status: ConsentStatus;
  noticeVersion: string;
  source: ConsentSource;
  recordedAt: number;
};

export type ConsentHistoryRow = ConsentCurrent & {
  id: string;
  purpose: ConsentPurpose;
  /** True when this row was recorded at the property in the URL. Never another hotel's id. */
  recordedHere: boolean;
};

export function readGuestConsent(
  host: Pick<GuestDocCommandHost, 'sql'>,
  propertyId: string,
  guestRef: string,
): Ok<{ current: Record<ConsentPurpose, ConsentCurrent | null>; history: ConsentHistoryRow[] }> | Err {
  try {
    requireGuest(host.sql, guestRef, propertyId);
    const rows = host.sql
      .exec(
        `SELECT id, purpose, status, notice_version, source, property_id, recorded_at
         FROM guest_consent WHERE guest_ref = ? ORDER BY recorded_at ASC, id ASC`,
        guestRef,
      )
      .toArray() as Array<{
      id: string;
      purpose: ConsentPurpose;
      status: ConsentStatus;
      notice_version: string;
      source: ConsentSource;
      property_id: string;
      recorded_at: number;
    }>;
    const latest = new Map<ConsentPurpose, ConsentCurrent>();
    for (const row of rows) {
      latest.set(row.purpose, {
        status: row.status,
        noticeVersion: row.notice_version,
        source: row.source,
        recordedAt: row.recorded_at,
      });
    }
    const current = {} as Record<ConsentPurpose, ConsentCurrent | null>;
    for (const purpose of CONSENT_PURPOSES) current[purpose] = latest.get(purpose) ?? null;
    const history = rows.slice(-CONSENT_HISTORY_LIMIT).reverse().map((row) => ({
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      noticeVersion: row.notice_version,
      source: row.source,
      recordedHere: row.property_id === propertyId,
      recordedAt: row.recorded_at,
    }));
    return { ok: true, current, history };
  } catch (e) {
    return mapErr(e);
  }
}

export function updateGuestConsent(
  host: GuestDocCommandHost,
  propertyId: string,
  input: { guestRef: string; purpose: ConsentPurpose; status: ConsentStatus; source: ConsentSource },
  idem: IdempotencyKey,
): Ok<{ id: string }> | Err {
  const notice = host.settings.consentNoticeVersion;
  if (!notice) return { ok: false, error: CONSENT_NOTICE_NOT_CONFIGURED };
  try {
    const replay = readReplay<Ok<{ id: string }> | Err>(host.sql, idem, host.actor);
    if (replay) return replay;
    requireGuest(host.sql, input.guestRef, propertyId);
    const id = crypto.randomUUID();
    const now = Date.now();
    return host.transactionSync(() =>
      runIdempotent(
        host.sql,
        idem,
        () => {
          requireGuest(host.sql, input.guestRef, propertyId);
          const version = host.settings.consentNoticeVersion;
          if (!version) throw new Error(CONSENT_NOTICE_NOT_CONFIGURED);
          host.sql.exec(
            `INSERT INTO guest_consent (
              id, guest_ref, purpose, status, notice_version, source, property_id, recorded_at, recorded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            input.guestRef,
            input.purpose,
            input.status,
            version,
            input.source,
            propertyId,
            now,
            actorId(host.actor),
          );
          return { ok: true as const, id };
        },
        host.actor,
      ),
    );
  } catch (e) {
    return mapErr(e);
  }
}

export function identityGate(
  sql: Sql,
  settings: GuestSettings,
  input: { guestRef: string; propertyId: string },
): { required: boolean; hasDocument: boolean } {
  const required = settings.requireIdAtCheckIn;
  if (!input.guestRef) return { required, hasDocument: false };
  const rows = sql
    .exec(
      `SELECT 1 AS one FROM guest_document WHERE guest_ref = ? AND property_id = ? AND removed_at IS NULL LIMIT 1`,
      input.guestRef,
      input.propertyId,
    )
    .toArray();
  return { required, hasDocument: rows.length > 0 };
}

export function listGuestDocumentPurgeKeys(
  sql: Sql,
  orgId: string,
  guestRef: string,
): { scanKeys: string[]; computedKeys: string[]; prefixes: string[] } {
  const rows = sql
    .exec(`SELECT id, scan_object_key FROM guest_document WHERE guest_ref = ?`, guestRef)
    .toArray() as Array<{ id: string; scan_object_key: string | null }>;
  const scanKeys = new Set<string>();
  const computedKeys: string[] = [];
  const prefixes: string[] = [];
  for (const row of rows) {
    if (row.scan_object_key) scanKeys.add(row.scan_object_key);
    const base = guestDocObjectKey(orgId, row.id);
    computedKeys.push(base);
    prefixes.push(`${base}/`);
  }
  return { scanKeys: [...scanKeys], computedKeys, prefixes };
}

export function deleteGuestDocumentRows(sql: Sql, guestRef: string): { documents: number; consent: number } {
  const documents = (
    sql.exec(`SELECT COUNT(*) AS n FROM guest_document WHERE guest_ref = ?`, guestRef).toArray() as Array<{
      n: number;
    }>
  )[0];
  const consent = (
    sql.exec(`SELECT COUNT(*) AS n FROM guest_consent WHERE guest_ref = ?`, guestRef).toArray() as Array<{
      n: number;
    }>
  )[0];
  sql.exec(`DELETE FROM guest_document WHERE guest_ref = ?`, guestRef);
  sql.exec(`DELETE FROM guest_consent WHERE guest_ref = ?`, guestRef);
  return { documents: Number(documents?.n ?? 0), consent: Number(consent?.n ?? 0) };
}

export function countDocumentAccess(sql: Sql, documentId: string): number {
  const rows = sql
    .exec(`SELECT COUNT(*) AS n FROM guest_document_access WHERE document_id = ?`, documentId)
    .toArray() as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}
