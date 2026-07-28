export type ObservabilityContext = {
  userId?: string;
  orgId?: string;
  propertyId?: string;
  moduleId: string;
  requestId?: string;
};

/** Merge tenant tags into a structured log object. Unknown tags are omitted. */
export function logFields(
  ctx: ObservabilityContext,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    ts: Date.now(),
    module_id: ctx.moduleId,
  };
  if (ctx.userId !== undefined) fields.user_id = ctx.userId;
  if (ctx.orgId !== undefined) fields.org_id = ctx.orgId;
  if (ctx.propertyId !== undefined) fields.property_id = ctx.propertyId;
  if (ctx.requestId !== undefined) fields.request_id = ctx.requestId;
  if (extra) Object.assign(fields, extra);
  return fields;
}

export function mergeContext(
  ctx: ObservabilityContext,
  patch: Partial<Pick<ObservabilityContext, 'userId' | 'orgId' | 'propertyId'>>,
): void {
  if (patch.userId !== undefined) ctx.userId = patch.userId;
  if (patch.orgId !== undefined) ctx.orgId = patch.orgId;
  if (patch.propertyId !== undefined) ctx.propertyId = patch.propertyId;
}
