import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { reportApiError, reportApiSuccess } from './connection';

const RETRYABLE = new Set(['network', 'upstream_unavailable', 'internal']);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  return error instanceof ApiError ? RETRYABLE.has(error.code) : false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: reportApiError, onSuccess: reportApiSuccess }),
    mutationCache: new MutationCache({ onError: reportApiError, onSuccess: reportApiSuccess }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        refetchOnWindowFocus: true,
        staleTime: 2000,
      },
    },
  });
}
