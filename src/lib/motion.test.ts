import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stand-in for the OS "reduce motion" setting.
const reduced = vi.hoisted(() => ({ current: false }));
vi.mock('svelte/motion', () => ({ prefersReducedMotion: reduced }));

import { fade, fly, scale } from './motion';

const node = {} as Element;

beforeEach(() => {
  // Svelte's transitions read the element's resting opacity and transform.
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', transform: 'none' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  reduced.current = false;
});

describe('motion transitions', () => {
  it('keep their timing when motion is allowed', () => {
    expect(fly(node, { y: 20, duration: 280, delay: 40 })).toMatchObject({ duration: 280, delay: 40 });
    expect(scale(node, { start: 0.9, duration: 180 })).toMatchObject({ duration: 180, delay: 0 });
    expect(fade(node)).toMatchObject({ duration: 400, delay: 0 });
  });

  it('finish at once when reduced motion is on', () => {
    reduced.current = true;
    const all = [
      fade(node, { duration: 160 }),
      fade(node),
      fly(node, { x: -160, duration: 280, delay: 90, opacity: 0.2 }),
      scale(node, { start: 0.96, duration: 200 }),
    ];
    for (const t of all) expect(t).toMatchObject({ duration: 0, delay: 0 });
  });

  it('follow the setting as it changes', () => {
    expect(fade(node, { duration: 150 }).duration).toBe(150);
    reduced.current = true;
    expect(fade(node, { duration: 150 }).duration).toBe(0);
    reduced.current = false;
    expect(fade(node, { duration: 150 }).duration).toBe(150);
  });
});
