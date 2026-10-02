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
  /** Small cards drop the centre art and show a big index instead. */
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
  class:face
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
    {#if !compact}<span class="frame" aria-hidden="true"></span>{/if}
    <span class="index tl" aria-hidden="true"><b class:ten={rank === '10'}>{rank}</b><i class="sym"></i></span>
    {#if compact}
      <span class="big-suit sym" aria-hidden="true"></span>
    {:else}
      {#if face}
        <span class="court" aria-hidden="true"><span class="letter">{rank}</span><i class="sym"></i></span>
      {/if}
      <span class="solo" aria-hidden="true">
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
        {/if}
        <i class="sym art"></i>
      </span>
      <span class="index br" aria-hidden="true"><b class:ten={rank === '10'}>{rank}</b><i class="sym"></i></span>
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
    --h: calc(var(--w) * var(--card-aspect));
    --tint: var(--card-face);
    position: relative;
    display: block;
    flex: none;
    width: var(--w);
    height: var(--h);
    padding: 0;
    border-radius: calc(var(--w) * var(--card-radius));
    background-color: var(--tint);
    background-image: var(--card-sheen);
    color: var(--suit-s);
    border: var(--card-border);
    box-shadow: var(--card-shadow);
    font-family: var(--index-font);
    user-select: none;
    -webkit-user-select: none;
    container-type: inline-size;
    transition:
      transform 0.18s var(--ease),
      box-shadow 0.18s var(--ease);
  }

  /*
   * Each suit picks its ink, its shapes, an optional paint for the symbols (a gradient,
   * say) and an optional tint for the whole card face. --card-ink overrides the ink for
   * themes that print white on a coloured card.
   */
  .suit-S {
    color: var(--card-ink, var(--suit-s));
    --suit-mask: var(--mask-s);
    --art-mask: var(--art-s);
    --paint: var(--paint-s, currentColor);
    --tint: var(--card-tint-s, var(--card-face));
  }
  .suit-H {
    color: var(--card-ink, var(--suit-h));
    --suit-mask: var(--mask-h);
    --art-mask: var(--art-h);
    --paint: var(--paint-h, currentColor);
    --tint: var(--card-tint-h, var(--card-face));
  }
  .suit-D {
    color: var(--card-ink, var(--suit-d));
    --suit-mask: var(--mask-d);
    --art-mask: var(--art-d);
    --paint: var(--paint-d, currentColor);
    --tint: var(--card-tint-d, var(--card-face));
  }
  .suit-C {
    color: var(--card-ink, var(--suit-c));
    --suit-mask: var(--mask-c);
    --art-mask: var(--art-c);
    --paint: var(--paint-c, currentColor);
    --tint: var(--card-tint-c, var(--card-face));
  }

  .sym {
    display: block;
    flex: none;
    width: 1em;
    height: 1em;
    background: var(--paint);
    -webkit-mask: var(--suit-mask) center / contain no-repeat;
    mask: var(--suit-mask) center / contain no-repeat;
  }

  .frame {
    display: var(--card-frame);
    position: absolute;
    inset: var(--card-frame-inset);
    border: var(--card-frame-line);
    border-radius: calc(var(--w) * var(--card-radius) * 0.6);
    pointer-events: none;
  }

  /* ----- Corner index: big and bold so a fanned hand reads at a glance ----- */
  .index {
    position: absolute;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: var(--index-align);
    line-height: 0.86;
    width: var(--index-width);
    font-variation-settings: var(--index-vars);
  }

  .index b {
    font-weight: var(--index-weight);
    font-size: var(--index-rank);
    letter-spacing: var(--index-tracking);
  }

  .index b.ten {
    letter-spacing: calc(var(--index-tracking) - 0.07em);
    margin-left: -0.08em;
    font-size: calc(var(--index-rank) * 0.88);
  }

  .index .sym {
    font-size: var(--index-suit);
    margin-top: var(--index-gap);
  }

  .tl {
    top: var(--index-top);
    left: var(--index-left);
  }

  .br {
    display: var(--index-br);
    bottom: var(--index-top);
    right: var(--index-left);
    transform: rotate(180deg);
  }

  /* ----- The one big symbol (or a crown, on face cards) ----- */
  /* Clipped to the card, so a theme can push the symbol off the edge as a watermark. */
  .solo {
    display: var(--card-solo);
    position: absolute;
    inset: 0;
    padding: var(--solo-pad);
    overflow: hidden;
    border-radius: inherit;
    place-items: var(--solo-place);
    font-size: var(--solo-size);
    opacity: var(--solo-opacity);
  }

  .solo > * {
    translate: var(--solo-shift);
  }

  .face .solo {
    display: var(--face-solo);
  }

  .ace .solo {
    font-size: var(--solo-ace);
  }

  .art {
    --suit-mask: var(--art-mask);
  }

  .face .art {
    display: var(--face-sym);
  }

  .crown {
    display: var(--crown);
    width: 1.15em;
    fill: var(--crown-fill);
    stroke: var(--crown-stroke);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  /* ----- Court cards in the classic style: a framed letter ----- */
  .court {
    display: var(--court);
    position: absolute;
    inset: var(--court-inset);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1cqi;
    border: var(--court-border);
    border-radius: var(--court-radius);
    background: var(--court-bg);
  }

  .letter {
    font-family: var(--court-font);
    font-weight: var(--court-weight);
    font-size: var(--court-letter);
    line-height: 1;
    font-variation-settings: var(--court-vars);
  }

  .court .sym {
    font-size: var(--court-sym);
  }

  .tag {
    position: absolute;
    z-index: 2;
    bottom: var(--tag-bottom);
    left: var(--tag-x);
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

  /* ----- Compact cards (side panels, playtest rows): just a giant index ----- */
  .compact .index {
    width: auto;
    top: 6cqi;
    left: 8cqi;
    align-items: flex-start;
  }

  .compact .index b {
    font-size: 46cqi;
  }

  .compact .index b.ten {
    font-size: 40cqi;
  }

  .compact .index .sym {
    font-size: 30cqi;
    margin-top: 3cqi;
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
    background: var(--back-edge);
    border: var(--back-border);
    box-shadow: var(--back-shadow);
    --suit-mask: var(--back-emblem);
  }

  .back::before {
    content: '';
    position: absolute;
    inset: var(--back-inset);
    border-radius: calc(var(--w) * var(--card-radius) * 0.7);
    background: var(--back-panel);
    border: var(--back-frame);
  }

  .emblem {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--back-emblem-size);
    height: var(--back-emblem-size);
    transform: translate(-50%, -50%);
    background: var(--back-emblem-ink);
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
      0 0 0 3px var(--card-ring),
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
        0 0 0 2px color-mix(in srgb, var(--card-ring) 70%, transparent),
        var(--card-lift-shadow);
    }
  }
</style>
