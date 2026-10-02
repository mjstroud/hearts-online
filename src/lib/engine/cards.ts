export const SUITS = ['C', 'D', 'S', 'H'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** A card is a two-character code: rank then suit, e.g. "QS", "TD", "2C". */
export type Card = `${Rank}${Suit}`;

export const QUEEN_OF_SPADES: Card = 'QS';
export const JACK_OF_DIAMONDS: Card = 'JD';

export type Rng = (maxExclusive: number) => number;

/** Cryptographically strong, unbiased RNG (Web Crypto) so nobody can predict the deal. */
export const secureRng: Rng = (max) => {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
};

export const suitOf = (card: Card): Suit => card[1] as Suit;
export const rankOf = (card: Card): Rank => card[0] as Rank;
export const rankValue = (card: Card): number => RANKS.indexOf(rankOf(card)) + 2;

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    (RANKS as readonly string[]).includes(value[0]) &&
    (SUITS as readonly string[]).includes(value[1])
  );
}

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(`${rank}${suit}`);
  return deck;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[], rng: Rng = secureRng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SUIT_ORDER: Record<Suit, number> = { C: 0, D: 1, S: 2, H: 3 };

export function compareCards(a: Card, b: Card): number {
  return SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || rankValue(a) - rankValue(b);
}

export function sortCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort(compareCards);
}

export const isHeart = (card: Card) => suitOf(card) === 'H';

/** Cards that carry positive penalty points (hearts and the Queen of Spades). */
export const isPenaltyCard = (card: Card) => isHeart(card) || card === QUEEN_OF_SPADES;

/** Heart + Queen points for a pile of cards (Jack of Diamonds handled separately). */
export function penaltyPoints(cards: readonly Card[]): number {
  let pts = 0;
  for (const c of cards) {
    if (isHeart(c)) pts += 1;
    else if (c === QUEEN_OF_SPADES) pts += 13;
  }
  return pts;
}

export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', S: '♠', H: '♥' };
export const SUIT_NAME: Record<Suit, string> = { C: 'Clubs', D: 'Diamonds', S: 'Spades', H: 'Hearts' };
export const RANK_LABEL: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

export function cardLabel(card: Card): string {
  return `${RANK_LABEL[rankOf(card)]}${SUIT_SYMBOL[suitOf(card)]}`;
}
