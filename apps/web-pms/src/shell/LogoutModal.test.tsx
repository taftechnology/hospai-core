import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn();
const authMode = vi.fn();

vi.mock('@clerk/react', () => ({ useAuth: () => ({ signOut }) }));
vi.mock('../providers/spa-auth-mode.js', () => ({ spaAuthMode: () => authMode() }));

import { copilotHistoryKey } from '../screens/copilot-history.js';
import { LogoutModal } from './LogoutModal.js';

function seed() {
  window.localStorage.setItem(copilotHistoryKey('u1', 'p1'), '[]');
  window.localStorage.setItem(copilotHistoryKey('u1', 'p2'), '[]');
  window.localStorage.setItem(copilotHistoryKey('u2', 'p1'), '[]');
  window.localStorage.setItem('hospai.theme', 'dark');
}

describe('LogoutModal and the saved Copilot conversations', () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } });
    signOut.mockImplementation(async () => {
      // History must already be gone when Clerk signs out.
      expect(Object.keys({ ...window.localStorage }).filter((k) => k.startsWith('hospai.copilot.history.'))).toEqual([]);
    });
  });
  afterEach(() => cleanup());

  it('removes every hospai.copilot.history. key before Clerk sign-out and keeps the theme', async () => {
    authMode.mockReturnValue('clerk');
    seed();
    render(<LogoutModal onCancel={() => undefined} />);
    fireEvent.click(screen.getByTestId('confirm-logout'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(Object.keys({ ...window.localStorage })).toEqual(['hospai.theme']);
    expect(window.localStorage.getItem('hospai.theme')).toBe('dark');
  });

  it('does the same in the local sign-out path', () => {
    authMode.mockReturnValue('engineer');
    seed();
    render(<LogoutModal onCancel={() => undefined} />);
    fireEvent.click(screen.getByTestId('confirm-logout'));
    expect(assign).toHaveBeenCalledWith('/sign-in?logged-out=1');
    expect(Object.keys({ ...window.localStorage })).toEqual(['hospai.theme']);
  });

  it('leaves history alone when the clerk cancels', () => {
    authMode.mockReturnValue('clerk');
    seed();
    const onCancel = vi.fn();
    render(<LogoutModal onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(4);
  });
});
