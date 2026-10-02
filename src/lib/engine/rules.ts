import { type Card, newDeck } from './cards';

/** House rules a room owner can tune. Defaults match the family's game. */
export interface GameSettings {
  /** Game ends after a hand in which anyone reaches this total. `null` = no limit (owner ends the game). */
  scoreLimit: number | null;
  /** Taking the Jack of Diamonds is worth -10. */
  jackOfDiamonds: boolean;
  /** Taking every heart and the Queen of Spades gives everyone else +26. */
  shootTheMoon: boolean;
  /** Winning every trick gives everyone else +52. */
  shootTheSun: boolean;
  /** Hearts and the Queen of Spades can't be dumped on the first trick (unless that's all you have). */
  noPointsOnFirstTrick: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  scoreLimit: null,
  jackOfDiamonds: true,
  shootTheMoon: true,
  shootTheSun: true,
  noPointsOnFirstTrick: true,
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 5;
export const PASS_COUNT = 3;
export const CRIB_SIZE = 4;
export const JACK_VALUE = -10;
export const MOON_VALUE = 26;
export const SUN_VALUE = 52;

/** Five-player games drop the three non-heart twos so 49 cards split into a 4-card crib and 9 each. */
export const FIVE_PLAYER_REMOVED: readonly Card[] = ['2C', '2D', '2S'];

/** Merge untrusted input onto defaults, keeping only valid values. */
export function normalizeSettings(input: Partial<Record<keyof GameSettings, unknown>> | null | undefined): GameSettings {
  const s = { ...DEFAULT_SETTINGS };
  if (!input) return s;
  const limit = input.scoreLimit;
  if (limit === null || limit === '' || limit === undefined) s.scoreLimit = null;
  else {
    const n = Math.floor(Number(limit));
    s.scoreLimit = Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : null;
  }
  for (const key of ['jackOfDiamonds', 'shootTheMoon', 'shootTheSun', 'noPointsOnFirstTrick'] as const) {
    if (typeof input[key] === 'boolean') s[key] = input[key] as boolean;
  }
  return s;
}

/** The cards in play for a table size. */
export function deckFor(numPlayers: number): Card[] {
  const deck = newDeck();
  return numPlayers === 5 ? deck.filter((c) => !FIVE_PLAYER_REMOVED.includes(c)) : deck;
}

/** 12 cards each with four players, 9 with five. */
export function cardsPerPlayer(numPlayers: number): number {
  return (deckFor(numPlayers).length - CRIB_SIZE) / numPlayers;
}

/**
 * Pass offsets cycle hand to hand. An offset is how many seats to the left the cards travel.
 * 4 players: left, right, across, keep.
 * 5 players: left, right, left across, right across, keep.
 */
export function passCycle(numPlayers: number): number[] {
  const offsets: number[] = [];
  for (let d = 1; d <= Math.floor(numPlayers / 2); d++) {
    for (const o of [d, numPlayers - d]) if (!offsets.includes(o)) offsets.push(o);
  }
  offsets.push(0);
  return offsets;
}

export function passOffsetForHand(handNumber: number, numPlayers: number): number {
  const cycle = passCycle(numPlayers);
  return cycle[(handNumber - 1) % cycle.length];
}

export function passLabel(offset: number, numPlayers: number): string {
  if (offset === 0) return 'Keep';
  if (offset === 1) return 'Left';
  if (offset === numPlayers - 1) return 'Right';
  if (numPlayers === 4 && offset === 2) return 'Across';
  return offset < numPlayers / 2 ? 'Left across' : 'Right across';
}
