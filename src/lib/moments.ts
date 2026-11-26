/**
 * Table moments: the short messages (and one-shot effects) for things the whole table just watched
 * happen. They're worked out from two consecutive views, using face-up cards and the public table
 * facts only. Never pointsTaken, queenTakenBy, jackTakenBy or myCrib: the crib winner's own view
 * counts the crib in those, and a moment must look the same from every seat.
 */
import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, cardLabel } from './engine/cards';
import type { Trick } from './engine/hand';
import type { HandSummary, TableView } from './engine/view';

/** Each message stays up at least this long (ms). */
export const MIN_SHOW_MS = 1200;
/** The shortest time the hand's final trick sits on the felt before a Sun or Moon celebration or the result. */
export const FINAL_TRICK_MS = 1200;
/** Cards that land in one update slide in this far apart (ms), so the order they were played in still reads. */
export const STAGGER_MS = 150;
/** How long one card takes to slide in (ms). */
export const ARRIVE_MS = 280;

/**
 * How long each card of `trick` waits before it slides in. Cards already on the felt don't wait;
 * the new ones go one after another in play order.
 */
export function arrivalDelays(onFelt: readonly Card[], trick: Trick | null): Map<Card, number> {
  const delays = new Map<Card, number>();
  let n = 0;
  for (const p of trick?.plays ?? []) delays.set(p.card, onFelt.includes(p.card) ? 0 : STAGGER_MS * n++);
  return delays;
}

/**
 * How long the hand-end sequence holds the final trick on the felt: long enough for its cards to
 * slide in and for each of its messages (auto-finished, the Queen, the Jack) to get its turn in the
 * slot. FINAL_TRICK_MS also gives a Sun or Moon glow that goes out on the last trick time to fade.
 */
export function finalTrickHoldMs(before: TableView | null, trick: Trick, s: HandSummary | null, w: Who): number {
  const landed = Math.max(0, ...arrivalDelays(before?.current?.plays.map((p) => p.card) ?? [], trick).values());
  return landed + Math.max(FINAL_TRICK_MS, finalMoments(trick, s, w).length * MIN_SHOW_MS);
}

/** The trick review's note for a hand the server finished early ("Tricks 10–12 played out…"), or null. */
export function playedOutNote(autoFrom: number | null | undefined, totalTricks: number): string | null {
  if (!autoFrom) return null;
  return autoFrom >= totalTricks
    ? `Trick ${totalTricks} played out on its own: no points were left.`
    : `Tricks ${autoFrom}–${totalTricks} played out on their own: no points were left.`;
}

/**
 * The message slot's order: lower goes first. "Takes it" and "your lead" are what it shows when nothing's queued.
 * Sun and Moon watches have no messages: the glow behind the watcher's avatar is the news.
 */
export const PRIORITY = { shot: 0, auto: 1, queen: 2, hearts: 3, jack: 5, takes: 6, lead: 7 } as const;
export type MessageKind = keyof typeof PRIORITY;

/** A felt-wide wash: warm when hearts break. (A Sun or Moon shot gets HandEndCelebration instead.) */
export type Wash = 'hearts';

export interface Message {
  kind: MessageKind;
  /** Text either side of a player's name. Only the name is cut short when space runs out. */
  pre: string;
  name: string;
  post: string;
  wash?: Wash;
  /** Wait this long (ms) before showing it. */
  delay?: number;
}

export interface Who {
  /** Display names, by seat. */
  names: readonly string[];
  /** Your seat, so your own moments read "You eat the Queen". */
  me: number | null;
  /** The J♦ house rule is on. */
  jack: boolean;
}

export interface Moments {
  messages: Message[];
  /** The Q♠, when it has just landed face-up, for a ripple from the card. */
  ripple: Card | null;
}

// Flex items drop the spaces at their edges, so the spaces next to the name are non-breaking.
const msg = (kind: MessageKind, pre: string, name: string, post: string, extra?: Partial<Message>): Message => ({
  kind,
  pre: pre.replace(/ $/, '\u00a0'),
  name,
  post: post.replace(/^ /, '\u00a0'),
  ...extra,
});

const subject = (w: Who, seat: number) => (seat === w.me ? 'You' : (w.names[seat] ?? ''));
/** " eat" for you, " eats" for anyone else. */
const verb = (w: Who, seat: number, v: string) => ` ${v}${seat === w.me ? '' : 's'}`;

/** Tricks finished so far this hand. */
const doneTricks = (v: TableView) => (v.phase === 'done' ? v.totalTricks : v.phase === 'playing' ? v.trickNumber - 1 : 0);
/** The last trick the table saw played: when the server finished the hand early, the one before `s.autoFrom`. */
const lastTableTrick = (s: HandSummary | null, totalTricks: number) => (s?.autoFrom ? s.autoFrom - 1 : totalTricks);
/** Cards played face-up so far this hand. */
const played = (v: TableView) => doneTricks(v) * v.handSizes.length + (v.current?.plays.length ?? 0);
/** Face-up cards still on show: the trick in progress and the last finished one. */
const faceUp = (v: TableView): Card[] =>
  [...(v.current?.plays ?? []), ...(doneTricks(v) > 0 ? (v.lastTrick?.plays ?? []) : [])].map((p) => p.card);

/** The Q♠ and J♦ going to whoever took `trick`. */
function taken(trick: Trick, w: Who, jack: boolean): Message[] {
  const seat = trick.winner!;
  const cards = trick.plays.map((p) => p.card);
  const out: Message[] = [];
  if (cards.includes(QUEEN_OF_SPADES)) out.push(msg('queen', '', subject(w, seat), `${verb(w, seat, 'eat')} the Queen · +13`));
  if (jack && cards.includes(JACK_OF_DIAMONDS)) out.push(msg('jack', '', subject(w, seat), `${verb(w, seat, 'grab')} the Jack · −10`));
  return out;
}

/**
 * The moments between two views of the same hand. Nothing for the first view, a new hand, or a jump
 * of more than one trick's worth of cards (or backwards, like a playtest undo): those are a page
 * load or a tab catching up, not something the table just watched.
 */
export function detectMoments(prev: TableView | null, next: TableView, w: Who): Moments {
  const messages: Message[] = [];
  if (!prev || prev.handNumber !== next.handNumber || next.phase === 'passing') return { messages, ripple: null };
  const step = played(next) - played(prev);
  if (step < 0 || step > next.handSizes.length) return { messages, ripple: null };

  const broke = next.heartsBrokenBy ?? null;
  if (broke && !prev.heartsBrokenBy) {
    const mine = broke.seat === w.me;
    const card = cardLabel(broke.card);
    messages.push(msg('hearts', 'Hearts are broken: ', mine ? '' : (w.names[broke.seat] ?? ''), mine ? `your ${card}` : `’s ${card}`, { wash: 'hearts' }));
  }

  // Exactly one trick closed.
  const closed = doneTricks(next) === doneTricks(prev) + 1 ? next.lastTrick : null;
  if (closed && closed.winner !== null) messages.push(...taken(closed, w, w.jack));

  const ripple = faceUp(next).includes(QUEEN_OF_SPADES) && !faceUp(prev).includes(QUEEN_OF_SPADES) ? QUEEN_OF_SPADES : null;
  return { messages, ripple };
}

/**
 * Whether this tab watched hand `s` end, rather than loading in after: `before`, its last view
 * before the hand ended, shows the last trick the table saw played still in progress. Only then
 * does the hand-end sequence hold that trick on the felt. The next hand's first view never counts,
 * even straight into play after a Keep hand.
 */
export function endedLive(before: TableView | null, s: HandSummary): boolean {
  if (!before || before.handNumber !== s.number || before.phase !== 'playing') return false;
  return before.trickNumber === lastTableTrick(s, before.totalTricks);
}

/**
 * The moments for a hand's final trick, while the hand-end sequence holds it on the felt. The next
 * hand is dealt in the same update as the last card, so they can't come from consecutive views.
 * `trick` is the last trick the table saw played: when the server finished the hand early, that's
 * the one before `s.autoFrom`. `s` is that hand's summary, or null when this tab doesn't have it.
 * A Sun or Moon shot isn't told here: Game.svelte's full-screen celebration (HandEndCelebration)
 * plays it once the final trick has had its moment, so the table never announces it twice.
 */
export function finalMoments(trick: Trick, s: HandSummary | null, w: Who): Message[] {
  if (trick.winner === null) return [];
  const out: Message[] = s?.autoFrom ? [msg('auto', 'No points left · hand over', '', '')] : [];
  out.push(...taken(trick, w, s ? s.jackScored : w.jack));
  return out;
}

/** What the slot shows when nothing is queued: who took the trick on the felt, plus "your lead" when you're next. */
export function restingMessage(trick: Trick | null, w: Who, yourLead: boolean): Message | null {
  if (!trick || trick.winner === null) return null;
  const seat = trick.winner;
  const lead = yourLead && seat === w.me ? ' · your lead' : '';
  return msg(lead ? 'lead' : 'takes', '', subject(w, seat), `${verb(w, seat, 'take')} it${lead}`);
}

export interface Queued extends Message {
  /** When it may show (ms timestamp). */
  at: number;
}

/** Add messages in priority order (arrival order within one priority), keeping only the first few. */
export function enqueue(queue: readonly Queued[], add: readonly Message[], now: number, max = 4): Queued[] {
  return [...queue, ...add.map((m) => ({ ...m, at: now + (m.delay ?? 0) }))]
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])
    .slice(0, max);
}

/** The first queued message that's ready by `now`, what's left, and how long until the next one is ready. */
export function takeNext(queue: readonly Queued[], now: number): { next: Queued | null; rest: Queued[]; wait: number | null } {
  const i = queue.findIndex((m) => m.at <= now);
  if (i >= 0) return { next: queue[i], rest: queue.filter((_, j) => j !== i), wait: null };
  return { next: null, rest: [...queue], wait: queue.length ? Math.min(...queue.map((m) => m.at)) - now : null };
}
