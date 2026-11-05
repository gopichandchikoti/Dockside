import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  applyPrefs,
  getPrefs,
  reloadPrefsFromStorage,
  sanitizePrefs,
  updatePrefs,
} from './prefs';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-motion');
});

describe('sanitizePrefs', () => {
  it('keeps valid values and falls back field-by-field for corrupt ones', () => {
    expect(sanitizePrefs({ theme: 'dark', motion: 'reduce', refreshSeconds: 30 })).toEqual({
      theme: 'dark',
      motion: 'reduce',
      refreshSeconds: 30,
    });
    expect(sanitizePrefs({ theme: 'neon', motion: 3, refreshSeconds: 7 })).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ theme: 'light', refreshSeconds: 'fast' })).toMatchObject({
      theme: 'light',
      refreshSeconds: 15,
    });
    for (const junk of [null, undefined, 'x', 42, []]) expect(sanitizePrefs(junk)).toEqual(DEFAULT_PREFS);
  });
});

describe('persistence', () => {
  it('applies attributes and persists updates', () => {
    updatePrefs({ theme: 'dark', motion: 'reduce' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ theme: 'dark' });
    updatePrefs({ theme: 'system', motion: 'system' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
  });

  it('recovers from corrupt JSON in storage', () => {
    window.localStorage.setItem(PREFS_KEY, '{not json');
    reloadPrefsFromStorage();
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('still applies a preference when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => updatePrefs({ theme: 'light' })).not.toThrow();
    expect(getPrefs().theme).toBe('light');
    updatePrefs({ theme: 'system' });
  });

  it('applyPrefs targets an arbitrary root', () => {
    const el = document.createElement('div');
    applyPrefs({ theme: 'light', motion: 'allow', refreshSeconds: 5 }, el);
    expect(el.getAttribute('data-theme')).toBe('light');
    expect(el.getAttribute('data-motion')).toBe('allow');
  });
});
