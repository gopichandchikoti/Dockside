import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type MotionPref = 'system' | 'reduce' | 'allow';
export const REFRESH_CHOICES = [0, 5, 15, 30, 60] as const;
export type RefreshSeconds = (typeof REFRESH_CHOICES)[number];

export interface Prefs {
  theme: ThemePref;
  motion: MotionPref;
  refreshSeconds: RefreshSeconds;
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', motion: 'system', refreshSeconds: 15 };
export const PREFS_KEY = 'dockside.prefs.v1';

const isOneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T =>
  list.includes(value as T);

/** Accepts whatever was persisted and returns safe preferences; corrupt or partial data falls back per field. */
export function sanitizePrefs(raw: unknown): Prefs {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    theme: isOneOf(['system', 'light', 'dark'] as const, input.theme) ? input.theme : DEFAULT_PREFS.theme,
    motion: isOneOf(['system', 'reduce', 'allow'] as const, input.motion) ? input.motion : DEFAULT_PREFS.motion,
    refreshSeconds: isOneOf(REFRESH_CHOICES, input.refreshSeconds)
      ? input.refreshSeconds
      : DEFAULT_PREFS.refreshSeconds,
  };
}

function load(): Prefs {
  try {
    const text = window.localStorage.getItem(PREFS_KEY);
    return sanitizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(prefs: Prefs, root: HTMLElement = document.documentElement): void {
  if (prefs.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prefs.theme);
  if (prefs.motion === 'system') root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', prefs.motion);
}

let current: Prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

export function updatePrefs(patch: Partial<Prefs>): void {
  current = sanitizePrefs({ ...current, ...patch });
  applyPrefs(current);
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(current));
  } catch {
    /* storage blocked or full: the preference still applies for this session */
  }
  listeners.forEach((listener) => listener());
}

export function reloadPrefsFromStorage(): void {
  current = load();
  applyPrefs(current);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
