import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme } from './theme.js';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('defaults to system when nothing is stored', () => {
    expect(readTheme()).toBe('system');
  });

  it('applies a stored light or dark choice', () => {
    localStorage.setItem('hospai.theme', 'light');
    expect(readTheme()).toBe('light');
    applyTheme('dark');
    expect(readTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('hospai.theme')).toBe('dark');
  });

  it('treats a bad stored value as system', () => {
    localStorage.setItem('hospai.theme', 'neon');
    expect(readTheme()).toBe('system');
  });

  it('returns system and does not crash when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTheme()).toBe('system');
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('clears data-theme for system', () => {
    applyTheme('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('hospai.theme')).toBe('system');
  });
});
