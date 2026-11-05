import { useSyncExternalStore } from 'react';
import { ApiError } from './api';

/** Tracks whether the browser can currently reach the API, so pages can say "disconnected" truthfully. */
let failures = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function reportApiSuccess(): void {
  if (failures !== 0) {
    failures = 0;
    emit();
  }
}

export function reportApiError(error: unknown): void {
  if (error instanceof ApiError && error.code === 'network') {
    failures += 1;
    emit();
  }
}

export function resetConnectionState(): void {
  failures = 0;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True after two consecutive network-level failures (one blip is not a disconnect). */
export function useDisconnected(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => failures >= 2,
    () => false,
  );
}
