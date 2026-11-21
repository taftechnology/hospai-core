import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postCopilotMessage = vi.fn();
const getOrgEntitlements = vi.fn();
const getProperty = vi.fn();

vi.mock('../client.js', () => ({
  tenant: { orgId: 'org_demo', propertyId: 'prop_demo' },
  asClassified: (err: unknown) =>
    err instanceof ClassifiedError
      ? err.classified
      : { class: 'server_error' as const, status: 500, body: {}, retryAfterMs: null },
  api: {
    postCopilotMessage: (...a: unknown[]) => postCopilotMessage(...a),
    getOrgEntitlements: (...a: unknown[]) => getOrgEntitlements(...a),
    getProperty: (...a: unknown[]) => getProperty(...a),
  },
}));

import { entitlementsQueryKey } from '../shell/use-entitlements.js';
import { COPILOT_SUGGESTED_QUESTIONS, CopilotScreen, copilotMutationKey } from './CopilotScreen.js';

function failure(status: number, body: unknown, cls: 'server_error' | 'client_error' | 'forbidden' = 'server_error') {
  return new ClassifiedError({ class: cls, status, body, retryAfterMs: null } as never);
}

const answerBody = {
  ok: true,
  answer: 'Two stays arrive today.',
  sources: [{ label: 'Arrivals report', href: '/reports/front_office_arrivals' }],
  suggestedActions: [{ label: 'Open arrivals', href: '/arrivals' }],
  toolsUsed: [{ toolId: 'front_office_report', ok: true }],
  overSoftLimit: false,
};

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

let client: QueryClient;
function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/copilot']}>
        <Where />
        <Routes>
          <Route path="/copilot" element={<CopilotScreen />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ask(text: string) {
  fireEvent.change(screen.getByTestId('copilot-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('copilot-ask'));
}

describe('CopilotScreen (R4.16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProperty.mockResolvedValue({ ok: true, property: { propertyId: 'prop_demo', name: 'Lakeview Residency' }, businessDate: '2026-11-21' });
    getOrgEntitlements.mockResolvedValue({
      orgId: 'org_demo',
      version: 2,
      features: { 'pms.core': true, 'ai_ops.enabled': true },
      limits: {},
      computedAt: '2026-11-21T00:00:00.000Z',
    });
    postCopilotMessage.mockResolvedValue(answerBody);
  });
  afterEach(() => cleanup());

  it('opens on a home with the suggested questions and the shortcuts, under one h1', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Copilot' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Ask about this property · Lakeview Residency/)).toBeInTheDocument());
    const suggestions = within(screen.getByTestId('copilot-suggestions')).getAllByRole('button');
    expect(suggestions.map((b) => b.textContent)).toEqual([...COPILOT_SUGGESTED_QUESTIONS]);
    expect(suggestions.map((b) => b.textContent)).toEqual([
      'Who arrives today?',
      'Which folios are still open?',
      'How is housekeeping doing?',
      "Show yesterday's manager report",
      'Why is this exception open?',
    ]);
    const shortcuts = within(screen.getByTestId('copilot-shortcuts')).getAllByRole('link');
    expect(shortcuts.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Reports', '/reports'],
      ['Overview', '/dashboard'],
    ]);
    // Nothing to ask yet: the button is off and says why.
    expect(screen.getByTestId('copilot-ask')).toBeDisabled();
    expect(screen.getByText('Type a question to ask.')).toBeInTheDocument();
  });

  it('a suggested question sends the conversation so far and shows the answer', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Who arrives today?' }));
    await screen.findByText('Two stays arrive today.');
    expect(postCopilotMessage).toHaveBeenCalledTimes(1);
    expect(postCopilotMessage).toHaveBeenCalledWith('prop_demo', [{ role: 'user', content: 'Who arrives today?' }]);
    expect(screen.queryByTestId('copilot-home')).toBeNull();
    expect(screen.getAllByTestId('copilot-turn-user')).toHaveLength(1);
    expect(screen.getAllByTestId('copilot-turn-assistant')).toHaveLength(1);

    // The second question carries the first two turns.
    await ask('And departures?');
    await waitFor(() => expect(postCopilotMessage).toHaveBeenCalledTimes(2));
    expect(postCopilotMessage).toHaveBeenLastCalledWith('prop_demo', [
      { role: 'user', content: 'Who arrives today?' },
      { role: 'assistant', content: 'Two stays arrive today.' },
      { role: 'user', content: 'And departures?' },
    ]);
  });

  it('keeps the conversation in memory only: gone on remount, nothing written to browser storage', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    const first = renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    expect(setLocal).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    first.unmount();

    renderScreen();
    expect(screen.getByTestId('copilot-home')).toBeInTheDocument();
    expect(screen.queryByText('Two stays arrive today.')).toBeNull();
    expect(setLocal).not.toHaveBeenCalled();
    setLocal.mockRestore();
  });

  it('New conversation clears the thread', async () => {
    renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    fireEvent.click(screen.getByTestId('copilot-reset'));
    expect(screen.getByTestId('copilot-home')).toBeInTheDocument();
    expect(screen.queryByTestId('copilot-thread')).toBeNull();
  });

  it('shows the sources as links and the suggested actions as buttons that only navigate', async () => {
    renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    const sources = screen.getByTestId('copilot-sources');
    const link = within(sources).getByRole('link', { name: 'Arrivals report' });
    expect(link).toHaveAttribute('href', '/reports/front_office_arrivals');

    const actions = screen.getByTestId('copilot-actions');
    fireEvent.click(within(actions).getByRole('button', { name: 'Open arrivals' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/arrivals');
    // Navigation is all that happened: the only network call was the question.
    expect(postCopilotMessage).toHaveBeenCalledTimes(1);
  });

  it('does not render a link that is not an in-app path', async () => {
    postCopilotMessage.mockResolvedValue({
      ...answerBody,
      sources: [{ label: 'Elsewhere', href: 'https://evil.example/x' }],
      suggestedActions: [{ label: 'Go', href: '//evil.example' }],
    });
    renderScreen();
    await ask('hello');
    await screen.findByText('Two stays arrive today.');
    expect(screen.queryByRole('link', { name: 'Elsewhere' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull();
  });

  it('says the copilot is not set up on a 503 copilot_unavailable', async () => {
    postCopilotMessage.mockRejectedValue(failure(503, { ok: false, error: 'copilot_unavailable' }));
    renderScreen();
    await ask('Who arrives today?');
    const state = await screen.findByTestId('copilot-not-set-up');
    expect(state).toHaveTextContent('Copilot is not set up');
    expect(state.textContent).not.toMatch(/copilot_unavailable/);
    expect(screen.queryByTestId('copilot-input')).toBeNull();
  });

  it('says the plan is missing on a 402, and before any question when the snapshot says so', async () => {
    postCopilotMessage.mockRejectedValue(failure(402, { error: 'entitlement_required', feature: 'ai_ops.enabled' }, 'client_error'));
    renderScreen();
    await ask('Who arrives today?');
    expect(await screen.findByTestId('copilot-no-plan')).toHaveTextContent('Copilot is not part of your plan');
    cleanup();

    getOrgEntitlements.mockResolvedValue({
      orgId: 'org_demo',
      version: 1,
      features: { 'pms.core': true },
      limits: {},
      computedAt: '2026-11-21T00:00:00.000Z',
    });
    renderScreen();
    expect(await screen.findByTestId('copilot-no-plan')).toBeInTheDocument();
    expect(postCopilotMessage).toHaveBeenCalledTimes(1);
  });

  it('shows the over-limit notice with the answer', async () => {
    postCopilotMessage.mockResolvedValue({ ...answerBody, overSoftLimit: true });
    renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    expect(screen.getByTestId('copilot-over-limit')).toHaveTextContent('past its Copilot message allowance');
  });

  it('shows other errors through the shared copy, not raw codes or bodies', async () => {
    postCopilotMessage.mockRejectedValue(failure(403, { error: 'forbidden', permission: 'copilot:use' }, 'forbidden'));
    renderScreen();
    await ask('Who arrives today?');
    const alert = await screen.findByTestId('copilot-error');
    expect(alert).toHaveTextContent('Requires permission copilot:use. Ask a manager.');
    expect(alert.textContent).not.toMatch(/\{|Request failed/);
    // The input stays usable after an error.
    expect(screen.getByTestId('copilot-input')).toBeEnabled();
  });

  it('keys its queries by tenant and its mutation by property', async () => {
    renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    expect(entitlementsQueryKey('org_demo')).toEqual(['entitlements', 'org_demo']);
    expect(client.getQueryData(entitlementsQueryKey('org_demo'))).toMatchObject({ orgId: 'org_demo' });
    expect(copilotMutationKey('prop_demo')).toEqual(['copilot-message', 'prop_demo']);
    expect(client.getQueryData(['entitlements', 'org_other'])).toBeUndefined();
  });

  it('sends at most twenty turns and cuts each to the per-turn limit', async () => {
    const long = 'z'.repeat(5000);
    postCopilotMessage.mockResolvedValue({ ...answerBody, answer: long });
    renderScreen();
    for (let i = 0; i < 11; i++) {
      await ask(`question ${i}`);
      await waitFor(() => expect(postCopilotMessage).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect(screen.getAllByTestId('copilot-turn-assistant')).toHaveLength(i + 1));
    }
    const sent = postCopilotMessage.mock.calls.at(-1)![1] as Array<{ role: string; content: string }>;
    expect(sent).toHaveLength(20);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'question 10' });
    for (const t of sent) expect(t.content.length).toBeLessThanOrEqual(4000);
  });
});
