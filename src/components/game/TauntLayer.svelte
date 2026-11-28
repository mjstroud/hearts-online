<!-- Only ever loaded with import(), so its CSS comes in its own JS chunk rather than on every game page. -->
<svelte:options css="injected" />

<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChatShow } from '../../lib/chat-client';
  import { COVER, type Obstacle, type Rect, type Spot, type TauntShow, arc, beside } from '../../lib/taunt-client';
  import { EMOTES, THROWS, tauntById } from '../../lib/taunts';

  interface Props {
    /** Taunts to draw, newest last (Game.svelte keeps them). */
    feed: TauntShow[];
    /** Chat previews to draw on their senders' avatars, newest last. */
    chatFeed?: ChatShow[];
    /** Changes with every card played to the trick, so a preview a card lands under makes way. */
    trickKey?: string;
    /** The tray: your own emotes (`to` null), or throws at someone, or closed. */
    tray: { to: number | null; name: string } | null;
    /** When you may taunt again, on this device's clock. */
    cooldownUntil: number;
    send: (taunt: string, to: number | null) => void;
    close: () => void;
    /** Told each time a taunt is actually drawn, with who sent it. */
    shown?: (from: number) => void;
  }
  let { feed, chatFeed = [], trickKey = '', tray, cooldownUntil, send, close, shown }: Props = $props();

  // ----- What's on screen: a bubble by an avatar, or something in flight. Each is placed once, when it
  // starts, and taken away by a timer (reduced motion finishes animations at once, so never animationend).
  interface Item {
    key: number;
    emoji: string;
    cls: string;
    style: string;
  }
  let items = $state<Item[]>([]);
  let layer: HTMLDivElement;
  let seen = 0;
  let keys = 0;
  const px = (n: number) => `${Math.round(n)}px`;

  /** What a bubble should keep off, as things stand when it starts (sideways, the name, chips and hand lie over the table). */
  function obstacles(box: DOMRect, sender: number): Obstacle[] {
    const table = layer.closest('.layout') ?? document;
    const all = (selector: string, weight: number | ((e: Element) => number)) =>
      [...table.querySelectorAll(selector)].map((e) => {
        const r = e.getBoundingClientRect();
        const w = typeof weight === 'number' ? weight : weight(e);
        return { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top, weight: w };
      });
    const whose = (e: Element) => (e.closest<HTMLElement>('[data-user]')?.dataset.user === String(sender) ? COVER.own : COVER.plaque);
    return [
      ...all('.trick .played .index > *, .hand .pc .index > *', COVER.corner),
      ...all('.action-bar', COVER.button),
      ...all('.seat .plaque', whose),
      ...all('.msg, .counter, .statusbar .game-name, .statusbar .badge, .statusbar .chat-btn', COVER.message),
      ...all('.seat-tags .tag', COVER.tag),
    ];
  }

  /**
   * Where a bubble may go: the table, plus the bit of screen just around it that you can see. Upright,
   * that's the name and chips above the top seats; never under the site's header, and never far off the table.
   */
  function room(box: DOMRect): Rect {
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    const MORE = 60;
    return {
      left: Math.max(-box.left, -MORE),
      top: Math.max(Math.max(0, header?.bottom ?? 0) - box.top, -MORE),
      right: Math.min(innerWidth - box.left, box.width + MORE),
      bottom: Math.min(innerHeight - box.top, box.height + MORE),
    };
  }

  function start(s: TauntShow) {
    const t = tauntById(s.taunt);
    // A few at once is plenty: any more would bury the table.
    if (!t || items.length >= 6) return;
    // The layer covers the arena exactly, and the seats are its siblings.
    const box = layer.getBoundingClientRect();
    const spot = (id: number | null): Spot | null => {
      const r = id === null ? null : layer.parentElement?.querySelector(`[data-user="${id}"] .seat-avatar`)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, size: r.width } : null;
    };
    const from = spot(s.from);
    const to = t.kind === 'throw' ? spot(s.to) : null;
    // Someone who's just left the table has no avatar to start from or aim at.
    if (!from || (t.kind === 'throw' && !to)) return;
    // Asked afresh each time (not svelte/motion, which would split into a chunk the game page then fetches).
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cls = 'b';
    let style: string;
    let ms = still ? 1600 : 2200;
    if (to && !still) {
      cls = 't';
      ms = 1150;
      style = `${arc(from, to)
        .map(([x, y], i) => `--p${i}:${px(x)},${px(y)}`)
        .join(';')};--r:${to.x < from.x ? -28 : 28}deg`;
    } else {
      // An emote, or (reduced motion) a throw that has simply landed beside its target.
      // Beside whoever it's about: the sender's emote, or the target of a throw that has landed.
      const b = beside(to ?? from, { width: box.width, height: box.height }, obstacles(box, to ? (s.to ?? s.from) : s.from), room(box));
      if (to) cls = 'b hit';
      style = `left:${px(b.x)};top:${px(b.y)};transform-origin:${Math.round(50 - b.ux * 50)}% ${Math.round(50 - b.uy * 50)}%`;
    }
    const key = ++keys;
    items.push({ key, emoji: t.emoji, cls, style });
    setTimeout(() => (items = items.filter((i) => i.key !== key)), ms);
    shown?.(s.from);
  }

  // Each new arrival starts once. A tab that loads this late (on the first taunt) still plays that one.
  $effect(() => {
    const list = feed;
    untrack(() => {
      for (const s of list) {
        if (s.id <= seen) continue;
        seen = s.id;
        if (Date.now() - s.at < 3000) start(s);
      }
    });
  });

  // ----- Chat previews: a new message, cut short, beside its sender's avatar for a few seconds. One per person
  // at a time (a newer one replaces it), and placed once it's drawn, when its size is known.
  interface Note {
    key: number;
    from: number;
    text: string;
    ms: number;
  }
  let notes = $state<Note[]>([]);
  let seenChat = 0;

  function startNote(s: ChatShow) {
    // Long enough to read a line or two.
    const ms = Math.min(6000, 2500 + s.text.length * 40);
    const key = ++keys;
    // Four at most: everyone else at a table of five.
    notes = [...notes.filter((n) => n.from !== s.from).slice(-3), { key, from: s.from, text: s.text, ms }];
    setTimeout(() => (notes = notes.filter((n) => n.key !== key)), ms);
  }

  $effect(() => {
    const list = chatFeed;
    untrack(() => {
      for (const s of list) {
        if (s.id <= seenChat) continue;
        seenChat = s.id;
        if (Date.now() - s.at < 3000) startNote(s);
      }
    });
  });

  /** Another preview or emote already up: a new one goes elsewhere rather than on top of it. */
  const OTHER_NOTE = 30;

  /** Beside its sender's avatar, clear of rank corners. If every spot would cover one, it isn't shown: the count on the chat button still says there's a message. */
  const place = (from: number) => (el: HTMLElement) => {
    const box = layer.getBoundingClientRect();
    const r = layer.parentElement?.querySelector(`[data-user="${from}"] .seat-avatar`)?.getBoundingClientRect();
    // Its laid-out size: the box on screen is still scaled down by the animation's first frame. The width is
    // fixed at that, so moving it near an edge can't make it wrap onto more lines than were measured.
    if (!r || !el.offsetWidth) return;
    el.style.width = px(el.offsetWidth + 1);
    const half = { x: el.offsetWidth / 2, y: el.offsetHeight / 2 };
    const a = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, size: r.width };
    const others = [...layer.querySelectorAll<HTMLElement>('.note, .b')]
      .filter((o) => o !== el && o.style.visibility !== 'hidden' && (o.classList.contains('b') || o.style.visibility === 'visible'))
      .map((o) => {
        const q = o.getBoundingClientRect();
        return { left: q.left - box.left, top: q.top - box.top, right: q.right - box.left, bottom: q.bottom - box.top, weight: OTHER_NOTE };
      });
    const b = beside(a, { width: box.width, height: box.height }, [...obstacles(box, from), ...others], room(box), half);
    if (b.cost >= COVER.corner) return;
    el.style.left = px(b.x - half.x);
    el.style.top = px(b.y - half.y);
    el.style.transformOrigin = `${Math.round(50 - b.ux * 50)}% ${Math.round(50 - b.uy * 50)}%`;
    el.style.visibility = 'visible';
  };

  // A card played after a preview went up may land under it: once the card has slid in, any preview over a
  // rank corner makes way (the count on the chat button still says there's a message).
  $effect(() => {
    void trickKey;
    const timer = setTimeout(() => {
      if (!notes.length) return;
      const corners = [...(layer.closest('.layout') ?? document).querySelectorAll('.trick .played .index > *')].map((c) => c.getBoundingClientRect());
      const over = new Set<number>();
      for (const el of layer.querySelectorAll<HTMLElement>('.note')) {
        const q = el.getBoundingClientRect();
        if (corners.some((c) => c.left < q.right && c.right > q.left && c.top < q.bottom && c.bottom > q.top)) over.add(Number(el.dataset.key));
      }
      if (over.size) notes = notes.filter((n) => !over.has(n.key));
    }, 450);
    return () => clearTimeout(timer);
  });

  // ----- The tray. While the cooldown runs it counts down, once a second, only while it's open.
  let now = $state(Date.now());
  $effect(() => {
    const until = cooldownUntil;
    if (!tray) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      now = Date.now();
      const rest = until - now;
      if (rest > 0) timer = setTimeout(tick, rest % 1000 || 1000);
    };
    tick();
    return () => clearTimeout(timer);
  });
  const left = $derived(Math.max(0, Math.ceil((cooldownUntil - now) / 1000)));

  /** Focus moves into the tray, so Tab reaches its buttons and Escape closes it without reaching the hand result's. */
  function own(el: HTMLElement) {
    // The avatar that opened it gets focus back when it closes, so a keyboard player isn't sent back to the top.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('keydown', key);
      const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
      if (lost && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }
</script>

<div class="taunts" bind:this={layer} aria-hidden="true">
  {#each items as it (it.key)}<span class={it.cls} style={it.style}>{it.emoji}</span>{/each}
  {#each notes as n (n.key)}<span class="note" data-key={n.key} style={`--ms: ${n.ms}ms`} {@attach place(n.from)}
      ><span>{n.text}</span></span
    >{/each}
</div>

{#if tray}
  {@const to = tray.to}
  <div
    class="taunt-tray panel"
    data-tray
    role="dialog"
    aria-label={to === null ? 'Send an emote' : `Throw at ${tray.name}`}
    tabindex="-1"
    {@attach own}
  >
    <p class="head">
      {#if to === null}<span class="nm">Send an emote</span>{:else}Throw at&nbsp;<span class="nm">{tray.name}</span>{/if}
      {#if left}<span class="wait num">Ready in {left}s</span>{/if}
    </p>
    <div class="grid">
      {#each to === null ? EMOTES : THROWS as t (t.id)}
        <button
          aria-label={t.label}
          title={t.label}
          disabled={left > 0}
          onclick={() => {
            send(t.id, to);
            close();
          }}>{t.emoji}</button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  /* One overlay for every bubble and throw: over the seats (3) and the message slot (4), under the trick
     inspector and the tray (6). Outside the felt, so nothing is clipped, and taps go straight through. */
  .taunts {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
  }

  .b,
  .t {
    position: absolute;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  /* An emote: a small light bubble that pops out of the avatar, holds, and fades. */
  .b {
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    border-radius: 50%;
    background: var(--card-face);
    box-shadow: var(--plaque-shadow);
    font-size: 28px;
    animation: pop 2.2s var(--ease) both;
  }

  /* A throw that has landed (reduced motion): just the thing itself, beside its target. */
  .b.hit {
    background: none;
    box-shadow: none;
    font-size: 34px;
  }

  /* A throw: arcs from one avatar to the other, then a short pop where it lands. Placed by transform alone. */
  .t {
    left: 0;
    top: 0;
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    font-size: 34px;
    animation: throw 1.15s linear both;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.3);
    }
    12% {
      opacity: 1;
      transform: scale(1.08);
    }
    20%,
    82% {
      opacity: 1;
      transform: none;
    }
    to {
      opacity: 0;
      transform: scale(0.85);
    }
  }

  /* Flight to 65% (about 750ms), at a steady pace between points on the curve, then the landing pop. */
  @keyframes throw {
    from {
      opacity: 0;
      transform: translate(var(--p0)) scale(0.7);
    }
    6% {
      opacity: 1;
    }
    16% {
      transform: translate(var(--p1)) rotate(calc(var(--r) * 0.25)) scale(0.9);
    }
    33% {
      transform: translate(var(--p2)) rotate(calc(var(--r) * 0.5)) scale(1.1);
    }
    49% {
      transform: translate(var(--p3)) rotate(calc(var(--r) * 0.75));
    }
    65% {
      opacity: 1;
      transform: translate(var(--p4)) rotate(var(--r));
      animation-timing-function: ease-out;
    }
    to {
      opacity: 0;
      transform: translate(var(--p4)) rotate(var(--r)) scale(1.8);
    }
  }

  /* A chat preview: two lines at most, cut short with "…". Hidden until it's placed (TauntLayer's place()). */
  .note {
    position: absolute;
    left: 0;
    top: 0;
    visibility: hidden;
    max-width: min(176px, 56%);
    padding: 6px 10px;
    border-radius: 12px;
    background: var(--card-face);
    box-shadow: var(--plaque-shadow);
    color: #1d1b19;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
    animation: note var(--ms, 4s) var(--ease) both;
  }

  /* Clamped inside the padding, so a third line can't show through it. */
  .note > span {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  /* Grows out of the avatar (transform-origin points at it), holds, and fades. */
  @keyframes note {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    6% {
      opacity: 1;
      transform: none;
    }
    90% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  /* Reduced motion: a still bubble (a throw is drawn already landed), taken away by its timer. */
  @media (prefers-reduced-motion: reduce) {
    .b,
    .note {
      animation: none;
    }
  }

  /* Opens where the trick inspector does, over the middle of the table. */
  .taunt-tray {
    position: absolute;
    z-index: 6;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(240px, calc(100% - 16px));
    padding: 10px;
    font-size: 12px;
    outline: none;
    animation: tray-in 0.12s ease-out;
  }

  /* Fades in like the inspector (reduced motion: the global rule makes it instant). */
  @keyframes tray-in {
    from {
      opacity: 0;
    }
  }

  .head {
    display: flex;
    white-space: nowrap;
    color: var(--muted);
  }

  /* A 32-character name is cut short. "Ready in 12s" never is. */
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wait {
    flex: none;
    margin-left: auto;
    padding-left: 8px;
    color: var(--gold);
    font-weight: 600;
  }

  /* Four to a row: two rows of emotes, one of throws. Each button is a full 44px tap or more. */
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(44px, 1fr));
    gap: 6px;
    margin-top: 8px;
  }

  .grid button {
    height: 48px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: rgb(var(--lo) / 0.25);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: transform 0.15s var(--ease);
  }

  .grid button:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: rgb(var(--hi) / 0.06);
  }

  .grid button:active:not(:disabled) {
    transform: scale(0.92);
  }

  .grid button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
