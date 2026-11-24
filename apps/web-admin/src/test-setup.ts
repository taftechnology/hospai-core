// jest-dom matchers are only meaningful (and only importable) in the jsdom screen tests.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  // The first lazy route render under v8 coverage can take longer than the 1000ms default of findBy*/waitFor.
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5000 });
}

export {};
