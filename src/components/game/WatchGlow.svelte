<script lang="ts" module>
  // The art is drawn once, in an 80-unit box centred on the avatar (r 16 sits under the avatar, r 40
  // is the box's edge, 18px past the avatar ring). Rays leave a gap where the name is (to the right,
  // or below on phones, where the whole glow turns a quarter), so the name stays clear.
  const f = (n: number) => +n.toFixed(1);
  const rad = (deg: number) => (deg * Math.PI) / 180;
  /** Tapered rays: each tucked under the avatar (r0) with half-width w, out to a tip at radius R. */
  function rays(n: number, off: number, r0: number, spec: (i: number) => [number, number]) {
    let d = '';
    for (let i = 0; i < n; i++) {
      const deg = off + (i * 360) / n;
      if (deg % 360 > 50 && deg % 360 < 130) continue;
      const s = Math.sin(rad(deg));
      const c = Math.cos(rad(deg));
      const [R, w] = spec(i);
      d += `M${f(r0 * s + w * c)} ${f(-r0 * c + w * s)}L${f(R * s)} ${f(-R * c)}L${f(r0 * s - w * c)} ${f(-r0 * c - w * s)}Z`;
    }
    return d;
  }
  /** Four-point sparkles at [angle, radius, size]. */
  const stars = (list: [number, number, number][]) =>
    list
      .map(([deg, r, k]) => {
        const x = f(r * Math.sin(rad(deg)));
        const y = f(-r * Math.cos(rad(deg)));
        return `M${x} ${f(y - k)}Q${x} ${y} ${f(x + k)} ${y}Q${x} ${y} ${x} ${f(y + k)}Q${x} ${y} ${f(x - k)} ${y}Q${x} ${y} ${x} ${f(y - k)}Z`;
      })
      .join('');

  // Sun: 12 rays, long and short by turns, with 12 fine ones between them when it blazes.
  const RAY_A = rays(12, 15, 16, (i) => (i % 2 ? [31, 3] : [39, 4.2]));
  const RAY_B = rays(12, 0, 16, () => [30, 1.5]);
  // Moon: a crescent of light on the avatar's upper left (the lit side of ☾), a halo ring with a gap
  // by the name, and sparkles.
  const CRESCENT = 'M-24.6 0a24.6 24.6 0 1 0 49.2 0a24.6 24.6 0 1 0-49.2 0ZM-22.2 .85a23.2 23.2 0 1 0 46.4 0a23.2 23.2 0 1 0-46.4 0Z';
  const HALO = 'M20.9 30A36.5 36.5 0 1 1 34.3-12.5';
  const STAR_A = stars([
    [292, 32, 3],
    [240, 30.5, 2.4],
  ]);
  const STAR_B = stars([
    [340, 33.5, 2.3],
    [205, 31.5, 2.1],
  ]);
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import type { GlowLevel } from '../../lib/engine/watch';

  interface Props {
    kind: 'sun' | 'moon';
    level: GlowLevel;
    /** The run just ended: the light goes out (and the table then takes the glow away). */
    out?: boolean;
    /** Light up with a flourish, for a change the table watched; otherwise it's simply there. */
    ignite?: boolean;
    /** Goes up by one for each level-up the table watched, to play the flare. */
    flare?: number;
  }
  let { kind, level, out = false, ignite = false, flare = 0 }: Props = $props();
  // Only the first value counts: a later update the table didn't watch mustn't replay the ignite.
  const lit = untrack(() => ignite);
  // Gradient ids are per glow: a fading glow and a new one can be on the table at once.
  const id = $props.id();
</script>

<svg class={`glow ${kind} l${level}`} class:lit class:out viewBox="-40 -40 80 80" aria-hidden="true">
  <defs>
    {#if kind === 'sun'}
      <radialGradient id={`${id}r`}><stop offset=".5" stop-color="#fff6cc" /><stop offset=".66" stop-color="#ffc531" /><stop offset="1" stop-color="#f0651a" /></radialGradient>
      <radialGradient id={`${id}c`}><stop offset=".7" stop-color="#ffe9a8" /><stop offset=".86" stop-color="#ffab22" /><stop offset="1" stop-color="#f0651a" /></radialGradient>
    {:else}
      <radialGradient id={`${id}m`}>
        <stop offset=".5" stop-color="#f4f8ff" /><stop offset=".64" stop-color="#c4ddff" stop-opacity=".9" /><stop offset=".78" stop-color="#6aa6f5" stop-opacity=".6" /><stop
          offset=".9"
          stop-color="#3f7fe0"
          stop-opacity=".28"
        /><stop offset="1" stop-color="#3f7fe0" stop-opacity="0" />
      </radialGradient>
    {/if}
  </defs>
  {#key flare}
    <g class:fl={flare > 0}>
      {#if kind === 'sun'}
        <path class="rb" fill={`url(#${id}r)`} d={RAY_B} />
        <path class="ra" fill={`url(#${id}r)`} d={RAY_A} />
        <path class="ash" fill="#8a8178" d={RAY_A} />
        <circle class="co" r="24.5" fill={`url(#${id}c)`} />
        <circle r="21.7" fill="none" stroke="#1d1b19" stroke-width="1.8" />
        <circle class="bu" r="23" fill="none" stroke="#fff3c4" stroke-width="2" />
      {:else}
        <circle class="ml" cx="-2.5" cy="-2.5" r="34" fill={`url(#${id}m)`} />
        <path class="mo" d={HALO} fill="none" stroke="#7cb4ff" stroke-width="1.4" stroke-dasharray="1.2 2.6" stroke-linecap="round" />
        <path class="lb" fill="#eef5ff" stroke="#5b8ddb" stroke-width=".6" fill-rule="evenodd" d={CRESCENT} />
        <g class="ash"><path fill="#8b929c" fill-rule="evenodd" d={CRESCENT} /><path d={HALO} fill="none" stroke="#8b929c" stroke-width="1" /></g>
        <path class="st" fill="#f7faff" stroke="#3f7fe0" stroke-width=".5" d={STAR_A} />
        <path class="st s2" fill="#f7faff" stroke="#3f7fe0" stroke-width=".5" d={STAR_B} />
        <circle class="bu" r="23" fill="none" stroke="#d6e8ff" stroke-width="2" />
      {/if}
    </g>
  {/key}
</svg>

<style>
  /* First in .seat-avatar, at z-index -1: over the plaque's fill, under the acting ring, the avatar,
     its dots and the name. It reaches 18px past the avatar ring. */
  .glow {
    position: absolute;
    left: -18px;
    top: -18px;
    width: calc(100% + 36px);
    height: calc(100% + 36px);
    z-index: -1;
    overflow: visible;
    pointer-events: none;
  }

  /* Phones stack the name under the avatar, so the gap left for it turns to face down. */
  @media (max-width: 640px) {
    .glow {
      rotate: 90deg;
    }
  }

  /* A phone on its side lays the plaques flat again (Table.svelte, same query), so the gap faces the name. */
  @media (orientation: landscape) and (max-height: 500px) and (min-width: 540px) {
    .glow {
      rotate: none;
    }
  }

  /* Every part scales and turns around the avatar's centre (the box's 0,0), whatever the browser's default. */
  .glow * {
    transform-box: view-box;
    transform-origin: 0 0;
  }

  /* Each level shows more of the same art. --o is a part's opacity at this level, so going out dims it from there. */
  .ra,
  .rb,
  .co,
  .ash,
  .bu,
  .ml,
  .mo,
  .lb,
  .st {
    opacity: var(--o, 1);
  }
  .rb,
  .s2,
  .ash,
  .bu,
  .l1 .co,
  .l1 .st {
    --o: 0;
  }
  .l3 .rb,
  .l3 .s2 {
    --o: 1;
  }
  .l1 .ra {
    --o: 0.85;
    transform: scale(0.8);
  }
  .l2 .ra,
  .sun.l2 .ash {
    transform: scale(0.86);
  }
  .l1 .ml {
    --o: 0.6;
    transform: scale(0.8);
  }
  .l2 .ml {
    transform: scale(0.92);
  }
  .l1 .mo {
    --o: 0.55;
  }

  /* Lighting up: the glow swings out from behind the avatar. A level-up swells it and sends out a ring. */
  .lit {
    animation: ignite 0.9s var(--ease);
  }
  .fl {
    animation: swell 0.7s var(--ease);
  }
  .fl .bu {
    animation: burst 0.8s ease-out;
  }

  /* Going out: the light fades to grey ash, then the whole glow sinks away. A faint glow just fades. */
  .out {
    opacity: 0;
    transform: scale(0.6) rotate(-20deg);
    animation: sink 1.1s var(--ease) both;
  }
  .out.l1 {
    animation-duration: 0.5s;
  }
  .out .ra,
  .out .rb,
  .out .co,
  .out .ml,
  .out .mo,
  .out .lb,
  .out .st {
    opacity: 0;
    animation: dim 0.5s var(--ease);
  }
  .out:not(.l1) .ash {
    --o: 0.75;
    animation: ash 0.5s var(--ease);
  }

  @keyframes ignite {
    from {
      opacity: 0;
      transform: scale(0.4) rotate(-60deg);
    }
  }
  @keyframes swell {
    40% {
      transform: scale(1.12);
    }
  }
  @keyframes burst {
    from {
      opacity: 0.9;
      transform: scale(0.9);
    }
    to {
      opacity: 0;
      transform: scale(1.65);
    }
  }
  @keyframes sink {
    from,
    45% {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes dim {
    from {
      opacity: var(--o, 1);
    }
  }
  @keyframes ash {
    from {
      opacity: 0;
    }
  }

  /* Reduced motion: each look holds still. A glow going out shows its grey ash until it's taken away. */
  @media (prefers-reduced-motion: reduce) {
    .glow,
    .glow * {
      animation: none !important;
    }
    .out {
      opacity: 1;
      transform: none;
    }
  }
</style>
