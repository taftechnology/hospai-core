import type {
  CustomerDetail,
  CustomerPage,
  OperatorActionPage,
  OperatorView,
  OpsRole,
  PropertyHealthView,
} from '@hospai/contracts';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { apiGet, apiPost } from './client.js';
import { opsKeys } from './keys.js';

export type MeView = { operatorId: string; displayName: string; role: OpsRole };

export const useMe = () =>
  useQuery({
    queryKey: opsKeys.me(),
    queryFn: async () => (await apiGet<{ operator: MeView }>('/me')).operator,
    retry: false,
  });

export const useCustomers = (query: string, page: number) =>
  useQuery({
    queryKey: opsKeys.customers(query, page),
    queryFn: () =>
      apiGet<CustomerPage>(`/customers?query=${encodeURIComponent(query)}&page=${page}`),
  });

export const useCustomer = (orgId: string) =>
  useQuery({
    queryKey: opsKeys.customer(orgId),
    queryFn: () => apiGet<CustomerDetail>(`/customers/${encodeURIComponent(orgId)}`),
  });

export const usePropertyHealth = (propertyId: string) =>
  useQuery({
    queryKey: opsKeys.health(propertyId),
    queryFn: () => apiGet<PropertyHealthView>(`/properties/${encodeURIComponent(propertyId)}/health`),
  });

export const useOperatorActions = (orgId: string, operatorId: string, page: number) =>
  useQuery({
    queryKey: opsKeys.actions(orgId, operatorId, page),
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page) });
      if (orgId) p.set('orgId', orgId);
      if (operatorId) p.set('operatorId', operatorId);
      return apiGet<OperatorActionPage>(`/operator-actions?${p.toString()}`);
    },
  });

export const useOperators = (enabled: boolean) =>
  useQuery({
    queryKey: opsKeys.operators(),
    queryFn: async () => (await apiGet<{ operators: OperatorView[] }>('/operators')).operators,
    enabled,
  });

/**
 * One idempotency key per submit attempt. The same payload sent again after a failure reuses the
 * key (so a retry is the same change); an edited payload gets a fresh key; success clears it.
 */
export function useClientKey() {
  const held = useRef<{ fingerprint: string; key: string } | null>(null);
  const keyFor = useCallback((payload: unknown): string => {
    const fingerprint = JSON.stringify(payload);
    if (held.current?.fingerprint !== fingerprint) {
      held.current = { fingerprint, key: crypto.randomUUID() };
    }
    return held.current.key;
  }, []);
  const clear = useCallback(() => {
    held.current = null;
  }, []);
  return { keyFor, clear };
}

export type WriteMeta = { reason: string; ticketRef: string };

/** A write to `path`: sends `{ clientKey, reason, ticketRef?, ...payload }`, then invalidates `invalidate`. */
export function useOpsWrite(path: string, invalidate: () => QueryKey[]) {
  const qc = useQueryClient();
  const { keyFor, clear } = useClientKey();
  return useMutation({
    mutationFn: async (input: { payload: Record<string, unknown>; meta: WriteMeta }) => {
      const body = {
        ...input.payload,
        reason: input.meta.reason.trim(),
        ...(input.meta.ticketRef.trim() ? { ticketRef: input.meta.ticketRef.trim() } : {}),
        clientKey: keyFor({ path, ...input.payload, reason: input.meta.reason.trim(), ticketRef: input.meta.ticketRef.trim() }),
      };
      return apiPost<{ actionId: string | null; replayed: boolean }>(path, body);
    },
    onSuccess: async () => {
      clear();
      await Promise.all(invalidate().map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}
