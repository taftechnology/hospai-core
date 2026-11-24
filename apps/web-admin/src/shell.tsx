import { Badge, EmptyState, PageHeader, Skeleton } from '@hospai/ui-kit';
import { NavLink, Outlet } from 'react-router';
import { opsErrorMessage } from './api/client.js';
import { useMe } from './api/hooks.js';
import { OperatorProvider, useOperator } from './auth/OperatorContext.js';
import { SignOutControl } from './auth/AuthGate.js';

function Chrome() {
  const me = useOperator();
  return (
    <div className="ops-shell">
      <header className="ops-top">
        <span className="ops-brand">HospAI Ops Console</span>
        <nav className="ops-nav" aria-label="Ops Console">
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/operator-log">Operator log</NavLink>
          {me.role === 'ops_admin' ? <NavLink to="/operators">Operators</NavLink> : null}
        </nav>
        <div className="ops-who">
          <span>{me.displayName}</span>
          <Badge rung={me.role === 'ops_admin' ? 'informational' : 'neutral'}>{me.role}</Badge>
          <SignOutControl />
        </div>
      </header>
      <main className="ops-main">
        <Outlet />
      </main>
    </div>
  );
}

/** Resolves the signed-in operator once, then renders the chrome. A non-operator gets a plain message. */
export function Shell() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="ops-centered">
        <Skeleton lines={3} label="Signing you in" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="ops-centered">
        <PageHeader title="HospAI Ops Console" />
        <EmptyState
          kind="error"
          title="You cannot use the Ops Console"
          description={opsErrorMessage(me.error, 'Signing in failed. Try again.')}
        />
      </div>
    );
  }
  return (
    <OperatorProvider operator={me.data}>
      <Chrome />
    </OperatorProvider>
  );
}
