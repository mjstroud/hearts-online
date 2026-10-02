import { type Card, type Rng, secureRng } from './cards';
import { type HandState, RuleError, dealHand, playCard, submitPass } from './hand';
import type { GameSettings } from './rules';
import { type HandRecord, scoreHand } from './scoring';

/** Everything about a running game that isn't already in the hand history. */
export interface GameState {
  numPlayers: number;
  hand: HandState | null;
  /** Running totals by seat. */
  scores: number[];
  handsPlayed: number;
  /** The most recently finished hand, for the end-of-hand summary. */
  lastHand: HandRecord | null;
  over: boolean;
}

export interface ActionResult {
  completedHand: HandRecord | null;
  gameOver: boolean;
}

export function newGame(numPlayers: number, settings: GameSettings, rng: Rng = secureRng): GameState {
  return {
    numPlayers,
    hand: dealHand(1, numPlayers, settings, rng),
    scores: Array.from({ length: numPlayers }, () => 0),
    handsPlayed: 0,
    lastHand: null,
    over: false,
  };
}

function requireHand(game: GameState): HandState {
  if (game.over || !game.hand) throw new RuleError('The game is over.');
  return game.hand;
}

export function gamePass(game: GameState, seat: number, cards: Card[]): void {
  submitPass(requireHand(game), seat, cards);
}

export function gamePlay(game: GameState, seat: number, card: Card, settings: GameSettings, rng: Rng = secureRng): ActionResult {
  const hand = requireHand(game);
  const outcome = playCard(hand, seat, card, settings);
  if (!outcome.handComplete) return { completedHand: null, gameOver: false };

  const record = scoreHand(hand, settings);
  game.scores = game.scores.map((total, s) => total + record.scores[s]);
  game.handsPlayed += 1;
  game.lastHand = record;

  if (settings.scoreLimit !== null && Math.max(...game.scores) >= settings.scoreLimit) {
    game.over = true;
    game.hand = null;
    return { completedHand: record, gameOver: true };
  }
  game.hand = dealHand(hand.number + 1, game.numPlayers, settings, rng);
  return { completedHand: record, gameOver: false };
}

/** Seats the game is waiting on right now. */
export function seatsToAct(game: GameState): number[] {
  const hand = game.hand;
  if (game.over || !hand) return [];
  if (hand.phase === 'passing') return hand.passes.flatMap((p, seat) => (p ? [] : [seat]));
  if (hand.phase === 'playing' && hand.turn !== null) return [hand.turn];
  return [];
}

/** Seats with the lowest total (the leaders / winners). */
export function leaders(scores: number[]): number[] {
  const best = Math.min(...scores);
  return scores.flatMap((s, seat) => (s === best ? [seat] : []));
}
