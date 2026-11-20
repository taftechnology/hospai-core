import { MutationCache, QueryClient } from '@tanstack/react-query';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { asClassified } from './client.js';

export function createQueryClient(): QueryClient {
  // Live room view (R4.27, D6): every mutation that succeeds here changes what the desk sees in a
  // room (check-in/out, undo checkout, assign or move room, room and bulk status, OOO set or
  // release, invoice generate or void, early depart), so each one marks the room board stale.
  // Only a mounted board refetches; the prefix covers every property key.
  const mutationCache = new MutationCache({
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['room-board'] });
    },
  });
  const client: QueryClient = new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        retry: (count, err) => shouldRetry(asClassified(err)) && count < 3,
        retryDelay: (count, err) => retryDelay(asClassified(err), count),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
