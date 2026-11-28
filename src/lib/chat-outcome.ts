/**
 * What the answer to sending a chat message means (Phase 4b). Plain TypeScript, so it can be tested; the
 * sending itself is in chat-send.svelte.ts, which loads with the chat sheet.
 */

import type { ChatMessage } from './chat';
import type { PostResult } from './post-json';

/** One of your own messages on its way. */
export interface ChatPending {
  cid: string;
  text: string;
  /** When it was sent, on this device's clock. */
  at: number;
  /** `failed`: refused for now, or no answer came. `error` says which; Retry sends it with the same cid. */
  state: 'sending' | 'failed';
  error?: string;
}

/**
 * - `sent`: the server's copy, to show in its place.
 * - `refused`: it can't go as it is (say, too long): it comes off the list and goes back in the box.
 * - `gone`: you're no longer at this table.
 * - `retry`: not sent yet, or no answer came (a timeout, a restart mid-deploy, a 5xx). Retrying sends
 *   the same cid, which the server never saves twice.
 */
export type SendOutcome =
  | { kind: 'sent'; message: ChatMessage }
  | { kind: 'refused'; error: string }
  | { kind: 'gone'; error: string }
  | { kind: 'retry'; error: string };

export function sendOutcome({ ok, status, data }: PostResult): SendOutcome {
  if (ok && data?.message && typeof data.message.id === 'number') return { kind: 'sent', message: data.message };
  const said = typeof data?.error === 'string' ? data.error : null;
  if (status === 400) return { kind: 'refused', error: said ?? 'That message can’t be sent.' };
  // The server's own "not your game", not a page from an older server without chat (mid-deploy, or rolled back).
  if (status === 404 && said) return { kind: 'gone', error: 'You’re not at this table any more.' };
  if (status === 429) return { kind: 'retry', error: said ?? 'Slow down a little.' };
  return { kind: 'retry', error: 'May not have sent.' };
}
