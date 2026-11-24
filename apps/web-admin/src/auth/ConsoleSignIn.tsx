import { useSignIn } from '@clerk/react/legacy';
import { Alert, Button, Card, CardContent, Field, Input, PageHeader } from '@hospai/ui-kit';
import { useState, type FormEvent } from 'react';

/**
 * The Ops Console's own sign-in form. Clerk's prebuilt components inject inline <style> tags, which the
 * Worker's strict CSP (no style-src 'unsafe-inline') blocks, so the console builds its own on the
 * headless hooks. See no-clerk-prebuilt-ui.test.ts.
 */

const BAD_CREDENTIALS = 'Email or password is incorrect.';
const BAD_CODE = "That code didn't work. Try the current code from your authenticator app.";
const BAD_BACKUP_CODE = "That backup code didn't work. Each backup code can be used once.";
const RATE_LIMITED = 'Too many attempts. Wait a minute and try again.';
const GENERIC = 'Sign-in did not work. Try again, and tell an administrator if it keeps happening.';

type ClerkErrorLike = { status?: number; errors?: Array<{ code?: string }> };

function errorCodes(err: unknown): { codes: string[]; status: number | undefined } {
  const e = err as ClerkErrorLike | null;
  return { codes: (e?.errors ?? []).map((x) => x.code ?? ''), status: e?.status };
}

/** Plain-words message for a failed password step. Wrong password and unknown email read the same. */
export function passwordErrorMessage(err: unknown): string {
  const { codes, status } = errorCodes(err);
  if (status === 429 || codes.includes('too_many_requests')) return RATE_LIMITED;
  if (
    codes.some((c) =>
      ['form_password_incorrect', 'form_identifier_not_found', 'form_param_format_invalid', 'strategy_for_user_invalid'].includes(c),
    )
  ) {
    return BAD_CREDENTIALS;
  }
  return GENERIC;
}

/** Plain-words message for a failed second-factor step. */
export function codeErrorMessage(err: unknown, backup: boolean): string {
  const { codes, status } = errorCodes(err);
  if (status === 429 || codes.includes('too_many_requests')) return RATE_LIMITED;
  if (codes.some((c) => ['form_code_incorrect', 'verification_failed', 'verification_expired', 'form_param_format_invalid'].includes(c))) {
    return backup ? BAD_BACKUP_CODE : BAD_CODE;
  }
  return GENERIC;
}

/**
 * Account page of the instance behind a publishable key, or null when the shape is not one we know.
 * A development key encodes `<slug>.clerk.accounts.dev`, whose Account Portal is `<slug>.accounts.dev`;
 * a production key encodes `clerk.<domain>`, whose portal is `accounts.<domain>`.
 */
export function accountPageUrl(publishableKey: string | undefined): string | null {
  const m = /^pk_(test|live)_(.+)$/.exec(publishableKey ?? '');
  if (!m) return null;
  let host: string;
  try {
    host = atob(m[2] ?? '').replace(/\$$/, '');
  } catch {
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (m[1] === 'test') {
    const dev = /^([a-z0-9-]+)\.clerk\.accounts\.dev$/.exec(host);
    return dev ? `https://${dev[1]}.accounts.dev/user` : null;
  }
  return host.startsWith('clerk.') ? `https://accounts.${host.slice('clerk.'.length)}/user` : null;
}

function SetupRequired() {
  const url = accountPageUrl(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  return (
    <Alert intent="attention">
      This account has not finished setting up two-step verification, which the Ops Console requires. Open{' '}
      {url ? <a href={url}>the Clerk account page</a> : 'the Clerk account page'} for this instance, add an authenticator app
      under Security, then sign in again.
    </Alert>
  );
}

type Step = 'password' | 'code' | 'setup';

export function ConsoleSignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<Step>('password');
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded || !signIn) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending(true);
    try {
      const result = await signIn.create({
        identifier: String(form.get('email') ?? '').trim(),
        password: String(form.get('password') ?? ''),
      });
      if (result.status === 'needs_second_factor') {
        const supported = (result.supportedSecondFactors ?? []).map((f) => f.strategy as string);
        const usable = supported.length === 0 || supported.includes('totp') || supported.includes('backup_code');
        if (!usable) setStep('setup');
        else {
          setBackup(supported.length > 0 && !supported.includes('totp'));
          setStep('code');
        }
        return;
      }
      // Complete without a second factor (or any other status): the Worker would reject this session.
      setStep('setup');
    } catch (err: unknown) {
      setError(passwordErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const onCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded || !signIn) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending(true);
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: backup ? 'backup_code' : 'totp',
        code: String(form.get('code') ?? '').trim(),
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        return;
      }
      setStep('setup');
    } catch (err: unknown) {
      setError(codeErrorMessage(err, backup));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ops-centered ops-sign-in">
      <PageHeader title="Sign in to HospAI Ops" subtitle="Staff only. A second step with your authenticator app is required." />
      <Card className="ops-sign-in__card">
        <CardContent>
        {step === 'setup' ? (
          <SetupRequired />
        ) : step === 'password' ? (
          <form className="ops-sign-in__form" onSubmit={onPassword}>
            <Field
              label="Email"
              control={<Input type="email" name="email" autoComplete="username" required />}
            />
            <Field
              label="Password"
              control={<Input type="password" name="password" autoComplete="current-password" required />}
            />
            {error ? <Alert intent="exception">{error}</Alert> : null}
            <Button type="submit" intent="primary" disabled={!isLoaded || pending}>
              Sign in
            </Button>
          </form>
        ) : (
          <form className="ops-sign-in__form" onSubmit={onCode} key={backup ? 'backup' : 'totp'}>
            {/* ui-kit Input has no inputMode prop; type="tel" gives the numeric keypad without a raw input. */}
            <Field
              label={backup ? 'Backup code' : '6-digit code from your authenticator app'}
              control={
                backup ? (
                  <Input type="text" name="code" autoComplete="off" required />
                ) : (
                  <Input type="tel" name="code" autoComplete="one-time-code" required />
                )
              }
            />
            {error ? <Alert intent="exception">{error}</Alert> : null}
            <Button type="submit" intent="primary" disabled={!isLoaded || pending}>
              Verify
            </Button>
            <Button
              type="button"
              intent="default"
              disabled={pending}
              onClick={() => {
                setError(null);
                setBackup((b) => !b);
              }}
            >
              {backup ? 'Use the authenticator app code instead' : 'Use a backup code instead'}
            </Button>
          </form>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
