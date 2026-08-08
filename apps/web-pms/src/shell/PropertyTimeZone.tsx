import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, tenant } from '../client.js';

const PropertyTimeZoneContext = createContext<string | null>(null);

export function PropertyTimeZoneProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    retry: false,
  });
  const timeZone = q.data?.property?.timeZone ?? null;
  return (
    <PropertyTimeZoneContext.Provider value={timeZone}>{children}</PropertyTimeZoneContext.Provider>
  );
}

export function usePropertyTimeZone(): string | null {
  return useContext(PropertyTimeZoneContext);
}
