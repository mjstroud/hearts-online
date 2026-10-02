<script lang="ts">
  import { type Card, RANK_LABEL, SUIT_NAME, SUIT_SYMBOL, rankOf, suitOf } from '../lib/engine/cards';

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

  const rank = $derived(card ? RANK_LABEL[rankOf(card)] : '');
  const suit = $derived(card ? SUIT_SYMBOL[suitOf(card)] : '');
  const face = $derived(card ? ['J', 'Q', 'K'].includes(rankOf(card)) : false);
  const ace = $derived(card ? rankOf(card) === 'A' : false);
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
    <span class="index tl" aria-hidden="true"><b class:ten={rank === '10'}>{rank}</b><i>{suit}</i></span>
    {#if compact}
      <span class="big-suit" aria-hidden="true">{suit}</span>
    {:else}
      <span class="center" aria-hidden="true">
        {#if face}
          <span class="frame"><span class="letter">{rank}</span><span class="fsuit">{suit}</span></span>
        {:else}
          <span class="pip" class:ace>{suit}</span>
        {/if}
      </span>
      <span class="index br" aria-hidden="true"><b class:ten={rank === '10'}>{rank}</b><i>{suit}</i></span>
      {#if showValue && tag}
        <span class="tag" class:good={card === 'JD'} aria-hidden="true">{tag}</span>
      {/if}
    {/if}
  {:else}
    <span class="emblem" aria-hidden="true">♥</span>
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
    border-radius: calc(var(--w) * 0.1);
    background: linear-gradient(165deg, #fffefb 0%, var(--card-face) 65%, #f1ece2 100%);
    color: var(--suit-s);
    border: 1px solid rgb(0 0 0 / 0.2);
    box-shadow:
      0 1px 0 rgb(255 255 255 / 0.9) inset,
      0 1px 2px rgb(0 0 0 / 0.3),
      0 6px 14px -6px rgb(0 0 0 / 0.55);
    font-family: var(--font-ui);
    user-select: none;
    -webkit-user-select: none;
    container-type: inline-size;
    transition:
      transform 0.18s var(--ease),
      box-shadow 0.18s var(--ease);
  }

  .suit-S {
    color: var(--suit-s);
  }
  .suit-H {
    color: var(--suit-h);
  }
  .suit-D {
    color: var(--suit-d);
  }
  .suit-C {
    color: var(--suit-c);
  }

  /* ----- Corner index: big and bold so a fanned hand reads at a glance ----- */
  .index {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 0.86;
    width: 30cqi;
  }

  .index b {
    font-weight: 800;
    font-size: 30cqi;
    letter-spacing: -0.04em;
  }

  .index b.ten {
    letter-spacing: -0.11em;
    margin-left: -0.11em;
    font-size: 27cqi;
  }

  .index i {
    font-style: normal;
    font-size: 25cqi;
    margin-top: 1cqi;
  }

  .tl {
    top: 5cqi;
    left: 3cqi;
  }

  .br {
    bottom: 5cqi;
    right: 3cqi;
    transform: rotate(180deg);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .pip {
    font-size: 46cqi;
    line-height: 1;
  }

  .pip.ace {
    font-size: 66cqi;
  }

  .frame {
    width: 44cqi;
    height: 70cqi;
    border-radius: 5cqi;
    border: 1.5px solid currentColor;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1cqi;
    background:
      radial-gradient(circle at 50% 30%, rgb(255 255 255 / 0.9), transparent 70%),
      repeating-linear-gradient(45deg, rgb(0 0 0 / 0.035) 0 2px, transparent 2px 6px);
  }

  .letter {
    font-family: var(--font-display);
    font-weight: 650;
    font-size: 34cqi;
    line-height: 1;
    font-variation-settings: 'SOFT' 100, 'opsz' 72;
  }

  .fsuit {
    font-size: 20cqi;
    line-height: 1;
  }

  .tag {
    position: absolute;
    bottom: 4cqi;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11cqi;
    font-weight: 800;
    padding: 1.5cqi 5cqi;
    border-radius: 99px;
    background: #1a1d22;
    color: #fff;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }

  .tag.good {
    background: linear-gradient(180deg, #f7d58e, #e2a93f);
    color: #3b2604;
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

  .compact .index i {
    font-size: 40cqi;
    margin-top: 2cqi;
  }

  .big-suit {
    position: absolute;
    right: 6cqi;
    bottom: 2cqi;
    font-size: 54cqi;
    line-height: 1;
    opacity: 0.9;
  }

  /* ----- Card back ----- */
  .back {
    background:
      radial-gradient(circle at 50% 50%, rgb(255 255 255 / 0.12), transparent 55%),
      repeating-linear-gradient(45deg, rgb(255 255 255 / 0.07) 0 2px, transparent 2px 9px),
      repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.07) 0 2px, transparent 2px 9px),
      linear-gradient(160deg, #c8344a, #8e1830);
    border: 1px solid rgb(0 0 0 / 0.3);
  }

  .back::before {
    content: '';
    position: absolute;
    inset: 6cqi;
    border-radius: calc(var(--w) * 0.07);
    border: 1.5px solid rgb(255 255 255 / 0.55);
  }

  .emblem {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgb(255 255 255 / 0.9);
    font-size: 34cqi;
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
    z-index: 2;
    border-radius: inherit;
    background: rgb(12 16 14 / 0.5);
  }

  .selected {
    transform: translateY(-18%);
    box-shadow:
      0 0 0 3px var(--gold),
      0 1px 0 rgb(255 255 255 / 0.9) inset,
      0 14px 24px -10px rgb(0 0 0 / 0.6);
  }

  .fresh::after {
    content: 'new';
    position: absolute;
    top: -10px;
    left: 2px;
    z-index: 3;
    padding: 1px 6px;
    border-radius: 99px;
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
        0 0 0 2px rgb(242 196 109 / 0.7),
        0 1px 0 rgb(255 255 255 / 0.9) inset,
        0 12px 22px -10px rgb(0 0 0 / 0.6);
    }
  }
</style>
