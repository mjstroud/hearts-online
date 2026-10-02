import { type Card, isCard } from './cards';
import type { DealSpec } from './hand';
import { FIVE_PLAYER_REMOVED } from './rules';

/** Stacked-deck scenarios for playtesting the house rules. */
export type PresetId = 'random' | 'queen-crib' | 'jack-crib' | 'club-crib' | 'moon' | 'sun' | 'custom';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'random', label: 'Random deal', hint: 'A normal shuffle.' },
  { id: 'queen-crib', label: 'Q♠ in the crib', hint: 'The Queen of Spades hides in the crib.' },
  { id: 'jack-crib', label: 'J♦ in the crib', hint: 'The Jack of Diamonds hides in the crib.' },
  {
    id: 'club-crib',
    label: 'Lowest club in the crib',
    hint: 'The 2♣ (3♣ with five players) is in the crib, so the next-lowest club leads.',
  },
  {
    id: 'moon',
    label: 'Moon setup',
    hint: 'The chosen seat loses the first trick, then holds the top card of every suit. Always play its highest card to shoot the Moon.',
  },
  {
    id: 'sun',
    label: 'Sun setup',
    hint: 'The chosen seat holds the top cards. Always play its highest card to win every trick.',
  },
  { id: 'custom', label: 'Custom deck…', hint: 'Type the cards each seat (and the crib) should get. The rest are dealt at random.' },
];

const MOON: Record<number, Card[]> = {
  4: ['2C', 'AC', 'KC', 'AS', 'KS', 'QS', 'AD', 'KD', 'AH', 'KH', 'QH', 'JH'],
  5: ['3C', 'AC', 'AS', 'KS', 'QS', 'AD', 'AH', 'KH', 'QH'],
};
const SUN: Record<number, Card[]> = {
  4: ['AC', 'KC', 'AD', 'KD', 'AS', 'KS', 'QS', 'JS', 'AH', 'KH', 'QH', 'JH'],
  5: ['AC', 'AD', 'AS', 'KS', 'QS', 'JS', 'AH', 'KH', 'QH'],
};
/** A crib with no points, so the moon shooter can afford to lose the first trick. */
const CLEAN_CRIB: Card[] = ['3D', '4D', '5D', '6D'];

export function presetSpec(id: PresetId, numPlayers: number, seat: number): DealSpec {
  const hands: (Card[] | undefined)[] = Array.from({ length: numPlayers }, () => undefined);
  switch (id) {
    case 'queen-crib':
      return { crib: ['QS'] };
    case 'jack-crib':
      return { crib: ['JD'] };
    case 'club-crib':
      return { crib: [numPlayers === 5 ? '3C' : '2C'] };
    case 'moon':
      hands[seat] = MOON[numPlayers];
      return { hands, crib: CLEAN_CRIB };
    case 'sun':
      hands[seat] = SUN[numPlayers];
      return { hands };
    default:
      return {};
  }
}

/**
 * Parse loosely typed cards: "QS ah 10h 2♣, td". Returns the cards, or an error message.
 */
export function parseCardList(text: string, numPlayers: number): { cards: Card[] } | { error: string } {
  const SUIT_SYMBOLS: Record<string, string> = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };
  const cards: Card[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    let token = raw.toUpperCase().replace(/[♠♥♦♣]/g, (s) => SUIT_SYMBOLS[s]);
    if (token.startsWith('10')) token = 'T' + token.slice(2);
    if (!isCard(token)) return { error: `“${raw}” isn’t a card. Use rank then suit, like QS, 10H or A♦.` };
    if (numPlayers === 5 && FIVE_PLAYER_REMOVED.includes(token)) return { error: `${raw} is removed in five-player games.` };
    cards.push(token);
  }
  return { cards };
}
