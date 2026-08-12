import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
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
