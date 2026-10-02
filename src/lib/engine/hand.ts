import {
  type Card,
  type Rng,
  cardLabel,
  isHeart,
  isPenaltyCard,
  rankValue,
  secureRng,
  shuffle,
  sortCards,
  suitOf,
} from './cards';
import { CRIB_SIZE, type GameSettings, PASS_COUNT, cardsPerPlayer, deckFor, passOffsetForHand } from './rules';

export interface TrickPlay {
  seat: number;
  card: Card;
}

export interface Trick {
  leader: number;
  plays: TrickPlay[];
  /** Set once every seat has played. */
  winner: number | null;
}

export type HandPhase = 'passing' | 'playing' | 'done';

export interface HandState {
  number: number;
  numPlayers: number;
  /** Seats to the left that passed cards travel; 0 = keep. */
  passOffset: number;
  phase: HandPhase;
  /** Cards as originally dealt (before passing). */
  dealt: Card[][];
  /** Cards currently held. */
  hands: Card[][];
  /** Cards each seat chose to pass (null until chosen). */
  passes: (Card[] | null)[];
  /** Cards each seat received from the pass. */
  received: Card[][];
  /** Face-down cards in the middle, won by whoever takes the first trick. */
  crib: Card[];
  cribWinner: number | null;
  tricks: Trick[];
  current: Trick | null;
  /** Seat whose turn it is while playing. */
  turn: number | null;
  heartsBroken: boolean;
  /** The lowest club dealt to a player — it opens the hand. */
  openingCard: Card;
}

export class RuleError extends Error {}

/** Cards to place before the rest of the deck is dealt at random (playtest scenarios). */
export interface DealSpec {
  hands?: (Card[] | undefined)[];
  crib?: Card[];
}

export interface DealOptions {
  spec?: DealSpec;
  /** Force a pass direction instead of the usual rotation (playtest only). */
  passOffset?: number;
}

/** Place any specified cards, then deal the rest of the deck at random. */
export function stackDeck(numPlayers: number, spec: DealSpec = {}, rng: Rng = secureRng): { hands: Card[][]; crib: Card[] } {
  const per = cardsPerPlayer(numPlayers);
  const deck = deckFor(numPlayers);
  const used = new Set<Card>();
  const place = (cards: Card[] | undefined, max: number, where: string): Card[] => {
    const list = cards ?? [];
    if (list.length > max) throw new RuleError(`${where} can hold at most ${max} cards.`);
    for (const c of list) {
      if (!deck.includes(c)) throw new RuleError(`${cardLabel(c)} isn’t in a ${numPlayers}-player deck.`);
      if (used.has(c)) throw new RuleError(`${cardLabel(c)} is placed twice.`);
      used.add(c);
    }
    return list.slice();
  };
  const hands = Array.from({ length: numPlayers }, (_, s) => place(spec.hands?.[s], per, `Seat ${s + 1}`));
  const crib = place(spec.crib, CRIB_SIZE, 'The crib');
  const rest = shuffle(
    deck.filter((c) => !used.has(c)),
    rng,
  );
  for (const h of hands) while (h.length < per) h.push(rest.pop()!);
  while (crib.length < CRIB_SIZE) crib.push(rest.pop()!);
  return { hands, crib };
}

export function dealHand(handNumber: number, numPlayers: number, rng: Rng = secureRng, opts: DealOptions = {}): HandState {
  const { hands, crib } = stackDeck(numPlayers, opts.spec, rng);
  return startHand(handNumber, numPlayers, hands, crib, opts.passOffset);
}

/** Build a hand from a known deal (used by dealHand and tests). */
export function startHand(
  handNumber: number,
  numPlayers: number,
  hands: Card[][],
  crib: Card[],
  passOffset: number = passOffsetForHand(handNumber, numPlayers),
): HandState {
  const sorted = hands.map((h) => sortCards(h));
  const state: HandState = {
    number: handNumber,
    numPlayers,
    passOffset,
    phase: 'passing',
    dealt: sorted.map((h) => h.slice()),
    hands: sorted,
    passes: Array.from({ length: numPlayers }, () => null),
    received: Array.from({ length: numPlayers }, () => []),
    crib: crib.slice(),
    cribWinner: null,
    tricks: [],
    current: null,
    turn: null,
    heartsBroken: false,
    openingCard: '2C',
  };
  if (passOffset === 0) beginPlay(state);
  return state;
}

function lowestClub(hands: Card[][]): Card {
  let best: Card | null = null;
  for (const hand of hands) {
    for (const c of hand) if (suitOf(c) === 'C' && (!best || rankValue(c) < rankValue(best))) best = c;
  }
  if (!best) throw new Error('No clubs dealt'); // impossible: the crib holds only 4 of the 12+ clubs
  return best;
}

function beginPlay(state: HandState) {
  state.phase = 'playing';
  state.openingCard = lowestClub(state.hands);
  const leader = state.hands.findIndex((h) => h.includes(state.openingCard));
  state.current = { leader, plays: [], winner: null };
  state.turn = leader;
}

export function passTarget(state: HandState, seat: number): number {
  return (seat + state.passOffset) % state.numPlayers;
}

export function submitPass(state: HandState, seat: number, cards: Card[]): void {
  if (state.phase !== 'passing') throw new RuleError('It is not time to pass.');
  if (state.passes[seat]) throw new RuleError('You already passed.');
  const unique = new Set(cards);
  if (cards.length !== PASS_COUNT || unique.size !== PASS_COUNT) throw new RuleError(`Choose exactly ${PASS_COUNT} cards to pass.`);
  for (const c of cards) if (!state.hands[seat].includes(c)) throw new RuleError('You can only pass cards in your hand.');
  state.passes[seat] = sortCards(cards);
  if (state.passes.every(Boolean)) exchangePasses(state);
}

function exchangePasses(state: HandState) {
  const outgoing = state.passes as Card[][];
  const next = state.hands.map((h, seat) => h.filter((c) => !outgoing[seat].includes(c)));
  for (let seat = 0; seat < state.numPlayers; seat++) {
    const to = passTarget(state, seat);
    next[to].push(...outgoing[seat]);
    state.received[to] = outgoing[seat].slice();
  }
  state.hands = next.map((h) => sortCards(h));
  beginPlay(state);
}

const isFirstTrick = (state: HandState) => state.tricks.length === 0;

export function legalPlays(state: HandState, seat: number, settings: GameSettings): Card[] {
  if (state.phase !== 'playing' || state.turn !== seat || !state.current) return [];
  const hand = state.hands[seat];
  const plays = state.current.plays;

  if (plays.length === 0) {
    if (isFirstTrick(state)) return [state.openingCard];
    if (!state.heartsBroken) {
      const nonHearts = hand.filter((c) => !isHeart(c));
      if (nonHearts.length) return nonHearts;
    }
    return hand.slice();
  }

  const leadSuit = suitOf(plays[0].card);
  const following = hand.filter((c) => suitOf(c) === leadSuit);
  if (following.length) return following;

  if (isFirstTrick(state) && settings.noPointsOnFirstTrick) {
    // Points can't be dumped on trick one, unless point cards are all you hold.
    const safe = hand.filter((c) => !isPenaltyCard(c));
    if (safe.length) return safe;
  }
  return hand.slice();
}

export function trickWinner(trick: Trick): number {
  const leadSuit = suitOf(trick.plays[0].card);
  let best = trick.plays[0];
  for (const p of trick.plays) {
    if (suitOf(p.card) === leadSuit && rankValue(p.card) > rankValue(best.card)) best = p;
  }
  return best.seat;
}

export interface PlayOutcome {
  trickComplete: boolean;
  handComplete: boolean;
}

export function playCard(state: HandState, seat: number, card: Card, settings: GameSettings): PlayOutcome {
  if (state.phase !== 'playing' || !state.current) throw new RuleError('It is not time to play.');
  if (state.turn !== seat) throw new RuleError('It is not your turn.');
  if (!state.hands[seat].includes(card)) throw new RuleError('That card is not in your hand.');
  if (!legalPlays(state, seat, settings).includes(card)) throw new RuleError(illegalReason(state, seat, card));

  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  state.current.plays.push({ seat, card });
  if (isHeart(card)) state.heartsBroken = true;

  if (state.current.plays.length < state.numPlayers) {
    state.turn = (seat + 1) % state.numPlayers;
    return { trickComplete: false, handComplete: false };
  }

  const trick = state.current;
  trick.winner = trickWinner(trick);
  state.tricks.push(trick);
  if (state.tricks.length === 1) state.cribWinner = trick.winner;

  if (state.hands.every((h) => h.length === 0)) {
    state.phase = 'done';
    state.current = null;
    state.turn = null;
    return { trickComplete: true, handComplete: true };
  }
  state.current = { leader: trick.winner, plays: [], winner: null };
  state.turn = trick.winner;
  return { trickComplete: true, handComplete: false };
}

function illegalReason(state: HandState, seat: number, card: Card): string {
  const plays = state.current?.plays ?? [];
  if (plays.length === 0) {
    if (isFirstTrick(state)) return `The first trick must be opened with the ${cardLabel(state.openingCard)}.`;
    return 'Hearts have not been broken yet.';
  }
  const leadSuit = suitOf(plays[0].card);
  if (state.hands[seat].some((c) => suitOf(c) === leadSuit)) return 'You must follow suit.';
  return 'No points can be played on the first trick.';
}

/** Every card a seat took this hand (tricks, plus the crib for the first-trick winner). */
export function cardsWon(state: HandState, seat: number): Card[] {
  const won: Card[] = [];
  for (const t of state.tricks) if (t.winner === seat) won.push(...t.plays.map((p) => p.card));
  if (state.cribWinner === seat) won.push(...state.crib);
  return won;
}

export function tricksWon(state: HandState, seat: number): number {
  return state.tricks.filter((t) => t.winner === seat).length;
}
