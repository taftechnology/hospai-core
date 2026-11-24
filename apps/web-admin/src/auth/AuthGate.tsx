import { SignIn, UserButton, useAuth } from '@clerk/react';
import { Alert, PageHeader } from '@hospai/ui-kit';
import { useEffect, type ReactNode } from 'react';
import { registerTokenGetter, setDevOperator } from '../api/client.js';
import { devOperatorEmail, opsAuthMode, type OpsAuthMode } from './auth-mode.js';

function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Registered during render so the first query of the signed-in tree already has a token getter.
  registerTokenGetter(() => getToken());
  useEffect(() => () => registerTokenGetter(null), []);
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="ops-centered">
        <PageHeader title="HospAI Ops Console" subtitle="Staff sign-in. A second factor is required." />
        <SignIn routing="hash" />
      </div>
    );
  }
  return <>{children}</>;
}

/** The Ops Console's own sign-in: the ops Clerk instance, or the gated local dev header. */
export function AuthGate({ children, mode = opsAuthMode() }: { children: ReactNode; mode?: OpsAuthMode }) {
  if (mode === 'dev') {
    setDevOperator(devOperatorEmail());
    return <>{children}</>;
  }
  if (mode === 'clerk') return <ClerkSession>{children}</ClerkSession>;
  return (
    <div className="ops-centered">
      <PageHeader title="HospAI Ops Console" />
      <Alert intent="exception">
        Sign-in is not configured. Set VITE_CLERK_PUBLISHABLE_KEY (the ops Clerk instance) and rebuild.
      </Alert>
    </div>
  );
}

export function SignOutControl({ mode = opsAuthMode() }: { mode?: OpsAuthMode }) {
  if (mode === 'clerk') return <UserButton />;
  if (mode === 'dev') return <span>Local dev operator</span>;
  return null;
}
