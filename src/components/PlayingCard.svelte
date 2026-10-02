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
  const red = $derived(card ? suitOf(card) === 'H' || suitOf(card) === 'D' : false);
  const face = $derived(card ? ['J', 'Q', 'K'].includes(rankOf(card)) : false);
  const ace = $derived(card ? rankOf(card) === 'A' : false);
  const tag = $derived(card === 'QS' ? '+13' : card === 'JD' && jackScored ? '−10' : null);
  const name = $derived(card ? `${rank === 'J' ? 'Jack' : rank === 'Q' ? 'Queen' : rank === 'K' ? 'King' : rank === 'A' ? 'Ace' : rank} of ${SUIT_NAME[suitOf(card)]}` : 'Face-down card');
</script>

<svelte:element
  this={onclick ? 'button' : 'div'}
  type={onclick ? 'button' : undefined}
  class="pc"
  class:back={!card}
  class:red
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
    <span class="corner tl" aria-hidden="true"><b>{rank}</b><i>{suit}</i></span>
    <span class="center" aria-hidden="true">
      {#if face}
        <span class="frame"><span class="letter">{rank}</span><span class="fsuit">{suit}</span></span>
      {:else}
        <span class="pip" class:ace>{suit}</span>
      {/if}
    </span>
    <span class="corner br" aria-hidden="true"><b>{rank}</b><i>{suit}</i></span>
    {#if showValue && tag}
      <span class="tag" class:good={card === 'JD'} aria-hidden="true">{tag}</span>
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
    border-radius: calc(var(--w) * 0.11);
    background: linear-gradient(160deg, #fffdf9 0%, var(--card-face) 60%, #f1ece2 100%);
    color: var(--card-black);
    border: 1px solid rgb(0 0 0 / 0.18);
    box-shadow:
      0 1px 0 rgb(255 255 255 / 0.9) inset,
      0 2px 4px rgb(0 0 0 / 0.25),
      0 10px 24px -10px rgb(0 0 0 / 0.55);
    font-family: var(--font-ui);
    user-select: none;
    -webkit-user-select: none;
    container-type: inline-size;
    transition:
      transform 0.18s var(--ease),
      box-shadow 0.18s var(--ease),
      filter 0.18s,
      opacity 0.18s;
  }

  .pc.red {
    color: var(--card-red);
  }

  .corner {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 0.9;
    gap: 1cqi;
  }

  .corner b {
    font-weight: 700;
    font-size: 19cqi;
    letter-spacing: -0.06em;
  }

  .corner i {
    font-style: normal;
    font-size: 16cqi;
  }

  .tl {
    top: 6cqi;
    left: 6cqi;
  }

  .br {
    bottom: 6cqi;
    right: 6cqi;
    transform: rotate(180deg);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .pip {
    font-size: 44cqi;
    line-height: 1;
    filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.08));
  }

  .pip.ace {
    font-size: 62cqi;
  }

  .frame {
    width: 52cqi;
    height: 78cqi;
    border-radius: 5cqi;
    border: 1.5px solid currentColor;
    opacity: 0.95;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2cqi;
    background:
      radial-gradient(circle at 50% 30%, rgb(255 255 255 / 0.9), transparent 70%),
      repeating-linear-gradient(45deg, rgb(0 0 0 / 0.035) 0 2px, transparent 2px 6px);
  }

  .letter {
    font-family: var(--font-display);
    font-weight: 600;
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
    bottom: 5cqi;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10.5cqi;
    font-weight: 700;
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

  /* Card back */
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
    text-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  }

  /* States */
  .interactive {
    cursor: pointer;
  }

  .interactive:disabled {
    cursor: not-allowed;
  }

  .dimmed {
    filter: brightness(0.55) saturate(0.6);
  }

  .selected {
    transform: translateY(-18%);
    box-shadow:
      0 0 0 3px var(--gold),
      0 1px 0 rgb(255 255 255 / 0.9) inset,
      0 18px 30px -10px rgb(0 0 0 / 0.6);
  }

  .fresh::after {
    content: 'new';
    position: absolute;
    top: -10px;
    left: 2px;
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
        0 0 0 2px rgb(242 196 109 / 0.6),
        0 1px 0 rgb(255 255 255 / 0.9) inset,
        0 16px 28px -10px rgb(0 0 0 / 0.6);
    }
  }
</style>
