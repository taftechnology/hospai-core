// jest-dom matchers are only meaningful (and only importable) in the jsdom screen tests.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

export {};
