import { useSignIn } from '@clerk/react/legacy';
import { FormEvent, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Field,
  Input,
} from '@hospai/ui-kit';
import {
  demoGateEmail,
  demoGatePassword,
  spaAuthMode,
} from '../providers/spa-auth-mode.js';

export const DEMO_UNLOCK_KEY = 'hospai.demo-unlock';
export const ENGINEER_DEMO_PASSWORD = 'demo';

function SignInChrome({
  children,
  badge,
}: {
  children?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <main className="sign-in" data-testid="sign-in">
      <section className="sign-in__brand" aria-label="HospAI PMS">
        <div className="sign-in__brand-top">
          <div className="sign-in__lockup">
            <span className="sign-in__mark" aria-hidden="true">
              ✦
            </span>
            <span className="sign-in__wordmark">
              HOSPAI <span>PMS</span>
            </span>
          </div>
          <span className="sign-in__brand-label">Front desk</span>
        </div>

        <div className="sign-in__brand-copy">
          <p className="sign-in__eyebrow">Hospitality operations</p>
          <h2 className="sign-in__brand-title">
            Keep the desk
            <span>moving.</span>
          </h2>
          <p className="sign-in__brand-description">
            One calm workspace for arrivals, rooms, reservations, and every detail in between.
          </p>
        </div>

        <div className="sign-in__brand-footer">
          <span className="sign-in__status-dot" aria-hidden="true" />
          <span>Front office workspace</span>
          <span className="sign-in__brand-footer-rule" aria-hidden="true" />
          <span>Ready when you are</span>
        </div>
      </section>

      <section className="sign-in__content">
        <div className="sign-in__content-inner">
          <div className="sign-in__mobile-lockup">
            <div className="sign-in__lockup">
              <span className="sign-in__mark" aria-hidden="true">
                ✦
              </span>
              <span className="sign-in__wordmark">
                HOSPAI <span>PMS</span>
              </span>
            </div>
          </div>

          <div className="sign-in__intro">
            <p className="sign-in__eyebrow">Front desk workspace</p>
            <h1 id="sign-in-title">Sign in</h1>
            <p>Access your property operations in one place.</p>
          </div>

          <div className="sign-in__form-card">
            <div className="sign-in__form-card-top">
              <span>Workspace access</span>
              {badge ?? (
                <span className="sign-in__secure-label">
                  <span className="sign-in__secure-dot" aria-hidden="true" />
                  Secure
                </span>
              )}
            </div>
            {children}
          </div>

          <p className="sign-in__support-copy">
            Sign-in access is managed by your organization. Contact an administrator if you need help.
          </p>
        </div>
      </section>
    </main>
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
    <form className="sign-in__form" onSubmit={onSubmit}>
      <Field
        label="Email"
        control={
          <Input
            type="email"
            name="email"
            data-testid="sign-in-email"
            autoComplete="username"
            required
          />
        }
      />
      <Field
        label="Password"
        control={
          <Input
            type="password"
            name="password"
            data-testid="sign-in-password"
            autoComplete="current-password"
            required
          />
        }
      />
      {error ? <Alert>{error}</Alert> : null}
      <Button
        type="submit"
        intent="primary"
        data-testid="sign-in-submit"
        disabled={!isLoaded || pending}
      >
        Sign in
      </Button>
    </form>
  );
}

function PasswordGateForm({ acceptAny = false }: { acceptAny?: boolean }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim().toLowerCase();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (
      acceptAny ||
      (email === demoGateEmail().trim().toLowerCase() && password === demoGatePassword())
    ) {
      sessionStorage.setItem(DEMO_UNLOCK_KEY, '1');
      navigate('/board');
      return;
    }
    setError('Email or password is wrong.');
  };

  return (
    <form className="sign-in__form" onSubmit={onSubmit}>
      <Field
        label="Email"
        control={
          <Input
            type="email"
            name="email"
            data-testid="sign-in-email"
            autoComplete="username"
            defaultValue={acceptAny ? demoGateEmail() : undefined}
            required
          />
        }
      />
      <Field
        label="Password"
        control={
          <Input
            type="password"
            name="password"
            data-testid="sign-in-password"
            autoComplete="current-password"
            defaultValue={acceptAny ? ENGINEER_DEMO_PASSWORD : undefined}
            required
          />
        }
      />
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" intent="primary" data-testid="sign-in-submit">
        Sign in
      </Button>
    </form>
  );
}

export function SignInScreen() {
  const mode = spaAuthMode();

  if (mode === 'engineer') {
    if (new URLSearchParams(window.location.search).has('logged-out')) {
      return (
        <SignInChrome
          badge={
            <span className="sign-in__engineer-badge" data-testid="engineer-mode-badge">
              Engineering mode
            </span>
          }
        >
          <PasswordGateForm acceptAny />
        </SignInChrome>
      );
    }
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
      <Alert>Sign-in is not configured.</Alert>
    </SignInChrome>
  );
}
