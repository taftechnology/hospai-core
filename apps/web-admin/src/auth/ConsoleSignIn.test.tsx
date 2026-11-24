import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignOutControl } from './AuthGate.js';
import { accountPageUrl, ConsoleSignIn } from './ConsoleSignIn.js';

const { createMock, attemptMock, setActiveMock, signOutMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  attemptMock: vi.fn(),
  setActiveMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('@clerk/react/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: { create: createMock, attemptSecondFactor: attemptMock },
    setActive: setActiveMock,
  }),
}));
vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: signOutMock }),
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: vi.fn() }),
}));

const clerkError = (code: string, status = 422) => Object.assign(new Error(code), { status, errors: [{ code }] });

async function submitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'op@example.test');
  await user.type(screen.getByLabelText('Password'), 'pw');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function toCodeStep(user: ReturnType<typeof userEvent.setup>) {
  createMock.mockResolvedValue({ status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'totp' }, { strategy: 'backup_code' }] });
  render(<ConsoleSignIn />);
  await submitPassword(user);
  await screen.findByLabelText('6-digit code from your authenticator app');
}

beforeEach(() => {
  createMock.mockReset();
  attemptMock.mockReset();
  setActiveMock.mockReset();
  signOutMock.mockReset();
});
afterEach(cleanup);

describe('ConsoleSignIn', () => {
  it('has one h1 and the right autocomplete hints', () => {
    render(<ConsoleSignIn />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to HospAI Ops');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('password, then totp code, then activates the session', async () => {
    const user = userEvent.setup();
    await toCodeStep(user);
    expect(createMock).toHaveBeenCalledWith({ identifier: 'op@example.test', password: 'pw' });
    const code = screen.getByLabelText('6-digit code from your authenticator app');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('type', 'tel');
    attemptMock.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' });
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(setActiveMock).toHaveBeenCalledWith({ session: 'sess_1' }));
    expect(attemptMock).toHaveBeenCalledWith({ strategy: 'totp', code: '123456' });
  });

  it('backup-code toggle sends backup_code, and toggles back', async () => {
    const user = userEvent.setup();
    await toCodeStep(user);
    await user.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    attemptMock.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_2' });
    await user.type(screen.getByLabelText('Backup code'), 'abcd1234');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(attemptMock).toHaveBeenCalledWith({ strategy: 'backup_code', code: 'abcd1234' }));
    await user.click(screen.getByRole('button', { name: 'Use the authenticator app code instead' }));
    expect(screen.getByLabelText('6-digit code from your authenticator app')).toBeInTheDocument();
  });

  it('wrong password and unknown email read the same', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce(clerkError('form_password_incorrect'));
    render(<ConsoleSignIn />);
    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    createMock.mockRejectedValueOnce(clerkError('form_identifier_not_found'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('wrong code shows the code message; rate limit says wait', async () => {
    const user = userEvent.setup();
    await toCodeStep(user);
    attemptMock.mockRejectedValueOnce(clerkError('form_code_incorrect'));
    await user.type(screen.getByLabelText('6-digit code from your authenticator app'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work. Try the current code from your authenticator app.");
    attemptMock.mockRejectedValueOnce(clerkError('too_many_requests', 429));
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute and try again.'));
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('an unknown error shows a plain sentence, never JSON', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValue({ status: 500, errors: [{ code: 'weird', message: '{"x":1}' }] });
    render(<ConsoleSignIn />);
    await submitPassword(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sign-in did not work.');
    expect(alert.textContent).not.toMatch(/[{}]|Request failed/);
  });

  it('complete without a second factor asks the operator to finish two-step setup and does not activate', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_x' });
    render(<ConsoleSignIn />);
    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('has not finished setting up two-step verification');
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it('an unsupported status or second factor shows the same setup alert', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({ status: 'needs_new_password' });
    render(<ConsoleSignIn />);
    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('two-step verification');
    cleanup();
    createMock.mockResolvedValue({ status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'phone_code' }] });
    render(<ConsoleSignIn />);
    await submitPassword(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('two-step verification');
  });

  it('disables the submit button while a request is in flight', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => undefined;
    createMock.mockReturnValue(new Promise((r) => (release = r)));
    render(<ConsoleSignIn />);
    await submitPassword(user);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    release({ status: 'needs_second_factor', supportedSecondFactors: [{ strategy: 'totp' }] });
    await screen.findByLabelText('6-digit code from your authenticator app');
  });
});

describe('accountPageUrl', () => {
  it('derives the dev Account Portal from the publishable key', () => {
    const key = `pk_test_${btoa('peaceful-lemur-1879.clerk.accounts.dev$')}`;
    expect(accountPageUrl(key)).toBe('https://peaceful-lemur-1879.accounts.dev/user');
  });
  it('derives the production portal, and gives up on anything else', () => {
    expect(accountPageUrl(`pk_live_${btoa('clerk.example.com$')}`)).toBe('https://accounts.example.com/user');
    expect(accountPageUrl(undefined)).toBeNull();
    expect(accountPageUrl('pk_test_!!!')).toBeNull();
  });
});

describe('SignOutControl', () => {
  it('Sign out calls Clerk signOut', async () => {
    const user = userEvent.setup();
    render(<SignOutControl mode="clerk" />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});
