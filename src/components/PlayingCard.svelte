<script lang="ts">
  import { type Card, RANK_LABEL, SUIT_NAME, type Suit, rankOf, suitOf } from '../lib/engine/cards';

  /**
   * Suit shapes on a 100-unit square, drawn as inline SVG. They used to be CSS masks over a solid
   * colour, but Firefox leaves a hairline of that colour along a masked symbol's edge when the card is
   * rotated, as trick cards are. The club's circles all wind the same way, so they merge.
   */
  const SUIT_PATH: Record<Suit, string> = {
    S: 'M50 4C56 18 94 36 94 60 94 74 83 82 72 82 64 82 57 78 54 73 55 83 58 90 66 96H34C42 90 45 83 46 73 43 78 36 82 28 82 17 82 6 74 6 60 6 36 44 18 50 4z',
    H: 'M50 93C46 87 7 63 5 36 4 18 17 6 31 6c9 0 16 5 19 13 3-8 10-13 19-13 14 0 27 12 26 30-2 27-41 51-45 57z',
    D: 'M50 3C59 21 71 37 88 50 71 63 59 79 50 97 41 79 29 63 12 50 29 37 41 21 50 3z',
    C: 'M30 27a20 20 0 1 0 40 0 20 20 0 1 0-40 0M7 57a20 20 0 1 0 40 0 20 20 0 1 0-40 0M53 57a20 20 0 1 0 40 0 20 20 0 1 0-40 0M38 50a12 12 0 1 0 24 0 12 12 0 1 0-24 0M47 58C47 78 43 88 33 96H67C57 88 53 78 53 58z',
  };

  interface Props {
    /** Omit (or null) to show the card back. */
    card?: Card | null;
    /** Card width in px. */
    width?: number;
    selected?: boolean;
    /** Queued to play the moment your turn arrives. */
    queued?: boolean;
    dimmed?: boolean;
    /** Just received in the pass. */
    fresh?: boolean;
    /** Show the house-rule value tag on the Queen of Spades / Jack of Diamonds. */
    showValue?: boolean;
    jackScored?: boolean;
    onclick?: () => void;
    disabled?: boolean;
    title?: string;
  }

  let {
    card = null,
    width = 84,
    selected = false,
    queued = false,
    dimmed = false,
    fresh = false,
    showValue = true,
    jackScored = true,
    onclick,
    disabled = false,
    title,
  }: Props = $props();

  const r = $derived(card ? rankOf(card) : null);
  const rank = $derived(r ? RANK_LABEL[r] : '');
  const face = $derived(r === 'J' || r === 'Q' || r === 'K');
  const ace = $derived(r === 'A');
  /** Small cards (side panels, playtest rows) drop the big art and show a giant index instead. */
  const compact = $derived(width < 56);
  const tag = $derived(card === 'QS' ? '+13' : card === 'JD' && jackScored ? '−10' : null);
  // The back's emblem is a heart.
  const shape = $derived(SUIT_PATH[card ? suitOf(card) : 'H']);
  const name = $derived(
    card
      ? `${rank === 'J' ? 'Jack' : rank === 'Q' ? 'Queen' : rank === 'K' ? 'King' : rank === 'A' ? 'Ace' : rank} of ${SUIT_NAME[suitOf(card)]}`
      : 'Face-down card',
  );
</script>

<svelte:element
  this={onclick ? 'button' : 'div'}
  type={onclick ? 'button' : undefined}
  class={`pc ${card ? `suit-${suitOf(card)}` : 'back'}`}
  class:ace
  class:compact
  class:selected
  class:queued
  class:dimmed
  class:fresh={fresh && !queued}
  class:interactive={!!onclick}
  style={`--w: ${width}px`}
  {onclick}
  disabled={onclick ? disabled : undefined}
  aria-label={queued ? `${name}, plays next` : name}
  aria-pressed={onclick ? selected : undefined}
  title={title ?? (card ? name : undefined)}
  role={onclick ? undefined : 'img'}
>
  {#if queued}<span class="next" aria-hidden="true">Next</span>{/if}
  {#if card}
    <span class="index" aria-hidden="true"
      ><b class:ten={rank === '10'}>{rank}</b><svg class="sym" viewBox="0 0 100 100"><path d={shape} /></svg></span
    >
    {#if compact}
      <svg class="big-suit sym" viewBox="0 0 100 100" aria-hidden="true"><path d={shape} /></svg>
    {:else}
      <!-- One giant symbol (a crown on face cards), cropped by the corner like a watermark. -->
      <span class="art" aria-hidden="true">
        {#if face}
          <svg class="crown" viewBox="0 0 40 26">
            {#if r === 'K'}
              <path d="M5 21 3 6l9 7 8-11 8 11 9-7-2 15z" />
              <circle cx="3" cy="6" r="2.6" /><circle cx="20" cy="2.8" r="2.8" /><circle cx="37" cy="6" r="2.6" />
            {:else if r === 'Q'}
              <path d="M5 21v-8q4-8 8 0 7-13 14 0 4-8 8 0v8z" />
              <circle cx="9" cy="7" r="2.2" /><circle cx="20" cy="3.2" r="2.8" /><circle cx="31" cy="7" r="2.2" />
            {:else}
              <path d="M5 21v-6l7 3 8-10 8 10 7-3v6z" />
              <circle cx="20" cy="6" r="2.6" />
            {/if}
            <rect x="4" y="22" width="32" height="4" rx="1.2" />
          </svg>
        {:else}
          <svg class="sym" viewBox="0 0 100 100"><path d={shape} /></svg>
        {/if}
      </span>
      {#if showValue && tag}
        <span class="tag" class:good={card === 'JD'} aria-hidden="true">{tag}</span>
      {/if}
    {/if}
  {:else}
    <svg class="emblem" viewBox="0 0 100 100" aria-hidden="true"><path d={shape} /></svg>
  {/if}
</svelte:element>

<style>
  .pc {
    --h: calc(var(--w) * 1.4);
    position: relative;
    display: block;
    flex: none;
    width: var(--w);
    height: var(--h);
    padding: 0;
    border: 0;
    border-radius: calc(var(--w) * 0.12);
    background-color: var(--tile);
    background-image: var(--card-sheen);
    color: var(--card-ink);
    box-shadow: var(--card-shadow);
    font-family: var(--card-font);
    user-select: none;
    -webkit-user-select: none;
    container-type: inline-size;
    transition:
      transform 0.18s var(--ease),
      box-shadow 0.18s var(--ease);
  }

  /* Each card is a solid tile of its suit colour. */
  .suit-S {
    --tile: var(--suit-s);
  }
  .suit-H {
    --tile: var(--suit-h);
  }
  .suit-D {
    --tile: var(--suit-d);
  }
  .suit-C {
    --tile: var(--suit-c);
  }

  .sym {
    display: block;
    flex: none;
    width: 1em;
    height: 1em;
    fill: currentColor;
  }

  /* ----- Corner index: big and bold so a fanned hand reads at a glance. Sizes are in cqi, hundredths of the card's width. ----- */
  .index {
    position: absolute;
    z-index: 1;
    top: 7cqi;
    left: 9cqi;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 0.86;
    font-variation-settings: 'wdth' 112;
  }

  .index b {
    font-weight: 800;
    font-size: 42cqi;
    letter-spacing: -0.03em;
  }

  .index b.ten {
    letter-spacing: -0.1em;
    margin-left: -0.08em;
    font-size: 37cqi;
  }

  .index .sym {
    font-size: 22cqi;
    margin-top: 3cqi;
  }

  .art {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: end;
    overflow: hidden;
    border-radius: inherit;
    font-size: 86cqi;
    opacity: 0.28;
  }

  .art > * {
    translate: 24% 20%;
  }

  .ace .art {
    font-size: 96cqi;
  }

  .crown {
    width: 1.15em;
    fill: currentColor;
  }

  .tag {
    position: absolute;
    z-index: 2;
    bottom: 7cqi;
    left: 30%;
    transform: translateX(-50%);
    font-family: var(--font-ui);
    font-size: 11cqi;
    font-weight: 800;
    padding: 1.5cqi 5cqi;
    border-radius: 99px;
    background: var(--tag-bg);
    color: var(--tag-ink);
    letter-spacing: 0.02em;
    line-height: 1.2;
    white-space: nowrap;
  }

  .tag.good {
    background: var(--tag-good-bg);
    color: var(--tag-good-ink);
  }

  /* ----- Compact cards: just a giant index ----- */
  .compact .index {
    top: 6cqi;
    left: 8cqi;
  }

  .compact .index b {
    font-size: 46cqi;
  }

  .compact .index b.ten {
    font-size: 40cqi;
  }

  .compact .index .sym {
    font-size: 30cqi;
  }

  .big-suit {
    position: absolute;
    right: 7cqi;
    bottom: 7cqi;
    font-size: 42cqi;
    opacity: 0.9;
  }

  /* ----- Card back ----- */
  .back {
    background: var(--card-face);
  }

  .back::before {
    content: '';
    position: absolute;
    inset: 6cqi;
    border-radius: calc(var(--w) * 0.084);
    background: var(--back-panel);
  }

  .emblem {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 22cqi;
    height: 22cqi;
    transform: translate(-50%, -50%);
    fill: var(--card-face);
  }

  /* ----- States ----- */
  .interactive {
    cursor: pointer;
  }

  .interactive:disabled {
    cursor: not-allowed;
  }

  /* A translucent shade is far cheaper to draw than a CSS filter. */
  .dimmed::before {
    content: '';
    position: absolute;
    inset: -1px;
    z-index: 3;
    border-radius: inherit;
    background: var(--card-dim);
  }

  .selected {
    transform: translateY(-18%);
    box-shadow:
      0 0 0 3px var(--gold),
      var(--card-lift-shadow);
  }

  /* Raised a little less than a picked card, with a sky outline: outline isn't in the transition list, so only the lift moves. */
  .queued {
    transform: translateY(-12%);
    outline: 2px solid var(--sky);
    outline-offset: 2px;
  }

  .fresh::after,
  .next {
    position: absolute;
    top: -10px;
    left: 2px;
    z-index: 4;
    padding: 1px 6px;
    border-radius: 99px;
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: var(--mint);
    color: #04261a;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
    text-transform: uppercase;
  }

  .fresh::after {
    content: 'new';
  }

  .next {
    background: var(--sky);
    color: #04182e;
  }

  @media (hover: hover) {
    .interactive:not(:disabled):not(.selected):not(.queued):hover {
      transform: translateY(-10%);
      box-shadow:
        0 0 0 2px color-mix(in srgb, var(--gold) 70%, transparent),
        var(--card-lift-shadow);
    }
  }
</style>
