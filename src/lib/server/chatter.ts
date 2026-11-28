/**
 * The cats' light chatter (Phase 4a): now and then a real cat at the table answers a face-up moment,
 * or a throw that hit it, with an emote or a throw of its own. At most one cat per moment, under the
 * same 15s cooldown as everyone's taunts. What a cat says depends only on the moment and the dice,
 * never on its own hand, its pass, the crib, its legal plays or a queued card, or the table could read
 * hidden cards from it (ground rule 7). It runs after a change is saved, so nothing here ever throws.
 */
import { type Rng, secureRng } from '../engine/cards';
import type { TableEvent } from '../engine/table-events';
import { summarizeHand } from '../engine/view';
import { SHOT_MS, finalTrickHoldMs } from '../moments';
import { tauntById } from '../taunts';
import { sql } from './db';
import { type SeatedPlayer, getPlayers, loadGame } from './games';
import { subscribers } from './hub';
import { sendTaunt, takeTauntCooldown } from './taunting';

/** How often a cat speaks up: about 1 time in N. "Lightly" is the owner's call (2026-11-27). */
const ONE_IN = {
  /** The cat a moment is about: it took the Q♠ or the J♦, broke hearts, shot the Sun or Moon, or was hit. */
  involved: 4,
  /** Some other cat, when a person eats the Q♠ or shoots. */
  onlooker: 8,
  /** The cat won a plain trick. */
  trick: 20,
  /** Hit by something messy: throw the same thing straight back, rather than sob. */
  throwBack: 3,
} as const;

type Moment = 'shot' | 'queen' | 'hearts' | 'jack' | 'trick';

/** Biggest first: only the biggest moment of a change gets a reaction. */
const PRIORITY: readonly Moment[] = ['shot', 'queen', 'hearts', 'jack', 'trick'];

/** What a cat says about its own moment, and (only for the Q♠ or a shot) about a person's. */
const SAYS: Record<Moment, { own: readonly string[]; other?: readonly string[] }> = {
  shot: { own: ['cool', 'devil'], other: ['shock', 'clap'] },
  queen: { own: ['sob', 'shock'], other: ['laugh'] },
  hearts: { own: ['devil'] },
  jack: { own: ['cool'] },
  trick: { own: ['cool'] },
};

/** What a cat says when a throw hits it. */
const HIT: Record<string, readonly string[]> = {
  tomato: ['sob', 'shock'],
  pie: ['sob', 'shock'],
  rose: ['heart'],
  fish: ['heart'],
};
/** Throws a cat may send straight back. */
const THROW_BACK: readonly string[] = ['tomato', 'pie'];

type Range = readonly [number, number];
/** An ordinary moment, once the card has landed (ms). */
const MOMENT_MS: Range = [700, 1500];
/** A reply to a throw, whose flight takes about 800ms on screen. */
const HIT_MS: Range = [900, 1600];
/** Added after the hand-end sequence, so every screen has shown the result first. */
const HAND_END_MARGIN_MS = 1000;

/**
 * Tests switch the chatter off (vitest.setup.ts), or on with dice they script, through this. Nothing
 * sets it in production, where the chatter is on with secure dice.
 */
interface ChatterControl {
  off?: boolean;
  rng?: Rng;
}

const g = globalThis as typeof globalThis & {
  __heartsChatter?: ChatterControl;
  __heartsCatTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
/** One pending reaction per game, on timers of its own: rescheduleBots clears botTimers on every move. */
const timers: Map<string, ReturnType<typeof setTimeout>> = (g.__heartsCatTimers ??= new Map());

/** What one cat will say: an emote (`to` null) or a throw at someone. */
export interface Reaction {
  cat: number;
  taunt: string;
  to: number | null;
}

type Seat = Pick<SeatedPlayer, 'seat' | 'userId' | 'isBot'>;

const chance = (rng: Rng, oneIn: number) => rng(oneIn) === 0;
const pick = <T>(rng: Rng, list: readonly T[]): T => list[list.length > 1 ? rng(list.length) : 0];
const between = (rng: Rng, [min, max]: Range) => min + rng(max - min + 1);
const momentOf = (e: TableEvent): Moment => (e.kind === 'sun' || e.kind === 'moon' ? 'shot' : e.kind);

/** The one moment of a change worth a reaction: the biggest, and the latest of those. */
function biggest(events: readonly TableEvent[]): TableEvent | null {
  let best: TableEvent | null = null;
  for (const e of events) if (!best || PRIORITY.indexOf(momentOf(e)) <= PRIORITY.indexOf(momentOf(best))) best = e;
  return best;
}

/**
 * Which cat (if any) reacts to a moment, and how. It's handed the moment and who sits where, nothing
 * else, so no reaction can hang on a hidden card. Only real cats react: a seat on autopilot is still
 * a person's (isBot is false), and so is a seat in the final trick the server plays for people.
 */
export function reactionTo(event: TableEvent, players: readonly Seat[], rng: Rng): Reaction | null {
  const moment = momentOf(event);
  const says = SAYS[moment];
  const subject = players.find((p) => p.seat === event.seat);
  if (subject?.isBot) {
    if (!chance(rng, moment === 'trick' ? ONE_IN.trick : ONE_IN.involved)) return null;
    return { cat: subject.userId, taunt: pick(rng, says.own), to: null };
  }
  // A person's Q♠ or shot: some other cat may have a word.
  const cats = players.filter((p) => p.isBot);
  if (!says.other || !cats.length || !chance(rng, ONE_IN.onlooker)) return null;
  return { cat: pick(rng, cats).userId, taunt: pick(rng, says.other), to: null };
}

/** How a cat answers a throw that hit it, if it does. */
export function hitReaction(cat: number, from: number, thrown: string, rng: Rng): Reaction | null {
  const says = HIT[thrown];
  if (!says || !chance(rng, ONE_IN.involved)) return null;
  if (THROW_BACK.includes(thrown) && chance(rng, ONE_IN.throwBack)) return { cat, taunt: thrown, to: from };
  return { cat, taunt: pick(rng, says), to: null };
}

/** Someone seated has the table open. Cats play on at tables nobody is watching, and that costs nothing. */
function watching(gameId: string, players: readonly Seat[]): boolean {
  const people = new Set(players.filter((p) => !p.isBot).map((p) => p.userId));
  return subscribers(gameId).some((s) => people.has(s.userId));
}

/**
 * A hand's end waits out the hand-end sequence every screen plays: the final trick held on the felt
 * for its messages (finalTrickHoldMs, as Game.svelte works it out), then any Sun or Moon banner.
 * Null once the game is over, as taunts are for play only.
 */
function handEndDelay(gameId: string): number | null {
  const game = loadGame(gameId);
  const record = game?.status === 'active' ? game.state?.lastHand : null;
  if (!record) return null;
  const s = summarizeHand(record);
  // With no earlier view, every card of the final trick counts as still to land: the longest wait.
  const hold = s.finalTrick ? finalTrickHoldMs(null, s.finalTrick, s, { names: [], me: null, jack: s.jackScored }) : 0;
  return hold + ((s.sun ?? s.moon) !== null ? SHOT_MS : 0) + HAND_END_MARGIN_MS;
}

function later(gameId: string, reaction: Reaction, delay: number) {
  timers.set(
    gameId,
    setTimeout(() => {
      timers.delete(gameId);
      say(gameId, reaction);
    }, delay),
  );
}

/**
 * Send a reaction whose time has come, if it still makes sense: the game still in play, the cat (and
 * whoever it throws at) still seated, someone still looking, and the cat off its cooldown here.
 */
function say(gameId: string, r: Reaction) {
  try {
    if (!subscribers(gameId).length) return;
    const row = sql('SELECT status FROM games WHERE id = ?').get(gameId) as { status: string } | undefined;
    if (row?.status !== 'active') return;
    const players = getPlayers(gameId);
    if (!players.some((p) => p.userId === r.cat && p.isBot)) return;
    if (r.to !== null && !players.some((p) => p.userId === r.to)) return;
    if (!watching(gameId, players) || !takeTauntCooldown(gameId, r.cat).ok) return;
    sendTaunt(gameId, { taunt: r.taunt, from: r.cat, to: r.to });
  } catch (err) {
    console.error(`Failed to send a cat’s taunt in game ${gameId}`, err);
  }
}

/**
 * The face-up moments a saved change made (tableEvents): maybe one cat reacts, a moment later. Called
 * after publish() by both places that play cards. Never throws.
 */
export function catsReact(gameId: string, events: readonly TableEvent[]): void {
  try {
    const { off, rng = secureRng } = g.__heartsChatter ?? {};
    // This runs after every move, so the quick ways out come first.
    if (off || !events.length || timers.has(gameId) || !subscribers(gameId).length) return;
    const event = biggest(events)!;
    const players = getPlayers(gameId);
    if (!watching(gameId, players)) return;
    const reaction = reactionTo(event, players, rng);
    if (!reaction) return;
    const delay = event.handEnd ? handEndDelay(gameId) : between(rng, MOMENT_MS);
    if (delay !== null) later(gameId, reaction, delay);
  } catch (err) {
    console.error(`Failed to plan a cat’s reaction in game ${gameId}`, err);
  }
}

/** A seated cat was just hit by a throw. It may answer, under its own per-game cooldown. Never throws. */
export function catHit(gameId: string, catUserId: number, fromUserId: number, tauntId: string): void {
  try {
    const { off, rng = secureRng } = g.__heartsChatter ?? {};
    const thrown = tauntById(tauntId);
    if (off || thrown?.kind !== 'throw' || timers.has(gameId) || !subscribers(gameId).length) return;
    const players = getPlayers(gameId);
    if (!players.some((p) => p.userId === catUserId && p.isBot) || !watching(gameId, players)) return;
    const reaction = hitReaction(catUserId, fromUserId, thrown.id, rng);
    if (reaction) later(gameId, reaction, between(rng, HIT_MS));
  } catch (err) {
    console.error(`Failed to plan a cat’s answer in game ${gameId}`, err);
  }
}

/** Drop a game's pending reaction: the game was deleted, or the playtest panel undid or redealt. */
export function clearCatReaction(gameId: string): void {
  const timer = timers.get(gameId);
  if (timer) clearTimeout(timer);
  timers.delete(gameId);
}
