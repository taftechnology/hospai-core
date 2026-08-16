import { QueryClient } from '@tanstack/react-query';
import { shouldRetry, retryDelay } from '@hospai/client-core';
import { asClassified } from './client.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
}
