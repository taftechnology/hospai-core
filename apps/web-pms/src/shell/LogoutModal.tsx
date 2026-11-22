import { useAuth } from '@clerk/react';
import { Button, Dialog } from '@hospai/ui-kit';
import { spaAuthMode } from '../providers/spa-auth-mode.js';
import { clearAllCopilotHistory } from '../screens/copilot-history.js';
import { DEMO_UNLOCK_KEY } from '../screens/SignInScreen.js';

function ConfirmLogoutDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      title="Log out?"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" intent="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" intent="destructive" data-testid="confirm-logout" onClick={onConfirm}>
            Log out
          </Button>
        </>
      }
    >
      <p className="muted">You will be signed out and returned to the sign-in screen.</p>
    </Dialog>
  );
}

function ClerkLogoutModal({ onCancel }: { onCancel: () => void }) {
  const { signOut } = useAuth();
  const onConfirm = async () => {
    clearAllCopilotHistory();
    await signOut();
    window.location.assign('/sign-in');
  };
  return <ConfirmLogoutDialog onCancel={onCancel} onConfirm={() => void onConfirm()} />;
}

function LocalLogoutModal({ onCancel }: { onCancel: () => void }) {
  const onConfirm = () => {
    clearAllCopilotHistory();
    sessionStorage.removeItem(DEMO_UNLOCK_KEY);
    window.location.assign('/sign-in?logged-out=1');
  };
  return <ConfirmLogoutDialog onCancel={onCancel} onConfirm={onConfirm} />;
}

export function LogoutModal({ onCancel }: { onCancel: () => void }) {
  return spaAuthMode() === 'clerk' ? (
    <ClerkLogoutModal onCancel={onCancel} />
  ) : (
    <LocalLogoutModal onCancel={onCancel} />
  );
}
