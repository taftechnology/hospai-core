export type TenantConfig = { orgId: string; propertyId: string };

export function readTenantConfig(env: ImportMetaEnv): TenantConfig {
  const orgId = env.VITE_ORG_ID;
  const propertyId = env.VITE_PROPERTY_ID;
  if (!orgId || !propertyId) {
    throw new Error('tenant_config_missing');
  }
  return { orgId, propertyId };
}
