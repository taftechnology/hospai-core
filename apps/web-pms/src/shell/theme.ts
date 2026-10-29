import { useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'hospai.theme';

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage may be blocked; the document theme still applies */
  }
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function useThemeChoice(): readonly [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  function choose(next: ThemeChoice) {
    applyTheme(next);
    setChoice(next);
  }
  return [choice, choose] as const;
}
