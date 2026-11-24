import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { classifiedUserMessage, ACCOUNT_SUSPENDED_MESSAGE } from '../copy/classified-user-message.js';
import { SuspendedBand } from './AppShell.js';
import { BandHost, BandProvider } from './Band.js';
import { TenantSwitcherContext, type TenantSwitcherValue } from './tenant-context.js';

function renderBand(status: 'active' | 'suspended' | undefined) {
  const value: TenantSwitcherValue = {
    orgs: [
      { orgId: 'org_a', name: 'A', status, multiProperty: false, properties: [{ propertyId: 'p_a', name: 'A', timeZone: 'UTC' }] },
      { orgId: 'org_b', name: 'B', status: 'suspended', multiProperty: false, properties: [{ propertyId: 'p_b', name: 'B', timeZone: 'UTC' }] },
    ],
    active: { orgId: 'org_a', propertyId: 'p_a' },
    switchTenant: () => {},
  };
  render(
    <TenantSwitcherContext.Provider value={value}>
      <BandProvider>
        <BandHost />
        <SuspendedBand />
      </BandProvider>
    </TenantSwitcherContext.Provider>,
  );
}

describe('suspended band (R7.1 §7)', () => {
  afterEach(() => cleanup());

  it('shows the shared message when the active org is suspended', () => {
    renderBand('suspended');
    const band = screen.getByTestId('org-suspended-band');
    expect(band).toHaveTextContent('This account is suspended. Contact HospAI.');
    expect(band).toHaveAttribute('role', 'alert');
  });

  it('is absent for an active org (another org being suspended does not matter) and for an older server', () => {
    renderBand('active');
    expect(screen.queryByTestId('org-suspended-band')).toBeNull();
    cleanup();
    renderBand(undefined);
    expect(screen.queryByTestId('org-suspended-band')).toBeNull();
  });

  it('classifiedUserMessage maps a tenant_suspended 403 to the same words', () => {
    const message = classifiedUserMessage(
      { class: 'client_error', status: 403, body: { error: 'tenant_suspended' }, retryAfterMs: null },
      { fallback: 'x' },
    );
    expect(message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
  });
});
