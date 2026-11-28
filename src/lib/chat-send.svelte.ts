/**
 * Sending chat (Phase 4b). Only the chat sheet imports this, so it loads with the sheet, not on every game
 * page. Your messages show the moment you send them (ground rule 1) and stay here until the server's copy
 * arrives, so they outlast the sheet being closed.
 */

import type { ChatMessage, ChatRequest } from './chat';
import { type ChatPending, sendOutcome } from './chat-outcome';
import { postJson } from './post-json';

export type { ChatPending };

/** Your messages on their way, for this page's one game. */
export const outbox = $state<{ pending: ChatPending[] }>({ pending: [] });

// Not crypto.randomUUID, which plain http (a phone on the LAN) doesn't have.
const tab = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
let sends = 0;

/** What a send's caller hears back: the server's copy, or why it was refused (and the text, to put back). */
export interface SendHooks {
  received: (m: ChatMessage) => void;
  refused: (error: string, text: string) => void;
}

async function post(gameId: string, p: ChatPending, hooks: SendHooks) {
  const body: ChatRequest = { text: p.text, cid: p.cid };
  const outcome = sendOutcome(await postJson(`/api/games/${gameId}/chat`, body));
  const i = outbox.pending.findIndex((x) => x.cid === p.cid);
  if (outcome.kind === 'sent') {
    if (i >= 0) outbox.pending.splice(i, 1);
    return hooks.received(outcome.message);
  }
  // Already confirmed by its echo, or removed.
  if (i < 0) return;
  if (outcome.kind === 'refused') {
    outbox.pending.splice(i, 1);
    return hooks.refused(outcome.error, p.text);
  }
  outbox.pending[i] = { ...outbox.pending[i], state: 'failed', error: outcome.error };
}

/** Send a message that's already cleaned and checked. It shows at once, marked as sending. */
export function sendChat(gameId: string, text: string, hooks: SendHooks) {
  const p: ChatPending = { cid: `${tab}.${++sends}`, text, at: Date.now(), state: 'sending' };
  outbox.pending.push(p);
  post(gameId, p, hooks);
}

export function retryChat(gameId: string, cid: string, hooks: SendHooks) {
  const i = outbox.pending.findIndex((x) => x.cid === cid);
  if (i < 0 || outbox.pending[i].state === 'sending') return;
  outbox.pending[i] = { ...outbox.pending[i], state: 'sending', error: undefined };
  post(gameId, outbox.pending[i], hooks);
}

export function discardChat(cid: string) {
  const i = outbox.pending.findIndex((x) => x.cid === cid);
  if (i >= 0) outbox.pending.splice(i, 1);
}

/** Take off the sends the server has confirmed some other way: your message with the same cid arrived. */
export function settle(messages: readonly ChatMessage[], me: number) {
  if (!outbox.pending.length) return;
  const done = new Set(messages.filter((m) => m.from === me && m.cid).map((m) => m.cid));
  if (!done.size) return;
  for (let i = outbox.pending.length - 1; i >= 0; i--) if (done.has(outbox.pending[i].cid)) outbox.pending.splice(i, 1);
}
