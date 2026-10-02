import { type Card, JACK_OF_DIAMONDS, QUEEN_OF_SPADES, isHeart, isPenaltyCard, rankValue, suitOf } from './cards';
import { type HandState, legalPlays } from './hand';
import { type GameSettings, PASS_COUNT } from './rules';

/** A simple, sensible computer player. Not a shark, but it won't hand you free points. */

export function chooseBotPass(hand: Card[]): Card[] {
  const spades = hand.filter((c) => suitOf(c) === 'S').length;
  const suitCount = (c: Card) => hand.filter((h) => suitOf(h) === suitOf(c)).length;
  const danger = (c: Card): number => {
    if (c === JACK_OF_DIAMONDS) return -100;
    if (c === QUEEN_OF_SPADES) return spades >= 5 ? 10 : 100;
    const r = rankValue(c);
    if (suitOf(c) === 'S' && r > 12) return hand.includes(QUEEN_OF_SPADES) || spades >= 5 ? r : 80 + r;
    if (isHeart(c)) return r * 3 + 10;
    return r * 2 + (suitCount(c) <= 2 ? 15 : 0);
  };
  return hand
    .slice()
    .sort((a, b) => danger(b) - danger(a))
    .slice(0, PASS_COUNT);
}

const highest = (cards: Card[]) => cards.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
const lowest = (cards: Card[]) => cards.reduce((a, b) => (rankValue(b) < rankValue(a) ? b : a));

function queenPlayed(state: HandState): boolean {
  return (
    state.tricks.some((t) => t.plays.some((p) => p.card === QUEEN_OF_SPADES)) ||
    !!state.current?.plays.some((p) => p.card === QUEEN_OF_SPADES)
  );
}

export function chooseBotPlay(state: HandState, seat: number, settings: GameSettings): Card {
  const legal = legalPlays(state, seat, settings);
  if (legal.length === 0) throw new Error('Bot has no legal play');
  if (legal.length === 1) return legal[0];
  const plays = state.current?.plays ?? [];
  const qsOut = !queenPlayed(state);

  // Leading: start low, and don't flush out the queen onto ourselves.
  if (plays.length === 0) {
    const safe = legal.filter((c) => c !== QUEEN_OF_SPADES && !(qsOut && suitOf(c) === 'S' && rankValue(c) > 12));
    const pool = safe.length ? safe : legal;
    const nonHearts = pool.filter((c) => !isHeart(c));
    return lowest(nonHearts.length ? nonHearts : pool);
  }

  const leadSuit = suitOf(plays[0].card);
  const winning = plays.filter((p) => suitOf(p.card) === leadSuit).reduce((a, b) => (rankValue(b.card) > rankValue(a.card) ? b : a));
  const following = suitOf(legal[0]) === leadSuit;
  const isLast = plays.length === state.numPlayers - 1;
  const trickCards = plays.map((p) => p.card);
  const trickHasPoints = trickCards.some(isPenaltyCard);

  if (following) {
    const under = legal.filter((c) => rankValue(c) < rankValue(winning.card));
    // Grab the Jack (or a clean trick) when we're last and it costs nothing.
    if (isLast && !trickHasPoints) {
      const nonQueen = legal.filter((c) => c !== QUEEN_OF_SPADES);
      if (nonQueen.length) return highest(nonQueen);
    }
    if (under.length) return highest(under);
    const nonQueen = legal.filter((c) => c !== QUEEN_OF_SPADES);
    return isLast || nonQueen.length === 0 ? highest(nonQueen.length ? nonQueen : legal) : lowest(nonQueen.length ? nonQueen : legal);
  }

  // Void in the led suit: dump the worst card we hold.
  if (legal.includes(QUEEN_OF_SPADES)) return QUEEN_OF_SPADES;
  const bigSpades = legal.filter((c) => suitOf(c) === 'S' && rankValue(c) > 12);
  if (qsOut && bigSpades.length) return highest(bigSpades);
  const hearts = legal.filter(isHeart);
  if (hearts.length) return highest(hearts);
  const rest = legal.filter((c) => c !== JACK_OF_DIAMONDS);
  return highest(rest.length ? rest : legal);
}
