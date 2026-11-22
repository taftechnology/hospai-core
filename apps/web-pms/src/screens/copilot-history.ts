import type { CopilotLink } from '@hospai/contracts';

/** Every key this feature writes starts here. Sign-out removes all of them. */
export const COPILOT_HISTORY_PREFIX = 'hospai.copilot.history.';
const KEY_PREFIX = `${COPILOT_HISTORY_PREFIX}v1.`;

export const COPILOT_HISTORY_MAX_CONVERSATIONS = 20;
export const COPILOT_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type StoredTurn = {
  role: 'user' | 'assistant';
  content: string;
  sources: CopilotLink[];
  suggestedActions: CopilotLink[];
};

export type StoredConversation = {
  id: string;
  startedAt: number;
  updatedAt: number;
  turns: StoredTurn[];
};

/** One key per staff member and property: the browser may be shared at a front desk. */
export function copilotHistoryKey(userId: string, propertyId: string): string {
  return `${KEY_PREFIX}${userId}.${propertyId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isLink(v: unknown): v is CopilotLink {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === 'string' && typeof o.href === 'string';
}

function parseTurn(v: unknown): StoredTurn | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if ((o.role !== 'user' && o.role !== 'assistant') || typeof o.content !== 'string') return null;
  if (!Array.isArray(o.sources) || !o.sources.every(isLink)) return null;
  if (!Array.isArray(o.suggestedActions) || !o.suggestedActions.every(isLink)) return null;
  return {
    role: o.role,
    content: o.content,
    sources: o.sources.map((s) => ({ label: s.label, href: s.href })),
    suggestedActions: o.suggestedActions.map((s) => ({ label: s.label, href: s.href })),
  };
}

function parseConversation(v: unknown): StoredConversation | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '') return null;
  if (typeof o.startedAt !== 'number' || !Number.isFinite(o.startedAt)) return null;
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt)) return null;
  if (!Array.isArray(o.turns) || o.turns.length === 0) return null;
  const turns: StoredTurn[] = [];
  for (const t of o.turns) {
    const turn = parseTurn(t);
    if (turn === null) return null;
    turns.push(turn);
  }
  return { id: o.id, startedAt: o.startedAt, updatedAt: o.updatedAt, turns };
}

/** Drop malformed and expired entries, newest first, keep the newest 20. */
function tidy(list: StoredConversation[], now: number): StoredConversation[] {
  return list
    .filter((c) => now - c.updatedAt <= COPILOT_HISTORY_MAX_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, COPILOT_HISTORY_MAX_CONVERSATIONS);
}

function read(key: string, now: number): StoredConversation[] {
  const store = storage();
  if (store === null) return [];
  try {
    const raw = store.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: StoredConversation[] = [];
    for (const item of parsed) {
      const c = parseConversation(item);
      if (c !== null) list.push(c);
    }
    return tidy(list, now);
  } catch {
    return [];
  }
}

function write(key: string, list: StoredConversation[]): void {
  const store = storage();
  if (store === null) return;
  try {
    if (list.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the screen keeps working in memory.
  }
}

/** Saved conversations of this user at this property, newest first. Never throws. */
export function loadConversations(userId: string, propertyId: string, now = Date.now()): StoredConversation[] {
  return read(copilotHistoryKey(userId, propertyId), now);
}

/** Insert or replace one conversation, then prune. Returns what is stored afterwards. */
export function saveConversation(
  userId: string,
  propertyId: string,
  conversation: StoredConversation,
  now = Date.now(),
): StoredConversation[] {
  const key = copilotHistoryKey(userId, propertyId);
  const next = tidy([conversation, ...read(key, now).filter((c) => c.id !== conversation.id)], now);
  write(key, next);
  return next;
}

export function deleteConversation(
  userId: string,
  propertyId: string,
  id: string,
  now = Date.now(),
): StoredConversation[] {
  const key = copilotHistoryKey(userId, propertyId);
  const next = read(key, now).filter((c) => c.id !== id);
  write(key, next);
  return next;
}

export function clearConversations(userId: string, propertyId: string): void {
  write(copilotHistoryKey(userId, propertyId), []);
}

function historyKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null && k.startsWith(COPILOT_HISTORY_PREFIX)) keys.push(k);
  }
  return keys;
}

/** Remove every saved conversation of every user and property. Called before sign-out. */
export function clearAllCopilotHistory(): void {
  const store = storage();
  if (store === null) return;
  try {
    for (const k of historyKeys(store)) store.removeItem(k);
  } catch {
    // Nothing more to do.
  }
}

/** Shared computer: another person's chats do not survive a different sign-in. */
export function removeOtherUsersHistory(userId: string): void {
  const store = storage();
  if (store === null) return;
  try {
    const mine = `${KEY_PREFIX}${userId}.`;
    for (const k of historyKeys(store)) {
      if (!k.startsWith(mine)) store.removeItem(k);
    }
  } catch {
    // Nothing more to do.
  }
}
