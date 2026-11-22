import { ClassifiedError } from '@hospai/client-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postCopilotMessage = vi.fn();
const getOrgEntitlements = vi.fn();
const getProperty = vi.fn();
const getMe = vi.fn();

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
    getMe: (...a: unknown[]) => getMe(...a),
  },
}));

import { copilotHistoryKey, type StoredConversation } from './copilot-history.js';
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

const HISTORY_TIME = Date.now() - 2 * 24 * 60 * 60 * 1000;

function savedChat(id: string, question: string): StoredConversation {
  return {
    id,
    startedAt: HISTORY_TIME - 1000,
    updatedAt: HISTORY_TIME,
    turns: [
      { role: 'user', content: question, sources: [], suggestedActions: [] },
      {
        role: 'assistant',
        content: 'Three folios are open.',
        sources: [{ label: 'Folios report', href: '/reports/open_folios' }],
        suggestedActions: [{ label: 'Open folios', href: '/folios' }],
      },
    ],
  };
}

function seedHistory(list: StoredConversation[]) {
  window.localStorage.setItem(copilotHistoryKey('user_a', 'prop_demo'), JSON.stringify(list));
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
    getMe.mockResolvedValue({ ok: true, orgId: 'org_demo', propertyId: 'prop_demo', userId: 'user_a', role: 'staff', permissions: [], orgPermissions: [] });
    window.localStorage.clear();
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

  it('renders bold and bullets in an assistant answer but keeps a user turn literal', async () => {
    postCopilotMessage.mockResolvedValue({ ...answerBody, answer: '**Dirty:**\n- a\n- b' });
    renderScreen();
    fireEvent.change(screen.getByTestId('copilot-input'), { target: { value: 'Show **x** please' } });
    fireEvent.click(screen.getByTestId('copilot-ask'));
    const reply = await screen.findByTestId('copilot-turn-assistant');
    expect(within(reply).getByText('Dirty:').tagName).toBe('STRONG');
    expect(Array.from(reply.querySelectorAll('.copilot-answer li')).map((li) => li.textContent)).toEqual(['a', 'b']);
    expect(reply.textContent).not.toContain('**');
    const user = screen.getByTestId('copilot-turn-user');
    expect(user.textContent).toContain('Show **x** please');
    expect(user.querySelector('strong')).toBeNull();
  });

  it('writes nothing before an answer and exactly one per-user, per-property key after it', async () => {
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    renderScreen();
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(setLocal).not.toHaveBeenCalled();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    await waitFor(() => expect(setLocal).toHaveBeenCalled());
    expect(Object.keys({ ...window.localStorage })).toEqual([copilotHistoryKey('user_a', 'prop_demo')]);
    expect(copilotHistoryKey('user_a', 'prop_demo')).toBe('hospai.copilot.history.v1.user_a.prop_demo');
    expect(window.sessionStorage.length).toBe(0);
    const stored = JSON.parse(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))!) as StoredConversation[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(stored[0]!.turns[1]!.sources).toEqual(answerBody.sources);
    expect(JSON.stringify(stored)).not.toContain('toolsUsed');
    setLocal.mockRestore();
  });

  it('says conversations are saved in this browser only, for 30 days, and deleted at sign-out', () => {
    renderScreen();
    const home = screen.getByTestId('copilot-home');
    expect(home).toHaveTextContent('saved in this browser only');
    expect(home).toHaveTextContent('30 days');
    expect(home).toHaveTextContent('deleted when you sign out');
    expect(home.textContent).not.toMatch(/not saved/);
  });

  it('shows "Earlier conversations" only when another saved conversation exists', async () => {
    renderScreen();
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByTestId('copilot-history-open')).toBeNull();
    // The conversation on screen is not "earlier": still hidden after the first answer.
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    expect(screen.queryByTestId('copilot-history-open')).toBeNull();
    fireEvent.click(screen.getByTestId('copilot-reset'));
    expect(await screen.findByTestId('copilot-history-open')).toHaveTextContent('Earlier conversations');
  });

  it('opens a saved chat with its turns, sources and next steps, and lets the clerk keep asking', async () => {
    seedHistory([savedChat('old1', 'Which folios are still open?')]);
    renderScreen();
    fireEvent.click(await screen.findByTestId('copilot-history-open'));
    const row = within(screen.getByTestId('copilot-history-list')).getByTestId('copilot-history-row');
    expect(row).toHaveTextContent('Which folios are still open?');
    expect(row).toHaveTextContent('1 question');
    expect(row).toHaveTextContent(/\d{1,2} \w{3} \d{4}/);
    fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(screen.queryByTestId('copilot-history-dialog')).toBeNull();
    expect(screen.getAllByTestId('copilot-turn-user')[0]).toHaveTextContent('Which folios are still open?');
    expect(screen.getByText('Three folios are open.')).toBeInTheDocument();
    expect(within(screen.getByTestId('copilot-sources')).getByRole('link', { name: 'Folios report' })).toHaveAttribute('href', '/reports/open_folios');
    expect(within(screen.getByTestId('copilot-actions')).getByRole('button', { name: 'Open folios' })).toBeInTheDocument();
    // Opening alone does not re-save or reorder.
    expect(JSON.parse(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))!)[0].updatedAt).toBe(HISTORY_TIME);

    await ask('And departures?');
    await waitFor(() => expect(postCopilotMessage).toHaveBeenCalledTimes(1));
    expect(postCopilotMessage).toHaveBeenCalledWith('prop_demo', [
      { role: 'user', content: 'Which folios are still open?' },
      { role: 'assistant', content: 'Three folios are open.' },
      { role: 'user', content: 'And departures?' },
    ]);
    await screen.findByText('Two stays arrive today.');
    await waitFor(() => {
      const list = JSON.parse(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))!) as StoredConversation[];
      expect(list).toHaveLength(1);
      expect(list[0]!.turns).toHaveLength(4);
    });
  });

  it('deletes one saved conversation only after confirming', async () => {
    seedHistory([savedChat('old1', 'First question'), savedChat('old2', 'Second question')]);
    renderScreen();
    fireEvent.click(await screen.findByTestId('copilot-history-open'));
    const rows = screen.getAllByTestId('copilot-history-row');
    const first = rows.find((r) => r.textContent?.includes('First question'))!;
    fireEvent.click(within(first).getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('heading', { name: 'Delete this conversation?' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))!)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByTestId('copilot-history-row')).toHaveLength(2);
    fireEvent.click(within(screen.getAllByTestId('copilot-history-row')[0]!).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByTestId('copilot-history-confirm'));
    expect(screen.getAllByTestId('copilot-history-row')).toHaveLength(1);
    const left = JSON.parse(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))!) as StoredConversation[];
    expect(left).toHaveLength(1);
  });

  it('deletes all saved conversations after confirming and shows the empty state', async () => {
    seedHistory([savedChat('old1', 'First question'), savedChat('old2', 'Second question')]);
    renderScreen();
    fireEvent.click(await screen.findByTestId('copilot-history-open'));
    fireEvent.click(screen.getByTestId('copilot-history-delete-all'));
    expect(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))).not.toBeNull();
    fireEvent.click(screen.getByTestId('copilot-history-confirm'));
    expect(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))).toBeNull();
    expect(screen.getByText('No earlier conversations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('copilot-history-open')).toBeNull();
  });

  it('keeps the history on remount, and removes another user\'s history for this sign-in', async () => {
    window.localStorage.setItem(copilotHistoryKey('user_b', 'prop_demo'), JSON.stringify([savedChat('theirs', 'Their question')]));
    window.localStorage.setItem('hospai.theme', 'dark');
    const first = renderScreen();
    await ask('Who arrives today?');
    await screen.findByText('Two stays arrive today.');
    await waitFor(() => expect(window.localStorage.getItem(copilotHistoryKey('user_a', 'prop_demo'))).not.toBeNull());
    expect(window.localStorage.getItem(copilotHistoryKey('user_b', 'prop_demo'))).toBeNull();
    expect(window.localStorage.getItem('hospai.theme')).toBe('dark');
    first.unmount();

    renderScreen();
    expect(screen.getByTestId('copilot-home')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('copilot-history-open'));
    expect(screen.getByTestId('copilot-history-list')).toHaveTextContent('Who arrives today?');
  });

  it('works in memory when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderScreen();
    await ask('Who arrives today?');
    expect(await screen.findByText('Two stays arrive today.')).toBeInTheDocument();
    expect(screen.queryByTestId('copilot-history-open')).toBeNull();
    vi.restoreAllMocks();
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
