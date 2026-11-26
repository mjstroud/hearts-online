import type { TableView } from './view';

/**
 * The Sun and Moon glows behind a watcher's avatar. They come from the view's public run facts
 * (face-up cards only), so every seat sees the same glow, and they start faint as soon as there's
 * a run at all, then brighten as it gets less likely to be luck.
 */
export type GlowLevel = 1 | 2 | 3;

export interface Glow {
  seat: number;
  kind: 'sun' | 'moon';
  level: GlowLevel;
}

/** The level the glow counts as a real watch: the table's corner names the watcher from here. */
export const WATCH_LEVEL = 2;

/** Sun: faint from the first trick won, clear from 3 in a row, blazing from two thirds of the hand (8 of 12, 6 of 9). */
export function sunLevel(tricks: number, totalTricks: number): GlowLevel | 0 {
  if (tricks < 1) return 0;
  if (tricks < 3) return 1;
  return tricks < Math.ceil((totalTricks * 2) / 3) ? 2 : 3;
}

/** Moon: faint from the first heart, clear from 5 hearts, full once the Q♠ and 7 hearts are in (or 10 hearts). */
export function moonLevel(hearts: number, queen: boolean): GlowLevel | 0 {
  if (hearts < 1) return 0;
  if (hearts < 5) return 1;
  return (queen && hearts >= 7) || hearts >= 10 ? 3 : 2;
}

/**
 * The glow the table shows, if any. Only one seat can have a run of either kind (a Sun runner has
 * taken every point card too), so it's one glow at most: the brighter of the two, the Sun on a tie,
 * as the Sun replaces the Moon in scoring.
 */
export function glowOf(t: Pick<TableView, 'phase' | 'totalTricks' | 'sunRun' | 'moonRun'>): Glow | null {
  if (t.phase !== 'playing') return null;
  const sun = t.sunRun ?? null;
  const moon = t.moonRun ?? null;
  const s = sun ? sunLevel(sun.tricks, t.totalTricks) : 0;
  const m = moon ? moonLevel(moon.hearts, moon.queen) : 0;
  if (sun && s && s >= m) return { seat: sun.seat, kind: 'sun', level: s };
  if (moon && m) return { seat: moon.seat, kind: 'moon', level: m };
  return null;
}
