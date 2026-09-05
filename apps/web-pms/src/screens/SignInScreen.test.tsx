/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { SpaAuthMode } from '../providers/spa-auth-mode.js';
import { SignInScreen } from './SignInScreen.js';

const { mode, createMock, setActiveMock, isLoadedMock } = vi.hoisted(() => ({
  mode: { value: 'misconfigured' as SpaAuthMode },
  createMock: vi.fn(),
  setActiveMock: vi.fn(),
  isLoadedMock: { value: true },
}));

vi.mock('../providers/spa-auth-mode.js', () => ({
  spaAuthMode: () => mode.value,
  demoGateEmail: () => 'demo@hospai.local',
  demoGatePassword: () => 'secret',
}));

vi.mock('@clerk/react/legacy', () => ({
  useSignIn: () => ({
    isLoaded: isLoadedMock.value,
    signIn: { create: createMock },
    setActive: setActiveMock,
  }),
}));

function renderSignIn(initialPath = '/sign-in') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/sign-in" element={<SignInScreen />} />
        <Route path="/board" element={<p data-testid="board-landed">Board</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SignInScreen', () => {
  beforeEach(() => {
    mode.value = 'misconfigured';
    createMock.mockReset();
    setActiveMock.mockReset();
    isLoadedMock.value = true;
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('engineer mode redirects to /board without sign-in form', () => {
    mode.value = 'engineer';
    renderSignIn();
    expect(screen.getByTestId('board-landed')).toBeTruthy();
    expect(screen.queryByTestId('sign-in')).toBeNull();
  });

  it('engineer mode after logout shows the sign-in form', () => {
    mode.value = 'engineer';
    window.history.pushState({}, '', '/sign-in?logged-out=1');
    renderSignIn();
    expect(screen.getByTestId('sign-in')).toBeTruthy();
    expect(screen.getByTestId('sign-in-email')).toBeTruthy();
    expect(screen.queryByTestId('board-landed')).toBeNull();
  });

  it('engineer mode badges the screen and prefills demo credentials', () => {
    mode.value = 'engineer';
    window.history.pushState({}, '', '/sign-in?logged-out=1');
    renderSignIn();
    expect(screen.getByTestId('engineer-mode-badge').textContent).toContain('Engineering mode');
    expect((screen.getByTestId('sign-in-email') as HTMLInputElement).value).toBe(
      'demo@hospai.local',
    );
    expect((screen.getByTestId('sign-in-password') as HTMLInputElement).value).toBe('demo');
  });

  it('engineer mode sign-in form accepts any credentials', async () => {
    mode.value = 'engineer';
    window.history.pushState({}, '', '/sign-in?logged-out=1');
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'anyone@example.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('board-landed')).toBeTruthy();
    });
  });

  it('misconfigured shows card without submit', () => {
    renderSignIn();
    expect(screen.getByTestId('sign-in')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByText(/HospAI/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Sign-in is not configured.')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-submit')).toBeNull();
    expect(document.body.textContent).not.toMatch(/x-dev-actor|user_owner|vite_|clerk/i);
  });

  it('renders the branded responsive sign-in chrome', () => {
    const screenRoot = renderSignIn().getByTestId('sign-in');

    expect(screenRoot.querySelector('.sign-in__brand')).toBeTruthy();
    expect(screenRoot.querySelector('.sign-in__content')).toBeTruthy();
    expect(screenRoot.querySelector('.sign-in__form-card')).toBeTruthy();
    expect(screenRoot.querySelector('.sign-in__support-copy')).toBeTruthy();
  });

  it('password-gate wrong password shows alert', async () => {
    mode.value = 'password-gate';
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'demo@hospai.local' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Email or password is wrong.');
    });
    expect(screen.getByTestId('sign-in')).toBeTruthy();
  });

  it('password-gate correct credentials unlock and navigate', async () => {
    mode.value = 'password-gate';
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: ' DEMO@hospai.local ' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(sessionStorage.getItem('hospai.demo-unlock')).toBe('1');
      expect(screen.getByTestId('board-landed')).toBeTruthy();
    });
  });

  it('password-gate with existing unlock skips form', () => {
    mode.value = 'password-gate';
    sessionStorage.setItem('hospai.demo-unlock', '1');
    renderSignIn();
    expect(screen.getByTestId('board-landed')).toBeTruthy();
    expect(screen.queryByTestId('sign-in-email')).toBeNull();
  });

  it('password-gate form has expected testids and classes', () => {
    mode.value = 'password-gate';
    renderSignIn();
    expect(screen.getByTestId('sign-in-email').getAttribute('type')).toBe('email');
    expect(screen.getByTestId('sign-in-password').getAttribute('type')).toBe('password');
    expect(screen.getByTestId('sign-in-email').getAttribute('autocomplete')).toBe('username');
    expect(screen.getByTestId('sign-in-password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByTestId('sign-in-submit').classList.contains('btn-primary')).toBe(true);
    expect(document.body.textContent).not.toMatch(/x-dev-actor|user_owner|vite_|clerk/i);
  });

  it('clerk complete sign-in calls setActive and navigates', async () => {
    mode.value = 'clerk';
    createMock.mockResolvedValue({ status: 'complete', createdSessionId: 'sess_1' });
    setActiveMock.mockResolvedValue(undefined);
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'owner@demo.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(setActiveMock).toHaveBeenCalledWith({ session: 'sess_1' });
      expect(screen.getByTestId('board-landed')).toBeTruthy();
    });
  });

  it('T28: clerk needs_second_factor omits demo user copy', async () => {
    mode.value = 'clerk';
    createMock.mockResolvedValue({ status: 'needs_second_factor' });
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'owner@demo.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('This account needs a second step.');
    });
    expect(setActiveMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in')).toBeTruthy();
  });

  it('clerk other non-complete status shows generic error', async () => {
    mode.value = 'clerk';
    createMock.mockResolvedValue({ status: 'needs_first_factor' });
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'owner@demo.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not sign in.');
    });
  });

  it('clerk rejected error shows clerk message', async () => {
    mode.value = 'clerk';
    createMock.mockRejectedValue({ errors: [{ message: 'Password is incorrect.' }] });
    renderSignIn();
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'owner@demo.com' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Password is incorrect.');
    });
  });

  it('clerk disables submit while not loaded', () => {
    mode.value = 'clerk';
    isLoadedMock.value = false;
    renderSignIn();
    expect((screen.getByTestId('sign-in-submit') as HTMLButtonElement).disabled).toBe(true);
  });
});
