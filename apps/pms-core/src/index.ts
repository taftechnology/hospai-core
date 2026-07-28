import type { DomainEventMessage, Jurisdiction, ProvisionPropertyInput } from '@hospai/contracts';
import { InvalidTenantIdError, validateTenantId } from '@hospai/contracts';
import {
  checkKillSwitch,
  EntitlementRequiredError,
  EntitlementResolutionError,
  loadSnapshot,
  require,
} from '@hospai/entitlement-client';
import { resolveOrgStub } from '@hospai/tenant-router';
import {
  requireOrgMember,
  requirePropertyOrgMember,
  resolveActor,
} from './auth.js';
import {
  assertEnvSafeForRequest,
  type PmsEnv,
} from './env.js';
import { OrgDO } from './org-do.js';
import { OrgEntitlementDO } from './org-entitlement-do.js';
import { PropertyDO } from './property-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { createOrg, getProperty } from './registry.js';
import { DEDUPE_TTL_SEC, handleDomainEvent } from './event-consumer.js';

export type { PmsEnv } from './env.js';
export { PropertyDO } from './property-do.js';
export { OrgDO } from './org-do.js';
export { OrgEntitlementDO } from './org-entitlement-do.js';
export { NightAuditWorkflow } from './night-audit-workflow.js';
export { provisionProperty, resolvePropertyFromRegistry } from './provision.js';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export default {
  async fetch(request: Request, env: PmsEnv): Promise<Response> {
    const misconfigured = assertEnvSafeForRequest(env);
    if (misconfigured) return misconfigured;

    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'GET' && pathname === '/') {
      return new Response('hospai-pms-core', { status: 200 });
    }

    if (pathname.startsWith('/v1/')) {
      const actor = await resolveActor(request, env);
      if (actor instanceof Response) return actor;

      if (request.method === 'POST' && pathname === '/v1/orgs') {
        const body = (await request.json()) as { orgId: string; name: string };
        if (!body.orgId || !body.name) return json({ error: 'invalid_body' }, 400);
        try {
          validateTenantId(body.orgId);
        } catch (e) {
          if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
          throw e;
        }
        const created = await createOrg(env, body.orgId, body.name);
        if (!created) {
          return json({ error: 'org_exists' }, 409);
        }
        const org = resolveOrgStub(env.ORG_DO, { orgId: body.orgId }) as DurableObjectStub<OrgDO>;
        await org.ensureMember(actor.userId, 'owner');
        return json({ orgId: body.orgId, name: body.name }, 201);
      }

      const propertyCreate = pathname.match(/^\/v1\/orgs\/([^/]+)\/properties$/);
      if (request.method === 'POST' && propertyCreate) {
        const orgId = decodeURIComponent(propertyCreate[1]!);
        try {
          validateTenantId(orgId);
        } catch (e) {
          if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
          throw e;
        }

        const memberDenied = await requireOrgMember(env, orgId, actor.userId);
        if (memberDenied) return memberDenied;

        const body = (await request.json()) as {
          propertyId: string;
          name: string;
          jurisdiction?: Jurisdiction | null;
          timeZone: string;
          currency: string;
          orgName?: string;
        };
        if (!body.propertyId || !body.name || !body.timeZone || !body.currency) {
          return json({ error: 'invalid_body' }, 400);
        }

        if (await checkKillSwitch(env, 'pms.core')) {
          return new Response(null, { status: 503 });
        }
        try {
          const snap = await loadSnapshot(env, orgId);
          require(snap, 'pms.core');
        } catch (e) {
          if (e instanceof EntitlementRequiredError) {
            return json({ error: e.code, feature: e.featureKey }, 402);
          }
          if (e instanceof EntitlementResolutionError) {
            return new Response(null, { status: 503 });
          }
          return new Response(null, { status: 503 });
        }

        const input: ProvisionPropertyInput = {
          orgId,
          orgName: body.orgName,
          propertyId: body.propertyId,
          name: body.name,
          jurisdiction: body.jurisdiction === undefined ? null : body.jurisdiction,
          timeZone: body.timeZone,
          currency: body.currency,
          actorUserId: actor.userId,
        };
        const result = await provisionProperty(env, input);
        if (!result.ok) {
          if (result.error === 'jurisdiction_conflict') {
            return json({ error: result.error, existing: result.existing }, 409);
          }
          if (result.error === 'invalid_timezone' || result.error === 'invalid_currency' || result.error === 'invalid_tenant_id') {
            return json({ error: result.error }, 400);
          }
          return json({ error: result.error }, 400);
        }
        return json(result, 201);
      }

      const propertyGet = pathname.match(/^\/v1\/properties\/([^/]+)$/);
      if (request.method === 'GET' && propertyGet) {
        const propertyId = decodeURIComponent(propertyGet[1]!);
        const memberDenied = await requirePropertyOrgMember(env, propertyId, actor.userId);
        if (memberDenied) return memberDenied;

        const resolved = await resolvePropertyFromRegistry(env, propertyId);
        if (!resolved) return json({ error: 'not_found' }, 404);
        const recorded = await resolved.stub.getRecordedJurisdiction();
        return json({
          property: resolved.property,
          locationHint: resolved.locationHint,
          recordedJurisdiction: recorded ?? null,
          schemaVersion: await resolved.stub.getSchemaVersion(),
        });
      }

      const orgProperties = pathname.match(/^\/v1\/orgs\/([^/]+)\/properties$/);
      if (request.method === 'GET' && orgProperties) {
        const orgId = decodeURIComponent(orgProperties[1]!);
        const memberDenied = await requireOrgMember(env, orgId, actor.userId);
        if (memberDenied) return memberDenied;

        const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
        return json({ orgId, properties: await org.listPropertyRefs() });
      }

      if (request.method === 'GET' && pathname.startsWith('/v1/registry/properties/')) {
        const propertyId = decodeURIComponent(pathname.slice('/v1/registry/properties/'.length));
        const memberDenied = await requirePropertyOrgMember(env, propertyId, actor.userId);
        if (memberDenied) return memberDenied;

        const property = await getProperty(env, propertyId);
        if (!property) return json({ error: 'not_found' }, 404);
        return json({ property });
      }
    }

    return json({ error: 'not_found' }, 404);
  },

  async queue(batch: MessageBatch<DomainEventMessage>, env: PmsEnv): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body;
      if (await env.EVENT_DEDUPE_KV.get(`seen:${body.eventId}`)) {
        msg.ack();
        continue;
      }
      try {
        handleDomainEvent(body);
      } catch {
        msg.retry();
        continue;
      }
      await env.EVENT_DEDUPE_KV.put(`seen:${body.eventId}`, '1', { expirationTtl: DEDUPE_TTL_SEC });
      msg.ack();
    }
  },
};
