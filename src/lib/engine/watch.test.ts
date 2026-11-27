import { describe, expect, it } from 'vitest';
import { glowOf, moonLevel, sunLevel } from './watch';

describe('glow levels', () => {
  it('Sun: faint from the first trick, clear from 3 in a row, blazing from two thirds of the hand', () => {
    expect([0, 1, 2, 3, 7, 8, 12].map((n) => sunLevel(n, 12))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect([0, 1, 2, 3, 5, 6, 9].map((n) => sunLevel(n, 9))).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('Moon: faint from the first heart, clear from 5, full with the Q♠ and 7 hearts or with 10', () => {
    expect(moonLevel(0, true)).toBe(0);
    expect(moonLevel(1, false)).toBe(1);
    expect(moonLevel(4, true)).toBe(1);
    expect(moonLevel(5, false)).toBe(2);
    expect(moonLevel(9, false)).toBe(2);
    expect(moonLevel(7, true)).toBe(3);
    expect(moonLevel(10, false)).toBe(3);
  });
});

describe('the glow the table shows', () => {
  const base = { phase: 'playing' as const, totalTricks: 12, sunRun: null, moonRun: null };

  it('is the Sun while a Sun run lasts, as bright as the brighter run, then the Moon', () => {
    expect(glowOf(base)).toBeNull();
    expect(glowOf({ ...base, sunRun: { seat: 1, tricks: 1 } })).toEqual({ seat: 1, kind: 'sun', level: 1 });
    expect(glowOf({ ...base, sunRun: { seat: 1, tricks: 2 }, moonRun: { seat: 1, hearts: 3, queen: false } })).toEqual({ seat: 1, kind: 'sun', level: 1 });
    // A clear Moon makes the Sun clear too, so the glow never flips between the two during one run.
    expect(glowOf({ ...base, sunRun: { seat: 1, tricks: 2 }, moonRun: { seat: 1, hearts: 5, queen: false } })).toEqual({ seat: 1, kind: 'sun', level: 2 });
    expect(glowOf({ ...base, sunRun: { seat: 1, tricks: 4 }, moonRun: { seat: 1, hearts: 8, queen: true } })).toEqual({ seat: 1, kind: 'sun', level: 3 });
    // The Sun broken, the Moon carries on.
    expect(glowOf({ ...base, moonRun: { seat: 1, hearts: 5, queen: false } })).toEqual({ seat: 1, kind: 'moon', level: 2 });
    expect(glowOf({ ...base, moonRun: { seat: 3, hearts: 2, queen: true } })).toEqual({ seat: 3, kind: 'moon', level: 1 });
  });

  it('is off outside play, and for a view without runs (an older server)', () => {
    expect(glowOf({ ...base, phase: 'passing', sunRun: { seat: 1, tricks: 3 } })).toBeNull();
    expect(glowOf({ phase: 'playing', totalTricks: 12 } as Parameters<typeof glowOf>[0])).toBeNull();
  });
});
