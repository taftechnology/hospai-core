export type TenantConfig = { orgId: string; propertyId: string };

/**
 * The build-time demo tenant (`VITE_ORG_ID` / `VITE_PROPERTY_ID`), now only an optional default
 * (R4.4): the active hotel is chosen at runtime from `GET /v1/me/tenants`. Returns null when
 * either value is missing; it never throws.
 */
export function readTenantConfig(env: ImportMetaEnv): TenantConfig | null {
  const orgId = env.VITE_ORG_ID;
  const propertyId = env.VITE_PROPERTY_ID;
  if (!orgId || !propertyId) return null;
  return { orgId, propertyId };
}
