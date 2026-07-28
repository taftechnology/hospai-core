import type { DomainEventMessage, Jurisdiction, ProvisionPropertyInput } from '@hospai/contracts';
import { InvalidTenantIdError, validateTenantId } from '@hospai/contracts';
import {
  checkKillSwitch,
  EntitlementRequiredError,
  EntitlementResolutionError,
  loadSnapshot,
  require,
} from '@hospai/entitlement-client';
import { logError, logInfo, type ObservabilityContext } from '@hospai/observability';
import { resolveOrgStub } from '@hospai/tenant-router';
import {
  requireOrgMember,
  requirePropertyOrgMember,
  resolveActor,
} from './auth.js';
import { isDevActorAllowed, type PmsEnv } from './env.js';
import { OrgDO } from './org-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { createOrg, getProperty } from './registry.js';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function handleV1(
  request: Request,
  env: PmsEnv,
  ctx: ObservabilityContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/v1/admin/migration-sweep') {
    if (!isDevActorAllowed(env) || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }
  }

  const actor = await resolveActor(request, env);
  if (actor instanceof Response) return actor;

  ctx.userId = actor.userId;

  if (request.method === 'POST' && pathname === '/v1/admin/migration-sweep') {
    const instance = await env.MIGRATION_SWEEP_WORKFLOW.create({
      id: `migration-sweep-${Date.now()}`,
      params: { triggeredBy: actor.userId },
    });
    return json({ workflowId: instance.id }, 202);
  }

  if (request.method === 'POST' && pathname === '/v1/orgs') {
    const body = (await request.json()) as { orgId: string; name: string };
    if (!body.orgId || !body.name) return json({ error: 'invalid_body' }, 400);
    try {
      validateTenantId(body.orgId);
    } catch (e) {
      if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
      throw e;
    }
    ctx.orgId = body.orgId;
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
    ctx.orgId = orgId;

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
    ctx.propertyId = body.propertyId;

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
      if (
        result.error === 'invalid_timezone' ||
        result.error === 'invalid_currency' ||
        result.error === 'invalid_tenant_id'
      ) {
        return json({ error: result.error }, 400);
      }
      return json({ error: result.error }, 400);
    }
    return json(result, 201);
  }

  const propertyGet = pathname.match(/^\/v1\/properties\/([^/]+)$/);
  if (request.method === 'GET' && propertyGet) {
    const propertyId = decodeURIComponent(propertyGet[1]!);
    ctx.propertyId = propertyId;
    const memberDenied = await requirePropertyOrgMember(env, propertyId, actor.userId);
    if (memberDenied) return memberDenied;

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    if (!resolved) return json({ error: 'not_found' }, 404);
    ctx.orgId = resolved.property.orgId;
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
    ctx.orgId = orgId;
    const memberDenied = await requireOrgMember(env, orgId, actor.userId);
    if (memberDenied) return memberDenied;

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    return json({ orgId, properties: await org.listPropertyRefs() });
  }

  if (request.method === 'GET' && pathname.startsWith('/v1/registry/properties/')) {
    const propertyId = decodeURIComponent(pathname.slice('/v1/registry/properties/'.length));
    ctx.propertyId = propertyId;
    const memberDenied = await requirePropertyOrgMember(env, propertyId, actor.userId);
    if (memberDenied) return memberDenied;

    const property = await getProperty(env, propertyId);
    if (!property) return json({ error: 'not_found' }, 404);
    ctx.orgId = property.orgId;
    return json({ property });
  }

  return json({ error: 'not_found' }, 404);
}
