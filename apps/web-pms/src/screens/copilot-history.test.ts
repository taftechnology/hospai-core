// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPILOT_HISTORY_MAX_AGE_MS,
  clearAllCopilotHistory,
  clearConversations,
  copilotHistoryKey,
  deleteConversation,
  loadConversations,
  removeOtherUsersHistory,
  saveConversation,
  type StoredConversation,
} from './copilot-history.js';

const NOW = 1_800_000_000_000;

function conv(id: string, updatedAt = NOW, question = `q ${id}`): StoredConversation {
  return {
    id,
    startedAt: updatedAt - 1000,
    updatedAt,
    turns: [
      { role: 'user', content: question, sources: [], suggestedActions: [] },
      {
        role: 'assistant',
        content: 'answer',
        sources: [{ label: 'Arrivals', href: '/arrivals' }],
        suggestedActions: [{ label: 'Open', href: '/arrivals' }],
      },
    ],
  };
}

describe('copilot-history', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a conversation under the per-user, per-property key', () => {
    saveConversation('u1', 'p1', conv('a'), NOW);
    expect(Object.keys({ ...window.localStorage })).toEqual([copilotHistoryKey('u1', 'p1')]);
    expect(copilotHistoryKey('u1', 'p1')).toBe('hospai.copilot.history.v1.u1.p1');
    expect(loadConversations('u1', 'p1', NOW)).toEqual([conv('a')]);
    expect(loadConversations('u1', 'p2', NOW)).toEqual([]);
    expect(loadConversations('u2', 'p1', NOW)).toEqual([]);
  });

  it('replaces a conversation with the same id and lists newest first', () => {
    saveConversation('u1', 'p1', conv('a', NOW - 5000), NOW);
    saveConversation('u1', 'p1', conv('b', NOW - 1000), NOW);
    saveConversation('u1', 'p1', { ...conv('a', NOW), turns: conv('a').turns.slice(0, 1) }, NOW);
    const list = loadConversations('u1', 'p1', NOW);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    expect(list[0]!.turns).toHaveLength(1);
  });

  it('keeps only the newest 20', () => {
    for (let i = 0; i < 25; i++) saveConversation('u1', 'p1', conv(`c${i}`, NOW - 100 * (25 - i)), NOW);
    const list = loadConversations('u1', 'p1', NOW);
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe('c24');
    expect(list.at(-1)!.id).toBe('c5');
  });

  it('drops conversations older than 30 days on load and on save', () => {
    const old = NOW - COPILOT_HISTORY_MAX_AGE_MS - 1;
    window.localStorage.setItem(copilotHistoryKey('u1', 'p1'), JSON.stringify([conv('old', old), conv('new', NOW - 1000)]));
    expect(loadConversations('u1', 'p1', NOW).map((c) => c.id)).toEqual(['new']);
    saveConversation('u1', 'p1', conv('x', NOW), NOW);
    expect(JSON.parse(window.localStorage.getItem(copilotHistoryKey('u1', 'p1'))!).map((c: { id: string }) => c.id)).toEqual(['x', 'new']);
  });

  it('drops malformed entries silently', () => {
    const key = copilotHistoryKey('u1', 'p1');
    window.localStorage.setItem(
      key,
      JSON.stringify([
        conv('ok'),
        { id: 'bad1' },
        { ...conv('bad2'), turns: [{ role: 'system', content: 'x', sources: [], suggestedActions: [] }] },
        { ...conv('bad3'), updatedAt: 'yesterday' },
        { ...conv('bad4'), turns: [] },
        { ...conv('bad5'), turns: [{ role: 'user', content: 'x', sources: [{ label: 1 }], suggestedActions: [] }] },
        null,
        'text',
      ]),
    );
    expect(loadConversations('u1', 'p1', NOW).map((c) => c.id)).toEqual(['ok']);
    window.localStorage.setItem(key, '{not json');
    expect(loadConversations('u1', 'p1', NOW)).toEqual([]);
    window.localStorage.setItem(key, '{"a":1}');
    expect(loadConversations('u1', 'p1', NOW)).toEqual([]);
  });

  it('deletes one and clears all for a user and property', () => {
    saveConversation('u1', 'p1', conv('a'), NOW);
    saveConversation('u1', 'p1', conv('b'), NOW);
    expect(deleteConversation('u1', 'p1', 'a', NOW).map((c) => c.id)).toEqual(['b']);
    clearConversations('u1', 'p1');
    expect(window.localStorage.getItem(copilotHistoryKey('u1', 'p1'))).toBeNull();
  });

  it('does not crash when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadConversations('u1', 'p1', NOW)).toEqual([]);
    expect(() => saveConversation('u1', 'p1', conv('a'), NOW)).not.toThrow();
    expect(() => deleteConversation('u1', 'p1', 'a', NOW)).not.toThrow();
    expect(() => clearConversations('u1', 'p1')).not.toThrow();
    expect(() => clearAllCopilotHistory()).not.toThrow();
    expect(() => removeOtherUsersHistory('u1')).not.toThrow();
  });

  it("wipes another user's keys but keeps this user's, across properties", () => {
    saveConversation('u1', 'p1', conv('a'), NOW);
    saveConversation('u1', 'p2', conv('b'), NOW);
    saveConversation('u2', 'p1', conv('c'), NOW);
    window.localStorage.setItem('hospai.theme', 'dark');
    removeOtherUsersHistory('u1');
    expect(window.localStorage.getItem(copilotHistoryKey('u2', 'p1'))).toBeNull();
    expect(window.localStorage.getItem(copilotHistoryKey('u1', 'p1'))).not.toBeNull();
    expect(window.localStorage.getItem(copilotHistoryKey('u1', 'p2'))).not.toBeNull();
    expect(window.localStorage.getItem('hospai.theme')).toBe('dark');
  });

  it('clears every history key and nothing else', () => {
    saveConversation('u1', 'p1', conv('a'), NOW);
    saveConversation('u2', 'p9', conv('c'), NOW);
    window.localStorage.setItem('hospai.theme', 'light');
    clearAllCopilotHistory();
    expect(Object.keys({ ...window.localStorage })).toEqual(['hospai.theme']);
  });
});
