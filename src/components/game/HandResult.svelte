<script lang="ts">
  import { onMount } from 'svelte';
  import { cardsPerPlayer } from '../../lib/engine/rules';
  import type { HandSummary } from '../../lib/engine/view';
  import { playedOutNote } from '../../lib/moments';
  import { fade, scale } from '../../lib/motion';
  import type { PlayerView } from '../../lib/types';
  import { signed } from '../../lib/ui';
  import Avatar from '../Avatar.svelte';
  import PlayingCard from '../PlayingCard.svelte';
  import TrickCards from './TrickCards.svelte';

  interface Props {
    gameId: string;
    summary: HandSummary;
    players: PlayerView[];
    onclose: () => void;
  }
  let { gameId, summary, players, onclose }: Props = $props();

  // Who played the hand: after the host removes someone, their hands stay theirs (the server says so).
  const name = (seat: number) => summary.names?.[seat] ?? players[seat]?.name ?? `Seat ${seat + 1}`;
  const names = $derived(players.map((p) => name(p.seat)));
  const best = $derived(Math.min(...summary.scores));
  const final = $derived(summary.finalTrick);
  const playedOut = $derived(playedOutNote(summary.autoFrom, cardsPerPlayer(summary.scores.length)));

  // The trick review (its code and its data) loads only when asked. It remembers which hand it was
  // opened for, so a newer hand closes it but a live update (someone passing) doesn't.
  let reviewing = $state<number | null>(null);

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
          {@const nm = name(p.seat)}
          <tr class:best={summary.scores[p.seat] === best}>
            <td>
              <span class="who">
                <!-- Someone removed since keeps their initials, not the face of whoever sits there now. -->
                {#if nm === p.name}
                  <Avatar name={p.name} seed={p.username} isBot={p.isBot} src={p.avatar} size={24} />
                {:else}
                  <Avatar name={nm} seed={nm} size={24} />
                {/if}
                <span class="nm" title={nm}>{nm}</span>
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

  {#if playedOut}<p class="faint small">{playedOut}</p>{/if}

  {#if final && final.winner !== null}
    <div class="pile">
      <div>
        <!-- When the server finished the hand, this is the last trick anyone saw played, not the hand's last. -->
        <span class="label">{summary.autoFrom ? 'Last trick played' : 'Final trick'}</span>
        <p class="faint small">Won by {name(final.winner)}</p>
      </div>
      <TrickCards plays={final.plays} winner={final.winner} {names} />
    </div>
  {/if}

  <div class="pile">
    <div>
      <span class="label">The crib</span>
      <p class="faint small">Won by {name(summary.cribWinner)} · worth {summary.cribPoints} {Math.abs(summary.cribPoints) === 1 ? 'point' : 'points'}</p>
    </div>
    <div class="cards">
      {#each summary.crib as c}<PlayingCard card={c} width={44} jackScored={summary.jackScored} />{/each}
    </div>
  </div>

  {#if reviewing === summary.number}
    <section class="stack" aria-label="Every trick">
      <span class="label">Every trick</span>
      {#await import('./TrickReview.svelte')}
        <p class="faint small">Loading the tricks…</p>
      {:then { default: TrickReview }}
        <TrickReview {gameId} hand={summary.number} {names} />
      {:catch}
        <!-- After a deploy, an old tab can't find the new code. -->
        <p class="faint small">Couldn’t load the trick review. Refresh the page to try again.</p>
      {/await}
    </section>
  {:else}
    <button class="btn btn-block" onclick={() => (reviewing = summary.number)}>See the tricks</button>
  {/if}

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
    /* Centred, so shrinking by both insets leaves every edge clear of a notch, status bar or home indicator. */
    width: min(640px, calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
    max-height: calc(100dvh - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    box-shadow: var(--shadow-lg);
    outline: none;
  }

  /* When it's taller than the screen the dialog scrolls; nothing in it gets squashed (the score table would). */
  .dialog > * {
    flex-shrink: 0;
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
    min-width: 0;
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
    overflow-wrap: anywhere;
  }

  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  /* Keep the Hand and Total columns in view: cut long names short. */
  .nm {
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* The final trick and the crib: a label on the left, cards on the right (below on a phone). */
  .pile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .pile > div {
    min-width: 0;
  }

  .pile p {
    overflow-wrap: anywhere;
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
