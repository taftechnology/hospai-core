/** Every query key, with its params. Mutations invalidate these exact prefixes. */
export const opsKeys = {
  me: () => ['ops', 'me'] as const,
  customersAll: () => ['ops', 'customers'] as const,
  customers: (status: string, query: string, page: number) => ['ops', 'customers', status, query, page] as const,
  customer: (orgId: string) => ['ops', 'customer', orgId] as const,
  health: (propertyId: string) => ['ops', 'health', propertyId] as const,
  actionsAll: () => ['ops', 'operator-actions'] as const,
  actions: (orgId: string, operatorId: string, page: number) =>
    ['ops', 'operator-actions', orgId, operatorId, page] as const,
  catalog: () => ['ops', 'catalog'] as const,
  operators: () => ['ops', 'operators'] as const,
  copy: (copyId: string) => ['ops', 'copy', copyId] as const,
};
