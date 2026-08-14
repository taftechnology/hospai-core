import { useAuth } from '@clerk/react';
import type { ReactNode } from 'react';
import { spaAuthMode } from './spa-auth-mode.js';

function ClerkSessionGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;

  if (!isSignedIn) {
    window.location.assign('/sign-in');
    return null;
  }

  return children;
}

export function ClerkSignedInGate({ children }: { children: ReactNode }) {
  if (spaAuthMode() !== 'clerk') return children;
  return <ClerkSessionGate>{children}</ClerkSessionGate>;
}
