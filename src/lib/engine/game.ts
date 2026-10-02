import { chooseBotPass, chooseBotPlay } from './bot';
import { type Card, type Rng, secureRng } from './cards';
import { type DealOptions, type HandState, RuleError, dealHand, playCard, submitPass } from './hand';
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
  /** The host asked to end the game once the hand in progress is finished. */
  endAfterHand?: boolean;
}

export interface ActionResult {
  completedHand: HandRecord | null;
  gameOver: boolean;
}

export function newGame(numPlayers: number, rng: Rng = secureRng): GameState {
  return {
    numPlayers,
    hand: dealHand(1, numPlayers, rng),
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

  // The game only ends on a hand boundary: a score limit crossed, or the host's request.
  const limitReached = settings.scoreLimit !== null && Math.max(...game.scores) >= settings.scoreLimit;
  if (limitReached || game.endAfterHand) {
    game.over = true;
    game.hand = null;
    return { completedHand: record, gameOver: true };
  }
  game.hand = dealHand(hand.number + 1, game.numPlayers, rng);
  return { completedHand: record, gameOver: false };
}

/** Throw away the hand in progress and deal it again (playtest tool). */
export function redealHand(game: GameState, rng: Rng = secureRng, opts: DealOptions = {}): void {
  const hand = requireHand(game);
  game.hand = dealHand(hand.number, game.numPlayers, rng, opts);
}

/** Seats the game is waiting on right now. */
export function seatsToAct(game: GameState): number[] {
  const hand = game.hand;
  if (game.over || !hand) return [];
  if (hand.phase === 'passing') return hand.passes.flatMap((p, seat) => (p ? [] : [seat]));
  if (hand.phase === 'playing' && hand.turn !== null) return [hand.turn];
  return [];
}

/**
 * Let the computer make the next required move for whichever seats `allowed` accepts:
 * every pending pass, or the one card that's due. Returns null if nothing was done.
 */
export function aiStep(
  game: GameState,
  settings: GameSettings,
  allowed: (seat: number) => boolean = () => true,
  rng: Rng = secureRng,
): ActionResult | null {
  const hand = game.hand;
  if (game.over || !hand) return null;
  const seats = seatsToAct(game).filter(allowed);
  if (!seats.length) return null;
  if (hand.phase === 'passing') {
    for (const seat of seats) gamePass(game, seat, chooseBotPass(hand.hands[seat]));
    return { completedHand: null, gameOver: false };
  }
  return gamePlay(game, seats[0], chooseBotPlay(hand, seats[0], settings), settings, rng);
}

/** Seats with the lowest total (the leaders / winners). */
export function leaders(scores: number[]): number[] {
  const best = Math.min(...scores);
  return scores.flatMap((s, seat) => (s === best ? [seat] : []));
}
