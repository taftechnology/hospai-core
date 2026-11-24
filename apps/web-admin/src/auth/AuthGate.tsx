import { useAuth, useClerk } from '@clerk/react';
import { Alert, Button, PageHeader } from '@hospai/ui-kit';
import { useEffect, type ReactNode } from 'react';
import { registerTokenGetter, setDevOperator } from '../api/client.js';
import { ConsoleSignIn } from './ConsoleSignIn.js';
import { devOperatorEmail, opsAuthMode, type OpsAuthMode } from './auth-mode.js';

function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  // Registered during render so the first query of the signed-in tree already has a token getter.
  registerTokenGetter(() => getToken());
  useEffect(() => () => registerTokenGetter(null), []);
  if (!isLoaded) return null;
  if (!isSignedIn) {
    return <ConsoleSignIn />;
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

function ClerkSignOut() {
  const { signOut } = useClerk();
  return (
    <Button type="button" onClick={() => void signOut()}>
      Sign out
    </Button>
  );
}

export function SignOutControl({ mode = opsAuthMode() }: { mode?: OpsAuthMode }) {
  if (mode === 'clerk') return <ClerkSignOut />;
  if (mode === 'dev') return <span>Local dev operator</span>;
  return null;
}
