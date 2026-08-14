/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClerkSignedInGate } from './ClerkSignedInGate.js';
import type { SpaAuthMode } from './spa-auth-mode.js';

const { currentMode, useAuthMock } = vi.hoisted(() => ({
  currentMode: { value: 'engineer' as SpaAuthMode },
  useAuthMock: vi.fn(),
}));

vi.mock('./spa-auth-mode.js', () => ({
  spaAuthMode: () => currentMode.value,
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => useAuthMock(),
}));

describe('ClerkSignedInGate', () => {
  const assign = vi.fn();

  beforeEach(() => {
    currentMode.value = 'engineer';
    useAuthMock.mockReset();
    assign.mockClear();
    vi.stubGlobal('location', { ...window.location, assign });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['engineer', 'password-gate', 'misconfigured'] as const)(
    'passes through children in %s mode without calling useAuth',
    (mode) => {
      currentMode.value = mode;
      render(
        <ClerkSignedInGate>
          <span data-testid="child">child</span>
        </ClerkSignedInGate>,
      );
      expect(screen.getByTestId('child')).toBeTruthy();
      expect(useAuthMock).not.toHaveBeenCalled();
    },
  );

  it('renders nothing while clerk auth is loading', () => {
    currentMode.value = 'clerk';
    useAuthMock.mockReturnValue({ isLoaded: false, isSignedIn: false });
    render(
      <ClerkSignedInGate>
        <span data-testid="child">child</span>
      </ClerkSignedInGate>,
    );
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('assigns /sign-in when clerk auth is loaded but signed out', () => {
    currentMode.value = 'clerk';
    useAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: false });
    render(
      <ClerkSignedInGate>
        <span data-testid="child">child</span>
      </ClerkSignedInGate>,
    );
    expect(assign).toHaveBeenCalledWith('/sign-in');
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('renders children when clerk auth is loaded and signed in', () => {
    currentMode.value = 'clerk';
    useAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: true });
    render(
      <ClerkSignedInGate>
        <span data-testid="child">child</span>
      </ClerkSignedInGate>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
