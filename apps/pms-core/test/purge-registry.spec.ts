import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendPurgeCertificate,
  countOrgPurgeCertificates,
  evaluateOrgRetention,
  nextOrgPurgeWorkflowId,
} from '../src/purge-certificate.js';
import {
  createOrg,
  ensurePlatformSchema,
  insertProperty,
  insertPurgeCertificateRaw,
  resetPlatformSchemaGate,
  setOrgPurgeNotBefore,
  tryDeleteOrg,
  tryDeleteProperty,
  tryDeletePurgeCertificate,
  trySetOrgStatus,
  trySetPropertyStatus,
  tryUpdatePurgeCertificate,
} from '../src/registry.js';

describe('purge registry invariants', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('org: purged → active aborts', async () => {
    const orgId = `org_term_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'T')).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'closing')).ok).toBe(true);
    await setOrgPurgeNotBefore(env, orgId, 0);
    expect((await trySetOrgStatus(env, orgId, 'purging')).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'purged')).ok).toBe(true);
    const r = await trySetOrgStatus(env, orgId, 'active');
    expect(r.ok).toBe(false);
  });

  it('property: active → closing aborts; active → purging ok', async () => {
    const orgId = `org_p_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_p_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'P')).toBe(true);
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'P',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await trySetPropertyStatus(env, propertyId, 'closing')).ok).toBe(false);
    expect((await trySetPropertyStatus(env, propertyId, 'purging')).ok).toBe(true);
  });

  it('org/property DELETE abort; purge_certificate UPDATE/DELETE abort', async () => {
    const orgId = `org_del_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'D')).toBe(true);
    expect((await tryDeleteOrg(env, orgId)).ok).toBe(false);

    const propertyId = `prop_del_${crypto.randomUUID().slice(0, 8)}`;
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'D',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await tryDeleteProperty(env, propertyId)).ok).toBe(false);

    const certificateId = `cert_${crypto.randomUUID().slice(0, 8)}`;
    await insertPurgeCertificateRaw(env, {
      certificateId,
      workflowId: `purge-org-${orgId}-1`,
      kind: 'org',
      orgId,
    });
    expect((await tryUpdatePurgeCertificate(env, certificateId)).ok).toBe(false);
    expect((await tryDeletePurgeCertificate(env, certificateId)).ok).toBe(false);
  });

  it('org closing→purging without purge_not_before aborts', async () => {
    const orgId = `org_ret_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'R')).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'closing')).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'purging')).ok).toBe(false);
  });
});

describe('purge certificate helpers', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('evaluateOrgRetention rejects null purge_not_before and active status', () => {
    expect(evaluateOrgRetention({ status: 'active', purge_not_before: null }, Date.now()).ok).toBe(
      false,
    );
    const nullWindow = evaluateOrgRetention({ status: 'closing', purge_not_before: null }, Date.now());
    expect(nullWindow.ok).toBe(false);
    if (!nullWindow.ok) expect(nullWindow.reason).toBe('purge_not_before_null');
    // JS trap: Date.now() >= null is true — explicit null check must win
    expect(evaluateOrgRetention({ status: 'closing', purge_not_before: null }, 1e15).ok).toBe(false);
  });

  it('org attempt count ignores guest certificates', async () => {
    const orgId = `org_a_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'A')).toBe(true);
    await appendPurgeCertificate(env, {
      workflowId: `purge-guest-g1`,
      kind: 'guest',
      orgId,
      subjects: { guestRef: 'g1' },
      stores: [],
      operatorUserId: null,
      outcome: 'certified',
      started: Date.now(),
    });
    expect(await countOrgPurgeCertificates(env, orgId)).toBe(0);
    expect(await nextOrgPurgeWorkflowId(env, orgId)).toBe(`purge-org-${orgId}-1`);
    await appendPurgeCertificate(env, {
      workflowId: `purge-org-${orgId}-1`,
      kind: 'org',
      orgId,
      subjects: { orgId },
      stores: [],
      operatorUserId: 'user_owner',
      outcome: 'halted',
      haltReason: 'test',
      started: Date.now(),
    });
    expect(await nextOrgPurgeWorkflowId(env, orgId)).toBe(`purge-org-${orgId}-2`);
  });
});
