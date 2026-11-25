import type {
  CustomerDetail,
  CustomerPage,
  OperatorActionPage,
  OperatorView,
  OpsCatalog,
  OpsCopyStatus,
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

export const useCustomers = (status: string, query: string, page: number) =>
  useQuery({
    queryKey: opsKeys.customers(status, query, page),
    queryFn: () =>
      apiGet<CustomerPage>(
        `/customers?status=${encodeURIComponent(status)}&query=${encodeURIComponent(query)}&page=${page}`,
      ),
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

/** How often the copy result view asks for progress. Tests shorten it. */
let copyPollMs = 2000;
export function setCopyPollMs(ms: number): void {
  copyPollMs = ms;
}

/** One copy's progress. Polls until the run is completed or failed, then stops. */
export const useCopyStatus = (copyId: string) =>
  useQuery({
    queryKey: opsKeys.copy(copyId),
    queryFn: () => apiGet<OpsCopyStatus>(`/copies/${encodeURIComponent(copyId)}`),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'completed' || state === 'failed' ? false : copyPollMs;
    },
    staleTime: 0,
  });

/** The plans and add-ons that exist. Changes rarely, so it is not refetched on every dialog. */
export const useCatalog = () =>
  useQuery({
    queryKey: opsKeys.catalog(),
    queryFn: () => apiGet<OpsCatalog>('/catalog'),
    staleTime: 5 * 60_000,
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

/**
 * A write to `path`: sends `{ clientKey, reason, ticketRef?, ...payload }`, then invalidates `invalidate`.
 * `keepKeyOnSuccess` keeps the idempotency key after a success, so sending the same request again is
 * the same request (a copy that failed half-way resumes with it).
 */
export function useOpsWrite(path: string, invalidate: () => QueryKey[], opts?: { keepKeyOnSuccess?: boolean }) {
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
      return apiPost<{ actionId: string | null; replayed: boolean; copyId?: string }>(path, body);
    },
    onSuccess: async () => {
      if (!opts?.keepKeyOnSuccess) clear();
      await Promise.all(invalidate().map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}
