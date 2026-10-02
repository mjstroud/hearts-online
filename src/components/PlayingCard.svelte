<script lang="ts">
  import { type Card, RANK_LABEL, SUIT_NAME, rankOf, suitOf } from '../lib/engine/cards';

  interface Props {
    /** Omit (or null) to show the card back. */
    card?: Card | null;
    /** Card width in px. */
    width?: number;
    selected?: boolean;
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
  class:dimmed
  class:fresh
  class:interactive={!!onclick}
  style={`--w: ${width}px`}
  {onclick}
  disabled={onclick ? disabled : undefined}
  aria-label={name}
  aria-pressed={onclick ? selected : undefined}
  title={title ?? (card ? name : undefined)}
  role={onclick ? undefined : 'img'}
>
  {#if card}
    <span class="index" aria-hidden="true"><b class:ten={rank === '10'}>{rank}</b><i class="sym"></i></span>
    {#if compact}
      <span class="big-suit sym" aria-hidden="true"></span>
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
          <i class="sym"></i>
        {/if}
      </span>
      {#if showValue && tag}
        <span class="tag" class:good={card === 'JD'} aria-hidden="true">{tag}</span>
      {/if}
    {/if}
  {:else}
    <span class="emblem" aria-hidden="true"></span>
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
    --suit-mask: var(--mask-s);
  }
  .suit-H {
    --tile: var(--suit-h);
    --suit-mask: var(--mask-h);
  }
  .suit-D {
    --tile: var(--suit-d);
    --suit-mask: var(--mask-d);
  }
  .suit-C {
    --tile: var(--suit-c);
    --suit-mask: var(--mask-c);
  }

  .sym {
    display: block;
    flex: none;
    width: 1em;
    height: 1em;
    background-color: currentColor;
    -webkit-mask: var(--suit-mask) center / contain no-repeat;
    mask: var(--suit-mask) center / contain no-repeat;
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
    --suit-mask: var(--mask-h);
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
    background: var(--card-face);
    -webkit-mask: var(--suit-mask) center / contain no-repeat;
    mask: var(--suit-mask) center / contain no-repeat;
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

  .fresh::after {
    content: 'new';
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

  @media (hover: hover) {
    .interactive:not(:disabled):not(.selected):hover {
      transform: translateY(-10%);
      box-shadow:
        0 0 0 2px color-mix(in srgb, var(--gold) 70%, transparent),
        var(--card-lift-shadow);
    }
  }
</style>
