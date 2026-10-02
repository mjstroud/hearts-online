<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import type { HandSummary } from '../../lib/engine/view';
  import type { PlayerView } from '../../lib/types';
  import { BOT_AVATAR, avatarColor, initials, signed } from '../../lib/ui';
  import PlayingCard from '../PlayingCard.svelte';

  interface Props {
    summary: HandSummary;
    players: PlayerView[];
    onclose: () => void;
  }
  let { summary, players, onclose }: Props = $props();

  const name = (seat: number) => players[seat]?.name ?? `Seat ${seat + 1}`;
  const best = $derived(Math.min(...summary.scores));

  let dialog: HTMLDivElement;
  onMount(() => {
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="backdrop" transition:fade={{ duration: 150 }} onclick={onclose} role="presentation"></div>
<div
  class="dialog panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="hand-result-title"
  tabindex="-1"
  bind:this={dialog}
  transition:scale={{ start: 0.96, duration: 200 }}
>
  <div class="head">
    <span class="eyebrow">Passed {summary.passLabel.toLowerCase()}</span>
    <h2 id="hand-result-title" class="display">Hand {summary.number} is in the books</h2>
  </div>

  {#if summary.sun !== null}
    <div class="banner sun">
      <span class="icon">☀</span>
      <div><strong>{name(summary.sun)} shot the Sun!</strong><span>Won every trick. Everyone else takes +52.</span></div>
    </div>
  {:else if summary.moon !== null}
    <div class="banner moon">
      <span class="icon">☾</span>
      <div><strong>{name(summary.moon)} shot the Moon!</strong><span>All hearts and the Queen. Everyone else takes +26.</span></div>
    </div>
  {/if}

  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr><th>Player</th><th>♥</th><th>Q♠</th>{#if summary.jackScored}<th>J♦</th>{/if}<th>Tricks</th><th>Hand</th><th>Total</th></tr>
      </thead>
      <tbody>
        {#each players as p}
          <tr class:best={summary.scores[p.seat] === best}>
            <td>
              <span class="who">
                <span class="avatar" style={`--size: 24px; --avatar: ${avatarColor(p.username)}`}>{p.isBot ? BOT_AVATAR : initials(p.name)}</span>
                {p.name}
                {#if summary.cribWinner === p.seat}<span class="badge" title="Won the crib">Crib</span>{/if}
              </span>
            </td>
            <td>{summary.hearts[p.seat] || '·'}</td>
            <td>{summary.queen === p.seat ? '13' : '·'}</td>
            {#if summary.jackScored}<td class="good">{summary.jack === p.seat ? '−10' : '·'}</td>{/if}
            <td>{summary.tricksWon[p.seat]}</td>
            <td><strong class:up={summary.scores[p.seat] > 0} class:down={summary.scores[p.seat] < 0}>{signed(summary.scores[p.seat])}</strong></td>
            <td><strong>{p.score}</strong></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="crib">
    <div>
      <span class="label">The crib</span>
      <p class="faint small">Won by {name(summary.cribWinner)} · worth {summary.cribPoints} {Math.abs(summary.cribPoints) === 1 ? 'point' : 'points'}</p>
    </div>
    <div class="cards">
      {#each summary.crib as c}<PlayingCard card={c} width={44} jackScored={summary.jackScored} />{/each}
    </div>
  </div>

  <button class="btn btn-primary btn-lg btn-block" onclick={onclose}>Continue</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgb(0 0 0 / 0.72);
  }

  .dialog {
    position: fixed;
    z-index: 81;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(640px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    box-shadow: var(--shadow-lg);
    outline: none;
  }

  .head h2 {
    font-size: 28px;
    margin-top: 4px;
  }

  .banner {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    border-radius: 14px;
  }

  .banner div {
    display: flex;
    flex-direction: column;
  }

  .banner span:not(.icon) {
    font-size: 13.5px;
    color: var(--muted);
  }

  .banner .icon {
    font-size: 30px;
    line-height: 1;
  }

  .banner.sun {
    background: linear-gradient(120deg, rgb(242 196 109 / 0.22), rgb(240 71 91 / 0.12));
    border: 1px solid rgb(242 196 109 / 0.35);
    color: var(--gold);
  }

  .banner.moon {
    background: linear-gradient(120deg, rgb(124 180 255 / 0.18), rgb(139 99 210 / 0.12));
    border: 1px solid rgb(124 180 255 / 0.3);
    color: var(--sky);
  }

  .banner strong {
    color: var(--text);
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  tr.best td {
    background: rgb(79 209 161 / 0.06);
  }

  .up {
    color: #ff98a4;
  }

  .down {
    color: var(--mint);
  }

  td.good {
    color: var(--gold);
  }

  .crib {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .label {
    font-weight: 600;
  }

  .small {
    font-size: 13px;
  }

  .cards {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  @media (max-width: 520px) {
    .dialog {
      padding: 18px;
    }

    .head h2 {
      font-size: 22px;
    }
  }
</style>
