import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ClassifiedError } from '@hospai/client-core';
import {
  COPILOT_MAX_TURN_CHARS,
  COPILOT_MAX_TURNS,
  isCopilotSpaHref,
  type CopilotLink,
  type CopilotTurn,
} from '@hospai/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionLabel,
} from '@hospai/ui-kit';
import { api, tenant } from '../client.js';
import { classifiedUserMessage } from '../copy/classified-user-message.js';
import { useFormat } from '../shell/PropertyFormat.js';
import { useEntitlementFeatures } from '../shell/use-entitlements.js';
import { usePropertySubtitle } from '../shell/use-property-subtitle.js';
import { CopilotAnswer } from './copilot-answer.js';
import {
  clearConversations,
  deleteConversation,
  loadConversations,
  removeOtherUsersHistory,
  saveConversation,
  type StoredConversation,
} from './copilot-history.js';

function newConversationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

function titleOf(c: StoredConversation): string {
  const first = c.turns.find((t) => t.role === 'user')?.content.trim() ?? '';
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

function questionCount(c: StoredConversation): number {
  return c.turns.filter((t) => t.role === 'user').length;
}

type Confirm = { kind: 'one'; id: string } | { kind: 'all' };

/** What the home offers before the first question. Each one is sent as typed. */
export const COPILOT_SUGGESTED_QUESTIONS = [
  'Who arrives today?',
  'Which folios are still open?',
  'How is housekeeping doing?',
  "Show yesterday's manager report",
  'Why is this exception open?',
] as const;

/** Mutation key of one question: tenant first, so one property never shares another's pending state. */
export function copilotMutationKey(propertyId: string): readonly ['copilot-message', string] {
  return ['copilot-message', propertyId];
}

const TURN_CLASS: Record<CopilotTurn['role'], string> = {
  user: 'copilot-turn copilot-turn--user',
  assistant: 'copilot-turn copilot-turn--assistant',
};

type Entry = {
  id: number;
  turn: CopilotTurn;
  sources: CopilotLink[];
  actions: CopilotLink[];
};

type Failure = { kind: 'not_set_up' } | { kind: 'no_plan' } | { kind: 'error'; message: string };

function failureOf(err: unknown): Failure {
  if (err instanceof ClassifiedError) {
    const c = err.classified;
    if (c.status === 402) return { kind: 'no_plan' };
    const body = c.body;
    if (
      c.status === 503 &&
      body !== null &&
      typeof body === 'object' &&
      (body as { error?: unknown }).error === 'copilot_unavailable'
    ) {
      return { kind: 'not_set_up' };
    }
    return { kind: 'error', message: classifiedUserMessage(c, { fallback: 'The copilot could not answer.' }) };
  }
  return { kind: 'error', message: 'The copilot could not answer.' };
}

/**
 * `/copilot` (R4.16): a read-only assistant for this property. The conversation lives in this
 * component's state; after each answer it is also saved in this browser only (localStorage, per
 * staff member and property, 20 conversations for 30 days, removed at sign-out). The server stores
 * nothing. Each answer lists the screens it read as links; suggested next steps are buttons that navigate. The
 * clerk clicks. Nothing is ever submitted for them.
 */
export function CopilotScreen() {
  const propertyId = tenant.propertyId;
  const navigate = useNavigate();
  const { subtitle } = usePropertySubtitle('Ask about this property');
  const features = useEntitlementFeatures();
  const planMissing = features !== null && features['ai_ops.enabled'] !== true;

  const { instantDate } = useFormat();
  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const userId = meQuery.data?.userId ?? null;

  const nextId = useRef(1);
  const startedAt = useRef(Date.now());
  const lastSavedEntry = useRef(0);
  const [conversationId, setConversationId] = useState(newConversationId);
  const [saved, setSaved] = useState<StoredConversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [overLimit, setOverLimit] = useState(false);

  const ask = useMutation({
    mutationKey: copilotMutationKey(propertyId),
    mutationFn: (messages: CopilotTurn[]) => api.postCopilotMessage(propertyId, messages),
    onSuccess: (res) => {
      setEntries((prev) => [
        ...prev,
        {
          id: nextId.current++,
          turn: { role: 'assistant', content: res.answer },
          sources: res.sources,
          actions: res.suggestedActions,
        },
      ]);
      setOverLimit(res.overSoftLimit);
    },
    onError: (err) => setFailure(failureOf(err)),
  });

  // Another person's chats never survive a different sign-in on this browser.
  useEffect(() => {
    if (userId === null) return;
    removeOtherUsersHistory(userId);
    setSaved(loadConversations(userId, propertyId));
  }, [userId, propertyId]);

  // Save once per completed answer (not on keystrokes, not when a saved chat is merely opened).
  useEffect(() => {
    const last = entries[entries.length - 1];
    if (userId === null || last === undefined || last.turn.role !== 'assistant') return;
    if (last.id === lastSavedEntry.current) return;
    lastSavedEntry.current = last.id;
    setSaved(
      saveConversation(userId, propertyId, {
        id: conversationId,
        startedAt: startedAt.current,
        updatedAt: Date.now(),
        turns: entries.map((e) => ({
          role: e.turn.role,
          content: e.turn.content,
          sources: e.sources,
          suggestedActions: e.actions,
        })),
      }),
    );
  }, [entries, userId, propertyId, conversationId]);

  const earlier = saved.filter((c) => c.id !== conversationId);

  function openSaved(c: StoredConversation) {
    if (pending) return;
    ask.reset();
    const restored = c.turns.map((t, i) => ({
      id: i + 1,
      turn: { role: t.role, content: t.content },
      sources: t.sources,
      actions: t.suggestedActions,
    }));
    nextId.current = restored.length + 1;
    lastSavedEntry.current = restored.length;
    startedAt.current = c.startedAt;
    setConversationId(c.id);
    setEntries(restored);
    setDraft('');
    setFailure(null);
    setOverLimit(false);
    setHistoryOpen(false);
    setConfirm(null);
  }

  function confirmDelete() {
    if (userId === null || confirm === null) return;
    if (confirm.kind === 'one') setSaved(deleteConversation(userId, propertyId, confirm.id));
    else {
      clearConversations(userId, propertyId);
      setSaved([]);
    }
    setConfirm(null);
  }

  const question = draft.trim();
  const pending = ask.isPending;
  const canAsk = question !== '' && !pending;

  function send(text: string) {
    const q = text.trim();
    if (q === '' || pending) return;
    const history = entries.map((e) => ({
      role: e.turn.role,
      content: e.turn.content.slice(0, COPILOT_MAX_TURN_CHARS),
    }));
    const messages = [...history, { role: 'user' as const, content: q }].slice(-COPILOT_MAX_TURNS);
    setEntries((prev) => [
      ...prev,
      { id: nextId.current++, turn: { role: 'user', content: q }, sources: [], actions: [] },
    ]);
    setDraft('');
    setFailure(null);
    ask.mutate(messages);
  }

  function reset() {
    setConversationId(newConversationId());
    startedAt.current = Date.now();
    lastSavedEntry.current = 0;
    nextId.current = 1;
    setEntries([]);
    setDraft('');
    setFailure(null);
    setOverLimit(false);
    ask.reset();
  }

  return (
    <div className="board-page">
      <PageHeader
        title="Copilot"
        subtitle={subtitle}
        actions={
          entries.length > 0 || earlier.length > 0 ? (
            <>
              {earlier.length > 0 ? (
                <Button
                  intent="ghost"
                  onClick={() => setHistoryOpen(true)}
                  data-testid="copilot-history-open"
                >
                  Earlier conversations
                </Button>
              ) : null}
              {entries.length > 0 ? (
                <Button onClick={reset} disabled={pending} data-testid="copilot-reset">
                  New conversation
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      {planMissing || failure?.kind === 'no_plan' ? (
        <Card>
          <CardContent>
            <EmptyState
              data-testid="copilot-no-plan"
              title="Copilot is not part of your plan"
              description="Ask the account owner to add it, then come back."
            />
          </CardContent>
        </Card>
      ) : failure?.kind === 'not_set_up' ? (
        <Card>
          <CardContent>
            <EmptyState
              data-testid="copilot-not-set-up"
              kind="error"
              title="Copilot is not set up"
              description="No assistant service is connected to this system yet. Ask a manager or your HospAI contact to set it up."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{entries.length === 0 ? 'What would you like to know?' : 'Conversation'}</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <div className="copilot-home" data-testid="copilot-home">
                <p className="muted">
                  Ask about arrivals, folios, housekeeping, reports or night audit. The copilot reads only what you are
                  allowed to see, and it never changes anything. Conversations are saved in this browser only, for 30
                  days, and are deleted when you sign out.
                </p>
                <SectionLabel>Suggested questions</SectionLabel>
                <div className="copilot-suggestions" data-testid="copilot-suggestions">
                  {COPILOT_SUGGESTED_QUESTIONS.map((q) => (
                    <Button key={q} onClick={() => send(q)} disabled={pending} data-testid="copilot-suggestion">
                      {q}
                    </Button>
                  ))}
                </div>
                <SectionLabel>Shortcuts</SectionLabel>
                <div className="copilot-shortcuts" data-testid="copilot-shortcuts">
                  <Link className="ui-link-btn" to="/reports">
                    Reports
                  </Link>
                  <Link className="ui-link-btn" to="/dashboard">
                    Overview
                  </Link>
                </div>
              </div>
            ) : (
              <ol className="copilot-thread" data-testid="copilot-thread" aria-label="Conversation">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className={TURN_CLASS[e.turn.role]}
                    data-testid={`copilot-turn-${e.turn.role}`}
                  >
                    <span className="copilot-turn__who">{e.turn.role === 'user' ? 'You' : 'Copilot'}</span>
                    {e.turn.role === 'assistant' ? (
                      <div className="copilot-turn__text copilot-turn__text--answer">
                        <CopilotAnswer text={e.turn.content} />
                      </div>
                    ) : (
                      <span className="copilot-turn__text">{e.turn.content}</span>
                    )}
                    {e.sources.length > 0 ? (
                      <div className="copilot-links" data-testid="copilot-sources">
                        <SectionLabel>Sources</SectionLabel>
                        <ul>
                          {e.sources
                            .filter((s) => isCopilotSpaHref(s.href))
                            .map((s) => (
                              <li key={s.href}>
                                <Link to={s.href}>{s.label}</Link>
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                    {e.actions.length > 0 ? (
                      <div className="copilot-links" data-testid="copilot-actions">
                        <SectionLabel>Next steps</SectionLabel>
                        <div className="copilot-shortcuts">
                          {e.actions
                            .filter((a) => isCopilotSpaHref(a.href))
                            .map((a) => (
                              <Button key={a.href} onClick={() => navigate(a.href)}>
                                {a.label}
                              </Button>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {pending ? (
              <p className="muted" role="status" data-testid="copilot-pending">
                Reading the records…
              </p>
            ) : null}
            {failure?.kind === 'error' ? <Alert data-testid="copilot-error">{failure.message}</Alert> : null}
            {overLimit ? (
              <Alert intent="attention" data-testid="copilot-over-limit">
                This property is past its Copilot message allowance. Answers still work. Ask a manager to review the plan.
              </Alert>
            ) : null}

            <form
              className="copilot-composer"
              onSubmit={(ev) => {
                ev.preventDefault();
                send(draft);
              }}
            >
              <Field
                label="Your question"
                hint={question === '' && !pending ? 'Type a question to ask.' : undefined}
                size="full"
                control={
                  <Input
                    value={draft}
                    maxLength={COPILOT_MAX_TURN_CHARS}
                    placeholder="For example: who is checking out today?"
                    data-testid="copilot-input"
                    onChange={(e) => setDraft(e.target.value)}
                  />
                }
              />
              <Button type="submit" intent="primary" disabled={!canAsk} data-testid="copilot-ask">
                Ask
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={historyOpen}
        title={
          confirm === null
            ? 'Earlier conversations'
            : confirm.kind === 'all'
              ? 'Delete all saved conversations?'
              : 'Delete this conversation?'
        }
        onClose={() => (confirm === null ? setHistoryOpen(false) : setConfirm(null))}
        data-testid="copilot-history-dialog"
        footer={
          confirm === null ? (
            <>
              <Button
                intent="destructive"
                onClick={() => setConfirm({ kind: 'all' })}
                disabled={saved.length === 0}
                data-testid="copilot-history-delete-all"
              >
                Delete all
              </Button>
              <Button onClick={() => setHistoryOpen(false)}>Close</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button intent="destructive" onClick={confirmDelete} data-testid="copilot-history-confirm">
                Delete
              </Button>
            </>
          )
        }
      >
        {confirm !== null ? (
          <p className="muted">
            {confirm.kind === 'all'
              ? 'Every saved conversation in this browser will be deleted. This cannot be undone.'
              : 'This saved conversation will be deleted from this browser. This cannot be undone.'}
          </p>
        ) : earlier.length === 0 ? (
          <EmptyState title="No earlier conversations" description="Conversations are kept here for 30 days." />
        ) : (
          <ul className="copilot-history" data-testid="copilot-history-list">
            {earlier.map((c) => (
              <li key={c.id} className="copilot-history__row" data-testid="copilot-history-row">
                <span className="copilot-history__title">{titleOf(c)}</span>
                <span className="muted">
                  {instantDate(c.updatedAt)} · {questionCount(c)} {questionCount(c) === 1 ? 'question' : 'questions'}
                </span>
                <span className="copilot-shortcuts">
                  <Button onClick={() => openSaved(c)} disabled={pending} data-testid="copilot-history-open-one">
                    Open
                  </Button>
                  <Button
                    intent="destructive"
                    onClick={() => setConfirm({ kind: 'one', id: c.id })}
                    data-testid="copilot-history-delete"
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
