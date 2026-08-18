import { useAuth } from '@clerk/react';
import { Button } from '@hospai/ui-kit';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { spaAuthMode } from '../providers/spa-auth-mode.js';
import { DEMO_UNLOCK_KEY } from '../screens/SignInScreen.js';

function ConfirmLogoutDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="app-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="app-modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <div className="app-modal__panel app-modal__panel--compact">
        <header className="app-modal__head">
          <h2 id="logout-title">Log out?</h2>
        </header>
        <p className="muted">You will be signed out and returned to the sign-in screen.</p>
        <footer className="app-modal__foot app-modal__foot--end">
          <div className="app-modal__actions">
            <Button type="button" intent="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" intent="destructive" data-testid="confirm-logout" onClick={onConfirm}>
              Log out
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ClerkLogoutModal({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useAuth();
  const onConfirm = async () => {
    await signOut();
    window.location.assign('/sign-in');
  };
  return <ConfirmLogoutDialog onCancel={onCancel} onConfirm={() => void onConfirm()} />;
}

function LocalLogoutModal({ onCancel }: { onCancel: () => void }) {
  const onConfirm = () => {
    sessionStorage.removeItem(DEMO_UNLOCK_KEY);
    window.location.assign('/sign-in?logged-out=1');
  };
  return <ConfirmLogoutDialog onCancel={onCancel} onConfirm={onConfirm} />;
}

export function LogoutModal({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const modal = spaAuthMode() === 'clerk' ? (
    <ClerkLogoutModal onCancel={onCancel} />
  ) : (
    <LocalLogoutModal onCancel={onCancel} />
  );

  return createPortal(modal, document.body);
}
