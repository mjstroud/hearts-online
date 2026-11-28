import { describe, expect, it } from 'vitest';
import { CHAT_KEEP_MS, type ChatMessage, chatError, cleanChat } from './chat';
import { type ChatTable, lastChatId, mergeChat, newestEach, routeChat, unreadCount } from './chat-client';
import { sendOutcome } from './chat-outcome';

const NOW = 1_000_000_000;
const msg = (id: number, from = 1, at = NOW, cid?: string): ChatMessage => ({ id, from, name: `p${from}`, text: `m${id}`, at, ...(cid ? { cid } : {}) });

describe('mergeChat', () => {
  it('keeps one copy of each, in the order the server took them', () => {
    const list = [msg(1), msg(3)];
    expect(mergeChat(list, [msg(2), msg(3), msg(4), msg(4)], NOW).map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  it('returns the same list when nothing is new, so nothing redraws', () => {
    const list = [msg(1), msg(2)];
    expect(mergeChat(list, [msg(2)], NOW)).toBe(list);
    expect(mergeChat(list, [], NOW)).toBe(list);
  });

  it('lets go of anything older than 24 hours, held or arriving', () => {
    const list = [msg(1, 1, NOW - CHAT_KEEP_MS - 1), msg(2)];
    expect(mergeChat(list, [], NOW).map((m) => m.id)).toEqual([2]);
    expect(mergeChat([], [msg(5, 1, NOW - CHAT_KEEP_MS - 1), msg(6)], NOW).map((m) => m.id)).toEqual([6]);
  });

  it('takes a new message whose id an expired one had', () => {
    const old = { ...msg(7, 1, NOW - CHAT_KEEP_MS - 1), text: 'old' };
    expect(mergeChat([old], [{ ...msg(7), text: 'new' }], NOW).map((m) => m.text)).toEqual(['new']);
  });
});

describe('unread and the newest id', () => {
  it('counts only other people’s messages newer than the last one read', () => {
    const list = [msg(1, 2), msg(2, 1), msg(3, 2), msg(4, 3)];
    expect(unreadCount(list, 1, 0)).toBe(3);
    expect(unreadCount(list, 1, 3)).toBe(1);
    expect(unreadCount(list, 1, 4)).toBe(0);
    expect(unreadCount([], 1, 0)).toBe(0);
  });

  it('asks for what comes after the newest held', () => {
    expect(lastChatId([])).toBe(0);
    expect(lastChatId([msg(4), msg(9)])).toBe(9);
  });
});

describe('routeChat', () => {
  const table: ChatTable = { status: 'active', players: [{ userId: 1 }, { userId: 2 }], me: 1, muted: false, open: false, hidden: false, holding: false };
  it('shows a preview at the table during play, held through the end of a hand', () => {
    expect(routeChat(msg(1, 2), table)).toBe('show');
    expect(routeChat(msg(1, 2), { ...table, holding: true })).toBe('hold');
  });

  it('says it in a note in the waiting room and on the end screen, which have no avatars', () => {
    expect(routeChat(msg(1, 2), { ...table, status: 'lobby' })).toBe('toast');
    expect(routeChat(msg(1, 9), { ...table, status: 'finished' })).toBe('toast');
    // The end of a game's last hand is still playing: held, like any other hand's.
    expect(routeChat(msg(1, 2), { ...table, status: 'finished', holding: true })).toBe('hold');
  });

  it('never for your own, while muted, with the sheet open, out of sight, or from someone gone', () => {
    expect(routeChat(msg(1, 1), table)).toBe('drop');
    for (const t of [{ muted: true }, { open: true }, { hidden: true }, { muted: true, status: 'lobby' as const }]) {
      expect(routeChat(msg(1, 2), { ...table, ...t })).toBe('drop');
    }
    expect(routeChat(msg(1, 9), table)).toBe('drop');
  });

  it('keeps only each person’s newest held preview', () => {
    const held = [msg(1, 2), msg(2, 3), msg(3, 2)].map((m) => ({ m, at: 0 }));
    expect(newestEach(held).map((h) => h.m.id)).toEqual([2, 3]);
  });
});

describe('sendOutcome', () => {
  const message = msg(5, 1, NOW, 't.1');
  it('takes the server’s copy', () => {
    expect(sendOutcome({ ok: true, status: 200, data: { message } })).toEqual({ kind: 'sent', message });
  });

  it('gives a message that can’t go back, says when you’ve left, and offers a retry for anything else', () => {
    expect(sendOutcome({ ok: false, status: 400, data: { error: 'Too long.' } })).toEqual({ kind: 'refused', error: 'Too long.' });
    expect(sendOutcome({ ok: false, status: 404, data: { error: 'Game not found.' } }).kind).toBe('gone');
    expect(sendOutcome({ ok: false, status: 429, data: { error: 'Slow down a little: wait 4s.', retryAfterMs: 4000 } })).toEqual({
      kind: 'retry',
      error: 'Slow down a little: wait 4s.',
    });
    // No answer, a deploy's 502 page, or an answer that isn't the message: it may have landed.
    for (const res of [
      { ok: false, status: 0, data: {} },
      { ok: false, status: 502, data: {} },
      { ok: false, status: 403, data: {} },
      // An older server's HTML 404, with no chat route: not the same as being removed.
      { ok: false, status: 404, data: {} },
      { ok: true, status: 200, data: {} },
    ]) {
      expect(sendOutcome(res)).toEqual({ kind: 'retry', error: 'May not have sent.' });
    }
  });
});

describe('cleanChat and chatError', () => {
  it('agree with the server on what can be sent', () => {
    expect(cleanChat(' hi\nthere ')).toBe('hi there');
    expect(chatError(cleanChat('   '))).toBe('Type a message first.');
    expect(chatError('🙂')).toBeNull();
    expect(chatError('?')).toBeNull();
    expect(chatError('x'.repeat(281))).toMatch(/up to 280/);
  });
});
