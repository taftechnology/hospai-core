import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { opsKeys } from '../api/keys.js';
import { makeQueryClient } from '../App.js';
import { customerDetail, customerRow, installFetch, renderAt } from './test-utils.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = (n: number, hasMore: boolean, rows: number[]) => ({
  body: { ok: true, page: n, hasMore, customers: rows.map(customerRow) },
});

describe('Customers', () => {
  it('renders the list and paginates', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin', (c) => {
      if (c.path.startsWith('/customers?')) {
        return c.path.includes('page=2') ? page(2, false, [3]) : page(1, true, [1, 2]);
      }
      return undefined;
    });
    renderAt('/customers');

    expect(await screen.findByRole('link', { name: 'Customer 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customer 2' })).toBeInTheDocument();
    expect(screen.getByText('1 / 5')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customers');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('link', { name: 'Customer 3' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customer 1' })).toBeNull();
    expect(calls.some((c) => c.path === '/customers?query=&page=2')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('searches, and tells "no match" apart from "no customers"', async () => {
    const user = userEvent.setup();
    installFetch('ops_admin', (c) =>
      c.path.startsWith('/customers?') ? { body: { ok: true, page: 1, hasMore: false, customers: [] } } : undefined,
    );
    renderAt('/customers');
    expect(await screen.findByText('No customers yet')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'grand');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No customer matches that search')).toBeInTheDocument();
  });

  it('shows a failure with a retry, in plain words', async () => {
    installFetch('ops_admin', (c) =>
      c.path.startsWith('/customers?') ? { status: 500, body: { error: 'internal_error' } } : undefined,
    );
    renderAt('/customers');
    expect(await screen.findByText('Could not load this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('internal_error');
  });
});

describe('viewer role', () => {
  it('hides Operators and every write button, and sends no operator list request', async () => {
    const { calls } = installFetch('ops_viewer', (c) =>
      c.path === '/customers/org_a' ? { body: customerDetail() } : undefined,
    );
    renderAt('/customers/org_a');
    expect(await screen.findByRole('heading', { level: 1, name: 'Group A' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Operators' })).toBeNull();
    for (const name of ['Add hotel', 'Change plan', 'Set add-on', 'Add owner', 'Suspend', 'Reinstate']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText(/read-only access/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/operators')).toBe(false);
  });

  it('hides Create customer on the list, and the Operators route shows no data', async () => {
    const { calls } = installFetch('ops_viewer', (c) =>
      c.path.startsWith('/customers?') ? page(1, false, [1]) : undefined,
    );
    const first = renderAt('/customers');
    await screen.findByRole('link', { name: 'Customer 1' });
    expect(screen.queryByRole('link', { name: 'Create customer' })).toBeNull();
    first.unmount();
    renderAt('/operators');
    expect(await screen.findByText('Ops admins only')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/operators')).toBe(false);
  });

  it('an admin sees Operators and the write buttons', async () => {
    installFetch('ops_admin', (c) => (c.path === '/customers/org_a' ? { body: customerDetail() } : undefined));
    renderAt('/customers/org_a');
    expect(await screen.findByRole('link', { name: 'Operators' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add hotel' })).toBeInTheDocument();
  });
});

describe('write forms', () => {
  it('refuse an empty reason client-side, then send reason, ticket and a clientKey', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin', (c) => (c.path === '/customers/org_a' ? { body: customerDetail() } : undefined));
    renderAt('/customers/org_a');
    await user.click(await screen.findByRole('button', { name: 'Change plan' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('New plan code'), 'growth');
    await user.click(within(dialog).getByRole('button', { name: 'Change plan' }));

    expect(await within(dialog).findByText(/Enter a reason/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Reason'), '  Upgrade to add hotel 2  ');
    await user.type(within(dialog).getByLabelText('Ticket reference (optional)'), 'T-42');
    await user.click(within(dialog).getByRole('button', { name: 'Change plan' }));

    expect(await within(dialog).findByText(/The plan is changed/)).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/customers/org_a/plan');
    expect(posts[0]!.body).toMatchObject({ planCode: 'growth', reason: 'Upgrade to add hotel 2', ticketRef: 'T-42' });
    expect(typeof posts[0]!.body!.clientKey).toBe('string');
    expect((posts[0]!.body!.clientKey as string).length).toBeGreaterThan(8);
  });

  it('a reason longer than 500 characters is refused client-side', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin', (c) => (c.path === '/customers/org_a' ? { body: customerDetail() } : undefined));
    renderAt('/customers/org_a');
    await user.click(await screen.findByRole('button', { name: 'Add owner' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Email'), 'owner@example.test');
    // The textarea caps input at 500; setting a longer value directly is still refused.
    const reason = within(dialog).getByLabelText('Reason') as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(500);
    await user.click(within(dialog).getByRole('button', { name: 'Add owner' }));
    expect(await within(dialog).findByText(/Enter a reason/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reuses the clientKey when the same submit is retried after a failure, and takes a new one when edited', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = installFetch('ops_admin', (c) => {
      if (c.path === '/customers/org_a') return { body: customerDetail() };
      if (c.method === 'POST') {
        attempts += 1;
        return attempts === 1 ? { status: 500, body: { error: 'internal_error' } } : undefined;
      }
      return undefined;
    });
    renderAt('/customers/org_a');
    await user.click(await screen.findByRole('button', { name: 'Add owner' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Email'), 'owner@example.test');
    await user.type(within(dialog).getByLabelText('Reason'), 'First owner');
    await user.click(within(dialog).getByRole('button', { name: 'Add owner' }));
    expect(await within(dialog).findByText('Not changed')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add owner' }));
    await within(dialog).findByText(/now an owner/);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body!.clientKey).toBe(posts[0]!.body!.clientKey);
  });

  it('shows a failure through Alert with classified copy, never the raw body', async () => {
    const user = userEvent.setup();
    installFetch('ops_admin', (c) => {
      if (c.path === '/customers/org_a') return { body: customerDetail() };
      if (c.method === 'POST') return { status: 422, body: { error: 'limit_exceeded', featureKey: 'pms.properties.limit' } };
      return undefined;
    });
    renderAt('/customers/org_a');
    await user.click(await screen.findByRole('button', { name: 'Add hotel' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Hotel name'), 'Second hotel');
    await user.type(within(dialog).getByLabelText('Time zone'), 'Asia/Kolkata');
    await user.type(within(dialog).getByLabelText('Currency'), 'inr');
    await user.type(within(dialog).getByLabelText('Reason'), 'Hotel 2');
    await user.click(within(dialog).getByRole('button', { name: 'Add hotel' }));
    const alert = await within(dialog).findByText(/hotel limit is reached/);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(dialog.textContent).not.toContain('limit_exceeded');
    expect(dialog.textContent).not.toContain('featureKey');
  });

  it('Suspend asks for confirmation first, and sends nothing until confirmed', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin', (c) => (c.path === '/customers/org_a' ? { body: customerDetail() } : undefined));
    const client = makeQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderAt('/customers/org_a', client);
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Suspend customer' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Cancel leaves nothing behind.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    const again = await screen.findByRole('dialog');
    await user.type(within(again).getByLabelText('Reason'), 'Unpaid invoice');
    await user.click(within(again).getByRole('button', { name: 'Suspend customer' }));
    await within(again).findByText(/The customer is suspended/);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/customers/org_a/suspend');

    // The consumers' own keys are what gets invalidated.
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(opsKeys.customer('org_a'));
    expect(keys).toContainEqual(opsKeys.customersAll());
    expect(keys).toContainEqual(opsKeys.actionsAll());
  });

  it('create customer refuses an empty reason and posts the whole form', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin');
    renderAt('/customers/new');
    expect(await screen.findByRole('heading', { level: 1, name: 'Create customer' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer name'), 'New Group');
    await user.type(screen.getByLabelText('Plan code'), 'starter');
    await user.click(screen.getByRole('button', { name: 'Create customer' }));
    expect(await screen.findByText(/Enter a reason/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.type(screen.getByLabelText('Reason'), 'Signed contract');
    await user.click(screen.getByRole('button', { name: 'Create customer' }));
    expect(await screen.findByText(/The customer is created/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/customers');
    expect(post.body).toMatchObject({ name: 'New Group', planCode: 'starter', reason: 'Signed contract' });
    expect(post.body!.orgId).toMatch(/^org_/);
  });
});

describe('Operators (admin)', () => {
  const operators = [
    { operatorId: 'op_me', email: 'me@example.test', displayName: 'Test Operator', role: 'ops_admin', status: 'active' },
    { operatorId: 'op_2', email: 'two@example.test', displayName: 'Two', role: 'ops_viewer', status: 'active' },
  ];

  it('Disable is destructive and asks for confirmation', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_admin', (c) => (c.path === '/operators' ? { body: { ok: true, operators } } : undefined));
    renderAt('/operators');
    const row = (await screen.findByText('Two')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Disable operator' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText('Reason'), 'Left the company');
    await user.click(within(dialog).getByRole('button', { name: 'Disable operator' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/operators/op_2/status');
    expect(post.body).toMatchObject({ status: 'disabled', reason: 'Left the company' });
  });
});

describe('Hotel detail and Operator log', () => {
  it('shows counts and dates only', async () => {
    installFetch('ops_viewer', (c) =>
      c.path === '/properties/prop_a/health'
        ? {
            body: {
              ok: true,
              propertyId: 'prop_a',
              orgId: 'org_a',
              businessDate: '2026-11-24',
              lastNightAudit: { businessDate: '2026-11-23', status: 'COMPLETED', exceptionCount: 2 },
              oldestOutboxAgeMs: 120_000,
              roomCount: 40,
              roomTypeCount: 4,
              activeMemberCount: 7,
              schemaVersion: 58,
            },
          }
        : undefined,
    );
    renderAt('/customers/org_a/hotels/prop_a');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hotel health' })).toBeInTheDocument();
    expect(await screen.findByText('2026-11-24')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('2 min')).toBeInTheDocument();
  });

  it('filters the log by customer and operator', async () => {
    const user = userEvent.setup();
    const { calls } = installFetch('ops_viewer', (c) =>
      c.path.startsWith('/operator-actions')
        ? {
            body: {
              ok: true,
              page: 1,
              hasMore: false,
              actions: [
                {
                  actionId: 'act_1',
                  operatorId: 'op_2',
                  operatorName: 'Two',
                  commandId: 'ops.set_plan',
                  orgId: 'org_a',
                  propertyId: null,
                  reason: 'Upgrade',
                  ticketRef: 'T-9',
                  before: { planCode: 'starter' },
                  after: { planCode: 'growth' },
                  createdAt: Date.UTC(2026, 10, 2),
                },
              ],
            },
          }
        : undefined,
    );
    renderAt('/operator-log');
    expect(await screen.findByText('ops.set_plan')).toBeInTheDocument();
    expect(screen.getByText('planCode: starter to growth')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Customer id'), 'org_a');
    await user.type(screen.getByLabelText('Operator id'), 'op_2');
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('orgId=org_a') && c.path.includes('operatorId=op_2'))).toBe(true));
  });
});

describe('sign-in failures', () => {
  it('a non-operator gets a plain message, not the app', async () => {
    installFetch('ops_admin', (c) => (c.path === '/me' ? { status: 403, body: { error: 'not_an_operator' } } : undefined));
    renderAt('/customers');
    expect(await screen.findByText('You cannot use the Ops Console')).toBeInTheDocument();
    expect(screen.getByText('This account is not a HospAI operator.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('a missing second factor says so', async () => {
    installFetch('ops_admin', (c) => (c.path === '/me' ? { status: 401, body: { error: 'mfa_required' } } : undefined));
    renderAt('/customers');
    expect(await screen.findByText(/second factor is required/)).toBeInTheDocument();
  });
});
