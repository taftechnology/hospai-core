import { useSignIn } from '@clerk/react/legacy';
import { FormEvent, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  demoGateEmail,
  demoGatePassword,
  spaAuthMode,
} from '../providers/spa-auth-mode.js';

const DEMO_UNLOCK_KEY = 'hospai.demo-unlock';

function SignInChrome({ children }: { children?: ReactNode }) {
  return (
    <div className="sign-in" data-testid="sign-in">
      <div className="sign-in-card">
        <div className="app-sidebar-brand">
          <span className="app-sidebar-mark">✦</span>
          <p className="app-sidebar-title">
            HospAI <span>PMS</span>
          </p>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Front desk</p>
        {children}
      </div>
    </div>
  );
}

function ClerkSignInForm() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded || !signIn) return;
    setError(null);
    setPending(true);
    const form = event.currentTarget;
    const identifier = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    try {
      const result = await signIn.create({ identifier, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        navigate('/board');
        return;
      }
      if (result.status === 'needs_second_factor') {
        setError('This account needs a second step. Use the demo user.');
        return;
      }
      setError('Could not sign in.');
    } catch (err: unknown) {
      const clerkErr = err as { errors?: Array<{ message?: string }> };
      setError(clerkErr.errors?.[0]?.message ?? 'Could not sign in.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <label>
        Email
        <input
          type="email"
          name="email"
          data-testid="sign-in-email"
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          data-testid="sign-in-password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        className="btn-primary"
        data-testid="sign-in-submit"
        disabled={!isLoaded || pending}
      >
        Sign in
      </button>
    </form>
  );
}

function PasswordGateForm() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim().toLowerCase();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (email === demoGateEmail().trim().toLowerCase() && password === demoGatePassword()) {
      sessionStorage.setItem(DEMO_UNLOCK_KEY, '1');
      navigate('/board');
      return;
    }
    setError('Email or password is wrong.');
  };

  return (
    <form onSubmit={onSubmit}>
      <label>
        Email
        <input
          type="email"
          name="email"
          data-testid="sign-in-email"
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          data-testid="sign-in-password"
          autoComplete="current-password"
          required
        />
      </label>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <button type="submit" className="btn-primary" data-testid="sign-in-submit">
        Sign in
      </button>
    </form>
  );
}

export function SignInScreen() {
  const mode = spaAuthMode();

  if (mode === 'engineer') {
    return <Navigate to="/board" replace />;
  }

  if (mode === 'password-gate') {
    if (sessionStorage.getItem(DEMO_UNLOCK_KEY) === '1') {
      return <Navigate to="/board" replace />;
    }
    return (
      <SignInChrome>
        <PasswordGateForm />
      </SignInChrome>
    );
  }

  if (mode === 'clerk') {
    return (
      <SignInChrome>
        <ClerkSignInForm />
      </SignInChrome>
    );
  }

  return (
    <SignInChrome>
      <p className="error" role="alert">
        Sign-in is not configured.
      </p>
    </SignInChrome>
  );
}
